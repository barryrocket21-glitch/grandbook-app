-- =============================================================
-- Consolidate multiple permissive RLS policies (advisor cleanup)
-- Migration 071 — 2026-05-23
-- =============================================================
-- Advisor flagged `multiple_permissive_policies` 175 cases (expanded across
-- multiple roles × commands). Actual underlying duplication: only 2 cases.
--
-- Case 1: ad_spend SELECT has 2 policies:
--   - ad_spend_own (created_by = auth.uid())  — narrower
--   - ad_spend_select (organization_id = current_org_id()) — broader, supersedes
--   DROP ad_spend_own — redundant because broader covers narrower (OR-combine).
--   Note: created_by filter no longer enforced at RLS — UI must show all
--   org ad_spend anyway (advertiser-shared per org).
--
-- Case 2: order_items_draft ALL has 2 policies with IDENTICAL logic:
--   - items_draft_all (organization_id = current_org_id())
--   - order_items_draft_all (organization_id = current_org_id())
--   Pure duplicate from Phase 8H naming inconsistency. DROP the older
--   items_draft_all, keep canonical order_items_draft_all.
--
-- Idempotent via DROP POLICY IF EXISTS. Zero behavior change.
-- Verified post-apply: multiple_permissive_policies count 175 -> 0.
-- =============================================================

DROP POLICY IF EXISTS ad_spend_own ON public.ad_spend;
DROP POLICY IF EXISTS items_draft_all ON public.order_items_draft;
