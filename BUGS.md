# GrandBook Bug Log

> Bug & UX friction yang ke-detect selama development & pakai harian.

## Pending

(none currently)

## Resolved

### #2 Advertiser dropdown — inactive advertiser tidak tampil saat edit (2026-05-23)
- **Where:** `/orders/new` + edit form di `/orders/[id]`, section People & Notes
- **Root cause:** `order-form.tsx` line 148 query master profiles dengan
  `.eq('active', true).eq('role', 'advertiser')` — kalau order lama linked
  ke advertiser yang kemudian di-nonaktifkan via `/settings/users`, dropdown
  tidak include advertiser tersebut → user lihat empty selection padahal
  `advertiser_id` set di DB.
- **Fix:** Same pattern Phase 8A supplier handling. Query advertisers
  dengan `.or('active.eq.true,id.eq.{currently_linked}')` — include
  active OR the specific advertiser already linked ke order ini. Plus
  label suffix `"(non-aktif)"` di Combobox option supaya user tahu.
- **Severity:** Medium (silent data integrity issue saat edit legacy orders)


### #1 Copy text di /settings/commission-rules — OBSOLETE (2026-05-21)
Halaman commission-rules sudah di-redesign di Phase 4A (Commission Engine
v2). Tidak lagi punya field "Berlaku Mulai" / info banner yang dimaksud.
Bug tidak relevan lagi.

### #3 Empty state /commissions/my untuk owner — FIXED (2026-05-21, 03bfff4)
Empty state sekarang role-aware: owner lihat "Tidak ada komisi pribadi"
+ link ke Kelola Komisi. Role lain tetap pesan generic.

## Bug baru muncul saat pakai

(Append manual sambil pakai sistem harian. Format sama seperti di atas.)
