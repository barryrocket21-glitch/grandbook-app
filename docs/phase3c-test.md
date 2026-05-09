# Phase 3C — Manual Smoke Test

> Engine + UI yang dibangun di Phase 3C:
> - `src/lib/converter/engine-outbound.ts` — `generateOutbound()` (rows + Blob + filename), `buildOutboundRows()`, `markOrdersExported()`
> - `src/lib/converter/outbound-resolvers.ts` — `resolveSourceValue()`, `formatProductSummary()`, `computeTotalWeight()`, `concatFullAddress()`
> - `src/lib/converter/serializer.ts` — `serializeCsv/Xlsx/ForProfile()`, `downloadBlob()`, `suggestOutboundFilename()`
> - `src/lib/converter/preview.ts` — `previewOutbound()` thin wrapper
> - `/orders/export-resi` — 5-step UI (Filter → Profile → Preview → Generate → Done)
> - Migration `015_outbound_helpers.sql` — extend source enum + `mark_orders_exported` bulk RPC
>
> Migration 015 perlu di-apply sebelum testing (sudah auto-applied via
> `exec_sql` saat dev).

## 0. Pre-flight

- [ ] Migration 015 applied. Verifikasi RPC ada:
  ```sql
  SELECT proname FROM pg_proc WHERE proname='mark_orders_exported';
  ```
- [ ] Source enum di order_status_history meliputi 'outbound_export':
  ```sql
  SELECT pg_get_constraintdef(c.oid)
  FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid
  WHERE t.relname='order_status_history' AND c.conname='order_status_history_source_check';
  ```
- [ ] Profile outbound ada (Phase 1 seed):
  ```sql
  SELECT id, code, direction, channel_id FROM converter_profiles WHERE direction='OUTBOUND_TO_COURIER';
  ```
  Expect: 1 row `mengantar_outbound` linked ke channel JNE_VIA_MENGANTAR.
- [ ] Insert dummy orders SIAP_KIRIM untuk test (sesuai contoh di brief):
  ```sql
  INSERT INTO orders (
    organization_id, order_number, customer_name, customer_phone,
    customer_address_detail, customer_village, customer_subdistrict,
    customer_city, customer_province, customer_zip,
    payment_method, total, subtotal, shipping_cost,
    status, channel_id, notes, created_by
  ) VALUES
    (1, 'GB-TEST-OUT-001', 'Pak Abi', '081234500001',
     'Jl. Kebersamaan No. 55', 'Kebon Jeruk', 'Kebon Jeruk',
     'Jakarta Barat', 'DKI Jakarta', '11530',
     'COD', 159000, 100000, 15000,
     'SIAP_KIRIM',
     (SELECT id FROM courier_channels WHERE code='JNE_VIA_MENGANTAR'),
     'Hubungi sebelum kirim',
     (SELECT id FROM profiles WHERE role='owner' LIMIT 1)),
    (1, 'GB-TEST-OUT-002', 'Bu Lisa', '081234500002',
     'Komplek Permata Blok A No. 12', 'Pondok Pinang', 'Kebayoran Lama',
     'Jakarta Selatan', 'DKI Jakarta', '12310',
     'TRANSFER', 250000, 200000, 20000,
     'SIAP_KIRIM',
     (SELECT id FROM courier_channels WHERE code='JNE_VIA_MENGANTAR'),
     '',
     (SELECT id FROM profiles WHERE role='owner' LIMIT 1));

  INSERT INTO order_items (
    organization_id, order_id, product_name_raw, variation, qty, price, weight_per_unit
  ) VALUES
    (1, (SELECT id FROM orders WHERE order_number='GB-TEST-OUT-001'),
     'Baju Wanita', 'Hitam M', 1, 100000, 0.3),
    (1, (SELECT id FROM orders WHERE order_number='GB-TEST-OUT-002'),
     'Kaos Pria', 'Putih L', 2, 75000, 0.4),
    (1, (SELECT id FROM orders WHERE order_number='GB-TEST-OUT-002'),
     'Topi Snapback', 'Hitam', 1, 50000, 0.2);
  ```

