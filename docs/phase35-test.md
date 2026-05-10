# Phase 3.5 — Polish (UX & Bug Fixes) — Manual Smoke Test

> Phase 3.5 fokus ke 4 bug UX yang ditemui setelah pakai sistem real:
> #2 wilayah cascade keyboard flow, #3 cross-OS dropdown, #4 label vs ID display, #5 empty-state hint.
> Bug #1 (analytics) di-defer ke Phase 4 — hanya update banner saja.

## 0. Pre-flight

- [ ] Branch `phase-3.5-polish` deployed di Vercel preview
- [ ] Login sebagai owner

## 1. Bug #2 — Wilayah Cascade UX (auto-open + auto-search)

- [ ] Buka `/orders/new`
- [ ] **Tab** ke field Provinsi (jangan klik) → popover auto-open + search input auto-focused
- [ ] Ketik `jak` (tanpa klik dulu) → list filtered ke "DKI Jakarta"
- [ ] **↓** + **Enter** → "DKI Jakarta" terpilih, popover close
- [ ] **Tab** → fokus pindah ke Kota — popover auto-open
- [ ] Ketik `jakarta` → list filtered, pilih → **Tab** → Kecamatan, dst. (flow mulus tanpa click)
- [ ] **Esc** di tengah popover open → tutup, focus return ke trigger button
- [ ] **Edge case:** habis pilih item, focus return ke trigger — popover **tidak** boleh re-open otomatis (skip-next-auto-open guard)

Verify state akhir: kelurahan dipilih → ZIP auto-fill → "Wilayah Match: id #..." muncul.

## 2. Bug #3 — Cross-OS Dropdown Rendering

Test di **Mac Safari** dan **Mac Chrome** (Windows Chrome opsional kalau ada akses):

- [ ] `/orders/new` Channel dropdown — buka, scroll, pilih channel
- [ ] `/orders/export-resi` Channel filter (Step 1) — buka, scroll
- [ ] `/orders/list` Channel filter — buka panjang (kalau ada banyak channel)
- [ ] Visual:
  - Scrollbar visible saat list panjang (sebelumnya `no-scrollbar` hide; sekarang standard `overflow-y-auto`)
  - Item text ke-cut benar (no overflow horizontal)
  - Popover di atas semua elemen lain (z-50 + isolate)
  - Animation slide masuk smooth
- [ ] Tidak ada glitch z-index (popover di belakang Card / sidebar)

## 3. Bug #4 — Display Label (label name, bukan ID/angka)

Test setiap dropdown — pilih item, lalu cek trigger button menampilkan **nama** (bukan ID numeric):

| Page | Dropdown | Expect trigger label |
|---|---|---|
| `/orders/new` | Channel Ekspedisi | "SPX_DIRECT — SPX (Direct)" |
| `/orders/new` | Advertiser | "Nama Advertiser" |
| `/orders/bulk-upload` | Profile | "Orderonline (Order Baru) (orderonline_inbound)" |
| `/orders/wa-paste` | Profile | "Nama profile (kode)" |
| `/orders/export-resi` Step 2 | Profile Outbound | "Mengantar (Export ke JNE) (mengantar_outbound)" |
| `/orders/export-resi` Step 1 | Channel filter | "JNE_VIA_MENGANTAR" (atau "Semua channel") |
| `/orders/list` | Channel filter | "SPX_DIRECT" (kode channel) |
| `/reconciliation/upload` | Profile | "SPX (Financial Report) (spx_financial_rekonsil)" |
| `/inbox/pending-review` | Channel filter | code channel |
| `/inbox/pending-review` | Source filter | code profile |
| `/inbox/unmatched-resi` | Source Profile | code profile |
| `/inbox/unmapped-statuses` | Channel | code channel |
| `/settings/courier-channels` | Courier filter | code courier |
| `/settings/courier-rates` | Channel filter | code channel |
| `/settings/status-mapping` | Channel filter | code channel |
| `/settings/converter-profiles` | Channel filter | code channel |
| `/settings/converter-profiles` | Direction filter | "Inbound Order" (label DIRECTION_LABEL) |
| `/settings/converter-profiles/[id]` | "Salin dari Profile Lain" → Source | "code — name" |

