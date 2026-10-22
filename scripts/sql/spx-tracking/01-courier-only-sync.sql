-- Courier observations do not promote orders, recategorize them, or recompute money.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS public.spx_tracking_sync_state (
 organization_id bigint NOT NULL REFERENCES public.organizations(id),
 tracking_no text NOT NULL, source_ref text NOT NULL,
 target_table text NOT NULL CHECK(target_table IN ('orders','orders_draft')),
 target_id bigint NOT NULL, tracking_status text NOT NULL,
 observed_at timestamptz NOT NULL, event_at timestamptz NOT NULL,
 delivered_at timestamptz, returned_at timestamptz,
 applied_at timestamptz NOT NULL DEFAULT now(), applied_by uuid NOT NULL,
 PRIMARY KEY(organization_id,tracking_no)
);
ALTER TABLE public.spx_tracking_sync_state ADD COLUMN IF NOT EXISTS reviewed_terminal_from text, ADD COLUMN IF NOT EXISTS review_reason text, ADD COLUMN IF NOT EXISTS spx_created_at timestamptz;
ALTER TABLE public.spx_tracking_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spx_tracking_state_read ON public.spx_tracking_sync_state;
CREATE POLICY spx_tracking_state_read ON public.spx_tracking_sync_state FOR SELECT TO authenticated
 USING(organization_id=(SELECT public.current_org_id()) AND (SELECT public.get_user_role()) IN ('owner','admin'));
REVOKE ALL ON public.spx_tracking_sync_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.spx_tracking_sync_state TO authenticated;