## 1. Happy path UI flow

- [ ] Buka `/orders/export-resi` sebagai owner/admin → tampil step indicator + filter card
- [ ] **Step 1 — Filter:**
  - Channel dropdown menampilkan `Semua channel` + semua active channels
  - Status default `Siap Kirim`
  - Date range from/to bisa diisi (filter `order_date`)
  - Search box filter realtime by order#/customer/kota
  - Pilih channel `JNE_VIA_MENGANTAR` + status `SIAP_KIRIM` → tabel menampilkan 2 dummy orders
  - Centang select-all (header checkbox) → "2 dipilih"
  - Tombol "Lanjutkan (2 dipilih)" enabled
- [ ] **Step 2 — Profile:**
  - Dropdown profile cuma show OUTBOUND_TO_COURIER active (1 profile: Mengantar)
  - Pilih `mengantar_outbound` → klik Lanjut ke Preview
  - Mixed-channel warning TIDAK muncul (semua selection JNE_VIA_MENGANTAR)
- [ ] **Step 3 — Preview:**
  - Tampil tabel dengan 14 kolom Mengantar
  - Verify per row:
    - Nama Penerima: "Pak Abi" / "Bu Lisa"
    - Nomor Telepon: "6281234500001" / "6281234500002" (transform `phone_to_628`)
    - Berat: "0.3" / "1.0" (sum qty × weight, format kg 1 desimal)
    - Nilai COD (Jika COD): 159000 untuk Pak Abi, kosong untuk Bu Lisa
    - Harga Barang (Jika NON-COD): kosong untuk Pak Abi, 250000 untuk Bu Lisa
    - Isi Paketan: "1x Baju Wanita Hitam M" / "2x Kaos Pria Putih L, 1x Topi Snapback Hitam"
    - **Quantity: 1 / 3 (sum)
    - Courier: "JNE" (resolved via value_mapping JNE_VIA_MENGANTAR → JNE)
    - Formulir ID: order_number masing-masing
- [ ] **Step 4 — Generate:** klik tombol → progress bar → file CSV ter-download otomatis
  - Filename format: `mengantar_outbound_YYYYMMDD_HHMMSS.csv`
- [ ] **Step 5 — Done:**
  - "File berhasil di-generate" + filename
  - 4 stat cards (rows / dilewat / warning / error)
  - Pertanyaan card: "Otomatis update status 2 order dari SIAP_KIRIM ke DIKIRIM?"
  - Optional textarea "Catatan ekspor"
  - 2 tombol: [Selesai] / [Update Status & Selesai]

## 2. Verify file content

- [ ] Buka file CSV. Delimiter `;` (per profile setting). Encoding utf-8-sig — Excel auto-detect tanpa karakter aneh
- [ ] Header row pertama: 14 kolom Mengantar
- [ ] 2 data rows sesuai preview

## 3. Update Status path

- [ ] Pilih "Update Status & Selesai" (isi catatan misal "Batch test")
- [ ] Toast "2 order di-set DIKIRIM"
- [ ] Verify di DB:
  ```sql
  SELECT order_number, status FROM orders WHERE order_number LIKE 'GB-TEST-OUT-%';
  ```
  Expect: status DIKIRIM
- [ ] History entry source='outbound_export':
  ```sql
  SELECT to_status, source, source_profile_id, note
  FROM order_status_history
  WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'GB-TEST-OUT-%')
  ORDER BY id DESC LIMIT 4;
  ```
  Latest entry: source='outbound_export', note mengandung 'Outbound export via mengantar_outbound (mengantar_outbound_…csv) — Batch test'.

## 4. Selesai (skip status update) path

- [ ] Re-test: pilih "Selesai" tanpa update status → orders tetap SIAP_KIRIM (untuk re-export)

## 5. Mixed channels warning

