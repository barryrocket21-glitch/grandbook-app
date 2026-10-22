-- A10: create/link/ignore is one authenticated transaction. Existing rows stay intact.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.inbox_unmatched_resi
 ADD COLUMN IF NOT EXISTS resolved_to_draft_id bigint REFERENCES public.orders_draft(id),
 ADD COLUMN IF NOT EXISTS resolved_order_number text,
 ADD COLUMN IF NOT EXISTS resolution_note text,
 ADD COLUMN IF NOT EXISTS resolution_request_id uuid,
 ADD COLUMN IF NOT EXISTS resolution_payload_hash text,
 ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_inbox_resi_resolved_draft ON public.inbox_unmatched_resi(resolved_to_draft_id) WHERE resolved_to_draft_id IS NOT NULL;
DROP TRIGGER IF EXISTS inbox_resi_updated_at ON public.inbox_unmatched_resi;
CREATE TRIGGER inbox_resi_updated_at BEFORE UPDATE ON public.inbox_unmatched_resi
 FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- Normal importer inserts remain available. Only the reviewed RPC closes an inbox row.
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.inbox_unmatched_resi FROM PUBLIC,anon,authenticated;
ALTER POLICY inbox_unmatched_resi_org_policy ON public.inbox_unmatched_resi
 WITH CHECK (organization_id=public.current_org_id() AND resolved=false AND resolution IS NULL
 AND resolved_to_order_id IS NULL AND resolved_to_draft_id IS NULL AND resolved_order_number IS NULL
 AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_note IS NULL
 AND resolution_request_id IS NULL AND resolution_payload_hash IS NULL);

