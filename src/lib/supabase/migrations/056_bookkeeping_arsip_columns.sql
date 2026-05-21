-- 056 — Bookkeeping columns untuk Arsip (/orders/list).
-- Applied via Supabase MCP apply_migration (name: bookkeeping_columns_list_orders_enriched).
--
-- 1. Seed rts_shipping_rate utk SPX (channel 1) = 0 (retur SPX saat ini tidak
--    dikurangi ongkir). Channel lain: set lewat UI Rates (rate 1 = 1x ongkir).
-- 2. Extend list_orders_enriched dengan kolom finansial per-order:
--    EST (proyeksi, status-blind) + ACTUAL (status-aware: DITERIMA realized,
--    RETUR rugi ongkir, CANCEL/FAKE 0, in-flight NULL) + dicairkan + product_category.

INSERT INTO public.courier_channel_rates (channel_id, rate_key, rate_value, effective_from, notes)
SELECT 1, 'rts_shipping_rate', 0, DATE '2020-01-01', 'Retur SPX saat ini tidak dikurangi ongkir'
WHERE NOT EXISTS (
  SELECT 1 FROM public.courier_channel_rates
  WHERE channel_id = 1 AND rate_key = 'rts_shipping_rate'
);

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
  estimated_profit numeric, actual_profit numeric, profit_margin_pct numeric, shipping_diff numeric,
  days_in_status integer, is_repeat_customer boolean, cs_name text, advertiser_name text,
  campaign_name text, channel_name text, supplier_name text, is_multi_origin boolean,
  tags text[], internal_note text, customer_note text, reject_reason text, cs_attempts integer,
  order_date date, resi_printed_at timestamp with time zone, picked_up_at timestamp with time zone,
  delivered_at timestamp with time zone, returned_at timestamp with time zone,
  status_changed_at timestamp with time zone, last_contact_at timestamp with time zone,
  created_at timestamp with time zone, updated_at timestamp with time zone,
  product_summary text, product_count integer, total_qty integer, primary_product_name text,
  total_count bigint,
  product_category text,
  est_pendapatan numeric, est_fee_cod numeric, est_cashback numeric, est_ppn numeric,
  est_hpp numeric, est_omset numeric, est_margin numeric, est_fee_cs numeric, est_gross_profit numeric,
  act_pendapatan numeric, act_fee_cod numeric, act_cashback numeric, act_ppn numeric,
  act_hpp numeric, act_omset numeric, act_margin numeric, act_fee_cs numeric, act_gross_profit numeric,
  dicairkan numeric
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
      (ARRAY_AGG(COALESCE(p.name, oi.product_name_raw, 'Unknown') ORDER BY oi.id))[1] AS primary_product_name,
      (ARRAY_AGG(pc.name ORDER BY oi.id))[1] AS product_category
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.product_categories pc ON pc.id = p.category_id
    GROUP BY oi.order_id
  ),
  order_calc AS (
    SELECT
      fo.id AS order_id,
      COALESCE((SELECT SUM(oi.hpp_snapshot * oi.qty) FROM public.order_items oi WHERE oi.order_id = fo.id), 0) AS hpp,
      COALESCE(fo.shipping_cost, 0) * COALESCE(
        public.get_active_rate(fo.channel_id, 'rts_shipping_rate', COALESCE(fo.order_date, CURRENT_DATE)), 0
      ) AS rts_loss
    FROM filtered_orders fo
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
    (SELECT cnt FROM total) AS total_count,
    op.product_category AS product_category,
    fo.estimated_cash_in AS est_pendapatan,
    fo.estimated_cod_fee AS est_fee_cod,
    (COALESCE(fo.shipping_cost, 0) - COALESCE(fo.estimated_shipping_net, 0)) AS est_cashback,
    fo.estimated_ppn AS est_ppn,
    oc.hpp AS est_hpp,
    (COALESCE(fo.total, 0) - COALESCE(fo.estimated_total_cost, 0)) AS est_omset,
    (COALESCE(fo.total, 0) - COALESCE(fo.estimated_total_cost, 0) - oc.hpp) AS est_margin,
    ((COALESCE(fo.total, 0) - COALESCE(fo.estimated_total_cost, 0) - oc.hpp) - COALESCE(fo.estimated_profit, 0)) AS est_fee_cs,
    fo.estimated_profit AS est_gross_profit,
    CASE fo.status WHEN 'DITERIMA' THEN fo.estimated_cash_in WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_pendapatan,
    CASE fo.status WHEN 'DITERIMA' THEN fo.estimated_cod_fee WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_fee_cod,
    CASE fo.status WHEN 'DITERIMA' THEN (COALESCE(fo.shipping_cost, 0) - COALESCE(fo.estimated_shipping_net, 0)) WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_cashback,
    CASE fo.status WHEN 'DITERIMA' THEN fo.estimated_ppn WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_ppn,
    CASE fo.status WHEN 'DITERIMA' THEN oc.hpp WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_hpp,
    CASE fo.status WHEN 'DITERIMA' THEN (COALESCE(fo.total, 0) - COALESCE(fo.estimated_total_cost, 0)) WHEN 'RETUR' THEN -oc.rts_loss WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_omset,
    CASE fo.status WHEN 'DITERIMA' THEN (COALESCE(fo.total, 0) - COALESCE(fo.estimated_total_cost, 0) - oc.hpp) WHEN 'RETUR' THEN -oc.rts_loss WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_margin,
    CASE fo.status WHEN 'DITERIMA' THEN ((COALESCE(fo.total, 0) - COALESCE(fo.estimated_total_cost, 0) - oc.hpp) - COALESCE(fo.estimated_profit, 0)) WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_fee_cs,
    CASE fo.status WHEN 'DITERIMA' THEN fo.estimated_profit WHEN 'RETUR' THEN -oc.rts_loss WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_gross_profit,
    CASE WHEN fo.cod_settled_at IS NOT NULL THEN COALESCE(fo.payout_amount, fo.total) ELSE NULL END AS dicairkan
  FROM filtered_orders fo
  LEFT JOIN order_products op ON op.order_id = fo.id
  LEFT JOIN order_calc oc ON oc.order_id = fo.id
  ORDER BY fo.order_date DESC, fo.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_orders_enriched(date, date, text, text, integer, integer) TO authenticated;
