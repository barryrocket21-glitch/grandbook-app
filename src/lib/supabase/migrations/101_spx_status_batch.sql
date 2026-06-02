-- 101 — Brief #13 PART 2: catat riwayat upload Sync Status SPX.
-- ============================================================================
-- Sync Status SPX (apply_spx_status_sync) selama ini langsung apply tanpa nyatet
-- batch. Ini nambah pencatatan ke reconciliation_batches (reuse table Phase 8I)
-- biar ada riwayat: file, matched/unmatched, total ongkir aktual, APPLIED.
-- INVOKER (RLS reconciliation_batches: org + role owner/admin/akunting). Idempotent.

DROP FUNCTION IF EXISTS public.record_spx_status_batch(text, integer, integer, integer, integer, numeric);
CREATE OR REPLACE FUNCTION public.record_spx_status_batch(
  p_file_name TEXT,
  p_file_size INTEGER,
  p_total     INTEGER,
  p_matched   INTEGER,
  p_unmatched INTEGER,
  p_shipping  NUMERIC DEFAULT 0
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE v_org BIGINT; v_id BIGINT;
BEGIN
  v_org := public.current_org_id();
  INSERT INTO public.reconciliation_batches(
    organization_id, channel_id, file_name, file_size_bytes,
    total_rows, matched_count, unmatched_count, variance_count,
    total_shipping_applied, status,
    uploaded_at, uploaded_by, applied_at, applied_by, notes
  ) VALUES (
    v_org, 1, p_file_name, p_file_size,
    p_total, p_matched, p_unmatched, 0,
    COALESCE(p_shipping, 0), 'APPLIED',
    now(), auth.uid(), now(), auth.uid(), 'Sync Status SPX (apply_spx_status_sync)'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_spx_status_batch(text, integer, integer, integer, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_spx_status_batch(text, integer, integer, integer, integer, numeric) TO authenticated;
