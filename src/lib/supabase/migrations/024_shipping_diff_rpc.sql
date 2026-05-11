-- =============================================================
-- Migration 024 — Phase 6.5: Shipping Diff Revival
--
-- Adapt dari brief: schema sebenarnya pakai `courier_channels` (bukan
-- `channels`), `orders.channel_id` JOIN ke courier_channels untuk dapat
-- courier_id (orders TIDAK punya courier_id langsung), dan
-- `estimated_shipping_discount` derive dari (shipping_cost_actual -
-- estimated_shipping_net) — kolom tsb tidak exist literal di orders.
--
-- Produces 2 RPCs:
--   1. shipping_diff_per_order — per-row 3 angka + 2 selisih
--   2. shipping_diff_summary — agregat untuk stat cards top section
-- =============================================================

-- ----------------------------------------------------------
-- 1. shipping_diff_per_order
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shipping_diff_per_order(
  p_from DATE,
  p_to DATE,
  p_channel_id BIGINT DEFAULT NULL,
  p_courier_id BIGINT DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  order_id BIGINT,
  order_number TEXT,
  order_date DATE,
  status TEXT,
  channel_id BIGINT,
  channel_name TEXT,
  courier_id BIGINT,
  courier_name TEXT,
  customer_name TEXT,
  ongkir_customer NUMERIC,
  ongkir_gross NUMERIC,
  ongkir_net NUMERIC,
  cashback_amount NUMERIC,
  cashback_pct NUMERIC,
  selisih_gross NUMERIC,
  selisih_net NUMERIC,
  margin_pct_gross NUMERIC,
  margin_pct_net NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.order_date,
    o.status::TEXT,
    o.channel_id,
    cc.name,
    cc.courier_id,
    cu.name,
    o.customer_name,
    COALESCE(o.shipping_cost, 0) AS ongkir_customer,
    -- gross: fallback ke shipping_cost kalau actual NULL (Phase 4C trigger
    -- belum jalan / order pre-Phase 4C)
    COALESCE(o.shipping_cost_actual, o.shipping_cost, 0) AS ongkir_gross,
    -- net: fallback chain net → actual → charge
    COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0) AS ongkir_net,
    -- cashback amount: gross - net (positive berarti dapat cashback)
    GREATEST(
      COALESCE(o.shipping_cost_actual, o.shipping_cost, 0)
        - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0),
      0
    ) AS cashback_amount,
    -- cashback %: cashback / gross × 100
    CASE
      WHEN COALESCE(o.shipping_cost_actual, o.shipping_cost, 0) > 0
      THEN ROUND(
        GREATEST(
          COALESCE(o.shipping_cost_actual, o.shipping_cost, 0)
            - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0),
          0
        ) * 100.0
        / COALESCE(o.shipping_cost_actual, o.shipping_cost, 0),
        2
      )
      ELSE 0
    END AS cashback_pct,
    (COALESCE(o.shipping_cost, 0)
      - COALESCE(o.shipping_cost_actual, o.shipping_cost, 0)) AS selisih_gross,
    (COALESCE(o.shipping_cost, 0)
      - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0)) AS selisih_net,
    CASE
      WHEN COALESCE(o.shipping_cost, 0) > 0
      THEN ROUND(
        (COALESCE(o.shipping_cost, 0)
          - COALESCE(o.shipping_cost_actual, o.shipping_cost, 0)) * 100.0
        / o.shipping_cost,
        2
      )
      ELSE 0
    END AS margin_pct_gross,
    CASE
      WHEN COALESCE(o.shipping_cost, 0) > 0
      THEN ROUND(
        (COALESCE(o.shipping_cost, 0)
          - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0)) * 100.0
        / o.shipping_cost,
        2
      )
      ELSE 0
    END AS margin_pct_net
  FROM public.orders o
  LEFT JOIN public.courier_channels cc ON cc.id = o.channel_id
  LEFT JOIN public.couriers cu ON cu.id = cc.courier_id
  WHERE o.organization_id = v_org
    AND o.order_date >= p_from
    AND o.order_date <= p_to
    AND (p_channel_id IS NULL OR o.channel_id = p_channel_id)
    AND (p_courier_id IS NULL OR cc.courier_id = p_courier_id)
    AND (p_status IS NULL OR p_status = 'ALL' OR o.status::TEXT = p_status)
  ORDER BY o.order_date DESC, o.id DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.shipping_diff_per_order(DATE, DATE, BIGINT, BIGINT, TEXT) TO authenticated;

