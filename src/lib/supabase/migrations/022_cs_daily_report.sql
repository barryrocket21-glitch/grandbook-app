-- =============================================================
-- Migration 022 — Phase 6: CS Daily Report + ADV-CS Cross-Check Funnel
--
-- Audit (2026-05-11):
--   daily_cs_report: doesn't exist → create fresh
--   ad_spend.meta_lead_count: doesn't exist → ADD COLUMN
--   cs_daily_leads (Phase 0 legacy): EXISTS → PRESERVE, tidak touch
--
-- Plan:
--  1. Add ad_spend.meta_lead_count BIGINT (lead Meta klaim, top-of-funnel)
--  2. New table daily_cs_report (per CS × per produk × per tanggal)
--     - Unique (org, date, cs, product)
--     - CHECK closing <= lead_in (business rule)
--     - RLS: CS lihat semua org, insert/update sendiri (owner/admin bypass),
--             delete owner/admin only
--  3. Trigger updated_at
--  4. RPC analytics_funnel_per_product (4-way JOIN cross-check)
--  5. RPC cs_daily_summary (per CS sehari untuk page summary)
-- =============================================================

-- ----------------------------------------------------------
-- 1. ad_spend.meta_lead_count
-- ----------------------------------------------------------
ALTER TABLE public.ad_spend
  ADD COLUMN IF NOT EXISTS meta_lead_count BIGINT;

COMMENT ON COLUMN public.ad_spend.meta_lead_count IS
  'Phase 6: Meta-reported leads (top of funnel). Beda dari conversions (purchases). '
  'NULL untuk existing rows pre-Phase 6 — re-upload CSV atau edit manual.';

-- ----------------------------------------------------------
-- 2. daily_cs_report table
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_cs_report (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  report_date DATE NOT NULL,
  cs_id UUID NOT NULL REFERENCES public.profiles(id),
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

  lead_in BIGINT NOT NULL DEFAULT 0 CHECK (lead_in >= 0),
  closing BIGINT NOT NULL DEFAULT 0 CHECK (closing >= 0),

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT daily_cs_report_unique UNIQUE (organization_id, report_date, cs_id, product_id),
  CONSTRAINT daily_cs_report_closing_lte_lead CHECK (closing <= lead_in)
);

