-- 149 — Data Orderan lifecycle: fulfillment category + export gate + SPX sync.
-- ============================================================================
-- Goal:
-- 1) Every exported order carries GB Referensi + Kode Atribusi + CS.
--    Export is BLOCKED if attribution_code_raw OR cs_name/cs_id is missing.
-- 2) Each order is classified as either:
--    - GB_NO_RESI: GB order exists but no resi/tracking has been received.
--    - FIX_ORDER: GB matched to SPX and has tracking_no/resi.
-- ============================================================================

-- 1. Column: fulfillment_category on orders_draft + orders
ALTER TABLE public.orders_draft
  ADD COLUMN IF NOT EXISTS fulfillment_category TEXT;
ALTER TABLE public.orders_draft
  ADD COLUMN IF NOT EXISTS spx_created_at TIMESTAMPTZ;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_category TEXT;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS spx_created_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders_draft.fulfillment_category IS
  'GB_NO_RESI = GB order exists without resi/tracking. FIX_ORDER = matched to SPX with resi/tracking.';
COMMENT ON COLUMN public.orders.fulfillment_category IS
  'Same semantics as orders_draft.fulfillment_category, preserved on terminal promote.';

CREATE INDEX IF NOT EXISTS idx_orders_draft_fulfillment
  ON public.orders_draft(organization_id, fulfillment_category)
  WHERE fulfillment_category IS NOT NULL;

-- 2. Override check_order_export_ready: require attribution + CS
CREATE OR REPLACE FUNCTION public.check_order_export_ready(p_order_id bigint)
RETURNS TABLE(is_ready boolean, missing_fields text[])
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_order   RECORD;
  v_has_detail BOOLEAN;
  v_has_structured BOOLEAN;
BEGIN
  -- Check orders_draft first (most common post-8H), fallback to orders.
  SELECT * INTO v_order FROM public.orders_draft WHERE id = p_order_id;
  IF NOT FOUND THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, ARRAY['order_not_found']::TEXT[];
      RETURN;
    END IF;
  END IF;

  -- Address check (existing logic).
  v_has_detail := v_order.customer_address_detail IS NOT NULL
    AND LENGTH(TRIM(v_order.customer_address_detail)) >= 10;
  v_has_structured := v_order.customer_province IS NOT NULL
    AND LENGTH(TRIM(v_order.customer_province)) > 0
    AND v_order.customer_city IS NOT NULL
    AND LENGTH(TRIM(v_order.customer_city)) > 0
    AND v_order.customer_subdistrict IS NOT NULL
    AND LENGTH(TRIM(v_order.customer_subdistrict)) > 0;

  IF NOT (v_has_detail OR v_has_structured) THEN
    v_missing := array_append(v_missing, 'customer_address');
  END IF;

  IF v_order.channel_id IS NULL THEN
    v_missing := array_append(v_missing, 'channel_id');
  END IF;

  -- NEW: attribution_code_raw is REQUIRED for export.
  IF COALESCE(TRIM(v_order.attribution_code_raw), '') = '' THEN
    v_missing := array_append(v_missing, 'attribution_code_raw');
  END IF;

  -- NEW: cs_name or cs_id is REQUIRED for export.
  IF COALESCE(TRIM(v_order.cs_name), '') = ''
     AND v_order.cs_id IS NULL THEN
    v_missing := array_append(v_missing, 'cs_name');
  END IF;

  RETURN QUERY SELECT (array_length(v_missing, 1) IS NULL), v_missing;
END;
$function$;

