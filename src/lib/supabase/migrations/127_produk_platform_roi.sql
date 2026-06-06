-- =============================================================
-- Migration 127 — analytics_produk_platform + ad_spend/net_profit/ROI per sel
-- =============================================================
-- #2 Matriks Produk×Platform: biar bisa jawab "produk X bagus di platform Y"
-- pakai metrik KEBENARAN (laba bersih = laba kotor − alokasi ad spend, + ROI),
-- bukan cuma laba kotor. Ad spend di-alokasi: ad_spend → campaign(platform) →
-- campaign_products(product, allocation_pct).
-- Platform di orders = meta->>'platform' (META/GOOGLE/SNACK/TIKTOK) = nyambung
-- ke campaigns.platform. Idempotent.
-- =============================================================
DROP FUNCTION IF EXISTS public.analytics_produk_platform(date, date);

CREATE OR REPLACE FUNCTION public.analytics_produk_platform(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(
  product_id bigint, product_name text, platform text, total_order bigint, qty bigint,
  delivered bigint, retur bigint, return_rate numeric, penjualan numeric, omset numeric, gross_profit numeric,
  ad_spend numeric, net_profit numeric, roi numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH oi AS (
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
  ),
  -- ad spend di-alokasi ke (produk, platform) via campaign + allocation_pct
  spend_pp AS (
    SELECT cp.product_id, c.platform::text AS platform,
           SUM(COALESCE(a.spend,0) * COALESCE(cp.allocation_pct,100)/100.0) AS ad_spend
    FROM public.ad_spend a
    JOIN public.campaigns c ON c.id = a.campaign_id
    JOIN public.campaign_products cp ON cp.campaign_id = c.id
    WHERE c.organization_id = v_org
      AND (p_from IS NULL OR a.spend_date >= p_from) AND (p_to IS NULL OR a.spend_date <= p_to)
    GROUP BY cp.product_id, c.platform
  ),
  agg AS (
    SELECT
      oi.product_id AS pid, COALESCE(pr.display_name, pr.name, '?') AS pname, oi.platform AS plat,
      COUNT(DISTINCT oi.oid)::bigint AS tot,
      COALESCE(SUM(oi.qty),0)::bigint AS q,
      COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st='DITERIMA')::bigint AS deliv,
      COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st='RETUR')::bigint AS ret,
      CASE WHEN COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st IN ('DITERIMA','RETUR'))>0
        THEN ROUND(100.0*COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st='RETUR')/COUNT(DISTINCT oi.oid) FILTER (WHERE oi.st IN ('DITERIMA','RETUR')),1) ELSE 0 END AS rr,
      COALESCE(SUM(oi.barang*oi.share),0) AS jual,
      COALESCE(SUM(((oi.barang+oi.ongkir)-oi.bk)*oi.share),0) AS oms,
      COALESCE(SUM(oi.gp*oi.share),0) AS gp
    FROM oi LEFT JOIN public.products pr ON pr.id=oi.product_id
    WHERE (p_from IS NULL OR oi.order_date>=p_from) AND (p_to IS NULL OR oi.order_date<=p_to)
    GROUP BY oi.product_id, pr.display_name, pr.name, oi.platform
  )
  SELECT
    agg.pid, agg.pname, agg.plat, agg.tot, agg.q, agg.deliv, agg.ret, agg.rr, agg.jual, agg.oms, agg.gp,
    COALESCE(sp.ad_spend,0)::numeric AS ad_spend,
    (agg.gp - COALESCE(sp.ad_spend,0))::numeric AS net_profit,
    CASE WHEN COALESCE(sp.ad_spend,0) > 0
      THEN ROUND((agg.gp - sp.ad_spend) / sp.ad_spend * 100, 1) ELSE NULL END AS roi
  FROM agg LEFT JOIN spend_pp sp ON sp.product_id=agg.pid AND sp.platform=agg.plat
  ORDER BY (agg.gp - COALESCE(sp.ad_spend,0)) DESC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.analytics_produk_platform(date, date) TO authenticated;
