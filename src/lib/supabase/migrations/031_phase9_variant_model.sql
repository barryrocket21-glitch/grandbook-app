-- =============================================================
-- Phase 9 — Variant model (Orderonline-style multi-attribute)
-- =============================================================
-- Products jadi parent. Tabel product_variants nyimpen kombinasi
-- atribut (size × color × ...) dengan price/hpp/weight per variant.
--
-- order_items rewire: tambah variant_id (primary FK), product_id
-- tetap ada sebagai DENORMALIZED parent product (trigger auto-fill)
-- untuk backward compat semua analytics RPC existing.
--
-- Phase 8.5 trigger snapshot_hpp_on_order_items extended:
--   1. Auto-denorm product_id dari variant.product_id
--   2. Auto-fill hpp_snapshot dari variant.hpp (preferred) atau
--      products.hpp (fallback simple product tanpa variant)
--
-- Production cleanup: TRUNCATE order_items CASCADE + DELETE products
-- + DELETE commission_rules (per Barry decision, fresh start).
-- =============================================================

-- ----------------------------------------------------------
-- 1. product_attributes — master atribut (Ukuran, Warna, dst)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_attributes (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_attributes_org_name_unique UNIQUE (organization_id, name)
);

-- ----------------------------------------------------------
-- 2. product_attribute_values — nilai per atribut (36, 37, Hitam, Putih)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_attribute_values (
  id BIGSERIAL PRIMARY KEY,
  attribute_id BIGINT NOT NULL REFERENCES public.product_attributes(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  CONSTRAINT product_attribute_values_attr_value_unique UNIQUE (attribute_id, value)
);

CREATE INDEX IF NOT EXISTS idx_attr_values_attr ON public.product_attribute_values(attribute_id);

-- ----------------------------------------------------------
-- 3. Parent products extension
-- ----------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS has_variants BOOLEAN NOT NULL DEFAULT FALSE;

-- ----------------------------------------------------------
-- 4. product_variants — actual SKU rows (price/hpp/weight per variant)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_variants (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  variant_name TEXT NOT NULL,
  variation_code TEXT,

  price NUMERIC(15,2) NOT NULL DEFAULT 0,
  hpp   NUMERIC(15,2) NOT NULL DEFAULT 0,
  weight_grams INT,

  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT product_variants_unique UNIQUE (product_id, variant_name)
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_org_active ON public.product_variants(organization_id, active) WHERE active = TRUE;

-- ----------------------------------------------------------
-- 5. variant_attribute_values — junction (which variant has which attr value)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.variant_attribute_values (
  variant_id BIGINT NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  attribute_value_id BIGINT NOT NULL REFERENCES public.product_attribute_values(id) ON DELETE CASCADE,
  PRIMARY KEY (variant_id, attribute_value_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_attr_value_attr ON public.variant_attribute_values(attribute_value_id);

-- ----------------------------------------------------------
-- 6. product_attributes_assignment — which attributes a product uses
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_attributes_assignment (
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  attribute_id BIGINT NOT NULL REFERENCES public.product_attributes(id) ON DELETE CASCADE,
  display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, attribute_id)
);

-- ----------------------------------------------------------
-- 7. order_items rewire — add variant_id (primary FK), keep product_id (denorm parent)
-- ----------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variant_id BIGINT REFERENCES public.product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_variant ON public.order_items(variant_id);

-- ----------------------------------------------------------
-- 8. Replace Phase 8.5 trigger function — handle variant
--    Trigger sekarang:
--      a. Denormalize product_id dari variant_id kalau missing
--      b. Snapshot hpp dari variant.hpp (preferred) atau products.hpp (fallback)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_hpp_on_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Step 1: denormalize parent product_id dari variant_id (kalau caller hanya kasih variant_id)
  IF NEW.product_id IS NULL AND NEW.variant_id IS NOT NULL THEN
    SELECT pv.product_id INTO NEW.product_id
    FROM public.product_variants pv
    WHERE pv.id = NEW.variant_id;
  END IF;

  -- Step 2: snapshot HPP — variant preferred, parent product fallback
  IF NEW.hpp_snapshot IS NULL THEN
    IF NEW.variant_id IS NOT NULL THEN
      SELECT pv.hpp INTO NEW.hpp_snapshot
      FROM public.product_variants pv
      WHERE pv.id = NEW.variant_id;
    ELSIF NEW.product_id IS NOT NULL THEN
      SELECT p.hpp INTO NEW.hpp_snapshot
      FROM public.products p
      WHERE p.id = NEW.product_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Trigger from Phase 8.5 (migration 029) already exists; CREATE OR REPLACE
-- only updates function body. Recreate trigger to be safe.
DROP TRIGGER IF EXISTS trg_snapshot_hpp_order_items ON public.order_items;
CREATE TRIGGER trg_snapshot_hpp_order_items
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_hpp_on_order_items();

-- ----------------------------------------------------------
-- 9. Trigger: auto-set product_variants.organization_id from parent product
--    (UX: caller cuma kasih product_id + variant_name, org auto)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_variant_org_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.products WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fill_variant_org_id ON public.product_variants;
CREATE TRIGGER trg_fill_variant_org_id
  BEFORE INSERT ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.fill_variant_org_id();

-- ----------------------------------------------------------
-- 10. updated_at triggers untuk tabel baru
-- ----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_set_updated_at_attrs ON public.product_attributes;
CREATE TRIGGER trg_set_updated_at_attrs
  BEFORE UPDATE ON public.product_attributes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at_variants ON public.product_variants;
CREATE TRIGGER trg_set_updated_at_variants
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------
-- 11. RLS untuk tabel baru — pakai current_org_id() pattern Phase 1+
-- ----------------------------------------------------------
ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variant_attribute_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attributes_assignment ENABLE ROW LEVEL SECURITY;

-- SELECT: semua authenticated user dalam org
DROP POLICY IF EXISTS attrs_select ON public.product_attributes;
CREATE POLICY attrs_select ON public.product_attributes
  FOR SELECT USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS attr_values_select ON public.product_attribute_values;
CREATE POLICY attr_values_select ON public.product_attribute_values
  FOR SELECT USING (attribute_id IN (
    SELECT id FROM public.product_attributes WHERE organization_id = public.current_org_id()
  ));

DROP POLICY IF EXISTS variants_select ON public.product_variants;
CREATE POLICY variants_select ON public.product_variants
  FOR SELECT USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS var_attr_values_select ON public.variant_attribute_values;
CREATE POLICY var_attr_values_select ON public.variant_attribute_values
  FOR SELECT USING (variant_id IN (
    SELECT id FROM public.product_variants WHERE organization_id = public.current_org_id()
  ));

DROP POLICY IF EXISTS prod_attr_assign_select ON public.product_attributes_assignment;
CREATE POLICY prod_attr_assign_select ON public.product_attributes_assignment
  FOR SELECT USING (product_id IN (
    SELECT id FROM public.products WHERE organization_id = public.current_org_id()
  ));

-- ALL (insert/update/delete): owner + admin only
DROP POLICY IF EXISTS attrs_write ON public.product_attributes;
CREATE POLICY attrs_write ON public.product_attributes
  FOR ALL USING (
    organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  )
  WITH CHECK (
    organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS attr_values_write ON public.product_attribute_values;
CREATE POLICY attr_values_write ON public.product_attribute_values
  FOR ALL USING (
    attribute_id IN (
      SELECT id FROM public.product_attributes WHERE organization_id = public.current_org_id()
    )
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  )
  WITH CHECK (
    attribute_id IN (
      SELECT id FROM public.product_attributes WHERE organization_id = public.current_org_id()
    )
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS variants_write ON public.product_variants;
CREATE POLICY variants_write ON public.product_variants
  FOR ALL USING (
    organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  )
  WITH CHECK (
    organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS var_attr_values_write ON public.variant_attribute_values;
CREATE POLICY var_attr_values_write ON public.variant_attribute_values
  FOR ALL USING (
    variant_id IN (
      SELECT id FROM public.product_variants WHERE organization_id = public.current_org_id()
    )
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  )
  WITH CHECK (
    variant_id IN (
      SELECT id FROM public.product_variants WHERE organization_id = public.current_org_id()
    )
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS prod_attr_assign_write ON public.product_attributes_assignment;
CREATE POLICY prod_attr_assign_write ON public.product_attributes_assignment
  FOR ALL USING (
    product_id IN (SELECT id FROM public.products WHERE organization_id = public.current_org_id())
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  )
  WITH CHECK (
    product_id IN (SELECT id FROM public.products WHERE organization_id = public.current_org_id())
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

-- ----------------------------------------------------------
-- 12. PRODUCTION CLEANUP per Barry decision
--     ORDER PENTING: child first, parent last
-- ----------------------------------------------------------
TRUNCATE TABLE public.order_items RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.commission_rules RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.products RESTART IDENTITY CASCADE;
-- CASCADE order chain: order_items → commissions (FK), variant_attribute_values,
-- product_attributes_assignment, product_variants (FK to products) — all empty.
-- commissions sudah empty post-prelaunch cleanup, verified earlier.

-- =============================================================
-- DONE migration 031. Smoke test (next migration 032 + apply later):
--   * SELECT count from new tables: all 0
--   * SELECT has_variants column exists in products
--   * SELECT variant_id column exists in order_items
--   * Trigger trg_snapshot_hpp_order_items present
-- =============================================================
