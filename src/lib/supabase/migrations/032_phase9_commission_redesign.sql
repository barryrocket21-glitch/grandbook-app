-- =============================================================
-- Phase 9 — Commission redesign (state machine + rate_type)
-- =============================================================
-- Per Barry decision (Flag #2):
--   * NO trigger AUTO generate commission saat order create — frontend
--     manual call `compute_commissions(order_id)` setelah BOTH order +
--     order_items insert selesai (timing safety)
--   * KEEP trigger AFTER UPDATE status ON orders untuk auto-transition
--     status (PENDING/EARNED → VOIDED on RETUR/CANCEL/FAKE, PENDING/EARNED → EARNED on DITERIMA)
--
-- Per Barry decision (Multi-item with parent BEDA):
--   * Commission row PER order_item PER role
--   * order_item_id FK ditambah ke commissions table
--   * Aggregation di UI/analytics SUM by order+role
--
-- Schema naming: rate_type / rate_value (semantic per brief), active
-- (project convention, bukan is_active).
-- =============================================================

-- ----------------------------------------------------------
-- 1. commissions table: update status CHECK + tambah order_item_id
-- ----------------------------------------------------------
ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_status_check;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_status_check
  CHECK (status IN ('PENDING', 'EARNED', 'PAID', 'VOIDED'));

ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS order_item_id BIGINT REFERENCES public.order_items(id) ON DELETE CASCADE;

ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_commissions_order_item ON public.commissions(order_item_id);
CREATE INDEX IF NOT EXISTS idx_commissions_order_role ON public.commissions(order_id, role);

-- ----------------------------------------------------------
-- 2. commission_rules: DROP CASCADE + recreate dengan rate_type/rate_value
-- ----------------------------------------------------------
-- CASCADE akan drop function compute_commissions yang depend (Phase 4A
-- migration 008 + 016). Kita re-create di bawah dengan schema baru.
DROP TABLE IF EXISTS public.commission_rules CASCADE;

CREATE TABLE public.commission_rules (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  role TEXT NOT NULL CHECK (role IN ('cs', 'advertiser')),
  product_id BIGINT REFERENCES public.products(id) ON DELETE CASCADE,
  -- NULL product_id = default rule untuk role itu (catch-all)

  rate_type TEXT NOT NULL CHECK (rate_type IN ('FLAT_PER_ORDER', 'PERCENT_REVENUE', 'NONE')),
  rate_value NUMERIC(15,2),
  -- FLAT_PER_ORDER → rate_value = rupiah per order_item
  -- PERCENT_REVENUE → rate_value = 0..100 (persen dari revenue line item)
  -- NONE → rate_value NULL/0, commission = 0

  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT commission_rules_unique UNIQUE (organization_id, role, product_id)
);

CREATE INDEX idx_commission_rules_lookup
  ON public.commission_rules(organization_id, role, product_id) WHERE active = TRUE;

ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commission_rules_select ON public.commission_rules;
CREATE POLICY commission_rules_select ON public.commission_rules
  FOR SELECT USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS commission_rules_write ON public.commission_rules;
CREATE POLICY commission_rules_write ON public.commission_rules
  FOR ALL USING (
    organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  )
  WITH CHECK (
    organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

DROP TRIGGER IF EXISTS trg_set_updated_at_commission_rules ON public.commission_rules;
CREATE TRIGGER trg_set_updated_at_commission_rules
  BEFORE UPDATE ON public.commission_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------
-- 3. compute_commissions(order_id) — main engine RPC
--    Frontend call after BOTH order + order_items insert done
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.compute_commissions(BIGINT);
CREATE OR REPLACE FUNCTION public.compute_commissions(p_order_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT;
  v_cs_id UUID;
  v_adv_id UUID;
  v_status TEXT;
  v_item RECORD;
  v_revenue NUMERIC;
  v_cs_rule RECORD;
  v_adv_rule RECORD;
  v_cs_amount NUMERIC;
  v_adv_amount NUMERIC;
  v_initial_status TEXT;
  v_inserted INT := 0;
  v_skipped INT := 0;
BEGIN
  -- Load order context
  SELECT o.organization_id, o.cs_id, o.status, c.advertiser_id
  INTO v_org, v_cs_id, v_status, v_adv_id
  FROM public.orders o
  LEFT JOIN public.campaigns c ON c.id = o.campaign_id
  WHERE o.id = p_order_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- Initial commission status based on current order.status:
  -- DITERIMA → langsung EARNED (skip PENDING)
  -- RETUR/CANCEL/FAKE → langsung VOIDED (skip PENDING) — kasus rare, biasanya frontend call setelah create dengan status BARU
  -- Lainnya (BARU/SIAP_KIRIM/DIKIRIM/PROBLEM) → PENDING
  IF v_status = 'DITERIMA' THEN
    v_initial_status := 'EARNED';
  ELSIF v_status IN ('RETUR', 'CANCEL', 'FAKE') THEN
    v_initial_status := 'VOIDED';
  ELSE
    v_initial_status := 'PENDING';
  END IF;

  -- Clear existing PENDING/EARNED commissions for this order (idempotent recompute)
  -- DO NOT touch PAID — itu sacred (audit trail). VOIDED juga jangan ditouch.
  DELETE FROM public.commissions
  WHERE order_id = p_order_id AND status IN ('PENDING', 'EARNED');

  -- Loop tiap order_item, compute commission per role
  FOR v_item IN
    SELECT
      oi.id AS item_id,
      oi.product_id,
      oi.qty,
      oi.price,
      (oi.qty * oi.price) AS line_revenue
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    v_revenue := COALESCE(v_item.line_revenue, 0);

    -- CS rule lookup: product-specific first, default fallback
    SELECT * INTO v_cs_rule
    FROM public.commission_rules
    WHERE organization_id = v_org
      AND role = 'cs'
      AND active = TRUE
      AND (product_id = v_item.product_id OR product_id IS NULL)
    ORDER BY product_id NULLS LAST  -- specific dulu, NULL (default) belakangan
    LIMIT 1;

    -- Calculate CS amount
    IF v_cs_rule IS NULL THEN
      v_cs_amount := 0;
    ELSIF v_cs_rule.rate_type = 'FLAT_PER_ORDER' THEN
      v_cs_amount := COALESCE(v_cs_rule.rate_value, 0);
    ELSIF v_cs_rule.rate_type = 'PERCENT_REVENUE' THEN
      v_cs_amount := v_revenue * (COALESCE(v_cs_rule.rate_value, 0) / 100.0);
    ELSE  -- 'NONE'
      v_cs_amount := 0;
    END IF;

    -- Insert CS commission kalau ada cs_id + amount > 0
    IF v_cs_id IS NOT NULL AND v_cs_amount > 0 THEN
      INSERT INTO public.commissions (
        order_id, order_item_id, user_id, role, amount, status, organization_id
      ) VALUES (
        p_order_id, v_item.item_id, v_cs_id, 'cs', v_cs_amount, v_initial_status, v_org
      );
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;

    -- ADV rule lookup
    SELECT * INTO v_adv_rule
    FROM public.commission_rules
    WHERE organization_id = v_org
      AND role = 'advertiser'
      AND active = TRUE
      AND (product_id = v_item.product_id OR product_id IS NULL)
    ORDER BY product_id NULLS LAST
    LIMIT 1;

    IF v_adv_rule IS NULL THEN
      v_adv_amount := 0;
    ELSIF v_adv_rule.rate_type = 'FLAT_PER_ORDER' THEN
      v_adv_amount := COALESCE(v_adv_rule.rate_value, 0);
    ELSIF v_adv_rule.rate_type = 'PERCENT_REVENUE' THEN
      v_adv_amount := v_revenue * (COALESCE(v_adv_rule.rate_value, 0) / 100.0);
    ELSE
      v_adv_amount := 0;
    END IF;

    IF v_adv_id IS NOT NULL AND v_adv_amount > 0 THEN
      INSERT INTO public.commissions (
        order_id, order_item_id, user_id, role, amount, status, organization_id
      ) VALUES (
        p_order_id, v_item.item_id, v_adv_id, 'advertiser', v_adv_amount, v_initial_status, v_org
      );
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'inserted', v_inserted,
    'skipped',  v_skipped,
    'initial_status', v_initial_status
  );
END $$;

GRANT EXECUTE ON FUNCTION public.compute_commissions(BIGINT) TO authenticated;

-- ----------------------------------------------------------
-- 4. Trigger: status change → transition komisi
--    (per Barry: KEEP this trigger, fires AFTER items exist)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_commission_on_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'DITERIMA' THEN
      -- PENDING → EARNED (sales accepted, commission earned)
      UPDATE public.commissions
        SET status = 'EARNED', updated_at = NOW()
      WHERE order_id = NEW.id
        AND status = 'PENDING';
    ELSIF NEW.status IN ('RETUR', 'CANCEL', 'FAKE') THEN
      -- PENDING/EARNED → VOIDED. PAID tidak di-touch (audit-safe).
      UPDATE public.commissions
        SET status = 'VOIDED', updated_at = NOW()
      WHERE order_id = NEW.id
        AND status IN ('PENDING', 'EARNED');
    ELSIF NEW.status IN ('BARU', 'SIAP_KIRIM', 'DIKIRIM', 'PROBLEM') AND OLD.status IN ('DITERIMA', 'RETUR', 'CANCEL', 'FAKE') THEN
      -- Rollback case: order udah final, ternyata mau diubah balik ke pre-final.
      -- VOIDED/EARNED → PENDING. PAID tetap PAID.
      UPDATE public.commissions
        SET status = 'PENDING', updated_at = NOW()
      WHERE order_id = NEW.id
        AND status IN ('EARNED', 'VOIDED');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_update_commission_on_status ON public.orders;
CREATE TRIGGER trg_update_commission_on_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_commission_on_order_status();

-- ----------------------------------------------------------
-- 5. Drop legacy trigger Phase 4A (orders → compute_commissions old)
--    Sudah dropped via CASCADE saat DROP TABLE commission_rules,
--    tapi defensive cleanup di sini.
-- ----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_compute_commissions ON public.orders;
DROP FUNCTION IF EXISTS public.trigger_compute_commissions() CASCADE;

-- =============================================================
-- DONE migration 032. Smoke test:
--   * SELECT count commission_rules = 0
--   * compute_commissions on dummy order → JSONB result {inserted, skipped}
--   * trg_update_commission_on_status exists
--   * mark_commission_paid still works (untouched)
-- =============================================================
