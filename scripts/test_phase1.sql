-- =============================================================
-- PHASE 1: Smoke Test Queries
-- =============================================================
-- Run di Supabase SQL Editor (atau via exec_sql) untuk verifikasi
-- bahwa migration 010, seed_phase1, dan import master_wilayah
-- semua sukses.
--
-- Expected results commented per query.
-- =============================================================

-- 1. Pastikan organisasi default ada
SELECT * FROM public.organizations;
-- Expected: 1 row, name='Default Organization', slug='default'

-- 2. Pastikan semua user di-link ke organization
SELECT COUNT(*) AS unassigned FROM public.profiles WHERE organization_id IS NULL;
-- Expected: 0

-- 3. Master wilayah ter-import
SELECT COUNT(*) AS total_wilayah FROM public.master_wilayah;
-- Expected: ~82539 (8 conflicts dari source file)

-- 4. Sample query master wilayah
SELECT province, city, subdistrict, village, zip
FROM public.master_wilayah
WHERE province_normalized LIKE '%nusa tenggara%'
LIMIT 5;
-- Expected: 5 rows dari NTB / NTT

-- 5. Couriers seeded
SELECT COUNT(*) AS couriers_active FROM public.couriers WHERE active = TRUE;
-- Expected: 2 (SPX, JNE)

-- 6. Channels seeded
SELECT COUNT(*) AS channels_active FROM public.courier_channels WHERE active = TRUE;
-- Expected: 2 (SPX_DIRECT, JNE_VIA_MENGANTAR)

-- 7. Status mapping minimal
SELECT COUNT(*) AS status_mappings FROM public.courier_channel_statuses;
-- Expected: minimal 5

-- 8. Converter profiles seeded
SELECT code, name, direction FROM public.converter_profiles ORDER BY id;
-- Expected: 3 rows: orderonline_inbound, spx_financial_rekonsil, mengantar_outbound

-- 9. Field mappings Orderonline (15 rows)
SELECT COUNT(*) AS orderonline_mappings FROM public.converter_field_mappings cfm
JOIN public.converter_profiles cp ON cp.id = cfm.profile_id
WHERE cp.code = 'orderonline_inbound';
-- Expected: 15

-- 10. Field mappings SPX (10 rows)
SELECT COUNT(*) AS spx_mappings FROM public.converter_field_mappings cfm
JOIN public.converter_profiles cp ON cp.id = cfm.profile_id
WHERE cp.code = 'spx_financial_rekonsil';
-- Expected: 10

-- 11. Field mappings Mengantar (14 rows)
SELECT COUNT(*) AS mengantar_mappings FROM public.converter_field_mappings cfm
JOIN public.converter_profiles cp ON cp.id = cfm.profile_id
WHERE cp.code = 'mengantar_outbound';
-- Expected: 14

-- 12. Test trigger log_order_status_change saat insert
INSERT INTO public.orders (
  organization_id, order_number, customer_name, payment_method, total
) VALUES (1, 'TEST-001', 'Test User', 'COD', 100000);

SELECT from_status, to_status, source FROM public.order_status_history
WHERE order_id = (SELECT id FROM public.orders WHERE order_number = 'TEST-001');
-- Expected: 1 row, from_status=NULL, to_status='BARU', source='system'

-- 13. Test trigger saat update status
UPDATE public.orders SET status = 'SIAP_KIRIM' WHERE order_number = 'TEST-001';
SELECT from_status, to_status FROM public.order_status_history
  WHERE order_id = (SELECT id FROM public.orders WHERE order_number = 'TEST-001')
  ORDER BY changed_at;
-- Expected: 2 rows: (NULL, 'BARU'), ('BARU', 'SIAP_KIRIM')

-- 14. Test status_changed_at terupdate
SELECT status, status_changed_at FROM public.orders WHERE order_number = 'TEST-001';
-- Expected: status='SIAP_KIRIM', status_changed_at recent (within last few seconds)

-- 15. Test wilayah_id link
INSERT INTO public.orders (
  organization_id, order_number, customer_name, payment_method, total,
  customer_province, customer_city, customer_subdistrict, customer_village, customer_zip,
  wilayah_id
) VALUES (
  1, 'TEST-002', 'Test Wilayah', 'COD', 100000,
  'Nusa Tenggara Barat (NTB)', 'Mataram', 'Mataram', 'Mataram Timur', '83121',
  (SELECT id FROM public.master_wilayah
    WHERE province='Nusa Tenggara Barat (NTB)' AND village='Mataram Timur' LIMIT 1)
);
SELECT order_number, customer_village, wilayah_id FROM public.orders WHERE order_number = 'TEST-002';
-- Expected: wilayah_id NOT NULL

-- 16. Cleanup test data
DELETE FROM public.orders WHERE order_number IN ('TEST-001', 'TEST-002');

-- 17. Test unique constraint external_order_id berjalan
INSERT INTO public.orders (organization_id, order_number, customer_name, payment_method, total, external_order_id)
  VALUES (1, 'TEST-003', 'A', 'COD', 100000, 'EXT-001');

-- This second insert SHOULD fail with: "duplicate key value violates unique constraint"
-- INSERT INTO public.orders (organization_id, order_number, customer_name, payment_method, total, external_order_id)
--   VALUES (1, 'TEST-004', 'B', 'COD', 100000, 'EXT-001');

-- 18. Cleanup
DELETE FROM public.orders WHERE order_number = 'TEST-003';

-- =============================================================
-- Sanity check: tabel-tabel utama Phase 1 ada semua
-- =============================================================
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'organizations','master_wilayah','couriers','courier_channels',
    'courier_channel_rates','courier_channel_statuses',
    'converter_profiles','converter_field_mappings','converter_value_mappings',
    'orders','order_items','order_status_history',
    'inbox_unmatched_resi','inbox_unmapped_statuses'
  )
ORDER BY table_name;
-- Expected: 14 rows
