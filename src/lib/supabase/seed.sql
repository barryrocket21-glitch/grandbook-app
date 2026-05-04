-- ============================================
-- GrandBook Seed Data
-- ============================================

-- 1. PRODUCTS (10 produk)
INSERT INTO products (sku, name, price_default, hpp, category, active) VALUES
('SKU-001', 'Paket Skincare Glow Up', 299000, 85000, 'Skincare', true),
('SKU-002', 'Serum Vitamin C 30ml', 189000, 45000, 'Skincare', true),
('SKU-003', 'Sunscreen SPF50 50ml', 159000, 38000, 'Skincare', true),
('SKU-004', 'Moisturizer Aloe Vera 100ml', 129000, 32000, 'Skincare', true),
('SKU-005', 'Facial Wash Gentle 100ml', 99000, 25000, 'Skincare', true),
('SKU-006', 'Paket Bundling Hemat A', 399000, 110000, 'Bundle', true),
('SKU-007', 'Paket Bundling Hemat B', 499000, 140000, 'Bundle', true),
('SKU-008', 'Eye Cream Anti Aging 15ml', 249000, 65000, 'Skincare', true),
('SKU-009', 'Toner Hydrating 120ml', 139000, 35000, 'Skincare', true),
('SKU-010', 'Lip Balm SPF15', 59000, 12000, 'Bodycare', true)
ON CONFLICT (sku) DO NOTHING;

-- 2. CAMPAIGNS (6 campaign)
INSERT INTO campaigns (platform, campaign_name, advertiser_id, active) VALUES
('META', 'FB - Glow Up Promo Mei', '33a044b1-2465-43d9-949c-0be248628bb6', true),
('META', 'IG - Skincare Bundling', '33a044b1-2465-43d9-949c-0be248628bb6', true),
('GOOGLE', 'Google Ads - Brand Search', '33a044b1-2465-43d9-949c-0be248628bb6', true),
('TIKTOK', 'TikTok - Viral Serum VC', '33a044b1-2465-43d9-949c-0be248628bb6', true),
('META', 'FB - Retargeting Cart', '33a044b1-2465-43d9-949c-0be248628bb6', true),
('TIKTOK', 'TikTok - Bundle Promo', '33a044b1-2465-43d9-949c-0be248628bb6', true)
ON CONFLICT (platform, campaign_name) DO NOTHING;

-- 3. ORDERS (20 orders - berbagai status)
INSERT INTO orders (order_number, order_date, customer_name, customer_phone, customer_city, customer_province, subtotal, shipping_cost, discount, total, payment_method, status, campaign_id, cs_id, admin_id, notes) VALUES
('ORD-20260501-0001', '2026-05-01', 'Rina Wijaya', '081234567801', 'Jakarta Selatan', 'DKI Jakarta', 299000, 15000, 0, 314000, 'TRANSFER', 'SELESAI', 1, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', 'Repeat customer'),
('ORD-20260501-0002', '2026-05-01', 'Dewi Sartika', '081234567802', 'Bandung', 'Jawa Barat', 189000, 12000, 0, 201000, 'COD', 'SELESAI', 4, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260501-0003', '2026-05-01', 'Putri Handayani', '081234567803', 'Surabaya', 'Jawa Timur', 499000, 18000, 25000, 492000, 'TRANSFER', 'SELESAI', 2, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260501-0004', '2026-05-01', 'Maya Sari', '081234567804', 'Medan', 'Sumatera Utara', 159000, 20000, 0, 179000, 'COD', 'RETUR', 1, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', 'Produk rusak saat pengiriman'),
('ORD-20260502-0001', '2026-05-02', 'Anisa Rahma', '081234567805', 'Yogyakarta', 'DI Yogyakarta', 399000, 15000, 20000, 394000, 'TRANSFER', 'SELESAI', 3, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260502-0002', '2026-05-02', 'Fitri Nur', '081234567806', 'Semarang', 'Jawa Tengah', 248000, 12000, 0, 260000, 'COD', 'SELESAI', 4, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260502-0003', '2026-05-02', 'Sari Indah', '081234567807', 'Makassar', 'Sulawesi Selatan', 129000, 25000, 0, 154000, 'TRANSFER', 'FAKE', 6, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', 'Nomor HP tidak valid'),
('ORD-20260502-0004', '2026-05-02', 'Linda Pertiwi', '081234567808', 'Denpasar', 'Bali', 189000, 18000, 10000, 197000, 'COD', 'SELESAI', 1, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260503-0001', '2026-05-03', 'Ratna Dewi', '081234567809', 'Palembang', 'Sumatera Selatan', 498000, 20000, 30000, 488000, 'TRANSFER', 'SELESAI', 2, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', 'Bundling A + Serum'),
('ORD-20260503-0002', '2026-05-03', 'Yuni Astuti', '081234567810', 'Balikpapan', 'Kalimantan Timur', 299000, 22000, 0, 321000, 'COD', 'DIKIRIM', 3, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', 'JNE REG'),
('ORD-20260503-0003', '2026-05-03', 'Nurul Huda', '081234567811', 'Malang', 'Jawa Timur', 159000, 12000, 0, 171000, 'TRANSFER', 'SELESAI', 5, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260503-0004', '2026-05-03', 'Dian Permata', '081234567812', 'Tangerang', 'Banten', 588000, 10000, 40000, 558000, 'TRANSFER', 'SELESAI', 4, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', 'Paket bundling B + Sunscreen'),
('ORD-20260504-0001', '2026-05-04', 'Sri Wahyuni', '081234567813', 'Bekasi', 'Jawa Barat', 249000, 10000, 0, 259000, 'COD', 'DIPROSES', 1, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260504-0002', '2026-05-04', 'Mega Utami', '081234567814', 'Bogor', 'Jawa Barat', 338000, 12000, 15000, 335000, 'TRANSFER', 'BARU', 6, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', 'Serum + Toner + Lip Balm'),
('ORD-20260504-0003', '2026-05-04', 'Eka Pratiwi', '081234567815', 'Depok', 'Jawa Barat', 399000, 10000, 0, 409000, 'COD', 'BARU', 2, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260504-0004', '2026-05-04', 'Wulan Sari', '081234567816', 'Solo', 'Jawa Tengah', 189000, 12000, 0, 201000, 'TRANSFER', 'DIPROSES', 3, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260504-0005', '2026-05-04', 'Citra Lestari', '081234567817', 'Cirebon', 'Jawa Barat', 99000, 12000, 0, 111000, 'COD', 'CANCEL', 5, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', 'Customer membatalkan'),
('ORD-20260504-0006', '2026-05-04', 'Intan Permatasari', '081234567818', 'Surabaya', 'Jawa Timur', 499000, 15000, 25000, 489000, 'TRANSFER', 'DIKIRIM', 4, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', 'SiCepat BEST'),
('ORD-20260504-0007', '2026-05-04', 'Nadia Safitri', '081234567819', 'Jakarta Utara', 'DKI Jakarta', 258000, 10000, 0, 268000, 'COD', 'BARU', 1, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL),
('ORD-20260504-0008', '2026-05-04', 'Riska Amelia', '081234567820', 'Bandung', 'Jawa Barat', 159000, 12000, 0, 171000, 'TRANSFER', 'BARU', 6, '33a044b1-2465-43d9-949c-0be248628bb6', '33a044b1-2465-43d9-949c-0be248628bb6', NULL)
ON CONFLICT (order_number) DO NOTHING;