CREATE INDEX IF NOT EXISTS idx_daily_cs_report_org_date
  ON public.daily_cs_report(organization_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_cs_report_cs
  ON public.daily_cs_report(cs_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_cs_report_product
  ON public.daily_cs_report(product_id, report_date DESC);

-- ----------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------
ALTER TABLE public.daily_cs_report ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_cs_report_select ON public.daily_cs_report;
DROP POLICY IF EXISTS daily_cs_report_insert ON public.daily_cs_report;
DROP POLICY IF EXISTS daily_cs_report_update ON public.daily_cs_report;
DROP POLICY IF EXISTS daily_cs_report_delete ON public.daily_cs_report;

-- SELECT: semua user authenticated dalam org bisa lihat (owner/admin/cs/akunting/advertiser)
-- Rationale: transparency — siapa pun bisa cross-check funnel.
CREATE POLICY daily_cs_report_select ON public.daily_cs_report
  FOR SELECT USING (organization_id = public.current_org_id());

-- INSERT: CS hanya untuk dirinya sendiri. Owner/admin bisa untuk siapa aja.
CREATE POLICY daily_cs_report_insert ON public.daily_cs_report
  FOR INSERT WITH CHECK (
    organization_id = public.current_org_id()
    AND (
      cs_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- UPDATE: CS untuk dirinya, owner/admin bypass.
CREATE POLICY daily_cs_report_update ON public.daily_cs_report
  FOR UPDATE USING (
    organization_id = public.current_org_id()
    AND (
      cs_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- DELETE: owner/admin only (audit trail).
CREATE POLICY daily_cs_report_delete ON public.daily_cs_report
  FOR DELETE USING (
    organization_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ----------------------------------------------------------
-- 4. Trigger updated_at
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at_daily_cs_report ON public.daily_cs_report;
CREATE TRIGGER trg_set_updated_at_daily_cs_report
  BEFORE UPDATE ON public.daily_cs_report
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------
-- 5. RPC: cs_daily_summary (per CS sehari, untuk page summary footer)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cs_daily_summary(
  p_cs_id UUID,
  p_date DATE
)
RETURNS TABLE (
  total_lead_in BIGINT,
  total_closing BIGINT,
  product_count BIGINT,
  close_rate NUMERIC
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
    COALESCE(SUM(d.lead_in), 0)::BIGINT,
    COALESCE(SUM(d.closing), 0)::BIGINT,
    COUNT(DISTINCT d.product_id)::BIGINT,
    CASE WHEN COALESCE(SUM(d.lead_in), 0) > 0
      THEN ROUND((COALESCE(SUM(d.closing), 0)::NUMERIC * 100 / SUM(d.lead_in))::NUMERIC, 2)
      ELSE 0
    END
  FROM public.daily_cs_report d
  WHERE d.organization_id = v_org
    AND d.cs_id = p_cs_id
    AND d.report_date = p_date;
END $$;

GRANT EXECUTE ON FUNCTION public.cs_daily_summary(UUID, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 6. RPC: cs_period_summary (per CS untuk range — dipakai /cs-dashboard)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cs_period_summary(
  p_cs_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  total_lead_in BIGINT,
  total_closing BIGINT,
  product_count BIGINT,
  close_rate NUMERIC,
  active_days BIGINT,
  avg_lead_per_day NUMERIC
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
    COALESCE(SUM(d.lead_in), 0)::BIGINT,
    COALESCE(SUM(d.closing), 0)::BIGINT,
    COUNT(DISTINCT d.product_id)::BIGINT,
    CASE WHEN COALESCE(SUM(d.lead_in), 0) > 0
      THEN ROUND((COALESCE(SUM(d.closing), 0)::NUMERIC * 100 / SUM(d.lead_in))::NUMERIC, 2)
      ELSE 0
    END,
    COUNT(DISTINCT d.report_date)::BIGINT,
    CASE WHEN COUNT(DISTINCT d.report_date) > 0
      THEN ROUND((COALESCE(SUM(d.lead_in), 0)::NUMERIC / COUNT(DISTINCT d.report_date))::NUMERIC, 2)
      ELSE 0
    END
  FROM public.daily_cs_report d
  WHERE d.organization_id = v_org
    AND d.cs_id = p_cs_id
    AND d.report_date >= p_from
    AND d.report_date <= p_to;
END $$;

GRANT EXECUTE ON FUNCTION public.cs_period_summary(UUID, DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 7. RPC: cs_daily_series (untuk daily lead trend chart di /cs-dashboard)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cs_daily_series(
  p_cs_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  day DATE,
  total_lead_in BIGINT,
  total_closing BIGINT,
  close_rate NUMERIC
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
    d.report_date,
    COALESCE(SUM(d.lead_in), 0)::BIGINT,
    COALESCE(SUM(d.closing), 0)::BIGINT,
    CASE WHEN COALESCE(SUM(d.lead_in), 0) > 0
      THEN ROUND((COALESCE(SUM(d.closing), 0)::NUMERIC * 100 / SUM(d.lead_in))::NUMERIC, 2)
      ELSE 0
    END
  FROM public.daily_cs_report d
  WHERE d.organization_id = v_org
    AND d.cs_id = p_cs_id
    AND d.report_date >= p_from
    AND d.report_date <= p_to
  GROUP BY d.report_date
  ORDER BY d.report_date ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.cs_daily_series(UUID, DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 8. RPC: analytics_funnel_per_product (cross-check 3 layer per produk)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_funnel_per_product(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  product_id BIGINT,
  product_name TEXT,
  product_sku TEXT,
  category_name TEXT,
  -- Layer 1: META (aggregate ad_spend × campaign_products allocation)
  total_spend NUMERIC,
  meta_lead_count BIGINT,
  meta_purchases BIGINT,
  -- Layer 2: CS (aggregate daily_cs_report)
  cs_lead_count BIGINT,
  cs_closing_count BIGINT,
  -- Layer 3: System orders (aggregate orders × order_items)
  system_orders_count BIGINT,
  system_orders_diterima BIGINT,
  system_revenue NUMERIC,
  -- Cross-check variances
  variance_lead_meta_cs BIGINT,
  variance_closing_cs_system BIGINT,
  -- Funnel metrics
  cpl_meta NUMERIC,
  cpl_cs_real NUMERIC,
  cpo NUMERIC,
  close_rate_cs NUMERIC,
  close_rate_meta NUMERIC,
  roas_system NUMERIC,
  -- Source presence flags (untuk UI distinguish "no data" vs "0 explicit")
  has_meta_data BOOLEAN,
  has_cs_data BOOLEAN,
  has_system_data BOOLEAN
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
  WITH product_ad_metrics AS (
    SELECT
      cp.product_id,
      SUM(a.spend * cp.allocation_pct / 100.0) AS total_spend,
      SUM(COALESCE(a.meta_lead_count, 0) * cp.allocation_pct / 100.0) AS meta_lead,
      SUM(COALESCE(a.conversions, 0) * cp.allocation_pct / 100.0) AS meta_purchases
    FROM public.campaign_products cp
    JOIN public.ad_spend a ON a.campaign_id = cp.campaign_id
    WHERE cp.organization_id = v_org
      AND a.organization_id = v_org
      AND a.spend_date >= p_from AND a.spend_date <= p_to
    GROUP BY cp.product_id
  ),
  product_cs_metrics AS (
    SELECT
      d.product_id,
      SUM(d.lead_in) AS cs_lead,
      SUM(d.closing) AS cs_closing
    FROM public.daily_cs_report d
    WHERE d.organization_id = v_org
      AND d.report_date >= p_from AND d.report_date <= p_to
    GROUP BY d.product_id
  ),
  product_system_metrics AS (
    SELECT
      oi.product_id,
      COUNT(DISTINCT o.id)::BIGINT AS orders_count,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS diterima_count,
      COALESCE(SUM(oi.qty * oi.price), 0) AS revenue
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.organization_id = v_org
      AND o.order_date >= p_from AND o.order_date <= p_to
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id
  ),
  all_products AS (
    SELECT pam.product_id AS pid FROM product_ad_metrics pam
    UNION
    SELECT pcm.product_id AS pid FROM product_cs_metrics pcm
    UNION
    SELECT psm.product_id AS pid FROM product_system_metrics psm
  )
  SELECT
    ap.pid AS product_id,
    p.name AS product_name,
    p.sku AS product_sku,
    pc.name AS category_name,
    COALESCE(pam.total_spend, 0) AS total_spend,
    COALESCE(pam.meta_lead, 0)::BIGINT AS meta_lead_count,
    COALESCE(pam.meta_purchases, 0)::BIGINT AS meta_purchases,
    COALESCE(pcm.cs_lead, 0)::BIGINT AS cs_lead_count,
    COALESCE(pcm.cs_closing, 0)::BIGINT AS cs_closing_count,
    COALESCE(psm.orders_count, 0)::BIGINT AS system_orders_count,
    COALESCE(psm.diterima_count, 0)::BIGINT AS system_orders_diterima,
    COALESCE(psm.revenue, 0) AS system_revenue,
    (COALESCE(pcm.cs_lead, 0) - COALESCE(pam.meta_lead, 0))::BIGINT AS variance_lead_meta_cs,
    (COALESCE(psm.orders_count, 0) - COALESCE(pcm.cs_closing, 0))::BIGINT AS variance_closing_cs_system,
    CASE WHEN COALESCE(pam.meta_lead, 0) > 0
      THEN ROUND((pam.total_spend / pam.meta_lead)::NUMERIC, 2) ELSE 0 END AS cpl_meta,
    CASE WHEN COALESCE(pcm.cs_lead, 0) > 0 AND COALESCE(pam.total_spend, 0) > 0
      THEN ROUND((pam.total_spend / pcm.cs_lead)::NUMERIC, 2) ELSE 0 END AS cpl_cs_real,
    CASE WHEN COALESCE(psm.diterima_count, 0) > 0 AND COALESCE(pam.total_spend, 0) > 0
      THEN ROUND((pam.total_spend / psm.diterima_count)::NUMERIC, 2) ELSE 0 END AS cpo,
    CASE WHEN COALESCE(pcm.cs_lead, 0) > 0
      THEN ROUND((pcm.cs_closing::NUMERIC * 100.0 / pcm.cs_lead)::NUMERIC, 2) ELSE 0 END AS close_rate_cs,
    CASE WHEN COALESCE(pam.meta_lead, 0) > 0
      THEN ROUND((pam.meta_purchases::NUMERIC * 100.0 / pam.meta_lead)::NUMERIC, 2) ELSE 0 END AS close_rate_meta,
    CASE WHEN COALESCE(pam.total_spend, 0) > 0
      THEN ROUND((COALESCE(psm.revenue, 0) / pam.total_spend)::NUMERIC, 2) ELSE 0 END AS roas_system,
    (pam.product_id IS NOT NULL) AS has_meta_data,
    (pcm.product_id IS NOT NULL) AS has_cs_data,
    (psm.product_id IS NOT NULL) AS has_system_data
  FROM all_products ap
  LEFT JOIN public.products p ON p.id = ap.pid
  LEFT JOIN public.product_categories pc ON pc.id = p.category_id
  LEFT JOIN product_ad_metrics pam ON pam.product_id = ap.pid
  LEFT JOIN product_cs_metrics pcm ON pcm.product_id = ap.pid
  LEFT JOIN product_system_metrics psm ON psm.product_id = ap.pid
  ORDER BY COALESCE(pam.total_spend, 0) DESC, p.name ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_funnel_per_product(DATE, DATE) TO authenticated;

-- =============================================================
-- Done. Migration 022 idempotent — safe to re-run.
-- =============================================================