Repro yang seharusnya **tidak** terjadi lagi: trigger button menampilkan "1" / "2" / UUID.

## 4. Bug #5 — Empty State Hint

Pre: pastikan tabel `profiles` tidak punya user dengan role `advertiser` (atau filter active=false).

- [ ] Buka `/orders/new`
- [ ] Klik dropdown **Advertiser** (atau Tab fokus ke trigger)
- [ ] Popover tampil empty hint:
  ```
  📦 Belum ada advertiser terdaftar.
     + Tambah di Pengaturan Users   ← link ke /settings/users
  ```
- [ ] Klik link → navigate ke `/settings/users`

Test pattern serupa di Channel kalau `courier_channels` kosong:
- [ ] Hint: "Belum ada channel ekspedisi terdaftar." + link ke `/settings/courier-channels`

## 5. Bug #1 — Analytics Banner

- [ ] Buka `/analytics`
- [ ] Banner placeholder tampil:
  - Phase: **Phase 4 (Commission Engine v2 + Analytics Revamp)**
  - Description: "Analytics akan di-rebuild di Phase 4 dengan rate snapshot per order, breakdown per CS/Advertiser, dan integrasi commission engine."

## 6. Regression check (jangan break behavior lain)

- [ ] `/orders/new` submit form berhasil → order tersimpan dengan channel + advertiser yang benar
- [ ] `/orders/bulk-upload` flow upload file → ingest jalan (profile picker tetap berfungsi)
- [ ] `/orders/export-resi` flow export → file ter-download (channel + profile picker tetap berfungsi)
- [ ] `/reconciliation/upload` flow upload rekonsil → engine jalan
- [ ] `/inbox/*` filter dropdowns → filtering tetap correct (value masih string ID, hanya display label di trigger yang berubah)

## 7. Build / type check

- [ ] `npx tsc --noEmit` → no errors
- [ ] `npm run build` → success, semua route ke-list

## Catatan implementasi

### Combobox (Bug #2 + #5)
- `autoOpenOnFocus` prop default `true`. Bisa di-set `false` di call site kalau page ingin opt-out.
- `skipNextAutoOpenRef` guard mencegah popover langsung re-open ketika focus kembali ke trigger setelah selection / Esc / outside-click. Diset oleh `onOpenChange(false)` lifecycle.
- `emptyHint` prop hanya tampil saat `options.length === 0` (data benar-benar kosong), bukan saat filter yield 0 result. Untuk filter-no-result tetap pakai `emptyText`.

### Cross-OS (Bug #3)
- CommandList sebelumnya pakai class `no-scrollbar` dari command.tsx default. Combobox sekarang override dengan `max-h-72 overflow-y-auto overflow-x-hidden` supaya scrollbar visible (terutama Mac Safari).
- Popover content pakai `w-[var(--anchor-width)] min-w-[260px]` supaya popover match width trigger (CSS variable dari Base UI Popover).

### Display label (Bug #4)
- **Combobox** sudah benar sejak awal — `selected?.label ?? placeholder` di trigger.
- **Base UI Select** by default tampilkan raw value. Fix: kasih render-function child ke `<SelectValue>`:
  ```tsx
  <SelectValue placeholder="...">
    {(value: string | null) => lookupLabel(value)}
  </SelectValue>
  ```
- Pattern ini sudah dipakai di `commission-rules`, `courier-rates`, `status-mapping` (lookup channel) — sekarang di-extend ke semua page.

### Analytics (Bug #1 deferred)
- `RefactorBanner` sekarang punya optional `description` prop. Kalau tidak di-pass, fall back ke teks default Phase 1.
