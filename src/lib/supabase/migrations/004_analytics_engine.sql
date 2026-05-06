-- Phase 1 migration: schema untuk analytics engine
-- Run di Supabase SQL Editor sekali.
-- Aman re-run (pakai IF NOT EXISTS / ON CONFLICT).
--
-- CATATAN: Kalau project punya tabel `commissions` lama (period-based),
-- rename dulu sebelum run migration ini:
--   ALTER TABLE public.commissions RENAME TO commissions_legacy;
-- Migration ini bikin tabel `commissions` baru (per-order-based).

-- =============================================================
-- 1. ad_spend: tambah kolom lead platform + revenue realized
-- =============================================================
ALTER TABLE public.ad_spend
  ADD COLUMN IF NOT EXISTS lead_platform integer,
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.ad_spend.lead_platform IS
  'Lead count dari dashboard platform (Meta/TT/Google) - input manual oleh advertiser';

-- =============================================================
-- 2. cs_daily_leads: laporan harian CS per produk
-- =============================================================
CREATE TABLE IF NOT EXISTS public.cs_daily_leads (
  id              bigserial PRIMARY KEY,
  cs_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id      bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  report_date     date NOT NULL,
  leads_count     integer NOT NULL DEFAULT 0,
  closing_count   integer NOT NULL DEFAULT 0,
  rejected_count  integer NOT NULL DEFAULT 0,
  reject_reasons  jsonb DEFAULT '{}'::jsonb,
  notes           text,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cs_daily_leads_unique UNIQUE (cs_id, product_id, report_date)
);

CREATE INDEX IF NOT EXISTS cs_daily_leads_cs_idx ON public.cs_daily_leads(cs_id);
CREATE INDEX IF NOT EXISTS cs_daily_leads_date_idx ON public.cs_daily_leads(report_date);
CREATE INDEX IF NOT EXISTS cs_daily_leads_product_idx ON public.cs_daily_leads(product_id);

-- =============================================================
-- 3. commissions: track komisi per order per user (CS / advertiser)
-- =============================================================
DO $$ BEGIN
  CREATE TYPE commission_status AS ENUM ('ESTIMATED', 'EARNED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.commissions (
  id              bigserial PRIMARY KEY,
  order_id        bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            text NOT NULL,
  amount          numeric NOT NULL DEFAULT 0,
  status          commission_status NOT NULL DEFAULT 'ESTIMATED',
  earned_at       timestamptz,
  cancelled_at    timestamptz,
  cancelled_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commissions_unique UNIQUE (order_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS commissions_user_idx ON public.commissions(user_id);
CREATE INDEX IF NOT EXISTS commissions_order_idx ON public.commissions(order_id);
CREATE INDEX IF NOT EXISTS commissions_status_idx ON public.commissions(status);

-- =============================================================
-- 4. orders: tambah duplicate_of buat dedup logic
-- =============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS duplicate_of bigint REFERENCES public.orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.duplicate_of IS
  'Kalau order ini dianggap duplicate dari order lain (phone match dalam 7 hari), point ke order asal. Order dengan duplicate_of != null tidak dihitung di analytics.';

CREATE INDEX IF NOT EXISTS orders_duplicate_of_idx ON public.orders(duplicate_of);

-- =============================================================
-- 5. ad_reconciliation: rekon bulanan ad spend vs tagihan real
-- =============================================================
CREATE TABLE IF NOT EXISTS public.ad_reconciliation (
  id                   bigserial PRIMARY KEY,
  recon_month          date NOT NULL,
  platform             text NOT NULL,
  real_invoice_amount  numeric NOT NULL,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_reconciliation_unique UNIQUE (recon_month, platform)
);

-- =============================================================
-- 6. RLS policies (placeholder — adjust sesuai kebutuhan)
-- =============================================================
ALTER TABLE public.cs_daily_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_reconciliation ENABLE ROW LEVEL SECURITY;

-- CS bisa lihat & insert laporan mereka sendiri; owner bisa lihat semua
DROP POLICY IF EXISTS cs_daily_leads_select ON public.cs_daily_leads;
CREATE POLICY cs_daily_leads_select ON public.cs_daily_leads FOR SELECT
  USING (
    cs_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS cs_daily_leads_insert ON public.cs_daily_leads;
CREATE POLICY cs_daily_leads_insert ON public.cs_daily_leads FOR INSERT
  WITH CHECK (
    cs_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS cs_daily_leads_update ON public.cs_daily_leads;
CREATE POLICY cs_daily_leads_update ON public.cs_daily_leads FOR UPDATE
  USING (
    cs_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

-- Komisi: user lihat punya sendiri, owner lihat semua
DROP POLICY IF EXISTS commissions_select ON public.commissions;
CREATE POLICY commissions_select ON public.commissions FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

-- Reconciliation: owner only
DROP POLICY IF EXISTS ad_reconciliation_all ON public.ad_reconciliation;
CREATE POLICY ad_reconciliation_all ON public.ad_reconciliation FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner'));
