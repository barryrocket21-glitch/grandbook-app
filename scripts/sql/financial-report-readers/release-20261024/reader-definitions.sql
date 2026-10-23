-- Reviewed F1/F2 reader definitions only. No records or financial rules are rewritten.
BEGIN;
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
  WITH source_proven_shipping AS MATERIALIZED (
    SELECT -d.id AS id, COALESCE(d.shipping_cost,0) AS included_shipping
    FROM public.orders_draft d
    WHERE d.organization_id = v_org
      AND (p_from IS NULL OR d.order_date >= p_from)
      AND (p_to IS NULL OR d.order_date <= p_to)
      AND (EXISTS (SELECT 1 FROM public.converter_profiles rp
          WHERE rp.id = d.source_profile_id AND rp.code = 'orderonline_inbound')
        AND CASE WHEN COALESCE(d.raw_data->>'gross_revenue','') ~ '^\d+(\.\d+)?$'
          THEN (d.raw_data->>'gross_revenue')::numeric = d.total
          ELSE false END)
    UNION ALL
    SELECT f.id AS id, COALESCE(f.shipping_cost,0) AS included_shipping
    FROM public.orders f
    WHERE f.organization_id = v_org
      AND (p_from IS NULL OR f.order_date >= p_from)
      AND (p_to IS NULL OR f.order_date <= p_to)
      AND (EXISTS (SELECT 1 FROM public.converter_profiles rp
          WHERE rp.id = f.source_profile_id AND rp.code = 'orderonline_inbound')
        AND CASE WHEN COALESCE(f.raw_data->>'gross_revenue','') ~ '^\d+(\.\d+)?$'
          THEN (f.raw_data->>'gross_revenue')::numeric = f.total
          ELSE false END)
  ), selected_orders AS MATERIALIZED (
    SELECT o.*, COALESCE(s.included_shipping,0) AS included_shipping
    FROM public.v_orders_union o LEFT JOIN source_proven_shipping s ON s.id = o.id
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
      (COALESCE(o.total,0) - o.included_shipping) AS penjualan,
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
$function$;

CREATE OR REPLACE FUNCTION public.list_pembukuan(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS TABLE(source text, id bigint, order_number text, order_date date, status text, zone text, customer_name text, customer_city text, cs_name text, channel_name text, product_summary text, attribution_code_raw text, total numeric, penjualan numeric, ongkir numeric, cod_amount numeric, tracking_no text, resi text, actual_shipping_fee numeric, return_shipping_fee numeric, retur_reason text, delivered_at timestamp with time zone, returned_at timestamp with time zone, exported_at timestamp with time zone, payment_method text, qty bigint, est_biaya_kurir numeric, est_omset numeric, est_hpp numeric, est_fee_cs numeric, est_gross_profit numeric, act_omset numeric, act_hpp numeric, act_fee_cs numeric, act_gross_profit numeric, dicairkan numeric, cod_settled_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT; v_can_finance boolean;
BEGIN
  v_org := public.current_org_id();
  SELECT EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.active AND p.organization_id = v_org
      AND p.role::text IN ('owner','admin','akunting')) INTO v_can_finance;
  RETURN QUERY
  WITH settled AS MATERIALIZED (
    -- CASE prevents evaluating the manager-only guarded source for staff.
    -- Evaluate once within the report statement; preserve ordinary staff access.
    SELECT r.* FROM jsonb_to_recordset(
      CASE WHEN v_can_finance THEN
        (SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
         FROM public.recorded_cod_receipts() s)
      ELSE '[]'::jsonb END
    ) AS r(order_number text, amount numeric, settled_at timestamptz)
  ), unioned AS (
    SELECT
      'draft'::text AS source, d.id, d.order_number, d.order_date, d.status,
      CASE d.status
        WHEN 'BARU' THEN 'Baru'
        WHEN 'DIKIRIM' THEN 'Dikirim'
        WHEN 'PROBLEM' THEN 'Problem'
        WHEN 'SIAP_KIRIM' THEN CASE WHEN d.exported_at IS NOT NULL THEN 'Nunggu Resi' ELSE 'Antrian' END
        ELSE d.status
      END AS zone,
      d.customer_name, d.customer_city,
      COALESCE((SELECT full_name FROM public.profiles WHERE id = d.cs_id), d.cs_name) AS cs_name,
      (SELECT name FROM public.courier_channels WHERE id = d.channel_id) AS channel_name,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items_draft oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = d.id), '—') AS product_summary,
      d.attribution_code_raw,
      d.total, (CASE WHEN (EXISTS (SELECT 1 FROM public.converter_profiles rp
          WHERE rp.id = d.source_profile_id AND rp.code = 'orderonline_inbound')
        AND CASE WHEN COALESCE(d.raw_data->>'gross_revenue','') ~ '^\d+(\.\d+)?$'
          THEN (d.raw_data->>'gross_revenue')::numeric = d.total
          ELSE false END) THEN COALESCE(d.total,0)
        ELSE COALESCE(d.total,0) + COALESCE(d.shipping_cost,0) END) AS penjualan, COALESCE(d.shipping_cost,0) AS ongkir, d.cod_amount, d.tracking_no, d.resi,
      d.actual_shipping_fee, d.return_shipping_fee, d.retur_reason,
      d.delivered_at, d.returned_at, d.exported_at,
      d.payment_method,
      COALESCE((SELECT SUM(oi.qty) FROM public.order_items_draft oi WHERE oi.order_id = d.id), 0)::bigint AS qty,
      COALESCE(d.estimated_total_cost, 0) AS biaya_kurir,
      COALESCE((SELECT SUM(oi.qty * (COALESCE(oi.hpp_snapshot,0) + COALESCE(oi.packing_fee_snapshot,0))) FROM public.order_items_draft oi WHERE oi.order_id = d.id), 0) AS hpp,
      COALESCE(d.estimated_profit, 0) AS gp,
      0::numeric AS rts_loss,
      paid.amount AS dicairkan_raw,
      paid.settled_at AS cod_settled_at
    FROM public.orders_draft d
    LEFT JOIN settled paid ON paid.order_number = d.order_number
    WHERE d.organization_id = v_org
    UNION ALL
    SELECT
      'final'::text AS source, o.id, o.order_number, o.order_date, o.status,
      CASE o.status
        WHEN 'DITERIMA' THEN 'Arsip (Delivered)'
        WHEN 'RETUR' THEN 'Retur'
        WHEN 'CANCEL' THEN 'Batal'
        WHEN 'FAKE' THEN 'Fake'
        ELSE o.status
      END AS zone,
      o.customer_name, o.customer_city,
      COALESCE((SELECT full_name FROM public.profiles WHERE id = o.cs_id), o.cs_name) AS cs_name,
      (SELECT name FROM public.courier_channels WHERE id = o.channel_id) AS channel_name,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = o.id), '—') AS product_summary,
      o.attribution_code_raw,
      o.total, (CASE WHEN (EXISTS (SELECT 1 FROM public.converter_profiles rp
          WHERE rp.id = o.source_profile_id AND rp.code = 'orderonline_inbound')
        AND CASE WHEN COALESCE(o.raw_data->>'gross_revenue','') ~ '^\d+(\.\d+)?$'
          THEN (o.raw_data->>'gross_revenue')::numeric = o.total
          ELSE false END) THEN COALESCE(o.total,0)
        ELSE COALESCE(o.total,0) + COALESCE(o.shipping_cost,0) END) AS penjualan, COALESCE(o.shipping_cost,0) AS ongkir, o.cod_amount, o.tracking_no, o.resi,
      o.shipping_cost_actual AS actual_shipping_fee, o.return_shipping_fee, o.retur_reason,
      o.delivered_at, o.returned_at, NULL::timestamptz AS exported_at,
      o.payment_method,
      COALESCE((SELECT SUM(oi.qty) FROM public.order_items oi WHERE oi.order_id = o.id), 0)::bigint AS qty,
      COALESCE(o.estimated_total_cost, 0) AS biaya_kurir,
      COALESCE((SELECT SUM(oi.qty * (COALESCE(oi.hpp_snapshot,0) + COALESCE(oi.packing_fee_snapshot,0))) FROM public.order_items oi WHERE oi.order_id = o.id), 0) AS hpp,
      COALESCE(o.estimated_profit, 0) AS gp,
      COALESCE(o.shipping_cost, 0) * COALESCE(
        public.get_active_rate(o.channel_id, 'rts_shipping_rate', COALESCE(o.order_date, CURRENT_DATE)), 0
      ) AS rts_loss,
      CASE WHEN v_can_finance THEN paid.amount
        ELSE CASE WHEN o.cod_settled_at IS NOT NULL THEN o.payout_amount ELSE NULL END
      END AS dicairkan_raw,
      CASE WHEN v_can_finance THEN paid.settled_at ELSE o.cod_settled_at END AS cod_settled_at
    FROM public.orders o
    LEFT JOIN settled paid ON paid.order_number = o.order_number
    WHERE o.organization_id = v_org
  ),
  filtered AS (
    SELECT * FROM unioned u
    WHERE (p_from IS NULL OR u.order_date >= p_from)
      AND (p_to IS NULL OR u.order_date <= p_to)
      AND (p_status IS NULL OR u.status = p_status)
      AND (p_search IS NULL
           OR u.order_number ILIKE '%'||p_search||'%'
           OR u.customer_name ILIKE '%'||p_search||'%'
           OR COALESCE(u.attribution_code_raw, '') ILIKE '%'||p_search||'%')
  ),
  cnt AS (SELECT COUNT(*) AS n FROM filtered)
  SELECT f.source, f.id, f.order_number, f.order_date, f.status, f.zone,
         f.customer_name, f.customer_city, f.cs_name, f.channel_name,
         f.product_summary, f.attribution_code_raw,
         f.total, f.penjualan, f.ongkir, f.cod_amount, f.tracking_no, f.resi,
         f.actual_shipping_fee, f.return_shipping_fee, f.retur_reason,
         f.delivered_at, f.returned_at, f.exported_at,
         f.payment_method, f.qty,
         f.biaya_kurir AS est_biaya_kurir,
         (f.penjualan - f.biaya_kurir) AS est_omset,
         f.hpp AS est_hpp,
         ((f.penjualan - f.biaya_kurir - f.hpp) - f.gp) AS est_fee_cs,
         f.gp AS est_gross_profit,
         CASE f.status WHEN 'DITERIMA' THEN (f.penjualan - f.biaya_kurir)
                       WHEN 'RETUR' THEN -f.rts_loss
                       WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_omset,
         CASE f.status WHEN 'DITERIMA' THEN f.hpp
                       WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_hpp,
         CASE f.status WHEN 'DITERIMA' THEN ((f.penjualan - f.biaya_kurir - f.hpp) - f.gp)
                       WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_fee_cs,
         CASE f.status WHEN 'DITERIMA' THEN f.gp
                       WHEN 'RETUR' THEN -f.rts_loss
                       WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_gross_profit,
         f.dicairkan_raw AS dicairkan, f.cod_settled_at,
         (SELECT n FROM cnt) AS total_count
  FROM filtered f
  ORDER BY f.order_date DESC NULLS LAST, f.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;
COMMIT;
