# Phase 2B — Manual Smoke Test

> Halaman yang dibuat di Phase 2B:
> - `/settings/converter-profiles` (list + create/edit basic)
> - `/settings/converter-profiles/[id]` (detail editor — 3 tabs)
> - `/inbox/unmatched-resi`
> - `/inbox/unmapped-statuses`
>
> Sebelum mulai test, pastikan:
> - Phase 1 + Phase 2A sudah jalan (3 converter profiles + master data ter-seed)
> - Login pakai owner@grandbook.com untuk full akses

---

## 1. Converter Profiles — List & Basic CRUD

### Permissions & visibility
- [ ] Login owner — sidebar menampilkan "Master Data → Converter Profiles" + "Inbox → Unmatched Resi / Unmapped Statuses"
- [ ] Login cs — sidebar tetap show "Master Data → Converter Profiles" (read-only). "Inbox" tidak muncul (owner/admin only)
- [ ] Buka `/settings/converter-profiles` sebagai owner → 3 profile pre-seed muncul (orderonline_inbound / spx_financial_rekonsil / mengantar_outbound)
- [ ] Tombol "Tambah Profile" muncul untuk owner/admin, tidak muncul untuk cs

### List & filter
- [ ] Filter by Direction → INBOUND_ORDER → cuma 1 profile (orderonline_inbound)
- [ ] Filter by Direction → INBOUND_REKONSIL → cuma 1 profile (spx_financial_rekonsil)
- [ ] Filter by Channel → SPX_DIRECT → cuma profile yang link ke channel itu
- [ ] Search "orderonline" → match
- [ ] Toggle "Tampilkan tidak aktif" — kalau ada profile inactive, dia muncul

### Create profile
- [ ] Klik "Tambah Profile" → dialog terbuka
- [ ] Isi:
  - code: `lincah_outbound_test`
  - name: `Lincah (Test Export)`
  - direction: `OUTBOUND_TO_COURIER`
  - source/target: `lincah`
  - channel: pilih JNE_VIA_MENGANTAR (atau channel apa pun)
  - file_format: `CSV`
  - delimiter: `;`
  - encoding: `utf-8-sig`
- [ ] Submit → toast "Profile ditambahkan" + redirect ke `/settings/converter-profiles/[id]`

### Validasi field-level
- [ ] Saat direction = WA_PASTE, regex_pattern field tampil dan required
- [ ] Saat direction = INBOUND_REKONSIL atau OUTBOUND_TO_COURIER, channel_id required (validasi gagal kalau kosong)
- [ ] Saat direction = INBOUND_ORDER, channel optional
- [ ] Saat file_format != CSV, delimiter field disabled

### Edit basic
- [ ] Klik pencil di profile yang ada → form pre-fill
- [ ] Code field disabled (tidak boleh diubah)
- [ ] Ubah name → save → list ke-update

### Disable / Enable
- [ ] Klik power icon → konfirmasi → toast + status berubah ke Nonaktif
- [ ] Klik lagi → reactivate

---

## 2. Converter Profile Detail Editor

Buka `/settings/converter-profiles/[id]` profile orderonline_inbound (15 fields, 1+ value mappings dari seed).

### Header & navigasi
- [ ] Tombol "Kembali" → balik ke list
- [ ] Header tampil: code, name, direction badge, status badge, source/target, channel (kalau ada), format, header row index

### Tab 1: Field Mappings
- [ ] Tab Field Mappings menampilkan 15 rows (untuk orderonline_inbound seed)
- [ ] Order column menampilkan display_order + tombol up/down
- [ ] Klik up arrow di field order ke-2 → row swap dengan order ke-1, display_order ke-update di DB
- [ ] Klik "Tambah Field Mapping":
  - source_field: `test_source`
  - target_field: `test_target`
  - target_table: `orders`
  - transform: pilih `uppercase` dari combobox
  - required: ✓
  - submit → toast "Field mapping ditambahkan" + row baru muncul di bottom
