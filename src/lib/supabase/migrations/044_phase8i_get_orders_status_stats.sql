-- =============================================================
-- Phase 8I-Followup Part 3 — Statistics Bar di /orders/list
-- Migration 044 — 2026-05-20
-- =============================================================
-- New RPC `get_orders_status_stats(p_from, p_to, p_search)`:
--   Return breakdown count + percentage per status, filter-aware
--   (date range + search). Tidak filter by status sendiri supaya semua
--   status tetap tampil di bar walau user lagi filter ke 1 status.
--
-- Order priority: DITERIMA (success) → DIKIRIM → SIAP_KIRIM → PROBLEM →
-- RETUR → CANCEL → BARU → FAKE (lowest, biasanya hidden).
--
-- SECURITY INVOKER (default) + SET search_path TO 'public' supaya kena
-- RLS + tidak ke-flag advisor function_search_path_mutable.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_orders_status_stats(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE(
  status text,
  cnt bigint,
  pct numeric
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id BIGINT; v_total BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  SELECT COUNT(*) INTO v_total
  FROM public.orders o
  WHERE o.organization_id = v_org_id
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to IS NULL OR o.order_date <= p_to)
    AND (p_search IS NULL OR
         o.order_number ILIKE '%' || p_search || '%' OR
         o.resi ILIKE '%' || p_search || '%' OR
         o.customer_name ILIKE '%' || p_search || '%' OR
         o.customer_phone ILIKE '%' || p_search || '%');

  RETURN QUERY
  SELECT
    o.status,
    COUNT(*)::BIGINT AS cnt,
    CASE WHEN v_total > 0 THEN ROUND(COUNT(*) * 100.0 / v_total, 1) ELSE 0 END AS pct
  FROM public.orders o
  WHERE o.organization_id = v_org_id
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to IS NULL OR o.order_date <= p_to)
    AND (p_search IS NULL OR
         o.order_number ILIKE '%' || p_search || '%' OR
         o.resi ILIKE '%' || p_search || '%' OR
         o.customer_name ILIKE '%' || p_search || '%' OR
         o.customer_phone ILIKE '%' || p_search || '%')
  GROUP BY o.status
  ORDER BY
    CASE o.status
      WHEN 'DITERIMA' THEN 1
      WHEN 'DIKIRIM' THEN 2
      WHEN 'SIAP_KIRIM' THEN 3
      WHEN 'PROBLEM' THEN 4
      WHEN 'RETUR' THEN 5
      WHEN 'CANCEL' THEN 6
      WHEN 'BARU' THEN 7
      WHEN 'FAKE' THEN 8
      ELSE 9
    END;
END;
$function$;
