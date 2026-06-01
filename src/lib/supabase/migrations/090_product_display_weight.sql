-- 090 — Brief #10: Master Produk — display_name (nama bersih) + weight_kg (flat).
-- ============================================================================
-- 2 pain harian:
--   (1) berat-0 di SPX → weight_kg flat per produk (kg), Σ(weight_kg×qty) → file.
--   (2) bocor kode internal di resi ("TM Jaring Paranet G") → display_name bersih
--       ("Jaring Paranet") yang dipakai di file SPX.
-- products.name TETAP = internal match key (yang diketik CS, buat nyocokin intake).
-- Line-item + ukuran (variation) udah ada di order_items_draft (Phase 1) — gak rebuild.
-- Idempotent. weight_kg NULL = "berat belum diisi" → di-flag di UI (jangan kirim 0).

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;

COMMENT ON COLUMN public.products.display_name IS 'Brief #10 — nama bersih utk resi/SPX (vs products.name = internal match key). Default = name, Barry rapiin manual.';
COMMENT ON COLUMN public.products.weight_kg IS 'Brief #10 — berat flat per produk (kg, estimasi). NULL = belum diisi → flag di UI, jangan export 0.';

-- Backfill display_name = name (Barry rapiin nama bersih nanti). weight_kg biarin NULL.
UPDATE public.products SET display_name = name WHERE display_name IS NULL OR btrim(display_name) = '';
