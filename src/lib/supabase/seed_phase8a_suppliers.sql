-- =============================================================
-- PHASE 8A SEED: 3 supplier contoh (Jakarta-Kran, Tangerang-Paranet, Malang-Madu)
-- =============================================================
-- Idempotent — skip kalau code sudah ada di organization tujuan.
-- Pakai organization pertama (default org id=1).
-- =============================================================

INSERT INTO public.suppliers (organization_id, name, code, city, province, active)
SELECT
  (SELECT id FROM public.organizations ORDER BY id LIMIT 1),
  'Supplier Jakarta - Kran',
  'JKT-KRAN',
  'Jakarta Pusat',
  'DKI Jakarta',
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.suppliers
  WHERE organization_id = (SELECT id FROM public.organizations ORDER BY id LIMIT 1)
    AND code = 'JKT-KRAN'
);

INSERT INTO public.suppliers (organization_id, name, code, city, province, active)
SELECT
  (SELECT id FROM public.organizations ORDER BY id LIMIT 1),
  'Supplier Tangerang - Paranet',
  'TGR-PARANET',
  'Tangerang',
  'Banten',
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.suppliers
  WHERE organization_id = (SELECT id FROM public.organizations ORDER BY id LIMIT 1)
    AND code = 'TGR-PARANET'
);

INSERT INTO public.suppliers (organization_id, name, code, city, province, active)
SELECT
  (SELECT id FROM public.organizations ORDER BY id LIMIT 1),
  'Supplier Malang - Madu',
  'MLG-MADU',
  'Malang',
  'Jawa Timur',
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.suppliers
  WHERE organization_id = (SELECT id FROM public.organizations ORDER BY id LIMIT 1)
    AND code = 'MLG-MADU'
);
