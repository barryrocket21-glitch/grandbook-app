-- 083 — Fix latent bug: analytics_roas_per_campaign type mismatch.
-- ============================================================================
-- RETURNS TABLE deklarasi total_conversions BIGINT, tapi body return
-- COALESCE(SUM(a.conversions), 0) di mana ad_spend.conversions = bigint →
-- SUM(bigint) di Postgres = NUMERIC → mismatch "structure of query does not
-- match function result type". Bug laten: gak pernah muncul karena RPC ini
-- return 0 row di prod (belum ada order ber-campaign_id). Begitu order punya
-- campaign_id (post Brief #3 attribution), RPC return row → error → /analytics
-- tab Overview/ROAS Campaign break.
-- Fix: cast COALESCE(sa.conv, 0)::bigint. Tidak ada perubahan logic lain.
-- Idempotent (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION public.analytics_roas_per_campaign(p_from date, p_to date)
RETURNS TABLE(campaign_id bigint, campaign_name text, platform text, status text, total_spend numeric, total_ppn numeric, total_spend_with_ppn numeric, total_conversions bigint, linked_products_count bigint, total_system_orders bigint, total_system_revenue numeric, roas_gross numeric, roas_diterima numeric, cost_per_conversion numeric, cost_per_order numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org BIGINT := current_org_id();
BEGIN
  RETURN QUERY
  WITH spend_agg AS (
    SELECT a.campaign_id,
      SUM(a.spend) AS spend,
      SUM(a.ppn_amount) AS ppn,
      SUM(a.spend_total) AS spend_total,
      SUM(a.conversions) AS conv
    FROM public.ad_spend a
    WHERE a.organization_id = v_org
      AND a.spend_date BETWEEN p_from AND p_to
    GROUP BY a.campaign_id
  ),
  linked AS (
    SELECT cp.campaign_id, COUNT(DISTINCT cp.product_id) AS linked_count
    FROM public.campaign_products cp
    GROUP BY cp.campaign_id
  ),
  orders_agg AS (
    SELECT o.campaign_id,
      COUNT(*) AS ord_count,
      SUM(o.total) FILTER (WHERE o.status = 'DITERIMA') AS rev_diterima,
      SUM(o.total) AS rev_gross
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.order_date BETWEEN p_from AND p_to
      AND o.campaign_id IS NOT NULL
    GROUP BY o.campaign_id
  )
  SELECT
    c.id, c.campaign_name, c.platform, c.status,
    COALESCE(sa.spend, 0), COALESCE(sa.ppn, 0), COALESCE(sa.spend_total, 0),
    COALESCE(sa.conv, 0)::bigint,
    COALESCE(l.linked_count, 0),
    COALESCE(oa.ord_count, 0),
    COALESCE(oa.rev_diterima, 0),
    CASE WHEN COALESCE(sa.spend_total, 0) > 0
      THEN ROUND((COALESCE(oa.rev_gross, 0) / sa.spend_total)::numeric, 2)
      ELSE 0 END,
    CASE WHEN COALESCE(sa.spend_total, 0) > 0
      THEN ROUND((COALESCE(oa.rev_diterima, 0) / sa.spend_total)::numeric, 2)
      ELSE 0 END,
    CASE WHEN COALESCE(sa.conv, 0) > 0
      THEN ROUND((COALESCE(sa.spend_total, 0) / sa.conv)::numeric, 2)
      ELSE 0 END,
    CASE WHEN COALESCE(oa.ord_count, 0) > 0
      THEN ROUND((COALESCE(sa.spend_total, 0) / oa.ord_count)::numeric, 2)
      ELSE 0 END
  FROM public.campaigns c
  LEFT JOIN spend_agg sa ON sa.campaign_id = c.id
  LEFT JOIN linked l ON l.campaign_id = c.id
  LEFT JOIN orders_agg oa ON oa.campaign_id = c.id
  WHERE c.organization_id = v_org
    AND (sa.spend IS NOT NULL OR oa.ord_count IS NOT NULL)
  ORDER BY COALESCE(sa.spend_total, 0) DESC;
END $function$;
