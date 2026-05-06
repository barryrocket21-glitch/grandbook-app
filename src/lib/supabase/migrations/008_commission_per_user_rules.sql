-- Phase 9: komisi mulai ESTIMATED sejak status BARU + rule per-user
-- Sudah diapply ke production via exec_sql RPC.
--
-- Behavior change:
-- - Sebelumnya: komisi ESTIMATED dibuat saat status berubah ke DIKIRIM
-- - Sekarang: komisi ESTIMATED dibuat saat order DIBUAT (status BARU s/d SAMPAI)
--   Cancel kalau status berubah ke CANCEL/FAKE/RETUR
--   Earn kalau resi_status DITERIMA
--
-- Rule lookup priority (paling spesifik menang):
--   1. (user_id + product_id) — rate khusus si CS untuk produk tertentu
--   2. (user_id) — rate khusus si CS untuk semua produk
--   3. (product_id) — rate global per produk
--   4. (role only) — rate default

-- 1. Tambah user_id ke commission_rules
ALTER TABLE public.commission_rules
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 2. Update compute_commissions dengan lookup priority baru
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
  IF v_order.duplicate_of IS NOT NULL THEN RETURN; END IF;

  SELECT product_id INTO v_first_product_id
    FROM public.order_items WHERE order_id = p_order_id LIMIT 1;

  FOR v_role, v_user_id IN
    SELECT 'cs', v_order.cs_id WHERE v_order.cs_id IS NOT NULL
    UNION ALL
    SELECT 'advertiser', v_order.advertiser_id WHERE v_order.advertiser_id IS NOT NULL
    UNION ALL
    SELECT 'admin', v_order.admin_id WHERE v_order.admin_id IS NOT NULL
  LOOP
    -- Priority: user+product > user > product > role-only
    SELECT * INTO v_rule
      FROM public.commission_rules
      WHERE role = v_role
        AND active = true
        AND (effective_from IS NULL OR effective_from <= v_order.order_date)
        AND (user_id IS NULL OR user_id = v_user_id)
        AND (product_id IS NULL OR product_id = v_first_product_id)
      ORDER BY
        ((user_id IS NOT NULL)::int + (product_id IS NOT NULL)::int) DESC,
        (user_id IS NOT NULL) DESC,
        (product_id IS NOT NULL) DESC,
        effective_from DESC NULLS LAST
      LIMIT 1;

    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_rule.rule_type = 'PERCENT_REVENUE' THEN
      v_amount := v_order.total * v_rule.value / 100.0;
    ELSIF v_rule.rule_type = 'FLAT_PER_ORDER' THEN
      v_amount := v_rule.value;
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.commissions (order_id, user_id, role, amount, status)
      VALUES (p_order_id, v_user_id, v_role, v_amount, 'ESTIMATED')
      ON CONFLICT (order_id, user_id, role) DO UPDATE SET amount = EXCLUDED.amount;
  END LOOP;
END $$;

-- 3. Update trigger: fire ON INSERT (any non-cancel/fake status) + RETUR cancel
CREATE OR REPLACE FUNCTION public.orders_commission_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- INSERT: bikin estimasi langsung (kecuali order langsung CANCEL/FAKE)
  IF TG_OP = 'INSERT' AND NEW.status NOT IN ('CANCEL', 'FAKE') THEN
    PERFORM public.compute_commissions(NEW.id);
  END IF;

  -- UPDATE: re-compute kalau cs/adv/admin/total/duplicate_of berubah (bisa ganti rate)
  IF TG_OP = 'UPDATE' AND NEW.status NOT IN ('CANCEL', 'FAKE')
     AND (
       OLD.cs_id IS DISTINCT FROM NEW.cs_id OR
       OLD.advertiser_id IS DISTINCT FROM NEW.advertiser_id OR
       OLD.admin_id IS DISTINCT FROM NEW.admin_id OR
       OLD.total IS DISTINCT FROM NEW.total OR
       OLD.duplicate_of IS DISTINCT FROM NEW.duplicate_of
     ) THEN
    PERFORM public.compute_commissions(NEW.id);
  END IF;

  -- resi_status DITERIMA: ESTIMATED → EARNED
  IF TG_OP = 'UPDATE' AND OLD.resi_status IS DISTINCT FROM NEW.resi_status
     AND NEW.resi_status = 'DITERIMA' THEN
    PERFORM public.transition_commissions(NEW.id, 'EARNED');
  END IF;

  -- resi RETUR atau order RETUR: cancel
  IF TG_OP = 'UPDATE' AND (
       (OLD.resi_status IS DISTINCT FROM NEW.resi_status AND NEW.resi_status = 'RETUR') OR
       (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'RETUR')
     ) THEN
    PERFORM public.transition_commissions(NEW.id, 'CANCELLED', 'order returned');
  END IF;

  -- order → CANCEL/FAKE: kill
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('CANCEL', 'FAKE') THEN
    PERFORM public.transition_commissions(NEW.id, 'CANCELLED',
      CASE WHEN NEW.status = 'FAKE' THEN 'fake order' ELSE 'order cancelled' END);
  END IF;

  RETURN NEW;
END $$;

-- 4. Backfill: bikin commission untuk order yang belum punya (yang status BARU/DIPROSES)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT o.id FROM public.orders o
    WHERE o.status NOT IN ('CANCEL', 'FAKE')
      AND o.duplicate_of IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.commissions c WHERE c.order_id = o.id)
  LOOP
    PERFORM public.compute_commissions(r.id);
  END LOOP;
END $$;
