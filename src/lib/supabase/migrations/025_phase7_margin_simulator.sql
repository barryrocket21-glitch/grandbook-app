-- =============================================================
-- Phase 7 — Margin Simulator presets + RPC functions
-- =============================================================
-- Calculator margin & ROI multi-scenario untuk ADV decide CPR maks
-- sebelum jalankan campaign. Preset disimpan per produk × scenario.
--
-- Adaptasi dari brief Phase 7:
--   * organization_id / product_id → BIGINT (bukan UUID — match BIGSERIAL
--     di organizations + products)
--   * products column: pakai `price_default` + `active` (bukan `harga_jual`
--     + `deleted_at` yang tidak exist di schema GrandBook)
--   * role string: 'advertiser' (bukan 'adv')
--   * trigger function: pakai existing `public.set_updated_at()` dari
--     migration 010 (bukan update_updated_at_column yang tidak ada)
--   * RLS pattern: pakai `current_org_id()` konsisten dengan migration 010+
-- =============================================================

-- ----------------------------------------------------------
-- 1. Table: margin_simulator_presets
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.margin_simulator_presets (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL
    REFERENCES public.products(id) ON DELETE CASCADE,
  scenario_name TEXT NOT NULL DEFAULT 'Default',

  -- Inputs (margin asumsi ADV)
  margin_item NUMERIC(15,2) NOT NULL
    CHECK (margin_item >= 0),
  cpr_max NUMERIC(15,2) NOT NULL
    CHECK (cpr_max >= 0),
  lead_dashboard INT NOT NULL DEFAULT 0
    CHECK (lead_dashboard >= 0),
  jenis_iklan TEXT NOT NULL DEFAULT 'Form'
    CHECK (jenis_iklan IN ('Form','WA','Short','CTWA')),
  multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0
    CHECK (multiplier > 0 AND multiplier <= 10),
  closing_rate NUMERIC(5,2) NOT NULL DEFAULT 20
    CHECK (closing_rate >= 0 AND closing_rate <= 100),
  rts_rate NUMERIC(5,2) NOT NULL DEFAULT 20
    CHECK (rts_rate >= 0 AND rts_rate <= 100),
  ppn_rate NUMERIC(5,2) NOT NULL DEFAULT 12
    CHECK (ppn_rate >= 0 AND ppn_rate <= 100),

  -- Meta
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, product_id, scenario_name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_msp_org_product
  ON public.margin_simulator_presets(organization_id, product_id);

-- Enforce: max 1 default per (org, product). Juga berfungsi sbg lookup index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_msp_one_default_per_product
  ON public.margin_simulator_presets(organization_id, product_id)
  WHERE is_default = TRUE;

-- ----------------------------------------------------------
-- 2. Trigger updated_at (reuse existing set_updated_at)
-- ----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_set_updated_at_msp ON public.margin_simulator_presets;
CREATE TRIGGER trg_set_updated_at_msp
  BEFORE UPDATE ON public.margin_simulator_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------
-- 3. RLS — pakai pattern current_org_id() konsisten Phase 1+
-- ----------------------------------------------------------
ALTER TABLE public.margin_simulator_presets ENABLE ROW LEVEL SECURITY;

-- SELECT: semua user dalam org boleh baca (transparency, ADV bisa lihat
-- preset advertiser lain juga supaya bisa belajar dari scenario peer).
DROP POLICY IF EXISTS msp_select_policy ON public.margin_simulator_presets;
CREATE POLICY msp_select_policy ON public.margin_simulator_presets
  FOR SELECT
  USING (organization_id = public.current_org_id());

-- INSERT/UPDATE/DELETE: hanya advertiser + owner.
DROP POLICY IF EXISTS msp_write_policy ON public.margin_simulator_presets;
CREATE POLICY msp_write_policy ON public.margin_simulator_presets
  FOR ALL
  USING (
    organization_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('advertiser','owner')
    )
  )
  WITH CHECK (
    organization_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('advertiser','owner')
    )
  );

-- ----------------------------------------------------------
-- 4. RPC: get_products_for_simulator
--    Output untuk dropdown produk dengan auto-calc margin_item
--    (price_default - hpp) + flag has_default_preset.
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_products_for_simulator(BIGINT);
CREATE OR REPLACE FUNCTION public.get_products_for_simulator(p_org_id BIGINT)
RETURNS TABLE (
  product_id          BIGINT,
  product_name        TEXT,
  sku                 TEXT,
  price_default       NUMERIC,
  hpp                 NUMERIC,
  margin_item         NUMERIC,
  has_default_preset  BOOLEAN
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
    GREATEST(p.price_default - COALESCE(p.hpp, 0), 0)::NUMERIC AS margin_item,
    EXISTS (
      SELECT 1 FROM public.margin_simulator_presets msp
      WHERE msp.product_id = p.id
        AND msp.organization_id = p_org_id
        AND msp.is_default = TRUE
    )                                                          AS has_default_preset
  FROM public.products p
  WHERE p.organization_id = p_org_id
    AND p.active = TRUE
  ORDER BY p.name ASC;
$$;

-- ----------------------------------------------------------
-- 5. RPC: get_presets_by_product
--    Output semua preset untuk produk tertentu.
--    Default-first, kemudian alphabetical scenario_name.
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_presets_by_product(BIGINT);
CREATE OR REPLACE FUNCTION public.get_presets_by_product(p_product_id BIGINT)
RETURNS SETOF public.margin_simulator_presets
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.margin_simulator_presets
  WHERE product_id = p_product_id
    AND organization_id = public.current_org_id()
  ORDER BY is_default DESC, scenario_name ASC;
$$;

-- ----------------------------------------------------------
-- DONE. After apply:
--   * 1 table + 2 indexes (1 unique partial) + 1 trigger + 2 policies
--   * 2 RPCs callable
-- =============================================================
