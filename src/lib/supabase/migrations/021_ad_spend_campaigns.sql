-- =============================================================
-- Migration 021 — Phase 5B: Ad Spend + Campaigns + Allocation
--
-- Audit (2026-05-11):
--   campaigns: 2 rows (META, advertiser=0d04a127...), no organization_id
--   ad_spend: 5 rows, no organization_id, has legacy `lead_platform` column
--   orders: 0 with campaign_id set
--   → Skenario B (Reuse + Extend dengan backfill ke org=1)
--
-- Plan:
--  1. Extend `campaigns` + add organization_id + Phase 5B columns + RLS
--  2. New table `campaign_products` (link campaign↔product, allocation %)
--  3. Extend `ad_spend` + add organization_id + Phase 5B columns + RLS
--     (preserve legacy `lead_platform` column untuk backward compat)
--  4. RPCs: analytics_ad_spend_summary, analytics_roas_per_campaign,
--           analytics_profit_per_product_v2, analytics_overview_v3
--  5. Triggers updated_at + allocation guard (sum allocation_pct per
--     campaign ≤ 100)
-- =============================================================

-- ----------------------------------------------------------
-- 1. Extend campaigns + organization_id
-- ----------------------------------------------------------
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES public.organizations(id);

UPDATE public.campaigns SET organization_id = 1 WHERE organization_id IS NULL;
ALTER TABLE public.campaigns ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS campaign_code TEXT,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS daily_budget NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS objective TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Drop status CHECK kalau ada (idempotent re-apply), lalu re-add
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('ACTIVE', 'PAUSED', 'ENDED'));

