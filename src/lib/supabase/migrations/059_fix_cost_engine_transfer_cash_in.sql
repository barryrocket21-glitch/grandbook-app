-- 059 — Fix cost engine: order TRANSFER dihitung cash_in = total order.
-- Applied via Supabase MCP (apply_migration: fix_cost_engine_transfer_cash_in).
--
-- Bug: compute_order_costs hanya kasih cash_in ke order COD. Untuk channel
-- billing MONTHLY_INVOICE (SPX), order yang dibayar TRANSFER bank dapat
-- cash_in=0 → estimated_profit minus. Di Laporan Laba Rugi efeknya baris
-- "Fee CS" (= margin − gross_profit, residual) keliatan ~Rp6,36jt — padahal
-- belum ada commission rule sama sekali. 31 order transfer di prod kena.
--
-- Fix: order payment_method='TRANSFER' → cash_in = total order. Uang sudah
-- masuk rekening seller via transfer bank; billing model kurir cuma soal cara
-- settle ONGKIR (tetap ditagih lewat invoice bulanan). Profit transfer order
-- = total − HPP − komisi − ongkir (IF MONTHLY_INVOICE kurangi total_cost).
-- Order COD tidak terpengaruh — masuk cabang ELSE, logika identik dengan 018.

CREATE OR REPLACE FUNCTION public.compute_order_costs(p_order_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_channel public.courier_channels%ROWTYPE;
  v_config RECORD;
  v_shipping_discount_pct NUMERIC;
  v_cod_fee_pct NUMERIC;
  v_ppn_pct NUMERIC;
  v_shipping_gross NUMERIC;
  v_shipping_net NUMERIC;
  v_cod_fee_base_amount NUMERIC;
  v_cod_fee_raw NUMERIC;
  v_cod_fee NUMERIC;
  v_ppn NUMERIC;
  v_total_cost NUMERIC;
  v_cash_in NUMERIC;
  v_hpp NUMERIC;
  v_commission NUMERIC;
  v_profit NUMERIC;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_order.channel_id IS NULL THEN
    UPDATE public.orders SET
      estimated_shipping_net = NULL,
      estimated_cod_fee = NULL,
      estimated_ppn = NULL,
      estimated_total_cost = NULL,
      estimated_cash_in = NULL,
      estimated_profit = NULL,
      cost_computed_at = NULL
    WHERE id = p_order_id;
    RETURN;
  END IF;

  SELECT * INTO v_channel FROM public.courier_channels WHERE id = v_order.channel_id;

  SELECT * INTO v_config FROM public.get_active_billing_config(
    v_order.channel_id,
    COALESCE(v_order.order_date, CURRENT_DATE)
  );

  -- Rates disimpan sebagai PERCENT (e.g. 40 untuk 40%, 1 untuk 1%)
  v_shipping_discount_pct := public.get_active_rate(
    v_order.channel_id, 'shipping_discount_rate', COALESCE(v_order.order_date, CURRENT_DATE)
  );
  v_cod_fee_pct := public.get_active_rate(
    v_order.channel_id, 'cod_fee_rate', COALESCE(v_order.order_date, CURRENT_DATE)
  );
  v_ppn_pct := public.get_active_rate(
    v_order.channel_id, 'ppn_rate', COALESCE(v_order.order_date, CURRENT_DATE)
  );

  -- Shipping (divide pct by 100)
  v_shipping_gross := COALESCE(v_order.shipping_cost_actual, v_order.shipping_cost, 0);
  v_shipping_net := ROUND((v_shipping_gross * (1 - v_shipping_discount_pct / 100.0))::NUMERIC, 2);

  -- COD fee base
  v_cod_fee_base_amount := CASE v_config.cod_fee_base
    WHEN 'NOMINAL_COD' THEN
      CASE WHEN v_order.payment_method = 'COD' THEN v_order.total ELSE 0 END
    WHEN 'BARANG_PLUS_ONGKIR_GROSS' THEN v_order.subtotal + v_shipping_gross
    WHEN 'BARANG_PLUS_ONGKIR_NET' THEN v_order.subtotal + v_shipping_net
    ELSE 0
  END;
  v_cod_fee_raw := v_cod_fee_base_amount * v_cod_fee_pct / 100.0;
  v_cod_fee := CASE v_config.cod_fee_rounding
    WHEN 'FLOOR' THEN FLOOR(v_cod_fee_raw)
    WHEN 'CEIL' THEN CEIL(v_cod_fee_raw)
    WHEN 'ROUND' THEN ROUND(v_cod_fee_raw)
    ELSE v_cod_fee_raw
  END;

  -- PPN (divide pct by 100)
  v_ppn := CASE v_config.ppn_applied_to
    WHEN 'COD_FEE_ONLY' THEN v_cod_fee * v_ppn_pct / 100.0
    WHEN 'COD_FEE_PLUS_SHIPPING' THEN (v_cod_fee + v_shipping_net) * v_ppn_pct / 100.0
    ELSE 0
  END;
  v_ppn := ROUND(v_ppn::NUMERIC, 2);

  v_total_cost := ROUND((v_shipping_net + v_cod_fee + v_ppn)::NUMERIC, 2);

  -- cash_in: order TRANSFER = uang sudah masuk rekening seller via transfer
  -- bank, lepas dari billing model kurir. Order COD tergantung billing model.
  IF v_order.payment_method = 'TRANSFER' THEN
    v_cash_in := COALESCE(v_order.total, 0);
  ELSE
    v_cash_in := CASE v_channel.billing_model
      WHEN 'MONTHLY_INVOICE' THEN
        CASE WHEN v_order.payment_method = 'COD' THEN v_order.total ELSE 0 END
      WHEN 'NETT_OFF_PER_ORDER' THEN
        CASE WHEN v_order.payment_method = 'COD' THEN v_order.total - v_total_cost ELSE 0 END
      WHEN 'DIRECT_TRANSFER' THEN
        CASE WHEN v_order.payment_method = 'TRANSFER' THEN v_order.total ELSE 0 END
      ELSE
        CASE WHEN v_order.payment_method = 'COD' THEN v_order.total ELSE 0 END
    END;
  END IF;
  v_cash_in := ROUND(v_cash_in::NUMERIC, 2);

  SELECT COALESCE(SUM(qty * COALESCE(hpp_snapshot, 0)), 0)::NUMERIC INTO v_hpp
  FROM public.order_items WHERE order_id = p_order_id;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC INTO v_commission
  FROM public.commissions
  WHERE order_id = p_order_id
    AND status IN ('ESTIMATED', 'EARNED', 'PAID');

  v_profit := v_cash_in - v_hpp - v_commission;
  IF v_channel.billing_model = 'MONTHLY_INVOICE' THEN
    v_profit := v_profit - v_total_cost;
  END IF;
  v_profit := ROUND(v_profit::NUMERIC, 2);

  UPDATE public.orders SET
    estimated_shipping_net = v_shipping_net,
    estimated_cod_fee = v_cod_fee,
    estimated_ppn = v_ppn,
    estimated_total_cost = v_total_cost,
    estimated_cash_in = v_cash_in,
    estimated_profit = v_profit,
    cost_computed_at = NOW()
  WHERE id = p_order_id;
END $function$;

-- Backfill order TRANSFER existing (COD tidak terpengaruh — logika sama).
-- Audit + updated_at trigger di-disable sementara supaya tidak nyampah audit
-- log / bump updated_at massal. Di fresh setup loop ini no-op (0 order).
ALTER TABLE public.orders DISABLE TRIGGER trg_audit_log_orders;
ALTER TABLE public.orders DISABLE TRIGGER trg_set_updated_at_orders;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.orders WHERE payment_method = 'TRANSFER' ORDER BY id LOOP
    PERFORM public.compute_order_costs(r.id);
  END LOOP;
END $$;
ALTER TABLE public.orders ENABLE TRIGGER trg_audit_log_orders;
ALTER TABLE public.orders ENABLE TRIGGER trg_set_updated_at_orders;
