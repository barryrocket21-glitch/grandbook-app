-- 093 — Enhancement: expose tracking_no di list_orders_draft_enriched.
-- ============================================================================
-- Sync SPX (#13) udah nulis tracking_no, tapi list RPC belum return → Post-Export
-- gak bisa nampilin nomor resi. Tambah tracking_no ke return (read-only).
-- Signature return berubah → DROP dulu. Body identik mig 091 + 1 kolom.
-- Idempotent. INVOKER.

DROP FUNCTION IF EXISTS public.list_orders_draft_enriched(date, date, text, text, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.list_orders_draft_enriched(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
  p_exported BOOLEAN DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT,
  order_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  customer_province TEXT,
  customer_subdistrict TEXT,
  customer_zip TEXT,
  wilayah_id BIGINT,
  status TEXT,
  priority TEXT,
  payment_method TEXT,
  subtotal NUMERIC,
  total NUMERIC,
  cod_amount NUMERIC,
  estimated_profit NUMERIC,
  cs_name TEXT,
  channel_name TEXT,
  product_summary TEXT,
  product_count INTEGER,
  cs_attempts INTEGER,
  internal_note TEXT,
  customer_note TEXT,
  reject_reason TEXT,
  last_contact_at TIMESTAMPTZ,
  order_date DATE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  exported_at TIMESTAMPTZ,
  exported_channel_name TEXT,
  tracking_no TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  RETURN QUERY
  WITH filtered AS (
    SELECT o.*
    FROM public.orders_draft o
    WHERE o.organization_id = v_org_id
      AND (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to IS NULL OR o.order_date <= p_to)
      AND (p_status IS NULL OR o.status = p_status)
      AND (
        p_exported IS NULL
        OR (p_exported = TRUE AND o.exported_at IS NOT NULL)
        OR (p_exported = FALSE AND o.exported_at IS NULL)
      )
      AND (
        p_search IS NULL
        OR o.order_number ILIKE '%' || p_search || '%'
        OR o.customer_name ILIKE '%' || p_search || '%'
        OR COALESCE(o.customer_phone, '') ILIKE '%' || p_search || '%'
      )
  ),
  products_agg AS (
    SELECT
      oi.order_id,
      STRING_AGG(
        COALESCE(p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)',
        ', '
        ORDER BY oi.id
      ) AS summary,
      COUNT(*)::INT AS cnt
    FROM public.order_items_draft oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id IN (SELECT id FROM filtered)
    GROUP BY oi.order_id
  ),
  total AS (SELECT COUNT(*) AS cnt FROM filtered)
  SELECT
    fo.id,
    fo.order_number,
    fo.customer_name,
    fo.customer_phone,
    fo.customer_city,
    fo.customer_province,
    fo.customer_subdistrict,
    fo.customer_zip,
    fo.wilayah_id,
    fo.status,
    fo.priority,
    fo.payment_method,
    fo.subtotal,
    fo.total,
    fo.cod_amount,
    fo.estimated_profit,
    COALESCE((SELECT full_name FROM public.profiles WHERE id = fo.cs_id), fo.cs_name) AS cs_name,
    (SELECT name FROM public.courier_channels WHERE id = fo.channel_id) AS channel_name,
    COALESCE(pa.summary, '—') AS product_summary,
    COALESCE(pa.cnt, 0) AS product_count,
    fo.cs_attempts,
    fo.internal_note,
    fo.customer_note,
    fo.reject_reason,
    fo.last_contact_at,
    fo.order_date,
    fo.created_at,
    fo.updated_at,
    fo.exported_at,
    (SELECT name FROM public.courier_channels WHERE id = fo.exported_channel_id) AS exported_channel_name,
    fo.tracking_no,
    (SELECT cnt FROM total) AS total_count
  FROM filtered fo
  LEFT JOIN products_agg pa ON pa.order_id = fo.id
  ORDER BY fo.created_at DESC, fo.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_orders_draft_enriched(date, date, text, text, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_orders_draft_enriched(date, date, text, text, integer, integer, boolean) TO authenticated;