CREATE OR REPLACE FUNCTION public.search_unmatched_resi_orders(p_query text)
RETURNS TABLE(source text,id bigint,order_number text,external_order_id text,customer_name text,resi text,tracking_no text,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public,pg_catalog AS $$
DECLARE v_org bigint; q text:=lower(btrim(p_query)); BEGIN
 SELECT organization_id INTO v_org FROM public.profiles WHERE profiles.id=auth.uid() AND active AND role IN ('owner','admin');
 IF v_org IS NULL THEN RAISE EXCEPTION 'Akses inbox ditolak' USING ERRCODE='42501'; END IF;
 IF q IS NULL OR length(q) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'Isi pencarian 2–200 karakter' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH candidates AS (
  SELECT 'draft'::text src,d.id,d.order_number,d.external_order_id,d.customer_name,d.resi,d.tracking_no,d.updated_at,d.raw_data,d.meta
  FROM public.orders_draft d WHERE d.organization_id=v_org
  UNION ALL
  SELECT 'final',d.id,d.order_number,d.external_order_id,d.customer_name,d.resi,d.tracking_no,d.updated_at,d.raw_data,d.meta
  FROM public.orders d WHERE d.organization_id=v_org
 ) SELECT c.src,c.id,c.order_number,c.external_order_id,c.customer_name,c.resi,c.tracking_no,c.updated_at
 FROM candidates c WHERE EXISTS(SELECT 1 FROM unnest(ARRAY[c.order_number,c.external_order_id,c.customer_name,c.resi,c.tracking_no,c.raw_data->>'tracking_no',c.meta->>'spx_tracking_no']) value WHERE position(q IN lower(value))>0)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.meta->'spx_import_identities')='array' THEN c.meta->'spx_import_identities' ELSE '[]'::jsonb END) alias WHERE lower(alias->>'ref')=q OR lower(alias->>'tracking_no')=q)
 ORDER BY (q=ANY(ARRAY[lower(c.order_number),lower(c.external_order_id),lower(c.resi),lower(c.tracking_no)])) DESC NULLS LAST,c.updated_at DESC,c.src,c.id LIMIT 20;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_unmatched_resi(
 p_inbox_id bigint,p_request_id uuid,p_expected_updated_at timestamptz,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_catalog AS $$
DECLARE
 v_user uuid:=auth.uid();v_org bigint;v_current_org bigint;v_role text;v_hash text;v_resi text;v_ref text;v_number text;
 r public.inbox_unmatched_resi%ROWTYPE;d public.orders_draft%ROWTYPE;f public.orders%ROWTYPE;
 product public.products%ROWTYPE;variant public.product_variants%ROWTYPE;
 v_id bigint;v_source text;v_target bigint;v_version timestamptz;v_cs uuid;v_cs_name text;
 v_items jsonb;it jsonb;v_subtotal numeric:=0;v_shipping numeric;v_total numeric;v_actual_variant bigint;v_date date;
BEGIN
 SELECT organization_id,role::text INTO v_org,v_role FROM public.profiles WHERE id=v_user AND active;
 IF v_org IS NULL OR v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Akses inbox ditolak' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_inbox_id IS NULL OR p_expected_updated_at IS NULL OR p_action IS NULL OR p_action NOT IN ('create','link','ignore')
 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>100000 THEN RAISE EXCEPTION 'Permintaan inbox tidak valid' USING ERRCODE='22023'; END IF;
 v_hash:=md5(jsonb_build_object('action',p_action,'payload',p_payload,'version',p_expected_updated_at)::text);
 -- Shared with WA and SPX creation; source identity is checked after waiting.
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-wa:'||v_org,0));
 SELECT organization_id,role::text INTO v_current_org,v_role FROM public.profiles WHERE id=v_user AND active FOR SHARE;
 IF v_current_org IS DISTINCT FROM v_org OR v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Akses berubah' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.inbox_unmatched_resi WHERE id=p_inbox_id AND organization_id=v_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inbox tidak tersedia' USING ERRCODE='42501'; END IF;
 IF coalesce(r.resolved,false) THEN
  IF r.resolution_request_id=p_request_id AND r.resolved_by=v_user AND r.resolution_payload_hash=v_hash THEN
   RETURN jsonb_build_object('resolution',r.resolution,'source',CASE WHEN r.resolved_to_order_id IS NOT NULL THEN 'final' WHEN r.resolved_to_draft_id IS NOT NULL THEN 'draft' END,
    'orderId',coalesce(r.resolved_to_order_id,r.resolved_to_draft_id),'orderNumber',r.resolved_order_number,'replayed',true);
  END IF;
  RAISE EXCEPTION 'Inbox sudah diselesaikan. Muat ulang daftar.' USING ERRCODE='PT409';
 END IF;
 IF r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Data inbox berubah. Muat ulang daftar.' USING ERRCODE='PT409'; END IF;
 v_resi:=nullif(btrim(r.raw_resi),'');
 IF p_action<>'ignore' AND (v_resi IS NULL OR length(v_resi)>200 OR v_resi='-') THEN RAISE EXCEPTION 'Resi sumber tidak valid' USING ERRCODE='22023'; END IF;
 IF p_action='ignore' THEN
  IF nullif(btrim(p_payload->>'reason'),'') IS NULL OR length(p_payload->>'reason')>2000 THEN RAISE EXCEPTION 'Isi alasan pengabaian' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_action='link' THEN
   v_source:=p_payload->>'source';v_target:=(p_payload->>'orderId')::bigint;v_version:=(p_payload->>'updatedAt')::timestamptz;
   IF v_source IS NULL OR v_source NOT IN ('draft','final') OR v_target IS NULL OR v_version IS NULL THEN RAISE EXCEPTION 'Pilih order tujuan' USING ERRCODE='22023'; END IF;
   IF v_source='draft' THEN
    SELECT * INTO d FROM public.orders_draft WHERE id=v_target AND organization_id=v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak tersedia' USING ERRCODE='42501'; END IF;
    IF d.updated_at IS DISTINCT FROM v_version THEN RAISE EXCEPTION 'Order berubah. Cari dan pilih ulang.' USING ERRCODE='PT409'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.order_items_draft WHERE order_id=d.id AND organization_id=v_org) THEN RAISE EXCEPTION 'Order belum memiliki item' USING ERRCODE='22023'; END IF;
    v_number:=d.order_number;
   ELSE
    SELECT * INTO f FROM public.orders WHERE id=v_target AND organization_id=v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak tersedia' USING ERRCODE='42501'; END IF;
    IF f.updated_at IS DISTINCT FROM v_version THEN RAISE EXCEPTION 'Order berubah. Cari dan pilih ulang.' USING ERRCODE='PT409'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=f.id AND organization_id=v_org) THEN RAISE EXCEPTION 'Order belum memiliki item' USING ERRCODE='22023'; END IF;
    v_number:=f.order_number;
   END IF;
   IF EXISTS(SELECT 1 FROM unnest(CASE WHEN v_source='draft' THEN ARRAY[d.resi,d.tracking_no,d.raw_data->>'tracking_no',d.meta->>'spx_tracking_no'] ELSE ARRAY[f.resi,f.tracking_no,f.raw_data->>'tracking_no',f.meta->>'spx_tracking_no'] END) t
    WHERE nullif(nullif(btrim(t),''),'-') IS NOT NULL AND upper(btrim(t))<>upper(v_resi)) THEN RAISE EXCEPTION 'Order sudah memiliki resi berbeda. Periksa sumbernya.' USING ERRCODE='PT409'; END IF;
  ELSE
   v_ref:=nullif(btrim(p_payload->>'externalRef'),'');
   IF length(v_ref)>200 THEN RAISE EXCEPTION 'Referensi terlalu panjang' USING ERRCODE='22023'; END IF;
  END IF;
  -- Include historical retained SPX identities as well as primary tracking/ref columns.
  IF EXISTS(WITH existing AS (
   SELECT 'draft' src,id,order_number,external_order_id,resi,tracking_no,raw_data,meta FROM public.orders_draft WHERE organization_id=v_org
   UNION ALL SELECT 'final',id,order_number,external_order_id,resi,tracking_no,raw_data,meta FROM public.orders WHERE organization_id=v_org
  ) SELECT 1 FROM existing e WHERE (p_action='create' OR e.src<>v_source OR e.id<>v_target) AND (
   upper(v_resi)=ANY(ARRAY[upper(btrim(e.resi)),upper(btrim(e.tracking_no)),upper(btrim(e.raw_data->>'tracking_no')),upper(btrim(e.meta->>'spx_tracking_no'))])
   OR (v_ref IS NOT NULL AND upper(v_ref)=ANY(ARRAY[upper(btrim(e.order_number)),upper(btrim(e.external_order_id))]))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.meta->'spx_import_identities')='array' THEN e.meta->'spx_import_identities' ELSE '[]'::jsonb END) alias
    WHERE upper(btrim(alias->>'tracking_no'))=upper(v_resi) OR (v_ref IS NOT NULL AND upper(btrim(alias->>'ref'))=upper(v_ref)))))
  THEN RAISE EXCEPTION 'Resi atau referensi sudah ada di order lain. Cari order yang sesuai.' USING ERRCODE='PT409'; END IF;
  IF p_action='link' THEN
   IF v_source='draft' THEN
    UPDATE public.orders_draft SET resi=CASE WHEN nullif(nullif(btrim(resi),''),'-') IS NULL THEN v_resi ELSE resi END,
     tracking_no=CASE WHEN nullif(nullif(btrim(tracking_no),''),'-') IS NULL THEN v_resi ELSE tracking_no END WHERE id=v_target AND organization_id=v_org;
   ELSE
    UPDATE public.orders SET resi=CASE WHEN nullif(nullif(btrim(resi),''),'-') IS NULL THEN v_resi ELSE resi END,
     tracking_no=CASE WHEN nullif(nullif(btrim(tracking_no),''),'-') IS NULL THEN v_resi ELSE tracking_no END WHERE id=v_target AND organization_id=v_org;
   END IF;
   v_id:=v_target;
  ELSE
   IF jsonb_typeof(p_payload->'customerName') IS DISTINCT FROM 'string' OR nullif(btrim(p_payload->>'customerName'),'') IS NULL OR length(p_payload->>'customerName')>1000
    OR jsonb_typeof(p_payload->'address') IS DISTINCT FROM 'string' OR nullif(btrim(p_payload->>'address'),'') IS NULL OR length(p_payload->>'address')>10000
    OR p_payload->>'paymentMethod' IS NULL OR p_payload->>'paymentMethod' NOT IN ('COD','TRANSFER')
    OR jsonb_typeof(p_payload->'shippingCost') IS DISTINCT FROM 'number' OR (p_payload->>'shippingCost')::numeric NOT BETWEEN 0 AND 999999999
    OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lengkapi data order dan item' USING ERRCODE='22023'; END IF;
   IF length(p_payload->>'phone')>100 OR length(p_payload->>'attributionCode')>1000 THEN RAISE EXCEPTION 'Data order terlalu panjang' USING ERRCODE='22023'; END IF;
   v_items:=p_payload->'items';v_shipping:=(p_payload->>'shippingCost')::numeric;v_date:=(p_payload->>'orderDate')::date;
   IF v_date IS NULL OR jsonb_array_length(v_items) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Tanggal dan 1–20 item wajib diisi' USING ERRCODE='22023'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.courier_channels WHERE id=(p_payload->>'channelId')::bigint AND active) THEN RAISE EXCEPTION 'Ekspedisi tidak tersedia' USING ERRCODE='42501'; END IF;
   v_cs:=nullif(p_payload->>'csId','')::uuid;
   IF v_cs IS NOT NULL THEN
    SELECT full_name INTO v_cs_name FROM public.profiles WHERE id=v_cs AND organization_id=v_org AND active AND role IN ('owner','admin','cs');
    IF NOT FOUND THEN RAISE EXCEPTION 'CS tidak tersedia' USING ERRCODE='42501'; END IF;
   END IF;
   FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    IF jsonb_typeof(it) IS DISTINCT FROM 'object' OR jsonb_typeof(it->'qty') IS DISTINCT FROM 'number' OR (it->>'qty')::numeric<>trunc((it->>'qty')::numeric)
     OR (it->>'qty')::numeric NOT BETWEEN 1 AND 100000 OR jsonb_typeof(it->'price') IS DISTINCT FROM 'number' OR (it->>'price')::numeric NOT BETWEEN 0 AND 999999999 THEN RAISE EXCEPTION 'Jumlah atau harga item tidak valid' USING ERRCODE='22023'; END IF;
    SELECT * INTO product FROM public.products WHERE id=(it->>'productId')::bigint AND organization_id=v_org AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak tersedia' USING ERRCODE='42501'; END IF;
    IF nullif(it->>'variantId','') IS NOT NULL THEN
     PERFORM 1 FROM public.product_variants WHERE id=(it->>'variantId')::bigint AND product_id=product.id AND organization_id=v_org AND active FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak tersedia' USING ERRCODE='42501'; END IF;
    ELSIF product.has_variants THEN RAISE EXCEPTION 'Pilih varian produk' USING ERRCODE='22023'; END IF;
    v_subtotal:=v_subtotal+(it->>'qty')::numeric*(it->>'price')::numeric;
   END LOOP;
   v_total:=v_subtotal+v_shipping;
   IF v_total>=1000000000 THEN RAISE EXCEPTION 'Total order terlalu besar' USING ERRCODE='22023'; END IF;
   v_number:=CASE WHEN upper(v_ref) ~ '^GB-[0-9]{8}-[0-9]{6}$' THEN upper(v_ref) ELSE public.generate_order_number(v_org) END;
   INSERT INTO public.orders_draft(organization_id,order_number,external_order_id,order_date,created_by,source_profile_id,channel_id,status,
    resi,tracking_no,customer_name,customer_phone,customer_address,customer_address_detail,payment_method,subtotal,shipping_cost,total,cod_amount,
    cs_id,cs_name,attribution_code_raw,attribution_status,raw_data,meta)
   VALUES(v_org,v_number,v_ref,v_date,v_user,r.source_profile_id,(p_payload->>'channelId')::bigint,'BARU',v_resi,v_resi,
    btrim(p_payload->>'customerName'),nullif(btrim(p_payload->>'phone'),''),btrim(p_payload->>'address'),btrim(p_payload->>'address'),p_payload->>'paymentMethod',
    v_subtotal,v_shipping,v_total,CASE WHEN p_payload->>'paymentMethod'='COD' THEN v_total ELSE 0 END,v_cs,v_cs_name,
    nullif(btrim(p_payload->>'attributionCode'),''),'PENDING',r.raw_data,jsonb_build_object('created_from_inbox_resi',r.id)) RETURNING id INTO v_id;
   FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    SELECT * INTO product FROM public.products WHERE id=(it->>'productId')::bigint AND organization_id=v_org;
    variant:=NULL;
    IF nullif(it->>'variantId','') IS NOT NULL THEN SELECT * INTO variant FROM public.product_variants WHERE id=(it->>'variantId')::bigint AND product_id=product.id AND organization_id=v_org; END IF;
    INSERT INTO public.order_items_draft(organization_id,order_id,product_id,variant_id,product_name_raw,variation,qty,price,weight_per_unit)
    VALUES(v_org,v_id,product.id,variant.id,product.name,coalesce(variant.variation_code,variant.variant_name),
     (it->>'qty')::int,(it->>'price')::numeric,coalesce(variant.weight_grams/1000.0,product.weight_kg,0)) RETURNING variant_id INTO v_actual_variant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item belum tersimpan' USING ERRCODE='PT409'; END IF;
    IF v_actual_variant IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.product_variants WHERE id=v_actual_variant AND product_id=product.id AND organization_id=v_org AND active) THEN
     RAISE EXCEPTION 'Varian hasil penyimpanan tidak tersedia' USING ERRCODE='42501'; END IF;
   END LOOP;
   v_source:='draft';
  END IF;
 END IF;
 UPDATE public.inbox_unmatched_resi SET resolved=true,resolution=CASE p_action WHEN 'create' THEN 'created_new' WHEN 'link' THEN 'linked' ELSE 'ignored' END,
  resolved_to_order_id=CASE WHEN v_source='final' THEN v_id END,resolved_to_draft_id=CASE WHEN v_source='draft' THEN v_id END,
  resolved_order_number=v_number,resolved_at=now(),resolved_by=v_user,resolution_note=CASE WHEN p_action='ignore' THEN btrim(p_payload->>'reason') END,
  resolution_request_id=p_request_id,resolution_payload_hash=v_hash WHERE id=r.id;
 RETURN jsonb_build_object('resolution',CASE p_action WHEN 'create' THEN 'created_new' WHEN 'link' THEN 'linked' ELSE 'ignored' END,
  'source',v_source,'orderId',v_id,'orderNumber',v_number,'replayed',false);