- [ ] Insert dummy order dengan channel SPX_DIRECT (status SIAP_KIRIM)
- [ ] Step 1: status `Siap Kirim`, channel `Semua channel` → checklist ke 2 channel berbeda
- [ ] Step 2: warning "Mixed channels" muncul di profile picker
- [ ] Step 3: warning "Channel mismatch" muncul di preview (profile JNE vs selection juga punya SPX)
- [ ] User boleh tetap lanjut, file generate normally

## 6. Default weight fallback

- [ ] Hapus `weight_per_unit` dari satu item:
  ```sql
  UPDATE order_items SET weight_per_unit = NULL
  WHERE order_id = (SELECT id FROM orders WHERE order_number='GB-TEST-OUT-001');
  ```
- [ ] Re-jalankan flow → preview "Berat" untuk Pak Abi: "1.0" (1 unit × default 1kg)
- [ ] Warning section tampil pesan: "weight_per_unit kosong di sebagian item — pakai default 1 kg/unit"

## 7. XLSX format

- [ ] Edit profile `mengantar_outbound` → ubah file_format ke XLSX → save
- [ ] Re-jalankan flow → unduhan jadi `.xlsx`
- [ ] Buka di Excel/LibreOffice → header + data tampak benar

## 8. Edge cases

- [ ] 0 order dipilih → tombol "Lanjutkan" disabled
- [ ] 0 profile aktif outbound → dropdown disabled, info "Tidak ada profile outbound aktif"
- [ ] Pilih order yang udah dihapus / di luar org (id manual) → masuk `errors`, tidak crash batch
- [ ] Profile bukan OUTBOUND_TO_COURIER → engine throw error
- [ ] Field mapping dengan source_field tidak dikenali → output kosong + warning per order
- [ ] Re-generate file 2x dari selection sama → file ke-2 sama persis (kecuali timestamp di filename)
- [ ] Mark DIKIRIM ke-2 kali → RPC return 0 (status sudah DIKIRIM, no-op), no extra history row

## 9. Build / type check

- [ ] `npx tsc --noEmit` → no errors
- [ ] `npm run build` → success, `/orders/export-resi` ke-list di route output

## 10. Sidebar nav

- [ ] Sidebar group "Orders" memiliki entry "Export ke Ekspedisi" → `/orders/export-resi`
- [ ] Visible untuk semua role (consistency dengan children Orders lain). Permission check di page (`canApproveOrders`) — non-owner/admin lihat empty state.

## Catatan

- Engine support **direction=OUTBOUND_TO_COURIER only**. INBOUND_ORDER + WA_PASTE → `engine.ts` (Phase 3A); INBOUND_REKONSIL → `engine-rekonsil.ts` (Phase 3B).
- `previewOutbound()` adalah thin wrapper di atas `buildOutboundRows(orderIds.slice(0, max))`. Tidak ada DB write — tabel orders di-read tapi engine baru menulis kalau user klik Generate (full build) + opsional `markOrdersExported`.
- `mark_orders_exported` RPC bulk-update orders + patch row history terakhir per order. Per-row no-op kalau status sudah cocok. Pattern konsisten dengan `update_order_from_rekonsil` dari Phase 3B.
- Computed source_field yang di-support engine (di `outbound-resolvers.ts`):
  - `order_items.total_qty`, `total_weight`, `total_price`, `product_summary`, `product_names`, `count`, `first_product_name`, `first_product_variation`
  - `channel_courier_code`, `channel_aggregator`, `channel_name`
  - `total_if_cod`, `total_if_transfer`, `cod_amount_or_empty`
  - `concat_address` (computed full alamat — handy untuk profile yang minta single string)
  - `meta.<key>` → orders.meta JSON value
  - lainnya → direct column dari orders
- Default weight fallback: 1 kg per unit kalau `weight_per_unit` null/0, dengan warning per order.
- Order operasi per-field: `resolveSourceValue` → value mapping → transform. Konsisten dengan engine inbound (3A) dan rekonsil (3B).
- File CSV pakai UTF-8 BOM kalau `profile.file_encoding='utf-8-sig'`. Mengantar profile sudah di-set begitu.
- Tidak overlap dengan `/orders/bulk-upload` (inbound). Outbound = export-out, bulk-upload = import-in.
