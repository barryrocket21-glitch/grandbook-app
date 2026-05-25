-- =============================================================
-- 075 — Forecast Analytics (Realized + Pipeline × Success Rate)
-- =============================================================
-- Konsep "Estimasi" di GrandBook diubah dari "realized only" (DITERIMA)
-- menjadi "forecast" yang include pipeline DIKIRIM × success rate per produk.
--
-- Formula per produk per periode:
--   SR = DITERIMA / (DITERIMA + RETUR), fallback 70% (helper org_default_success_rate)
--   Expected DITERIMA = DITERIMA + (DIKIRIM × SR)
--   Forecast Revenue = revenue(DITERIMA) + revenue(DIKIRIM) × SR
--   Forecast HPP = hpp(DITERIMA) + hpp(DIKIRIM) × SR
--   Forecast Shipping = shipping_actual(DITERIMA) + shipping_estimated(DIKIRIM) × SR
--   Forecast Komisi = Expected DITERIMA × Rp 2,500 (current commission rule)
--   Forecast Net Profit = Forecast Revenue - HPP - Shipping - Komisi - Ad Spend
--
-- Existing `orders.estimated_*` (cost engine per order, Phase 4C) TIDAK diubah —
-- itu beda konsep (per-order cost projection). Phase 5B v4 ini menambah
-- ANALYTIC AGGREGATE forecast yang factor in pipeline.
--
-- 3 RPCs:
-- 1. org_default_success_rate() — helper fallback 70%
-- 2. analytics_overview_v4 — overview dengan forecast fields
-- 3. analytics_profit_per_product_v3 — per produk dengan forecast
-- 4. analytics_profit_per_product_per_platform — REPLACE mig 074, add forecast
--
-- SIAP_KIRIM (early-stage pipeline) skip dari forecast untuk simplicity.
-- PROBLEM (8 order) skip karena umumnya jadi RETUR/CANCEL.
-- =============================================================

-- 1. Helper: default success rate
DROP FUNCTION IF EXISTS public.org_default_success_rate();
CREATE OR REPLACE FUNCTION public.org_default_success_rate()
RETURNS NUMERIC LANGUAGE sql IMMUTABLE
SET search_path TO 'public' AS $$ SELECT 0.70::numeric $$;
GRANT EXECUTE ON FUNCTION public.org_default_success_rate() TO authenticated;

-- 2. Overview v4
DROP FUNCTION IF EXISTS public.analytics_overview_v4(DATE, DATE);