END $$;

-- Terminal SPX promotion creates the final order before deleting its draft.
-- Move the inbox reference in that same transaction; unrelated deletion stays FK-protected.
CREATE OR REPLACE FUNCTION public.follow_inbox_resi_promotion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_catalog AS $$
DECLARE v_final bigint; BEGIN
 IF EXISTS(SELECT 1 FROM public.inbox_unmatched_resi WHERE resolved_to_draft_id=OLD.id) THEN
  SELECT id INTO v_final FROM public.orders WHERE organization_id=OLD.organization_id AND order_number=OLD.order_number;
  IF v_final IS NOT NULL AND EXISTS(SELECT 1 FROM public.order_items WHERE order_id=v_final AND organization_id=OLD.organization_id) THEN
   UPDATE public.inbox_unmatched_resi SET resolved_to_order_id=v_final,resolved_to_draft_id=NULL
    WHERE resolved_to_draft_id=OLD.id AND organization_id=OLD.organization_id;
  END IF;
 END IF;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS follow_inbox_resi_promotion ON public.orders_draft;
CREATE TRIGGER follow_inbox_resi_promotion BEFORE DELETE ON public.orders_draft FOR EACH ROW EXECUTE FUNCTION public.follow_inbox_resi_promotion();
REVOKE ALL ON FUNCTION public.search_unmatched_resi_orders(text),public.resolve_unmatched_resi(bigint,uuid,timestamptz,text,jsonb),public.follow_inbox_resi_promotion() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.search_unmatched_resi_orders(text),public.resolve_unmatched_resi(bigint,uuid,timestamptz,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
