-- 139 — Fix timeout Sync Status SPX (apply_spx_status_sync).
-- ============================================================================
-- apply_spx_status_sync loop per-baris: tiap baris SELECT ... WHERE
-- order_number = v_ref AND organization_id = v_org. Tanpa index di order_number,
-- tiap lookup = seq scan penuh orders_draft. File 4927 baris (chunk 400) →
-- ratusan seq scan per chunk → lewat statement_timeout (8s) → "canceling
-- statement due to statement timeout".
--
-- Fix: index komposit (organization_id, order_number) → lookup jadi index scan
-- (instan). Non-destruktif, idempotent. Reversible: DROP INDEX kalau perlu.
-- record_spx_status_batch (mig 101) juga query reconciliation_batches by org —
-- udah ke-cover index existing, gak diutak-atik.

CREATE INDEX IF NOT EXISTS idx_orders_draft_org_order_number
  ON public.orders_draft(organization_id, order_number);
