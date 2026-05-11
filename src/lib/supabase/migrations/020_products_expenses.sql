-- =============================================================
-- Migration 020 — Phase 5A: Products Extended + Operational Expenses
--
-- Tujuan:
--  1. Add `organization_id` ke products (multi-tenant prep)
--  2. Bikin tabel `product_categories` (FK target untuk products.category_id)
--  3. Migrate products.category (TEXT) → category_id (FK) + backfill
--  4. Tambah products.variation, notes, created_at, updated_at
--  5. RLS untuk products + product_categories
--  6. Bikin tabel `operational_expenses` (extended dari expenses lama, dengan
--     recurring/vendor/payment_method fields + organization_id + RLS)
--  7. Backfill data dari legacy `expenses` → `operational_expenses` (kalau ada)
--  8. RPCs: analytics_expenses_summary, analytics_profit_per_product,
--           analytics_overview_v2 (extends Phase 4C dengan op_expenses + net_profit)
-- =============================================================

-- ----------------------------------------------------------
-- 1. Add organization_id ke products + backfill ke org default
-- ----------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES public.organizations(id);

UPDATE public.products SET organization_id = 1 WHERE organization_id IS NULL;
ALTER TABLE public.products ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_org ON public.products(organization_id);

-- ----------------------------------------------------------
-- 2. product_categories (FK target)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_categories (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  display_order INT DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT product_categories_org_slug_unique UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_org
  ON public.product_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_active
  ON public.product_categories(organization_id, active);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_categories_select ON public.product_categories;
DROP POLICY IF EXISTS product_categories_insert ON public.product_categories;
DROP POLICY IF EXISTS product_categories_update ON public.product_categories;
DROP POLICY IF EXISTS product_categories_delete ON public.product_categories;

CREATE POLICY product_categories_select ON public.product_categories
  FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY product_categories_insert ON public.product_categories
  FOR INSERT WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY product_categories_update ON public.product_categories
  FOR UPDATE USING (organization_id = public.current_org_id());
CREATE POLICY product_categories_delete ON public.product_categories
  FOR DELETE USING (organization_id = public.current_org_id());

-- ----------------------------------------------------------
-- 3. Add category_id + variation + notes + created_at/updated_at ke products
-- ----------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES public.product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variation TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);

-- Backfill: products.category (TEXT) → product_categories + link via category_id
DO $$
DECLARE
  v_old_cat TEXT;
  v_cat_id BIGINT;
  v_org_id BIGINT;
  v_slug TEXT;
BEGIN
  FOR v_old_cat, v_org_id IN
    SELECT DISTINCT category, organization_id FROM public.products
    WHERE category IS NOT NULL AND category != ''
  LOOP
    v_slug := LOWER(REGEXP_REPLACE(TRIM(v_old_cat), '\s+', '-', 'g'));
    v_slug := REGEXP_REPLACE(v_slug, '[^a-z0-9\-]', '', 'g');
    IF v_slug = '' THEN
      CONTINUE;
    END IF;

    -- Cari ID kategori (idempotent: kalau sudah ada, pakai itu)
    SELECT id INTO v_cat_id FROM public.product_categories
    WHERE organization_id = v_org_id AND slug = v_slug;

    IF v_cat_id IS NULL THEN
      INSERT INTO public.product_categories (organization_id, name, slug)
      VALUES (v_org_id, v_old_cat, v_slug)
      RETURNING id INTO v_cat_id;
    END IF;

    -- Update products yang punya category text ini
    UPDATE public.products
    SET category_id = v_cat_id
    WHERE category = v_old_cat
      AND organization_id = v_org_id
      AND category_id IS NULL;
  END LOOP;
END $$;

-- ----------------------------------------------------------
-- 4. RLS untuk products
-- ----------------------------------------------------------
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone can view active products" ON public.products;
DROP POLICY IF EXISTS "Owner/akunting can manage products" ON public.products;
DROP POLICY IF EXISTS products_select ON public.products;
DROP POLICY IF EXISTS products_insert ON public.products;
DROP POLICY IF EXISTS products_update ON public.products;
DROP POLICY IF EXISTS products_delete ON public.products;

CREATE POLICY products_select ON public.products
  FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY products_insert ON public.products
  FOR INSERT WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY products_update ON public.products
  FOR UPDATE USING (organization_id = public.current_org_id());