-- 3. Override mark_drafts_exported: preserve GB_NO_RESI until resi arrives
CREATE OR REPLACE FUNCTION public.mark_drafts_exported(
  p_ids BIGINT[],
  p_channel_id BIGINT DEFAULT NULL,
  p_force BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE public.orders_draft d
    SET exported_at = now(),
        exported_channel_id = COALESCE(p_channel_id, d.exported_channel_id),
        fulfillment_category = CASE
          WHEN COALESCE(NULLIF(BTRIM(COALESCE(d.resi,'')),''), NULLIF(BTRIM(COALESCE(d.tracking_no,'')),'')) IS NULL THEN 'GB_NO_RESI'
          ELSE 'FIX_ORDER'
        END,
        updated_at = now()
  WHERE d.id = ANY(p_ids)
    AND d.organization_id = public.current_org_id()
    AND (p_force OR d.exported_at IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- 4. Override apply_spx_status_sync: set FIX_ORDER on match
CREATE OR REPLACE FUNCTION public.apply_spx_status_sync(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_org BIGINT;
  r JSONB;
  v_ref TEXT;
  v_track TEXT;
  v_oid BIGINT;
  v_cur_status TEXT;
  v_mapped TEXT;
  v_track_hits INT;
  c_matched INT := 0;
  c_updated INT := 0;
  c_no_ref INT := 0;
  c_no_match INT := 0;
BEGIN
  v_org := public.current_org_id();
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('matched',0,'updated',0,'skipped_no_ref',0,'skipped_no_match',0);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) AS t(value)
  LOOP
    v_ref := btrim(COALESCE(r->>'ref',''));
    v_track := btrim(COALESCE(r->>'tracking_no',''));
    v_oid := NULL;
    v_cur_status := NULL;

    IF v_ref = '' AND v_track = '' THEN
      c_no_ref := c_no_ref + 1;
      CONTINUE;
    END IF;

    -- 1) Primary path: exact GB ref → orders_draft.order_number
    IF v_ref LIKE 'GB-%' THEN
      SELECT id, status INTO v_oid, v_cur_status
      FROM public.orders_draft
      WHERE order_number = v_ref AND organization_id = v_org
      LIMIT 1;
    END IF;

    -- 2) Fallback path: exact tracking/resi already stamped on draft.
    IF v_oid IS NULL AND v_track <> '' THEN
      SELECT COUNT(*) INTO v_track_hits
      FROM public.orders_draft
      WHERE organization_id = v_org
        AND (tracking_no = v_track OR resi = v_track);

      IF v_track_hits = 1 THEN
        SELECT id, status INTO v_oid, v_cur_status
        FROM public.orders_draft
        WHERE organization_id = v_org
          AND (tracking_no = v_track OR resi = v_track)
        LIMIT 1;
      ELSIF v_track_hits > 1 THEN
        c_no_match := c_no_match + 1;
        CONTINUE;
      END IF;
    END IF;

    IF v_oid IS NULL THEN
      c_no_match := c_no_match + 1;
      CONTINUE;
    END IF;
    c_matched := c_matched + 1;

    v_mapped := NULL;
    IF COALESCE(r->>'tracking_status','') <> '' THEN
      SELECT internal_status INTO v_mapped
      FROM public.courier_channel_statuses
      WHERE channel_id = 1 AND lower(raw_status) = lower(btrim(r->>'tracking_status'))
      LIMIT 1;
    END IF;

    -- log transisi NON-terminal.
    IF v_mapped IS NOT NULL
       AND v_mapped IS DISTINCT FROM v_cur_status
       AND v_mapped NOT IN ('DITERIMA','RETUR') THEN
      BEGIN
        INSERT INTO public.order_status_history(
          organization_id, order_id, order_number, from_status, to_status,
          changed_at, changed_by, source, raw_status, note
        ) VALUES (
          v_org, NULL, COALESCE(NULLIF(v_ref,''), '[tracking:' || v_track || ']'), v_cur_status, v_mapped,
          now(), auth.uid(), 'spx_sync', btrim(r->>'tracking_status'), 'Transisi via sync SPX'
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    UPDATE public.orders_draft SET
      tracking_no         = COALESCE(NULLIF(v_track,''), tracking_no),
      resi                = COALESCE(NULLIF(v_track,''), resi),
      tracking_status     = COALESCE(NULLIF(btrim(COALESCE(r->>'tracking_status','')),''), tracking_status),
      spx_created_at      = COALESCE((NULLIF(btrim(COALESCE(r->>'create_time','')),''))::timestamptz, spx_created_at),
      status              = COALESCE(v_mapped, status),
      actual_shipping_fee = COALESCE((NULLIF(btrim(COALESCE(r->>'actual_fee','')),''))::numeric, actual_shipping_fee),
      return_shipping_fee = COALESCE((NULLIF(btrim(COALESCE(r->>'return_fee','')),''))::numeric, return_shipping_fee),
      delivered_at        = CASE WHEN v_mapped = 'DITERIMA'
                                 THEN COALESCE((NULLIF(btrim(COALESCE(r->>'delivered_at','')),''))::timestamptz, delivered_at, now())
                                 ELSE delivered_at END,
      returned_at         = CASE WHEN v_mapped = 'RETUR'
                                 THEN COALESCE((NULLIF(btrim(COALESCE(r->>'delivered_at','')),''))::timestamptz, returned_at, now())
                                 ELSE returned_at END,
      retur_reason        = CASE WHEN v_mapped = 'RETUR'
                                 THEN COALESCE(NULLIF(btrim(COALESCE(r->>'retur_reason','')),''), retur_reason)
                                 ELSE retur_reason END,
      -- NEW: mark as FIX_ORDER when matched in SPX sync
      fulfillment_category = CASE
        WHEN COALESCE(v_track, '') <> '' THEN 'FIX_ORDER'
        ELSE COALESCE(fulfillment_category, 'FIX_ORDER')
      END,
      tracking_synced_at  = now()
    WHERE id = v_oid;

    c_updated := c_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'matched', c_matched,
    'updated', c_updated,
    'skipped_no_ref', c_no_ref,
    'skipped_no_match', c_no_match
  );
