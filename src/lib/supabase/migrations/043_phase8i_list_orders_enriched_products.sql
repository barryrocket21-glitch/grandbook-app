-- =============================================================
-- Phase 8I-Followup Part 2 — Kolom Produk di /orders/list
-- Migration 043 — 2026-05-20
-- =============================================================
-- ALTER list_orders_enriched RPC untuk return 4 kolom baru:
--   - product_summary text       : "Nama Produk (Nx), Nama Produk2 (Mx)"
--   - product_count integer      : COUNT(*) order_items per order
--   - total_qty integer          : SUM(qty)
--   - primary_product_name text  : nama produk pertama (untuk filter/sort)
--
-- Aggregation via CTE `order_products` (LEFT JOIN ke products by id, fallback
-- ke product_name_raw kalau product_id NULL = unmatched product Phase 8.5).
--
-- IMPORTANT: DROP FUNCTION first karena return type berubah (Postgres ga
-- support ALTER RETURN TYPE pada function existing). Idempotent via DROP IF EXISTS.
-- =============================================================

DROP FUNCTION IF EXISTS public.list_orders_enriched(date, date, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.list_orders_enriched(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id bigint, order_number text, external_order_id text, resi text, status text,
  priority text, payment_method text, customer_name text, customer_phone text,
  customer_city text, customer_province text, subtotal numeric, discount numeric,
  shipping_cost numeric, shipping_cost_actual numeric, total numeric, payout_amount numeric,
  estimated_profit numeric, actual_profit numeric, profit_margin_pct numeric,
  shipping_diff numeric, days_in_status integer, is_repeat_customer boolean,
  cs_name text, advertiser_name text, campaign_name text, channel_name text,
  supplier_name text, is_multi_origin boolean, tags text[], internal_note text,
  customer_note text, reject_reason text, cs_attempts integer, order_date date,
  resi_printed_at timestamptz, picked_up_at timestamptz, delivered_at timestamptz,
  returned_at timestamptz, status_changed_at timestamptz, last_contact_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  -- Phase 8I-Followup Part 2:
  product_summary text,
  product_count integer,
  total_qty integer,
  primary_product_name text,
  total_count bigint
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();
  RETURN QUERY
  WITH filtered_orders AS (
    SELECT o.* FROM public.orders o
     WHERE o.organization_id = v_org_id
       AND (p_from IS NULL OR o.order_date >= p_from)
       AND (p_to IS NULL OR o.order_date <= p_to)
       AND (p_status IS NULL OR o.status = p_status)
       AND (p_search IS NULL OR
            o.order_number ILIKE '%' || p_search || '%' OR
            o.resi ILIKE '%' || p_search || '%' OR
            o.customer_name ILIKE '%' || p_search || '%' OR
            o.customer_phone ILIKE '%' || p_search || '%')
  ),
  customer_counts AS (
    SELECT customer_phone, COUNT(*) AS cnt FROM public.orders
     WHERE organization_id = v_org_id AND customer_phone IS NOT NULL
       AND status NOT IN ('FAKE', 'CANCEL') GROUP BY customer_phone
  ),
  order_products AS (
    SELECT
      oi.order_id,
      STRING_AGG(
        COALESCE(p.name, oi.product_name_raw, 'Unknown') || ' (' || oi.qty || 'x)',
        ', ' ORDER BY oi.id
      ) AS product_summary,
      COUNT(*)::INT AS product_count,
      SUM(oi.qty)::INT AS total_qty,
      (ARRAY_AGG(COALESCE(p.name, oi.product_name_raw, 'Unknown') ORDER BY oi.id))[1] AS primary_product_name
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    GROUP BY oi.order_id
  ),
  total AS (SELECT COUNT(*) AS cnt FROM filtered_orders)
  SELECT
    fo.id, fo.order_number, fo.external_order_id, fo.resi, fo.status,
    fo.priority, fo.payment_method, fo.customer_name, fo.customer_phone,
    fo.customer_city, fo.customer_province, fo.subtotal, fo.discount,
    fo.shipping_cost, fo.shipping_cost_actual, fo.total, fo.payout_amount,
    fo.estimated_profit,
    CASE WHEN fo.payout_amount IS NOT NULL THEN
      COALESCE(fo.payout_amount, 0)
      - COALESCE(fo.shipping_cost_actual, fo.shipping_cost, 0)
      - COALESCE((SELECT SUM(oi.hpp_snapshot * oi.qty) FROM public.order_items oi WHERE oi.order_id = fo.id), 0)
    ELSE NULL END AS actual_profit,
    CASE WHEN fo.payout_amount IS NOT NULL AND fo.total > 0 THEN
      ROUND(((COALESCE(fo.payout_amount, 0)
        - COALESCE(fo.shipping_cost_actual, fo.shipping_cost, 0)
        - COALESCE((SELECT SUM(oi.hpp_snapshot * oi.qty) FROM public.order_items oi WHERE oi.order_id = fo.id), 0)
      ) / fo.total) * 100, 2)
    ELSE NULL END AS profit_margin_pct,
    CASE WHEN fo.shipping_cost_actual IS NOT NULL THEN
      fo.shipping_cost_actual - fo.shipping_cost
    ELSE NULL END AS shipping_diff,
    EXTRACT(DAY FROM (NOW() - COALESCE(fo.status_changed_at, fo.created_at)))::INT AS days_in_status,
    COALESCE((SELECT cc.cnt > 1 FROM customer_counts cc WHERE cc.customer_phone = fo.customer_phone), FALSE) AS is_repeat_customer,
    (SELECT full_name FROM public.profiles WHERE id = fo.cs_id) AS cs_name,
    (SELECT full_name FROM public.profiles WHERE id = fo.advertiser_id) AS advertiser_name,
    (SELECT campaign_name FROM public.campaigns WHERE id = fo.campaign_id) AS campaign_name,
    (SELECT name FROM public.courier_channels WHERE id = fo.channel_id) AS channel_name,
    (SELECT name FROM public.suppliers WHERE id = fo.origin_supplier_id) AS supplier_name,
    fo.is_multi_origin, fo.tags, fo.internal_note, fo.customer_note,
    fo.reject_reason, fo.cs_attempts, fo.order_date, fo.resi_printed_at,
    fo.picked_up_at, fo.delivered_at, fo.returned_at, fo.status_changed_at,
    fo.last_contact_at, fo.created_at, fo.updated_at,
    COALESCE(op.product_summary, '—') AS product_summary,
    COALESCE(op.product_count, 0) AS product_count,
    COALESCE(op.total_qty, 0) AS total_qty,
    op.primary_product_name AS primary_product_name,
    (SELECT cnt FROM total) AS total_count
  FROM filtered_orders fo
  LEFT JOIN order_products op ON op.order_id = fo.id
  ORDER BY fo.order_date DESC, fo.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;
