-- =============================================================
-- Migration 012 — Phase 3A
-- 1. generate_order_number(org_id) RPC for order number generation
-- 2. Improved log_order_status_change trigger to capture changed_by from auth.uid()
-- 3. update_order_status RPC for atomic status transition with note + source
-- =============================================================

-- ----------------------------------------------------------
-- 1. Order Number Generator
-- Format: GB-YYYYMMDD-NNNNNN (counter per organization per day)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_order_number(org_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  date_prefix TEXT := TO_CHAR(NOW(), 'YYYYMMDD');
  counter INT;
  candidate TEXT;
  attempt INT := 0;
BEGIN
  LOOP
    SELECT COUNT(*) + 1 INTO counter
    FROM public.orders
    WHERE organization_id = org_id
      AND DATE(created_at AT TIME ZONE 'UTC') = (NOW() AT TIME ZONE 'UTC')::date;

    candidate := 'GB-' || date_prefix || '-' || LPAD((counter + attempt)::TEXT, 6, '0');

    -- Verify uniqueness within org (race-safe loop)
    PERFORM 1 FROM public.orders
      WHERE organization_id = org_id AND order_number = candidate;
    IF NOT FOUND THEN
      RETURN candidate;
    END IF;

    attempt := attempt + 1;
    IF attempt > 50 THEN
      RAISE EXCEPTION 'generate_order_number: could not produce unique number after 50 attempts';
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_order_number(BIGINT) TO authenticated;

-- ----------------------------------------------------------
-- 2. Improved status-change trigger
-- Captures auth.uid() for UPDATEs (was always NEW.created_by, which was wrong)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    actor := COALESCE(NEW.created_by, auth.uid());
    INSERT INTO public.order_status_history (
      organization_id, order_id, from_status, to_status,
      changed_by, source, note
    ) VALUES (
      NEW.organization_id, NEW.id, NULL, NEW.status,
      actor, 'system', 'Order created'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    actor := COALESCE(auth.uid(), NEW.created_by);
    INSERT INTO public.order_status_history (
      organization_id, order_id, from_status, to_status,
      changed_by, source
    ) VALUES (
      NEW.organization_id, NEW.id, OLD.status, NEW.status,
      actor, 'manual'
    );
    NEW.status_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------
-- 3. update_order_status RPC
-- Atomic: update status + insert status_history with proper note + source.
-- The trigger above will ALSO insert a 'manual' entry — to avoid duplicate,
-- we directly UPDATE status (trigger fires) then UPDATE the latest history
-- row to attach note + custom source.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id BIGINT,
  p_new_status TEXT,
  p_source TEXT DEFAULT 'admin_review',
  p_note TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT;
  v_history_id BIGINT;
BEGIN
  -- Org-isolation check via current_org_id()
  SELECT organization_id INTO v_org FROM public.orders WHERE id = p_order_id;
  IF v_org IS NULL OR v_org <> public.current_org_id() THEN
    RAISE EXCEPTION 'Order not found or no access' USING ERRCODE = '42501';
  END IF;

  IF p_new_status NOT IN ('BARU','SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR','CANCEL','FAKE') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET status = p_new_status WHERE id = p_order_id;

  -- Patch the row that the trigger just inserted with note + custom source
  UPDATE public.order_status_history
    SET note = p_note, source = p_source
    WHERE id = (
      SELECT id FROM public.order_status_history
        WHERE order_id = p_order_id
        ORDER BY id DESC
        LIMIT 1
    )
    RETURNING id INTO v_history_id;

  RETURN v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_order_status(BIGINT, TEXT, TEXT, TEXT) TO authenticated;
