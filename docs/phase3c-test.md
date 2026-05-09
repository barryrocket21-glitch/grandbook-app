# Phase 3C — Manual Smoke Test

> Engine + UI yang dibangun di Phase 3C:
> - `src/lib/converter/engine-outbound.ts` — `buildOutbound()`, `generateCsv/Xlsx()`, `markOrdersExported()`
> - `src/lib/converter/preview.ts` — `previewOutbound()` (thin wrapper)
> - `/orders/outbound` — multi-step UI (profile → pilih order → preview → generate)
> - Migration `015_outbound_helpers.sql` — extend source enum + bulk RPC
>
> Migration 015 perlu di-apply sebelum testing (sudah auto-applied via
> `exec_sql` saat dev).

## 0. Pre-flight

- [ ] Migration 015 applied. Verifikasi RPC ada:
  ```sql
  SELECT proname FROM pg_proc WHERE proname='mark_orders_exported';
  ```
- [ ] Source enum di order_status_history meliputi 'converter_outbound':
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
- [ ] (Optional) Insert dummy orders SIAP_KIRIM untuk test:
  ```sql
  INSERT INTO orders (
    organization_id, order_number, customer_name, customer_phone,
    customer_address_detail, customer_zip, payment_method, total, cod_amount,
    subtotal, status, channel_id, notes, created_by
  ) VALUES
    (1, 'GB-TEST-O001', 'Pak Budi', '08123456789', 'Jl Mawar 12 RT01/02', '12345',
      'COD', 150000, 150000, 100000, 'SIAP_KIRIM',
      (SELECT id FROM courier_channels WHERE code='JNE_VIA_MENGANTAR'),
      'titip dititipin tetangga', auth.uid()),
    (1, 'GB-TEST-O002', 'Bu Sari', '628987654321', 'Jl Melati 5', '54321',
      'TRANSFER', 200000, NULL, 180000, 'SIAP_KIRIM',
      (SELECT id FROM courier_channels WHERE code='JNE_VIA_MENGANTAR'),
      NULL, auth.uid());

  -- + 1 item per order
  INSERT INTO order_items (organization_id, order_id, product_name_raw, qty, price, weight_per_unit)
  SELECT 1, id, 'Kaos Polos', 2, 50000, 0.3 FROM orders WHERE order_number='GB-TEST-O001';
  INSERT INTO order_items (organization_id, order_id, product_name_raw, variation, qty, price, weight_per_unit)
  SELECT 1, id, 'Topi', 'Hitam', 1, 90000, 0.2 FROM orders WHERE order_number='GB-TEST-O002';
  ```

## 1. Outbound UI happy path (single profile, CSV)

- [ ] Buka `/orders/outbound` sebagai owner/admin → tampil
- [ ] Step 1: dropdown profile cuma show OUTBOUND_TO_COURIER active (1 profile: Mengantar)
- [ ] Pilih `mengantar_outbound` → klik Lanjut
- [ ] Step 2: muncul order list filtered by channel JNE_VIA_MENGANTAR + status=SIAP_KIRIM
- [ ] Filter status bisa diubah ke "Baru" atau "Eligible (SIAP_KIRIM + BARU)"
- [ ] Search by order#, customer name, atau kota → filter realtime
- [ ] Centang 2-5 order pakai checkbox (atau header checkbox = select-all-filtered)
- [ ] Klik "Preview N Order"
- [ ] Step 3: tabel preview tampil header sesuai profile (Nama Penerima, Alamat Penerima, Nomor Telepon, Berat, dll.) dengan max 5 row
- [ ] Verify computed fields:
  - "Berat" = qty * weight_per_unit, format kg (e.g. `0.6` untuk 2 × 0.3kg)
  - "Quantity" = sum(qty)
  - "Isi Paketan (Nama Produk)" = "Kaos Polos x2" atau "Topi (Hitam) x1"
  - "Harga Barang (Jika NON-COD)" kosong untuk COD orders, isi total untuk TRANSFER
  - "Nilai COD (Jika COD)" sebaliknya
  - "Courier" = "JNE" (resolved via value_mapping JNE_VIA_MENGANTAR → JNE)
  - "Nomor Telepon" prefixed `628` (transform phone_to_628)
- [ ] Klik "Generate & Unduh" → file CSV otomatis terunduh dengan name `mengantar_outbound_YYYYMMDD_HHMM.csv`
- [ ] Step 5: 4 stat cards (diproses / dilewat / warning / error) + filename + button "Lihat Daftar Order"

