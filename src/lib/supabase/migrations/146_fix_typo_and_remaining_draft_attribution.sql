-- 146 — Final cleanup: obvious attribution typos + remaining draft mismatches.
-- ============================================================================
-- Safe fixes only:
-- 1) Correct obvious campaign-name typos used in attribution display.
-- 2) Move Cream Collagen S.B.1 campaign from typo account BB -> correct account B.
-- 3) Backfill NULL order_items_draft.product_id from exact active product names.
-- 4) Re-run draft campaign repair after the master-data cleanup.

-- A. Obvious campaign-name typos.
UPDATE public.campaigns
SET campaign_name = 'Jaring Paranet G.C.1', updated_at = now()
WHERE id = 121 AND campaign_name = 'Jaring Parant G.C.1';

UPDATE public.campaigns
SET campaign_name = 'Cream Collagen S.B.1', updated_at = now()
WHERE id = 73 AND campaign_name = 'Cream Collgen S.B.1';

-- B. Cream Collagen S.B.1 belongs to Snack account code B, not BB.
UPDATE public.campaigns
SET account_id = 45, updated_at = now()
WHERE id = 73 AND account_id = 51;

-- C. Backfill missing product_id on draft items using exact current product names.
UPDATE public.order_items_draft oi
SET product_id = p.id
FROM public.products p
WHERE oi.product_id IS NULL
  AND oi.organization_id = p.organization_id
  AND p.active = true
  AND lower(trim(oi.product_name_raw)) = lower(trim(p.name));

-- D. Re-run draft attribution repair after product/account cleanup.
SELECT public.repair_orders_draft_campaign_from_items(NULL);