END;
$$;

-- 5. Backward-compatible function name: mark GB orders without resi as GB_NO_RESI.
CREATE OR REPLACE FUNCTION public.mark_non_coverage_after_sync(
  p_matched_order_numbers TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  -- Mark all exported orders without resi/tracking as GB_NO_RESI.
  UPDATE public.orders_draft d
  SET fulfillment_category = 'GB_NO_RESI',
      updated_at = now()
  WHERE d.organization_id = public.current_org_id()
    AND d.exported_at IS NOT NULL
    AND COALESCE(NULLIF(BTRIM(COALESCE(d.resi,'')),''), NULLIF(BTRIM(COALESCE(d.tracking_no,'')),'')) IS NULL
    AND NOT (d.order_number = ANY(p_matched_order_numbers));

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- 6. list_data_orders: query for Data Orderan page.
--    Returns all exported orders with fulfillment_category.
CREATE OR REPLACE FUNCTION public.list_data_orders(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id BIGINT,
  order_number TEXT,
  order_date DATE,
  spx_created_at TIMESTAMPTZ,
  status TEXT,
  fulfillment_category TEXT,
  customer_name TEXT,
  payment_method TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  cs_name TEXT,
  attribution_code_raw TEXT,
  product_summary TEXT,
  product_variation TEXT,
  total NUMERIC,
  cod_amount NUMERIC,
  tracking_no TEXT,
  tracking_status TEXT,
  exported_at TIMESTAMPTZ,
  channel_name TEXT,
  total_count BIGINT,
  fix_count BIGINT,
  non_coverage_count BIGINT,
  pending_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH base AS (
    SELECT
      d.id, d.order_number, d.order_date, d.spx_created_at, d.status, d.fulfillment_category,
      d.customer_name, d.payment_method, d.customer_phone, d.customer_city,
      COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = d.cs_id), d.cs_name) AS cs_name,
      d.attribution_code_raw,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items_draft oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = d.id), '—') AS product_summary,
      (SELECT STRING_AGG(COALESCE(oi.variation, ''), ', ' ORDER BY oi.id) FROM public.order_items_draft oi WHERE oi.order_id = d.id) AS product_variation,
      d.total, d.cod_amount, d.tracking_no, d.tracking_status,
      d.exported_at,
      (SELECT name FROM public.courier_channels cc WHERE cc.id = d.exported_channel_id) AS channel_name
    FROM public.orders_draft d
    WHERE d.organization_id = v_org
    UNION ALL
    SELECT
      o.id, o.order_number, o.order_date, o.spx_created_at, o.status, o.fulfillment_category,
      o.customer_name, o.payment_method, o.customer_phone, o.customer_city,
      COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = o.cs_id), o.cs_name) AS cs_name,
      o.attribution_code_raw,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = o.id), '—') AS product_summary,
      (SELECT STRING_AGG(COALESCE(oi.variation, ''), ', ' ORDER BY oi.id) FROM public.order_items oi WHERE oi.order_id = o.id) AS product_variation,
      o.total, o.cod_amount, o.tracking_no, o.tracking_status,
      NULL::timestamptz AS exported_at,
      (SELECT name FROM public.courier_channels cc WHERE cc.id = o.channel_id) AS channel_name
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.status IN ('DITERIMA','RETUR')
  ),
  cnt AS (SELECT COUNT(*)::BIGINT AS n,
                 (SELECT COUNT(*)::BIGINT FROM public.orders_draft d2
                   WHERE d2.organization_id = v_org
                     AND d2.fulfillment_category = 'FIX_ORDER'
                     AND d2.spx_created_at IS NOT NULL
                     AND (p_from IS NULL OR d2.spx_created_at::date >= p_from)
                     AND (p_to IS NULL OR d2.spx_created_at::date <= p_to))::BIGINT AS fix_n,
                 (COUNT(*) - (SELECT COUNT(*)::BIGINT FROM public.orders_draft d2
                   WHERE d2.organization_id = v_org
                     AND d2.fulfillment_category = 'FIX_ORDER'
                     AND d2.spx_created_at IS NOT NULL
                     AND (p_from IS NULL OR d2.spx_created_at::date >= p_from)
                     AND (p_to IS NULL OR d2.spx_created_at::date <= p_to)))::BIGINT AS non_coverage_n,
                 (COUNT(*) - (SELECT COUNT(*)::BIGINT FROM public.orders_draft d2
                   WHERE d2.organization_id = v_org
                     AND d2.fulfillment_category = 'FIX_ORDER'
                     AND d2.spx_created_at IS NOT NULL
                     AND (p_from IS NULL OR d2.spx_created_at::date >= p_from)
                     AND (p_to IS NULL OR d2.spx_created_at::date <= p_to)))::BIGINT AS pending_n
          FROM base b
    WHERE (p_from IS NULL OR b.order_date >= p_from)
      AND (p_to IS NULL OR b.order_date <= p_to)
      AND (p_category IS NULL OR b.fulfillment_category = p_category)
      AND (p_search IS NULL
           OR b.order_number ILIKE '%'||p_search||'%'
           OR b.customer_name ILIKE '%'||p_search||'%'
           OR b.customer_phone ILIKE '%'||p_search||'%'
           OR COALESCE(b.attribution_code_raw,'') ILIKE '%'||p_search||'%'
           OR COALESCE(b.cs_name,'') ILIKE '%'||p_search||'%'
           OR COALESCE(b.tracking_no,'') ILIKE '%'||p_search||'%')
  )
  SELECT b.id, b.order_number, b.order_date, b.spx_created_at, b.status, b.fulfillment_category,
         b.customer_name, b.payment_method, b.customer_phone, b.customer_city,
         b.cs_name, b.attribution_code_raw, b.product_summary, b.product_variation,
         b.total, b.cod_amount, b.tracking_no, b.tracking_status,
         b.exported_at, b.channel_name,
         (SELECT n FROM cnt),
         (SELECT fix_n FROM cnt),
         (SELECT non_coverage_n FROM cnt),
         (SELECT pending_n FROM cnt)
  FROM base b
  WHERE (p_from IS NULL OR b.order_date >= p_from)
    AND (p_to IS NULL OR b.order_date <= p_to)
    AND (p_category IS NULL OR b.fulfillment_category = p_category)
    AND (p_search IS NULL
         OR b.order_number ILIKE '%'||p_search||'%'
         OR b.customer_name ILIKE '%'||p_search||'%'
         OR b.customer_phone ILIKE '%'||p_search||'%'
         OR COALESCE(b.attribution_code_raw,'') ILIKE '%'||p_search||'%'
         OR COALESCE(b.cs_name,'') ILIKE '%'||p_search||'%'
         OR COALESCE(b.tracking_no,'') ILIKE '%'||p_search||'%')
  ORDER BY b.exported_at DESC NULLS LAST, b.order_number DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 7. Preserve fulfillment_category on terminal promote.
