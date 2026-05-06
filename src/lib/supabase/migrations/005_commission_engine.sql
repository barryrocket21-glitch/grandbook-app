-- Phase 4: Commission engine
-- Triggers + functions yang otomatis create/transition komisi
-- berdasarkan status order dan resi_status.
--
-- Flow:
--   Order status → DIKIRIM       : create commissions ESTIMATED untuk CS, Adv, Admin
--   resi_status → DITERIMA       : transition ESTIMATED → EARNED
--   resi_status → RETUR          : transition ESTIMATED → CANCELLED (reason: retur)
--   Order status → CANCEL/FAKE   : transition ESTIMATED → CANCELLED (reason: cancelled order)

-- =============================================================
-- Function: hitung komisi untuk 1 order, insert rows ke commissions
-- =============================================================
CREATE OR REPLACE FUNCTION public.compute_commissions(p_order_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_role text;
  v_user_id uuid;
  v_rule public.commission_rules%ROWTYPE;
  v_amount numeric;
  v_first_product_id bigint;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Skip duplicates
  IF v_order.duplicate_of IS NOT NULL THEN RETURN; END IF;

  -- Get first product_id of this order (for per-product rules)
  SELECT product_id INTO v_first_product_id
    FROM public.order_items WHERE order_id = p_order_id LIMIT 1;

  -- For each role, find user_id on order and matching rule
  FOR v_role, v_user_id IN
    SELECT 'cs', v_order.cs_id WHERE v_order.cs_id IS NOT NULL
    UNION ALL
    SELECT 'advertiser', v_order.advertiser_id WHERE v_order.advertiser_id IS NOT NULL
    UNION ALL
    SELECT 'admin', v_order.admin_id WHERE v_order.admin_id IS NOT NULL
  LOOP
    -- Find most specific active rule (per-product first, then global)
    SELECT * INTO v_rule
      FROM public.commission_rules
      WHERE role = v_role
        AND active = true
        AND (effective_from IS NULL OR effective_from <= v_order.order_date)
        AND (product_id IS NULL OR product_id = v_first_product_id)
      ORDER BY (product_id IS NOT NULL) DESC, effective_from DESC NULLS LAST
      LIMIT 1;

    IF NOT FOUND THEN CONTINUE; END IF;

    -- Calculate amount
    IF v_rule.rule_type = 'PERCENT_REVENUE' THEN
      v_amount := v_order.total * v_rule.value / 100.0;
    ELSIF v_rule.rule_type = 'FLAT_PER_ORDER' THEN
      v_amount := v_rule.value;
    ELSE
      CONTINUE;
    END IF;

    -- Insert with ESTIMATED status (idempotent via unique constraint)
    INSERT INTO public.commissions (order_id, user_id, role, amount, status)
      VALUES (p_order_id, v_user_id, v_role, v_amount, 'ESTIMATED')
      ON CONFLICT (order_id, user_id, role) DO UPDATE SET amount = EXCLUDED.amount;
  END LOOP;
END $$;

-- =============================================================
-- Function: transition status semua komisi untuk 1 order
-- =============================================================
CREATE OR REPLACE FUNCTION public.transition_commissions(
  p_order_id bigint,
  p_new_status commission_status,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_new_status = 'EARNED' THEN
    UPDATE public.commissions
      SET status = 'EARNED', earned_at = now()
      WHERE order_id = p_order_id AND status = 'ESTIMATED';
  ELSIF p_new_status = 'CANCELLED' THEN
    UPDATE public.commissions
      SET status = 'CANCELLED', cancelled_at = now(), cancelled_reason = p_reason
      WHERE order_id = p_order_id AND status = 'ESTIMATED';
  END IF;
END $$;

-- =============================================================
-- Trigger function: react ke order updates
-- =============================================================
CREATE OR REPLACE FUNCTION public.orders_commission_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Newly DIKIRIM (or status changed to DIKIRIM): create estimasi komisi
  IF (TG_OP = 'INSERT' AND NEW.status = 'DIKIRIM')
     OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'DIKIRIM') THEN
    PERFORM public.compute_commissions(NEW.id);
  END IF;

  -- resi_status changed to DITERIMA: ESTIMATED → EARNED
  IF TG_OP = 'UPDATE' AND OLD.resi_status IS DISTINCT FROM NEW.resi_status
     AND NEW.resi_status = 'DITERIMA' THEN
    PERFORM public.transition_commissions(NEW.id, 'EARNED');
  END IF;

  -- resi_status changed to RETUR: ESTIMATED → CANCELLED
  IF TG_OP = 'UPDATE' AND OLD.resi_status IS DISTINCT FROM NEW.resi_status
     AND NEW.resi_status = 'RETUR' THEN
    PERFORM public.transition_commissions(NEW.id, 'CANCELLED', 'order returned');
  END IF;

  -- order status to CANCEL or FAKE: kill all komisi
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('CANCEL', 'FAKE') THEN
    PERFORM public.transition_commissions(NEW.id, 'CANCELLED',
      CASE WHEN NEW.status = 'FAKE' THEN 'fake order' ELSE 'order cancelled' END);
  END IF;

  RETURN NEW;
END $$;

-- Attach trigger
DROP TRIGGER IF EXISTS orders_commission_trigger ON public.orders;
CREATE TRIGGER orders_commission_trigger
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_commission_trigger();

-- =============================================================
-- Backfill: hitung komisi untuk order yang sudah ada
-- =============================================================
DO $$
DECLARE r record;
BEGIN
  -- Untuk semua order yang sudah DIKIRIM dan belum punya commissions
  FOR r IN
    SELECT o.id FROM public.orders o
    WHERE o.status IN ('DIKIRIM','SAMPAI','SELESAI')
      AND o.duplicate_of IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.commissions c WHERE c.order_id = o.id)
  LOOP
    PERFORM public.compute_commissions(r.id);
  END LOOP;

  -- Transition komisi yang sudah DITERIMA
  FOR r IN
    SELECT id FROM public.orders WHERE resi_status = 'DITERIMA'
  LOOP
    PERFORM public.transition_commissions(r.id, 'EARNED');
  END LOOP;

  -- Cancel komisi yang sudah RETUR
  FOR r IN
    SELECT id FROM public.orders WHERE resi_status = 'RETUR'
  LOOP
    PERFORM public.transition_commissions(r.id, 'CANCELLED', 'retur (backfill)');
  END LOOP;
END $$;
