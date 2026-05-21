-- 064 — Phase 8C: RPC analytics_variant_per_product.
-- Applied via Supabase MCP (apply_migration: analytics_variant_per_product_rpc).
--
-- Performa per varian untuk 1 produk: qty, omset, HPP, gross profit, margin,
-- diterima/retur per varian. Dipakai di /analytics/produk/[id].
-- Item variant_id NULL digabung ke bucket "(varian tidak terdeteksi)".
-- SECURITY INVOKER — RLS orders scope ke org pemanggil.

DROP FUNCTION IF EXISTS public.analytics_variant_per_product(bigint, date, date);

CREATE OR REPLACE FUNCTION public.analytics_variant_per_product(
  p_product_id bigint,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE(
  variant_id bigint,
  variant_name text,
  order_count bigint,
  qty_sold bigint,
  revenue numeric,
  hpp numeric,
  gross_profit numeric,
  margin_pct numeric,
  diterima_count bigint,
  retur_count bigint,
  retur_pct numeric
)
LANGUAGE plpgsql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org bigint;
BEGIN
  v_org := public.current_org_id();

  RETURN QUERY
  WITH it AS (
    SELECT oi.variant_id AS vid, oi.qty, oi.price,
           COALESCE(oi.hpp_snapshot, 0) AS hpp_snap,
           o.id AS oid, o.status
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.product_id = p_product_id
      AND o.organization_id = v_org
      AND (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to IS NULL OR o.order_date <= p_to)
      AND o.status NOT IN ('CANCEL', 'FAKE')
  ),
  agg AS (
    SELECT
      it.vid,
      COUNT(DISTINCT it.oid) AS order_count,
      COALESCE(SUM(it.qty), 0) AS qty_sold,
      COALESCE(SUM(it.price * it.qty), 0) AS revenue,
      COALESCE(SUM(it.hpp_snap * it.qty), 0) AS hpp,
      COUNT(DISTINCT it.oid) FILTER (WHERE it.status = 'DITERIMA') AS diterima_count,
      COUNT(DISTINCT it.oid) FILTER (WHERE it.status = 'RETUR') AS retur_count
    FROM it
    GROUP BY it.vid
  )
  SELECT
    agg.vid,
    COALESCE(v.variant_name, '(varian tidak terdeteksi)'),
    agg.order_count::bigint,
    agg.qty_sold::bigint,
    agg.revenue,
    agg.hpp,
    agg.revenue - agg.hpp,
    CASE WHEN agg.revenue > 0
      THEN ROUND(100.0 * (agg.revenue - agg.hpp) / agg.revenue, 1)
      ELSE 0 END,
    agg.diterima_count::bigint,
    agg.retur_count::bigint,
    CASE WHEN (agg.diterima_count + agg.retur_count) > 0
      THEN ROUND(100.0 * agg.retur_count / (agg.diterima_count + agg.retur_count), 1)
      ELSE 0 END
  FROM agg
  LEFT JOIN public.product_variants v ON v.id = agg.vid
  ORDER BY agg.revenue DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.analytics_variant_per_product(bigint, date, date) TO authenticated;
