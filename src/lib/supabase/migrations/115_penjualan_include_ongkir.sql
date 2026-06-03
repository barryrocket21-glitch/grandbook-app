-- 115 — Penjualan = barang + ongkir (nilai COD dibayar pembeli). Fix understate.
-- ============================================================================
-- Barry bener: pembeli COD bayar barang + ongkir. Tapi engine pakai `total`
-- (barang doang) sbg duit-masuk, sambil tetap motong biaya ongkir → laba
-- ke-UNDERSTATE sebesar ongkir tiap order.
--
-- + Ketemu 21 order `shipping_cost` KORUP (mis 2.000.010) — `cod_amount`-nya bener.
--
-- FIX:
--   A) Bersihin shipping_cost korup → cod_amount − total (sumber kebenaran).
--   B) penjualan = total + shipping_cost (= COD). cash_in & cod_fee base pakai ini.
--   C) Trigger auto-heal: pas insert, kalau COD & cod_amount nyimpang dari
--      total+shipping → benerin shipping_cost dari cod_amount (cegah korup lagi).
--   D) laba_rugi_summary pakai penjualan. + recompute semua.
-- list_pembukuan diurus di mig 116. Idempotent.

-- ===== A) Bersihin 21 shipping_cost korup =====================================
UPDATE public.orders_draft
SET shipping_cost = cod_amount - total
WHERE organization_id IS NOT NULL
  AND cod_amount IS NOT NULL AND cod_amount > 0 AND total IS NOT NULL
  AND ABS(COALESCE(shipping_cost,0) - (cod_amount - total)) > 1000;

UPDATE public.orders
SET shipping_cost = cod_amount - total
WHERE organization_id IS NOT NULL
  AND cod_amount IS NOT NULL AND cod_amount > 0 AND total IS NOT NULL
  AND ABS(COALESCE(shipping_cost,0) - (cod_amount - total)) > 1000;

-- ===== C) Trigger auto-heal shipping_cost dari cod_amount (cegah korup) =======
CREATE OR REPLACE FUNCTION public.heal_shipping_from_cod()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  -- COD: cod_amount = barang + ongkir = sumber kebenaran. Kalau shipping_cost
  -- nyimpang jauh (korup/typo), benerin dari cod_amount.
  IF NEW.payment_method = 'COD' AND NEW.cod_amount IS NOT NULL AND NEW.cod_amount > 0
     AND NEW.total IS NOT NULL
     AND ABS(COALESCE(NEW.shipping_cost,0) - (NEW.cod_amount - NEW.total)) > 1000 THEN
    NEW.shipping_cost := NEW.cod_amount - NEW.total;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_heal_shipping_draft ON public.orders_draft;
CREATE TRIGGER trg_heal_shipping_draft
  BEFORE INSERT ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.heal_shipping_from_cod();

DROP TRIGGER IF EXISTS trg_heal_shipping_orders ON public.orders;
CREATE TRIGGER trg_heal_shipping_orders
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.heal_shipping_from_cod();

-- ===== B) compute_draft_order_costs: penjualan = total + ongkir ===============
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

  -- penjualan = barang + ongkir = yg dibayar pembeli (COD/transfer)
  v_penjualan := COALESCE(v_order.total,0) + COALESCE(v_order.shipping_cost,0);
  v_gross := COALESCE(v_order.shipping_cost, 0);
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

  -- cash_in = penjualan (pembeli bayar barang+ongkir); kurir potong via biaya
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
    rate_snapshot = jsonb_build_object(
      'shipping_discount_rate', v_disc, 'cod_fee_rate', v_codr, 'ppn_rate', v_ppnr,
      'cod_fee_base', v_config.cod_fee_base, 'cod_fee_rounding', v_config.cod_fee_rounding,
      'ppn_applied_to', v_config.ppn_applied_to, 'billing_model', v_channel.billing_model,
      'penjualan', v_penjualan, 'est_commission', v_commission, 'computed_at', now()),
    cost_computed_at = now()
  WHERE id = p_draft_id;
END;
$function$;