-- ----------------------------------------------------------
-- 2. shipping_diff_summary — stat cards aggregate
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shipping_diff_summary(
  p_from DATE,
  p_to DATE,
  p_channel_id BIGINT DEFAULT NULL,
  p_courier_id BIGINT DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_orders BIGINT,
  total_ongkir_customer NUMERIC,
  total_ongkir_gross NUMERIC,
  total_ongkir_net NUMERIC,
  total_cashback NUMERIC,
  total_selisih_gross NUMERIC,
  total_selisih_net NUMERIC,
  avg_margin_pct_gross NUMERIC,
  avg_margin_pct_net NUMERIC,
  orders_with_loss BIGINT,
  orders_breakeven BIGINT,
  orders_profit BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  WITH order_diffs AS (
    SELECT
      o.id,
      COALESCE(o.shipping_cost, 0) AS customer,
      COALESCE(o.shipping_cost_actual, o.shipping_cost, 0) AS gross,
      COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0) AS net,
      GREATEST(
        COALESCE(o.shipping_cost_actual, o.shipping_cost, 0)
          - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0),
        0
      ) AS cashback,
      (COALESCE(o.shipping_cost, 0)
        - COALESCE(o.shipping_cost_actual, o.shipping_cost, 0)) AS sel_gross,
      (COALESCE(o.shipping_cost, 0)
        - COALESCE(o.estimated_shipping_net, o.shipping_cost_actual, o.shipping_cost, 0)) AS sel_net
    FROM public.orders o
    LEFT JOIN public.courier_channels cc ON cc.id = o.channel_id
    WHERE o.organization_id = v_org
      AND o.order_date >= p_from
      AND o.order_date <= p_to
      AND (p_channel_id IS NULL OR o.channel_id = p_channel_id)
      AND (p_courier_id IS NULL OR cc.courier_id = p_courier_id)
      AND (p_status IS NULL OR p_status = 'ALL' OR o.status::TEXT = p_status)
  )
  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(customer), 0)::NUMERIC,
    COALESCE(SUM(gross), 0)::NUMERIC,
    COALESCE(SUM(net), 0)::NUMERIC,
    COALESCE(SUM(cashback), 0)::NUMERIC,
    COALESCE(SUM(sel_gross), 0)::NUMERIC,
    COALESCE(SUM(sel_net), 0)::NUMERIC,
    CASE
      WHEN COALESCE(SUM(customer), 0) > 0
      THEN ROUND(COALESCE(SUM(sel_gross), 0) * 100.0 / SUM(customer), 2)
      ELSE 0
    END,
    CASE
      WHEN COALESCE(SUM(customer), 0) > 0
      THEN ROUND(COALESCE(SUM(sel_net), 0) * 100.0 / SUM(customer), 2)
      ELSE 0
    END,
    COUNT(*) FILTER (WHERE sel_net < 0)::BIGINT,
    COUNT(*) FILTER (WHERE sel_net = 0)::BIGINT,
    COUNT(*) FILTER (WHERE sel_net > 0)::BIGINT
  FROM order_diffs;
END $$;

GRANT EXECUTE ON FUNCTION public.shipping_diff_summary(DATE, DATE, BIGINT, BIGINT, TEXT) TO authenticated;

-- Refresh PostgREST schema cache (new RPCs visible immediately)
NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Done. Migration 024 idempotent.
-- =============================================================
