# Phase 8A — Multi-Supplier Foundation: Test Playbook

> Manual smoke test untuk verifikasi acceptance criteria Phase 8A.
> Migration `011_phase8a_suppliers.sql` + seed `seed_phase8a_suppliers.sql` harus sudah dijalankan.

---

## Test 1 — Migration & Seed (2 menit)

**Tujuan:** Verifikasi schema dan seed data ter-apply.

Run query (Supabase SQL Editor atau `execute_sql` RPC):

```sql
SELECT count(*) FROM suppliers WHERE active = TRUE;
-- Expect: 3

SELECT id, code, name, city, active FROM suppliers ORDER BY id;
-- Expect: 3 row (JKT-KRAN, TGR-PARANET, MLG-MADU)

-- Schema check
SELECT column_name FROM information_schema.columns
  WHERE table_name='products' AND column_name='supplier_id';
-- Expect: 1 row (supplier_id)

SELECT column_name FROM information_schema.columns
  WHERE table_name='orders' AND column_name IN ('origin_supplier_id','is_multi_origin');
-- Expect: 2 rows

-- RLS aktif
SELECT relrowsecurity FROM pg_class WHERE relname='suppliers';
-- Expect: t

SELECT count(*) FROM pg_policies WHERE tablename='suppliers';
-- Expect: 4 (select / insert / update / delete)
```

**Pass:** Semua query return expected.

---

## Test 2 — RLS Permission (3 menit)

**Tujuan:** Owner/admin bisa CRUD, role lain read-only.

### 2.1 Owner (Barry)
1. Login: `owner@grandbook.com` / `GrandBook2026!`
2. Buka `/settings/suppliers`
3. **Expect:** Tampil 3 supplier seed. Tombol "Tambah Supplier" tampil di header.
4. Klik "Tambah Supplier" → isi:
   - Nama: `Supplier Test Owner`
   - Code: `TEST-OWN`
   - Kota: `Bandung`
5. Klik Simpan → toast "Supplier ditambahkan"
6. Edit row baru → ubah nama → Simpan → row update
7. Klik Power icon → confirm Disable → row jadi opacity-60
8. Toggle "Tampilkan tidak aktif" → row reappear

### 2.2 Admin
1. Login user dengan role `admin`
2. Buka `/settings/suppliers`
3. **Expect:** Tampil daftar, tombol Tambah/Edit/Disable visible.
4. Tambah supplier baru → success.

### 2.3 CS / Advertiser / Akunting
1. Login user dengan role `cs` (mis. `andi@cs.test` / `pass1234`)
2. Buka `/settings/suppliers`
3. **Expect:**
   - Tabel tampil 3+ supplier (read-only)
   - Tombol Tambah/Edit/Disable **tidak tampil** (PermissionGuard)
   - Banner biru "Mode read-only" tampil di bawah tabel
4. Coba inject INSERT via console:
   ```js
   const { createClient } = await import('@/lib/supabase/client')
   const sb = createClient()
   const r = await sb.from('suppliers').insert({ name: 'Hack', organization_id: 1 })
   console.log(r)
   ```
5. **Expect:** error 42501 / RLS policy violation (insert ditolak DB).

**Pass:** UI gating + RLS enforcement double-layer.

---

## Test 3 — Product ↔ Supplier Link (3 menit)

**Tujuan:** Form produk punya dropdown supplier yang functional.

### 3.1 Produk baru dengan supplier
1. Login owner
2. Buka `/products/new`
3. Isi nama: `Kran Air Test`
4. **Expect:** Section "Supplier (Gudang Asal)" tampil. Dropdown ada opsi:
   - `— Tidak di-link —`
   - `JKT-KRAN — Supplier Jakarta - Kran`
   - `TGR-PARANET — ...`
   - `MLG-MADU — ...`
5. Pilih `JKT-KRAN — Supplier Jakarta - Kran`
6. Pilih tipe Simple, harga 50000, HPP 30000
7. Simpan → redirect ke `/products`
8. Buka produk lagi (Edit) → dropdown menampilkan `JKT-KRAN` ter-select

### 3.2 Verifikasi DB
```sql
SELECT id, name, supplier_id FROM products WHERE name = 'Kran Air Test';
-- Expect: supplier_id = 1 (JKT-KRAN)
```

### 3.3 Disabled supplier handling
1. Buka `/settings/suppliers` → disable `MLG-MADU`
2. Buka `/products/new` → dropdown supplier
3. **Expect:** `MLG-MADU` tidak muncul di list
4. Buka produk yang sudah link ke `MLG-MADU` (kalau ada) → dropdown tetap menampilkan supplier itu dengan label `(disabled)` supaya user bisa tahu & ganti
5. Re-enable `MLG-MADU` di /settings/suppliers

**Pass:** Dropdown filter active + preserve link existing.

