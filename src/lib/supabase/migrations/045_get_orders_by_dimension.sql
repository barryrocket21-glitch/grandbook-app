-- =============================================================
-- Phase 8I-Followup Part 4F — Group-by Insights RPC
-- Migration 045 — 2026-05-20
-- =============================================================
-- New RPC `get_orders_by_dimension(p_dimension, p_from, p_to, p_status)`:
--   Group orders by 1 dari 9 dimensi (city/province/product/supplier/channel/
--   status/payment_method/day/week/month) dan return:
--     - dimension_value (e.g. "KOTA KUPANG" untuk city)
--     - order_count
--     - total_value (SUM(total))
--     - total_payout (SUM(payout_amount))
--     - total_est_profit (SUM(estimated_profit))
--     - pct_of_total (% dari grand total dalam scope)
--
-- p_dimension whitelist di validate dengan IF NOT IN (...) RAISE EXCEPTION
-- untuk prevent SQL injection lewat dynamic CASE.
--
-- Idempotent via DROP IF EXISTS + CREATE OR REPLACE. SECURITY INVOKER +
-- SET search_path TO 'public' untuk lulus advisor.
-- =============================================================

DROP FUNCTION IF EXISTS public.get_orders_by_dimension(text, date, date, text);

CREATE OR REPLACE FUNCTION public.get_orders_by_dimension(
  p_dimension text DEFAULT 'city',
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS TABLE(
  dimension_value text,
  order_count bigint,
  total_value numeric,
  total_payout numeric,
  total_est_profit numeric,
  pct_of_total numeric
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id BIGINT; v_grand_count BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  IF p_dimension NOT IN ('city', 'province', 'product', 'supplier', 'channel', 'status', 'payment_method', 'day', 'week', 'month') THEN
    RAISE EXCEPTION 'Invalid dimension: %', p_dimension;
  END IF;

  SELECT COUNT(*) INTO v_grand_count FROM public.orders o
   WHERE o.organization_id = v_org_id
     AND (p_from IS NULL OR o.order_date >= p_from)
     AND (p_to IS NULL OR o.order_date <= p_to)
     AND (p_status IS NULL OR o.status = p_status);

  RETURN QUERY
  SELECT
    CASE p_dimension
      WHEN 'city'           THEN COALESCE(o.customer_city, '(no city)')
      WHEN 'province'       THEN COALESCE(o.customer_province, '(no province)')
      WHEN 'product'        THEN COALESCE((SELECT primary_p.name FROM public.order_items oi
                                            LEFT JOIN public.products primary_p ON primary_p.id = oi.product_id
                                            WHERE oi.order_id = o.id
                                            ORDER BY oi.id LIMIT 1), '(no product)')
      WHEN 'supplier'       THEN COALESCE((SELECT name FROM public.suppliers WHERE id = o.origin_supplier_id), '(no supplier)')
      WHEN 'channel'        THEN COALESCE((SELECT name FROM public.courier_channels WHERE id = o.channel_id), '(no channel)')
      WHEN 'status'         THEN o.status
      WHEN 'payment_method' THEN o.payment_method
      WHEN 'day'            THEN TO_CHAR(o.order_date, 'YYYY-MM-DD')
      WHEN 'week'           THEN TO_CHAR(o.order_date, 'YYYY-"W"IW')
      WHEN 'month'          THEN TO_CHAR(o.order_date, 'YYYY-MM')
    END AS dimension_value,
    COUNT(*)::BIGINT AS order_count,
    SUM(o.total) AS total_value,
    SUM(o.payout_amount) AS total_payout,
    SUM(o.estimated_profit) AS total_est_profit,
    CASE WHEN v_grand_count > 0
         THEN ROUND(COUNT(*) * 100.0 / v_grand_count, 1)
         ELSE 0 END AS pct_of_total
  FROM public.orders o
  WHERE o.organization_id = v_org_id
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to IS NULL OR o.order_date <= p_to)
    AND (p_status IS NULL OR o.status = p_status)
  GROUP BY dimension_value
  ORDER BY order_count DESC;
END;
$function$;
