-- CANDIDATE: verified charge evidence is separate from legacy estimated costs.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.spx_actual_costs (
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
 CHECK(balance_before-balance_after=total_fee),
 CHECK(transaction_at<=source_cutoff)
);
ALTER TABLE public.spx_actual_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spx_actual_costs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.spx_actual_costs TO authenticated;
DO $policy$ BEGIN
CREATE POLICY finance_read ON public.spx_actual_costs FOR SELECT TO authenticated USING
 (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.active
 AND p.organization_id=spx_actual_costs.organization_id AND p.role::text IN('owner','admin','akunting')));
EXCEPTION WHEN duplicate_object THEN NULL; END $policy$;

CREATE OR REPLACE FUNCTION public.record_spx_actual_costs(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog
SET lock_timeout='3s' SET statement_timeout='30s' SET jit=off AS $$
DECLARE org bigint; actor uuid:=auth.uid(); r jsonb; e public.spx_actual_costs%ROWTYPE;
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
  IF basic<0 OR cod<0 OR total<=0 OR total>1000000000000 OR basic+cod<>total OR bb-ba<>total OR coalesce(r->>'nominal','') !~ '^-[0-9]+([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Charge evidence disagrees' USING ERRCODE='22023';END IF;
  IF -(r->>'nominal')::numeric<>total THEN RAISE EXCEPTION 'Nominal disagrees' USING ERRCODE='22023';END IF;
  IF coalesce(r->>'transaction_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' OR coalesce(r->>'source_cutoff','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Explicit timezone required' USING ERRCODE='22023';END IF;
  at_time:=(r->>'transaction_at')::timestamptz;cutoff:=(r->>'source_cutoff')::timestamptz;
  IF at_time<'2000-01-01Z'::timestamptz OR at_time>cutoff OR cutoff>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid source cutoff' USING ERRCODE='22023';END IF;
  SELECT * INTO e FROM public.spx_actual_costs WHERE organization_id=org AND external_id=r->>'external_id';
  IF FOUND THEN
   IF (e.order_number,e.tracking,e.basic_shipping,e.cod_service,e.total_fee,e.balance_before,e.balance_after,e.transaction_at)
    IS DISTINCT FROM (r->>'order_number',r->>'tracking',basic,cod,total,bb,ba,at_time) THEN RAISE EXCEPTION 'Conflicting replay' USING ERRCODE='PT409';END IF;
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
  INSERT INTO public.spx_actual_costs VALUES(org,r->>'external_id',r->>'order_number',r->>'tracking',basic,cod,total,bb,ba,at_time,cutoff,actor,now());
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('recorded',n,'replayed',repeats);
END $$;
REVOKE ALL ON FUNCTION public.record_spx_actual_costs(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_spx_actual_costs(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.order_shipping_cost_basis(p_order_numbers text[])
RETURNS TABLE(order_number text,basis text,shipping numeric,cod numeric,ppn numeric,total numeric,external_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog SET jit=off AS $$
DECLARE org bigint; ref text; e public.spx_actual_costs%ROWTYPE; hits jsonb; row_data jsonb;
BEGIN
 SELECT organization_id INTO org FROM public.profiles WHERE id=auth.uid() AND active AND role::text IN('owner','admin','akunting');
 IF org IS NULL THEN RAISE EXCEPTION 'Finance access required' USING ERRCODE='42501';END IF;
 IF cardinality(p_order_numbers) NOT BETWEEN 1 AND 500 OR p_order_numbers IS NULL OR array_position(p_order_numbers,NULL) IS NOT NULL OR
 (SELECT count(DISTINCT x) FROM unnest(p_order_numbers) x)<>cardinality(p_order_numbers) THEN RAISE EXCEPTION 'Unique order references required' USING ERRCODE='22023';END IF;
 FOREACH ref IN ARRAY p_order_numbers LOOP
  SELECT jsonb_agg(to_jsonb(o)) INTO hits FROM (
   SELECT d.order_number,d.resi,d.tracking_no,d.estimated_shipping_net,d.estimated_cod_fee,d.estimated_ppn,d.estimated_total_cost FROM orders d WHERE d.organization_id=org AND d.order_number=ref
   UNION ALL SELECT d.order_number,d.resi,d.tracking_no,d.estimated_shipping_net,d.estimated_cod_fee,d.estimated_ppn,d.estimated_total_cost FROM orders_draft d WHERE d.organization_id=org AND d.order_number=ref
  ) o;
  IF coalesce(jsonb_array_length(hits),0)<>1 THEN RAISE EXCEPTION 'Missing or ambiguous order reference' USING ERRCODE='PT409';END IF;
  row_data:=hits->0;
  SELECT * INTO e FROM spx_actual_costs c WHERE c.organization_id=org AND c.order_number=ref;
  IF FOUND THEN
   IF (SELECT count(*) FROM (
    SELECT d.id FROM orders d WHERE d.organization_id=org AND (d.resi=e.tracking OR d.tracking_no=e.tracking)
    UNION ALL SELECT d.id FROM orders_draft d WHERE d.organization_id=org AND (d.resi=e.tracking OR d.tracking_no=e.tracking)
   ) identities)<>1 THEN RAISE EXCEPTION 'Ambiguous current tracking identity' USING ERRCODE='PT409';END IF;
   IF NOT(coalesce(row_data->>'resi','')=e.tracking OR coalesce(row_data->>'tracking_no','')=e.tracking) THEN RAISE EXCEPTION 'Stored charge tracking conflicts with order' USING ERRCODE='PT409';END IF;
   RETURN QUERY SELECT ref,'VERIFIED_COMPONENTS'::text,e.basic_shipping,e.cod_service,NULL::numeric,e.total_fee,e.external_id;
  ELSE
   RETURN QUERY SELECT ref,CASE WHEN row_data->>'estimated_total_cost' IS NULL THEN 'MISSING' ELSE 'ESTIMATE' END,
    (row_data->>'estimated_shipping_net')::numeric,(row_data->>'estimated_cod_fee')::numeric,(row_data->>'estimated_ppn')::numeric,(row_data->>'estimated_total_cost')::numeric,NULL::text;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.order_shipping_cost_basis(text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.order_shipping_cost_basis(text[]) TO authenticated;
COMMIT;
