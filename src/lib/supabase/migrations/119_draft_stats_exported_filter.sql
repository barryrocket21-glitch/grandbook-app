-- 119 — Fix Antrian Kerja: kartu stats konsisten sama tabel (belum-export).
-- ============================================================================
-- BUG: tabel Antrian Kerja pakai p_exported=false (cuma order belum di-export),
-- tapi get_draft_status_stats ngitung SEMUA draft → angka stats (389) gak cocok
-- sama tabel (kosong, karena semua udah export). Tambah param p_exported biar
-- stats bisa di-filter sama kaya tabel. NULL = semua (backward compat).
-- Idempotent.

DROP FUNCTION IF EXISTS public.get_draft_status_stats(date, date, text);
CREATE OR REPLACE FUNCTION public.get_draft_status_stats(
  p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date,
  p_search text DEFAULT NULL::text, p_exported boolean DEFAULT NULL::boolean
)
 RETURNS TABLE(status text, cnt bigint, pct numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
  v_total BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  SELECT COUNT(*) INTO v_total
  FROM public.orders_draft o
  WHERE o.organization_id = v_org_id
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to IS NULL OR o.order_date <= p_to)
    AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%' OR o.customer_name ILIKE '%' || p_search || '%')
    AND (p_exported IS NULL OR (o.exported_at IS NOT NULL) = p_exported);

  RETURN QUERY
  SELECT
    o.status,
    COUNT(*)::BIGINT AS cnt,
    CASE WHEN v_total > 0 THEN ROUND(COUNT(*) * 100.0 / v_total, 1) ELSE 0 END AS pct
  FROM public.orders_draft o
  WHERE o.organization_id = v_org_id
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to IS NULL OR o.order_date <= p_to)
    AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%' OR o.customer_name ILIKE '%' || p_search || '%')
    AND (p_exported IS NULL OR (o.exported_at IS NOT NULL) = p_exported)
  GROUP BY o.status
  ORDER BY
    CASE o.status
      WHEN 'BARU' THEN 1
      WHEN 'SIAP_KIRIM' THEN 2
      WHEN 'DIKIRIM' THEN 3
      WHEN 'PROBLEM' THEN 4
      WHEN 'CANCEL' THEN 5
      ELSE 9
    END;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_draft_status_stats(date, date, text, boolean) TO authenticated;