## 2. Verify file content

- [ ] Buka file CSV. Delimiter `;` (per profile setting). Encoding UTF-8 dengan BOM (Excel detect dengan benar).
- [ ] Header row pertama: 14 kolom sesuai profile.
- [ ] Data row sesuai dengan preview.

## 3. Mark as DIKIRIM (optional)

- [ ] Re-jalankan flow dengan checkbox "Setelah generate, set status order ke DIKIRIM" centang
- [ ] Step 5 menampilkan "Status update: N order di-set DIKIRIM"
- [ ] Verify di DB:
  ```sql
  SELECT order_number, status FROM orders WHERE order_number IN ('GB-TEST-O001','GB-TEST-O002');
  ```
  Expect: status DIKIRIM
- [ ] History entry source='converter_outbound':
  ```sql
  SELECT to_status, source, source_profile_id, note
  FROM order_status_history
  WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'GB-TEST-O%')
  ORDER BY id DESC LIMIT 4;
  ```
  Latest entry: source='converter_outbound', note mengandung 'Outbound export via mengantar_outbound'.

## 4. XLSX format

- [ ] Edit `mengantar_outbound` profile → ubah file_format ke XLSX → save
- [ ] Re-jalankan flow → unduhan jadi `.xlsx`
- [ ] Buka di Excel/LibreOffice → header + data tampak benar

## 5. Edge cases

- [ ] Pilih order tanpa items → preview rows tetap muncul dengan computed fields kosong/0 (sum=0, product_summary=''), warning di list
- [ ] Pilih order dengan customer_phone null → row warning "required field 'Nomor Telepon' kosong" tapi tetap masuk row
- [ ] orderIds yang udah dihapus / di luar org → masuk errors, tidak crash batch
- [ ] Profile bukan OUTBOUND_TO_COURIER → engine throw error
- [ ] Field mapping dengan source_field tidak dikenali (e.g. salah ketik `cusotmer_name`) → output kosong + warning per order
- [ ] 0 order dipilih → tombol Preview disabled

## 6. Idempotency / re-run

- [ ] Generate file 2x dari order yang sama → file ke-2 sama persis (kecuali timestamp di filename)
- [ ] Mark DIKIRIM ke-2 kali → RPC return 0 (status sudah DIKIRIM, no-op), no extra history row
- [ ] Status sudah DIKIRIM → masih bisa di-pick di filter "BARU + SIAP_KIRIM" karena udah bukan eligible. Pakai filter SIAP_KIRIM saja (default) → list bersih.

## 7. Build / type check

- [ ] `npx tsc --noEmit` → no errors
- [ ] `npm run build` → success, `/orders/outbound` ke-list di route output

## 8. Sidebar nav

- [ ] Sidebar group "Orders" memiliki entry "Export Outbound" → `/orders/outbound`
- [ ] Visible untuk semua role (consistency dengan children Orders lain). Permission check di page (`canApproveOrders`) — non-owner/admin lihat empty state.

## Catatan

- Engine support **direction=OUTBOUND_TO_COURIER only**. INBOUND_ORDER + WA_PASTE → `engine.ts` (Phase 3A); INBOUND_REKONSIL → `engine-rekonsil.ts` (Phase 3B).
- `previewOutbound()` adalah thin wrapper di atas `buildOutbound(orderIds.slice(0, maxRows))`. Tidak ada DB write — tabel orders di-read tapi engine baru menulis kalau user klik Generate (full build) + opsional `markOrdersExported`.
- `mark_orders_exported` RPC bulk-update orders + patch row history terakhir per order. Per-row no-op kalau status sudah cocok. Pattern konsisten dengan `update_order_from_rekonsil` dari Phase 3B.
- Computed source_field yang di-support engine:
  - `order_items.total_qty`, `total_weight`, `total_price`, `product_summary`, `product_names`, `count`, `first_product_name`, `first_product_variation`
  - `channel_courier_code`, `channel_aggregator`, `channel_name`
  - `total_if_cod`, `total_if_transfer`, `cod_amount_or_empty`
  - `meta.<key>` → orders.meta JSON value
  - lainnya → direct column dari orders
- File CSV pakai UTF-8 BOM (`﻿`) di awal supaya Excel auto-detect encoding dengan benar untuk karakter non-ASCII (e.g. nama orang dengan diacritic).
- Tidak overlap dengan `/orders/bulk-upload` (inbound). Outbound = export-out, bulk-upload = import-in.