- [ ] Edit row baru → ubah notes → save
- [ ] Hapus row baru → confirm → row hilang

### Bulk copy field mappings
- [ ] Tab Field Mappings → klik "Salin dari Profile Lain"
- [ ] Pilih source `spx_financial_rekonsil` → klik Salin
- [ ] Toast "X field mappings ter-copy" — yang sudah ada di-skip
- [ ] List bertambah dengan field mappings dari spx (yang source_field-nya tidak collide)

### Tab 2: Value Mappings
- [ ] Tab Value Mappings menampilkan value mappings yang sudah ada
- [ ] Tambah baru:
  - source_field: `test_field`
  - raw_value: `xxx`
  - mapped_value: `XXX`
  - submit → row muncul
- [ ] Coba tambah duplicate (source_field+raw_value sama) → toast error "sudah ada"
- [ ] Edit → ubah mapped_value
- [ ] Hapus → confirm → row hilang

### Tab 3: Test Parser
- [ ] Buka tab Test Parser di profile `orderonline_inbound`
- [ ] Klik "Pilih File" → upload sample CSV Orderonline (test data, header row 1, comma delimited, 5+ rows)
- [ ] Klik "Parse Preview"
- [ ] Hasil: 3 rows pertama tampil dengan grouping orders / order_items / meta / file_column
- [ ] Verifikasi transform jalan:
  - phone "628..." → "08..." (normalize_phone_id)
  - "06-05-2026 - 23:58" → ISO date (parse_date_dd-mm-yyyy)
  - "cod" → "COD" (value mapping + uppercase transform)
- [ ] Switch ke profile `spx_financial_rekonsil` → Test Parser → upload XLSX dengan grouped header (header row index 2) → preview tampil
- [ ] Profile dengan direction OUTBOUND_TO_COURIER → Tab Test Parser tampil placeholder "akan tersedia di Phase 3"
- [ ] (Opsional) Profile WA_PASTE — paste sample text → preview tampil

### Edge cases preview
- [ ] Upload file invalid (PDF / image) → error message friendly
- [ ] File CSV tanpa header sesuai field mapping → warnings "transform xxx gagal"
- [ ] Field mapping required tapi raw kosong → warning "required field xxx kosong"

---

## 3. Inbox Unmatched Resi

Inbox baru terisi otomatis di Phase 3. Untuk smoke test Phase 2B, **insert manual via Supabase SQL Editor**:

```sql
-- Pastikan ada profile dulu
INSERT INTO inbox_unmatched_resi (organization_id, source_profile_id, raw_resi, raw_data)
VALUES
(1, (SELECT id FROM converter_profiles WHERE code='spx_financial_rekonsil'),
 'SPXID039841234567', '{"receiver_name":"Mantri Wahyu","amount":157350}'::jsonb),
(1, (SELECT id FROM converter_profiles WHERE code='spx_financial_rekonsil'),
 'SPXID039841234568', '{"receiver_name":"Andi Susanto","amount":89000}'::jsonb);
```

### List & filter
- [ ] Buka `/inbox/unmatched-resi` → 2 rows muncul
- [ ] Badge "X belum resolved" tampil di header
- [ ] Filter "Belum resolved" (default) → 2 rows
- [ ] Filter "Sudah resolved" → 0 rows
- [ ] Filter "Semua" → 2 rows
- [ ] Filter by source profile → match
- [ ] Search "SPXID039841234567" → 1 row

### Resolve dialog
- [ ] Klik tombol "Resolve" di row pertama → dialog terbuka
- [ ] Header tampil resi raw + source profile + created
- [ ] Expand "Lihat raw data" → JSON tampil
- [ ] Pilih radio "Abaikan" → klik Konfirmasi → toast "Resi diabaikan", row jadi resolved (resolution=ignored)
- [ ] Klik "Resolve" di row kedua → pilih "Link ke order existing"
  - Ketik order number / nama customer di search box
  - Klik tombol search
  - Hasil order muncul (jika tabel orders ada data Phase 4 nanti). Phase 2B tabel orders kosong — toast "Tidak ada order match"
  - Untuk testing penuh, manual insert order via SQL dulu, lalu coba pick + konfirmasi
