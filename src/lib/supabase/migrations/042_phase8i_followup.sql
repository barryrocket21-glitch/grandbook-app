-- =============================================================
-- Phase 8I-Followup — Weight Bug + Default Channel
-- Migration 042 — 2026-05-19
-- =============================================================
-- 4 issues di-fix dalam batch ini:
--   Issue #1 (CRITICAL) — SPX *Berat Paket (KG) generate "500.0" (gram di-treat KG).
--     Fix: source_field 'order_items.total_weight' → 'order_total_weight_kg'
--     + clear transform 'kg_format' (resolver handle gram→kg conversion + format).
--   Issue #4 — Default channel per converter profile.
--     ADD COLUMN converter_profiles.default_channel_id BIGINT (FK courier_channels).
--     Set orderonline_inbound default ke SPX_DIRECT.
--
-- Issue #2 (UI filter produk) & #3 (auto-fill address_detail) di-handle di code,
-- ga butuh DB change.
-- =============================================================

-- =============================================================
-- Issue #4 — default_channel_id column + FK
-- =============================================================
ALTER TABLE public.converter_profiles
  ADD COLUMN IF NOT EXISTS default_channel_id BIGINT
    REFERENCES public.courier_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_converter_profiles_default_channel
  ON public.converter_profiles(default_channel_id)
  WHERE default_channel_id IS NOT NULL;

-- Set default untuk orderonline_inbound (idempotent: only kalau channel SPX_DIRECT ada)
DO $$
DECLARE
  v_channel_id BIGINT;
BEGIN
  SELECT id INTO v_channel_id
    FROM public.courier_channels
    WHERE code = 'SPX_DIRECT'
    LIMIT 1;

  IF v_channel_id IS NOT NULL THEN
    UPDATE public.converter_profiles
      SET default_channel_id = v_channel_id
      WHERE code = 'orderonline_inbound'
        AND default_channel_id IS NULL;  -- jangan override kalau user sudah set manual
  END IF;
END $$;

-- =============================================================
-- Issue #1 — SPX outbound weight mapping fix
-- =============================================================
UPDATE public.converter_field_mappings
  SET source_field = 'order_total_weight_kg',
      transform = NULL
  WHERE profile_id = (SELECT id FROM public.converter_profiles WHERE code = 'spx_outbound')
    AND target_field LIKE '%Berat Paket%';

-- =============================================================
-- Verify
-- =============================================================
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.converter_field_mappings cfm
    JOIN public.converter_profiles cp ON cp.id = cfm.profile_id
    WHERE cp.code = 'spx_outbound'
      AND cfm.target_field LIKE '%Berat Paket%'
      AND cfm.source_field = 'order_total_weight_kg'
      AND cfm.transform IS NULL;
  IF v_count <> 1 THEN
    RAISE WARNING 'Phase 8I-Followup weight mapping update: expected 1 row, got %', v_count;
  END IF;
END $$;