-- ===== B) compute_order_costs (terminal): penjualan = total + ongkir ==========
CREATE OR REPLACE FUNCTION public.compute_order_costs(p_order_id bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_channel public.courier_channels%ROWTYPE;
  v_config RECORD;
  v_shipping_discount_pct NUMERIC; v_cod_fee_pct NUMERIC; v_ppn_pct NUMERIC;
  v_shipping_gross NUMERIC; v_shipping_net NUMERIC; v_penjualan NUMERIC;
  v_cod_fee_base_amount NUMERIC; v_cod_fee_raw NUMERIC; v_cod_fee NUMERIC; v_ppn NUMERIC;
  v_total_cost NUMERIC; v_cash_in NUMERIC; v_hpp NUMERIC; v_commission NUMERIC; v_profit NUMERIC;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_order.channel_id IS NULL THEN
    UPDATE public.orders SET
      estimated_shipping_net=NULL, estimated_cod_fee=NULL, estimated_ppn=NULL,
      estimated_total_cost=NULL, estimated_cash_in=NULL, estimated_profit=NULL,
      cost_computed_at=NULL
    WHERE id = p_order_id;
    RETURN;
  END IF;

  SELECT * INTO v_channel FROM public.courier_channels WHERE id = v_order.channel_id;
  SELECT * INTO v_config FROM public.get_active_billing_config(v_order.channel_id, COALESCE(v_order.order_date, CURRENT_DATE));

  v_shipping_discount_pct := public.get_active_rate(v_order.channel_id, 'shipping_discount_rate', COALESCE(v_order.order_date, CURRENT_DATE));
  v_cod_fee_pct := public.get_active_rate(v_order.channel_id, 'cod_fee_rate', COALESCE(v_order.order_date, CURRENT_DATE));
  v_ppn_pct := public.get_active_rate(v_order.channel_id, 'ppn_rate', COALESCE(v_order.order_date, CURRENT_DATE));

  -- penjualan = barang + ongkir (yg dibayar pembeli). ongkir = shipping_cost
  -- (yg ditagih ke pembeli); biaya pakai shipping_cost_actual kalau ada.
  v_penjualan := COALESCE(v_order.total,0) + COALESCE(v_order.shipping_cost,0);
  v_shipping_gross := COALESCE(v_order.shipping_cost_actual, v_order.shipping_cost, 0);
  v_shipping_net := ROUND((v_shipping_gross * (1 - v_shipping_discount_pct / 100.0))::NUMERIC, 2);

  v_cod_fee_base_amount := CASE v_config.cod_fee_base
    WHEN 'NOMINAL_COD' THEN CASE WHEN v_order.payment_method = 'COD' THEN v_penjualan ELSE 0 END
    WHEN 'BARANG_PLUS_ONGKIR_GROSS' THEN COALESCE(v_order.subtotal,0) + v_shipping_gross
    WHEN 'BARANG_PLUS_ONGKIR_NET' THEN COALESCE(v_order.subtotal,0) + v_shipping_net
    ELSE 0 END;
  v_cod_fee_raw := v_cod_fee_base_amount * v_cod_fee_pct / 100.0;
  v_cod_fee := CASE v_config.cod_fee_rounding
    WHEN 'FLOOR' THEN FLOOR(v_cod_fee_raw) WHEN 'CEIL' THEN CEIL(v_cod_fee_raw)
    WHEN 'ROUND' THEN ROUND(v_cod_fee_raw) ELSE v_cod_fee_raw END;

  v_ppn := CASE v_config.ppn_applied_to
    WHEN 'COD_FEE_ONLY' THEN v_cod_fee * v_ppn_pct / 100.0
    WHEN 'COD_FEE_PLUS_SHIPPING' THEN (v_cod_fee + v_shipping_net) * v_ppn_pct / 100.0
    ELSE 0 END;
  v_ppn := ROUND(v_ppn::NUMERIC, 2);

  v_total_cost := ROUND((v_shipping_net + v_cod_fee + v_ppn)::NUMERIC, 2);

  IF v_order.payment_method = 'TRANSFER' THEN
    v_cash_in := v_penjualan;
  ELSE
    v_cash_in := CASE v_channel.billing_model
      WHEN 'MONTHLY_INVOICE' THEN CASE WHEN v_order.payment_method = 'COD' THEN v_penjualan ELSE 0 END
      WHEN 'NETT_OFF_PER_ORDER' THEN CASE WHEN v_order.payment_method = 'COD' THEN v_penjualan - v_total_cost ELSE 0 END
      WHEN 'DIRECT_TRANSFER' THEN CASE WHEN v_order.payment_method = 'TRANSFER' THEN v_penjualan ELSE 0 END
      ELSE CASE WHEN v_order.payment_method = 'COD' THEN v_penjualan ELSE 0 END END;
  END IF;
  v_cash_in := ROUND(v_cash_in::NUMERIC, 2);

  SELECT COALESCE(SUM(qty * (COALESCE(hpp_snapshot, 0) + COALESCE(packing_fee_snapshot, 0))), 0)::NUMERIC INTO v_hpp
  FROM public.order_items WHERE order_id = p_order_id;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC INTO v_commission
  FROM public.commissions WHERE order_id = p_order_id AND status IN ('ESTIMATED', 'EARNED', 'PAID');

  v_profit := v_cash_in - v_hpp - v_commission;
  IF v_channel.billing_model = 'MONTHLY_INVOICE' THEN v_profit := v_profit - v_total_cost; END IF;
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

-- ===== D) laba_rugi_summary: penjualan = total + ongkir =======================
DROP FUNCTION IF EXISTS public.laba_rugi_summary(date, date);
CREATE OR REPLACE FUNCTION public.laba_rugi_summary(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(
  order_count bigint, diterima_count bigint, retur_count bigint, batal_count bigint,
  inflight_count bigint, retur_pct numeric,
  est_penjualan numeric, est_biaya_kurir numeric, est_omset numeric, est_hpp numeric, est_fee_cs numeric, est_gross_profit numeric,
  act_penjualan numeric, act_biaya_kurir numeric, act_omset numeric, act_hpp numeric, act_fee_cs numeric, act_gross_profit numeric,
  total_ad_spend numeric, total_opex numeric, laba_bersih_est numeric, laba_bersih_act numeric
)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT; v_ad NUMERIC; v_opex NUMERIC;
BEGIN
  v_org := public.current_org_id();
  SELECT COALESCE(SUM(spend), 0) INTO v_ad FROM public.ad_spend
   WHERE organization_id = v_org AND (p_from IS NULL OR spend_date >= p_from) AND (p_to IS NULL OR spend_date <= p_to);
  SELECT COALESCE(SUM(amount), 0) INTO v_opex FROM public.operational_expenses
   WHERE organization_id = v_org AND (p_from IS NULL OR expense_date >= p_from) AND (p_to IS NULL OR expense_date <= p_to);

  RETURN QUERY
  WITH ord AS (
    SELECT o.status,
      (COALESCE(o.total,0) + COALESCE(o.shipping_cost,0)) AS penjualan,
      COALESCE(o.estimated_total_cost, 0) AS biaya_kurir,
      COALESCE(o.estimated_profit, 0) AS gp,
      COALESCE((SELECT SUM((oi.hpp_snapshot + COALESCE(oi.packing_fee_snapshot,0)) * oi.qty) FROM public.v_order_items_union oi WHERE oi.order_id = o.id), 0) AS hpp,
      COALESCE(o.shipping_cost, 0) * COALESCE(public.get_active_rate(o.channel_id, 'rts_shipping_rate', COALESCE(o.order_date, CURRENT_DATE)), 0) AS rts_loss
    FROM public.v_orders_union o
    WHERE o.organization_id = v_org
      AND (p_from IS NULL OR o.order_date >= p_from) AND (p_to IS NULL OR o.order_date <= p_to)
  ),
  calc AS (
    SELECT status, penjualan, biaya_kurir, hpp, gp, rts_loss,
      (penjualan - biaya_kurir) AS omset,
      ((penjualan - biaya_kurir - hpp) - gp) AS fee_cs
    FROM ord
  )
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE status = 'DITERIMA')::bigint,
    COUNT(*) FILTER (WHERE status = 'RETUR')::bigint,
    COUNT(*) FILTER (WHERE status IN ('CANCEL', 'FAKE'))::bigint,
    COUNT(*) FILTER (WHERE status IN ('BARU', 'SIAP_KIRIM', 'DIKIRIM', 'PROBLEM'))::bigint,
    CASE WHEN COUNT(*) FILTER (WHERE status IN ('DITERIMA','RETUR')) > 0
      THEN ROUND(100.0 * COUNT(*) FILTER (WHERE status='RETUR') / COUNT(*) FILTER (WHERE status IN ('DITERIMA','RETUR')), 2) ELSE 0 END,
    COALESCE(SUM(penjualan), 0), COALESCE(SUM(biaya_kurir), 0), COALESCE(SUM(omset), 0),
    COALESCE(SUM(hpp), 0), COALESCE(SUM(fee_cs), 0), COALESCE(SUM(gp), 0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN penjualan ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN biaya_kurir ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN omset WHEN status='RETUR' THEN -rts_loss ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN hpp ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN fee_cs ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN gp WHEN status='RETUR' THEN -rts_loss ELSE 0 END), 0),
    v_ad, v_opex,
    COALESCE(SUM(gp), 0) - v_ad - v_opex,
    COALESCE(SUM(CASE WHEN status='DITERIMA' THEN gp WHEN status='RETUR' THEN -rts_loss ELSE 0 END), 0) - v_ad - v_opex
  FROM calc;
END;
$function$;

-- ===== Recompute semua order =================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.orders_draft LOOP PERFORM public.compute_draft_order_costs(r.id); END LOOP;
  FOR r IN SELECT id FROM public.orders LOOP PERFORM public.compute_order_costs(r.id); END LOOP;
END $$;