- [ ] Klik "Resolve" di row ketiga (insert lagi via SQL kalau perlu) → pilih "Buat order baru"
  - Klik Konfirmasi → toast info "Inbox di-clear, fitur create order akan tersedia di Phase 4"
  - Row jadi resolved (resolution=created_new)

---

## 4. Inbox Unmapped Statuses

Insert manual:

```sql
INSERT INTO inbox_unmapped_statuses (organization_id, channel_id, raw_status, occurrence_count)
VALUES
(1, (SELECT id FROM courier_channels WHERE code='SPX_DIRECT'),
 'In Transit to Sortation Hub', 12),
(1, (SELECT id FROM courier_channels WHERE code='SPX_DIRECT'),
 'Failed Delivery Attempt', 3);
```

### List & sort
- [ ] Buka `/inbox/unmapped-statuses` → 2 rows muncul
- [ ] Badge "X belum mapped" di header
- [ ] Default sort by occurrence_count DESC → "In Transit to Sortation Hub" (12) di atas
- [ ] Occurrence > 10 → badge merah ("In Transit..."), occurrence ≤ 10 → badge zinc/abu

### Filter
- [ ] Filter "Belum mapped" (default) → 2 rows
- [ ] Filter by channel → match

### Map status
- [ ] Klik "Map" di row "Failed Delivery Attempt" → dialog terbuka
- [ ] Header read-only: channel + raw status
- [ ] Pilih internal status `PROBLEM` → klik "Map status ini"
- [ ] Toast "Status xxx → PROBLEM ter-mapping"
- [ ] Row jadi resolved (badge Resolved, Mapped To: Problem)
- [ ] Cek `/settings/status-mapping` → row baru "Failed Delivery Attempt → PROBLEM" muncul untuk SPX_DIRECT

### Edge case: mapping sudah ada
- [ ] Insert manual lagi raw status yang sudah ada di courier_channel_statuses (misal "Delivered" untuk SPX yang sudah di-seed)
- [ ] Map ke DITERIMA → toast warning "Mapping sudah ada sebelumnya"
- [ ] Inbox row tetap di-resolve (idempotent)

### Abaikan
- [ ] Insert lagi
- [ ] Klik "Map" → klik "Abaikan untuk sekarang" → row resolved tanpa insert mapping

---

## 5. Sidebar

- [ ] Group "Master Data" expand → 6 items: Couriers / Channels / Rates / Status Mapping / Converter Profiles / Master Wilayah
- [ ] Group "Inbox" muncul (sebagai owner/admin) → 2 items: Unmatched Resi / Unmapped Statuses
- [ ] Klik "Converter Profiles" → ke `/settings/converter-profiles`
- [ ] Klik "Unmatched Resi" → ke `/inbox/unmatched-resi`
- [ ] Klik "Unmapped Statuses" → ke `/inbox/unmapped-statuses`
- [ ] Login cs → group "Inbox" tidak muncul

---

## 6. Build / Type check

- [ ] `npx tsc --noEmit` → no errors
- [ ] `npm run build` → success
- [ ] No console errors saat browse pages

---

## Catatan
- Inbox tables baru auto-isi setelah Phase 3 Converter Engine jalan. Phase 2B testing pakai manual insert via SQL.
- "Buat order baru" di Unmatched Resi adalah **stub** — Phase 2B cuma update inbox.resolution=created_new tanpa benar-benar bikin order. Phase 4 (Form Input Order) akan implement.
- "Link ke order" full functional, tapi saat tabel orders masih kosong (Phase 1 wipe), pencarian akan return 0. Insert order dummy via SQL dulu untuk test path ini.
- OUTBOUND parser preview belum diimplementasi (per brief, placeholder OK).
