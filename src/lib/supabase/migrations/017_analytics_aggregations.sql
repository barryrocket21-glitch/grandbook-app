-- =============================================================
-- Migration 017 — Phase 4B: Analytics Aggregations
--
-- Server-side aggregation RPCs untuk dashboard /analytics, /cs-dashboard,
-- /adv-dashboard. Semua function `STABLE SECURITY DEFINER` + scoped ke
-- `current_org_id()` supaya RLS tetap dihormati.
--
-- Date filtering pakai `BETWEEN p_from AND p_to` inclusive di kolom
-- `orders.order_date` (tipe DATE — no timezone shenanigan).
-- =============================================================

-- ----------------------------------------------------------
-- 1. analytics_overview(from, to) — single-row aggregate untuk owner
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_overview(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  total_orders BIGINT,
  total_revenue NUMERIC,
  total_cogs NUMERIC,
  total_shipping_charged NUMERIC,
  total_shipping_actual NUMERIC,
  total_payout NUMERIC,
  total_commissions_estimated NUMERIC,
  total_commissions_earned NUMERIC,
  total_commissions_paid NUMERIC,
  orders_baru BIGINT,
  orders_siap_kirim BIGINT,
  orders_dikirim BIGINT,
  orders_diterima BIGINT,
  orders_problem BIGINT,
  orders_retur BIGINT,
  orders_cancel BIGINT,
  orders_fake BIGINT
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
  WITH order_stats AS (
    SELECT
      COUNT(*)::BIGINT AS total_orders,
      COALESCE(SUM(total), 0)::NUMERIC AS total_revenue,
      COALESCE(SUM(shipping_cost), 0)::NUMERIC AS total_shipping_charged,
      COALESCE(SUM(shipping_cost_actual), 0)::NUMERIC AS total_shipping_actual,
      COALESCE(SUM(payout_amount), 0)::NUMERIC AS total_payout,
      COUNT(*) FILTER (WHERE status = 'BARU')::BIGINT AS baru,
      COUNT(*) FILTER (WHERE status = 'SIAP_KIRIM')::BIGINT AS siap,
      COUNT(*) FILTER (WHERE status = 'DIKIRIM')::BIGINT AS kirim,
      COUNT(*) FILTER (WHERE status = 'DITERIMA')::BIGINT AS terima,
      COUNT(*) FILTER (WHERE status = 'PROBLEM')::BIGINT AS problem,
      COUNT(*) FILTER (WHERE status = 'RETUR')::BIGINT AS retur,
      COUNT(*) FILTER (WHERE status = 'CANCEL')::BIGINT AS cancel,
      COUNT(*) FILTER (WHERE status = 'FAKE')::BIGINT AS fake
    FROM public.orders
    WHERE organization_id = v_org
      AND order_date BETWEEN p_from AND p_to
  ),
  cogs_stats AS (
    SELECT COALESCE(SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)), 0)::NUMERIC AS total_cogs
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.organization_id = v_org
      AND o.order_date BETWEEN p_from AND p_to
  ),
  comm_stats AS (
    SELECT
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'ESTIMATED'), 0)::NUMERIC AS est,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'EARNED'), 0)::NUMERIC AS earn,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'PAID'), 0)::NUMERIC AS paid
    FROM public.commissions c
    JOIN public.orders o ON o.id = c.order_id
    WHERE o.organization_id = v_org
      AND o.order_date BETWEEN p_from AND p_to
  )
  SELECT
    os.total_orders,
    os.total_revenue,
    cs.total_cogs,
    os.total_shipping_charged,
    os.total_shipping_actual,
    os.total_payout,
    cms.est,
    cms.earn,
    cms.paid,
    os.baru,
    os.siap,
    os.kirim,
    os.terima,
    os.problem,
    os.retur,
    os.cancel,
    os.fake
  FROM order_stats os
  CROSS JOIN cogs_stats cs
  CROSS JOIN comm_stats cms;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_overview(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 2. analytics_daily_revenue(from, to) — line chart series
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_daily_revenue(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  day DATE,
  total_orders BIGINT,
  revenue NUMERIC,
  diterima_orders BIGINT,
  retur_orders BIGINT
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
    o.order_date AS day,
    COUNT(*)::BIGINT AS total_orders,
    COALESCE(SUM(o.total), 0)::NUMERIC AS revenue,
    COUNT(*) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS diterima_orders,
    COUNT(*) FILTER (WHERE o.status = 'RETUR')::BIGINT AS retur_orders
  FROM public.orders o
  WHERE o.organization_id = v_org
    AND o.order_date BETWEEN p_from AND p_to
  GROUP BY o.order_date
  ORDER BY o.order_date;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_daily_revenue(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 3. analytics_per_cs(from, to) — breakdown per CS
-- Conversion rate = diterima / (diterima + retur) — hanya orders final.
-- Commission sums dari role='cs' di range yang sama.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_per_cs(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  cs_id UUID,
  cs_name TEXT,
  total_orders BIGINT,
  total_revenue NUMERIC,
  diterima_orders BIGINT,
  retur_orders BIGINT,
  conversion_rate NUMERIC,
  total_commission_earned NUMERIC,
  total_commission_paid NUMERIC
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
  WITH cs_orders AS (
    SELECT
      o.cs_id,
      o.id AS order_id,
      o.total,
      o.status
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.cs_id IS NOT NULL
      AND o.order_date BETWEEN p_from AND p_to
  ),
  cs_agg AS (
    SELECT
      co.cs_id,
      COUNT(*)::BIGINT AS total_orders,
      COALESCE(SUM(co.total), 0)::NUMERIC AS total_revenue,
      COUNT(*) FILTER (WHERE co.status = 'DITERIMA')::BIGINT AS diterima_orders,
      COUNT(*) FILTER (WHERE co.status = 'RETUR')::BIGINT AS retur_orders,
      CASE
        WHEN COUNT(*) FILTER (WHERE co.status IN ('DITERIMA', 'RETUR')) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE co.status = 'DITERIMA')::NUMERIC * 100.0 /
          COUNT(*) FILTER (WHERE co.status IN ('DITERIMA', 'RETUR')),
          2
        )
        ELSE 0
      END AS conversion_rate
    FROM cs_orders co
    GROUP BY co.cs_id
  ),
  cs_comm AS (
    SELECT
      co.cs_id,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'EARNED'), 0)::NUMERIC AS earned,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'PAID'), 0)::NUMERIC AS paid
    FROM public.commissions c
    JOIN cs_orders co ON co.order_id = c.order_id
    WHERE c.role = 'cs'
    GROUP BY co.cs_id
  )
  SELECT
    a.cs_id,
    p.full_name AS cs_name,
    a.total_orders,
    a.total_revenue,
    a.diterima_orders,
    a.retur_orders,
    a.conversion_rate,
    COALESCE(cm.earned, 0)::NUMERIC AS total_commission_earned,
    COALESCE(cm.paid, 0)::NUMERIC AS total_commission_paid
  FROM cs_agg a
  LEFT JOIN public.profiles p ON p.id = a.cs_id
  LEFT JOIN cs_comm cm ON cm.cs_id = a.cs_id
  ORDER BY a.total_orders DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_per_cs(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 4. analytics_per_advertiser(from, to) — mirror of per_cs
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_per_advertiser(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  advertiser_id UUID,
  advertiser_name TEXT,
  total_orders BIGINT,
  total_revenue NUMERIC,
  diterima_orders BIGINT,
  retur_orders BIGINT,
  conversion_rate NUMERIC,
  total_commission_earned NUMERIC,
  total_commission_paid NUMERIC
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
  WITH adv_orders AS (
    SELECT
      o.advertiser_id,
      o.id AS order_id,
      o.total,
      o.status
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.advertiser_id IS NOT NULL
      AND o.order_date BETWEEN p_from AND p_to
  ),
  adv_agg AS (
    SELECT
      ao.advertiser_id,
      COUNT(*)::BIGINT AS total_orders,
      COALESCE(SUM(ao.total), 0)::NUMERIC AS total_revenue,
      COUNT(*) FILTER (WHERE ao.status = 'DITERIMA')::BIGINT AS diterima_orders,
      COUNT(*) FILTER (WHERE ao.status = 'RETUR')::BIGINT AS retur_orders,
      CASE
        WHEN COUNT(*) FILTER (WHERE ao.status IN ('DITERIMA', 'RETUR')) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE ao.status = 'DITERIMA')::NUMERIC * 100.0 /
          COUNT(*) FILTER (WHERE ao.status IN ('DITERIMA', 'RETUR')),
          2
        )
        ELSE 0
      END AS conversion_rate
    FROM adv_orders ao
    GROUP BY ao.advertiser_id
  ),
  adv_comm AS (
    SELECT
      ao.advertiser_id,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'EARNED'), 0)::NUMERIC AS earned,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'PAID'), 0)::NUMERIC AS paid
    FROM public.commissions c
    JOIN adv_orders ao ON ao.order_id = c.order_id
    WHERE c.role = 'advertiser'
    GROUP BY ao.advertiser_id
  )
  SELECT
    a.advertiser_id,
    p.full_name AS advertiser_name,
    a.total_orders,
    a.total_revenue,
    a.diterima_orders,
    a.retur_orders,
    a.conversion_rate,
    COALESCE(cm.earned, 0)::NUMERIC AS total_commission_earned,
    COALESCE(cm.paid, 0)::NUMERIC AS total_commission_paid
  FROM adv_agg a
  LEFT JOIN public.profiles p ON p.id = a.advertiser_id
  LEFT JOIN adv_comm cm ON cm.advertiser_id = a.advertiser_id
  ORDER BY a.total_orders DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_per_advertiser(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 5. analytics_per_channel(from, to) — breakdown per courier channel
-- shipping_diff = charged - actual (positive = profit margin)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_per_channel(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  channel_id BIGINT,
  channel_code TEXT,
  channel_name TEXT,
  total_orders BIGINT,
  total_revenue NUMERIC,
  total_shipping_charged NUMERIC,
  total_shipping_actual NUMERIC,
  shipping_diff NUMERIC,
  diterima_orders BIGINT,
  retur_orders BIGINT,
  total_payout NUMERIC
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
    o.channel_id,
    cc.code AS channel_code,
    cc.name AS channel_name,
    COUNT(*)::BIGINT AS total_orders,
    COALESCE(SUM(o.total), 0)::NUMERIC AS total_revenue,
    COALESCE(SUM(o.shipping_cost), 0)::NUMERIC AS total_shipping_charged,
    COALESCE(SUM(o.shipping_cost_actual), 0)::NUMERIC AS total_shipping_actual,
    (COALESCE(SUM(o.shipping_cost), 0) - COALESCE(SUM(o.shipping_cost_actual), 0))::NUMERIC AS shipping_diff,
    COUNT(*) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS diterima_orders,
    COUNT(*) FILTER (WHERE o.status = 'RETUR')::BIGINT AS retur_orders,
    COALESCE(SUM(o.payout_amount), 0)::NUMERIC AS total_payout
  FROM public.orders o
  LEFT JOIN public.courier_channels cc ON cc.id = o.channel_id
  WHERE o.organization_id = v_org
    AND o.channel_id IS NOT NULL
    AND o.order_date BETWEEN p_from AND p_to
  GROUP BY o.channel_id, cc.code, cc.name
  ORDER BY COUNT(*) DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_per_channel(DATE, DATE) TO authenticated;
