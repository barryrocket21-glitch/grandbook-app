# Phase 3A — Manual Smoke Test

> Halaman yang dibangun/refactor di Phase 3A:
> - `/orders/bulk-upload` (refactor)
> - `/orders/wa-paste` (baru)
> - `/orders/new` (refactor)
> - `/orders/[id]` (refactor — 4 tabs)
> - `/orders/list` (refactor)
> - `/inbox/pending-review` (baru)
>
> Sebelum mulai test, pastikan:
> - Migration `012_order_number_generator.sql` sudah di-run di Supabase
> - Phase 1/2A/2B sudah jalan (master data + 3 converter profiles)
> - Login pakai owner@grandbook.com untuk full akses

## 0. Pre-flight

- [ ] Run migration 012 via Supabase SQL Editor:
  ```sql
  -- Paste content of src/lib/supabase/migrations/012_order_number_generator.sql
  ```
- [ ] Verifikasi 2 fungsi terinstall:
  ```sql
  SELECT proname FROM pg_proc WHERE proname IN ('generate_order_number', 'update_order_status');
  -- Expect 2 rows
  ```

## 1. Engine Inbound (via Bulk Upload UI)

### 1.1 Happy path
- [ ] Login owner → buka `/orders/bulk-upload`
- [ ] Step 1: pilih profile `orderonline_inbound` → klik Lanjut
- [ ] Step 2: upload sample CSV Orderonline (39 rows) → klik Preview
- [ ] Step 3: preview tampil 5 rows, transforms applied (phone normalized, dates parsed, "cod" → "COD"), warning < 5
- [ ] Step 3: checkbox "skip review" tercentang (admin default)
- [ ] Klik "Lanjutkan Import 39 order"
- [ ] Step 4: progress bar berjalan, total 39
- [ ] Step 5: report shows 39 berhasil, 0 duplicate, 0 error
- [ ] Klik "Lihat Order" → redirect ke `/orders/list`
- [ ] List menampilkan 39 order dengan status SIAP_KIRIM (skip review aktif)

### 1.2 Duplicate detection
- [ ] Upload file yang sama persis lagi
- [ ] Report: 0 berhasil, 39 duplicate (skip)

### 1.3 Error per-row
- [ ] Edit CSV: hapus nama customer di row 1
- [ ] Upload → preview muncul warning required field
- [ ] Submit → 38 berhasil, 0 duplicate, 1 error
- [ ] Klik "Lihat detail error" → reason "customer_name kosong (required)"

### 1.4 Status default: BARU vs SIAP_KIRIM
- [ ] Logout, login dengan role CS (`andi@cs.test`)
- [ ] Upload file → checkbox "skip review" TIDAK muncul (cs tidak bisa)
- [ ] Submit → semua order masuk dengan status BARU
- [ ] Tombol "Lihat Order" → redirect ke `/inbox/pending-review`

## 2. WA Paste

- [ ] Login owner → buka `/orders/wa-paste`
- [ ] Profile dropdown: pilih profile dengan direction=WA_PASTE (atau bikin dulu di Settings → Converter Profiles)
- [ ] Paste sample WA chat (3 blocks) → klik Preview Block
- [ ] Preview tampil 3 block detected
- [ ] Klik Import 3 order → success
- [ ] Cek `/orders/list` → 3 order baru dengan status SIAP_KIRIM (skip review)

### 2.1 Empty / invalid
- [ ] Paste teks random tanpa pattern match → preview: 0 blocks, warning regex tidak punya named groups (kalau profile pakai pattern tanpa group)
- [ ] Empty text → tombol Preview disabled

## 3. Manual Form Input (`/orders/new`)

### 3.1 Customer cascade
- [ ] Pilih provinsi "JAWA BARAT" → city dropdown ter-populate
- [ ] Pilih city "BANDUNG" → kecamatan ter-populate
- [ ] Pilih kecamatan → kelurahan ter-populate (≤1000 rows)
- [ ] Pilih kelurahan → kode pos auto-fill
- [ ] Badge "Match: id #xxxxx" muncul di samping kode pos
- [ ] Ubah provinsi → city/kecamatan/kelurahan ter-reset

