-- =============================================================
-- Migration 018 — Phase 4C: Multi-Model Billing + Estimated Cost Engine
--
-- Tujuan:
--  1. Tambah `billing_model` + `shipping_discount_label` ke courier_channels
--  2. Tabel `channel_billing_config` (categorical config dengan period versioning)
--  3. Estimated cost columns di orders (computed via trigger atau on-demand)
--  4. Numeric rate_keys baru di courier_channel_rates (key-value, sudah ada)
--  5. Helper RPCs: get_active_rate, get_active_billing_config
--  6. Engine RPC: compute_order_costs
--  7. Trigger: re-compute saat order INSERT/UPDATE status/shipping/channel/total
--  8. Update analytics_per_channel RPC dengan field profit
--  9. Seed default SPX_DIRECT (40% cashback, 1% fee COD floor, 12% PPN)
-- 10. Backfill compute existing orders
-- =============================================================

-- ----------------------------------------------------------
-- 1. Add billing_model + display label ke courier_channels
-- ----------------------------------------------------------
ALTER TABLE public.courier_channels
  ADD COLUMN IF NOT EXISTS billing_model TEXT DEFAULT 'NO_RECONCILIATION';

-- Drop CHECK constraint kalau ada (idempotent re-apply)
ALTER TABLE public.courier_channels
  DROP CONSTRAINT IF EXISTS courier_channels_billing_model_check;
ALTER TABLE public.courier_channels
  ADD CONSTRAINT courier_channels_billing_model_check
  CHECK (billing_model IN (
    'MONTHLY_INVOICE',
    'NETT_OFF_PER_ORDER',
    'DIRECT_TRANSFER',
    'NO_RECONCILIATION'
  ));

ALTER TABLE public.courier_channels
  ADD COLUMN IF NOT EXISTS shipping_discount_label TEXT DEFAULT 'Cashback Ongkir';

COMMENT ON COLUMN public.courier_channels.billing_model IS
  'Phase 4C: how channel reconciles money. MONTHLY_INVOICE=SPX (COD cair full, tagihan bulan depan); '
  'NETT_OFF_PER_ORDER=Mengantar (cair = COD - cost); DIRECT_TRANSFER=customer transfer langsung; '
  'NO_RECONCILIATION=skip cost compute.';

COMMENT ON COLUMN public.courier_channel_rates.rate_key IS
  'Phase 4C numeric keys: shipping_discount_rate (0..1), cod_fee_rate (0..1), ppn_rate (0..1). '
  'Categorical config (cod_fee_base, cod_fee_rounding, ppn_applied_to) di tabel channel_billing_config terpisah.';

-- ----------------------------------------------------------
-- 2. channel_billing_config — categorical config per period
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channel_billing_config (
  id BIGSERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES public.courier_channels(id) ON DELETE CASCADE,
  cod_fee_base TEXT NOT NULL DEFAULT 'NOMINAL_COD',
  cod_fee_rounding TEXT NOT NULL DEFAULT 'FLOOR',
  ppn_applied_to TEXT NOT NULL DEFAULT 'COD_FEE_ONLY',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT channel_billing_config_unique UNIQUE (channel_id, effective_from),
  CONSTRAINT channel_billing_config_base_check CHECK (
    cod_fee_base IN ('NOMINAL_COD', 'BARANG_PLUS_ONGKIR_GROSS', 'BARANG_PLUS_ONGKIR_NET')
  ),
  CONSTRAINT channel_billing_config_rounding_check CHECK (
    cod_fee_rounding IN ('FLOOR', 'ROUND', 'CEIL')
  ),
  CONSTRAINT channel_billing_config_ppn_check CHECK (
    ppn_applied_to IN ('COD_FEE_ONLY', 'COD_FEE_PLUS_SHIPPING', 'NONE')
  )
);

CREATE INDEX IF NOT EXISTS idx_channel_billing_config_active
  ON public.channel_billing_config(channel_id) WHERE effective_to IS NULL;

-- RLS: mirror courier_channels (read all auth, write owner/admin only)
ALTER TABLE public.channel_billing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_billing_config_select ON public.channel_billing_config;
CREATE POLICY channel_billing_config_select ON public.channel_billing_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS channel_billing_config_modify ON public.channel_billing_config;
CREATE POLICY channel_billing_config_modify ON public.channel_billing_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin')
    )
  );

