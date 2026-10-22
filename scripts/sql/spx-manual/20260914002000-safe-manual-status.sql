-- 20260914002000: manual SPX files preserve business state and require reviewed versions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION public.spx_status_file_rows(p_rows jsonb,p_apply boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,pg_catalog SET lock_timeout TO '3s' SET jit TO 'off' AS $$
DECLARE
 v_user uuid:=auth.uid(); v_org bigint; v_org_after bigint; v_role text;
 r jsonb; hit jsonb; hits jsonb; matched jsonb; old_row jsonb; expected jsonb; new_row jsonb;
 v_ref text; v_track text; v_table text; v_id bigint; v_status text;
 v_created timestamptz; v_delivered timestamptz; v_changed boolean;
 prior public.spx_tracking_sync_state%ROWTYPE;
 seen text[]:='{}'; result jsonb:='[]'; n_matched int:=0; n_updated int:=0; n_empty int:=0; n_missing int:=0;
 allowed text[]:=ARRAY['tracking_no','resi','tracking_status','tracking_synced_at','updated_at','spx_created_at','delivered_at'];
BEGIN
 SELECT organization_id,role::text INTO v_org,v_role FROM public.profiles WHERE id=v_user AND active;
 IF v_org IS NULL OR v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Akses sinkronisasi SPX ditolak' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR p_apply IS NULL OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 150 THEN
  RAISE EXCEPTION 'Permintaan SPX harus berisi 1 sampai 150 baris' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-wa:'||v_org,0));
 SELECT organization_id,role::text INTO v_org_after,v_role FROM public.profiles WHERE id=v_user AND active FOR SHARE;
 IF v_org_after IS DISTINCT FROM v_org OR v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Akses berubah' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.orders,public.orders_draft IN SHARE ROW EXCLUSIVE MODE;
 WITH existing AS MATERIALIZED (
  SELECT 'orders' kind,id,order_number,external_order_id,tracking_no,resi,raw_data,meta FROM public.orders WHERE organization_id=v_org
  UNION ALL SELECT 'orders_draft',id,order_number,external_order_id,tracking_no,resi,raw_data,meta FROM public.orders_draft WHERE organization_id=v_org
 ), keys AS MATERIALIZED (
  SELECT kind,id,'ref' key_kind,upper(btrim(k)) val FROM existing CROSS JOIN LATERAL unnest(ARRAY[order_number,external_order_id]) k
  UNION ALL SELECT kind,id,'tracking',upper(btrim(k)) FROM existing CROSS JOIN LATERAL unnest(ARRAY[tracking_no,resi,raw_data->>'tracking_no',raw_data->>'Tracking No.',meta->>'spx_tracking_no']) k
  UNION ALL SELECT kind,id,'ref',upper(btrim(a->>'ref')) FROM existing CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(meta->'spx_import_identities')='array' THEN meta->'spx_import_identities' ELSE '[]' END) a
  UNION ALL SELECT kind,id,'tracking',upper(btrim(a->>'tracking_no')) FROM existing CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(meta->'spx_import_identities')='array' THEN meta->'spx_import_identities' ELSE '[]' END) a
 ), requested AS MATERIALIZED (
  SELECT ordinality n,k.key_kind,upper(btrim(k.val)) val FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  CROSS JOIN LATERAL (VALUES ('ref',value->>'ref'),('tracking',value->>'tracking_no')) k(key_kind,val)
 ), matches AS (
  SELECT n,kind,id,bool_or(keys.key_kind='ref') ref_match FROM requested JOIN keys USING(key_kind,val)
  GROUP BY n,kind,id
 ), grouped AS (
  SELECT n,jsonb_agg(jsonb_build_object('table',kind,'id',id,'ref_match',ref_match)) rows FROM matches GROUP BY n
 ) SELECT coalesce(jsonb_object_agg(n::text,rows),'{}') INTO matched FROM grouped;
 FOR r,hit IN SELECT value,to_jsonb(ordinality) FROM jsonb_array_elements(p_rows) WITH ORDINALITY LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR
   r-ARRAY['ref','tracking_no','tracking_status','actual_fee','return_fee','delivered_at','retur_reason','cod_amount','create_time','rescue_priority','expected_updated_at']<>'{}'
  THEN RAISE EXCEPTION 'Kolom file SPX tidak valid' USING ERRCODE='22023'; END IF;
  v_ref:=nullif(nullif(upper(btrim(r->>'ref')),''),'-');
  v_track:=nullif(nullif(upper(btrim(r->>'tracking_no')),''),'-');
  IF v_ref IS NULL AND v_track IS NULL THEN n_empty:=n_empty+1; CONTINUE; END IF;
  hits:=coalesce(matched->(hit#>>'{}'),'[]');
  IF jsonb_array_length(hits)=0 THEN n_missing:=n_missing+1; CONTINUE; END IF;
  IF jsonb_array_length(hits)<>1 OR (v_ref IS NOT NULL AND NOT (hits->0->>'ref_match')::boolean) THEN
   RAISE EXCEPTION 'Identitas file SPX ambigu atau bertentangan' USING ERRCODE='PT409'; END IF;
  v_table:=hits->0->>'table'; v_id:=(hits->0->>'id')::bigint;
  IF v_table||':'||v_id=ANY(seen) THEN RAISE EXCEPTION 'Order berulang dalam batch SPX' USING ERRCODE='PT409'; END IF;
  seen:=array_append(seen,v_table||':'||v_id);
  EXECUTE format('SELECT to_jsonb(o) FROM public.%I o WHERE id=$1 AND organization_id=$2 FOR UPDATE',v_table) INTO old_row USING v_id,v_org;
  IF old_row IS NULL THEN RAISE EXCEPTION 'Order berpindah; ulangi preview' USING ERRCODE='PT409'; END IF;
  IF v_track IS NULL OR v_track !~ '^SPXID[0-9A-Z]{1,64}$' THEN RAISE EXCEPTION 'Nomor resi SPX tidak valid' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[old_row->>'tracking_no',old_row->>'resi']) t WHERE nullif(nullif(btrim(t),''),'-') IS NOT NULL AND upper(btrim(t))<>v_track) THEN
   RAISE EXCEPTION 'Resi tersimpan berbeda' USING ERRCODE='PT409'; END IF;
  v_status:=CASE lower(btrim(r->>'tracking_status'))
   WHEN 'delivered' THEN 'Delivered' WHEN 'returned' THEN 'Returned' WHEN 'returning' THEN 'Returning'
   WHEN 'delivering' THEN 'Delivering' WHEN 'in transit' THEN 'In Transit' WHEN 'on hold' THEN 'On Hold'
   WHEN 'pending pickup' THEN 'Pending Pickup' WHEN 'pickup on hold' THEN 'Pickup On Hold' WHEN 'picked up' THEN 'Picked Up'
   WHEN 'lost' THEN 'Lost' WHEN 'parcel lost' THEN 'Parcel Lost' WHEN 'damaged' THEN 'Damaged' WHEN 'cancelled' THEN 'Cancelled' END;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Status SPX tidak dikenali' USING ERRCODE='22023'; END IF;
  SELECT * INTO prior FROM public.spx_tracking_sync_state WHERE organization_id=v_org AND tracking_no=v_track FOR SHARE;
  -- An export has no trustworthy latest-event timestamp. Never overwrite live observations with a conflicting snapshot.
  IF FOUND AND (prior.target_table<>v_table OR prior.target_id<>v_id OR prior.tracking_status<>v_status) THEN
   RAISE EXCEPTION 'File berbeda dari observasi kurir terverifikasi; gunakan sinkronisasi kurir terbaru' USING ERRCODE='PT409'; END IF;
  IF upper(coalesce(old_row->>'tracking_status','')) IN ('DELIVERED','RETURNED') AND upper(old_row->>'tracking_status')<>upper(v_status) THEN
   RAISE EXCEPTION 'Perubahan status terminal perlu bukti kurir' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[r->>'create_time',r->>'delivered_at']) t
   WHERE nullif(t,'') IS NOT NULL AND t !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') THEN
   RAISE EXCEPTION 'Waktu SPX harus memiliki zona waktu eksplisit' USING ERRCODE='22023'; END IF;
  v_created:=nullif(r->>'create_time','')::timestamptz;
  v_delivered:=CASE WHEN v_status='Delivered' THEN nullif(r->>'delivered_at','')::timestamptz ELSE NULL END;
  IF (v_created IS NOT NULL AND v_created NOT BETWEEN '2015-01-01'::timestamptz AND clock_timestamp()+interval '5 minutes')
   OR (v_delivered IS NOT NULL AND v_delivered NOT BETWEEN coalesce(v_created,'2015-01-01'::timestamptz) AND clock_timestamp()+interval '5 minutes') THEN
   RAISE EXCEPTION 'Tanggal file SPX tidak valid' USING ERRCODE='22023'; END IF;
  expected:=old_row||jsonb_build_object('tracking_no',v_track,'resi',v_track,'tracking_status',v_status,
   'spx_created_at',coalesce(nullif(old_row->'spx_created_at','null'),to_jsonb(v_created)),
   'delivered_at',coalesce(nullif(old_row->'delivered_at','null'),to_jsonb(v_delivered)));
  v_changed:=(old_row-ARRAY['updated_at','tracking_synced_at']) IS DISTINCT FROM (expected-ARRAY['updated_at','tracking_synced_at']);
  IF p_apply AND (r->>'expected_updated_at' IS NULL OR
   (v_changed AND (old_row->>'updated_at')::timestamptz IS DISTINCT FROM (r->>'expected_updated_at')::timestamptz)) THEN
   RAISE EXCEPTION 'Order berubah atau belum dipreview; ulangi preview' USING ERRCODE='PT409'; END IF;
  IF p_apply AND v_changed THEN
   EXECUTE format('UPDATE public.%I SET tracking_no=$1,resi=$1,tracking_status=$2,spx_created_at=coalesce(spx_created_at,$3),delivered_at=coalesce(delivered_at,$4)%s WHERE id=$5 AND organization_id=$6',
    v_table,CASE WHEN v_table='orders_draft' THEN ',tracking_synced_at=now()' ELSE '' END)
    USING v_track,v_status,v_created,v_delivered,v_id,v_org;
   EXECUTE format('SELECT to_jsonb(o) FROM public.%I o WHERE id=$1 AND organization_id=$2',v_table) INTO new_row USING v_id,v_org;
   IF new_row IS NULL OR new_row-allowed IS DISTINCT FROM old_row-allowed
    OR new_row-ARRAY['updated_at','tracking_synced_at'] IS DISTINCT FROM expected-ARRAY['updated_at','tracking_synced_at'] THEN
    RAISE EXCEPTION 'Sinkronisasi mengubah kolom di luar data kurir' USING ERRCODE='PT409'; END IF;
  END IF;
  n_matched:=n_matched+1; IF v_changed THEN n_updated:=n_updated+1; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('index',(hit#>>'{}')::int-1,'target_table',v_table,'target_id',v_id,
    'expected_updated_at',old_row->>'updated_at','changed',v_changed));
 END LOOP;
 RETURN jsonb_build_object('matched',n_matched,'updated',n_updated,'skipped_no_ref',n_empty,'skipped_no_match',n_missing,'rows',result,'dry_run',NOT p_apply);
END $$;
CREATE OR REPLACE FUNCTION public.preview_spx_status_file(p_rows jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO public,pg_catalog AS $$
 SELECT public.spx_status_file_rows(p_rows,false);
$$;
CREATE OR REPLACE FUNCTION public.apply_spx_status_sync(p_rows jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO public,pg_catalog AS $$
 SELECT public.spx_status_file_rows(p_rows,true);
$$;
REVOKE ALL ON FUNCTION public.spx_status_file_rows(jsonb,boolean),public.preview_spx_status_file(jsonb),public.apply_spx_status_sync(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.spx_status_file_rows(jsonb,boolean),public.preview_spx_status_file(jsonb),public.apply_spx_status_sync(jsonb) TO authenticated;
COMMIT;