### 3.2 Skip cascade
- [ ] Kosongkan kelurahan → submit → toast warning "Kombinasi alamat tidak dikenal" tapi tetap saved
- [ ] Wilayah_id NULL di order

### 3.3 Multi-item
- [ ] Klik "Tambah Item" → row baru muncul
- [ ] Tambah 3 items → submit
- [ ] Cek `/orders/[id]` → tab Items shows 3 items

### 3.4 Status default
- [ ] Submit sebagai admin → status SIAP_KIRIM
- [ ] Submit sebagai cs → status BARU, redirect ke `/orders/[id]`

### 3.5 Order number
- [ ] Order baru punya order_number format `GB-YYYYMMDD-NNNNNN` (e.g. GB-20260509-000001)
- [ ] 2 order pada hari yang sama → counter increment

## 4. Pending Review Inbox (`/inbox/pending-review`)

- [ ] Sebagai owner/admin: list orders dengan status BARU
- [ ] Filter by source profile, channel, search by order# / customer
- [ ] Single approve: klik Check → status berubah SIAP_KIRIM, hilang dari list
- [ ] Bulk approve: select 5 orders → klik "Approve 5" → 5 jadi SIAP_KIRIM
- [ ] Reject FAKE: klik X di row → dialog reason → submit → status FAKE, history shows reason
- [ ] Reject PROBLEM: bulk select → "Tandai PROBLEM" → reason → submit → semua jadi PROBLEM dengan reason
- [ ] Sebagai cs (non-admin): redirect message "tidak bisa akses approval inbox"

## 5. Order Detail (`/orders/[id]`)

- [ ] Tab Info: customer block + pengiriman block + people block + notes block
- [ ] Tab Items: tabel items + subtotal summary
- [ ] Tab Timeline: minimal 1 entry (BARU created), reverse chronological, ada from→to badge
- [ ] Tab Audit: timestamps, external_order_id, raw_data collapsible

### 5.1 Edit Status (admin)
- [ ] Klik "Edit Status" → pilih status baru → note → submit
- [ ] Status berubah, entry baru muncul di Timeline dengan source "manual"

### 5.2 Edit Order (admin)
- [ ] Klik "Edit Order" → form pre-fill dengan customer + items existing
- [ ] Ubah ongkir, save → status tidak berubah, total ter-update

## 6. Orders List (`/orders/list`)

- [ ] Tabel orders descending by created_at, limit 500
- [ ] Filter by status, channel, search
- [ ] Status counter di filter (e.g. "Baru (5), Siap Kirim (32)")
- [ ] Click order_number → ke detail page
- [ ] Query string `?status=BARU` → filter pre-applied

## 7. Sidebar

- [ ] Group Orders: 4 sub-items (Input Order Baru, Upload Massal, WA Paste, Daftar Order)
- [ ] Group Inbox (owner/admin): 3 sub-items (Pending Review, Unmatched Resi, Unmapped Statuses)

## 8. Build

- [ ] `npx tsc --noEmit` → pass
- [ ] `npm run build` → pass, semua 7 routes baru ke-list

## 9. Catatan

- Engine support **INBOUND_ORDER** dan **WA_PASTE**. INBOUND_REKONSIL dan OUTBOUND_TO_COURIER belum (Phase 3B/3C).
- Auto-create user dari `cs_name` belum diimplementasi (per brief — admin manual via /settings/users untuk link cs_id).
- "Edit & Approve" di pending review dibikin sebagai navigate ke `/orders/[id]` lalu klik "Edit Order" — tidak ada inline edit di list page (consistency dengan detail page edit mode).
- Race condition order number: function loop sampai 50 attempts mencari unique number per org. Aman untuk concurrent insert.
