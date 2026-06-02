-- 095 — Brief #14 PART 4: seed produk yang nyangkut di inbox + resolve alias-nya.
-- ============================================================================
-- 5 produk unresolved di inbox_unmatched_products → bikin di master + resolve
-- alias-nya ke product_id baru. HPP/berat/harga = PLACEHOLDER (0/NULL) +
-- ditandai di notes biar Barry lengkapin. JANGAN ngarang angka final.
-- weight_kg NULL → ke-flag "berat belum diisi" (#10). Varian (ukuran×warna)
-- di-setup manual lewat form produk (punya variant support, Phase 9) — defer.
-- Idempotent (WHERE NOT EXISTS / resolved_at IS NULL).

-- 1. Insert produk (idempotent by name per org)
INSERT INTO public.products (organization_id, name, display_name, price_default, hpp, packing_fee, weight_kg, active, notes)
SELECT 1, v.n, v.n, 0, 0, 0, NULL, true, 'Brief #14 seed — LENGKAPI: HPP, harga, berat (kg), varian'
FROM (VALUES ('Blade K45'), ('MJO Luna'), ('Sandal Luna'), ('Sneakers Gover'), ('Sandal GD')) AS v(n)
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p WHERE p.organization_id = 1 AND lower(p.name) = lower(v.n)
);

-- 2. Resolve alias inbox → product (mapping raw_name kotor → produk bersih)
UPDATE public.inbox_unmatched_products i
SET resolved_at = now(), resolved_to_product_id = p.id
FROM public.products p
WHERE i.organization_id = 1 AND i.resolved_at IS NULL AND p.organization_id = 1
  AND (
    (i.raw_name = 'MJO Luna'                       AND lower(p.name) = 'mjo luna') OR
    (i.raw_name = 'Blade K45'                      AND lower(p.name) = 'blade k45') OR
    (i.raw_name = 'Sandal Luna G'                  AND lower(p.name) = 'sandal luna') OR
    (i.raw_name = '1 Sandal GD F (1pcs)'           AND lower(p.name) = 'sandal gd') OR
    (i.raw_name = '1 Sneakers Gover K35 F (1pcs)'  AND lower(p.name) = 'sneakers gover')
  );
