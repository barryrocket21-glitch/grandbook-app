# Phase 2A — Smoke Test Checklist

Manual test setelah deploy. Login berbeda role untuk verifikasi permission gating.

## Permissions

- [ ] Login sebagai `cs` (e.g. `andi@cs.test` / `pass1234`) → buka `/settings/couriers` → tabel terlihat tapi tombol "Tambah Courier" hidden
- [ ] Login `advertiser` (chandra) → sidebar tampil "Master Data" group, semua sub-item accessible read-only
- [ ] Login `owner` → semua tombol Tambah/Edit/Power visible, action jalan
- [ ] Login `admin` (Indra) → sama dengan owner di Master Data (CRUD bisa)

## Couriers (`/settings/couriers`)

- [ ] Tambah courier baru dengan code unik → muncul di tabel + toast sukses
- [ ] Tambah dengan code duplicate (e.g. `SPX`) → error message "Code SPX sudah dipakai"
- [ ] Edit courier → name terupdate
- [ ] Disable courier yang punya channels → konfirmasi "X channel terkait akan ikut di-disable" muncul, channel ikut disabled
- [ ] Toggle "Tampilkan tidak aktif" → courier disabled muncul (faded)
- [ ] Re-enable courier disabled
- [ ] Search by code/name → filter jalan
- [ ] Click count "X channel" → navigate ke `/settings/courier-channels?courier=X` dengan filter pre-set

## Channels (`/settings/courier-channels`)

- [ ] Tambah channel baru, courier dropdown populate dari couriers active
- [ ] Set aggregator → suggested code muncul (e.g. "SPX_VIA_LINCAH")
- [ ] Click "Pakai saran" → form code ke-set
- [ ] Filter by courier → cuma channel courier itu yang muncul
- [ ] Filter by aggregator (NONE/MENGANTAR/dll)
- [ ] Toggle "Tampilkan tidak aktif"
- [ ] Edit channel → ubah aggregator, code, dll.
- [ ] Disable channel
- [ ] URL deep-link `?courier=X` populate filter saat halaman dibuka

## Rates (`/settings/courier-rates`)

- [ ] Tambah rate pertama untuk pasangan (channel, key) → sukses tanpa konfirmasi replace
- [ ] Tambah rate kedua untuk pasangan yang sama (effective_to NULL) → konfirmasi "Set rate lama berakhir di X" muncul
  - Klik konfirmasi → rate lama ke-set effective_to, rate baru jadi aktif
- [ ] Pilih rate_key custom (`__custom__`) → input field muncul, validasi lowercase+underscore
- [ ] Edit rate → ubah value, effective_from/to
- [ ] Hapus rate yang belum dipakai → sukses
- [ ] Filter by channel + rate_key
- [ ] Toggle "Tampilkan rate yang sudah berakhir" — rate dengan effective_to muncul (faded)
- [ ] Format value display:
  - rate_key contains `percent` → tampil dengan `%`
  - rate_key contains `amount` → tampil `Rp X.XXX`

## Status Mapping (`/settings/status-mapping`)

- [ ] Tambah mapping baru (channel + raw_status + internal_status)
- [ ] Tambah mapping dengan (channel, raw_status) yang sama → error "Mapping sudah ada"
- [ ] Filter by channel
- [ ] Filter by internal status
- [ ] Search by raw status (case-insensitive contains)
- [ ] Edit mapping → ubah internal_status, notes
- [ ] Hapus mapping
- [ ] **Bulk copy**: klik "Salin dari Channel Lain" → pilih source SPX_DIRECT, target NINJA_DIRECT (kalau ada) → sukses, mapping ter-copy, duplicate auto-skip

## Master Wilayah (`/settings/wilayah`)

- [ ] Buka halaman, default tampil 50 row pertama (sorted by province → city → subdistrict → village)
- [ ] Pilih provinsi → cities dropdown populate cepat
- [ ] Pilih city → subdistricts dropdown populate
- [ ] Pilih subdistrict → tabel re-fetch ke village list di subdistrict tsb
- [ ] Search "Mataram" → hasil muncul (full-text via village/subdistrict normalized)
- [ ] Search dengan kode pos prefix (e.g. "831") → match by zip
- [ ] Pagination: klik Next → loading lalu page kedua tampil
- [ ] Reset filter → semua kembali default
- [ ] Hint "Master wilayah dikelola via npm run import:wilayah" muncul di bawah

## Build & Lint

- [ ] `npm run build` pass tanpa error
- [ ] `./node_modules/.bin/tsc --noEmit` pass
- [ ] Lint warnings yang muncul OK (existing legacy)

## Edge cases yang sengaja dibiarkan

- Master Wilayah loadProvinces ambil semua row dari kolom `province` lalu dedupe di JS — Supabase tidak punya `DISTINCT` RPC default. Kalau lambat, optimasi dengan create RPC function di DB di phase berikutnya.
- Cascade disable courier → channels pakai app-level update (bukan DB trigger). Aman karena single tx, tapi kalau gagal di tengah perlu retry manual.
- Hard delete rate yang sudah dipakai di order: cek dilakukan via FK (`23503` error). Phase 4 akan kasih UX yang lebih clear (referenced count + "set effective_to" suggestion).
