-- =============================================================
-- Migration 016 — Phase 4A: Commission Engine v2 + Pencairan
--
-- Re-aktifkan commission engine yang lama (drop di Phase 1) dengan:
-- 1. Cleanup orphan commission rows (FK ke orders missing pre-Phase 1)
-- 2. Convert commissions.status dari ENUM → TEXT + add CHECK constraint
--    yang include 'PAID' (sebelumnya enum legacy commission_status)
-- 3. Add pencairan tracking columns (paid_at, paid_by, payment_method,
--    payment_reference, payment_note)
-- 4. Re-add FK to orders (with ON DELETE CASCADE)
-- 5. Re-create compute_commissions() — sekarang pakai status enum
--    Phase 1 baru (DITERIMA → EARNED, RETUR/CANCEL/FAKE → CANCELLED).
--    PAID immutable (re-compute tidak overwrite).
-- 6. Trigger orders → trigger_compute_commissions() on INSERT or
--    UPDATE OF status. Idempotent re-compute.
-- 7. mark_commission_paid + bulk_mark_commission_paid RPCs
-- 8. Backfill existing orders sekali saat migration apply
-- =============================================================

-- ----------------------------------------------------------
-- 1. Cleanup orphan commissions (referensi order yang sudah tidak ada)
--    Ini one-time — hasil dari Phase 1 schema reset yang drop orders
--    tapi tidak ada FK CASCADE ke commissions (FK belum ada).
-- ----------------------------------------------------------
DELETE FROM public.commissions c
  WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = c.order_id);

-- ----------------------------------------------------------
-- 2. Convert status enum → TEXT (idempotent)
--    Kondisi cek lewat information_schema supaya re-run aman.
-- ----------------------------------------------------------
DO $$
DECLARE
  v_data_type TEXT;
BEGIN
  SELECT data_type INTO v_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'commissions'
    AND column_name = 'status';

  IF v_data_type = 'USER-DEFINED' THEN
    ALTER TABLE public.commissions
      ALTER COLUMN status TYPE TEXT USING status::TEXT;
  END IF;
END $$;

ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_status_check;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_status_check
  CHECK (status IN ('ESTIMATED', 'EARNED', 'CANCELLED', 'PAID'));

-- Hapus enum type legacy kalau ada (no-op kalau tabel/kolom lain masih pakai)
DO $$
BEGIN
  BEGIN
    DROP TYPE IF EXISTS public.commission_status;
  EXCEPTION WHEN dependent_objects_still_exist THEN
    -- Diam kalau ada yang masih pakai (tidak fail migration)
    NULL;
  END;
END $$;

-- ----------------------------------------------------------
-- 3. Add pencairan tracking columns
-- ----------------------------------------------------------
ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_note TEXT;

CREATE INDEX IF NOT EXISTS idx_commissions_status_paid
  ON public.commissions(status) WHERE status = 'PAID';
CREATE INDEX IF NOT EXISTS idx_commissions_user_status
  ON public.commissions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_commissions_order
  ON public.commissions(order_id);

