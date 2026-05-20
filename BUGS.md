# GrandBook Bug Log

> Bug & UX friction yang ke-detect selama development & pakai harian.

## Pending

### #2 Bug minor advertiser dropdown
- **Where:** /orders/new form, section People & Notes
- **Issue:** User report "ada bug pas pilih advertiser" — belum konkret
  detailnya
- **Investigasi (2026-05-21):** Combobox advertiser di `order-form.tsx`
  ditelaah — tidak ditemukan bug konkret, komponennya normal. Kemungkinan
  edge case: order lama yang advertiser-nya sudah dinonaktifkan tidak
  tampil saat edit (query master data filter `active=true`).
- **Action:** Butuh repro step dari user — kejadian saat input order baru
  atau edit order existing? Gejala persisnya apa?
- **Severity:** Unknown (pending repro)

## Resolved

### #1 Copy text di /settings/commission-rules — OBSOLETE (2026-05-21)
Halaman commission-rules sudah di-redesign di Phase 4A (Commission Engine
v2). Tidak lagi punya field "Berlaku Mulai" / info banner yang dimaksud.
Bug tidak relevan lagi.

### #3 Empty state /commissions/my untuk owner — FIXED (2026-05-21, 03bfff4)
Empty state sekarang role-aware: owner lihat "Tidak ada komisi pribadi"
+ link ke Kelola Komisi. Role lain tetap pesan generic.

## Bug baru muncul saat pakai

(Append manual sambil pakai sistem harian. Format sama seperti di atas.)