-- ----------------------------------------------------------
-- 3. Estimated cost columns di orders
-- ----------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS estimated_shipping_net NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estimated_cod_fee NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estimated_ppn NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estimated_total_cost NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estimated_cash_in NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estimated_profit NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cost_computed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_cost_computed
  ON public.orders(cost_computed_at) WHERE cost_computed_at IS NOT NULL;

-- ----------------------------------------------------------
-- 5. get_active_rate(channel_id, rate_key, order_date) — pick rate aktif
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_rate(
  p_channel_id BIGINT,
  p_rate_key TEXT,
  p_order_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_value NUMERIC;
BEGIN
  SELECT rate_value INTO v_value
  FROM public.courier_channel_rates
  WHERE channel_id = p_channel_id
    AND rate_key = p_rate_key
    AND effective_from <= p_order_date
    AND (effective_to IS NULL OR effective_to >= p_order_date)
  ORDER BY effective_from DESC
  LIMIT 1;

  RETURN COALESCE(v_value, 0);
END $$;

GRANT EXECUTE ON FUNCTION public.get_active_rate(BIGINT, TEXT, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 6. get_active_billing_config(channel_id, order_date)
-- Returns row dengan default kalau gak ada config aktif.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_billing_config(
  p_channel_id BIGINT,
  p_order_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  cod_fee_base TEXT,
  cod_fee_rounding TEXT,
  ppn_applied_to TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_found BOOLEAN := FALSE;
BEGIN
  RETURN QUERY
  SELECT c.cod_fee_base, c.cod_fee_rounding, c.ppn_applied_to
  FROM public.channel_billing_config c
  WHERE c.channel_id = p_channel_id
    AND c.effective_from <= p_order_date
    AND (c.effective_to IS NULL OR c.effective_to >= p_order_date)
  ORDER BY c.effective_from DESC
  LIMIT 1;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found = FALSE OR v_found IS NULL THEN
    -- No config row matched — return safe defaults
    RETURN QUERY SELECT 'NOMINAL_COD'::TEXT, 'FLOOR'::TEXT, 'COD_FEE_ONLY'::TEXT;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.get_active_billing_config(BIGINT, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 7. compute_order_costs(order_id) — jantung Phase 4C
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_order_costs(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_channel public.courier_channels%ROWTYPE;
  v_config RECORD;
  v_shipping_discount_rate NUMERIC;
  v_cod_fee_rate NUMERIC;
  v_ppn_rate NUMERIC;
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

  -- Skip kalau channel NULL: clear estimated fields supaya stale data tidak nyangkut
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

  -- Categorical config (default NOMINAL_COD/FLOOR/COD_FEE_ONLY kalau no config)
  SELECT * INTO v_config FROM public.get_active_billing_config(
    v_order.channel_id,
    COALESCE(v_order.order_date, CURRENT_DATE)
  );

  -- Numeric rates (default 0 kalau no rate)
  v_shipping_discount_rate := public.get_active_rate(
    v_order.channel_id, 'shipping_discount_rate', COALESCE(v_order.order_date, CURRENT_DATE)
  );
  v_cod_fee_rate := public.get_active_rate(
    v_order.channel_id, 'cod_fee_rate', COALESCE(v_order.order_date, CURRENT_DATE)
  );
  v_ppn_rate := public.get_active_rate(
    v_order.channel_id, 'ppn_rate', COALESCE(v_order.order_date, CURRENT_DATE)
  );

  -- Shipping computation
  v_shipping_gross := COALESCE(v_order.shipping_cost_actual, v_order.shipping_cost, 0);
  v_shipping_net := ROUND((v_shipping_gross * (1 - v_shipping_discount_rate))::NUMERIC, 2);

  -- COD fee base
  v_cod_fee_base_amount := CASE v_config.cod_fee_base
    WHEN 'NOMINAL_COD' THEN
      CASE WHEN v_order.payment_method = 'COD' THEN v_order.total ELSE 0 END
    WHEN 'BARANG_PLUS_ONGKIR_GROSS' THEN v_order.subtotal + v_shipping_gross
    WHEN 'BARANG_PLUS_ONGKIR_NET' THEN v_order.subtotal + v_shipping_net
    ELSE 0
  END;
  v_cod_fee_raw := v_cod_fee_base_amount * v_cod_fee_rate;
  v_cod_fee := CASE v_config.cod_fee_rounding
    WHEN 'FLOOR' THEN FLOOR(v_cod_fee_raw)
    WHEN 'CEIL' THEN CEIL(v_cod_fee_raw)
    WHEN 'ROUND' THEN ROUND(v_cod_fee_raw)
    ELSE v_cod_fee_raw
  END;

  -- PPN
  v_ppn := CASE v_config.ppn_applied_to
    WHEN 'COD_FEE_ONLY' THEN v_cod_fee * v_ppn_rate
    WHEN 'COD_FEE_PLUS_SHIPPING' THEN (v_cod_fee + v_shipping_net) * v_ppn_rate
    ELSE 0
  END;
  v_ppn := ROUND(v_ppn::NUMERIC, 2);

  v_total_cost := ROUND((v_shipping_net + v_cod_fee + v_ppn)::NUMERIC, 2);

  -- Cash in by billing model
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
  v_cash_in := ROUND(v_cash_in::NUMERIC, 2);

  -- HPP dari order_items
  SELECT COALESCE(SUM(qty * COALESCE(hpp_snapshot, 0)), 0)::NUMERIC INTO v_hpp
  FROM public.order_items WHERE order_id = p_order_id;

  -- Commission (cs + advertiser + admin yang ESTIMATED/EARNED/PAID, exclude CANCELLED)
  SELECT COALESCE(SUM(amount), 0)::NUMERIC INTO v_commission
  FROM public.commissions
  WHERE order_id = p_order_id
    AND status IN ('ESTIMATED', 'EARNED', 'PAID');

  -- Profit:
  --   MONTHLY_INVOICE: cash_in masih full (cost belum dipotong) → profit = cash_in - cost - hpp - commission
  --   NETT_OFF: cash_in sudah dipotong → profit = cash_in - hpp - commission
  --   DIRECT_TRANSFER: no cost karena customer transfer langsung → profit = cash_in - hpp - commission
  --   NO_RECONCILIATION: profit = cash_in - hpp - commission
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
END $$;

GRANT EXECUTE ON FUNCTION public.compute_order_costs(BIGINT) TO authenticated;

-- ----------------------------------------------------------
-- 8. Trigger: compute_order_costs on relevant order changes
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_compute_order_costs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.compute_order_costs(NEW.id);
  ELSIF TG_OP = 'UPDATE' AND (
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD.shipping_cost_actual IS DISTINCT FROM NEW.shipping_cost_actual OR
    OLD.channel_id IS DISTINCT FROM NEW.channel_id OR
    OLD.total IS DISTINCT FROM NEW.total
  ) THEN
    PERFORM public.compute_order_costs(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_compute_order_costs ON public.orders;
-- Run AFTER status/cost triggers (alphabetical name `trg_compute_order_costs` >
-- `trg_compute_commissions`) supaya commission row sudah inserted saat cost compute baca commissions.
CREATE TRIGGER trg_compute_order_costs
  AFTER INSERT OR UPDATE OF status, shipping_cost_actual, channel_id, total
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_compute_order_costs();

-- ----------------------------------------------------------
-- 9. Update analytics_per_channel (Phase 4B) — add profit fields
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_per_channel(DATE, DATE);
CREATE OR REPLACE FUNCTION public.analytics_per_channel(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  channel_id BIGINT,
  channel_code TEXT,
  channel_name TEXT,
  billing_model TEXT,
  total_orders BIGINT,
  total_revenue NUMERIC,
  total_shipping_charged NUMERIC,
  total_shipping_actual NUMERIC,
  shipping_diff NUMERIC,
  diterima_orders BIGINT,
  retur_orders BIGINT,
  total_payout NUMERIC,
  estimated_total_cost NUMERIC,
  estimated_cash_in NUMERIC,
  estimated_profit NUMERIC,
  profit_margin_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  SELECT
    o.channel_id,
    cc.code AS channel_code,
    cc.name AS channel_name,
    cc.billing_model,
    COUNT(*)::BIGINT AS total_orders,
    COALESCE(SUM(o.total), 0)::NUMERIC AS total_revenue,
    COALESCE(SUM(o.shipping_cost), 0)::NUMERIC AS total_shipping_charged,
    COALESCE(SUM(o.shipping_cost_actual), 0)::NUMERIC AS total_shipping_actual,
    (COALESCE(SUM(o.shipping_cost), 0) - COALESCE(SUM(o.shipping_cost_actual), 0))::NUMERIC AS shipping_diff,
    COUNT(*) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS diterima_orders,
    COUNT(*) FILTER (WHERE o.status = 'RETUR')::BIGINT AS retur_orders,
    COALESCE(SUM(o.payout_amount), 0)::NUMERIC AS total_payout,
    COALESCE(SUM(o.estimated_total_cost), 0)::NUMERIC AS estimated_total_cost,
    COALESCE(SUM(o.estimated_cash_in), 0)::NUMERIC AS estimated_cash_in,
    COALESCE(SUM(o.estimated_profit), 0)::NUMERIC AS estimated_profit,
    CASE
      WHEN COALESCE(SUM(o.total), 0) > 0
      THEN ROUND(COALESCE(SUM(o.estimated_profit), 0) * 100.0 / SUM(o.total), 2)
      ELSE 0
    END AS profit_margin_pct
  FROM public.orders o
  LEFT JOIN public.courier_channels cc ON cc.id = o.channel_id
  WHERE o.organization_id = v_org
    AND o.channel_id IS NOT NULL
    AND o.order_date BETWEEN p_from AND p_to
  GROUP BY o.channel_id, cc.code, cc.name, cc.billing_model
  ORDER BY COUNT(*) DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_per_channel(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 10. analytics_overview (Phase 4B) — extend dengan profit aggregate
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_overview(DATE, DATE);
CREATE OR REPLACE FUNCTION public.analytics_overview(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  total_orders BIGINT,
  total_revenue NUMERIC,
  total_cogs NUMERIC,
  total_shipping_charged NUMERIC,
  total_shipping_actual NUMERIC,
  total_payout NUMERIC,
  total_commissions_estimated NUMERIC,
  total_commissions_earned NUMERIC,
  total_commissions_paid NUMERIC,
  estimated_total_cost NUMERIC,
  estimated_cash_in NUMERIC,
  estimated_profit NUMERIC,
  profit_margin_pct NUMERIC,
  orders_baru BIGINT,
  orders_siap_kirim BIGINT,
  orders_dikirim BIGINT,
  orders_diterima BIGINT,
  orders_problem BIGINT,
  orders_retur BIGINT,
  orders_cancel BIGINT,
  orders_fake BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  WITH order_stats AS (
    SELECT
      COUNT(*)::BIGINT AS total_orders,
      COALESCE(SUM(o.total), 0)::NUMERIC AS total_revenue,
      COALESCE(SUM(o.shipping_cost), 0)::NUMERIC AS total_shipping_charged,
      COALESCE(SUM(o.shipping_cost_actual), 0)::NUMERIC AS total_shipping_actual,
      COALESCE(SUM(o.payout_amount), 0)::NUMERIC AS total_payout,
      COALESCE(SUM(o.estimated_total_cost), 0)::NUMERIC AS est_cost,
      COALESCE(SUM(o.estimated_cash_in), 0)::NUMERIC AS est_cash_in,
      COALESCE(SUM(o.estimated_profit), 0)::NUMERIC AS est_profit,
      COUNT(*) FILTER (WHERE o.status = 'BARU')::BIGINT AS baru,
      COUNT(*) FILTER (WHERE o.status = 'SIAP_KIRIM')::BIGINT AS siap,
      COUNT(*) FILTER (WHERE o.status = 'DIKIRIM')::BIGINT AS kirim,
      COUNT(*) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS terima,
      COUNT(*) FILTER (WHERE o.status = 'PROBLEM')::BIGINT AS problem,
      COUNT(*) FILTER (WHERE o.status = 'RETUR')::BIGINT AS retur,
      COUNT(*) FILTER (WHERE o.status = 'CANCEL')::BIGINT AS cancel,
      COUNT(*) FILTER (WHERE o.status = 'FAKE')::BIGINT AS fake
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.order_date BETWEEN p_from AND p_to
  ),
  cogs_stats AS (
    SELECT COALESCE(SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)), 0)::NUMERIC AS total_cogs
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.organization_id = v_org
      AND o.order_date BETWEEN p_from AND p_to
  ),
  comm_stats AS (
    SELECT
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'ESTIMATED'), 0)::NUMERIC AS est,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'EARNED'), 0)::NUMERIC AS earn,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'PAID'), 0)::NUMERIC AS paid
    FROM public.commissions c
    JOIN public.orders o ON o.id = c.order_id
    WHERE o.organization_id = v_org
      AND o.order_date BETWEEN p_from AND p_to
  )
  SELECT
    os.total_orders,
    os.total_revenue,
    cs.total_cogs,
    os.total_shipping_charged,
    os.total_shipping_actual,
    os.total_payout,
    cms.est,
    cms.earn,
    cms.paid,
    os.est_cost,
    os.est_cash_in,
    os.est_profit,
    CASE WHEN os.total_revenue > 0 THEN ROUND(os.est_profit * 100.0 / os.total_revenue, 2) ELSE 0 END AS profit_margin_pct,
    os.baru, os.siap, os.kirim, os.terima,
    os.problem, os.retur, os.cancel, os.fake
  FROM order_stats os
  CROSS JOIN cogs_stats cs
  CROSS JOIN comm_stats cms;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_overview(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 11. Seed default config untuk SPX_DIRECT (April 2026 verified)
-- ----------------------------------------------------------
DO $$
DECLARE
  v_channel_id BIGINT;
BEGIN
  SELECT id INTO v_channel_id FROM public.courier_channels WHERE code = 'SPX_DIRECT' LIMIT 1;
  IF v_channel_id IS NULL THEN
    RAISE NOTICE 'SPX_DIRECT channel not found, skipping seed.';
    RETURN;
  END IF;

  UPDATE public.courier_channels SET
    billing_model = 'MONTHLY_INVOICE',
    shipping_discount_label = 'Cashback Ongkir'
  WHERE id = v_channel_id;

  -- Numeric rates
  INSERT INTO public.courier_channel_rates (channel_id, rate_key, rate_value, effective_from, notes)
  VALUES
    (v_channel_id, 'shipping_discount_rate', 0.40, '2026-01-01'::DATE, 'SPX cashback 40% (verified April 2026 invoice)'),
    (v_channel_id, 'cod_fee_rate', 0.01, '2026-01-01'::DATE, 'SPX fee COD 1% (verified April 2026)'),
    (v_channel_id, 'ppn_rate', 0.12, '2026-01-01'::DATE, 'PPN 12% over fee COD')
  ON CONFLICT (channel_id, rate_key, effective_from) DO UPDATE
    SET rate_value = EXCLUDED.rate_value, notes = EXCLUDED.notes;

  -- Categorical config
  INSERT INTO public.channel_billing_config (
    channel_id, cod_fee_base, cod_fee_rounding, ppn_applied_to, effective_from, notes
  ) VALUES (
    v_channel_id, 'NOMINAL_COD', 'FLOOR', 'COD_FEE_ONLY', '2026-01-01'::DATE,
    'SPX default verified via real invoice April 2026'
  )
  ON CONFLICT (channel_id, effective_from) DO UPDATE
    SET cod_fee_base = EXCLUDED.cod_fee_base,
        cod_fee_rounding = EXCLUDED.cod_fee_rounding,
        ppn_applied_to = EXCLUDED.ppn_applied_to,
        notes = EXCLUDED.notes;
END $$;

-- ----------------------------------------------------------
-- 12. Backfill: compute existing orders dengan channel
-- ----------------------------------------------------------
DO $$
DECLARE
  v_order_id BIGINT;
  v_count INT := 0;
BEGIN
  FOR v_order_id IN
    SELECT id FROM public.orders WHERE channel_id IS NOT NULL
  LOOP
    PERFORM public.compute_order_costs(v_order_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfilled cost computation for % orders', v_count;
END $$;
