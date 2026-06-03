-- 118 — Selisih Ongkir cover SEMUA order (draft + terminal). DDL penuh.
-- ============================================================================
-- shipping_diff_per_order + _summary baca union orders_draft + orders (id draft
-- dinegatif). Draft pakai actual_shipping_fee AS shipping_cost_actual. Subquery
-- di-alias (d/o2) biar gak bentrok sama OUT param. Idempotent.

CREATE OR REPLACE FUNCTION public.shipping_diff_per_order(
  p_from DATE, p_to DATE, p_channel_id BIGINT DEFAULT NULL, p_courier_id BIGINT DEFAULT NULL, p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  order_id BIGINT, order_number TEXT, order_date DATE, status TEXT,
  channel_id BIGINT, channel_name TEXT, courier_id BIGINT, courier_name TEXT, customer_name TEXT,
  ongkir_customer NUMERIC, ongkir_gross NUMERIC, ongkir_net NUMERIC,
  cashback_amount NUMERIC, cashback_pct NUMERIC,
  selisih_gross NUMERIC, selisih_net NUMERIC, margin_pct_gross NUMERIC, margin_pct_net NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  WITH o AS (
    SELECT -d.id AS id, d.order_number, d.order_date, d.status::text AS status, d.channel_id, d.customer_name,
           d.shipping_cost, d.actual_shipping_fee AS shipping_cost_actual, d.estimated_shipping_net, d.organization_id
    FROM public.orders_draft d
    UNION ALL
    SELECT o2.id, o2.order_number, o2.order_date, o2.status::text AS status, o2.channel_id, o2.customer_name,
           o2.shipping_cost, o2.shipping_cost_actual, o2.estimated_shipping_net, o2.organization_id
    FROM public.orders o2
  )
  SELECT
    o.id, o.order_number, o.order_date, o.status, o.channel_id, cc.name, cc.courier_id, cu.name, o.customer_name,
    COALESCE(o.shipping_cost, 0),
    COALESCE(o.shipping_cost_actual, o.shipping_cost, 0),
    COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0),
    GREATEST(COALESCE(o.shipping_cost_actual, o.shipping_cost, 0) - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0), 0),
    CASE WHEN COALESCE(o.shipping_cost_actual, o.shipping_cost, 0) > 0
      THEN ROUND(GREATEST(COALESCE(o.shipping_cost_actual, o.shipping_cost, 0) - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0), 0) * 100.0 / COALESCE(o.shipping_cost_actual, o.shipping_cost, 0), 2) ELSE 0 END,
    (COALESCE(o.shipping_cost, 0) - COALESCE(o.shipping_cost_actual, o.shipping_cost, 0)),
    (COALESCE(o.shipping_cost, 0) - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0)),
    CASE WHEN COALESCE(o.shipping_cost, 0) > 0 THEN ROUND((COALESCE(o.shipping_cost, 0) - COALESCE(o.shipping_cost_actual, o.shipping_cost, 0)) * 100.0 / o.shipping_cost, 2) ELSE 0 END,
    CASE WHEN COALESCE(o.shipping_cost, 0) > 0 THEN ROUND((COALESCE(o.shipping_cost, 0) - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0)) * 100.0 / o.shipping_cost, 2) ELSE 0 END
  FROM o
  LEFT JOIN public.courier_channels cc ON cc.id = o.channel_id
  LEFT JOIN public.couriers cu ON cu.id = cc.courier_id
  WHERE o.organization_id = v_org
    AND o.order_date >= p_from AND o.order_date <= p_to
    AND (p_channel_id IS NULL OR o.channel_id = p_channel_id)
    AND (p_courier_id IS NULL OR cc.courier_id = p_courier_id)
    AND (p_status IS NULL OR p_status = 'ALL' OR o.status = p_status)
  ORDER BY o.order_date DESC, o.id DESC;
END $$;
GRANT EXECUTE ON FUNCTION public.shipping_diff_per_order(DATE, DATE, BIGINT, BIGINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.shipping_diff_summary(
  p_from DATE, p_to DATE, p_channel_id BIGINT DEFAULT NULL, p_courier_id BIGINT DEFAULT NULL, p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_orders BIGINT, total_ongkir_customer NUMERIC, total_ongkir_gross NUMERIC, total_ongkir_net NUMERIC,
  total_cashback NUMERIC, total_selisih_gross NUMERIC, total_selisih_net NUMERIC,
  avg_margin_pct_gross NUMERIC, avg_margin_pct_net NUMERIC,
  orders_with_loss BIGINT, orders_breakeven BIGINT, orders_profit BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  WITH o AS (
    SELECT -d.id AS id, d.order_date, d.status::text AS status, d.channel_id,
           d.shipping_cost, d.actual_shipping_fee AS shipping_cost_actual, d.estimated_shipping_net, d.organization_id
    FROM public.orders_draft d
    UNION ALL
    SELECT o2.id, o2.order_date, o2.status::text AS status, o2.channel_id,
           o2.shipping_cost, o2.shipping_cost_actual, o2.estimated_shipping_net, o2.organization_id
    FROM public.orders o2
  ),
  order_diffs AS (
    SELECT o.id,
      COALESCE(o.shipping_cost, 0) AS customer,
      COALESCE(o.shipping_cost_actual, o.shipping_cost, 0) AS gross,
      COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0) AS net,
      GREATEST(COALESCE(o.shipping_cost_actual, o.shipping_cost, 0) - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0), 0) AS cashback,
      (COALESCE(o.shipping_cost, 0) - COALESCE(o.shipping_cost_actual, o.shipping_cost, 0)) AS sel_gross,
      (COALESCE(o.shipping_cost, 0) - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0)) AS sel_net
    FROM o
    LEFT JOIN public.courier_channels cc ON cc.id = o.channel_id
    WHERE o.organization_id = v_org
      AND o.order_date >= p_from AND o.order_date <= p_to
      AND (p_channel_id IS NULL OR o.channel_id = p_channel_id)
      AND (p_courier_id IS NULL OR cc.courier_id = p_courier_id)
      AND (p_status IS NULL OR p_status = 'ALL' OR o.status = p_status)
  )
  SELECT
    COUNT(*)::BIGINT, COALESCE(SUM(customer),0)::NUMERIC, COALESCE(SUM(gross),0)::NUMERIC, COALESCE(SUM(net),0)::NUMERIC,
    COALESCE(SUM(cashback),0)::NUMERIC, COALESCE(SUM(sel_gross),0)::NUMERIC, COALESCE(SUM(sel_net),0)::NUMERIC,
    CASE WHEN COALESCE(SUM(customer),0) > 0 THEN ROUND(COALESCE(SUM(sel_gross),0) * 100.0 / SUM(customer), 2) ELSE 0 END,
    CASE WHEN COALESCE(SUM(customer),0) > 0 THEN ROUND(COALESCE(SUM(sel_net),0) * 100.0 / SUM(customer), 2) ELSE 0 END,
    COUNT(*) FILTER (WHERE sel_net < 0)::BIGINT, COUNT(*) FILTER (WHERE sel_net = 0)::BIGINT, COUNT(*) FILTER (WHERE sel_net > 0)::BIGINT
  FROM order_diffs;
END $$;
GRANT EXECUTE ON FUNCTION public.shipping_diff_summary(DATE, DATE, BIGINT, BIGINT, TEXT) TO authenticated;
