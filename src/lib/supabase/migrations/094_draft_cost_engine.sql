-- 094 — Brief #12 PART 3: Recompute biaya buat order di orders_draft.
-- ============================================================================
-- Root cause (dikoreksi dari brief): compute_order_costs TARGET `orders` + baca
-- rate LIVE (get_active_rate), BUKAN rate_snapshot. Order aktif sekarang ada di
-- `orders_draft` (alur #11/#13, `orders` kosong) → estimated_* gak pernah keisi.
-- Fix: port engine ke orders_draft. Formula identik mig 018. Komisi = 0 di draft
-- (tabel commissions FK ke orders — gak bisa draft tanpa ubah skema; di-flag).
-- rate_snapshot di-stamp (audit rate yang dipake). Idempotent. INVOKER.

-- ----------------------------------------------------------------------------
-- compute_draft_order_costs(draft_id) — hitung estimated_* + stamp rate_snapshot.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_draft_order_costs(p_draft_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders_draft%ROWTYPE;
  v_channel public.courier_channels%ROWTYPE;
  v_config RECORD;
  v_disc NUMERIC; v_codr NUMERIC; v_ppnr NUMERIC;
  v_gross NUMERIC; v_net NUMERIC;
  v_base NUMERIC; v_cod_raw NUMERIC; v_cod NUMERIC; v_ppn NUMERIC;
  v_total_cost NUMERIC; v_cash_in NUMERIC; v_hpp NUMERIC; v_profit NUMERIC;
  v_dt DATE;
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

  -- draft gak punya shipping_cost_actual → pakai shipping_cost.
  -- Rates disimpan PERCENT (40=40%, 1=1%, 12=12%) — bagi 100 (sesuai mig 019).
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
  v_cash_in := ROUND(v_cash_in::NUMERIC, 2);

  SELECT COALESCE(SUM(qty * COALESCE(hpp_snapshot,0)),0)::NUMERIC INTO v_hpp
  FROM public.order_items_draft WHERE order_id = p_draft_id;

  -- Komisi = 0 di draft (commissions FK ke orders). Profit estimate tanpa komisi.
  v_profit := v_cash_in - v_hpp;
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
      'computed_at', now()),
    cost_computed_at = now()
  WHERE id = p_draft_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_draft_order_costs(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_draft_order_costs(bigint) TO authenticated;

-- ----------------------------------------------------------------------------
-- recompute_draft_costs(ids, force) — batch. ids NULL = semua order org yg
-- BELUM dihitung (cost_computed_at NULL). force=TRUE → hitung ulang semua.
-- Idempotent (formula deterministik). INVOKER (org-scoped via current_org_id).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.recompute_draft_costs(bigint[], boolean);
CREATE OR REPLACE FUNCTION public.recompute_draft_costs(
  p_ids BIGINT[] DEFAULT NULL,
  p_force BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE v_org BIGINT; v_id BIGINT; v_n INT := 0;
BEGIN
  v_org := public.current_org_id();
  FOR v_id IN
    SELECT id FROM public.orders_draft
    WHERE organization_id = v_org
      AND (p_ids IS NULL OR id = ANY(p_ids))
      AND (p_force OR cost_computed_at IS NULL)
  LOOP
    PERFORM public.compute_draft_order_costs(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_draft_costs(bigint[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_draft_costs(bigint[], boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- Trigger: auto-compute pas order draft baru / channel/ongkir/total/status ganti
-- → biar "uang otomatis" gak perlu manual lagi ke depannya.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_compute_draft_costs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.compute_draft_order_costs(NEW.id);
  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_draft_order_costs ON public.orders_draft;
CREATE TRIGGER trg_compute_draft_order_costs
  AFTER INSERT OR UPDATE OF channel_id, shipping_cost, total, payment_method, order_date ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.trg_compute_draft_costs();
