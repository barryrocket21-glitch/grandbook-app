# Phase 5A — Smoke Test Checklist

Phase 5A = Products Extended + Operational Expenses. Verifikasi schema, CRUD pages, analytics extend, archived pages.

## Pre-test setup (SQL Editor)

```sql
-- Insert 3 dummy categories
INSERT INTO product_categories (organization_id, name, slug, active) VALUES
  (1, 'Skincare', 'skincare', true),
  (1, 'Fashion', 'fashion', true),
  (1, 'Elektronik', 'elektronik', true)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- Insert 1 dummy product (kalau belum ada)
INSERT INTO products (organization_id, sku, name, category_id, price_default, hpp, active, variation, notes)
SELECT 1, 'SKU-TEST-001', 'Test Serum', id, 199000, 45000, true, '30ml', 'product test phase 5A'
FROM product_categories WHERE slug = 'skincare' AND organization_id = 1
ON CONFLICT (sku) DO NOTHING;

-- Insert dummy operational_expenses (sewa rutin)
INSERT INTO operational_expenses (
  organization_id, expense_date, category, description, amount,
  payment_method, recurring, recurrence_period, vendor_name, created_by
) VALUES (
  1, CURRENT_DATE, 'SEWA', 'Sewa gudang Mei 2026', 3000000,
  'TRANSFER', true, 'MONTHLY', 'Pak Joko',
  (SELECT id FROM profiles WHERE role='owner' LIMIT 1)
);

-- Insert dummy GAJI biaya
INSERT INTO operational_expenses (
  organization_id, expense_date, category, description, amount,
  payment_method, recurring, recurrence_period, created_by
) VALUES (
  1, CURRENT_DATE, 'GAJI', 'Gaji CS Mei 2026', 5000000,
  'TRANSFER', true, 'MONTHLY',
  (SELECT id FROM profiles WHERE role='owner' LIMIT 1)
);
```

## Test `/products` page

- [ ] Buka `/products` → header tampil "Master Produk", 2 tab muncul (Produk + Kategori)
- [ ] Tab "Produk": tabel tampil dengan produk yang sudah backfill kategori
- [ ] Stat cards: Produk Aktif, Avg Margin, Margin Tipis, Rugi
- [ ] Search "Test" → filter jalan (cari di nama, SKU, variation, kategori)
- [ ] Filter "Skincare" → row Skincare aja
- [ ] Filter status "Nonaktif saja" → produk nonaktif aja
- [ ] Klik header kolom (Produk/Harga/HPP/Margin) → sort jalan, ascending/descending toggle
- [ ] Klik "Tambah Produk" → dialog buka
  - [ ] Pilih kategori via Combobox (auto-open on focus, scrollable)
  - [ ] EmptyHint muncul kalau kategori kosong (link ke "?tab=categories")
  - [ ] Variation field opsional (display di tabel di bawah nama)
  - [ ] Harga + HPP → margin preview muncul real-time
  - [ ] Save → row baru muncul di tabel
- [ ] Edit produk → ke-update (category_id, variation, notes)
- [ ] Power icon (toggle active) → row jadi opaque
- [ ] Trash icon (owner only) → warn dengan count linked order_items
- [ ] Empty state: filter semua produk hilang → "Tidak ada produk yang cocok"

## Test `/products` Tab Kategori

- [ ] Klik tab "Kategori" → tabel kategori muncul
- [ ] Stat: nama, slug, deskripsi, order, count produk, status
- [ ] Klik "Tambah Kategori" → dialog buka
  - [ ] Nama "Aksesoris" → slug auto-generate "aksesoris"
  - [ ] Edit slug manual ke "aksesoris-baju" → diterima
  - [ ] Save → row baru muncul di tabel
- [ ] Edit kategori → ke-update
- [ ] Delete kategori (owner only):
  - [ ] Kategori dipakai → warn dengan count produk
  - [ ] Confirm → produk yang reference jadi kategori NULL (ON DELETE SET NULL)
- [ ] Empty state: belum ada kategori → CTA "Tambah Kategori"

## Test `/expenses` page

