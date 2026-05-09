-- =============================================================
-- Migration 015 — Phase 3C
-- 1. Extend order_status_history.source CHECK constraint with
--    'converter_outbound' so the audit trail can attribute status
--    changes triggered by the outbound (export to courier) engine.
-- 2. mark_orders_exported(order_ids[], new_status, source_profile_id, note)
--    Bulk RPC: update orders to new status (typically DIKIRIM)
--    in a single round-trip, then patch the auto-inserted history
--    rows with source='converter_outbound' + note + source_profile_id.
-- =============================================================

-- ----------------------------------------------------------
-- 1. Extend source CHECK constraint
-- ----------------------------------------------------------
ALTER TABLE public.order_status_history
  DROP CONSTRAINT IF EXISTS order_status_history_source_check;
ALTER TABLE public.order_status_history
  ADD CONSTRAINT order_status_history_source_check
  CHECK (source IN (
    'manual',
    'converter_inbound',
    'converter_rekonsil',
    'converter_outbound',
    'wa_paste',
    'admin_review',
    'system'
  ));

-- ----------------------------------------------------------
-- 2. mark_orders_exported RPC
-- Atomically updates many orders to a new status (DIKIRIM typically),
-- then patches the latest history row per order to attribute the
-- change to the outbound profile that triggered the export.
-- Returns the number of orders actually updated (skips no-ops).
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_orders_exported(
  p_order_ids BIGINT[],
  p_new_status TEXT,
  p_source_profile_id BIGINT,
  p_note TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
  v_count INT := 0;
  v_id BIGINT;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization context' USING ERRCODE = '42501';
  END IF;
  IF p_new_status NOT IN ('BARU','SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR','CANCEL','FAKE') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status USING ERRCODE = '22023';
  END IF;
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_id IN ARRAY p_order_ids LOOP
    UPDATE public.orders
      SET status = p_new_status
      WHERE id = v_id
        AND organization_id = v_org
        AND status IS DISTINCT FROM p_new_status;

    IF FOUND THEN
      UPDATE public.order_status_history
        SET source = 'converter_outbound',
            source_profile_id = p_source_profile_id,
            note = p_note
        WHERE id = (
          SELECT id FROM public.order_status_history
            WHERE order_id = v_id
            ORDER BY id DESC
            LIMIT 1
        );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_orders_exported(BIGINT[], TEXT, BIGINT, TEXT) TO authenticated;
