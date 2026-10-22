-- One normal-auth transaction: retain variant identities and roll back price changes on any failure.
CREATE OR REPLACE FUNCTION public.save_product_with_price_history(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_catalog' AS $$
DECLARE pid bigint; org bigint:=public.current_org_id(); v jsonb; vid bigint; kept bigint[]:='{}'; aid bigint; idx int:=0; parent_hpp numeric; parent_price numeric; variable boolean;
BEGIN
 IF auth.uid() IS NULL OR org IS NULL OR (p_payload->>'orgId')::bigint IS DISTINCT FROM org THEN
  RAISE EXCEPTION 'Organization mismatch' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND active AND role IN('owner','admin','akunting')) THEN
  RAISE EXCEPTION 'Product edit role required' USING ERRCODE='42501';
 END IF;
 IF nullif(trim(p_payload->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Product name required' USING ERRCODE='22023'; END IF;
 variable:=coalesce((p_payload->>'hasVariants')::boolean,false);
 IF variable AND jsonb_array_length(coalesce(p_payload->'variants','[]'))=0 THEN RAISE EXCEPTION 'Variants required' USING ERRCODE='22023'; END IF;
 parent_hpp:=CASE WHEN variable THEN (p_payload#>>'{variants,0,hpp}')::numeric ELSE (p_payload->>'simpleHpp')::numeric END;
 parent_price:=CASE WHEN variable THEN (p_payload#>>'{variants,0,price}')::numeric ELSE (p_payload->>'simplePrice')::numeric END;
 IF parent_hpp IS NULL OR parent_hpp<0 OR parent_price IS NULL OR parent_price<=0 THEN RAISE EXCEPTION 'Invalid product price' USING ERRCODE='22023'; END IF;
 pid:=(p_payload->>'id')::bigint;
 IF pid IS NOT NULL THEN
  PERFORM 1 FROM public.products WHERE id=pid AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
  UPDATE public.products SET name=trim(p_payload->>'name'),notes=p_payload->>'notes',active=(p_payload->>'active')::boolean,
    has_variants=variable,price_default=parent_price,hpp=parent_hpp,
    supplier_id=CASE WHEN p_payload?'supplierId' THEN (p_payload->>'supplierId')::bigint ELSE supplier_id END,
    packing_fee=CASE WHEN p_payload?'packingFee' THEN (p_payload->>'packingFee')::numeric ELSE packing_fee END,
    display_name=CASE WHEN p_payload?'displayName' THEN p_payload->>'displayName' ELSE display_name END,
    weight_kg=CASE WHEN p_payload?'weightKg' THEN (p_payload->>'weightKg')::numeric ELSE weight_kg END
    WHERE id=pid AND organization_id=org;
 ELSE
  INSERT INTO public.products(organization_id,name,notes,active,has_variants,price_default,hpp,supplier_id,packing_fee,display_name,weight_kg)
  VALUES(org,trim(p_payload->>'name'),p_payload->>'notes',(p_payload->>'active')::boolean,variable,parent_price,parent_hpp,
    (p_payload->>'supplierId')::bigint,coalesce((p_payload->>'packingFee')::numeric,0),p_payload->>'displayName',(p_payload->>'weightKg')::numeric)
  RETURNING id INTO pid;
 END IF;
 DELETE FROM public.product_attributes_assignment WHERE product_id=pid;
 IF variable THEN
  FOR aid IN SELECT value::bigint FROM jsonb_array_elements_text(p_payload->'attributeIds') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.product_attributes WHERE id=aid AND organization_id=org) THEN RAISE EXCEPTION 'Attribute unavailable' USING ERRCODE='42501'; END IF;
   INSERT INTO public.product_attributes_assignment(product_id,attribute_id,display_order) VALUES(pid,aid,idx);idx:=idx+1;
  END LOOP;
 ELSE
  SELECT id INTO vid FROM public.product_variants WHERE product_id=pid AND variant_name='default' ORDER BY id LIMIT 1;
  p_payload:=jsonb_set(p_payload,'{variants}',jsonb_build_array(jsonb_build_object('id',vid,'variant_name','default','price',parent_price,'hpp',parent_hpp,'active',(p_payload->>'active')::boolean,'attribute_value_ids','[]'::jsonb)));
 END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_payload->'variants') LOOP
  vid:=(v->>'id')::bigint;
  IF coalesce((v->>'hpp')::numeric,-1)<0 OR coalesce((v->>'price')::numeric,0)<=0 OR nullif(trim(v->>'variant_name'),'') IS NULL THEN RAISE EXCEPTION 'Invalid variant price/name' USING ERRCODE='22023'; END IF;
  IF vid IS NOT NULL THEN
   IF vid=ANY(kept) THEN RAISE EXCEPTION 'Repeated variant' USING ERRCODE='22023'; END IF;
   UPDATE public.product_variants SET variant_name=trim(v->>'variant_name'),variation_code=nullif(trim(v->>'variation_code'),''),
     price=(v->>'price')::numeric,hpp=(v->>'hpp')::numeric,weight_grams=(v->>'weight_grams')::numeric,active=(v->>'active')::boolean
     WHERE id=vid AND product_id=pid AND organization_id=org;
   IF NOT FOUND THEN RAISE EXCEPTION 'Variant unavailable' USING ERRCODE='42501'; END IF;
  ELSE
   INSERT INTO public.product_variants(product_id,organization_id,variant_name,variation_code,price,hpp,weight_grams,active)
   VALUES(pid,org,trim(v->>'variant_name'),nullif(trim(v->>'variation_code'),''),(v->>'price')::numeric,(v->>'hpp')::numeric,(v->>'weight_grams')::numeric,(v->>'active')::boolean)
   RETURNING id INTO vid;
  END IF;
  kept:=array_append(kept,vid);
  DELETE FROM public.variant_attribute_values WHERE variant_id=vid;
  FOR aid IN SELECT value::bigint FROM jsonb_array_elements_text(v->'attribute_value_ids') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.product_attribute_values av JOIN public.product_attributes a ON a.id=av.attribute_id
     JOIN public.product_attributes_assignment pa ON pa.attribute_id=a.id AND pa.product_id=pid WHERE av.id=aid AND a.organization_id=org) THEN
    RAISE EXCEPTION 'Attribute value unavailable' USING ERRCODE='42501';
   END IF;
   INSERT INTO public.variant_attribute_values(variant_id,attribute_value_id) VALUES(vid,aid);
  END LOOP;
 END LOOP;
 UPDATE public.product_variants SET active=false WHERE product_id=pid AND organization_id=org AND NOT(id=ANY(kept)) AND active;
 RETURN jsonb_build_object('id',pid);
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_price_history(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_product_with_price_history(jsonb) TO authenticated;