CREATE POLICY products_delete ON public.products
  FOR DELETE USING (organization_id = public.current_org_id());

-- ----------------------------------------------------------
-- 5. operational_expenses table (extended dari expenses lama)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operational_expenses (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  expense_date DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'GAJI',           -- Gaji karyawan
    'SEWA',           -- Sewa kantor/gudang/rumah
    'UTILITY',        -- Listrik, air, internet
    'MARKETING',      -- Marketing non-paid ads (influencer, hadiah, dll)
    'OPERASIONAL',    -- Operasional rutin (ATK, transportasi, dll)
    'PERLENGKAPAN',   -- Beli alat kerja, peralatan kantor
    'PAJAK',          -- Pajak rutin
    'JASA',           -- Jasa pihak ketiga (akuntan, konsultan, dll)
    'LAIN_LAIN'       -- Kategori lain
  )),
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT,
  payment_reference TEXT,
  vendor_name TEXT,
  recurring BOOLEAN DEFAULT FALSE,
  recurrence_period TEXT CHECK (recurrence_period IN ('MONTHLY', 'WEEKLY', 'YEARLY') OR recurrence_period IS NULL),
  notes TEXT,
  attachment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operational_expenses_org_date
  ON public.operational_expenses(organization_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_operational_expenses_category
  ON public.operational_expenses(organization_id, category);
CREATE INDEX IF NOT EXISTS idx_operational_expenses_recurring
  ON public.operational_expenses(organization_id, recurring) WHERE recurring = TRUE;

ALTER TABLE public.operational_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operational_expenses_select ON public.operational_expenses;
DROP POLICY IF EXISTS operational_expenses_insert ON public.operational_expenses;
DROP POLICY IF EXISTS operational_expenses_update ON public.operational_expenses;
DROP POLICY IF EXISTS operational_expenses_delete ON public.operational_expenses;

CREATE POLICY operational_expenses_select ON public.operational_expenses
  FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY operational_expenses_insert ON public.operational_expenses
  FOR INSERT WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY operational_expenses_update ON public.operational_expenses
  FOR UPDATE USING (organization_id = public.current_org_id());
CREATE POLICY operational_expenses_delete ON public.operational_expenses
  FOR DELETE USING (organization_id = public.current_org_id());

-- ----------------------------------------------------------
-- 6. Backfill data dari legacy `expenses` (kalau ada) ke operational_expenses
--    Map kategori text bebas → 9 enum baru.
-- ----------------------------------------------------------
DO $$
DECLARE
  v_count INT;
BEGIN
  -- Cek apakah legacy expenses table masih ada
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='expenses') THEN
    -- Backfill kalau operational_expenses masih kosong (untuk org default)
    SELECT COUNT(*) INTO v_count FROM public.operational_expenses WHERE organization_id = 1;
    IF v_count = 0 THEN
      INSERT INTO public.operational_expenses (
        organization_id, expense_date, category, description, amount, created_by, created_at
      )
      SELECT
        1 as organization_id,
        e.expense_date,
        CASE
          WHEN UPPER(e.category) LIKE '%GAJI%' THEN 'GAJI'
          WHEN UPPER(e.category) LIKE '%SEWA%' THEN 'SEWA'
          WHEN UPPER(e.category) LIKE '%LISTRIK%' OR UPPER(e.category) LIKE '%AIR%' OR UPPER(e.category) LIKE '%INTERNET%' OR UPPER(e.category) LIKE '%UTILIT%' THEN 'UTILITY'
          WHEN UPPER(e.category) LIKE '%MARKETING%' OR UPPER(e.category) LIKE '%IKLAN%' OR UPPER(e.category) LIKE '%INFLUENC%' THEN 'MARKETING'
          WHEN UPPER(e.category) LIKE '%PAJAK%' OR UPPER(e.category) LIKE '%TAX%' THEN 'PAJAK'
          WHEN UPPER(e.category) LIKE '%JASA%' OR UPPER(e.category) LIKE '%KONSULT%' OR UPPER(e.category) LIKE '%AKUNT%' THEN 'JASA'
          WHEN UPPER(e.category) LIKE '%PERLENGKAP%' OR UPPER(e.category) LIKE '%ALAT%' OR UPPER(e.category) LIKE '%ATK%' THEN 'PERLENGKAPAN'
          WHEN UPPER(e.category) LIKE '%PACKAGING%' OR UPPER(e.category) LIKE '%PACKING%' OR UPPER(e.category) LIKE '%OPER%' OR UPPER(e.category) LIKE '%TRANSPORT%' THEN 'OPERASIONAL'
          ELSE 'LAIN_LAIN'
        END as category,
        COALESCE(NULLIF(TRIM(e.description), ''), e.category, 'Imported from legacy expenses') as description,
        e.amount,
        e.created_by,
        NOW() as created_at
      FROM public.expenses e
      WHERE e.amount > 0;
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------
-- 7. Trigger updated_at untuk products + product_categories + operational_expenses
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at_products ON public.products;
CREATE TRIGGER trg_set_updated_at_products
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at_product_categories ON public.product_categories;
CREATE TRIGGER trg_set_updated_at_product_categories
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at_operational_expenses ON public.operational_expenses;
CREATE TRIGGER trg_set_updated_at_operational_expenses
  BEFORE UPDATE ON public.operational_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------
