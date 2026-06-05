-- 125 — Rekonsiliasi ongkir est-vs-aktual (draft): pakai ongkir kurir ASLI.
-- ============================================================================
-- GAP: compute_draft_order_costs hitung net/biaya/profit dari ongkir CS
-- (shipping_cost yg ditagih ke pembeli), padahal SPX charge fee asli beda
-- (actual_shipping_fee, lebih kecil). compute_order_costs (tabel orders) UDAH
-- pakai COALESCE(shipping_cost_actual, shipping_cost). Draft ketinggalan.
-- FIX: v_gross pakai actual_shipping_fee kalau udah sync (else ongkir CS=estimasi)
--   + trigger recompute pas actual_shipping_fee diisi (sebelumnya gak).
-- Efek: selisih ongkir / omset / profit makin AKURAT (biasanya profit NAIK,
-- karena SPX charge < ongkir yg ditagih CS). Idempotent.

CREATE OR REPLACE FUNCTION public.compute_draft_order_costs(p_draft_id bigint)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders_draft%ROWTYPE;
  v_channel public.courier_channels%ROWTYPE;
  v_config RECORD;
  v_disc NUMERIC; v_codr NUMERIC; v_ppnr NUMERIC;
  v_gross NUMERIC; v_net NUMERIC; v_penjualan NUMERIC;
  v_base NUMERIC; v_cod_raw NUMERIC; v_cod NUMERIC; v_ppn NUMERIC;
  v_total_cost NUMERIC; v_cash_in NUMERIC; v_hpp NUMERIC; v_profit NUMERIC;
  v_commission NUMERIC; v_pids BIGINT[]; v_dt DATE;
