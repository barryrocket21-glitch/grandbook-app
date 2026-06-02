-- 097 — Brief #15 PART 4: view CPR/CPA per campaign.
-- ============================================================================
-- Input spending harian udah ada (/ad-spend, Phase 5B). Ini nambah turunan:
--   CPR = spend_total ÷ leads (meta_lead_count)
--   CPA = spend_total ÷ order ter-atribusi (orders_draft.campaign_id, GROSS)
--   CPA-final (delivered) = butuh #13 → tampil "pending" di UI.
-- Turunan dihitung on-the-fly (gak disimpen). INVOKER, org-scoped. Idempotent.

DROP FUNCTION IF EXISTS public.campaign_performance(date, date);
CREATE OR REPLACE FUNCTION public.campaign_performance(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE(
  campaign_id BIGINT,
  campaign_name TEXT,
  platform TEXT,
  spend_total NUMERIC,
  leads BIGINT,
  attributed_orders BIGINT,
  cpr NUMERIC,
  cpa NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH sp AS (
    SELECT a.campaign_id AS cid,
           COALESCE(SUM(COALESCE(a.spend_total, a.spend)), 0)::NUMERIC AS spend_total,
           COALESCE(SUM(COALESCE(a.meta_lead_count, 0)), 0)::BIGINT AS leads
    FROM public.ad_spend a
    JOIN public.campaigns c ON c.id = a.campaign_id
    WHERE c.organization_id = v_org
      AND (p_from IS NULL OR a.spend_date >= p_from)
      AND (p_to IS NULL OR a.spend_date <= p_to)
    GROUP BY a.campaign_id
  ),
  ord AS (
    SELECT campaign_id AS cid, COUNT(*)::BIGINT AS cnt
    FROM public.orders_draft
    WHERE organization_id = v_org AND campaign_id IS NOT NULL
      AND (p_from IS NULL OR order_date >= p_from)
      AND (p_to IS NULL OR order_date <= p_to)
    GROUP BY campaign_id
  )
  SELECT c.id, c.campaign_name, c.platform,
    COALESCE(sp.spend_total, 0)::NUMERIC,
    COALESCE(sp.leads, 0)::BIGINT,
    COALESCE(ord.cnt, 0)::BIGINT,
    CASE WHEN COALESCE(sp.leads, 0) > 0 THEN ROUND(sp.spend_total / sp.leads, 0) ELSE NULL END,
    CASE WHEN COALESCE(ord.cnt, 0) > 0 THEN ROUND(sp.spend_total / ord.cnt, 0) ELSE NULL END
  FROM public.campaigns c
  LEFT JOIN sp ON sp.cid = c.id
  LEFT JOIN ord ON ord.cid = c.id
  WHERE c.organization_id = v_org AND (sp.cid IS NOT NULL OR ord.cid IS NOT NULL)
  ORDER BY COALESCE(sp.spend_total, 0) DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.campaign_performance(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_performance(date, date) TO authenticated;
