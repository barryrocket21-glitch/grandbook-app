# Kandidat dua P1 laporan keuangan — 24 Oktober 2026 WIB

STATUS: kandidat selesai di lingkungan terisolasi, belum diterapkan live.
Sesi dimulai23 Oktober; pergantian hari WIB ikut teruji. Barry melarang perubahan
data/aturan live serta push/deploy, dan batas tersebut dipertahankan.

## Perubahan yang disiapkan

1. F1: pembaca P&L/Buku mengikuti bukti profil OrderOnline dan gross_revenue
   numerik yang sama dengan total. Ongkir yang sudah masuk gross dihitung sekali.
   Harga barang P&L dan tagihan pembeli Buku dibedakan dengan benar.
   Input tanpa bukti, mismatch atau malformed tetap memakai basis lama.
2. F1: label Fee CS diganti Komisi/selisih estimasi pada private UI/export.
   Field RPC lama tetap kompatibel. Ini bukan nominal entitlement CS atau
   bukti pembayaran, dan tidak mengganti aturanRp2500 per delivered.
3. F2: Buku untuk Owner/Admin/Akunting memakai recorded_cod_receipts yang sama
   dengan dashboard, mencakup draft/final dan settled_at asli, sekali per referensi.
   Jalur staff tidak diperluas atau diblokir; kasus CS dibandingkan dengan baseline.
4. Tampilan/ekspor terkait: field rincian yang tidak dikirim RPC lama tetap kosong/
   —, bukan nol palsu. TOTAL optional memakai conditional COUNT/ROWS/SUM sungguhan.
   Default date picker Buku ditampilkan setelah client mount: uji menemukan
   HTML cache tanggal23 dan browser24 menyebabkan React418. Sesudah perbaikan,
   browser6 checks lulus tanpa JS error; pilihan periode/range WIB tidak berubah.

Hanya dua definisi function dibentuk sebagai SQL kandidat. Tidak ada helper,
grant, Auth/RLS, cost engine, rate, snapshot HPP, komisi, payment, status, atau
profit tersimpan yang diubah. F3 packing/F4 ADS tidak dikerjakan di kandidat ini.

SQL dan rollback menolak hosted/TCP serta database selain financial_p1_review
pada server tanpa TCP listener. Hash baseline menolak source drift. Kandidat
bukan script aktivasi produksi dan tidak didaftarkan dalam manifest recovery aktif.

## Hasil uji nyata pada restore

Restore checksum-verified20261022T192012Z-8e4d12b2, PG17, Unix socket privat.
Pembacaan laporan memakai authenticated Owner/CS dan RLS yang ada. Synthetic
business writes hanya di restore dan seluruhnya rollback. Fingerprint semua
tabel restore sebelum/sesudah, signature/result/owner/ACL/config/security/volatility
function, serta kolom Buku di luar perubahan yang disetujui sama.

| Periode restore | Order | Perbaikan rincian ongkir | Residual sebelum → sesudah |
| --- | ---: | ---: | ---: |
| September |6763|Rp6860000|Rp40400000 → Rp33540000|
| Oktober sampai23 |6136|Rp107302000|Rp137854500 → Rp30552500|

GP dan laba setelah ADS/opex tidak berubah pada kedua periode. Empat periode
historis + empty + reversed diuji; field lain dan jumlah/identitas baris tetap.
Restore Oktober6136 berbeda dari capture audit23 Oktober6325; jangan menyebut
angka restore sebagai pembacaan live baru. Pada rekaman audit lama, efek F1
Rp112403000 tetap temuan sumber, bukan hasil aktivasi kandidat.

Buku all-time restore kini menjumlah5749 receipt/Rp1082521138, tepat sama dengan
guarded receipt source. Tidak ada join duplikat/baris hilang. Kasus draft→final,
mirror settlement, konflik/duplikat bukti gagal tertutup, source provenance,
filter/search/pagination, CS normal dan organisasi lain lulus14 regresi SQL.
Rollback dua function dan pemasangan ulang kandidat identik juga lulus.

Empat latensi normal di bawah8 detik pada restore: P&L Sept0.397s, Oct0.235s,
Buku Sept50baris2.601s, all-time50baris5.134s. Ini bukan jaminan hosted latency.

Optimized build/TypeScript/scoped ESLint lulus. Tujuh XLSX/CSV checks lulus:
nilai numeric, pencairan draft/blank yang benar, SUM nyata dan conditional total
yang tidak menyamarkan field belum lengkap. Enam browser checks pada built app
loopback memakai fixture sintetis dari SQL restore: buyer/receipt cells, download
Excel, label GP, widths1440/390/320, error/retry, JS errors0 dan unexpected calls0.

## Artefak untuk review

- scripts/sql/financial-report-readers/20261023000100-financial-readers.candidate.sql
- scripts/sql/financial-report-readers/isolated-rollback.sql
- scripts/sql/financial-report-readers/ui-labels.patch
- scripts/sql/financial-report-readers/review.json dan README.md
- tests/financial-report-readers/{regression.sql,run.py,browser.cjs,export.test.ts}

Commit kandidat SQL/tests2ca899c; private UI patch/tests/review49b727b.
Patch merekonstruksi persis3 file private app yang diuji; authoritative src belum
diubah. Public artifacts tidak berisi session, credentials atau data pelanggan.
Private evidence: /root/backups/grandbook/financial-p1-candidate-20261023.

## Produksi dan batas verifikasi

Main tetapdpl_a67itdDg1QrLHCUtjBCWb3XkBmCa READY/bom1. Pembacaan pg_catalog live
read-only membuktikan kedua reader, receipt guard dan kedua cost engine tetap
identik dengan capture audit. Source aktif tetap457 input/d605ccf0;35 referensi
recovery dan manifest lama tetap, tidak ada SQL correction/migration replay live.
Perubahan lama AGENTS/doctor/normalizer dipertahankan; Liard tidak disentuh.

NOT VERIFIED: penerapan/hosted runtime kandidat, iPhone fisik, recalculation pada
aplikasi Excel, kelengkapan biaya/bank/entitlement dan laba kas final.
Source ekspor Buku yang diwarisi masih mengekspor displayed page; all-data export
bukan bagian kandidat ini. Jangan menyebut reader lengkap sebagai bukti tombol
export sudah mengekspor semua halaman.

vision masih memiliki claim validasi Main/personal dashboard; tidak ditimpa.
NEXT: vision review source dan bukti kandidat secara independen read-only melalui
handoff. Tidak menjalankan ulang SQL/test write, mengubah data/source live, push,
atau deploy atas dasar kesiapan kandidat ini. Aktivasi memerlukan scope/approval
terpisah dan pengecekan sumber/data terbaru.
