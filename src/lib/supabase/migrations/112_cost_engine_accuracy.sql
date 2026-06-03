-- 112 — Fix akurasi cost engine: estimated_profit harus kurangin HPP + komisi.
-- ============================================================================
-- BUG: estimated_profit banyak order = omset (HPP & komisi GAK kekurang).
-- Akar: trg_compute_draft_costs cuma nyala pas HEADER order berubah (channel/
-- shipping/total/payment/date), BUKAN pas order_items berubah. Import-an: order
-- row masuk dulu (cost ke-compute, HPP=0 krn item belum ada) → item nyusul →
-- gak recompute → estimated_profit ke-overstate. Plus draft komisi selalu 0.
--
-- FIX 3 bagian:
--   1) estimate_commission_amount(): estimasi komisi dari commission_rules
--      (mirror priority compute_commissions: user+product > user > product > role).
--   2) compute_draft_order_costs: HPP + packing, dan KURANGIN estimasi komisi
--      (cs/advertiser/admin yg assigned) dari profit.
--   3) Trigger recompute pas order_items(_draft) berubah → HPP langsung kehitung.
--   4) Recompute SEMUA order existing sekali (DO block di bawah).
-- Idempotent.

-- 1) Helper estimasi komisi (gak insert, cuma hitung) ------------------------
CREATE OR REPLACE FUNCTION public.estimate_commission_amount(
  p_org BIGINT, p_role TEXT, p_user_id UUID, p_product_ids BIGINT[],
  p_total NUMERIC, p_dt DATE
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.commission_rules cr
  WHERE cr.organization_id = p_org AND cr.role = p_role AND cr.active
    AND (cr.user_id IS NULL OR cr.user_id = p_user_id)
    AND (cr.product_id IS NULL OR cr.product_id = ANY(COALESCE(p_product_ids, ARRAY[]::BIGINT[])))
    AND (cr.effective_from IS NULL OR cr.effective_from <= p_dt)
    AND (cr.effective_to IS NULL OR cr.effective_to >= p_dt)
  ORDER BY (cr.user_id IS NOT NULL) DESC, (cr.product_id IS NOT NULL) DESC, cr.id DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;
  RETURN CASE r.rate_type
    WHEN 'FLAT_PER_ORDER' THEN COALESCE(r.rate_value, 0)
    WHEN 'PERCENT_REVENUE' THEN ROUND(COALESCE(p_total,0) * COALESCE(r.rate_value,0) / 100.0, 2)
    ELSE 0 END;
END $$;
REVOKE EXECUTE ON FUNCTION public.estimate_commission_amount(BIGINT,TEXT,UUID,BIGINT[],NUMERIC,DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.estimate_commission_amount(BIGINT,TEXT,UUID,BIGINT[],NUMERIC,DATE) TO authenticated;

-- 2) compute_draft_order_costs: HPP+packing + estimasi komisi ----------------
CREATE OR REPLACE FUNCTION public.compute_draft_order_costs(p_draft_id bigint)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders_draft%ROWTYPE;
  v_channel public.courier_channels%ROWTYPE;
  v_config RECORD;
  v_disc NUMERIC; v_codr NUMERIC; v_ppnr NUMERIC;
  v_gross NUMERIC; v_net NUMERIC;
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

  v_gross := COALESCE(v_order.shipping_cost, 0);
  v_net := ROUND((v_gross * (1 - v_disc / 100.0))::NUMERIC, 2);

  v_base := CASE v_config.cod_fee_base
    WHEN 'NOMINAL_COD' THEN CASE WHEN v_order.payment_method='COD' THEN v_order.total ELSE 0 END
    WHEN 'BARANG_PLUS_ONGKIR_GROSS' THEN v_order.subtotal + v_gross
    WHEN 'BARANG_PLUS_ONGKIR_NET' THEN v_order.subtotal + v_net
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
    WHEN 'MONTHLY_INVOICE'   THEN CASE WHEN v_order.payment_method='COD' THEN v_order.total ELSE 0 END
    WHEN 'NETT_OFF_PER_ORDER' THEN CASE WHEN v_order.payment_method='COD' THEN v_order.total - v_total_cost ELSE 0 END
    WHEN 'DIRECT_TRANSFER'   THEN CASE WHEN v_order.payment_method='TRANSFER' THEN v_order.total ELSE 0 END
    ELSE CASE WHEN v_order.payment_method='COD' THEN v_order.total ELSE 0 END END;
  -- TRANSFER: uang masuk via bank, lepas dari billing model kurir
  IF v_order.payment_method = 'TRANSFER' THEN v_cash_in := COALESCE(v_order.total, 0); END IF;
  v_cash_in := ROUND(v_cash_in::NUMERIC, 2);

  -- HPP + packing (samain dgn compute_order_costs terminal)
  SELECT COALESCE(SUM(qty * (COALESCE(hpp_snapshot,0) + COALESCE(packing_fee_snapshot,0))),0)::NUMERIC
  INTO v_hpp FROM public.order_items_draft WHERE order_id = p_draft_id;

  -- Estimasi komisi: per role yg assigned, dari commission_rules (draft belum
  -- punya row commissions krn FK ke orders). Begitu delivered, dihitung aktual.
  SELECT array_agg(DISTINCT product_id) FILTER (WHERE product_id IS NOT NULL)
  INTO v_pids FROM public.order_items_draft WHERE order_id = p_draft_id;
  v_commission := 0;
  IF v_order.cs_id IS NOT NULL THEN
    v_commission := v_commission + public.estimate_commission_amount(v_order.organization_id,'cs',v_order.cs_id,v_pids,COALESCE(v_order.total,0),v_dt);
  END IF;
  IF v_order.advertiser_id IS NOT NULL THEN
    v_commission := v_commission + public.estimate_commission_amount(v_order.organization_id,'advertiser',v_order.advertiser_id,v_pids,COALESCE(v_order.total,0),v_dt);
  END IF;
  IF v_order.admin_id IS NOT NULL THEN
    v_commission := v_commission + public.estimate_commission_amount(v_order.organization_id,'admin',v_order.admin_id,v_pids,COALESCE(v_order.total,0),v_dt);
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
      'est_commission', v_commission, 'computed_at', now()),
    cost_computed_at = now()
  WHERE id = p_draft_id;
END;
$function$;

-- 3) Trigger recompute pas item berubah --------------------------------------
CREATE OR REPLACE FUNCTION public.trg_recompute_draft_costs_on_items()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.compute_draft_order_costs(COALESCE(NEW.order_id, OLD.order_id));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_recompute_order_costs_on_items()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.compute_order_costs(COALESCE(NEW.order_id, OLD.order_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_recompute_draft_costs_on_items ON public.order_items_draft;
CREATE TRIGGER trg_recompute_draft_costs_on_items
  AFTER INSERT OR UPDATE OF qty, hpp_snapshot, packing_fee_snapshot, product_id OR DELETE
  ON public.order_items_draft
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_draft_costs_on_items();

DROP TRIGGER IF EXISTS trg_recompute_order_costs_on_items ON public.order_items;
CREATE TRIGGER trg_recompute_order_costs_on_items
  AFTER INSERT OR UPDATE OF qty, hpp_snapshot, packing_fee_snapshot, product_id OR DELETE
  ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_order_costs_on_items();

-- 4) Recompute SEMUA order existing (one-time fix) ---------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.orders_draft LOOP
    PERFORM public.compute_draft_order_costs(r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.orders LOOP
    PERFORM public.compute_order_costs(r.id);
  END LOOP;
END $$;