-- A courier-only change is not new attribution input. Preserve unresolved campaigns too.
CREATE OR REPLACE FUNCTION public.trg_auto_resolve_attribution()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND
 ROW(NEW.attribution_code_raw,NEW.attribution_platform,NEW.attribution_account_code,NEW.attribution_campaign_marker,NEW.campaign_id,NEW.meta)
 IS NOT DISTINCT FROM
 ROW(OLD.attribution_code_raw,OLD.attribution_platform,OLD.attribution_account_code,OLD.attribution_campaign_marker,OLD.campaign_id,OLD.meta)
 THEN RETURN NEW; END IF;
 IF NEW.campaign_id IS NULL
 AND (COALESCE(NEW.attribution_account_code,'')<>'' OR COALESCE(NEW.meta->>'atribusi_account','')<>'')
 AND (COALESCE(NEW.attribution_campaign_marker,'')<>'' OR COALESCE(NEW.meta->>'atribusi_campaign','')<>'')
 THEN PERFORM public.resolve_order_attribution(ARRAY[NEW.id]);
 ELSIF NEW.campaign_id IS NULL THEN
 UPDATE public.orders_draft SET
 attribution_status=CASE WHEN COALESCE(NEW.attribution_code_raw,NULLIF(NEW.meta->>'product_code_full','')) IS NULL THEN 'UNKNOWN' ELSE 'PENDING' END,
 meta=jsonb_set(COALESCE(NEW.meta,'{}'),'{atribusi_status}',to_jsonb(CASE WHEN COALESCE(NEW.attribution_code_raw,NULLIF(NEW.meta->>'product_code_full','')) IS NULL THEN 'UNKNOWN' ELSE 'PENDING' END),true)
 WHERE id=NEW.id;
 END IF;
 RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_spx_tracking_observations(p_rows jsonb,p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_catalog SET lock_timeout TO '3s' SET jit TO 'off' AS $$
DECLARE
 v_user uuid:=auth.uid(); v_org bigint; v_org_after bigint; v_role text;
 r jsonb; old_row jsonb; new_row jsonb; hits jsonb; hit jsonb; expected jsonb;
 prior public.spx_tracking_sync_state%ROWTYPE;
 v_ref text; v_track text; v_table text; v_id bigint; v_status text;
 v_observed timestamptz; v_event timestamptz; v_delivered timestamptz; v_returned timestamptz;
 v_created timestamptz; v_updated timestamptz; v_changed boolean; v_receipt boolean;
 result jsonb:='[]'; seen text[]:='{}'; matched jsonb;
 allowed text[]:=ARRAY['tracking_no','resi','tracking_status','tracking_synced_at','updated_at','spx_created_at','delivered_at','returned_at'];
BEGIN
 SELECT organization_id,role::text INTO v_org,v_role FROM public.profiles WHERE id=v_user AND active;
 IF v_org IS NULL OR v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Akses sinkronisasi SPX ditolak' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR p_dry_run IS NULL THEN RAISE EXCEPTION 'Permintaan tidak valid' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Maksimal 100 observasi' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-wa:'||v_org,0));
 SELECT organization_id,role::text INTO v_org_after,v_role FROM public.profiles WHERE id=v_user AND active FOR SHARE;
 IF v_org_after IS DISTINCT FROM v_org OR v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Akses berubah' USING ERRCODE='42501'; END IF;
 -- Also serialize legacy/direct writers that do not take the ingestion advisory lock.
 -- Short lock timeout returns a retryable error during busy operator transactions.
 LOCK TABLE public.orders,public.orders_draft IN SHARE ROW EXCLUSIVE MODE;
 -- Match all retained identities in both physical tables, once per batch.
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
   r-ARRAY['ref','tracking_no','target_table','target_id','expected_updated_at','tracking_status','observed_at','event_at','spx_created_at','delivered_at','returned_at','reviewed_terminal_from','review_reason']<>'{}'
  THEN RAISE EXCEPTION 'Kolom observasi tidak valid' USING ERRCODE='22023'; END IF;
  v_ref:=upper(btrim(r->>'ref')); v_track:=upper(btrim(r->>'tracking_no'));
  v_table:=r->>'target_table'; v_id:=(r->>'target_id')::bigint; v_status:=r->>'tracking_status';
  v_observed:=(r->>'observed_at')::timestamptz; v_event:=(r->>'event_at')::timestamptz;
  v_delivered:=(r->>'delivered_at')::timestamptz; v_returned:=(r->>'returned_at')::timestamptz;
  v_updated:=(r->>'expected_updated_at')::timestamptz; v_created:=(r->>'spx_created_at')::timestamptz;
  IF v_ref IS NULL OR v_ref !~ '^GB-[0-9]{8}-[0-9]{6}$' OR v_track IS NULL OR v_track !~ '^SPXID[0-9A-Z]{1,64}$'
   OR v_table IS NULL OR v_table NOT IN ('orders','orders_draft') OR v_id IS NULL OR v_updated IS NULL
   OR v_status IS NULL OR v_status NOT IN ('Delivered','Returned','Returning','Delivering','In Transit','On Hold','Pending Pickup','Pickup On Hold','Picked Up','Lost','Parcel Lost','Damaged','Cancelled')
   OR v_observed IS NULL OR v_observed NOT BETWEEN clock_timestamp()-interval '30 minutes' AND clock_timestamp()+interval '1 minute'
   OR v_event IS NULL OR v_event NOT BETWEEN '2015-01-01'::timestamptz AND v_observed+interval '5 minutes'
   OR (v_created IS NOT NULL AND v_created NOT BETWEEN '2015-01-01'::timestamptz AND v_event)
   OR (v_delivered IS NOT NULL AND (v_status<>'Delivered' OR v_delivered<>v_event))
   OR (v_returned IS NOT NULL AND (v_status<>'Returned' OR v_returned<>v_event))
  THEN RAISE EXCEPTION 'Sumber atau waktu observasi tidak valid' USING ERRCODE='22023'; END IF;
  hits:=coalesce(matched->(hit#>>'{}'),'[]');
  IF jsonb_array_length(hits)<>1 OR NOT (hits->0->>'ref_match')::boolean OR hits->0->>'table'<>v_table OR (hits->0->>'id')::bigint<>v_id THEN
   RAISE EXCEPTION 'Identitas SPX ambigu atau berubah' USING ERRCODE='PT409'; END IF;
  IF v_table||':'||v_id=ANY(seen) OR 'track:'||v_track=ANY(seen) THEN RAISE EXCEPTION 'Observasi ganda dalam batch' USING ERRCODE='22023'; END IF;
  seen:=array_append(array_append(seen,v_table||':'||v_id),'track:'||v_track);
  EXECUTE format('SELECT to_jsonb(o) FROM public.%I o WHERE id=$1 AND organization_id=$2 FOR UPDATE',v_table) INTO old_row USING v_id,v_org;
  IF old_row IS NULL THEN RAISE EXCEPTION 'Order berpindah atau berubah' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[old_row->>'tracking_no',old_row->>'resi']) t WHERE nullif(nullif(btrim(t),''),'-') IS NOT NULL AND upper(btrim(t))<>v_track) THEN
   RAISE EXCEPTION 'Resi tersimpan berbeda' USING ERRCODE='PT409'; END IF;
  SELECT * INTO prior FROM public.spx_tracking_sync_state WHERE organization_id=v_org AND tracking_no=v_track FOR UPDATE;
  IF FOUND AND (v_observed<prior.observed_at OR v_event<prior.event_at OR (v_event=prior.event_at AND v_status<>prior.tracking_status)) THEN
   RAISE EXCEPTION 'Observasi lebih lama atau bertentangan' USING ERRCODE='PT409'; END IF;
  IF upper(coalesce(old_row->>'tracking_status','')) IN ('DELIVERED','RETURNED') AND upper(old_row->>'tracking_status')<>upper(v_status) THEN
   IF v_role<>'owner' OR r->>'reviewed_terminal_from' IS DISTINCT FROM old_row->>'tracking_status'
    OR r->>'review_reason' IS DISTINCT FROM 'legacy_status_without_terminal_event' OR prior.tracking_no IS NOT NULL THEN
    RAISE EXCEPTION 'Perubahan status terminal perlu ditinjau' USING ERRCODE='PT409';
   END IF; END IF;
  expected:=old_row||jsonb_build_object('tracking_no',v_track,'resi',v_track,'tracking_status',v_status,
   'spx_created_at',coalesce(nullif(old_row->'spx_created_at','null'),to_jsonb(v_created)),
   'delivered_at',coalesce(nullif(old_row->'delivered_at','null'),to_jsonb(v_delivered)),
   'returned_at',coalesce(nullif(old_row->'returned_at','null'),to_jsonb(v_returned)));
  v_changed:=(old_row-ARRAY['updated_at','tracking_synced_at']) IS DISTINCT FROM (expected-ARRAY['updated_at','tracking_synced_at']);
  -- An identical retry after a lost response is harmless; a different edit needs a fresh snapshot.
  IF v_changed AND (old_row->>'updated_at')::timestamptz IS DISTINCT FROM v_updated THEN
   RAISE EXCEPTION 'Order diedit setelah pembacaan; muat ulang' USING ERRCODE='PT409'; END IF;
  IF NOT p_dry_run THEN
   IF v_changed THEN
    EXECUTE format('UPDATE public.%I SET tracking_no=$1,resi=$1,tracking_status=$2,delivered_at=coalesce(delivered_at,$3),returned_at=coalesce(returned_at,$4),spx_created_at=coalesce(spx_created_at,$7)%s WHERE id=$5 AND organization_id=$6',
      v_table,CASE WHEN v_table='orders_draft' THEN ',tracking_synced_at=now()' ELSE '' END)
     USING v_track,v_status,v_delivered,v_returned,v_id,v_org,v_created;
    EXECUTE format('SELECT to_jsonb(o) FROM public.%I o WHERE id=$1 AND organization_id=$2',v_table) INTO new_row USING v_id,v_org;
    IF new_row IS NULL OR new_row-allowed IS DISTINCT FROM old_row-allowed
     OR new_row-ARRAY['updated_at','tracking_synced_at'] IS DISTINCT FROM expected-ARRAY['updated_at','tracking_synced_at'] THEN
     RAISE EXCEPTION 'Sinkronisasi mengubah kolom di luar observasi' USING ERRCODE='PT409'; END IF;
   END IF;
   INSERT INTO public.spx_tracking_sync_state(organization_id,tracking_no,source_ref,target_table,target_id,tracking_status,observed_at,event_at,delivered_at,returned_at,applied_by,reviewed_terminal_from,review_reason,spx_created_at)
   VALUES(v_org,v_track,v_ref,v_table,v_id,v_status,v_observed,v_event,v_delivered,v_returned,v_user,r->>'reviewed_terminal_from',r->>'review_reason',v_created)
   ON CONFLICT(organization_id,tracking_no) DO UPDATE SET source_ref=excluded.source_ref,target_table=excluded.target_table,target_id=excluded.target_id,
    tracking_status=excluded.tracking_status,observed_at=excluded.observed_at,event_at=excluded.event_at,
    delivered_at=excluded.delivered_at,returned_at=excluded.returned_at,spx_created_at=coalesce(excluded.spx_created_at,spx_tracking_sync_state.spx_created_at),applied_at=now(),applied_by=excluded.applied_by
   WHERE ROW(spx_tracking_sync_state.observed_at,spx_tracking_sync_state.target_table,spx_tracking_sync_state.target_id)
    IS DISTINCT FROM ROW(excluded.observed_at,excluded.target_table,excluded.target_id);
  END IF;
  result:=result||jsonb_build_array(jsonb_build_object('target_table',v_table,'target_id',v_id,'changed',v_changed));
 END LOOP;
 RETURN jsonb_build_object('dry_run',p_dry_run,'matched',jsonb_array_length(result),'changed',(SELECT count(*) FROM jsonb_array_elements(result) x WHERE (x->>'changed')::boolean),'rows',result);
END $$;
REVOKE ALL ON FUNCTION public.sync_spx_tracking_observations(jsonb,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sync_spx_tracking_observations(jsonb,boolean) TO authenticated;
COMMIT;