-- Drop legacy unique constraint (no org_id), add org-scoped versions
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_platform_campaign_name_key;
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_platform_name_key;
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_org_platform_name_unique;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_org_platform_name_unique
  UNIQUE (organization_id, platform, campaign_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_org_platform_code
  ON public.campaigns(organization_id, platform, campaign_code)
  WHERE campaign_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_org ON public.campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON public.campaigns(organization_id, active);
CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser ON public.campaigns(advertiser_id);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Replace any pre-existing legacy policies
DROP POLICY IF EXISTS "Everyone can view campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Owner/advertiser manage campaigns" ON public.campaigns;
DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
DROP POLICY IF EXISTS campaigns_insert ON public.campaigns;
DROP POLICY IF EXISTS campaigns_update ON public.campaigns;
DROP POLICY IF EXISTS campaigns_delete ON public.campaigns;

CREATE POLICY campaigns_select ON public.campaigns
  FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY campaigns_insert ON public.campaigns
  FOR INSERT WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY campaigns_update ON public.campaigns
  FOR UPDATE USING (organization_id = public.current_org_id());
CREATE POLICY campaigns_delete ON public.campaigns
  FOR DELETE USING (organization_id = public.current_org_id());

-- ----------------------------------------------------------
-- 2. campaign_products (link table, 1:N allocation)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_products (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  campaign_id BIGINT NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  allocation_pct NUMERIC(5,2) NOT NULL DEFAULT 100.00
    CHECK (allocation_pct > 0 AND allocation_pct <= 100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT campaign_products_unique UNIQUE (campaign_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_products_campaign ON public.campaign_products(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_products_product ON public.campaign_products(product_id);
CREATE INDEX IF NOT EXISTS idx_campaign_products_org ON public.campaign_products(organization_id);

ALTER TABLE public.campaign_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_products_select ON public.campaign_products;
DROP POLICY IF EXISTS campaign_products_insert ON public.campaign_products;
DROP POLICY IF EXISTS campaign_products_update ON public.campaign_products;
DROP POLICY IF EXISTS campaign_products_delete ON public.campaign_products;

CREATE POLICY campaign_products_select ON public.campaign_products
  FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY campaign_products_insert ON public.campaign_products
  FOR INSERT WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY campaign_products_update ON public.campaign_products
  FOR UPDATE USING (organization_id = public.current_org_id());
CREATE POLICY campaign_products_delete ON public.campaign_products
  FOR DELETE USING (organization_id = public.current_org_id());

-- Allocation guard trigger — total allocation_pct per campaign ≤ 100
CREATE OR REPLACE FUNCTION public.check_campaign_allocation_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_total NUMERIC;
  v_campaign BIGINT;
BEGIN
  v_campaign := COALESCE(NEW.campaign_id, OLD.campaign_id);
  SELECT COALESCE(SUM(allocation_pct), 0) INTO v_total
  FROM public.campaign_products
  WHERE campaign_id = v_campaign
    AND id <> COALESCE(NEW.id, -1);
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_total := v_total + NEW.allocation_pct;
  END IF;
  IF v_total > 100.00 THEN
    RAISE EXCEPTION 'Total allocation_pct campaign % melebihi 100%% (current sum would be %)',
      v_campaign, v_total
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_campaign_alloc_check ON public.campaign_products;
CREATE TRIGGER trg_campaign_alloc_check
  BEFORE INSERT OR UPDATE OF allocation_pct, campaign_id ON public.campaign_products
  FOR EACH ROW EXECUTE FUNCTION public.check_campaign_allocation_total();

-- ----------------------------------------------------------
-- 3. Extend ad_spend + organization_id + Phase 5B columns
--    Preserve legacy `lead_platform` (BIGINT, Phase 0) untuk backward compat
-- ----------------------------------------------------------
ALTER TABLE public.ad_spend
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES public.organizations(id);

UPDATE public.ad_spend SET organization_id = 1 WHERE organization_id IS NULL;
ALTER TABLE public.ad_spend ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.ad_spend
  ADD COLUMN IF NOT EXISTS reach BIGINT,
  ADD COLUMN IF NOT EXISTS conversions BIGINT,
  ADD COLUMN IF NOT EXISTS revenue_reported NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS import_batch_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.ad_spend DROP CONSTRAINT IF EXISTS ad_spend_source_check;
ALTER TABLE public.ad_spend
  ADD CONSTRAINT ad_spend_source_check
  CHECK (source IN ('MANUAL', 'CSV_IMPORT', 'API'));

-- Drop legacy unique (spend_date, campaign_id), add org-scoped version
ALTER TABLE public.ad_spend DROP CONSTRAINT IF EXISTS ad_spend_spend_date_campaign_id_key;
ALTER TABLE public.ad_spend DROP CONSTRAINT IF EXISTS ad_spend_org_date_campaign_unique;
ALTER TABLE public.ad_spend
  ADD CONSTRAINT ad_spend_org_date_campaign_unique
  UNIQUE (organization_id, spend_date, campaign_id);

CREATE INDEX IF NOT EXISTS idx_ad_spend_org_date ON public.ad_spend(organization_id, spend_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_spend_campaign ON public.ad_spend(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_spend_batch ON public.ad_spend(import_batch_id) WHERE import_batch_id IS NOT NULL;

ALTER TABLE public.ad_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone can view ad_spend" ON public.ad_spend;
DROP POLICY IF EXISTS "Advertiser manage ad_spend" ON public.ad_spend;
DROP POLICY IF EXISTS ad_spend_select ON public.ad_spend;
DROP POLICY IF EXISTS ad_spend_insert ON public.ad_spend;
DROP POLICY IF EXISTS ad_spend_update ON public.ad_spend;
DROP POLICY IF EXISTS ad_spend_delete ON public.ad_spend;

CREATE POLICY ad_spend_select ON public.ad_spend
  FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY ad_spend_insert ON public.ad_spend
  FOR INSERT WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY ad_spend_update ON public.ad_spend
  FOR UPDATE USING (organization_id = public.current_org_id());
CREATE POLICY ad_spend_delete ON public.ad_spend
  FOR DELETE USING (organization_id = public.current_org_id());

-- ----------------------------------------------------------
-- 4. Triggers updated_at
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at_campaigns ON public.campaigns;
CREATE TRIGGER trg_set_updated_at_campaigns
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at_ad_spend ON public.ad_spend;
CREATE TRIGGER trg_set_updated_at_ad_spend
  BEFORE UPDATE ON public.ad_spend
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------
-- 5. RPC: analytics_ad_spend_summary
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_ad_spend_summary(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  total_spend NUMERIC,
  total_campaigns BIGINT,
  total_conversions BIGINT,
  total_impressions BIGINT,
  total_clicks BIGINT,
  by_platform JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
  v_total_spend NUMERIC;
  v_total_campaigns BIGINT;
  v_total_conv BIGINT;
  v_total_impr BIGINT;
  v_total_clicks BIGINT;
  v_by_platform JSONB;
BEGIN
  SELECT
    COALESCE(SUM(a.spend), 0),
    COUNT(DISTINCT a.campaign_id),
    COALESCE(SUM(COALESCE(a.conversions, 0)), 0),
    COALESCE(SUM(COALESCE(a.impressions, 0)), 0),
    COALESCE(SUM(COALESCE(a.clicks, 0)), 0)
  INTO v_total_spend, v_total_campaigns, v_total_conv, v_total_impr, v_total_clicks
  FROM public.ad_spend a
  WHERE a.organization_id = v_org
    AND a.spend_date >= p_from
    AND a.spend_date <= p_to;

  SELECT COALESCE(jsonb_object_agg(platform, total), '{}'::jsonb)
  INTO v_by_platform
  FROM (
    SELECT c.platform, SUM(a.spend) as total
    FROM public.ad_spend a
    JOIN public.campaigns c ON c.id = a.campaign_id
    WHERE a.organization_id = v_org
      AND a.spend_date >= p_from
      AND a.spend_date <= p_to
    GROUP BY c.platform
  ) p;

  RETURN QUERY SELECT
    v_total_spend,
    COALESCE(v_total_campaigns, 0),
    COALESCE(v_total_conv, 0),
    COALESCE(v_total_impr, 0),
    COALESCE(v_total_clicks, 0),
    v_by_platform;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_ad_spend_summary(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 6. RPC: analytics_roas_per_campaign
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_roas_per_campaign(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  campaign_id BIGINT,
  campaign_name TEXT,
  platform TEXT,
  advertiser_id UUID,
  advertiser_name TEXT,
  campaign_status TEXT,
  total_spend NUMERIC,
  total_conversions BIGINT,
  total_impressions BIGINT,
  total_clicks BIGINT,
  linked_products TEXT,
  linked_orders_count BIGINT,
  linked_revenue NUMERIC,
  linked_revenue_diterima NUMERIC,
  roas_gross NUMERIC,
  roas_diterima NUMERIC,
  cost_per_conversion NUMERIC,
  cost_per_order NUMERIC
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
  WITH spend_per_campaign AS (
    SELECT
      a.campaign_id,
      SUM(a.spend) AS t_spend,
      SUM(COALESCE(a.conversions, 0))::BIGINT AS t_conv,
      SUM(COALESCE(a.impressions, 0))::BIGINT AS t_impr,
      SUM(COALESCE(a.clicks, 0))::BIGINT AS t_clicks
    FROM public.ad_spend a
    WHERE a.organization_id = v_org
      AND a.spend_date >= p_from AND a.spend_date <= p_to
    GROUP BY a.campaign_id
  ),
  linked_orders AS (
    SELECT
      o.campaign_id,
      COUNT(DISTINCT o.id)::BIGINT AS o_count,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS terima_count,
      COALESCE(SUM(o.total), 0) AS revenue,
      COALESCE(SUM(o.total) FILTER (WHERE o.status = 'DITERIMA'), 0) AS revenue_terima
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.order_date >= p_from AND o.order_date <= p_to
      AND o.campaign_id IS NOT NULL
    GROUP BY o.campaign_id
  ),
  product_list AS (
    SELECT
      cp.campaign_id,
      STRING_AGG(p.name, ', ' ORDER BY p.name) AS names
    FROM public.campaign_products cp
    JOIN public.products p ON p.id = cp.product_id
    WHERE cp.organization_id = v_org
    GROUP BY cp.campaign_id
  )
  SELECT
    c.id,
    c.campaign_name,
    c.platform,
    c.advertiser_id,
    prof.full_name,
    c.status,
    COALESCE(spc.t_spend, 0),
    COALESCE(spc.t_conv, 0),
    COALESCE(spc.t_impr, 0),
    COALESCE(spc.t_clicks, 0),
    COALESCE(pl.names, ''),
    COALESCE(lo.o_count, 0),
    COALESCE(lo.revenue, 0),
    COALESCE(lo.revenue_terima, 0),
    CASE WHEN COALESCE(spc.t_spend, 0) > 0
      THEN ROUND((COALESCE(lo.revenue, 0) / spc.t_spend)::NUMERIC, 2)
      ELSE 0 END,
    CASE WHEN COALESCE(spc.t_spend, 0) > 0
      THEN ROUND((COALESCE(lo.revenue_terima, 0) / spc.t_spend)::NUMERIC, 2)
      ELSE 0 END,
    CASE WHEN COALESCE(spc.t_conv, 0) > 0
      THEN ROUND((spc.t_spend / spc.t_conv)::NUMERIC, 2)
      ELSE 0 END,
    CASE WHEN COALESCE(lo.o_count, 0) > 0
      THEN ROUND((COALESCE(spc.t_spend, 0) / lo.o_count)::NUMERIC, 2)
      ELSE 0 END
  FROM public.campaigns c
  LEFT JOIN spend_per_campaign spc ON spc.campaign_id = c.id
  LEFT JOIN linked_orders lo ON lo.campaign_id = c.id
  LEFT JOIN product_list pl ON pl.campaign_id = c.id
  LEFT JOIN public.profiles prof ON prof.id = c.advertiser_id
  WHERE c.organization_id = v_org
    AND (COALESCE(spc.t_spend, 0) > 0 OR COALESCE(lo.o_count, 0) > 0)
  ORDER BY COALESCE(spc.t_spend, 0) DESC NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_roas_per_campaign(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 7. RPC: analytics_profit_per_product_v2 (per produk + ad spend allocation)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_profit_per_product_v2(
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
  allocated_ad_spend NUMERIC,
  net_profit_after_ads NUMERIC,
  net_margin_pct NUMERIC,
  diterima_orders BIGINT,
  final_orders BIGINT,
  conversion_rate NUMERIC,
  roas NUMERIC
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
      SUM(oi.qty)::BIGINT AS t_qty,
      COUNT(DISTINCT o.id)::BIGINT AS t_orders,
      COALESCE(SUM(oi.qty * oi.price), 0) AS t_revenue,
      COALESCE(SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)), 0) AS t_hpp,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS d_count,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status IN ('DITERIMA', 'RETUR'))::BIGINT AS f_count
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.organization_id = v_org
      AND o.order_date >= p_from
      AND o.order_date <= p_to
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id
  ),
  product_ad_spend AS (
    SELECT
      cp.product_id,
      COALESCE(SUM(a.spend * cp.allocation_pct / 100.0), 0) AS allocated
    FROM public.campaign_products cp
    JOIN public.ad_spend a ON a.campaign_id = cp.campaign_id
    WHERE cp.organization_id = v_org
      AND a.organization_id = v_org
      AND a.spend_date >= p_from
      AND a.spend_date <= p_to
    GROUP BY cp.product_id
  )
  SELECT
    ia.product_id,
    p.name,
    p.sku,
    pc.name,
    ia.t_qty,
    ia.t_orders,
    ia.t_revenue,
    ia.t_hpp,
    (ia.t_revenue - ia.t_hpp) AS gross,
    CASE WHEN ia.t_revenue > 0
      THEN ROUND(((ia.t_revenue - ia.t_hpp) * 100.0 / ia.t_revenue)::NUMERIC, 2)
      ELSE 0 END AS m_pct,
    COALESCE(pas.allocated, 0) AS alloc,
    (ia.t_revenue - ia.t_hpp - COALESCE(pas.allocated, 0)) AS net_after,
    CASE WHEN ia.t_revenue > 0
      THEN ROUND(((ia.t_revenue - ia.t_hpp - COALESCE(pas.allocated, 0)) * 100.0 / ia.t_revenue)::NUMERIC, 2)
      ELSE 0 END AS net_m_pct,
    ia.d_count,
    ia.f_count,
    CASE WHEN ia.f_count > 0
      THEN ROUND((ia.d_count::NUMERIC * 100.0 / ia.f_count)::NUMERIC, 2)
      ELSE 0 END AS conv,
    CASE WHEN COALESCE(pas.allocated, 0) > 0
      THEN ROUND((ia.t_revenue / pas.allocated)::NUMERIC, 2)
      ELSE 0 END AS r
  FROM item_aggregated ia
  LEFT JOIN public.products p ON p.id = ia.product_id
  LEFT JOIN public.product_categories pc ON pc.id = p.category_id
  LEFT JOIN product_ad_spend pas ON pas.product_id = ia.product_id
  ORDER BY (ia.t_revenue - ia.t_hpp - COALESCE(pas.allocated, 0)) DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_profit_per_product_v2(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 8. RPC: analytics_overview_v3 (extends Phase 5A v2 dengan ad spend)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_overview_v3(
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
  total_ad_spend NUMERIC,
  estimated_total_cost NUMERIC,
  estimated_cash_in NUMERIC,
  estimated_profit NUMERIC,
  profit_margin_pct NUMERIC,
  net_profit_before_ads NUMERIC,
  net_profit_after_ads NUMERIC,
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
  ),
  ad_stats AS (
    SELECT COALESCE(SUM(a.spend), 0) AS t_ad_spend
    FROM public.ad_spend a
    WHERE a.organization_id = v_org
      AND a.spend_date >= p_from AND a.spend_date <= p_to
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
    ads.t_ad_spend,
    os.t_est_cost,
    os.t_est_cash_in,
    os.t_est_profit,
    CASE WHEN os.t_revenue > 0
      THEN ROUND((os.t_est_profit * 100.0 / os.t_revenue)::NUMERIC, 2)
      ELSE 0 END AS profit_margin_pct,
    (os.t_est_profit - es.t_expenses) AS net_before,
    (os.t_est_profit - es.t_expenses - ads.t_ad_spend) AS net_after,
    CASE WHEN os.t_revenue > 0
      THEN ROUND(((os.t_est_profit - es.t_expenses - ads.t_ad_spend) * 100.0 / os.t_revenue)::NUMERIC, 2)
      ELSE 0 END AS net_margin_pct,
    os.o_baru, os.o_siap, os.o_kirim, os.o_terima,
    os.o_problem, os.o_retur, os.o_cancel, os.o_fake
  FROM order_stats os
  CROSS JOIN cogs_stats cs
  CROSS JOIN comm_stats cms
  CROSS JOIN expense_stats es
  CROSS JOIN ad_stats ads;
END $$;

GRANT EXECUTE ON FUNCTION public.analytics_overview_v3(DATE, DATE) TO authenticated;

-- =============================================================
-- Done. Migration 021 idempotent — safe to re-run.
-- =============================================================
