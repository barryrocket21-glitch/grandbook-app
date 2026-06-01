-- 092 — Brief #13: Sync SPX (resi + status → Post-Export).
-- ============================================================================
-- Import file status SPX → cocokin Customer Reference No. (GB-) → tulis resi
-- (tracking_no, BUKAN kolom resi yg trigger promote!), status (via mapping #12),
-- alasan retur, ongkir actual/return ke order yang UDAH ADA di Post-Export.
-- ATURAN HARAM: NEVER bikin order, NEVER nimpa intake (customer/alamat/produk/CS),
-- no-GB-/no-match → SKIP, idempotent.
-- Order TETAP di Post-Export (orders_draft) — status-nya berubah, bukan pindah.
-- Makanya pakai tracking_no (kolom baru), JANGAN resi (trigger promote_draft).
-- Idempotent. INVOKER.

ALTER TABLE public.orders_draft ADD COLUMN IF NOT EXISTS tracking_no TEXT;
ALTER TABLE public.orders_draft ADD COLUMN IF NOT EXISTS tracking_status TEXT;        -- raw SPX status
ALTER TABLE public.orders_draft ADD COLUMN IF NOT EXISTS actual_shipping_fee NUMERIC;
ALTER TABLE public.orders_draft ADD COLUMN IF NOT EXISTS return_shipping_fee NUMERIC;
ALTER TABLE public.orders_draft ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE public.orders_draft ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;
ALTER TABLE public.orders_draft ADD COLUMN IF NOT EXISTS retur_reason TEXT;            -- modul retur baca nanti (#4)
ALTER TABLE public.orders_draft ADD COLUMN IF NOT EXISTS tracking_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_draft_tracking_no ON public.orders_draft(tracking_no);

COMMENT ON COLUMN public.orders_draft.tracking_no IS 'Brief #13 — resi dari SPX sync. PAKAI INI, BUKAN kolom resi (yg trigger promote_draft_to_orders). Order tetap di Post-Export.';

-- ============================================================================
-- apply_spx_status_sync(p_rows jsonb) — match GB- → update field SPX doang.
--   p_rows = [{ ref, tracking_no, tracking_status, actual_fee, return_fee,
--               delivered_at(iso|null), retur_reason }]
--   ref bukan 'GB-%' / kosong → skip. order gak ketemu → skip. NEVER create.
--   COALESCE(new, old) → gak nge-blank field yg udah keisi (idempotent + aman).
-- ============================================================================
DROP FUNCTION IF EXISTS public.apply_spx_status_sync(jsonb);

CREATE OR REPLACE FUNCTION public.apply_spx_status_sync(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_org BIGINT;
  r JSONB;
  v_ref TEXT;
  v_oid BIGINT;
  v_cur_status TEXT;
  v_mapped TEXT;
  c_matched INT := 0;
  c_updated INT := 0;
  c_no_ref INT := 0;
  c_no_match INT := 0;
BEGIN
  v_org := public.current_org_id();
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('matched',0,'updated',0,'skipped_no_ref',0,'skipped_no_match',0);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) AS t(value)
  LOOP
    v_ref := btrim(COALESCE(r->>'ref',''));
    -- HARAM: no-GB- / kosong → SKIP total (order legacy/manual)
    IF v_ref = '' OR v_ref NOT LIKE 'GB-%' THEN
      c_no_ref := c_no_ref + 1;
      CONTINUE;
    END IF;

    SELECT id, status INTO v_oid, v_cur_status
    FROM public.orders_draft
    WHERE order_number = v_ref AND organization_id = v_org;

    -- HARAM: gak ketemu → SKIP (NEVER bikin order baru)
    IF v_oid IS NULL THEN
      c_no_match := c_no_match + 1;
      CONTINUE;
    END IF;
    c_matched := c_matched + 1;

    -- map status kurir → enum internal (read-only mapping #12, SPX = channel 1)
    v_mapped := NULL;
    IF COALESCE(r->>'tracking_status','') <> '' THEN
      SELECT internal_status INTO v_mapped
      FROM public.courier_channel_statuses
      WHERE channel_id = 1 AND lower(raw_status) = lower(btrim(r->>'tracking_status'))
      LIMIT 1;
    END IF;

    -- update FIELD SPX DOANG. customer/alamat/produk/CS/atribusi = JANGAN disentuh.
    UPDATE public.orders_draft SET
      tracking_no         = COALESCE(NULLIF(btrim(COALESCE(r->>'tracking_no','')),''), tracking_no),
      tracking_status     = COALESCE(NULLIF(btrim(COALESCE(r->>'tracking_status','')),''), tracking_status),
      status              = COALESCE(v_mapped, status),
      actual_shipping_fee = COALESCE((NULLIF(btrim(COALESCE(r->>'actual_fee','')),''))::numeric, actual_shipping_fee),
      return_shipping_fee = COALESCE((NULLIF(btrim(COALESCE(r->>'return_fee','')),''))::numeric, return_shipping_fee),
      delivered_at        = CASE WHEN v_mapped = 'DITERIMA'
                                 THEN COALESCE((NULLIF(btrim(COALESCE(r->>'delivered_at','')),''))::timestamptz, delivered_at, now())
                                 ELSE delivered_at END,
      returned_at         = CASE WHEN v_mapped = 'RETUR'
                                 THEN COALESCE((NULLIF(btrim(COALESCE(r->>'delivered_at','')),''))::timestamptz, returned_at, now())
                                 ELSE returned_at END,
      retur_reason        = CASE WHEN v_mapped = 'RETUR'
                                 THEN COALESCE(NULLIF(btrim(COALESCE(r->>'retur_reason','')),''), retur_reason)
                                 ELSE retur_reason END,
      tracking_synced_at  = now()
    WHERE id = v_oid;
    c_updated := c_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'matched', c_matched, 'updated', c_updated,
    'skipped_no_ref', c_no_ref, 'skipped_no_match', c_no_match
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_spx_status_sync(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_spx_status_sync(jsonb) TO authenticated;
