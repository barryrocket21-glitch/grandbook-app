-- CANDIDATE ONLY: separate decimal statement evidence; no production application.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.spx_settlement_costs (
 organization_id bigint NOT NULL REFERENCES public.organizations(id),
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 160),
 order_number text NOT NULL CHECK(length(order_number) BETWEEN 1 AND 100),
 tracking text NOT NULL CHECK(length(tracking) BETWEEN 1 AND 100),
 basic_shipping numeric NOT NULL CHECK(basic_shipping>=0),
 cod_service numeric NOT NULL CHECK(cod_service>=0),
 total_fee numeric NOT NULL CHECK(total_fee>0 AND total_fee<=1000000000000),
 balance_before numeric NOT NULL, balance_after numeric NOT NULL,
 transaction_at timestamptz NOT NULL, source_cutoff timestamptz NOT NULL,
 recorded_by uuid NOT NULL REFERENCES public.profiles(id),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,external_id),
 UNIQUE(organization_id,tracking), UNIQUE(organization_id,order_number),
 CHECK(basic_shipping+cod_service=total_fee),
 settlement_sn text NOT NULL CHECK(length(settlement_sn) BETWEEN 1 AND 160),
 nominal numeric NOT NULL CHECK(nominal<0),
 statement_details jsonb NOT NULL CHECK(jsonb_typeof(statement_details)='object'),
 statement_sha256 text NOT NULL CHECK(statement_sha256 ~ '^[0-9a-f]{64}$'),
 UNIQUE(organization_id,settlement_sn),
 CHECK(transaction_at<=source_cutoff)
);
ALTER TABLE public.spx_settlement_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spx_settlement_costs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.spx_settlement_costs TO authenticated;
DO $policy$ BEGIN
CREATE POLICY finance_read ON public.spx_settlement_costs FOR SELECT TO authenticated USING
 (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.active
 AND p.organization_id=spx_settlement_costs.organization_id AND p.role::text IN('owner','admin','akunting')));
EXCEPTION WHEN duplicate_object THEN NULL; END $policy$;

