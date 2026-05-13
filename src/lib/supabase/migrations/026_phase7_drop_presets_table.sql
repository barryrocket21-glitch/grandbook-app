-- =============================================================
-- Phase 7 v2 — Drop margin simulator presets table + RPC
-- =============================================================
-- Phase 7 v1 punya `margin_simulator_presets` table + 2 RPCs untuk
-- save/load scenario asumsi ADV per produk. v2 switch ke localStorage
-- (per-user di browser) karena untuk kalkulator standalone DB-backed
-- preset overkill — gak butuh server-side persistence buat asumsi
-- yang berubah-ubah saat brainstorming campaign.
--
-- KEEP: get_products_for_simulator(BIGINT) — masih dipakai untuk
--       dropdown produk dengan auto-calc margin (price_default - hpp).
-- =============================================================

-- Drop table (CASCADE bersihin RLS policies + trigger + indexes)
DROP TABLE IF EXISTS public.margin_simulator_presets CASCADE;

-- Drop presets-only RPC
DROP FUNCTION IF EXISTS public.get_presets_by_product(BIGINT);

-- Recreate get_products_for_simulator WITHOUT has_default_preset column.
-- Body lama reference margin_simulator_presets (subquery EXISTS) — sekarang
-- table-nya gone, function tidak lagi punya cara nge-cek server-side mana
-- produk yang punya default preset (preset sekarang client-side localStorage).
DROP FUNCTION IF EXISTS public.get_products_for_simulator(BIGINT);
CREATE OR REPLACE FUNCTION public.get_products_for_simulator(p_org_id BIGINT)
RETURNS TABLE (
  product_id    BIGINT,
  product_name  TEXT,
  sku           TEXT,
  price_default NUMERIC,
  hpp           NUMERIC,
  margin_item   NUMERIC
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id                                                       AS product_id,
    p.name                                                     AS product_name,
    p.sku                                                      AS sku,
    p.price_default                                            AS price_default,
    p.hpp                                                      AS hpp,
    GREATEST(p.price_default - COALESCE(p.hpp, 0), 0)::NUMERIC AS margin_item
  FROM public.products p
  WHERE p.organization_id = p_org_id
    AND p.active = TRUE
  ORDER BY p.name ASC;
$$;

-- =============================================================
-- After apply, smoke test:
--   * information_schema.tables WHERE table_name='margin_simulator_presets'
--       → 0 rows
--   * pg_proc WHERE proname='get_presets_by_product'
--       → 0 rows
--   * pg_proc WHERE proname='get_products_for_simulator'
--       → 1 row (preserved, return shape updated)
-- =============================================================
