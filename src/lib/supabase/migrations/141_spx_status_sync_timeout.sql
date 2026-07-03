-- 141 — Fix timeout Apply Sync Status SPX (lapisan 2, headroom).
-- ============================================================================
-- apply_spx_status_sync set status → DITERIMA/RETUR/CANCEL memicu trigger
-- promote_draft_on_terminal (mig 099): INSERT orders + order_items + audit +
-- DELETE draft PER BARIS. Batch besar → lewat statement_timeout default (8s).
--
-- Lapisan 1: frontend kecilin chunk 400→150. Lapisan 2 (ini): naikin
-- statement_timeout KHUSUS fungsi ini jadi 90s sebagai headroom, biar batch
-- berat tetap kelar walau agak lama. Per-function config (bukan global), gak
-- ganggu query lain. Idempotent (ALTER FUNCTION set config).
-- Body fungsi TIDAK diubah.

ALTER FUNCTION public.apply_spx_status_sync(jsonb) SET statement_timeout = '90s';
