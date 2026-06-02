-- 108 — Hotfix Brief #23: analytics_ad_spend_summary "structure of query does not
-- match function result type". Akar: COALESCE(SUM(bigint),0) → integer/numeric,
-- tapi RETURNS declare bigint → mismatch (kelihatan pas ad_spend kosong: 0=integer).
-- Fix: cast eksplisit ke tipe RETURNS. Body sama, cuma casting. Idempotent.

CREATE OR REPLACE FUNCTION public.analytics_ad_spend_summary(p_from date, p_to date)
 RETURNS TABLE(total_spend numeric, total_ppn numeric, total_spend_with_ppn numeric, total_conversions bigint, total_impressions bigint, total_clicks bigint, campaigns_count bigint, by_platform jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org BIGINT := current_org_id();
BEGIN
  RETURN QUERY
  WITH agg AS (
    SELECT
      COALESCE(SUM(a.spend), 0)::numeric AS s,
      COALESCE(SUM(a.ppn_amount), 0)::numeric AS p,
      COALESCE(SUM(a.spend_total), 0)::numeric AS st,
      COALESCE(SUM(a.conversions), 0)::bigint AS c,
      COALESCE(SUM(a.impressions), 0)::bigint AS i,
      COALESCE(SUM(a.clicks), 0)::bigint AS k,
      COUNT(DISTINCT a.campaign_id)::bigint AS cc
    FROM public.ad_spend a
    WHERE a.organization_id = v_org
      AND a.spend_date BETWEEN p_from AND p_to
  ),
  platform_agg AS (
    SELECT jsonb_object_agg(plat.platform,
      jsonb_build_object('spend', plat.s, 'ppn', plat.p, 'spend_with_ppn', plat.st,
        'conversions', plat.c, 'count', plat.cc)) AS by_plat
    FROM (
      SELECT c.platform,
        SUM(a.spend)::numeric AS s, SUM(a.ppn_amount)::numeric AS p, SUM(a.spend_total)::numeric AS st,
        SUM(a.conversions)::bigint AS c, COUNT(*)::bigint AS cc
      FROM public.ad_spend a
      JOIN public.campaigns c ON c.id = a.campaign_id
      WHERE a.organization_id = v_org AND a.spend_date BETWEEN p_from AND p_to
      GROUP BY c.platform
    ) plat
  )
  SELECT agg.s, agg.p, agg.st, agg.c, agg.i, agg.k, agg.cc,
    COALESCE((SELECT by_plat FROM platform_agg LIMIT 1), '{}'::jsonb)
  FROM agg;
END $function$;
