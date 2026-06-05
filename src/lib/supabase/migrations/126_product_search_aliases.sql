-- =============================================================
-- Migration 126 — products.search_aliases (alias teks buat auto-match input)
-- =============================================================
-- Konteks: "Luna" / "MJO Luna" sebenarnya = Sandal Luna (produk di-merge,
-- lihat data-fix MJO Luna 14 -> Sandal Luna 8). Biar input order (WA paste /
-- orderonline) yang nulis "Luna" auto ke-match ke Sandal Luna, kita simpan
-- alias teks per produk. Matcher (product-matcher.ts exact + wa-paste-adapter
-- substring) cek name + aliases (case-insensitive).
-- Idempotent.
-- =============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS search_aliases text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.products.search_aliases IS
  'Alias teks buat auto-match input order (mis. Sandal Luna alias {luna, mjo luna}). Case-insensitive.';

-- Seed: Sandal Luna (id 8) <- "luna" / "mjo luna"
UPDATE public.products
SET search_aliases = ARRAY['luna', 'mjo luna']
WHERE id = 8 AND organization_id = 1;