---

## Test 4 — Order ↔ Supplier Auto-Detect (5 menit)

**Tujuan:** Form order auto-set `origin_supplier_id` dan `is_multi_origin` dari produk yang dipilih.

### Setup
- Pastikan ada minimal 2 produk dengan supplier berbeda. Mis:
  - "Kran Air Test" → supplier JKT-KRAN
  - Buat satu lagi: "Madu Test" → supplier MLG-MADU

### 4.1 Single-supplier order
1. Login owner
2. Buka `/orders/new`
3. Isi customer minimal (nama, HP, alamat singkat — wilayah cascade boleh dummy)
4. Tambah 1 item: pilih produk "Kran Air Test", qty 1
5. Simpan → redirect ke `/orders/[id]`
6. **Expect di header:** Badge "Origin: JKT-KRAN" (warna violet) di samping status
7. Verifikasi DB:
   ```sql
   SELECT id, order_number, origin_supplier_id, is_multi_origin
   FROM orders ORDER BY id DESC LIMIT 1;
   -- Expect: origin_supplier_id = 1 (JKT-KRAN), is_multi_origin = false
   ```

### 4.2 Multi-supplier order
1. `/orders/new` lagi
2. Customer dummy
3. Tambah 2 item:
   - Item 1: produk "Kran Air Test" (JKT-KRAN), qty 1
   - Item 2: produk "Madu Test" (MLG-MADU), qty 1
4. Simpan → redirect ke detail
5. **Expect di header:** Badge "Multi-Origin Order" (warna amber)
6. Verifikasi DB:
   ```sql
   SELECT id, order_number, origin_supplier_id, is_multi_origin
   FROM orders ORDER BY id DESC LIMIT 1;
   -- Expect: origin_supplier_id = NULL, is_multi_origin = true
   ```

### 4.3 Order tanpa supplier
1. `/orders/new`
2. Tambah item dengan produk yang `supplier_id = NULL` (misal produk lama belum di-link)
3. Simpan
4. Verifikasi:
   ```sql
   -- Expect: origin_supplier_id = NULL, is_multi_origin = false
   ```
5. Header order detail: tidak ada badge supplier (cuma status badge).

**Pass:** Auto-detect logic correct untuk 3 skenario.

---

## Test 5 — Soft Disable Behavior (2 menit)

**Tujuan:** Disable supplier preserve data lama.

1. Login owner, buka `/settings/suppliers`
2. Disable `JKT-KRAN`
3. Verifikasi DB:
   ```sql
   SELECT id, name, active FROM suppliers WHERE code = 'JKT-KRAN';
   -- Expect: active = false (row tetap ada)

   SELECT id, name, supplier_id FROM products WHERE supplier_id = 1;
   -- Expect: produk lama tetap link ke id=1 (FK on delete SET NULL nggak fire untuk disable)

   SELECT id, order_number, origin_supplier_id FROM orders WHERE origin_supplier_id = 1;
   -- Expect: order lama tetap link ke supplier (disabled ≠ deleted)
   ```
4. Buka /products/new → dropdown supplier: `JKT-KRAN` tidak muncul lagi
5. Re-enable di /settings/suppliers → muncul kembali

**Pass:** Soft disable safe — tidak break FK, hanya hide dari dropdown.

---

## Test 6 — Sidebar Visibility (1 menit)

**Tujuan:** Entry "Suppliers" tampil di sidebar grup Master Data untuk semua role
(karena RLS SELECT permissive — form produk butuh dropdown ini).

1. Login owner → expand "Master Data" di sidebar → **Suppliers** tampil
2. Login admin → sama
3. Login cs → sama (read-only access via UI gating)
4. Login advertiser → sama
5. Login akunting → sama

**Pass:** Suppliers visible untuk 5 role.

---

## Test 7 — Build & Typecheck (1 menit)

```bash
npx tsc --noEmit
# Expect: exit 0, no errors

npm run build
# Expect: ✓ Compiled successfully
# /settings/suppliers ke-list di route output
```

---

## Acceptance Checklist (recap brief)

- [x] Migration 011 jalan tanpa error
- [x] Seed 3 supplier ter-insert
- [x] RLS aktif (4 policies)
- [x] `products.supplier_id` ada
- [x] `orders.origin_supplier_id` + `is_multi_origin` ada
- [x] `/settings/suppliers` accessible, CRUD jalan untuk owner/admin
- [x] Non-owner/admin: read-only via UI + RLS reject di DB
- [x] Form produk punya dropdown supplier functional
- [x] Form order auto-detect supplier dari produk
- [x] Multi-origin badge tampil di order detail
- [x] `npm run build` + `npx tsc --noEmit` pass
- [x] Sidebar entry "Suppliers" tampil

---

*Last updated: 2026-05-15 — Phase 8A v1.0*
