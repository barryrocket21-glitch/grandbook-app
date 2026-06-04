-- 123 — #2 Performa: CS Scorecard · Campaign Net-Profit · Produk×Platform.
-- ============================================================================
-- 3 RPC analitik baca union orders_draft+orders (id draft dinegatif).
--   penjualan = total (barang) · omset = (total+ongkir) − biaya_kurir ·
--   gross_profit = estimated_profit · return_rate = retur/(delivered+retur).
-- Campaign: gabung ad_spend (spend + meta_lead_count) → CPR/CPA/CPA Final/ROAS/ROI/laba bersih.
-- INVOKER, org-scoped, idempotent. Owner/admin only (UI gate).

-- ===== CS Scorecard =========================================================
DROP FUNCTION IF EXISTS public.analytics_cs_scorecard(date, date);
CREATE OR REPLACE FUNCTION public.analytics_cs_scorecard(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(
  cs_id uuid, cs_name text, total_order bigint, delivered bigint, retur bigint, inflight bigint,
  return_rate numeric, penjualan numeric, omset numeric, gross_profit numeric, gross_profit_real numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH o AS (
    SELECT cs_id, status::text AS st, COALESCE(total,0) AS barang, COALESCE(shipping_cost,0) AS ongkir,
           COALESCE(estimated_total_cost,0) AS bk, COALESCE(estimated_profit,0) AS gp, order_date
    FROM public.orders_draft WHERE organization_id=v_org
    UNION ALL
    SELECT cs_id, status::text, COALESCE(total,0), COALESCE(shipping_cost,0), COALESCE(estimated_total_cost,0), COALESCE(estimated_profit,0), order_date
    FROM public.orders WHERE organization_id=v_org
  )
  SELECT
    o.cs_id, COALESCE(p.full_name,'(tanpa CS)') AS cs_name,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE o.st='DITERIMA')::bigint,
    COUNT(*) FILTER (WHERE o.st='RETUR')::bigint,
    COUNT(*) FILTER (WHERE o.st IN ('BARU','SIAP_KIRIM','DIKIRIM','PROBLEM'))::bigint,
    CASE WHEN COUNT(*) FILTER (WHERE o.st IN ('DITERIMA','RETUR'))>0
      THEN ROUND(100.0*COUNT(*) FILTER (WHERE o.st='RETUR')/COUNT(*) FILTER (WHERE o.st IN ('DITERIMA','RETUR')),1) ELSE 0 END,
    COALESCE(SUM(o.barang),0),
    COALESCE(SUM((o.barang+o.ongkir)-o.bk),0),
    COALESCE(SUM(o.gp),0),
    COALESCE(SUM(o.gp) FILTER (WHERE o.st='DITERIMA'),0)
  FROM o LEFT JOIN public.profiles p ON p.id=o.cs_id
  WHERE (p_from IS NULL OR o.order_date>=p_from) AND (p_to IS NULL OR o.order_date<=p_to)
  GROUP BY o.cs_id, p.full_name
  ORDER BY COALESCE(SUM(o.gp) FILTER (WHERE o.st='DITERIMA'),0) DESC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.analytics_cs_scorecard(date, date) TO authenticated;

-- ===== Campaign Net-Profit ==================================================
DROP FUNCTION IF EXISTS public.analytics_campaign_profit(date, date);
CREATE OR REPLACE FUNCTION public.analytics_campaign_profit(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(
  campaign_id bigint, campaign_name text, platform text, akun text, marker text, advertiser_name text,
  spend numeric, leads bigint, total_order bigint, delivered bigint, retur bigint, return_rate numeric,
  cpr numeric, cpa numeric, cpa_final numeric, omset numeric, gross_profit numeric,
  roas numeric, roi numeric, net_profit numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH o AS (
    SELECT campaign_id, status::text AS st, COALESCE(total,0) AS barang, COALESCE(shipping_cost,0) AS ongkir,
           COALESCE(estimated_total_cost,0) AS bk, COALESCE(estimated_profit,0) AS gp, order_date
    FROM public.orders_draft WHERE organization_id=v_org AND campaign_id IS NOT NULL
    UNION ALL
    SELECT campaign_id, status::text, COALESCE(total,0), COALESCE(shipping_cost,0), COALESCE(estimated_total_cost,0), COALESCE(estimated_profit,0), order_date
    FROM public.orders WHERE organization_id=v_org AND campaign_id IS NOT NULL
  ),
  agg AS (
    SELECT o.campaign_id,
      COUNT(*)::bigint AS n_order,
      COUNT(*) FILTER (WHERE o.st='DITERIMA')::bigint AS n_deliv,
      COUNT(*) FILTER (WHERE o.st='RETUR')::bigint AS n_retur,
      COALESCE(SUM((o.barang+o.ongkir)-o.bk),0) AS omset,
      COALESCE(SUM(o.gp),0) AS gp
    FROM o WHERE (p_from IS NULL OR o.order_date>=p_from) AND (p_to IS NULL OR o.order_date<=p_to)
    GROUP BY o.campaign_id
  ),
  sp AS (
    SELECT campaign_id, COALESCE(SUM(spend),0) AS spend, COALESCE(SUM(meta_lead_count),0)::bigint AS leads
    FROM public.ad_spend WHERE organization_id=v_org AND (p_from IS NULL OR spend_date>=p_from) AND (p_to IS NULL OR spend_date<=p_to)
    GROUP BY campaign_id
  )
  SELECT
    c.id, c.campaign_name, a.platform, a.account_code, c.campaign_marker, pr.full_name,
    COALESCE(sp.spend,0), COALESCE(sp.leads,0),
    COALESCE(agg.n_order,0), COALESCE(agg.n_deliv,0), COALESCE(agg.n_retur,0),
    CASE WHEN COALESCE(agg.n_deliv,0)+COALESCE(agg.n_retur,0)>0 THEN ROUND(100.0*agg.n_retur/(agg.n_deliv+agg.n_retur),1) ELSE 0 END,
    CASE WHEN COALESCE(sp.leads,0)>0 THEN ROUND(sp.spend/sp.leads) ELSE 0 END,
    CASE WHEN COALESCE(agg.n_order,0)>0 THEN ROUND(sp.spend/agg.n_order) ELSE 0 END,
    CASE WHEN COALESCE(agg.n_deliv,0)>0 THEN ROUND(sp.spend/agg.n_deliv) ELSE 0 END,
    COALESCE(agg.omset,0), COALESCE(agg.gp,0),
    CASE WHEN COALESCE(sp.spend,0)>0 THEN ROUND(agg.omset/sp.spend,2) ELSE 0 END,
    CASE WHEN COALESCE(sp.spend,0)>0 THEN ROUND(100.0*(agg.gp-sp.spend)/sp.spend,1) ELSE 0 END,
    (COALESCE(agg.gp,0)-COALESCE(sp.spend,0))
  FROM public.campaigns c
  JOIN public.ad_accounts a ON a.id=c.account_id
  LEFT JOIN public.profiles pr ON pr.id=a.advertiser_id
  LEFT JOIN agg ON agg.campaign_id=c.id
  LEFT JOIN sp ON sp.campaign_id=c.id
  WHERE c.organization_id=v_org AND (COALESCE(agg.n_order,0)>0 OR COALESCE(sp.spend,0)>0)
  ORDER BY (COALESCE(agg.gp,0)-COALESCE(sp.spend,0)) DESC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.analytics_campaign_profit(date, date) TO authenticated;

-- ===== Produk × Platform ====================================================
DROP FUNCTION IF EXISTS public.analytics_produk_platform(date, date);
CREATE OR REPLACE FUNCTION public.analytics_produk_platform(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(
  product_id bigint, product_name text, platform text, total_order bigint, qty bigint,
  delivered bigint, retur bigint, return_rate numeric, penjualan numeric, omset numeric, gross_profit numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH oi AS (
    -- per item: bagi rata angka order ke item (proporsi qty), platform dari meta
    SELECT i.product_id, COALESCE(d.meta->>'platform','(tanpa platform)') AS platform, d.status::text AS st,
           i.qty, COALESCE(d.estimated_profit,0) AS gp, COALESCE(d.total,0) AS barang, COALESCE(d.shipping_cost,0) AS ongkir,
           COALESCE(d.estimated_total_cost,0) AS bk, d.id AS oid, d.order_date,
           (i.qty::numeric / NULLIF(SUM(i.qty) OVER (PARTITION BY d.id),0)) AS share
    FROM public.order_items_draft i JOIN public.orders_draft d ON d.id=i.order_id
    WHERE d.organization_id=v_org AND i.product_id IS NOT NULL
    UNION ALL
    SELECT i.product_id, COALESCE(o.meta->>'platform','(tanpa platform)'), o.status::text,
           i.qty, COALESCE(o.estimated_profit,0), COALESCE(o.total,0), COALESCE(o.shipping_cost,0),
           COALESCE(o.estimated_total_cost,0), o.id, o.order_date,
           (i.qty::numeric / NULLIF(SUM(i.qty) OVER (PARTITION BY o.id),0))
    FROM public.order_items i JOIN public.orders o ON o.id=i.order_id
    WHERE o.organization_id=v_org AND i.product_id IS NOT NULL
  )
  SELECT
    oi.product_id, COALESCE(pr.display_name, pr.name, '?') AS product_name, oi.platform,
    COUNT(DISTINCT oi.oid)::bigint,
    COALESCE(SUM(oi.qty),0)::bigint,
    COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st='DITERIMA')::bigint,
    COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st='RETUR')::bigint,
    CASE WHEN COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st IN ('DITERIMA','RETUR'))>0
      THEN ROUND(100.0*COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st='RETUR')/COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st IN ('DITERIMA','RETUR')),1) ELSE 0 END,
    COALESCE(SUM(oi.barang*oi.share),0),
    COALESCE(SUM(((oi.barang+oi.ongkir)-oi.bk)*oi.share),0),
    COALESCE(SUM(oi.gp*oi.share),0)
  FROM oi LEFT JOIN public.products pr ON pr.id=oi.product_id
  WHERE (p_from IS NULL OR oi.order_date>=p_from) AND (p_to IS NULL OR oi.order_date<=p_to)
  GROUP BY oi.product_id, pr.display_name, pr.name, oi.platform
  ORDER BY COALESCE(SUM(oi.gp*oi.share),0) DESC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.analytics_produk_platform(date, date) TO authenticated;
