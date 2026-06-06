-- =============================================================
-- Migration 128 — analytics_cs_dimension: CS × (produk / platform)
-- =============================================================
-- #3 Matriks CS: tau produk & platform mana COCOK buat tiap CS — via order
-- (cs_id + meta->>'platform' + items.product + status). Per (cs, produk,
-- platform): order, terkirim (DITERIMA), retur. Client pivot ke CS×Produk
-- (sum platform) atau CS×Platform (sum produk).
-- Order multi-item (jarang, WA paste 1-item) bisa double-count antar produk —
-- diterima karena dominan 1-item. Idempotent.
-- =============================================================
DROP FUNCTION IF EXISTS public.analytics_cs_dimension(date, date);

CREATE OR REPLACE FUNCTION public.analytics_cs_dimension(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(
  cs_id uuid, cs_name text, product_id bigint, product_name text, platform text,
  orders bigint, delivered bigint, retur bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH base AS (
    SELECT d.cs_id, i.product_id, COALESCE(d.meta->>'platform','(tanpa platform)') AS platform,
           d.status::text AS st, d.id AS oid, d.order_date
    FROM public.order_items_draft i JOIN public.orders_draft d ON d.id=i.order_id
    WHERE d.organization_id=v_org AND d.cs_id IS NOT NULL AND i.product_id IS NOT NULL
    UNION ALL
    SELECT o.cs_id, i.product_id, COALESCE(o.meta->>'platform','(tanpa platform)'),
           o.status::text, o.id, o.order_date
    FROM public.order_items i JOIN public.orders o ON o.id=i.order_id
    WHERE o.organization_id=v_org AND o.cs_id IS NOT NULL AND i.product_id IS NOT NULL
  )
  SELECT
    b.cs_id, COALESCE(p.full_name,'?') AS cs_name,
    b.product_id, COALESCE(pr.display_name, pr.name, '?') AS product_name, b.platform,
    COUNT(DISTINCT b.oid)::bigint AS orders,
    COUNT(DISTINCT b.oid) FILTER (WHERE b.st='DITERIMA')::bigint AS delivered,
    COUNT(DISTINCT b.oid) FILTER (WHERE b.st='RETUR')::bigint AS retur
  FROM base b
  JOIN public.profiles p ON p.id=b.cs_id
  LEFT JOIN public.products pr ON pr.id=b.product_id
  WHERE (p_from IS NULL OR b.order_date>=p_from) AND (p_to IS NULL OR b.order_date<=p_to)
  GROUP BY b.cs_id, p.full_name, b.product_id, pr.display_name, pr.name, b.platform;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.analytics_cs_dimension(date, date) TO authenticated;
