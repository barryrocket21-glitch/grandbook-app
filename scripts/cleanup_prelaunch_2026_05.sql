-- =============================================================
-- GrandBook Pre-Launch Data Cleanup — May 2026 Operations Run
-- =============================================================
-- Date generated: 2026-05-12
-- Purpose: Bersihin SEMUA transactional/dev data sebelum live ops.
--          Master data (org, profiles, products, courier, billing
--          config, converter profiles) DI-PRESERVE.
--
-- HOW TO RUN:
--   1. Buka Supabase Dashboard → SQL Editor → New query
--   2. Copy-paste ISI file ini (full), klik Run
--   3. Cek output verifikasi di bawah (4. VERIFY)
--   4. Kalau angka SESUAI ekspektasi → biarkan committed
--      (Supabase SQL Editor auto-commit di akhir script)
--      Kalau ada yang aneh → close query SEBELUM commit, atau
--      ROLLBACK manual (psql) untuk batalin.
--
-- NOTES penting tentang schema realita:
--   * `pencairan` BUKAN tabel; itu kolom-kolom di `commissions`.
--     DELETE FROM commissions otomatis bersihin pencairan state.
--   * `reconciliation_uploads` belum dibuat (Phase 4D not started).
--     Statement-nya di-guard pakai IF EXISTS biar nggak error.
--   * order_items, commissions, campaign_products: punya
--     ON DELETE CASCADE → terhapus otomatis saat parent dihapus.
--     Statement explicit di bawah = safety net (0 rows expected).
-- =============================================================

BEGIN;

-- =============================================================
-- STEP 1: Wipe child / supporting tables first (urutan FK-safe)
-- =============================================================

-- 1a. commissions — full wipe (5 kolom pencairan ikut hilang)
DELETE FROM public.commissions;

-- 1b. campaign_products — full wipe (allocation links)
DELETE FROM public.campaign_products;

-- 1c. order_status_history — bersihin history orders yang akan dihapus
DELETE FROM public.order_status_history
WHERE order_id IN (
  SELECT id FROM public.orders
  WHERE created_at < CURRENT_DATE
     OR notes ILIKE '%test%'
     OR customer_name ILIKE '%test%'
);

-- =============================================================
-- STEP 2: Main transactional tables
-- =============================================================

-- 2a. orders — filtered DELETE (CASCADE akan handle order_items)
DELETE FROM public.orders
WHERE created_at < CURRENT_DATE
   OR notes ILIKE '%test%'
   OR customer_name ILIKE '%test%';

-- 2b. order_items — safety net untuk orphan (harusnya 0 row)
DELETE FROM public.order_items
WHERE order_id NOT IN (SELECT id FROM public.orders);

-- 2c. ad_spend — full wipe
DELETE FROM public.ad_spend;

-- 2d. campaigns — full wipe (campaign_products sudah dibersihkan di 1b)
DELETE FROM public.campaigns;

-- 2e. daily_cs_report — full wipe
DELETE FROM public.daily_cs_report;

-- 2f. Inbox queues — bersihin review queue stale dari dev/test
DELETE FROM public.inbox_unmatched_resi;
DELETE FROM public.inbox_unmapped_statuses;

-- 2g. ad_reconciliation (legacy Phase 0, struktur masih ada) — clear if exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ad_reconciliation'
  ) THEN
    DELETE FROM public.ad_reconciliation;
    RAISE NOTICE 'Cleared: ad_reconciliation';
  ELSE
    RAISE NOTICE 'Skipped (not found): ad_reconciliation';
  END IF;
END $$;

-- 2h. reconciliation_uploads — clear if exists (Phase 4D, kemungkinan belum ada)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reconciliation_uploads'
  ) THEN
    DELETE FROM public.reconciliation_uploads;
    RAISE NOTICE 'Cleared: reconciliation_uploads';
  ELSE
    RAISE NOTICE 'Skipped (not found): reconciliation_uploads';
  END IF;
