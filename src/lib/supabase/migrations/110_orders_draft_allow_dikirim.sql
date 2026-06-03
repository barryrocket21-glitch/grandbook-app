-- 110 — Fix Sync SPX: izinin DIKIRIM di orders_draft.
-- ============================================================================
-- BUG: apply_spx_status_sync gagal (23514) pas update order "In Transit/
-- Delivering" → DIKIRIM. Constraint orders_draft_status_check cuma izinin
-- BARU/SIAP_KIRIM/PROBLEM/CANCEL → DIKIRIM ketinggalan, seluruh batch rollback.
--
-- DESAIN: orders_draft nyimpen order sampai TERMINAL (DITERIMA/RETUR/CANCEL →
-- promote ke orders via trg_promote_draft_on_terminal). DIKIRIM itu NON-terminal
-- (udah dikirim, lagi jalan) → harusnya tetap di draft, sama kaya PROBLEM.
-- PROBLEM udah ada di check, DIKIRIM kelewat. Ini nambahin DIKIRIM.
--
-- Status terminal (DITERIMA/RETUR/CANCEL) gak perlu di check ini: promote trigger
-- BEFORE UPDATE OF status return NULL (batalin update + pindah row ke orders),
-- jadi nilainya gak pernah ke-persist & gak pernah ke-validasi di check draft.
-- Idempotent.

ALTER TABLE public.orders_draft DROP CONSTRAINT IF EXISTS orders_draft_status_check;

ALTER TABLE public.orders_draft ADD CONSTRAINT orders_draft_status_check
  CHECK (status = ANY (ARRAY['BARU'::text, 'SIAP_KIRIM'::text, 'DIKIRIM'::text, 'PROBLEM'::text, 'CANCEL'::text]));