-- 8. RPC: analytics_expenses_summary (per kategori untuk periode)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_expenses_summary(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  category TEXT,
  total_amount NUMERIC,
  total_count BIGINT,
  recurring_amount NUMERIC,
  onetime_amount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  SELECT
    e.category,
    COALESCE(SUM(e.amount), 0) AS total_amount,
    COUNT(*)::BIGINT AS total_count,
    COALESCE(SUM(e.amount) FILTER (WHERE e.recurring = TRUE), 0) AS recurring_amount,
    COALESCE(SUM(e.amount) FILTER (WHERE e.recurring = FALSE OR e.recurring IS NULL), 0) AS onetime_amount
  FROM public.operational_expenses e
  WHERE e.organization_id = v_org
    AND e.expense_date >= p_from
    AND e.expense_date <= p_to
  GROUP BY e.category
  ORDER BY total_amount DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_expenses_summary(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 9. RPC: analytics_profit_per_product (per produk untuk tab Per Produk)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_profit_per_product(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  product_id BIGINT,
  product_name TEXT,
  product_sku TEXT,
  category_name TEXT,
  total_qty BIGINT,
  total_orders BIGINT,
  total_revenue NUMERIC,
  total_hpp NUMERIC,
  gross_profit NUMERIC,
  margin_pct NUMERIC,
  diterima_orders BIGINT,
  final_orders BIGINT,
  conversion_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  WITH item_aggregated AS (
    SELECT
      oi.product_id,
      SUM(oi.qty)::BIGINT AS total_qty,
      COUNT(DISTINCT o.id)::BIGINT AS total_orders,
      COALESCE(SUM(oi.qty * oi.price), 0) AS total_revenue,
      COALESCE(SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)), 0) AS total_hpp,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS diterima_count,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status IN ('DITERIMA', 'RETUR'))::BIGINT AS final_count
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.organization_id = v_org
      AND o.order_date >= p_from
      AND o.order_date <= p_to
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id
  )
  SELECT
    ia.product_id,
    p.name AS product_name,
    p.sku AS product_sku,
    pc.name AS category_name,
    ia.total_qty,
    ia.total_orders,
    ia.total_revenue,
    ia.total_hpp,
    (ia.total_revenue - ia.total_hpp) AS gross_profit,
    CASE
      WHEN ia.total_revenue > 0
      THEN ROUND(((ia.total_revenue - ia.total_hpp) * 100.0 / ia.total_revenue)::NUMERIC, 2)
      ELSE 0
    END AS margin_pct,
    ia.diterima_count AS diterima_orders,
    ia.final_count AS final_orders,
    CASE
      WHEN ia.final_count > 0
      THEN ROUND((ia.diterima_count::NUMERIC * 100.0 / ia.final_count)::NUMERIC, 2)
      ELSE 0
    END AS conversion_rate
  FROM item_aggregated ia
  LEFT JOIN public.products p ON p.id = ia.product_id
  LEFT JOIN public.product_categories pc ON pc.id = p.category_id
  ORDER BY ia.total_revenue DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_profit_per_product(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 10. RPC: analytics_overview_v2 (Phase 4C overview + operational_expenses + net_profit)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_overview_v2(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  total_orders BIGINT,
  total_revenue NUMERIC,
  total_cogs NUMERIC,
  total_shipping_charged NUMERIC,
  total_shipping_actual NUMERIC,
  total_payout NUMERIC,
  total_commissions_estimated NUMERIC,
  total_commissions_earned NUMERIC,
  total_commissions_paid NUMERIC,
  total_operational_expenses NUMERIC,
  estimated_total_cost NUMERIC,
  estimated_cash_in NUMERIC,
  estimated_profit NUMERIC,
  profit_margin_pct NUMERIC,
  net_profit NUMERIC,
  net_margin_pct NUMERIC,
  orders_baru BIGINT,
  orders_siap_kirim BIGINT,
  orders_dikirim BIGINT,
  orders_diterima BIGINT,
  orders_problem BIGINT,
  orders_retur BIGINT,
  orders_cancel BIGINT,
  orders_fake BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  WITH order_stats AS (
    SELECT
      COUNT(*)::BIGINT AS t_orders,
      COALESCE(SUM(o.total), 0) AS t_revenue,
      COALESCE(SUM(o.shipping_cost), 0) AS t_ship_charged,
      COALESCE(SUM(o.shipping_cost_actual), 0) AS t_ship_actual,
      COALESCE(SUM(o.payout_amount), 0) AS t_payout,
      COALESCE(SUM(o.estimated_total_cost), 0) AS t_est_cost,
      COALESCE(SUM(o.estimated_cash_in), 0) AS t_est_cash_in,
      COALESCE(SUM(o.estimated_profit), 0) AS t_est_profit,
      COUNT(*) FILTER (WHERE o.status = 'BARU')::BIGINT AS o_baru,
      COUNT(*) FILTER (WHERE o.status = 'SIAP_KIRIM')::BIGINT AS o_siap,
      COUNT(*) FILTER (WHERE o.status = 'DIKIRIM')::BIGINT AS o_kirim,
      COUNT(*) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS o_terima,
      COUNT(*) FILTER (WHERE o.status = 'PROBLEM')::BIGINT AS o_problem,
      COUNT(*) FILTER (WHERE o.status = 'RETUR')::BIGINT AS o_retur,
      COUNT(*) FILTER (WHERE o.status = 'CANCEL')::BIGINT AS o_cancel,
      COUNT(*) FILTER (WHERE o.status = 'FAKE')::BIGINT AS o_fake
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.order_date >= p_from AND o.order_date <= p_to
  ),
  cogs_stats AS (
    SELECT COALESCE(SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)), 0) AS t_cogs
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.organization_id = v_org
      AND o.order_date >= p_from AND o.order_date <= p_to
  ),
  comm_stats AS (
    SELECT
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'ESTIMATED'), 0) AS est,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'EARNED'), 0) AS earn,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'PAID'), 0) AS paid
    FROM public.commissions c
    JOIN public.orders o ON o.id = c.order_id
    WHERE o.organization_id = v_org
      AND o.order_date >= p_from AND o.order_date <= p_to
  ),
  expense_stats AS (
    SELECT COALESCE(SUM(e.amount), 0) AS t_expenses
    FROM public.operational_expenses e
    WHERE e.organization_id = v_org
      AND e.expense_date >= p_from AND e.expense_date <= p_to
  )
  SELECT
    os.t_orders,
    os.t_revenue,
    cs.t_cogs,
    os.t_ship_charged,
    os.t_ship_actual,
    os.t_payout,
    cms.est,
    cms.earn,
    cms.paid,
    es.t_expenses,
    os.t_est_cost,
    os.t_est_cash_in,
    os.t_est_profit,
    CASE
      WHEN os.t_revenue > 0
      THEN ROUND((os.t_est_profit * 100.0 / os.t_revenue)::NUMERIC, 2)
      ELSE 0
    END AS profit_margin_pct,
    (os.t_est_profit - es.t_expenses) AS net_profit,
    CASE
      WHEN os.t_revenue > 0
      THEN ROUND(((os.t_est_profit - es.t_expenses) * 100.0 / os.t_revenue)::NUMERIC, 2)
      ELSE 0
    END AS net_margin_pct,
    os.o_baru, os.o_siap, os.o_kirim, os.o_terima,
    os.o_problem, os.o_retur, os.o_cancel, os.o_fake
  FROM order_stats os
  CROSS JOIN cogs_stats cs
  CROSS JOIN comm_stats cms
  CROSS JOIN expense_stats es;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_overview_v2(DATE, DATE) TO authenticated;

-- =============================================================
-- Done. Migration 020 idempotent — safe to re-run.
-- =============================================================