BEGIN
  SELECT * INTO v_order FROM public.orders_draft WHERE id = p_draft_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_order.channel_id IS NULL THEN
    UPDATE public.orders_draft SET
      estimated_shipping_net=NULL, estimated_cod_fee=NULL, estimated_ppn=NULL,
      estimated_total_cost=NULL, estimated_cash_in=NULL, estimated_profit=NULL,
      cost_computed_at=NULL
    WHERE id = p_draft_id;
    RETURN;
  END IF;

  v_dt := COALESCE(v_order.order_date, CURRENT_DATE);
  SELECT * INTO v_channel FROM public.courier_channels WHERE id = v_order.channel_id;
  SELECT * INTO v_config FROM public.get_active_billing_config(v_order.channel_id, v_dt);

  v_disc := public.get_active_rate(v_order.channel_id, 'shipping_discount_rate', v_dt);
  v_codr := public.get_active_rate(v_order.channel_id, 'cod_fee_rate', v_dt);
  v_ppnr := public.get_active_rate(v_order.channel_id, 'ppn_rate', v_dt);

  -- penjualan = barang + ongkir CS = yg dibayar pembeli (basis COD/komisi)
  v_penjualan := COALESCE(v_order.total,0) + COALESCE(v_order.shipping_cost,0);
  -- FIX: net/biaya dari ongkir kurir ASLI (actual_shipping_fee) kalau udah sync,
  -- else fallback ongkir CS (estimasi sebelum sync).
  v_gross := COALESCE(v_order.actual_shipping_fee, v_order.shipping_cost, 0);
  v_net := ROUND((v_gross * (1 - v_disc / 100.0))::NUMERIC, 2);

  v_base := CASE v_config.cod_fee_base
    WHEN 'NOMINAL_COD' THEN CASE WHEN v_order.payment_method='COD' THEN v_penjualan ELSE 0 END
    WHEN 'BARANG_PLUS_ONGKIR_GROSS' THEN COALESCE(v_order.subtotal,0) + v_gross
    WHEN 'BARANG_PLUS_ONGKIR_NET' THEN COALESCE(v_order.subtotal,0) + v_net
    ELSE 0 END;
  v_cod_raw := v_base * (v_codr / 100.0);
  v_cod := CASE v_config.cod_fee_rounding
    WHEN 'FLOOR' THEN FLOOR(v_cod_raw) WHEN 'CEIL' THEN CEIL(v_cod_raw)
    WHEN 'ROUND' THEN ROUND(v_cod_raw) ELSE v_cod_raw END;

  v_ppn := CASE v_config.ppn_applied_to
    WHEN 'COD_FEE_ONLY' THEN v_cod * (v_ppnr / 100.0)
    WHEN 'COD_FEE_PLUS_SHIPPING' THEN (v_cod + v_net) * (v_ppnr / 100.0)
    ELSE 0 END;
  v_ppn := ROUND(v_ppn::NUMERIC, 2);

  v_total_cost := ROUND((v_net + v_cod + v_ppn)::NUMERIC, 2);

  v_cash_in := CASE v_channel.billing_model
    WHEN 'MONTHLY_INVOICE'    THEN CASE WHEN v_order.payment_method='COD' THEN v_penjualan ELSE 0 END
    WHEN 'NETT_OFF_PER_ORDER' THEN CASE WHEN v_order.payment_method='COD' THEN v_penjualan - v_total_cost ELSE 0 END
    WHEN 'DIRECT_TRANSFER'    THEN CASE WHEN v_order.payment_method='TRANSFER' THEN v_penjualan ELSE 0 END
    ELSE CASE WHEN v_order.payment_method='COD' THEN v_penjualan ELSE 0 END END;
  IF v_order.payment_method = 'TRANSFER' THEN v_cash_in := v_penjualan; END IF;
  v_cash_in := ROUND(v_cash_in::NUMERIC, 2);

  SELECT COALESCE(SUM(qty * (COALESCE(hpp_snapshot,0) + COALESCE(packing_fee_snapshot,0))),0)::NUMERIC
  INTO v_hpp FROM public.order_items_draft WHERE order_id = p_draft_id;

  SELECT array_agg(DISTINCT product_id) FILTER (WHERE product_id IS NOT NULL)
  INTO v_pids FROM public.order_items_draft WHERE order_id = p_draft_id;
  v_commission := 0;
  IF v_order.cs_id IS NOT NULL THEN
    v_commission := v_commission + public.estimate_commission_amount(v_order.organization_id,'cs',v_order.cs_id,v_pids,v_penjualan,v_dt);
  END IF;
  IF v_order.advertiser_id IS NOT NULL THEN
    v_commission := v_commission + public.estimate_commission_amount(v_order.organization_id,'advertiser',v_order.advertiser_id,v_pids,v_penjualan,v_dt);
  END IF;
  IF v_order.admin_id IS NOT NULL THEN
    v_commission := v_commission + public.estimate_commission_amount(v_order.organization_id,'admin',v_order.admin_id,v_pids,v_penjualan,v_dt);
  END IF;

  v_profit := v_cash_in - v_hpp - v_commission;
  IF v_channel.billing_model = 'MONTHLY_INVOICE' THEN v_profit := v_profit - v_total_cost; END IF;
  v_profit := ROUND(v_profit::NUMERIC, 2);

  UPDATE public.orders_draft SET
    estimated_shipping_net = v_net,
    estimated_cod_fee = v_cod,
    estimated_ppn = v_ppn,
    estimated_total_cost = v_total_cost,
    estimated_cash_in = v_cash_in,
    estimated_profit = v_profit,
    cost_computed_at = now()
  WHERE id = p_draft_id;
END;
$function$;

-- Trigger: tambah actual_shipping_fee (+ status) supaya recompute pas SPX sync isi actual.
DROP TRIGGER IF EXISTS trg_compute_draft_order_costs ON public.orders_draft;
CREATE TRIGGER trg_compute_draft_order_costs
  AFTER INSERT OR UPDATE OF channel_id, shipping_cost, actual_shipping_fee, total, payment_method, order_date, status ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.trg_compute_draft_costs();

-- Backfill: recompute semua draft yg udah ada (yg synced → pakai actual sekarang).
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM public.orders_draft WHERE channel_id IS NOT NULL LOOP
    PERFORM public.compute_draft_order_costs(r.id);
  END LOOP;
END $$;
