-- 154 — Data Orderan summary funnel math.
-- Barry's dashboard-card contract:
--   GB No Resi = Overall Input Order - Fix Order
-- even when Overall uses Tanggal Terbit GB and Fix Order uses independent Tanggal Create SPX.
-- This changes summary pending/non-coverage counts, not the base SPX apply data.

DROP FUNCTION IF EXISTS public.list_data_orders(date, date, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.list_data_orders(date, date, text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.list_data_orders(date, date, text, text, integer, integer, text, date, date, date, date);

CREATE OR REPLACE FUNCTION public.list_data_orders(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
  p_date_basis TEXT DEFAULT 'order_date',
  p_gb_from DATE DEFAULT NULL,
  p_gb_to DATE DEFAULT NULL,
  p_spx_from DATE DEFAULT NULL,
  p_spx_to DATE DEFAULT NULL
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
DECLARE
  v_org BIGINT;
  v_gb_from DATE;
  v_gb_to DATE;
  v_spx_from DATE;
  v_spx_to DATE;
BEGIN
  v_org := public.current_org_id();

  v_gb_from := p_gb_from;
  v_gb_to := p_gb_to;
  v_spx_from := p_spx_from;
  v_spx_to := p_spx_to;

  IF v_gb_from IS NULL AND v_gb_to IS NULL AND v_spx_from IS NULL AND v_spx_to IS NULL THEN
    IF COALESCE(NULLIF(BTRIM(p_date_basis), ''), 'order_date') = 'spx_created_at' THEN
      v_spx_from := p_from;
      v_spx_to := p_to;
    ELSE
      v_gb_from := p_from;
      v_gb_to := p_to;
    END IF;
  END IF;

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
  searchable AS (
    SELECT b.*,
           (
             b.fulfillment_category = 'FIX_ORDER'
             AND b.spx_created_at IS NOT NULL
             AND COALESCE(NULLIF(BTRIM(COALESCE(b.tracking_no,'')),''), NULLIF(BTRIM(COALESCE(b.tracking_status,'')),'')) IS NOT NULL
           ) AS is_fix_order
    FROM base b
    WHERE (p_search IS NULL
           OR b.order_number ILIKE '%'||p_search||'%'
           OR b.customer_name ILIKE '%'||p_search||'%'
           OR b.customer_phone ILIKE '%'||p_search||'%'
           OR COALESCE(b.attribution_code_raw,'') ILIKE '%'||p_search||'%'
           OR COALESCE(b.cs_name,'') ILIKE '%'||p_search||'%'
           OR COALESCE(b.tracking_no,'') ILIKE '%'||p_search||'%')
  ),
  gb_scoped AS (
    SELECT * FROM searchable s
    WHERE (v_gb_from IS NULL OR s.order_date >= v_gb_from)
      AND (v_gb_to IS NULL OR s.order_date <= v_gb_to)
  ),
  fix_scoped AS (
    SELECT * FROM searchable s
    WHERE s.is_fix_order
      AND (v_spx_from IS NULL OR s.spx_created_at::date >= v_spx_from)
      AND (v_spx_to IS NULL OR s.spx_created_at::date <= v_spx_to)
  ),
  row_filtered AS (
    SELECT * FROM gb_scoped s
    WHERE p_category IS NULL
       OR (p_category = 'GB_NO_RESI' AND NOT s.is_fix_order)
       OR (p_category NOT IN ('FIX_ORDER','GB_NO_RESI') AND s.fulfillment_category = p_category)
    UNION ALL
    SELECT * FROM fix_scoped s
    WHERE p_category = 'FIX_ORDER'
  ),
  cnt AS (
    SELECT
      (SELECT COUNT(*)::BIGINT FROM row_filtered) AS row_n,
      (SELECT COUNT(*)::BIGINT FROM fix_scoped) AS fix_n,
      GREATEST(
        (SELECT COUNT(*)::BIGINT FROM gb_scoped) - (SELECT COUNT(*)::BIGINT FROM fix_scoped),
        0::BIGINT
      ) AS no_resi_n
  )
  SELECT b.id, b.order_number, b.order_date, b.spx_created_at, b.status, b.fulfillment_category,
         b.customer_name, b.payment_method, b.customer_phone, b.customer_city,
         b.cs_name, b.attribution_code_raw, b.product_summary, b.product_variation,
         b.total, b.cod_amount, b.tracking_no, b.tracking_status,
         b.exported_at, b.channel_name,
         (SELECT row_n FROM cnt),
         (SELECT fix_n FROM cnt),
         (SELECT no_resi_n FROM cnt),
         (SELECT no_resi_n FROM cnt)
  FROM row_filtered b
  ORDER BY b.exported_at DESC NULLS LAST, b.order_number DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_data_orders(date, date, text, text, integer, integer, text, date, date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_data_orders(date, date, text, text, integer, integer, text, date, date, date, date) TO authenticated;
