-- 144 — SPX status sync: fallback exact-match by tracking/resi when GB ref missing.
--
-- Root cause:
-- - apply_spx_status_sync() hanya match via Customer Reference No. = GB-...
-- - File status SPX tertentu / legacy tidak selalu bawa GB ref.
-- - Selama order draft sudah punya resi/tracking exact, sync harus tetap bisa
--   update status/ongkir via SPXID exact tanpa bergantung pada GB ref.
--
-- Behavior after this migration:
-- 1) Prioritas tetap: match by GB order_number.
-- 2) Jika GB ref kosong / tidak match, fallback ke exact tracking_no/resi pada orders_draft.
-- 3) Ambiguous exact-match (>1 row dengan tracking sama) dianggap no_match (safe fail).
-- 4) Saat sync sukses dan tracking_no ada, mirror ke kolom tracking_no + resi.

CREATE OR REPLACE FUNCTION public.apply_spx_status_sync(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_org BIGINT;
  r JSONB;
  v_ref TEXT;
  v_track TEXT;
  v_oid BIGINT;
  v_cur_status TEXT;
  v_mapped TEXT;
  v_track_hits INT;
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
    v_track := btrim(COALESCE(r->>'tracking_no',''));
    v_oid := NULL;
    v_cur_status := NULL;

    IF v_ref = '' AND v_track = '' THEN
      c_no_ref := c_no_ref + 1;
      CONTINUE;
    END IF;

    -- 1) Primary path: exact GB ref → orders_draft.order_number
    IF v_ref LIKE 'GB-%' THEN
      SELECT id, status INTO v_oid, v_cur_status
      FROM public.orders_draft
      WHERE order_number = v_ref AND organization_id = v_org
      LIMIT 1;
    END IF;

    -- 2) Fallback path: exact tracking/resi already stamped on draft.
    -- Safe only when the exact match is unique.
    IF v_oid IS NULL AND v_track <> '' THEN
      SELECT COUNT(*) INTO v_track_hits
      FROM public.orders_draft
      WHERE organization_id = v_org
        AND (
          tracking_no = v_track
          OR resi = v_track
        );

      IF v_track_hits = 1 THEN
        SELECT id, status INTO v_oid, v_cur_status
        FROM public.orders_draft
        WHERE organization_id = v_org
          AND (
            tracking_no = v_track
            OR resi = v_track
          )
        LIMIT 1;
      ELSIF v_track_hits > 1 THEN
        c_no_match := c_no_match + 1;
        CONTINUE;
      END IF;
    END IF;

    IF v_oid IS NULL THEN
      c_no_match := c_no_match + 1;
      CONTINUE;
    END IF;
    c_matched := c_matched + 1;

    v_mapped := NULL;
    IF COALESCE(r->>'tracking_status','') <> '' THEN
      SELECT internal_status INTO v_mapped
      FROM public.courier_channel_statuses
      WHERE channel_id = 1 AND lower(raw_status) = lower(btrim(r->>'tracking_status'))
      LIMIT 1;
    END IF;

    -- log transisi NON-terminal (terminal di-handle promote trigger).
    IF v_mapped IS NOT NULL
       AND v_mapped IS DISTINCT FROM v_cur_status
       AND v_mapped NOT IN ('DITERIMA','RETUR') THEN
      BEGIN
        INSERT INTO public.order_status_history(
          organization_id, order_id, order_number, from_status, to_status,
          changed_at, changed_by, source, raw_status, note
        ) VALUES (
          v_org, NULL, COALESCE(NULLIF(v_ref,''), '[tracking:' || v_track || ']'), v_cur_status, v_mapped,
          now(), auth.uid(), 'spx_sync', btrim(r->>'tracking_status'), 'Transisi via sync SPX'
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    UPDATE public.orders_draft SET
      tracking_no         = COALESCE(NULLIF(v_track,''), tracking_no),
      resi                = COALESCE(NULLIF(v_track,''), resi),
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
    'matched', c_matched,
    'updated', c_updated,
    'skipped_no_ref', c_no_ref,
    'skipped_no_match', c_no_match
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_spx_status_sync(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_spx_status_sync(jsonb) TO authenticated;
