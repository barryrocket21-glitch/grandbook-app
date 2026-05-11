# GrandBook Bug Log

> Bug & UX friction yang ke-detect selama development & pakai harian.
> Akan di-batch fix di phase polish berikutnya.

## Pending (ke-detect saat dev)

### #1 Copy text di /settings/commission-rules
- **Where:** Aturan Komisi page, info banner di top
- **Issue:** Text "Berlaku Mulai = tanggal 1 bulan baru" misleading — 
  user mengira rule harus mulai tanggal 1 setiap bulan
- **Should be:** "Berlaku Mulai = tanggal kapan rule mulai dipakai" 
  (bisa kapan aja: hari ini, besok, bulan depan)
- **Severity:** Low (copy text only)

### #2 Bug minor advertiser dropdown
- **Where:** /orders/new form, section People & Notes
- **Issue:** User report "ada bug pas pilih advertiser" — belum konkret 
  detailnya
- **Action:** Reproduce saat pakai real, catat repro step di sini
- **Severity:** Unknown (pending repro)

### #3 Empty state /commissions/my untuk owner
- **Where:** /commissions/my page
- **Issue:** Owner buka page → tampil kosong (karena owner bukan 
  CS/advertiser yang dapet commission record). UX bingung.
- **Should be:** Empty state hint "Anda owner, lihat semua komisi di 
  [Kelola Komisi]" + clickable link
- **Severity:** Low (UX improvement)

## Bug baru muncul saat pakai

(Append manual sambil pakai sistem harian. Format sama seperti di atas.)