- [ ] Buka `/expenses` → header tampil "Biaya Operasional", default date range = Bulan Ini
- [ ] Stat cards: Total Periode, Top Kategori, Recurring vs One-time, Biaya Rutin Bulanan (all-time)
- [ ] Per-category breakdown chips → klik chip "SEWA" → filter jadi SEWA
- [ ] Per-category chip color berbeda per kategori (badge style)
- [ ] Tabel: tanggal, kategori (badge color), deskripsi, vendor, amount, recurring badge, payment method
- [ ] Search "gaji" → filter jalan
- [ ] Filter kategori "GAJI" → row GAJI aja
- [ ] Filter recurring "Recurring saja" → row dengan recurring=true aja
- [ ] Tambah biaya:
  - [ ] Kategori dropdown 9 preset
  - [ ] Recurring checkbox → menampakkan periode dropdown
  - [ ] Payment method dropdown 5 opsi + "(tidak ditentukan)"
  - [ ] Save → row baru muncul
- [ ] Edit biaya → ke-update
- [ ] Delete biaya (owner only) → row hilang
- [ ] Bulk select (owner only): klik checkbox header → semua row terpilih → "Hapus Terpilih" muncul → confirm → bulk delete
- [ ] Tombol "Copy Bulan Lalu":
  - [ ] Disabled kalau belum ada recurring all-time
  - [ ] Click → confirm → copy semua recurring bulan lalu ke bulan ini, skip kalau duplicate (category+vendor+amount cocok)
  - [ ] Toast: "X di-copy, Y skipped"

## Test `/analytics` extend

- [ ] Buka `/analytics` (owner only) → Tab Overview default
- [ ] Stat cards Row 4 (Phase 5A) muncul: Op. Expenses, Net Profit, Net Margin %
- [ ] Net Profit = Estimated Profit (Phase 4C) − Op. Expenses (Phase 5A)
- [ ] Net Margin = Net Profit / Revenue (%)
- [ ] Cek tab "Per Produk" muncul (tab ke-5)
- [ ] Tab Per Produk: tabel dengan kolom Produk, Kategori, Qty, Revenue, HPP, Gross Profit, Margin %, Conv %
- [ ] Sortable: click Qty/Revenue/Gross Profit/Margin/Conv → sort
- [ ] Mini chart "Top 10 Produk by Revenue" → horizontal bar chart
- [ ] Empty state: belum ada order_items.product_id di range → "Belum ada order_items dengan produk"
- [ ] Conversion rate badge color-coded (≥80% emerald, ≥50% amber, <50% red)
- [ ] Margin badge color-coded (≥30% emerald, ≥10% amber, <10% red)

## Test archive pages

- [ ] Buka `/shipping-diff` → archived banner + CTA "Buka Analytics" → /analytics
- [ ] Buka `/duplicates` → archived banner + CTA "Buka Inbox" → /inbox/pending-review
- [ ] Sidebar tidak menampilkan "Selisih Ongkir" atau "Duplicate Inbox" lagi (cek di owner login)

## Test multi-role permissions

- [ ] Login sebagai admin → /products + /expenses accessible (canWrite=true), tapi tombol Delete hidden (owner-only)
- [ ] Login sebagai akunting → /products + /expenses accessible (canWrite=true)
- [ ] Login sebagai cs → /products + /expenses HIDDEN dari sidebar (cek constants.ts)
- [ ] Login sebagai advertiser → /products + /expenses HIDDEN dari sidebar

## Test migration idempotency

```bash
# Run migration 020 again — should not error
psql ... -f src/lib/supabase/migrations/020_products_expenses.sql
```

- [ ] No errors, no duplicate categories, no duplicate operational_expenses
- [ ] `category_id` di products tetap stable (tidak re-link)
- [ ] RPC `analytics_overview_v2` callable + return shape benar

## Test data linkage

- [ ] Tambah order baru dengan product yang punya HPP — verifikasi `order_items.hpp_snapshot` populated dari `products.hpp`
- [ ] Verifikasi `analytics_profit_per_product` return per-product row dengan revenue+HPP yang konsisten
- [ ] Verifikasi `analytics_overview_v2.total_operational_expenses` match SUM(amount) operational_expenses dalam range

## Cleanup pre-test data (kalau perlu)

```sql
DELETE FROM operational_expenses WHERE description LIKE '%Phase 5A test%' OR description = 'Sewa gudang Mei 2026' OR description = 'Gaji CS Mei 2026';
DELETE FROM products WHERE sku = 'SKU-TEST-001';
DELETE FROM product_categories WHERE slug IN ('skincare', 'fashion', 'elektronik', 'aksesoris-baju');
```
