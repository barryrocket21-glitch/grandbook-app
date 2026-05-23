-- =============================================================
-- 065 — Phase 8K-Geo: multi-source wilayah coverage
-- =============================================================
-- SPX's official mass-upload list ships 7,092 kecamatan. Aggregators
-- (Mengantar, Komship) carry ~637 extra kecamatan that real Indonesian
-- addresses use but SPX hasn't synced yet (pemekaran, new admin splits).
--
-- This migration adds a `source` column so we can ingest aggregator rows
-- alongside the SPX baseline. parse_address_v3_lookup is unchanged —
-- all rows are treated uniformly, so WA paste picks up the extra
-- coverage automatically.
--
-- Data ingestion is a separate one-shot:
--   npm run seed:wilayah-extra
-- =============================================================

ALTER TABLE public.master_wilayah_spx
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'SPX';

CREATE INDEX IF NOT EXISTS idx_master_wilayah_spx_source
  ON public.master_wilayah_spx (source);

COMMENT ON COLUMN public.master_wilayah_spx.source IS
  'Where this row came from: SPX | MENGANTAR | KOMSHIP. SPX rows are the canonical baseline; the others fill gaps SPX is missing.';