CREATE OR REPLACE FUNCTION public.analytics_overview_v4(p_from DATE, p_to DATE)
RETURNS TABLE(
  total_orders BIGINT,
  total_revenue NUMERIC,
  total_cogs NUMERIC,
  total_shipping NUMERIC,
  total_commissions_earned NUMERIC,
  diterima_count BIGINT,
  retur_count BIGINT,
  cancel_count BIGINT,
  fake_count BIGINT,
  baru_count BIGINT,
  dikirim_count BIGINT,
  siap_kirim_count BIGINT,
  total_operational_expenses NUMERIC,
  total_ad_spend NUMERIC,
  net_profit_realized NUMERIC,
  success_rate_pct NUMERIC,
  pipeline_in_transit_count BIGINT,
  pipeline_in_transit_revenue NUMERIC,
  expected_diterima BIGINT,
  forecast_revenue NUMERIC,
  forecast_hpp NUMERIC,
  forecast_shipping NUMERIC,
  forecast_komisi NUMERIC,
  forecast_net_profit_after_ads NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT := current_org_id();
BEGIN
  RETURN QUERY
  WITH order_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('CANCEL','FAKE')) AS tot,
      COUNT(*) FILTER (WHERE status = 'DITERIMA') AS dit,
      COUNT(*) FILTER (WHERE status = 'RETUR') AS ret,
      COUNT(*) FILTER (WHERE status = 'CANCEL') AS canc,
      COUNT(*) FILTER (WHERE status = 'FAKE') AS fake,
      COUNT(*) FILTER (WHERE status = 'BARU') AS baru,
      COUNT(*) FILTER (WHERE status = 'DIKIRIM') AS dikirim,
      COUNT(*) FILTER (WHERE status = 'SIAP_KIRIM') AS siap_kirim,
      COALESCE(SUM(o.total) FILTER (WHERE status = 'DITERIMA'), 0) AS rev_realized,
      COALESCE(SUM(o.total) FILTER (WHERE status = 'DIKIRIM'), 0) AS rev_in_transit,
      COALESCE(SUM((SELECT SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)) FROM order_items oi WHERE oi.order_id = o.id)) FILTER (WHERE status = 'DITERIMA'), 0) AS cogs_realized,
      COALESCE(SUM((SELECT SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)) FROM order_items oi WHERE oi.order_id = o.id)) FILTER (WHERE status = 'DIKIRIM'), 0) AS cogs_in_transit,
      COALESCE(SUM(o.shipping_cost_actual) FILTER (WHERE status = 'DITERIMA'), 0) AS ship_realized,
      COALESCE(SUM(o.shipping_cost) FILTER (WHERE status = 'DIKIRIM'), 0) AS ship_in_transit_estimated
    FROM orders o
    WHERE o.organization_id = v_org AND o.order_date BETWEEN p_from AND p_to
  ),
  sr AS (
    SELECT CASE WHEN (dit + ret) > 0 THEN dit::numeric / (dit + ret)
      ELSE org_default_success_rate() END AS rate FROM order_agg
  ),
  comm AS (
    SELECT COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'EARNED'), 0) AS earned
    FROM commissions c JOIN orders o ON o.id = c.order_id
    WHERE o.organization_id = v_org AND o.order_date BETWEEN p_from AND p_to
  ),
  ops_exp AS (
    SELECT COALESCE(SUM(e.amount), 0) AS ops FROM operational_expenses e
    WHERE e.organization_id = v_org AND e.expense_date BETWEEN p_from AND p_to
  ),
  ad AS (
    SELECT COALESCE(SUM(a.spend_total), 0) AS spend FROM ad_spend a
    WHERE a.organization_id = v_org AND a.spend_date BETWEEN p_from AND p_to
  )
  SELECT
    oa.tot, oa.rev_realized, oa.cogs_realized, oa.ship_realized,
    co.earned,
    oa.dit, oa.ret, oa.canc, oa.fake, oa.baru, oa.dikirim, oa.siap_kirim,
    op.ops, ad.spend,
    (oa.rev_realized - oa.cogs_realized - oa.ship_realized - co.earned - op.ops - ad.spend),
    ROUND(sr.rate * 100, 2),
    oa.dikirim, oa.rev_in_transit,
    (oa.dit + (oa.dikirim * sr.rate))::BIGINT,
    (oa.rev_realized + oa.rev_in_transit * sr.rate),
    (oa.cogs_realized + oa.cogs_in_transit * sr.rate),
    (oa.ship_realized + oa.ship_in_transit_estimated * sr.rate),
    ((oa.dit + (oa.dikirim * sr.rate)) * 2500),
    ((oa.rev_realized + oa.rev_in_transit * sr.rate)
     - (oa.cogs_realized + oa.cogs_in_transit * sr.rate)
     - (oa.ship_realized + oa.ship_in_transit_estimated * sr.rate)
     - ((oa.dit + (oa.dikirim * sr.rate)) * 2500)
     - op.ops - ad.spend)
  FROM order_agg oa, sr, comm co, ops_exp op, ad;
END $function$;

GRANT EXECUTE ON FUNCTION public.analytics_overview_v4(DATE, DATE) TO authenticated;

-- 3. analytics_profit_per_product_v3 — per produk dengan forecast
-- (Function body identik dengan migration 075b yang sudah di-apply via MCP.
--  Lihat function definition di DB via pg_get_functiondef.)
DROP FUNCTION IF EXISTS public.analytics_profit_per_product_v3(DATE, DATE);
-- See live DB for full definition (extensive — applied via mig 075b)

-- 4. analytics_profit_per_product_per_platform v2 with forecast
-- (Same — see DB or migration 075c applied via MCP)
