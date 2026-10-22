-- Read-only P&L performance: same signature, totals, grants and invoker context.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.laba_rugi_summary(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(order_count bigint, diterima_count bigint, retur_count bigint, batal_count bigint, inflight_count bigint, retur_pct numeric, est_penjualan numeric, est_selisih_ongkir numeric, est_fee_admin numeric, est_omset numeric, est_hpp numeric, est_fee_cs numeric, est_gross_profit numeric, act_penjualan numeric, act_selisih_ongkir numeric, act_fee_admin numeric, act_omset numeric, act_hpp numeric, act_fee_cs numeric, act_gross_profit numeric, total_ad_spend numeric, total_opex numeric, laba_bersih_est numeric, laba_bersih_act numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT; v_ad NUMERIC; v_opex NUMERIC;
BEGIN
  v_org := public.current_org_id();
  SELECT COALESCE(SUM(spend), 0) INTO v_ad FROM public.ad_spend WHERE organization_id = v_org AND (p_from IS NULL OR spend_date >= p_from) AND (p_to IS NULL OR spend_date <= p_to);
  SELECT COALESCE(SUM(amount), 0) INTO v_opex FROM public.operational_expenses WHERE organization_id = v_org AND (p_from IS NULL OR expense_date >= p_from) AND (p_to IS NULL OR expense_date <= p_to);

  RETURN QUERY
  WITH selected_orders AS MATERIALIZED (
    SELECT o.* FROM public.v_orders_union o
    WHERE o.organization_id = v_org
      AND (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to IS NULL OR o.order_date <= p_to)
  ), item_hpp AS MATERIALIZED (
    SELECT oi.order_id,
      SUM((oi.hpp_snapshot + COALESCE(oi.packing_fee_snapshot,0)) * oi.qty) AS hpp
    FROM public.v_order_items_union oi
    JOIN selected_orders o ON o.id = oi.order_id
    GROUP BY oi.order_id
  ), ord AS MATERIALIZED (
    SELECT o.status,
      COALESCE(o.total,0) AS penjualan,
      (COALESCE(o.shipping_cost,0) - COALESCE(o.estimated_shipping_net,0)) AS selisih_ongkir,
      (COALESCE(o.estimated_cod_fee,0) + COALESCE(o.estimated_ppn,0)) AS fee_admin,
      COALESCE(o.estimated_profit, 0) AS gp,
      COALESCE(ih.hpp, 0) AS hpp,
      CASE WHEN o.status = 'RETUR' THEN COALESCE(o.shipping_cost, 0) * COALESCE(public.get_active_rate(o.channel_id, 'rts_shipping_rate', COALESCE(o.order_date, CURRENT_DATE)), 0) ELSE 0::numeric END AS rts_loss
    FROM selected_orders o LEFT JOIN item_hpp ih ON ih.order_id = o.id
  ),
  calc AS (
    SELECT status, penjualan, selisih_ongkir, fee_admin, hpp, gp, rts_loss,
      (penjualan + selisih_ongkir - fee_admin) AS omset,
      (((penjualan + selisih_ongkir - fee_admin) - hpp) - gp) AS fee_cs
    FROM ord
  )
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE status='DITERIMA')::bigint, COUNT(*) FILTER (WHERE status='RETUR')::bigint,
    COUNT(*) FILTER (WHERE status IN ('CANCEL','FAKE'))::bigint, COUNT(*) FILTER (WHERE status IN ('BARU','SIAP_KIRIM','DIKIRIM','PROBLEM'))::bigint,
    CASE WHEN COUNT(*) FILTER (WHERE status IN ('DITERIMA','RETUR')) > 0 THEN ROUND(100.0 * COUNT(*) FILTER (WHERE status='RETUR') / COUNT(*) FILTER (WHERE status IN ('DITERIMA','RETUR')), 2) ELSE 0 END,
    COALESCE(SUM(penjualan),0), COALESCE(SUM(selisih_ongkir),0), COALESCE(SUM(fee_admin),0), COALESCE(SUM(omset),0), COALESCE(SUM(hpp),0), COALESCE(SUM(fee_cs),0), COALESCE(SUM(gp),0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN penjualan ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN selisih_ongkir ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN fee_admin ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN omset WHEN status='RETUR' THEN -rts_loss ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN hpp ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN fee_cs ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN gp WHEN status='RETUR' THEN -rts_loss ELSE 0 END),0),
    v_ad, v_opex,
    COALESCE(SUM(gp),0) - v_ad - v_opex,
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN gp WHEN status='RETUR' THEN -rts_loss ELSE 0 END),0) - v_ad - v_opex
  FROM calc;
END;
$function$
;

COMMIT;
