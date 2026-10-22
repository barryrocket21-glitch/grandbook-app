-- A07: preview and ingestion share identity matching. No existing rows are changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.preview_missing_spx_orders(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public,pg_catalog AS $$
DECLARE
 v_org bigint:=public.current_org_id(); v_refs text[]; v_tracks text[];
 r jsonb; n bigint; v_ref text; v_track text;
 v_candidates jsonb:='[]'; v_existing_keys jsonb:='[]'; v_existing int:=0; v_batch int:=0; v_invalid int:=0;
BEGIN
 IF v_org IS NULL OR public.get_user_role() NOT IN ('owner','admin') THEN
   RAISE EXCEPTION 'Akses impor SPX ditolak' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Daftar SPX tidak valid' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_rows)>200 THEN RAISE EXCEPTION 'Maksimal 200 baris' USING ERRCODE='22023'; END IF;
 -- Include retained source tracking from the former importer, which did not fill tracking_no.
 WITH existing AS MATERIALIZED (
   SELECT order_number,external_order_id,tracking_no,resi,raw_data,meta FROM public.orders WHERE organization_id=v_org
   UNION ALL
   SELECT order_number,external_order_id,tracking_no,resi,raw_data,meta FROM public.orders_draft WHERE organization_id=v_org
 ), keys AS (
   SELECT 'ref' kind,upper(btrim(k)) val FROM existing CROSS JOIN LATERAL unnest(ARRAY[order_number,external_order_id]) k
   UNION ALL
   SELECT 'tracking',upper(btrim(k)) FROM existing CROSS JOIN LATERAL
     unnest(ARRAY[tracking_no,resi,raw_data->>'tracking_no',meta->>'spx_tracking_no']) k
   UNION ALL
   SELECT 'ref',upper(btrim(alias->>'ref')) FROM existing CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(meta->'spx_import_identities')='array' THEN meta->'spx_import_identities' ELSE '[]'::jsonb END) alias
   UNION ALL
   SELECT 'tracking',upper(btrim(alias->>'tracking_no')) FROM existing CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(meta->'spx_import_identities')='array' THEN meta->'spx_import_identities' ELSE '[]'::jsonb END) alias
 ) SELECT coalesce(array_agg(DISTINCT val) FILTER(WHERE kind='ref'),'{}'),
          coalesce(array_agg(DISTINCT val) FILTER(WHERE kind='tracking'),'{}')
   INTO v_refs,v_tracks FROM keys WHERE val IS NOT NULL AND val NOT IN ('','-');
 FOR r,n IN SELECT value,ordinality-1 FROM jsonb_array_elements(p_rows) WITH ORDINALITY LOOP
   IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR jsonb_typeof(r->'ref') IS DISTINCT FROM 'string'
      OR (r ? 'tracking_no' AND jsonb_typeof(r->'tracking_no') NOT IN ('string','null')) THEN
     RAISE EXCEPTION 'Identitas SPX tidak valid' USING ERRCODE='22023'; END IF;
   v_ref:=upper(btrim(r->>'ref'));
   v_track:=nullif(nullif(upper(btrim(r->>'tracking_no')),''),'-');
   IF length(v_ref)>200 OR length(v_track)>200 THEN RAISE EXCEPTION 'Identitas SPX terlalu panjang' USING ERRCODE='22023'; END IF;
 END LOOP;
 -- Connected identities make matching independent of row order: A/X, B/X,
 -- B/Y belong to one component, including when a later row matches an existing order.
 WITH RECURSIVE pairs AS MATERIALIZED (
   SELECT (ordinality-1)::int idx,upper(btrim(value->>'ref')) ref,
     nullif(nullif(upper(btrim(value->>'tracking_no')),''),'-') tracking_no
   FROM jsonb_array_elements(p_rows) WITH ORDINALITY
 ), valid AS MATERIALIZED (
   SELECT *,coalesce(ref=ANY(v_refs) OR tracking_no=ANY(v_tracks),false) known
   FROM pairs WHERE ref ~ '^GB-[0-9]{8}-[0-9]{6}$'
 ), links AS MATERIALIZED (
   SELECT idx,min(idx) OVER(PARTITION BY ref) ref_root,
     CASE WHEN tracking_no IS NULL THEN idx ELSE min(idx) OVER(PARTITION BY tracking_no) END track_root
   FROM valid
 ), edges AS MATERIALIZED (
   SELECT idx a,ref_root b FROM links UNION SELECT ref_root,idx FROM links
   UNION SELECT idx,track_root FROM links UNION SELECT track_root,idx FROM links
 ), reach(start,node) AS (
   SELECT idx,idx FROM valid
   UNION
   SELECT r.start,e.b FROM reach r JOIN edges e ON e.a=r.node
 ), components AS (
   SELECT node idx,min(start) root FROM reach GROUP BY node
 ), classified AS (
   SELECT v.*,c.root,bool_or(known) OVER(PARTITION BY root) existing
   FROM valid v JOIN components c USING(idx)
 ) SELECT
   coalesce(jsonb_agg(jsonb_build_object('index',idx,'ref',ref,'tracking_no',tracking_no,
     'identities',(SELECT jsonb_agg(jsonb_build_object('ref',member.ref,'tracking_no',member.tracking_no) ORDER BY member.idx)
       FROM classified member WHERE member.root=classified.root)) ORDER BY idx)
     FILTER(WHERE NOT existing AND idx=root),'[]'),
   coalesce(jsonb_agg(jsonb_build_object('order_number',ref,'tracking_no',tracking_no) ORDER BY idx)
     FILTER(WHERE known),'[]'),
   count(*) FILTER(WHERE existing),count(*) FILTER(WHERE NOT existing AND idx<>root),
   jsonb_array_length(p_rows)-count(*)
 INTO v_candidates,v_existing_keys,v_existing,v_batch,v_invalid FROM classified;
 RETURN jsonb_build_object('candidates',v_candidates,'missing_candidates',jsonb_array_length(v_candidates),
   'existing_keys',v_existing_keys,'scanned',jsonb_array_length(p_rows),'skipped_existing',v_existing,'skipped_batch',v_batch,'skipped_invalid',v_invalid);
