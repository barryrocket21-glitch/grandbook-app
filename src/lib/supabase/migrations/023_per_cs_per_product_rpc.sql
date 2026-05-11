-- =============================================================
-- Migration 023 — Phase 6 redesign: Analytics detail page per produk
--
-- Brief Phase 6 redesign (sidebar nav + detail page per produk) butuh
-- 2 helper RPC:
--   1. analytics_cs_performance_per_product — performa CS per produk
--      tertentu (aggregate dari daily_cs_report, group by cs_id)
--   2. analytics_campaigns_per_product — campaign yang link ke produk
--      tertentu via campaign_products + agregat spend/conversions/roas
--      dari ad_spend (proporsional allocation_pct)
-- =============================================================

-- ----------------------------------------------------------
-- 1. analytics_cs_performance_per_product
--    Returns per-CS lead+closing+close_rate untuk 1 produk
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_cs_performance_per_product(
  p_product_id BIGINT,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  cs_id UUID,
  cs_name TEXT,
  lead_count BIGINT,
  closing_count BIGINT,
  close_rate NUMERIC
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
    d.cs_id,
    p.full_name AS cs_name,
    COALESCE(SUM(d.lead_in), 0)::BIGINT AS lead_count,
    COALESCE(SUM(d.closing), 0)::BIGINT AS closing_count,
    CASE WHEN COALESCE(SUM(d.lead_in), 0) > 0
      THEN ROUND((COALESCE(SUM(d.closing), 0)::NUMERIC * 100 / SUM(d.lead_in))::NUMERIC, 2)
      ELSE 0
    END AS close_rate
  FROM public.daily_cs_report d
  LEFT JOIN public.profiles p ON p.id = d.cs_id
  WHERE d.organization_id = v_org
    AND d.product_id = p_product_id
    AND d.report_date >= p_from
    AND d.report_date <= p_to
  GROUP BY d.cs_id, p.full_name
  ORDER BY closing_count DESC, lead_count DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_cs_performance_per_product(BIGINT, DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 2. analytics_campaigns_per_product
--    Returns campaign yang link ke produk + agregat metrics dari ad_spend
--    (proporsional allocation_pct dari campaign_products)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_campaigns_per_product(
  p_product_id BIGINT,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  campaign_id BIGINT,
  campaign_name TEXT,
  platform TEXT,
  campaign_status TEXT,
  allocation_pct NUMERIC,
  total_spend NUMERIC,
  total_conversions BIGINT,
  total_impressions BIGINT,
  total_clicks BIGINT,
  meta_lead_count BIGINT,
  roas NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
  v_revenue NUMERIC;
BEGIN
  -- Total revenue produk untuk hitung ROAS
  SELECT COALESCE(SUM(oi.qty * oi.price), 0) INTO v_revenue
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.organization_id = v_org
    AND oi.product_id = p_product_id
    AND o.order_date >= p_from AND o.order_date <= p_to;

  RETURN QUERY
  SELECT
    c.id,
    c.campaign_name,
    c.platform,
    c.status,
    cp.allocation_pct,
    COALESCE(SUM(a.spend * cp.allocation_pct / 100.0), 0) AS total_spend,
    COALESCE(SUM(COALESCE(a.conversions, 0) * cp.allocation_pct / 100.0), 0)::BIGINT AS total_conversions,
    COALESCE(SUM(COALESCE(a.impressions, 0) * cp.allocation_pct / 100.0), 0)::BIGINT AS total_impressions,
    COALESCE(SUM(COALESCE(a.clicks, 0) * cp.allocation_pct / 100.0), 0)::BIGINT AS total_clicks,
    COALESCE(SUM(COALESCE(a.meta_lead_count, 0) * cp.allocation_pct / 100.0), 0)::BIGINT AS meta_lead_count,
    CASE WHEN COALESCE(SUM(a.spend * cp.allocation_pct / 100.0), 0) > 0
      THEN ROUND((v_revenue / SUM(a.spend * cp.allocation_pct / 100.0))::NUMERIC, 2)
      ELSE 0
    END AS roas
  FROM public.campaign_products cp
  JOIN public.campaigns c ON c.id = cp.campaign_id
  LEFT JOIN public.ad_spend a ON a.campaign_id = cp.campaign_id
    AND a.spend_date >= p_from AND a.spend_date <= p_to
    AND a.organization_id = v_org
  WHERE cp.organization_id = v_org
    AND cp.product_id = p_product_id
  GROUP BY c.id, c.campaign_name, c.platform, c.status, cp.allocation_pct
  ORDER BY total_spend DESC NULLS LAST, c.campaign_name ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_campaigns_per_product(BIGINT, DATE, DATE) TO authenticated;

-- =============================================================
-- Done. Migration 023 idempotent — safe to re-run.
-- =============================================================
