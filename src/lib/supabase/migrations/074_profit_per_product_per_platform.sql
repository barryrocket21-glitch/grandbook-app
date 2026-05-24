-- =============================================================
-- 074 — Profit per produk per platform (Meta/Snack/Google)
-- =============================================================
-- Barry mau tau: "Paranet via Google profit berapa? via Snack berapa?"
-- Logic: attribution by AD SPEND share (proportional). Karena Meta tidak
-- report DITERIMA actual (cuma 'Pembelian' tracking which often inflated),
-- spend share = more honest attribution model.
--
-- Per platform untuk product X:
--   ad_spend_pct = (platform_ad_spend_per_product / total_ad_spend_per_product)
--   attributed_revenue = product_revenue × ad_spend_pct
--   attributed_hpp = product_hpp × ad_spend_pct
--   attributed_shipping = product_shipping × ad_spend_pct
--   attributed_komisi = product_komisi × ad_spend_pct
--   gross_profit = attributed_revenue - attributed_hpp - attributed_shipping - attributed_komisi
--   net_profit = gross_profit - platform_ad_spend
--   ROAS = attributed_revenue / platform_ad_spend
--
-- Edge cases:
-- - Produk dengan ad_spend = 0 di salah satu platform: row tidak muncul.
-- - Produk tanpa ad_spend di mana-mana: tidak ada per-platform breakdown
--   (revenue 100% organic).
-- - Multi-product campaign: campaign_products.allocation_pct dipakai untuk
--   distribute ad spend ke produk.
-- =============================================================

DROP FUNCTION IF EXISTS public.analytics_profit_per_product_per_platform(BIGINT, DATE, DATE);

CREATE OR REPLACE FUNCTION public.analytics_profit_per_product_per_platform(
  p_product_id BIGINT,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE(
  platform TEXT,
  total_ad_spend NUMERIC,
  total_conversions BIGINT,
  campaigns_count BIGINT,
  attribution_pct NUMERIC,
  attributed_revenue NUMERIC,
  attributed_hpp NUMERIC,
  attributed_shipping NUMERIC,
  attributed_komisi NUMERIC,
  gross_profit NUMERIC,
  net_profit NUMERIC,
  roas NUMERIC
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org BIGINT := current_org_id();
BEGIN
  RETURN QUERY
  WITH product_totals AS (
    SELECT
      COALESCE(SUM(o.total) FILTER (WHERE o.status = 'DITERIMA'), 0) AS revenue,
      COALESCE(SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)) FILTER (WHERE o.status = 'DITERIMA'), 0) AS hpp,
      COALESCE(SUM(o.shipping_cost_actual) FILTER (WHERE o.status = 'DITERIMA'), 0) AS shipping,
      COALESCE((
        SELECT SUM(c.amount)
        FROM commissions c
        JOIN order_items oi2 ON oi2.id = c.order_item_id
        JOIN orders o2 ON o2.id = c.order_id
        WHERE oi2.product_id = p_product_id
          AND o2.organization_id = v_org
          AND o2.order_date BETWEEN p_from AND p_to
          AND c.status IN ('EARNED', 'PAID')
      ), 0) AS komisi
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.organization_id = v_org
      AND oi.product_id = p_product_id
      AND o.order_date BETWEEN p_from AND p_to
  ),
  spend_per_platform AS (
    SELECT
      c.platform,
      SUM(a.spend_total * (cp.allocation_pct / 100.0)) AS plat_spend,
      SUM(a.conversions * (cp.allocation_pct / 100.0))::BIGINT AS plat_conv,
      COUNT(DISTINCT c.id) AS plat_campaigns
    FROM ad_spend a
    JOIN campaigns c ON c.id = a.campaign_id
    JOIN campaign_products cp ON cp.campaign_id = c.id
    WHERE a.organization_id = v_org
      AND cp.product_id = p_product_id
      AND a.spend_date BETWEEN p_from AND p_to
    GROUP BY c.platform
  ),
  total_spend_for_product AS (
    SELECT COALESCE(SUM(plat_spend), 0) AS total FROM spend_per_platform
  )
  SELECT
    spp.platform,
    ROUND(spp.plat_spend::numeric, 2),
    spp.plat_conv,
    spp.plat_campaigns,
    CASE WHEN tsp.total > 0
      THEN ROUND((spp.plat_spend / tsp.total * 100)::numeric, 2)
      ELSE 0 END AS attribution_pct,
    ROUND((pt.revenue * (spp.plat_spend / NULLIF(tsp.total, 0)))::numeric, 0) AS attributed_revenue,
    ROUND((pt.hpp * (spp.plat_spend / NULLIF(tsp.total, 0)))::numeric, 0) AS attributed_hpp,
    ROUND((pt.shipping * (spp.plat_spend / NULLIF(tsp.total, 0)))::numeric, 0) AS attributed_shipping,
    ROUND((pt.komisi * (spp.plat_spend / NULLIF(tsp.total, 0)))::numeric, 0) AS attributed_komisi,
    ROUND(((pt.revenue - pt.hpp - pt.shipping - pt.komisi) * (spp.plat_spend / NULLIF(tsp.total, 0)))::numeric, 0) AS gross_profit,
    ROUND((((pt.revenue - pt.hpp - pt.shipping - pt.komisi) * (spp.plat_spend / NULLIF(tsp.total, 0))) - spp.plat_spend)::numeric, 0) AS net_profit,
    CASE WHEN spp.plat_spend > 0
      THEN ROUND(((pt.revenue * (spp.plat_spend / NULLIF(tsp.total, 0))) / spp.plat_spend)::numeric, 2)
      ELSE 0 END AS roas
  FROM spend_per_platform spp
  CROSS JOIN product_totals pt
  CROSS JOIN total_spend_for_product tsp
  ORDER BY spp.plat_spend DESC;
END $function$;

GRANT EXECUTE ON FUNCTION public.analytics_profit_per_product_per_platform(BIGINT, DATE, DATE) TO authenticated;
