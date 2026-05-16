-- =============================================================
-- PHASE 8A: Multi-Supplier Foundation
-- =============================================================
-- Tambah konsep "supplier" (gudang dropship) ke sistem:
-- 1. Tabel suppliers (per org, soft-delete via active flag)
-- 2. products.supplier_id (nullable — produk lama tetap valid)
-- 3. orders.origin_supplier_id + is_multi_origin (nullable / FALSE default)
-- 4. RLS: SELECT semua user dalam org, INSERT/UPDATE/DELETE owner+admin only
--
-- IDEMPOTENT: safe to re-run (uses IF NOT EXISTS / IF EXISTS DROP).
-- Helper functions yang dipakai (current_org_id, get_user_role, set_updated_at)
-- sudah ada di production sejak schema awal + migration 010.
-- =============================================================

-- =============================================================
-- 1. suppliers table
-- =============================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,                 -- short code untuk display (misal "JKT", "TGR-PARANET")
  address TEXT,
  city TEXT,
  province TEXT,
  pic_name TEXT,
  pic_phone TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Code unik per organization (kalau diisi). NULL code allowed multiple times.
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_org_code
  ON public.suppliers(organization_id, code)
  WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_org_active
  ON public.suppliers(organization_id, active);

-- updated_at trigger (reuse helper dari migration 010)
DROP TRIGGER IF EXISTS trg_set_updated_at_suppliers ON public.suppliers;
CREATE TRIGGER trg_set_updated_at_suppliers
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =============================================================
-- 2. RLS policies
-- =============================================================
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
DROP POLICY IF EXISTS suppliers_insert ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update ON public.suppliers;
DROP POLICY IF EXISTS suppliers_delete ON public.suppliers;

-- SELECT: semua authenticated user dalam org bisa baca daftar supplier
-- (form produk/order butuh dropdown ini, bukan hanya owner/admin)
CREATE POLICY suppliers_select ON public.suppliers
  FOR SELECT
  USING (organization_id = public.current_org_id());

-- INSERT/UPDATE/DELETE: owner + admin only (DB-level enforcement,
-- UI gating tetap ada via PermissionGuard)
CREATE POLICY suppliers_insert ON public.suppliers
  FOR INSERT
  WITH CHECK (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin')
  );

CREATE POLICY suppliers_update ON public.suppliers
  FOR UPDATE
  USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin')
  )
  WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY suppliers_delete ON public.suppliers
  FOR DELETE
  USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin')
  );

-- =============================================================
-- 3. products.supplier_id (nullable — produk lama belum punya supplier)
-- =============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_supplier ON public.products(supplier_id);

-- =============================================================
-- 4. orders.origin_supplier_id + is_multi_origin
-- =============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS origin_supplier_id BIGINT REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_multi_origin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_origin_supplier ON public.orders(origin_supplier_id);

-- =============================================================
-- DONE.
-- Verify dengan:
--   SELECT count(*) FROM public.suppliers;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='products' AND column_name='supplier_id';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='orders' AND column_name IN ('origin_supplier_id','is_multi_origin');
-- =============================================================
