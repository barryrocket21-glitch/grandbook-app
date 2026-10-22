-- One request = one transaction; a repeat of the same request returns its original IDs.
-- No uniqueness rule on phone/name: legitimate repeat purchases remain separate.
BEGIN;
CREATE TABLE IF NOT EXISTS public.wa_submission_receipts (
 organization_id bigint NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL REFERENCES public.profiles(id),
 request_id uuid NOT NULL,
 payload_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,user_id,request_id)
);
ALTER TABLE public.wa_submission_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_submission_receipts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.submit_wa_orders(p_request_id uuid,p_orders jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_catalog AS $$
DECLARE
 v_user uuid:=auth.uid(); v_org bigint; v_role text; v_hash text;
 v_receipt public.wa_submission_receipts%ROWTYPE;
 v_entry jsonb; v_payload jsonb; v_item jsonb;
 d public.orders_draft%ROWTYPE; i public.order_items_draft%ROWTYPE;
 v_ids jsonb:='[]'; v_id bigint; v_result jsonb; v_cs_name text;
BEGIN
 SELECT organization_id,role::text INTO v_org,v_role FROM public.profiles WHERE id=v_user AND active=true;
 IF v_org IS NULL OR v_role NOT IN ('owner','admin','cs') THEN RAISE EXCEPTION 'Akses operasional tidak diizinkan' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_orders) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Permintaan tidak valid' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_orders) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Jumlah order tidak valid' USING ERRCODE='22023'; END IF;
 v_hash:=md5(p_orders::text);
 -- Serialize this ingestion path per organization, including number generation.
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-wa:'||v_org,0));
 SELECT * INTO v_receipt FROM public.wa_submission_receipts WHERE organization_id=v_org AND user_id=v_user AND request_id=p_request_id;
 IF FOUND THEN
   IF v_receipt.payload_hash<>v_hash THEN RAISE EXCEPTION 'Permintaan ini sudah digunakan untuk data berbeda' USING ERRCODE='22023'; END IF;
   RETURN v_receipt.result;
 END IF;
 FOR v_entry IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
   v_payload:=v_entry->'payload';v_item:=v_payload->'_item';
   IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Payload order tidak lengkap' USING ERRCODE='22023'; END IF;
   -- Typed conversion does not authorize extra fields; INSERT below explicitly whitelists columns.
   d:=jsonb_populate_record(NULL::public.orders_draft,v_payload - '_item');
   i:=jsonb_populate_record(NULL::public.order_items_draft,v_item);
   IF jsonb_typeof(v_payload->'total') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_item->'price') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_item->'weight_per_unit') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_item->'qty') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_payload->'shipping_cost') NOT IN ('number','null')
      OR jsonb_typeof(v_payload->'cod_amount') NOT IN ('number','null')
      OR nullif(trim(d.customer_name),'') IS NULL OR length(d.customer_name)>1000
      OR d.status::text NOT IN ('BARU','SIAP_KIRIM') OR d.status IS NULL
      OR d.payment_method::text NOT IN ('COD','TRANSFER') OR d.payment_method IS NULL
      OR i.qty IS NULL OR i.qty NOT BETWEEN 1 AND 100000 OR i.price IS NULL OR i.price<0 OR i.weight_per_unit IS NULL OR i.weight_per_unit<0
      OR d.total IS NULL OR d.total<0 OR coalesce(d.cod_amount,0)<0 OR coalesce(d.shipping_cost,0)<0
      OR i.product_name_raw IS NULL THEN RAISE EXCEPTION 'Data order tidak valid' USING ERRCODE='22023'; END IF;
   SELECT full_name INTO v_cs_name FROM public.profiles WHERE id=d.cs_id AND organization_id=v_org AND active AND role::text IN ('owner','admin','cs');
   IF NOT FOUND THEN RAISE EXCEPTION 'CS tidak tersedia' USING ERRCODE='42501'; END IF;
   IF i.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products WHERE id=i.product_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Produk tidak tersedia' USING ERRCODE='42501'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.courier_channels WHERE id=d.channel_id AND active) THEN RAISE EXCEPTION 'Ekspedisi tidak tersedia' USING ERRCODE='42501'; END IF;
   INSERT INTO public.orders_draft(organization_id,order_number,order_date,created_by,channel_id,status,
     customer_name,customer_phone,customer_address,customer_address_detail,customer_village,customer_subdistrict,customer_city,customer_province,customer_zip,
     payment_method,cod_amount,total,shipping_cost,cs_id,cs_name,customer_note,
     attribution_code_raw,attribution_platform,attribution_account_code,attribution_campaign_marker,attribution_status,meta)
   VALUES(v_org,public.generate_order_number(v_org),(now() AT TIME ZONE 'Asia/Jakarta')::date,v_user,d.channel_id,d.status,
     d.customer_name,d.customer_phone,d.customer_address_detail,d.customer_address_detail,d.customer_village,d.customer_subdistrict,d.customer_city,d.customer_province,d.customer_zip,
     d.payment_method,d.cod_amount,d.total,coalesce(d.shipping_cost,0),d.cs_id,v_cs_name,d.customer_note,
     d.attribution_code_raw,d.attribution_platform,d.attribution_account_code,d.attribution_campaign_marker,coalesce(d.attribution_status,'PENDING'),d.meta)
   RETURNING id INTO v_id;
   INSERT INTO public.order_items_draft(organization_id,order_id,product_id,product_name_raw,variation,qty,price,weight_per_unit)
   VALUES(v_org,v_id,i.product_id,i.product_name_raw,i.variation,i.qty,i.price,i.weight_per_unit);
   v_ids:=v_ids||jsonb_build_array(v_id);
 END LOOP;
 v_result:=jsonb_build_object('inserted',jsonb_array_length(v_ids),'failed',0,'insertedOrderIds',v_ids,'errors','[]'::jsonb);
 INSERT INTO public.wa_submission_receipts(organization_id,user_id,request_id,payload_hash,result) VALUES(v_org,v_user,p_request_id,v_hash,v_result);
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_wa_orders(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_wa_orders(uuid,jsonb) TO authenticated;
COMMIT;
