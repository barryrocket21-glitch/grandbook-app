-- =============================================================
-- Migration 014 — Phase 3B
-- Rekonsil RPC: update_order_from_rekonsil
-- Atomic: update orders fields (status + costs + meta merge) +
-- patch the auto-inserted order_status_history row to attribute the
-- change to source='converter_rekonsil' with raw_status + note.
--
-- Trigger trg_log_order_status_update (migrations 010 + 012) inserts
-- a 'manual' history row whenever status changes — we just patch its
-- source/raw_status/note after the UPDATE.
-- =============================================================

CREATE OR REPLACE FUNCTION public.update_order_from_rekonsil(
  p_order_id BIGINT,
  p_new_status TEXT,                  -- nullable: NULL = jangan update status
  p_shipping_cost_actual NUMERIC,     -- nullable
  p_payout_amount NUMERIC,            -- nullable
  p_cod_amount NUMERIC,               -- nullable
  p_meta_merge JSONB,                 -- merged into existing meta
  p_status_changed_at TIMESTAMPTZ,    -- nullable, fallback NOW() when status changes
  p_source_profile_id BIGINT,
  p_raw_status TEXT,                  -- audit: what the file/inference said
  p_note TEXT
)
RETURNS BIGINT  -- order_status_history.id when status changed, NULL otherwise
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT;
  v_old_status TEXT;
  v_history_id BIGINT;
  v_old_meta JSONB;
BEGIN
  SELECT organization_id, status, COALESCE(meta, '{}'::jsonb)
    INTO v_org, v_old_status, v_old_meta
  FROM public.orders WHERE id = p_order_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_org <> public.current_org_id() THEN
    RAISE EXCEPTION 'Order not in current organization' USING ERRCODE = '42501';
  END IF;

  IF p_new_status IS NOT NULL AND p_new_status NOT IN
    ('BARU','SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR','CANCEL','FAKE') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
    SET status = COALESCE(p_new_status, status),
        shipping_cost_actual = COALESCE(p_shipping_cost_actual, shipping_cost_actual),
        payout_amount = COALESCE(p_payout_amount, payout_amount),
        cod_amount = COALESCE(p_cod_amount, cod_amount),
        meta = v_old_meta || COALESCE(p_meta_merge, '{}'::jsonb),
        status_changed_at = CASE
          WHEN p_new_status IS NOT NULL AND p_new_status <> v_old_status
            THEN COALESCE(p_status_changed_at, NOW())
          ELSE status_changed_at
        END
    WHERE id = p_order_id;

  -- Patch auto-inserted history row if status actually changed
  IF p_new_status IS NOT NULL AND p_new_status <> v_old_status THEN
    UPDATE public.order_status_history
      SET source = 'converter_rekonsil',
          source_profile_id = p_source_profile_id,
          raw_status = p_raw_status,
          note = p_note
      WHERE id = (
        SELECT id FROM public.order_status_history
          WHERE order_id = p_order_id
          ORDER BY id DESC
          LIMIT 1
      )
      RETURNING id INTO v_history_id;
  END IF;

  RETURN v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_order_from_rekonsil(
  BIGINT, TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB, TIMESTAMPTZ, BIGINT, TEXT, TEXT
) TO authenticated;
