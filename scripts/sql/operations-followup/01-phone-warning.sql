-- Warning only: legitimate repeat purchases remain possible after acknowledgement.
BEGIN;
CREATE OR REPLACE FUNCTION public.operations_phone_key(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT regexp_replace(regexp_replace(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'^62',''),'^0+','');
$$;
REVOKE ALL ON FUNCTION public.operations_phone_key(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operations_phone_key(text) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_draft_phone_day_warning ON public.orders_draft(organization_id,created_at,public.operations_phone_key(customer_phone));
CREATE INDEX IF NOT EXISTS idx_orders_phone_day_warning ON public.orders(organization_id,created_at,public.operations_phone_key(customer_phone));

CREATE OR REPLACE FUNCTION public.operations_existing_phones_today(p_phones text[])
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_org bigint; v_start timestamptz := date_trunc('day',now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'; v_result text[];
BEGIN
 SELECT organization_id INTO v_org FROM public.profiles WHERE id=auth.uid() AND active AND role::text IN ('owner','admin','cs');
 IF v_org IS NULL THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_phones),0)>1000 THEN RAISE EXCEPTION 'Terlalu banyak nomor' USING ERRCODE='22023'; END IF;
 WITH requested AS MATERIALIZED (
   SELECT DISTINCT public.operations_phone_key(p) AS phone FROM unnest(p_phones) p WHERE length(p)<=40
 ), existing AS (
   SELECT public.operations_phone_key(o.customer_phone) phone FROM public.orders_draft o
   WHERE o.organization_id=v_org AND o.created_at>=v_start AND o.created_at<v_start+interval '1 day'
   UNION ALL
   SELECT public.operations_phone_key(o.customer_phone) FROM public.orders o
   WHERE o.organization_id=v_org AND o.created_at>=v_start AND o.created_at<v_start+interval '1 day'
 ) SELECT coalesce(array_agg(DISTINCT r.phone ORDER BY r.phone),'{}') INTO v_result
 FROM requested r JOIN existing e USING(phone) WHERE r.phone<>'';
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.operations_existing_phones_today(text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operations_existing_phones_today(text[]) TO authenticated;

-- Preserve the tested atomic implementation exactly; only the guarded entry points are public.
DO $$ BEGIN
 IF to_regprocedure('public.submit_wa_orders_core(uuid,jsonb)') IS NULL THEN
   EXECUTE replace(pg_get_functiondef('public.submit_wa_orders(uuid,jsonb)'::regprocedure),
     'FUNCTION public.submit_wa_orders(', 'FUNCTION public.submit_wa_orders_core(');
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.submit_wa_orders_core(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.submit_wa_orders_checked(p_request_id uuid,p_orders jsonb,p_confirm_duplicate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_org bigint; v_phones text[]; v_existing text[]; v_duplicates text[];
BEGIN
 SELECT organization_id INTO v_org FROM public.profiles WHERE id=auth.uid() AND active AND role::text IN ('owner','admin','cs');
 IF v_org IS NULL THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_orders) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Permintaan tidak valid' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_orders) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Jumlah order tidak valid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-wa:'||v_org,0));
 -- A lost response must replay its receipt even when today's phone now exists.
 IF EXISTS(SELECT 1 FROM public.wa_submission_receipts WHERE organization_id=v_org AND user_id=auth.uid() AND request_id=p_request_id) THEN
   RETURN public.submit_wa_orders_core(p_request_id,p_orders);
 END IF;
 IF p_confirm_duplicate IS NOT TRUE THEN
   SELECT array_agg(public.operations_phone_key(value->'payload'->>'customer_phone')) INTO v_phones FROM jsonb_array_elements(p_orders);
   v_existing:=public.operations_existing_phones_today(v_phones);
   SELECT array_agg(phone ORDER BY phone) INTO v_duplicates FROM (
     SELECT phone FROM unnest(v_phones) phone WHERE phone<>'' GROUP BY phone HAVING count(*)>1
     UNION SELECT unnest(v_existing)
   ) d;
   IF cardinality(v_duplicates)>0 THEN
     RETURN jsonb_build_object('code','PHONE_DUPLICATE_TODAY','phones',v_duplicates,'day',(now() AT TIME ZONE 'Asia/Jakarta')::date);
   END IF;
 END IF;
 RETURN public.submit_wa_orders_core(p_request_id,p_orders);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_wa_orders_checked(uuid,jsonb,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.submit_wa_orders_checked(uuid,jsonb,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.submit_wa_orders(p_request_id uuid,p_orders jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 -- Keep the previously deployed client compatible during coordinated rollout.
 SELECT public.submit_wa_orders_core(p_request_id,p_orders);
$$;
REVOKE ALL ON FUNCTION public.submit_wa_orders(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.submit_wa_orders(uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
