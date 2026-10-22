-- 145 — Repair wrong draft attribution using actual order_items product.
-- ============================================================================
-- Root cause:
-- 1) orders_draft inserted first
-- 2) AFTER INSERT trigger resolve_order_attribution() runs immediately
-- 3) order_items_draft row is inserted AFTER that
-- 4) resolver cannot see the product yet, so among campaigns sharing the same
--    platform/account/marker it falls back to the lowest campaign id and can
--    attach the wrong product campaign (e.g. Jaring Paranet -> Luna G.C.1).
--
-- Fix:
-- - Add product-aware repair function that uses the ACTUAL order_items_draft
--   product plus attribution platform/account/marker to find the unique target
--   campaign.
-- - Run it after order_items_draft insert so future orders self-correct.
-- - Safe for live backfills: only updates rows where the target campaign is
--   unique and differs from the current assignment.

CREATE OR REPLACE FUNCTION public.repair_orders_draft_campaign_from_items(
  p_order_ids bigint[] DEFAULT NULL::bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org bigint;
  v_scope_total int := 0;
  v_already_correct int := 0;
  v_candidate_unique int := 0;
  v_candidate_missing int := 0;
  v_updated int := 0;
BEGIN
  v_org := public.current_org_id();

  WITH scoped AS (
    SELECT DISTINCT
      d.id,
      d.organization_id,
      d.campaign_id,
      d.advertiser_id,
      oi.product_id,
      COALESCE(NULLIF(d.attribution_platform, ''), NULLIF(d.meta->>'platform', '')) AS platform,
      COALESCE(NULLIF(d.attribution_account_code, ''), NULLIF(d.meta->>'atribusi_account', '')) AS account_code,
      COALESCE(NULLIF(d.attribution_campaign_marker, ''), NULLIF(d.meta->>'atribusi_campaign', '')) AS campaign_marker
    FROM public.orders_draft d
    JOIN public.order_items_draft oi ON oi.order_id = d.id
    WHERE d.organization_id = v_org
      AND (p_order_ids IS NULL OR d.id = ANY(p_order_ids))
      AND oi.product_id IS NOT NULL
      AND COALESCE(NULLIF(d.attribution_account_code, ''), NULLIF(d.meta->>'atribusi_account', '')) IS NOT NULL
      AND COALESCE(NULLIF(d.attribution_campaign_marker, ''), NULLIF(d.meta->>'atribusi_campaign', '')) IS NOT NULL
  ), current_state AS (
    SELECT s.*,
      EXISTS (
        SELECT 1
        FROM public.campaign_products cp
        WHERE cp.campaign_id = s.campaign_id
          AND cp.product_id = s.product_id
      ) AS current_matches_product
    FROM scoped s
  ), candidate_pool AS (
    SELECT
      s.id,
      c.id AS target_campaign_id,
      a.advertiser_id AS target_advertiser_id,
      COUNT(*) OVER (PARTITION BY s.id) AS candidate_count
    FROM current_state s
    JOIN public.ad_accounts a
      ON a.organization_id = v_org
     AND lower(a.platform) = lower(s.platform)
     AND lower(a.account_code) = lower(s.account_code)
    JOIN public.campaigns c
      ON c.account_id = a.id
     AND lower(c.campaign_marker) = lower(s.campaign_marker)
    JOIN public.campaign_products cp
      ON cp.campaign_id = c.id
     AND cp.product_id = s.product_id
  ), candidate_unique AS (
    SELECT DISTINCT ON (id)
      id,
      target_campaign_id,
      target_advertiser_id,
      candidate_count
    FROM candidate_pool
    ORDER BY id, target_campaign_id
  ), to_fix AS (
    SELECT s.id, u.target_campaign_id, u.target_advertiser_id
    FROM current_state s
    JOIN candidate_unique u ON u.id = s.id
    WHERE u.candidate_count = 1
      AND NOT s.current_matches_product
      AND s.campaign_id IS DISTINCT FROM u.target_campaign_id
  ), updated AS (
    UPDATE public.orders_draft d
    SET campaign_id = f.target_campaign_id,
        advertiser_id = COALESCE(f.target_advertiser_id, d.advertiser_id),
        meta = jsonb_set(COALESCE(d.meta, '{}'::jsonb), '{atribusi_pending}', 'false'::jsonb, true),
        updated_at = now()
    FROM to_fix f
    WHERE d.id = f.id
    RETURNING d.id
  )
  SELECT
    (SELECT COUNT(*) FROM current_state),
    (SELECT COUNT(*) FROM current_state WHERE current_matches_product),
    (SELECT COUNT(*) FROM candidate_unique WHERE candidate_count = 1),
    (SELECT COUNT(*) FROM current_state s LEFT JOIN candidate_unique u ON u.id = s.id WHERE NOT s.current_matches_product AND COALESCE(u.candidate_count, 0) = 0),
    (SELECT COUNT(*) FROM updated)
  INTO v_scope_total, v_already_correct, v_candidate_unique, v_candidate_missing, v_updated;

  RETURN jsonb_build_object(
    'scope_total', v_scope_total,
    'already_correct', v_already_correct,
    'candidate_unique', v_candidate_unique,
    'candidate_missing', v_candidate_missing,
    'updated', v_updated
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_repair_orders_draft_campaign_after_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.repair_orders_draft_campaign_from_items(ARRAY[NEW.order_id]);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_repair_orders_draft_campaign_after_item ON public.order_items_draft;
CREATE TRIGGER trg_repair_orders_draft_campaign_after_item
  AFTER INSERT ON public.order_items_draft
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_repair_orders_draft_campaign_after_item();
