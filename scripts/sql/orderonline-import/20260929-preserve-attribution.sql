-- Existing signature, invoker security and grants preserved. No historical row updates.
CREATE OR REPLACE FUNCTION public.bulk_insert_orders_draft(p_rows jsonb, p_org bigint, p_initial_status text, p_created_by uuid, p_source_profile_id bigint, p_channel_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r jsonb; it jsonb;
  v_oid bigint; v_ext text; v_num text;
  v_inserted int := 0; v_skipped int := 0; v_ids bigint[] := '{}';
  v_existing text[];
  v_date text := to_char(CURRENT_DATE, 'YYYYMMDD');
  v_counter int;
BEGIN
  -- Pre-load external_order_id existing (orders + orders_draft) utk dedup.
  SELECT COALESCE(array_agg(external_order_id), '{}') INTO v_existing FROM (
    SELECT external_order_id FROM public.orders
      WHERE organization_id = p_org AND external_order_id IS NOT NULL
    UNION
    SELECT external_order_id FROM public.orders_draft
      WHERE organization_id = p_org AND external_order_id IS NOT NULL
  ) e;

  -- Counter order_number hari ini, dihitung SEKALI (bukan RPC per row).
  SELECT COALESCE(max(substring(order_number FROM 13 FOR 6)::int), 0) INTO v_counter
  FROM (
    SELECT order_number FROM public.orders WHERE order_number LIKE 'GB-' || v_date || '-%'
    UNION ALL
    SELECT order_number FROM public.orders_draft WHERE order_number LIKE 'GB-' || v_date || '-%'
  ) u;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_ext := NULLIF(r->>'external_order_id', '');
    IF v_ext IS NOT NULL AND v_ext = ANY(v_existing) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_counter := v_counter + 1;
    v_num := 'GB-' || v_date || '-' || lpad(v_counter::text, 6, '0');

    INSERT INTO public.orders_draft(
      organization_id, order_number, external_order_id, source_profile_id, channel_id, status,
      payment_method, customer_name, customer_phone, customer_province, customer_city,
      customer_subdistrict, customer_village, customer_zip, customer_address_detail, customer_address,
      subtotal, shipping_cost, discount, total, cod_amount, cs_name, cs_id, notes, customer_note,
      tags, priority, meta, raw_data, created_by, order_date,
      attribution_code_raw, attribution_platform, attribution_account_code, attribution_campaign_marker
    ) VALUES (
      p_org, v_num, v_ext, p_source_profile_id, p_channel_id, p_initial_status,
      COALESCE(NULLIF(r->>'payment_method', ''), 'COD'),
      r->>'customer_name', NULLIF(r->>'customer_phone', ''), NULLIF(r->>'customer_province', ''),
      NULLIF(r->>'customer_city', ''), NULLIF(r->>'customer_subdistrict', ''), NULLIF(r->>'customer_village', ''),
      NULLIF(r->>'customer_zip', ''), NULLIF(r->>'customer_address_detail', ''), NULLIF(r->>'customer_address', ''),
      COALESCE((r->>'subtotal')::numeric, 0), COALESCE((r->>'shipping_cost')::numeric, 0),
      COALESCE((r->>'discount')::numeric, 0), COALESCE((r->>'total')::numeric, 0),
      NULLIF(r->>'cod_amount', '')::numeric, NULLIF(r->>'cs_name', ''), NULLIF(r->>'cs_id', '')::uuid,
      NULLIF(r->>'notes', ''), NULLIF(r->>'customer_note', ''),
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(r->'tags') x), '{}'),
      COALESCE(NULLIF(r->>'priority', ''), 'NORMAL'),
      CASE WHEN r->'meta' IS NULL OR r->'meta' = 'null'::jsonb THEN NULL ELSE r->'meta' END,
      CASE WHEN r->'raw_data' IS NULL OR r->'raw_data' = 'null'::jsonb THEN NULL ELSE r->'raw_data' END,
      p_created_by, COALESCE(NULLIF(r->>'order_date', '')::date, CURRENT_DATE),
      NULLIF(r->'meta'->>'product_code_full', ''),
      NULLIF(r->'meta'->>'platform', ''),
      NULLIF(r->'meta'->>'atribusi_account', ''),
      NULLIF(r->'meta'->>'atribusi_campaign', '')
    )
    RETURNING id INTO v_oid;

    IF v_ext IS NOT NULL THEN v_existing := array_append(v_existing, v_ext); END IF;

    it := r->'_item';
    IF it IS NOT NULL AND it <> 'null'::jsonb THEN
      INSERT INTO public.order_items_draft(
        organization_id, order_id, product_id, variant_id, product_name_raw, variation,
        product_code_raw, qty, weight_per_unit, price, hpp_snapshot, notes
      ) VALUES (
        p_org, v_oid, NULLIF(it->>'product_id', '')::bigint, NULLIF(it->>'variant_id', '')::bigint,
        COALESCE(it->>'product_name_raw', ''), NULLIF(it->>'variation', ''), NULLIF(it->>'product_code_raw', ''),
        COALESCE((it->>'qty')::int, 1), NULLIF(it->>'weight_per_unit', '')::numeric,
        COALESCE((it->>'price')::numeric, 0), NULLIF(it->>'hpp_snapshot', '')::numeric, NULLIF(it->>'notes', '')
      );
    END IF;

    v_inserted := v_inserted + 1;
    v_ids := array_append(v_ids, v_oid);
  END LOOP;

  -- Resolve alamat set-based utk semua yang baru di-insert.
  IF array_length(v_ids, 1) > 0 THEN
    PERFORM public.resolve_draft_wilayah(p_org, v_ids);
  END IF;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped_duplicates', v_skipped, 'inserted_ids', to_jsonb(v_ids));
END;
$function$;
