-- 150 — Data Orderan count contract: Fix Order counts both orders_draft and terminal final orders.
-- Barry's operational rule: /orders/data is the complete WA-copas order ledger; SPX sync and Sheet Master updates must reconcile to the same Fix Order count.

CREATE OR REPLACE FUNCTION public.list_data_orders(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id BIGINT,
  order_number TEXT,
  order_date DATE,
  spx_created_at TIMESTAMPTZ,
  status TEXT,
  fulfillment_category TEXT,
  customer_name TEXT,
  payment_method TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  cs_name TEXT,
  attribution_code_raw TEXT,
  product_summary TEXT,
  product_variation TEXT,
  total NUMERIC,
  cod_amount NUMERIC,
  tracking_no TEXT,
  tracking_status TEXT,
  exported_at TIMESTAMPTZ,
  channel_name TEXT,
  total_count BIGINT,
  fix_count BIGINT,
  non_coverage_count BIGINT,
  pending_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH base AS (
    SELECT
      d.id, d.order_number, d.order_date, d.spx_created_at, d.status, d.fulfillment_category,
      d.customer_name, d.payment_method, d.customer_phone, d.customer_city,
      COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = d.cs_id), d.cs_name) AS cs_name,
      d.attribution_code_raw,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items_draft oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = d.id), '—') AS product_summary,
      (SELECT STRING_AGG(COALESCE(oi.variation, ''), ', ' ORDER BY oi.id) FROM public.order_items_draft oi WHERE oi.order_id = d.id) AS product_variation,
      d.total, d.cod_amount, d.tracking_no, d.tracking_status,
      d.exported_at,
      (SELECT name FROM public.courier_channels cc WHERE cc.id = d.exported_channel_id) AS channel_name
    FROM public.orders_draft d
    WHERE d.organization_id = v_org
    UNION ALL
    SELECT
      o.id, o.order_number, o.order_date, o.spx_created_at, o.status, o.fulfillment_category,
      o.customer_name, o.payment_method, o.customer_phone, o.customer_city,
      COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = o.cs_id), o.cs_name) AS cs_name,
      o.attribution_code_raw,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = o.id), '—') AS product_summary,
      (SELECT STRING_AGG(COALESCE(oi.variation, ''), ', ' ORDER BY oi.id) FROM public.order_items oi WHERE oi.order_id = o.id) AS product_variation,
      o.total, o.cod_amount, o.tracking_no, o.tracking_status,
      NULL::timestamptz AS exported_at,
      (SELECT name FROM public.courier_channels cc WHERE cc.id = o.channel_id) AS channel_name
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.status IN ('DITERIMA','RETUR')
  ),
  filtered AS (
    SELECT * FROM base b
    WHERE (p_from IS NULL OR b.order_date >= p_from)
      AND (p_to IS NULL OR b.order_date <= p_to)
      AND (
        p_category IS NULL
        OR (p_category = 'FIX_ORDER'
            AND b.fulfillment_category = 'FIX_ORDER'
            AND b.spx_created_at IS NOT NULL
            AND COALESCE(NULLIF(BTRIM(COALESCE(b.tracking_no,'')),''), NULLIF(BTRIM(COALESCE(b.tracking_status,'')),'')) IS NOT NULL)
        OR (p_category = 'GB_NO_RESI'
            AND NOT (b.fulfillment_category = 'FIX_ORDER'
                     AND b.spx_created_at IS NOT NULL
                     AND COALESCE(NULLIF(BTRIM(COALESCE(b.tracking_no,'')),''), NULLIF(BTRIM(COALESCE(b.tracking_status,'')),'')) IS NOT NULL))
        OR (p_category NOT IN ('FIX_ORDER','GB_NO_RESI') AND b.fulfillment_category = p_category)
      )
      AND (p_search IS NULL
           OR b.order_number ILIKE '%'||p_search||'%'
           OR b.customer_name ILIKE '%'||p_search||'%'
           OR b.customer_phone ILIKE '%'||p_search||'%'
           OR COALESCE(b.attribution_code_raw,'') ILIKE '%'||p_search||'%'
           OR COALESCE(b.cs_name,'') ILIKE '%'||p_search||'%'
           OR COALESCE(b.tracking_no,'') ILIKE '%'||p_search||'%')
  ),
  cnt AS (
    SELECT COUNT(*)::BIGINT AS n,
           COUNT(*) FILTER (
             WHERE f.fulfillment_category = 'FIX_ORDER'
               AND f.spx_created_at IS NOT NULL
               AND COALESCE(NULLIF(BTRIM(COALESCE(f.tracking_no,'')),''), NULLIF(BTRIM(COALESCE(f.tracking_status,'')),'')) IS NOT NULL
           )::BIGINT AS fix_n,
           COUNT(*) FILTER (
             WHERE NOT (
               f.fulfillment_category = 'FIX_ORDER'
               AND f.spx_created_at IS NOT NULL
               AND COALESCE(NULLIF(BTRIM(COALESCE(f.tracking_no,'')),''), NULLIF(BTRIM(COALESCE(f.tracking_status,'')),'')) IS NOT NULL
             )
           )::BIGINT AS non_coverage_n,
           COUNT(*) FILTER (
             WHERE NOT (
               f.fulfillment_category = 'FIX_ORDER'
               AND f.spx_created_at IS NOT NULL
               AND COALESCE(NULLIF(BTRIM(COALESCE(f.tracking_no,'')),''), NULLIF(BTRIM(COALESCE(f.tracking_status,'')),'')) IS NOT NULL
             )
           )::BIGINT AS pending_n
    FROM filtered f
  )
  SELECT b.id, b.order_number, b.order_date, b.spx_created_at, b.status, b.fulfillment_category,
         b.customer_name, b.payment_method, b.customer_phone, b.customer_city,
         b.cs_name, b.attribution_code_raw, b.product_summary, b.product_variation,
         b.total, b.cod_amount, b.tracking_no, b.tracking_status,
         b.exported_at, b.channel_name,
         (SELECT n FROM cnt),
         (SELECT fix_n FROM cnt),
         (SELECT non_coverage_n FROM cnt),
         (SELECT pending_n FROM cnt)
  FROM filtered b
  ORDER BY b.exported_at DESC NULLS LAST, b.order_number DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

