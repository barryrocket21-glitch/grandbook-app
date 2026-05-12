-- =============================================================
-- Team Performance — 4 RPCs untuk /team/cs + /team/advertisers
-- =============================================================
-- List + detail dashboards per CS + per Advertiser.
-- Owner+admin only (page-level guard).
--
-- Adaptasi dari brief (kolom yang berbeda di realita GrandBook):
--   * profiles.active (BUKAN is_active)
--   * orders.total + orders.order_date (BUKAN total_amount + created_at::date)
--   * orders.channel_id → JOIN courier_channels.code (BUKAN orders.channel_code)
--   * campaigns.status = 'ACTIVE' (BUKAN active = true)
--   * ad_spend.spend (BUKAN spend_amount)
--   * commissions tidak punya organization_id → filter via orders JOIN
--   * org context via public.current_org_id() (project convention,
--     BUKAN p_org_id param yang di-passing dari caller)
--   * profiles.email tidak ada → JOIN auth.users via SECURITY DEFINER
-- =============================================================

-- ----------------------------------------------------------
-- 1. team_cs_summary — list semua CS dengan metrics di periode
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.team_cs_summary(DATE, DATE);
CREATE OR REPLACE FUNCTION public.team_cs_summary(
  p_date_from DATE,
  p_date_to   DATE
)
RETURNS TABLE (
  user_id            UUID,
  full_name          TEXT,
  email              TEXT,
  is_active          BOOLEAN,
  total_orders       BIGINT,
  closing_count      BIGINT,
  conv_rate          NUMERIC,
  revenue_handled    NUMERIC,
  commission_earned  NUMERIC,
  commission_unpaid  NUMERIC
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
  WITH cs_users AS (
    SELECT p.id, p.full_name, p.active
    FROM public.profiles p
    WHERE p.organization_id = v_org
      AND p.role = 'cs'
  ),
  cs_emails AS (
    SELECT u.id, au.email::TEXT AS email
    FROM cs_users u
    LEFT JOIN auth.users au ON au.id = u.id
  ),
  order_stats AS (
    SELECT
      o.cs_id,
      COUNT(*)::BIGINT AS total_orders,
      COUNT(*) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS closing_count,
      COALESCE(SUM(o.total) FILTER (WHERE o.status = 'DITERIMA'), 0)::NUMERIC AS revenue
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.cs_id IS NOT NULL
      AND o.order_date BETWEEN p_date_from AND p_date_to
    GROUP BY o.cs_id
  ),
  comm_stats AS (
    SELECT
      c.user_id,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status IN ('EARNED','PAID')), 0)::NUMERIC AS earned,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'EARNED'),         0)::NUMERIC AS unpaid
    FROM public.commissions c
    JOIN public.orders o ON o.id = c.order_id
    WHERE o.organization_id = v_org
      AND c.role = 'cs'
      AND o.order_date BETWEEN p_date_from AND p_date_to
    GROUP BY c.user_id
  )
  SELECT
    u.id                                                                   AS user_id,
    u.full_name                                                            AS full_name,
    e.email                                                                AS email,
    u.active                                                               AS is_active,
    COALESCE(o.total_orders, 0)                                            AS total_orders,
    COALESCE(o.closing_count, 0)                                           AS closing_count,
    CASE WHEN COALESCE(o.total_orders, 0) > 0
      THEN ROUND((o.closing_count::NUMERIC / o.total_orders) * 100, 1)
      ELSE 0
    END                                                                    AS conv_rate,
    COALESCE(o.revenue, 0)                                                 AS revenue_handled,
    COALESCE(m.earned, 0)                                                  AS commission_earned,
    COALESCE(m.unpaid, 0)                                                  AS commission_unpaid
  FROM cs_users u
  LEFT JOIN cs_emails  e ON e.id = u.id
  LEFT JOIN order_stats o ON o.cs_id = u.id
  LEFT JOIN comm_stats  m ON m.user_id = u.id
  ORDER BY COALESCE(o.total_orders, 0) DESC, u.full_name ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.team_cs_summary(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 2. team_cs_detail — JSONB dengan stats + daily_trend + recent_orders + commission_history
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.team_cs_detail(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.team_cs_detail(
  p_user_id   UUID,
  p_date_from DATE,
  p_date_to   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
  v_stats JSONB;
  v_trend JSONB;
  v_recent JSONB;
  v_commissions JSONB;
BEGIN
  -- Stats row (reuse summary RPC, filter by user_id)
  SELECT to_jsonb(s.*) INTO v_stats
  FROM public.team_cs_summary(p_date_from, p_date_to) s
  WHERE s.user_id = p_user_id;

  -- Daily trend (orders + closings per day)
  SELECT COALESCE(jsonb_agg(t ORDER BY t.date ASC), '[]'::JSONB) INTO v_trend
  FROM (
    SELECT
      o.order_date AS date,
      COUNT(*)::INT AS orders,
      COUNT(*) FILTER (WHERE o.status = 'DITERIMA')::INT AS closing
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.cs_id = p_user_id
      AND o.order_date BETWEEN p_date_from AND p_date_to
    GROUP BY o.order_date
  ) t;

  -- Recent orders (50 latest in range)
  SELECT COALESCE(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::JSONB) INTO v_recent
  FROM (
    SELECT
      o.id,
      o.order_number,
      o.customer_name,
      o.total,
      o.status,
      o.created_at,
      ch.code AS channel_code
    FROM public.orders o
    LEFT JOIN public.courier_channels ch ON ch.id = o.channel_id
    WHERE o.organization_id = v_org
      AND o.cs_id = p_user_id
      AND o.order_date BETWEEN p_date_from AND p_date_to
    ORDER BY o.created_at DESC
    LIMIT 50
  ) r;

  -- Commission history (100 latest in range)
  SELECT COALESCE(jsonb_agg(h ORDER BY h.created_at DESC), '[]'::JSONB) INTO v_commissions
  FROM (
    SELECT
      c.id,
      c.amount,
      c.status,
      c.created_at,
      c.paid_at,
      o.order_number
    FROM public.commissions c
    JOIN public.orders o ON o.id = c.order_id
    WHERE o.organization_id = v_org
      AND c.user_id = p_user_id
      AND c.role = 'cs'
      AND o.order_date BETWEEN p_date_from AND p_date_to
    ORDER BY c.created_at DESC
    LIMIT 100
  ) h;

  RETURN jsonb_build_object(
    'stats',              v_stats,
    'daily_trend',        v_trend,
    'recent_orders',      v_recent,
    'commission_history', v_commissions
  );
END $$;

GRANT EXECUTE ON FUNCTION public.team_cs_detail(UUID, DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 3. team_advertiser_summary — list semua advertiser dengan metrics
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.team_advertiser_summary(DATE, DATE);
CREATE OR REPLACE FUNCTION public.team_advertiser_summary(
  p_date_from DATE,
  p_date_to   DATE
)
RETURNS TABLE (
  user_id             UUID,
  full_name           TEXT,
  email               TEXT,
  is_active           BOOLEAN,
  active_campaigns    BIGINT,
  total_spend         NUMERIC,
  revenue_attributed  NUMERIC,
  roas                NUMERIC,
  orders_attributed   BIGINT,
  commission_earned   NUMERIC,
  commission_unpaid   NUMERIC
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
  WITH adv_users AS (
    SELECT p.id, p.full_name, p.active
    FROM public.profiles p
    WHERE p.organization_id = v_org
      AND p.role = 'advertiser'
  ),
  adv_emails AS (
    SELECT u.id, au.email::TEXT AS email
    FROM adv_users u
    LEFT JOIN auth.users au ON au.id = u.id
  ),
  campaign_counts AS (
    SELECT
      c.advertiser_id AS user_id,
      COUNT(*) FILTER (WHERE c.status = 'ACTIVE')::BIGINT AS active_count
    FROM public.campaigns c
    WHERE c.organization_id = v_org
      AND c.advertiser_id IS NOT NULL
    GROUP BY c.advertiser_id
  ),
  spend_stats AS (
    SELECT
      c.advertiser_id AS user_id,
      COALESCE(SUM(s.spend), 0)::NUMERIC AS total_spend
    FROM public.ad_spend s
    JOIN public.campaigns c ON c.id = s.campaign_id
    WHERE c.organization_id = v_org
      AND c.advertiser_id IS NOT NULL
      AND s.spend_date BETWEEN p_date_from AND p_date_to
    GROUP BY c.advertiser_id
  ),
  order_stats AS (
    SELECT
      c.advertiser_id AS user_id,
      COUNT(*) FILTER (WHERE o.status = 'DITERIMA')::BIGINT AS orders,
      COALESCE(SUM(o.total) FILTER (WHERE o.status = 'DITERIMA'), 0)::NUMERIC AS revenue
    FROM public.orders o
    JOIN public.campaigns c ON c.id = o.campaign_id
    WHERE o.organization_id = v_org
      AND c.advertiser_id IS NOT NULL
      AND o.order_date BETWEEN p_date_from AND p_date_to
    GROUP BY c.advertiser_id
  ),
  comm_stats AS (
    SELECT
      cm.user_id,
      COALESCE(SUM(cm.amount) FILTER (WHERE cm.status IN ('EARNED','PAID')), 0)::NUMERIC AS earned,
      COALESCE(SUM(cm.amount) FILTER (WHERE cm.status = 'EARNED'),           0)::NUMERIC AS unpaid
    FROM public.commissions cm
    JOIN public.orders o ON o.id = cm.order_id
    WHERE o.organization_id = v_org
      AND cm.role = 'advertiser'
      AND o.order_date BETWEEN p_date_from AND p_date_to
    GROUP BY cm.user_id
  )
  SELECT
    u.id,
    u.full_name,
    e.email,
    u.active                                                               AS is_active,
    COALESCE(cc.active_count, 0)                                           AS active_campaigns,
    COALESCE(ss.total_spend, 0)                                            AS total_spend,
    COALESCE(os.revenue, 0)                                                AS revenue_attributed,
    CASE WHEN COALESCE(ss.total_spend, 0) > 0
      THEN ROUND(os.revenue / ss.total_spend, 2)
      ELSE 0
    END                                                                    AS roas,
    COALESCE(os.orders, 0)                                                 AS orders_attributed,
    COALESCE(cm.earned, 0)                                                 AS commission_earned,
    COALESCE(cm.unpaid, 0)                                                 AS commission_unpaid
  FROM adv_users u
  LEFT JOIN adv_emails    e  ON e.id = u.id
  LEFT JOIN campaign_counts cc ON cc.user_id = u.id
  LEFT JOIN spend_stats   ss ON ss.user_id = u.id
  LEFT JOIN order_stats   os ON os.user_id = u.id
  LEFT JOIN comm_stats    cm ON cm.user_id = u.id
  ORDER BY COALESCE(ss.total_spend, 0) DESC, u.full_name ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.team_advertiser_summary(DATE, DATE) TO authenticated;

-- ----------------------------------------------------------
-- 4. team_advertiser_detail — JSONB dengan stats + daily_spend + campaigns + commission_history
-- ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.team_advertiser_detail(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION public.team_advertiser_detail(
  p_user_id   UUID,
  p_date_from DATE,
  p_date_to   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
  v_stats JSONB;
  v_daily_spend JSONB;
  v_campaigns JSONB;
  v_commissions JSONB;
BEGIN
  -- Stats row (reuse summary RPC)
  SELECT to_jsonb(s.*) INTO v_stats
  FROM public.team_advertiser_summary(p_date_from, p_date_to) s
  WHERE s.user_id = p_user_id;

  -- Daily spend trend
  SELECT COALESCE(jsonb_agg(t ORDER BY t.date ASC), '[]'::JSONB) INTO v_daily_spend
  FROM (
    SELECT
      s.spend_date AS date,
      SUM(s.spend)::NUMERIC AS spend
    FROM public.ad_spend s
    JOIN public.campaigns c ON c.id = s.campaign_id
    WHERE c.organization_id = v_org
      AND c.advertiser_id = p_user_id
      AND s.spend_date BETWEEN p_date_from AND p_date_to
    GROUP BY s.spend_date
  ) t;

  -- Campaigns list (with spend/orders/revenue in range)
  SELECT COALESCE(jsonb_agg(cm ORDER BY cm.spend DESC), '[]'::JSONB) INTO v_campaigns
  FROM (
    SELECT
      c.id,
      c.campaign_name,
      c.platform,
      c.status,
      COALESCE(s_agg.spend, 0)::NUMERIC AS spend,
      COALESCE(o_agg.orders, 0)::INT AS orders,
      COALESCE(o_agg.revenue, 0)::NUMERIC AS revenue,
      CASE WHEN COALESCE(s_agg.spend, 0) > 0
        THEN ROUND(COALESCE(o_agg.revenue, 0) / s_agg.spend, 2)
        ELSE 0
      END AS roas
    FROM public.campaigns c
    LEFT JOIN (
      SELECT s.campaign_id, SUM(s.spend) AS spend
      FROM public.ad_spend s
      WHERE s.spend_date BETWEEN p_date_from AND p_date_to
      GROUP BY s.campaign_id
    ) s_agg ON s_agg.campaign_id = c.id
    LEFT JOIN (
      SELECT
        o.campaign_id,
        COUNT(*) FILTER (WHERE o.status = 'DITERIMA') AS orders,
        SUM(o.total) FILTER (WHERE o.status = 'DITERIMA') AS revenue
      FROM public.orders o
      WHERE o.organization_id = v_org
        AND o.order_date BETWEEN p_date_from AND p_date_to
      GROUP BY o.campaign_id
    ) o_agg ON o_agg.campaign_id = c.id
    WHERE c.organization_id = v_org
      AND c.advertiser_id = p_user_id
  ) cm;

  -- Commission history
  SELECT COALESCE(jsonb_agg(h ORDER BY h.created_at DESC), '[]'::JSONB) INTO v_commissions
  FROM (
    SELECT
      cm.id,
      cm.amount,
      cm.status,
      cm.created_at,
      cm.paid_at,
      o.order_number
    FROM public.commissions cm
    JOIN public.orders o ON o.id = cm.order_id
    WHERE o.organization_id = v_org
      AND cm.user_id = p_user_id
      AND cm.role = 'advertiser'
      AND o.order_date BETWEEN p_date_from AND p_date_to
    ORDER BY cm.created_at DESC
    LIMIT 100
  ) h;

  RETURN jsonb_build_object(
    'stats',              v_stats,
    'daily_spend',        v_daily_spend,
    'campaigns',          v_campaigns,
    'commission_history', v_commissions
  );
END $$;

GRANT EXECUTE ON FUNCTION public.team_advertiser_detail(UUID, DATE, DATE) TO authenticated;

-- =============================================================
-- DONE — 4 RPCs. Smoke test (via PostgREST):
--   POST /rest/v1/rpc/team_cs_summary       {p_date_from,p_date_to}
--   POST /rest/v1/rpc/team_cs_detail        {p_user_id,p_date_from,p_date_to}
--   POST /rest/v1/rpc/team_advertiser_summary  {p_date_from,p_date_to}
--   POST /rest/v1/rpc/team_advertiser_detail   {p_user_id,p_date_from,p_date_to}
-- =============================================================