CREATE OR REPLACE FUNCTION public.record_spx_settlement_costs(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog
SET lock_timeout='3s' SET statement_timeout='30s' SET jit=off AS $$
DECLARE org bigint; actor uuid:=auth.uid(); r jsonb; e public.spx_settlement_costs%ROWTYPE;
 matches jsonb; canonical jsonb; n integer:=0; repeats integer:=0; k text;
 basic numeric; cod numeric; total numeric; bb numeric; ba numeric; at_time timestamptz; cutoff timestamptz;
BEGIN
 SELECT organization_id INTO org FROM public.profiles WHERE id=actor AND active AND role::text='owner' FOR SHARE;
 IF org IS NULL THEN RAISE EXCEPTION 'Owner access required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Expected 1–150 reviewed charges' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x GROUP BY x->>'external_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Repeated transaction' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-wa:'||org,0));
 LOCK TABLE public.orders,public.orders_draft IN SHARE ROW EXCLUSIVE MODE;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r->>'status' IS DISTINCT FROM '3' OR r->>'seller_tran_type' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Successful shipping charge required' USING ERRCODE='22023';END IF;
  FOREACH k IN ARRAY ARRAY['external_id','order_number','tracking'] LOOP
   IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR coalesce(r->>k,'')='' OR r->>k IS DISTINCT FROM btrim(r->>k) THEN RAISE EXCEPTION 'Missing identity' USING ERRCODE='22023';END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['basic_shipping','cod_service','total_fee','balance_before','balance_after'] LOOP
   IF coalesce(r->>k,'') !~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Exact finite money required' USING ERRCODE='22023';END IF;
  END LOOP;
  basic:=(r->>'basic_shipping')::numeric;cod:=(r->>'cod_service')::numeric;total:=(r->>'total_fee')::numeric;bb:=(r->>'balance_before')::numeric;ba:=(r->>'balance_after')::numeric;
  IF basic<0 OR cod<0 OR total<=0 OR total>1000000000000 OR basic+cod<>total OR coalesce(r->>'nominal','') !~ '^-[0-9]+([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Charge evidence disagrees' USING ERRCODE='22023';END IF;
  PERFORM public.validate_spx_settlement_details(r->'statement_details',basic,cod,total);
  IF jsonb_typeof(r->'settlement_sn') IS DISTINCT FROM 'string' OR coalesce(r->>'settlement_sn','')='' OR r->>'settlement_sn'<>btrim(r->>'settlement_sn') OR coalesce(r->>'statement_sha256','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Statement identity and digest required' USING ERRCODE='22023';END IF;
  IF coalesce(r->>'transaction_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' OR coalesce(r->>'source_cutoff','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Explicit timezone required' USING ERRCODE='22023';END IF;
  at_time:=(r->>'transaction_at')::timestamptz;cutoff:=(r->>'source_cutoff')::timestamptz;
  IF at_time<'2000-01-01Z'::timestamptz OR at_time>cutoff OR cutoff>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid source cutoff' USING ERRCODE='22023';END IF;
  SELECT * INTO e FROM public.spx_settlement_costs WHERE organization_id=org AND external_id=r->>'external_id';
  IF FOUND THEN
   IF (e.order_number,e.tracking,e.basic_shipping,e.cod_service,e.total_fee,e.balance_before,e.balance_after,e.transaction_at,e.settlement_sn,e.nominal,e.statement_details,e.statement_sha256)
    IS DISTINCT FROM (r->>'order_number',r->>'tracking',basic,cod,total,bb,ba,at_time,r->>'settlement_sn',(r->>'nominal')::numeric,r->'statement_details',r->>'statement_sha256') THEN RAISE EXCEPTION 'Conflicting replay' USING ERRCODE='PT409';END IF;
   repeats:=repeats+1;CONTINUE;
  END IF;
  SELECT jsonb_agg(to_jsonb(o)) INTO matches FROM (
   SELECT 'orders' kind,id,order_number,resi,tracking_no,updated_at FROM orders WHERE organization_id=org AND (order_number=r->>'order_number' OR resi=r->>'tracking' OR tracking_no=r->>'tracking')
   UNION ALL SELECT 'orders_draft',id,order_number,resi,tracking_no,updated_at FROM orders_draft WHERE organization_id=org AND (order_number=r->>'order_number' OR resi=r->>'tracking' OR tracking_no=r->>'tracking')
  ) o;
  IF coalesce(jsonb_array_length(matches),0)<>1 THEN RAISE EXCEPTION 'Ambiguous current identity' USING ERRCODE='PT409';END IF;
  canonical:=matches->0;
  IF canonical->>'order_number' IS DISTINCT FROM r->>'order_number' OR
   NOT(coalesce(canonical->>'resi','')=r->>'tracking' OR coalesce(canonical->>'tracking_no','')=r->>'tracking') OR
   canonical->>'kind' IS DISTINCT FROM r->>'target_table' OR canonical->>'id' IS DISTINCT FROM r->>'target_id' OR
   (canonical->>'updated_at')::timestamptz IS DISTINCT FROM (r->>'expected_updated_at')::timestamptz THEN
   RAISE EXCEPTION 'Order changed; preview again' USING ERRCODE='PT409';END IF;
  INSERT INTO public.spx_settlement_costs VALUES(org,r->>'external_id',r->>'order_number',r->>'tracking',basic,cod,total,bb,ba,at_time,cutoff,actor,now(),r->>'settlement_sn',(r->>'nominal')::numeric,r->'statement_details',r->>'statement_sha256');
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('recorded',n,'replayed',repeats);
END $$;
REVOKE ALL ON FUNCTION public.record_spx_settlement_costs(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_spx_settlement_costs(jsonb) TO authenticated;


CREATE OR REPLACE FUNCTION public.validate_spx_settlement_details(a jsonb,basic numeric,cod numeric,total numeric)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE k text; v numeric;
BEGIN
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Statement required' USING ERRCODE='22023';END IF;
 FOR k IN SELECT jsonb_object_keys(a) LOOP
  IF NOT k=ANY(ARRAY['basic_shipping_fee','origin_basic_shipping_fee','cod_service_fee','additional_service_fee','actual_shipping_fee','remote_area_fee','fuel_fee','pickup_service_fee','insurance_fee','try_on_fee','partial_delivery_fee','co_check_fee','total_discount','discount_amount','coin_discount','voucher_discount_value','differences_in_shipping_fee','estimated_shipping_fee','address_adjustment_info']) THEN RAISE EXCEPTION 'Unknown statement component' USING ERRCODE='22023';END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['basic_shipping_fee','origin_basic_shipping_fee','cod_service_fee','additional_service_fee','actual_shipping_fee','remote_area_fee','fuel_fee','pickup_service_fee','insurance_fee','try_on_fee','partial_delivery_fee','co_check_fee','total_discount','discount_amount','coin_discount'] LOOP
  IF coalesce(a->>k,'') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Explicit statement money required' USING ERRCODE='22023';END IF;
  v:=(a->>k)::numeric;
  IF v IS DISTINCT FROM (CASE WHEN k IN('basic_shipping_fee','origin_basic_shipping_fee') THEN basic WHEN k IN('cod_service_fee','additional_service_fee') THEN cod WHEN k='actual_shipping_fee' THEN total ELSE 0 END) THEN RAISE EXCEPTION 'Unaccounted statement component' USING ERRCODE='22023';END IF;
 END LOOP;
 IF a->'address_adjustment_info' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Address adjustment requires review' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['voucher_discount_value','differences_in_shipping_fee','estimated_shipping_fee'] LOOP
  IF a->>k IS NULL THEN RAISE EXCEPTION 'Missing optional statement field' USING ERRCODE='22023';END IF;
  IF a->>k<>'' THEN
   IF a->>k !~ '^[0-9]+([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Invalid optional money' USING ERRCODE='22023';END IF;
   IF k<>'estimated_shipping_fee' AND (a->>k)::numeric<>0 THEN RAISE EXCEPTION 'Unaccounted adjustment' USING ERRCODE='22023';END IF;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.validate_spx_settlement_details(jsonb,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;

-- Both modes share the same transaction lock and reject cross-mode duplicates.
CREATE OR REPLACE FUNCTION public.guard_spx_cost_evidence_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE conflicting boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-wa:'||NEW.organization_id,0));
 IF TG_TABLE_NAME='spx_actual_costs' THEN
  SELECT EXISTS(SELECT 1 FROM spx_settlement_costs c WHERE c.organization_id=NEW.organization_id AND
   (c.external_id=NEW.external_id OR c.order_number=NEW.order_number OR c.tracking=NEW.tracking)) INTO conflicting;
 ELSE
  SELECT EXISTS(SELECT 1 FROM spx_actual_costs c WHERE c.organization_id=NEW.organization_id AND
   (c.external_id=NEW.external_id OR c.order_number=NEW.order_number OR c.tracking=NEW.tracking)) INTO conflicting;
 END IF;
 IF conflicting THEN RAISE EXCEPTION 'Cost evidence already exists in another mode' USING ERRCODE='PT409';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_spx_cost_evidence_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE TRIGGER spx_cost_identity_guard BEFORE INSERT OR UPDATE ON public.spx_actual_costs
 FOR EACH ROW EXECUTE FUNCTION public.guard_spx_cost_evidence_identity();
CREATE OR REPLACE TRIGGER spx_cost_identity_guard BEFORE INSERT OR UPDATE ON public.spx_settlement_costs
 FOR EACH ROW EXECUTE FUNCTION public.guard_spx_cost_evidence_identity();

-- Successor reader keeps the old seven-column RPC unchanged for existing clients.
CREATE OR REPLACE FUNCTION public.order_shipping_cost_evidence(p_order_numbers text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog SET jit=off AS $$
DECLARE org bigint; r record; e public.spx_settlement_costs%ROWTYPE; result jsonb:='[]'; hits integer; matching integer;
BEGIN
 SELECT organization_id INTO org FROM profiles WHERE id=auth.uid() AND active AND role::text IN('owner','admin','akunting');
 IF org IS NULL THEN RAISE EXCEPTION 'Finance access required' USING ERRCODE='42501';END IF;
 FOR r IN SELECT * FROM public.order_shipping_cost_basis(p_order_numbers) LOOP
  SELECT * INTO e FROM spx_settlement_costs c WHERE c.organization_id=org AND c.order_number=r.order_number;
  IF FOUND THEN
   SELECT count(*),count(*) FILTER(WHERE x.order_number=e.order_number) INTO hits,matching FROM (
    SELECT d.order_number FROM orders d WHERE d.organization_id=org AND (d.resi=e.tracking OR d.tracking_no=e.tracking)
    UNION ALL SELECT d.order_number FROM orders_draft d WHERE d.organization_id=org AND (d.resi=e.tracking OR d.tracking_no=e.tracking)
   ) x;
   IF hits<>1 OR matching<>1 THEN RAISE EXCEPTION 'Settlement identity changed' USING ERRCODE='PT409';END IF;
   result:=result||jsonb_build_array(jsonb_build_object('order_number',e.order_number,'basis','VERIFIED_SETTLEMENT',
    'shipping',e.basic_shipping::text,'cod',e.cod_service::text,'ppn',NULL,'total',e.total_fee::text,
    'external_id',e.external_id,'settlement_sn',e.settlement_sn,'nominal',e.nominal::text,
    'balance_before',e.balance_before::text,'balance_after',e.balance_after::text,
    'actual_minus_nominal_debit',(e.total_fee+e.nominal)::text,
    'actual_minus_balance_debit',(e.total_fee-e.balance_before+e.balance_after)::text,
    'cash_reconciled',false));
  ELSE
   result:=result||jsonb_build_array(to_jsonb(r)||jsonb_build_object('settlement_sn',NULL,
    'nominal',NULL,'balance_before',NULL,'balance_after',NULL,
    'actual_minus_nominal_debit',NULL,'actual_minus_balance_debit',NULL,'cash_reconciled',false));
  END IF;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.order_shipping_cost_evidence(text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.order_shipping_cost_evidence(text[]) TO authenticated;

COMMIT;