-- ----------------------------------------------------------
-- 4. Re-add FK to orders (sekarang konsisten setelah cleanup)
--    Kalau FK lama ada (commissions_order_id_fkey atau ..._fkey1), drop dulu.
-- ----------------------------------------------------------
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT c.conname FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'commissions' AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES orders%'
  LOOP
    EXECUTE format('ALTER TABLE public.commissions DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

-- ----------------------------------------------------------
-- 5. compute_commissions(p_order_id)
--    Status enum baru (Phase 1) → commission status mapping:
--      DITERIMA              → EARNED
--      CANCEL/FAKE/RETUR     → CANCELLED
--      lainnya               → ESTIMATED
--    PAID immutable: tidak overwrite kalau row existing sudah PAID.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_commissions(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_role TEXT;
  v_user_id UUID;
  v_rule public.commission_rules%ROWTYPE;
  v_amount NUMERIC;
  v_first_product_id BIGINT;
  v_target_status TEXT;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- NOTE: legacy compute_commissions reference v_order.duplicate_of —
  -- kolom itu di-drop di Phase 1 schema reset, jadi skip dedup check di sini.

  SELECT product_id INTO v_first_product_id
    FROM public.order_items WHERE order_id = p_order_id LIMIT 1;

  v_target_status := CASE
    WHEN v_order.status IN ('CANCEL', 'FAKE', 'RETUR') THEN 'CANCELLED'
    WHEN v_order.status = 'DITERIMA' THEN 'EARNED'
    ELSE 'ESTIMATED'  -- BARU, SIAP_KIRIM, DIKIRIM, PROBLEM
  END;

  FOR v_role, v_user_id IN
    SELECT 'cs'::TEXT, v_order.cs_id WHERE v_order.cs_id IS NOT NULL
    UNION ALL
    SELECT 'advertiser'::TEXT, v_order.advertiser_id WHERE v_order.advertiser_id IS NOT NULL
    UNION ALL
    SELECT 'admin'::TEXT, v_order.admin_id WHERE v_order.admin_id IS NOT NULL
  LOOP
    -- Lookup priority: paling spesifik menang
    -- (user+product) > (user) > (product) > (role only)
    SELECT * INTO v_rule
      FROM public.commission_rules
      WHERE role = v_role
        AND active = TRUE
        AND (effective_from IS NULL OR effective_from <= v_order.order_date)
        AND (user_id IS NULL OR user_id = v_user_id)
        AND (product_id IS NULL OR product_id = v_first_product_id)
      ORDER BY
        ((user_id IS NOT NULL)::INT + (product_id IS NOT NULL)::INT) DESC,
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

    -- Upsert dengan PAID immutability:
    -- - Kalau row baru → INSERT (status = v_target_status)
    -- - Kalau existing PAID → WHERE clause skip update (audit preserved)
    -- - Kalau existing non-PAID → UPDATE amount + status
    INSERT INTO public.commissions (order_id, user_id, role, amount, status)
      VALUES (p_order_id, v_user_id, v_role, v_amount, v_target_status)
      ON CONFLICT (order_id, user_id, role) DO UPDATE
        SET amount = EXCLUDED.amount,
            status = EXCLUDED.status
        WHERE public.commissions.status <> 'PAID';
  END LOOP;
END $$;

-- ----------------------------------------------------------
-- 6. Trigger compute_commissions on orders INSERT or status UPDATE
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_compute_commissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.compute_commissions(NEW.id);
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.compute_commissions(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_compute_commissions ON public.orders;
CREATE TRIGGER trg_compute_commissions
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_compute_commissions();

-- ----------------------------------------------------------
-- 7. mark_commission_paid(commission_id, method, reference?, note?)
--    Hanya commission status='EARNED' yang bisa di-mark PAID.
--    ESTIMATED ditolak (order belum DITERIMA = belum confirmed).
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_commission_paid(
  p_commission_id BIGINT,
  p_payment_method TEXT,
  p_payment_reference TEXT DEFAULT NULL,
  p_payment_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT;
  v_status TEXT;
BEGIN
  SELECT o.organization_id, c.status INTO v_org, v_status
  FROM public.commissions c
  JOIN public.orders o ON o.id = c.order_id
  WHERE c.id = p_commission_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Commission not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_org <> public.current_org_id() THEN
    RAISE EXCEPTION 'Commission not in current organization' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'EARNED' THEN
    RAISE EXCEPTION 'Commission status must be EARNED to mark as paid (current: %)', v_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.commissions
    SET status = 'PAID',
        paid_at = NOW(),
        paid_by = auth.uid(),
        payment_method = p_payment_method,
        payment_reference = p_payment_reference,
        payment_note = p_payment_note
    WHERE id = p_commission_id;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_commission_paid(BIGINT, TEXT, TEXT, TEXT)
  TO authenticated;

-- ----------------------------------------------------------
-- 8. bulk_mark_commission_paid(ids[], method, reference?, note?)
--    Bulk version. Hanya update commission EARNED di current org.
--    Returns jumlah baris yang berhasil di-mark PAID.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_mark_commission_paid(
  p_commission_ids BIGINT[],
  p_payment_method TEXT,
  p_payment_reference TEXT DEFAULT NULL,
  p_payment_note TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_commission_ids IS NULL OR array_length(p_commission_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.commissions c
    SET status = 'PAID',
        paid_at = NOW(),
        paid_by = auth.uid(),
        payment_method = p_payment_method,
        payment_reference = p_payment_reference,
        payment_note = p_payment_note
    FROM public.orders o
    WHERE c.id = ANY(p_commission_ids)
      AND c.order_id = o.id
      AND o.organization_id = public.current_org_id()
      AND c.status = 'EARNED';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.bulk_mark_commission_paid(BIGINT[], TEXT, TEXT, TEXT)
  TO authenticated;

-- ----------------------------------------------------------
-- 9. Backfill — compute commission untuk semua order existing.
--    Skip CANCEL/FAKE/RETUR untuk efisiensi (status itu tetap EARNED → CANCELLED
--    via trigger seharusnya, tapi compute_commissions() menangani semua status).
--    Idempotent — kalau dijalankan ulang, ON CONFLICT WHERE skip PAID rows.
-- ----------------------------------------------------------
DO $$
DECLARE
  v_order_id BIGINT;
  v_count INT := 0;
BEGIN
  FOR v_order_id IN
    SELECT id FROM public.orders
  LOOP
    PERFORM public.compute_commissions(v_order_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfill processed % orders', v_count;
END $$;