END $$;

-- =============================================================
-- STEP 3: Reset sequences (semua *_id_seq → 1)
--         Aman pakai loop + pg_class existence check
-- =============================================================
DO $$
DECLARE
  seq_name TEXT;
  seq_names TEXT[] := ARRAY[
    'orders_id_seq',
    'order_items_id_seq',
    'order_status_history_id_seq',
    'commissions_id_seq',
    'ad_spend_id_seq',
    'campaigns_id_seq',
    'campaign_products_id_seq',
    'daily_cs_report_id_seq',
    'inbox_unmatched_resi_id_seq',
    'inbox_unmapped_statuses_id_seq',
    'ad_reconciliation_id_seq',
    'reconciliation_uploads_id_seq'
  ];
BEGIN
  FOREACH seq_name IN ARRAY seq_names LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class
      WHERE relkind = 'S' AND relname = seq_name AND relnamespace = 'public'::regnamespace
    ) THEN
      EXECUTE format('ALTER SEQUENCE public.%I RESTART WITH 1', seq_name);
      RAISE NOTICE 'Reset sequence: %', seq_name;
    ELSE
      RAISE NOTICE 'Skipped sequence (not found): %', seq_name;
    END IF;
  END LOOP;
END $$;

-- =============================================================
-- STEP 4: VERIFY — cleared tables harus 0, master harus preserved
-- =============================================================
SELECT '=== CLEARED (harus 0) ===' AS section, NULL::bigint AS rows
UNION ALL SELECT 'orders',                    COUNT(*) FROM public.orders
UNION ALL SELECT 'order_items',               COUNT(*) FROM public.order_items
UNION ALL SELECT 'order_status_history',      COUNT(*) FROM public.order_status_history
UNION ALL SELECT 'commissions',               COUNT(*) FROM public.commissions
UNION ALL SELECT 'ad_spend',                  COUNT(*) FROM public.ad_spend
UNION ALL SELECT 'campaigns',                 COUNT(*) FROM public.campaigns
UNION ALL SELECT 'campaign_products',         COUNT(*) FROM public.campaign_products
UNION ALL SELECT 'daily_cs_report',           COUNT(*) FROM public.daily_cs_report
UNION ALL SELECT 'inbox_unmatched_resi',      COUNT(*) FROM public.inbox_unmatched_resi
UNION ALL SELECT 'inbox_unmapped_statuses',   COUNT(*) FROM public.inbox_unmapped_statuses
UNION ALL SELECT '=== PRESERVED (harus > 0) ===', NULL
UNION ALL SELECT 'organizations',             COUNT(*) FROM public.organizations
UNION ALL SELECT 'profiles',                  COUNT(*) FROM public.profiles
UNION ALL SELECT 'products',                  COUNT(*) FROM public.products
UNION ALL SELECT 'product_categories',        COUNT(*) FROM public.product_categories
UNION ALL SELECT 'couriers',                  COUNT(*) FROM public.couriers
UNION ALL SELECT 'courier_channels',          COUNT(*) FROM public.courier_channels
UNION ALL SELECT 'courier_channel_rates',     COUNT(*) FROM public.courier_channel_rates
UNION ALL SELECT 'channel_billing_config',    COUNT(*) FROM public.channel_billing_config
UNION ALL SELECT 'converter_profiles',        COUNT(*) FROM public.converter_profiles
UNION ALL SELECT 'commission_rules',          COUNT(*) FROM public.commission_rules
UNION ALL SELECT 'operational_expenses',      COUNT(*) FROM public.operational_expenses
UNION ALL SELECT 'master_wilayah',            COUNT(*) FROM public.master_wilayah
;

COMMIT;

-- =============================================================
-- DONE. Kalau output STEP 4 sesuai (cleared=0, preserved>0),
-- production-ready untuk operasi real Mei 2026.
-- =============================================================