END $$;

CREATE OR REPLACE FUNCTION public.persist_missing_spx_orders(
 p_rows jsonb,p_channel_id bigint DEFAULT 1,p_initial_status text DEFAULT 'SIAP_KIRIM',p_source_profile_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_catalog AS $$
DECLARE
 v_user uuid:=auth.uid(); v_org bigint; v_current_org bigint; v_role text;
 v_keys jsonb; v_preview jsonb; v_candidate jsonb; r jsonb; it jsonb;
 d public.orders_draft%ROWTYPE; i public.order_items_draft%ROWTYPE;
 v_id bigint; v_ids jsonb:='[]'; v_ref text; v_track text;
BEGIN
 SELECT organization_id,role::text INTO v_org,v_role FROM public.profiles WHERE id=v_user AND active;
 IF v_org IS NULL OR v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Akses impor SPX ditolak' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Daftar SPX tidak valid' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 200 OR p_initial_status IS NULL OR p_initial_status NOT IN ('BARU','SIAP_KIRIM') THEN
   RAISE EXCEPTION 'Permintaan impor tidak valid' USING ERRCODE='22023'; END IF;
 -- Same lock as WA ingestion. A second import checks the committed result after waiting.
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-wa:'||v_org,0));
 SELECT organization_id,role::text INTO v_current_org,v_role FROM public.profiles WHERE id=v_user AND active FOR SHARE;
 IF v_current_org IS DISTINCT FROM v_org OR v_role NOT IN ('owner','admin') THEN
   RAISE EXCEPTION 'Akses berubah, muat ulang' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.courier_channels WHERE id=p_channel_id AND active) THEN
   RAISE EXCEPTION 'Ekspedisi tidak tersedia' USING ERRCODE='42501'; END IF;
 IF p_source_profile_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.converter_profiles WHERE id=p_source_profile_id AND active AND direction::text='INBOUND'
 ) THEN RAISE EXCEPTION 'Profil impor tidak tersedia' USING ERRCODE='42501'; END IF;
 SELECT jsonb_agg(jsonb_build_object('ref',value->>'external_order_id','tracking_no',value->>'tracking_no') ORDER BY ordinality)
 INTO v_keys FROM jsonb_array_elements(p_rows) WITH ORDINALITY;
 v_preview:=public.preview_missing_spx_orders(v_keys);
 FOR v_candidate IN SELECT value FROM jsonb_array_elements(v_preview->'candidates') LOOP
   r:=p_rows->(v_candidate->>'index')::int; it:=r->'_item';
   IF jsonb_typeof(it) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Item SPX wajib diisi' USING ERRCODE='22023'; END IF;
   d:=jsonb_populate_record(NULL::public.orders_draft,r-'_item');
   i:=jsonb_populate_record(NULL::public.order_items_draft,it);
   IF nullif(btrim(d.customer_name),'') IS NULL OR length(d.customer_name)>1000
      OR d.payment_method IS NULL OR d.payment_method NOT IN ('COD','TRANSFER')
      OR jsonb_typeof(r->'total') IS DISTINCT FROM 'number' OR d.total<0
      OR jsonb_typeof(r->'shipping_cost') IS DISTINCT FROM 'number' OR d.shipping_cost<0
      OR coalesce(d.cod_amount,0)<0 OR coalesce(d.subtotal,0)<0 OR coalesce(d.discount,0)<0
      OR jsonb_typeof(it->'qty') IS DISTINCT FROM 'number' OR i.qty NOT BETWEEN 1 AND 100000
      OR jsonb_typeof(it->'price') IS DISTINCT FROM 'number' OR i.price<0
      OR (i.weight_per_unit IS NOT NULL AND (jsonb_typeof(it->'weight_per_unit') IS DISTINCT FROM 'number' OR i.weight_per_unit<0))
      OR nullif(btrim(i.product_name_raw),'') IS NULL OR length(i.product_name_raw)>10000
      OR (r ? 'meta' AND jsonb_typeof(r->'meta') NOT IN ('object','null')) THEN
     RAISE EXCEPTION 'Isi order SPX tidak valid' USING ERRCODE='22023'; END IF;
   IF i.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products WHERE id=i.product_id AND organization_id=v_org AND active) THEN
     RAISE EXCEPTION 'Produk tidak tersedia' USING ERRCODE='42501'; END IF;
   v_ref:=v_candidate->>'ref'; v_track:=v_candidate->>'tracking_no';
   -- Restore the source GB identity and known tracking on this new draft only.
   -- A newly generated GB number would make the next status sync miss the source ref.
   INSERT INTO public.orders_draft(organization_id,order_number,external_order_id,tracking_no,resi,
     created_by,source_profile_id,channel_id,status,order_date,payment_method,
     customer_name,customer_phone,customer_province,customer_city,customer_subdistrict,customer_village,customer_zip,
     customer_address_detail,customer_address,subtotal,shipping_cost,discount,total,cod_amount,priority,
     meta,raw_data,attribution_code_raw,attribution_platform,attribution_account_code,attribution_campaign_marker,attribution_status)
   VALUES(v_org,v_ref,v_ref,v_track,v_track,v_user,p_source_profile_id,p_channel_id,p_initial_status,
     coalesce(d.order_date,(now() AT TIME ZONE 'Asia/Jakarta')::date),d.payment_method,
     d.customer_name,d.customer_phone,d.customer_province,d.customer_city,d.customer_subdistrict,d.customer_village,d.customer_zip,
     d.customer_address_detail,d.customer_address,coalesce(d.subtotal,0),d.shipping_cost,coalesce(d.discount,0),d.total,d.cod_amount,
     coalesce(d.priority,'NORMAL'),coalesce(nullif(d.meta,'null'::jsonb),'{}')||jsonb_build_object(
       'source','spx_status_missing_persist','spx_import_identities',v_candidate->'identities'),d.raw_data,
     d.attribution_code_raw,d.attribution_platform,d.attribution_account_code,d.attribution_campaign_marker,coalesce(d.attribution_status,'UNKNOWN'))
   RETURNING id INTO v_id;
   INSERT INTO public.order_items_draft(organization_id,order_id,product_id,product_name_raw,variation,qty,price,weight_per_unit)
   VALUES(v_org,v_id,i.product_id,i.product_name_raw,i.variation,i.qty,i.price,i.weight_per_unit);
   v_ids:=v_ids||jsonb_build_array(v_id);
 END LOOP;
 -- Preserve the former importer's geography enrichment, restricted to IDs
 -- created by this transaction. Retried/existing records are never resolved again.
 IF jsonb_array_length(v_ids)>0 THEN
   PERFORM public.resolve_draft_wilayah(v_org,ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(v_ids)));
 END IF;
 RETURN (v_preview-'candidates'-'existing_keys')||jsonb_build_object('inserted',jsonb_array_length(v_ids),'inserted_ids',v_ids,
   'skipped_duplicates',(v_preview->>'skipped_existing')::int+(v_preview->>'skipped_batch')::int);
END $$;
REVOKE ALL ON FUNCTION public.preview_missing_spx_orders(jsonb),public.persist_missing_spx_orders(jsonb,bigint,text,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.preview_missing_spx_orders(jsonb),public.persist_missing_spx_orders(jsonb,bigint,text,bigint) TO authenticated;
COMMIT;
