-- =============================================================
-- PHASE 8H-1 HOTFIX: master_wilayah_spx RLS SELECT policy
-- =============================================================
-- Migration 037 (Phase 8G) bikin master_wilayah_spx dengan RLS ENABLED
-- tapi LUPA bikin SELECT policy. Akibat: RLS no-policy = deny all
-- (kecuali superuser/service_role yang bypass RLS).
--
-- Symptom production:
--   - Owner upload Orderonline → parseAddress V3 fail untuk Dedhy + Djono
--   - meta.address_parse_failed = "ambiguous" (V2 fallback result)
--   - Unit test verify-8h.ts PASS (pakai service_role yang bypass RLS)
--   - MCP execute_sql test PASS (pakai service_role)
--   - Production engine FAIL (authenticated user → RLS block → RPC return 0 row)
--
-- Verified via debug script scripts/debug-parser-v3.ts dengan 3 client:
--   1. SERVICE_ROLE: RPC return rows correct → parser SUCCESS
--   2. ANON (no login): RPC return 0 rows → parser FAIL no_match
--   3. AUTHENTICATED (owner login) PRE-FIX: 0 rows → parser FAIL ambiguous
--   3. AUTHENTICATED (owner login) POST-FIX: rows correct → parser SUCCESS
--
-- Fix: CREATE POLICY untuk authenticated SELECT. Master SPX wilayah shared
-- across orgs (per Phase 8G decision). Policy `USING (true)` = unconditional
-- read access. Write side (INSERT/UPDATE/DELETE) tetap blocked dari
-- authenticated via table-level REVOKE (migration 037).
--
-- IDEMPOTENT (DROP POLICY IF EXISTS + CREATE).
-- =============================================================

DROP POLICY IF EXISTS "master_wilayah_spx_select_authenticated" ON public.master_wilayah_spx;
CREATE POLICY "master_wilayah_spx_select_authenticated"
  ON public.master_wilayah_spx
  FOR SELECT
  TO authenticated
  USING (true);
