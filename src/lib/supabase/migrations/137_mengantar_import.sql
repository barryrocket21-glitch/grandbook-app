-- 137 — IMPORT order Mengantar/JNE ke GrandBook (bikin order BARU, channel 2).
-- Order Mengantar absen total dari GrandBook → import, bukan rekonsil. Pola
-- preview/apply (stage di reconciliation_batches). Parser TS (mengantar-parser)
-- kirim rows bersih. preview: dedup by resi + match produk (prefix / 2-kata
-- pertama) + tebak campaign (produk + platform_hint). apply: INSERT orders +
-- order_items (trigger snapshot HPP + compute cost + commission + history).
-- Model: total=COD, shipping_cost=0, shipping_cost_actual=ongkir net, payout
-- (DITERIMA)=COD−biaya. Idempotent. SECURITY INVOKER + RLS + current_org_id().

-- ===== preview_mengantar_import =====
DROP FUNCTION IF EXISTS public.preview_mengantar_import(jsonb, text, int);

CREATE OR REPLACE FUNCTION public.preview_mengantar_import(
  p_rows jsonb, p_file_name text DEFAULT NULL, p_file_size_bytes int DEFAULT NULL
)
RETURNS TABLE(
  batch_id bigint, total_rows int, to_create int, already_exists int,
  product_matched int, product_unmatched int, attribution_guessed int, preview_data jsonb
)
LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org bigint; v_batch bigint; v_total int;
  v_create_n int := 0; v_exists_n int := 0; v_pmatch int := 0; v_punmatch int := 0; v_attr int := 0;
  v_create jsonb := '[]'::jsonb; v_exists jsonb := '[]'::jsonb;
  v_payload jsonb; v_row jsonb; v_resi text; v_clean text; v_platform text;
  v_pid bigint; v_camp bigint; v_qty int; v_cod numeric; v_status text; v_o record;
BEGIN
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  v_total := COALESCE(jsonb_array_length(p_rows), 0);

  INSERT INTO public.reconciliation_batches (
    organization_id, channel_id, profile_id, uploaded_by, uploaded_at,
    file_name, file_size_bytes, total_rows, status
  ) VALUES (v_org, 2, NULL, auth.uid(), NOW(), p_file_name, p_file_size_bytes, v_total, 'PREVIEW')
  RETURNING id INTO v_batch;

  FOR v_row IN SELECT jsonb_array_elements(p_rows) LOOP
    v_resi := NULLIF(TRIM(v_row->>'resi'), '');
    IF v_resi IS NULL THEN CONTINUE; END IF;

    SELECT id, order_number INTO v_o FROM public.orders
    WHERE resi = v_resi AND organization_id = v_org;
    IF FOUND THEN
      v_exists_n := v_exists_n + 1;
      v_exists := v_exists || jsonb_build_array(jsonb_build_object(
        'resi', v_resi, 'order_number', v_o.order_number, 'customer_name', v_row->>'customer_name'));
      CONTINUE;
    END IF;

    v_clean := NULLIF(TRIM(v_row->>'product_clean'), '');
    v_platform := NULLIF(v_row->>'platform_hint', '');
    v_qty := GREATEST(COALESCE((v_row->>'qty')::int, 1), 1);
    v_cod := COALESCE((v_row->>'cod')::numeric, 0);
    v_status := COALESCE(NULLIF(v_row->>'internal_status', ''), 'PROBLEM');

    -- match produk: prefix dulu, fallback 2 kata pertama
    v_pid := NULL;
    IF v_clean IS NOT NULL THEN
      SELECT p.id INTO v_pid FROM public.products p
      WHERE p.organization_id = v_org AND p.active AND (
        lower(v_clean) LIKE lower(p.name) || '%'
        OR (lower(split_part(v_clean, ' ', 1)) = lower(split_part(p.name, ' ', 1))
            AND split_part(p.name, ' ', 2) <> ''
            AND lower(split_part(v_clean, ' ', 2)) = lower(split_part(p.name, ' ', 2))))
      ORDER BY (lower(v_clean) LIKE lower(p.name) || '%') DESC, length(p.name) DESC
      LIMIT 1;
    END IF;
    IF v_pid IS NOT NULL THEN v_pmatch := v_pmatch + 1; ELSE v_punmatch := v_punmatch + 1; END IF;

    -- tebak campaign: produk + platform_hint (cuma kalau hint ada = lebih yakin)
    v_camp := NULL;
    IF v_pid IS NOT NULL AND v_platform IS NOT NULL THEN
      SELECT c.id INTO v_camp FROM public.campaigns c
      JOIN public.ad_accounts a ON a.id = c.account_id
      JOIN public.campaign_products cp ON cp.campaign_id = c.id
      WHERE a.organization_id = v_org AND cp.product_id = v_pid AND a.platform = v_platform
      ORDER BY c.campaign_marker, c.id LIMIT 1;
      IF v_camp IS NOT NULL THEN v_attr := v_attr + 1; END IF;
    END IF;

    v_create_n := v_create_n + 1;
    v_create := v_create || jsonb_build_array(jsonb_build_object(
      'resi', v_resi,
      'order_date', COALESCE(NULLIF(v_row->>'order_date', ''), CURRENT_DATE::text),
      'customer_name', COALESCE(NULLIF(TRIM(v_row->>'customer_name'), ''), '—'),
      'customer_phone', v_row->>'customer_phone', 'customer_city', v_row->>'customer_city',
      'customer_province', v_row->>'customer_province', 'customer_subdistrict', v_row->>'customer_subdistrict',
      'customer_address', v_row->>'customer_address',
      'product_raw', COALESCE(NULLIF(v_row->>'product_raw', ''), 'Unknown'),
      'product_id', v_pid, 'qty', v_qty, 'status', v_status,
      'cod', v_cod, 'shipping_net', COALESCE((v_row->>'shipping_net')::numeric, 0),
      'payout', (v_row->>'payout')::numeric, 'campaign_id', v_camp,
      'price', ROUND(v_cod / v_qty)));
  END LOOP;

  v_payload := jsonb_build_object('to_create', v_create, 'already_exists', v_exists);
  UPDATE public.reconciliation_batches
  SET matched_count = v_create_n, unmatched_count = v_punmatch, variance_count = v_exists_n,
      preview_payload = v_payload
  WHERE id = v_batch;

  RETURN QUERY SELECT v_batch, v_total, v_create_n, v_exists_n, v_pmatch, v_punmatch, v_attr, v_payload;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.preview_mengantar_import(jsonb, text, int) TO authenticated;