-- (Already handled by mig 136 promote_draft_on_terminal — add fulfillment_category to INSERT.)
CREATE OR REPLACE FUNCTION public.promote_draft_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_order_id BIGINT;
BEGIN
  IF NEW.status IN ('DITERIMA','RETUR','CANCEL')
     AND COALESCE(OLD.status,'') NOT IN ('DITERIMA','RETUR','CANCEL') THEN

    INSERT INTO public.orders(
      organization_id, order_number, external_order_id, resi,
      source_profile_id, channel_id,
      customer_name, customer_phone, customer_province, customer_city,
      customer_subdistrict, customer_village, customer_zip,
      customer_address_detail, customer_address, wilayah_id,
      subtotal, shipping_cost, discount, total, cod_amount,
      estimated_shipping_net, estimated_cod_fee, estimated_ppn,
      estimated_total_cost, estimated_cash_in, estimated_profit,
      shipping_cost_actual, return_shipping_fee, retur_reason,
      tracking_no, tracking_status, delivered_at, returned_at,
      spx_created_at,
      payment_method, status, status_changed_at, priority, rate_snapshot,
      cs_id, cs_name, advertiser_id, admin_id, campaign_id,
      attribution_code_raw, attribution_platform, attribution_account_code, attribution_campaign_marker,
      fulfillment_category,
      origin_supplier_id, is_multi_origin, created_by,
      notes, meta, raw_data,
      internal_note, customer_note, reject_reason, cs_attempts,
      last_contact_at, tags,
      order_date, resi_printed_at,
      created_at, updated_at
    )
    VALUES (
      NEW.organization_id, NEW.order_number, NEW.external_order_id,
      COALESCE(NULLIF(TRIM(COALESCE(NEW.resi,'')),''), NEW.tracking_no),
      NEW.source_profile_id, NEW.channel_id,
      NEW.customer_name, NEW.customer_phone, NEW.customer_province, NEW.customer_city,
      NEW.customer_subdistrict, NEW.customer_village, NEW.customer_zip,
      NEW.customer_address_detail, NEW.customer_address, NEW.wilayah_id,
      NEW.subtotal, NEW.shipping_cost, NEW.discount, NEW.total, NEW.cod_amount,
      NEW.estimated_shipping_net, NEW.estimated_cod_fee, NEW.estimated_ppn,
      NEW.estimated_total_cost, NEW.estimated_cash_in, NEW.estimated_profit,
      NEW.actual_shipping_fee, NEW.return_shipping_fee, NEW.retur_reason,
      NEW.tracking_no, NEW.tracking_status, NEW.delivered_at, NEW.returned_at,
      NEW.spx_created_at,
      NEW.payment_method, NEW.status, NOW(), NEW.priority, NEW.rate_snapshot,
      NEW.cs_id, NEW.cs_name, NEW.advertiser_id, NEW.admin_id, NEW.campaign_id,
      NEW.attribution_code_raw, NEW.attribution_platform, NEW.attribution_account_code, NEW.attribution_campaign_marker,
      NEW.fulfillment_category,
      NEW.origin_supplier_id, NEW.is_multi_origin, NEW.created_by,
      NEW.notes, NEW.meta, NEW.raw_data,
      NEW.internal_note, NEW.customer_note, NEW.reject_reason, NEW.cs_attempts,
      NEW.last_contact_at, NEW.tags,
      NEW.order_date, NEW.resi_printed_at,
      NEW.created_at, NOW()
    )
    RETURNING id INTO v_new_order_id;

    INSERT INTO public.order_items(
      organization_id, order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, packing_fee_snapshot, notes
    )
    SELECT
      organization_id, v_new_order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, packing_fee_snapshot, notes
    FROM public.order_items_draft
    WHERE order_id = NEW.id;

    INSERT INTO public.order_status_history(
      organization_id, order_id, order_number, from_status, to_status,
      changed_at, changed_by, source, raw_status, note
    ) VALUES (
      NEW.organization_id, v_new_order_id, NEW.order_number,
      OLD.status, NEW.status, NOW(), auth.uid(), 'spx_sync',
      NEW.tracking_status, 'Promote terminal via sync SPX'
    );

    PERFORM public.compute_commissions(v_new_order_id);

    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (
      auth.uid(), 'orders_draft', NEW.id::text, 'PROMOTE_TO_ORDERS',
      jsonb_build_object('draft_id', NEW.id, 'order_number', NEW.order_number),
      jsonb_build_object('orders_id', v_new_order_id, 'terminal_status', NEW.status)
    );

    DELETE FROM public.orders_draft WHERE id = NEW.id;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Grants
REVOKE EXECUTE ON FUNCTION public.mark_drafts_exported(bigint[], bigint, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_drafts_exported(bigint[], bigint, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_non_coverage_after_sync(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_non_coverage_after_sync(text[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.list_data_orders(date, date, text, text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_data_orders(date, date, text, text, integer, integer) TO authenticated;