-- ===== apply_mengantar_import =====
DROP FUNCTION IF EXISTS public.apply_mengantar_import(bigint);

CREATE OR REPLACE FUNCTION public.apply_mengantar_import(p_batch_id bigint)
RETURNS TABLE(batch_id bigint, status text, created int, skipped_exists int, applied_at timestamptz)
LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org bigint; v_batch record; v_row jsonb; v_created int := 0; v_skipped int := 0;
  v_resi text; v_oid bigint; v_onum text;
BEGIN
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  PERFORM set_config('grandbook.bypass_actual_check', 'true', true);

  SELECT * INTO v_batch FROM public.reconciliation_batches
  WHERE id = p_batch_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch % tidak ketemu', p_batch_id; END IF;
  IF v_batch.status = 'APPLIED' THEN RAISE EXCEPTION 'Batch % sudah APPLIED', p_batch_id; END IF;
  IF v_batch.status = 'CANCELLED' THEN RAISE EXCEPTION 'Batch % sudah CANCELLED', p_batch_id; END IF;

  FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_batch.preview_payload->'to_create', '[]'::jsonb)) LOOP
    v_resi := v_row->>'resi';
    -- re-check dedup (jaga-jaga ada yg keburu masuk)
    PERFORM 1 FROM public.orders WHERE resi = v_resi AND organization_id = v_org;
    IF FOUND THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    v_onum := public.generate_order_number(v_org);
    INSERT INTO public.orders (
      organization_id, order_number, resi, status, channel_id, payment_method,
      customer_name, customer_phone, customer_city, customer_province, customer_subdistrict,
      customer_address_detail, order_date, subtotal, total, cod_amount, shipping_cost,
      shipping_cost_actual, payout_amount, campaign_id, created_by
    ) VALUES (
      v_org, v_onum, v_resi, v_row->>'status', 2, 'COD',
      v_row->>'customer_name', NULLIF(v_row->>'customer_phone', ''), NULLIF(v_row->>'customer_city', ''),
      NULLIF(v_row->>'customer_province', ''), NULLIF(v_row->>'customer_subdistrict', ''),
      NULLIF(v_row->>'customer_address', ''), (v_row->>'order_date')::date,
      (v_row->>'cod')::numeric, (v_row->>'cod')::numeric, (v_row->>'cod')::numeric, 0,
      (v_row->>'shipping_net')::numeric, (v_row->>'payout')::numeric,
      (v_row->>'campaign_id')::bigint, auth.uid()
    ) RETURNING id INTO v_oid;

    INSERT INTO public.order_items (organization_id, order_id, product_id, product_name_raw, qty, price)
    VALUES (v_org, v_oid, (v_row->>'product_id')::bigint, v_row->>'product_raw',
            (v_row->>'qty')::int, (v_row->>'price')::numeric);

    v_created := v_created + 1;
  END LOOP;

  UPDATE public.reconciliation_batches
  SET status = 'APPLIED', applied_at = NOW(), applied_by = auth.uid()
  WHERE id = p_batch_id;

  RETURN QUERY SELECT p_batch_id, 'APPLIED'::text, v_created, v_skipped, NOW();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_mengantar_import(bigint) TO authenticated;
