# Audit biaya iklan lintas laporan — 25 Oktober 2026 WIB

STATUS: audit READ-ONLY selesai. Ada satu P1 aktual pada halaman Ad Spend,
sedangkan biaya iklan di dashboard utama, Laba Rugi dan Owner Profit cocok
setelah periodenya disamakan. Tidak ada perbaikan source/data/aturan live.

## Lingkup dan sumber

Baseline Git rilis `12a4fb6`, klaim audit `07c22ff`. Main aktif
`dpl_2j1bzJSUTd3JNErNnKARXkcyo7a8`, READY/bom1. Seluruh 457 hash source upload
cocok dengan source yang diaudit; input
`bc8cd470ae5d840f29685f7e43a0c04547d3720e88db08a2ded5e745db39d35e`.
Liard terpisah dan tidak disentuh.

Data bisnis dibaca dengan sesi Owner normal dan Auth/RLS yang berlaku: 4160
baris ad_spend, 136 kampanye, 136 alokasi produk, 39 produk kanonik, serta 310
final order/item September–Oktober. Pembacaan berurutan memakai ID, exact count,
dan pemeriksaan akhir count. Tidak memakai superuser/service-role untuk bisnis.
Tidak ada nama/alamat/kontak pelanggan atau token di dokumen maupun Git.

Reader dashboard asli dijalankan memakai Owner normal untuk cutoff 30 September
dan 25 Oktober. September adalah reproduksi fungsi pada tanggal historis, bukan
fitur pemilih bulan dashboard. Laba Rugi dipanggil melalui RPC normal untuk
September, Oktober MTD, Oktober penuh dan rolling 30 hari. Owner Profit Main HTTPS
September/Oktober ALL berhasil 200 tanpa mock. Detail produk/platform dibandingkan
dengan oracle Decimal/cents independen. UI native Owner Main juga diperiksa.

Definisi dua reader SQL, generated columns/default ADS dan constraint terkait
dibaca dari pg_catalog melalui koneksi resmi dalam REPEATABLE READ READ ONLY.
Business rows via admin **0**; tidak ada DDL/DML/migrasi/koreksi yang dijalankan.
Capture bisnis berupa beberapa pembacaan, bukan snapshot transaksi atomik.

## Hasil tiga laporan utama

| Periode | Baris ADS lengkap | Dashboard | Laba Rugi | Owner Profit |
| --- | ---: | ---: | ---: | ---: |
| 1–30 September | 1122 | Rp238.001.306 | Rp238.001.306 | Rp238.001.306 |
| 1–25 Oktober | 807 | Rp215.560.642 | Rp215.560.642 | Rp215.560.642 |

Owner Profit memakai bulan penuh 1–31 Oktober; saat capture tidak ada ADS tanggal
26–31, sehingga angka aktualnya sama dengan MTD. Kesamaan ini bukan jaminan
semua bulan penuh selalu sama dengan MTD. Dashboard memakai WIB; Laba Rugi sesuai
rentang pengguna; semua memakai spend_date untuk biaya, bukan order_date/created_at.

Dashboard Oktober membaca 1040 baris ADS sumber 26 September–25 Oktober agar
grafik 30 hari lengkap, tetapi kartu bulan ini hanya mengambil 807 baris Oktober.
Jumlah grafik **Rp273.539.540** = Oktober **Rp215.560.642** + 233 baris
26–30 September **Rp57.978.898**. RPC Laba Rugi dengan rentang yang sama cocok.
Grafik sudah berlabel Omzet − Ad Spend, bukan laba bersih. Beda periode ini benar.

P&L proyeksi dan akrual mengurangi biaya ADS sekali; Owner Profit juga sekali.
Profit Estimasi dashboard memakai estimasi order berjalan sebelum biaya ADS/opex
periode, sedangkan ROAS dan grafik memakai biaya ADS. Jangan memaksa seluruh
angka profit menjadi sama: cohort, biaya dan definisinya berbeda.

## A1 — P1 aktual: kartu Ad Spend menghitung subset 1000 baris

Temuan tambahan saat menelusuri sumber input ketiga laporan:
`listAdSpend` di `src/lib/supabase/queries/ad-spend.ts:33` memakai satu
`.limit(1000)`, tanpa paginasi. Filter platform diterapkan di client sesudah
batas itu. Halaman `/ad-spend` menghitung kartu Total Spend/lead/CPR dari rows
terbatas melalui useMemo `live` di `src/app/(app)/ad-spend/page.tsx:112`.

Query helper asli dan UI Main mereproduksi September:

- Sumber normal Owner lengkap: **1122 baris / Rp238.001.306**.
- Tabel/kartu live: **1000 baris / Rp215.429.845**.
- **122 baris / Rp22.571.461 tidak masuk kartu**, tepat sama dengan selisih sumber.
- Header halaman tetap menampilkan **Rp238.001.306** dari RPC summary penuh,
  tetapi jumlah entry memakai 1000. Akibatnya dua total berbeda ada pada halaman
  yang sama. Ini tidak mengurangi data tersimpan dan bukan uang yang dihapus.

| Platform | Terlihat | Lengkap | Baris hilang | Spend tidak masuk kartu |
| --- | ---: | ---: | ---: | ---: |
| META | 839 | 930 | 91 | Rp14.543.656 |
| GOOGLE | 105 | 129 | 24 | Rp6.455.850 |
| SNACK | 56 | 63 | 7 | Rp1.571.955 |

Filter META tetap tidak lengkap walaupun 930 barisnya sendiri kurang dari 1000,
karena pembatasan terjadi sebelum filter platform. Header memakai summary periode
tanpa filter platform/source; kartu mengikuti filtered rows. Perbedaan scope ini
juga perlu dibuat jelas. Nilai header menggunakan spend, sedangkan kartu memakai
spend_total; saat PPN nonnol keduanya juga dapat berbeda basis.

Sebaliknya tiga laporan utama sudah membaca biaya lengkap: dashboard dan Owner
Profit memakai paginasi terjaga, P&L agregasi server. September >1000 cocok di
ketiganya. Perbaikan Buku Order yang sudah dirilis tidak mencakup Ad Spend ini.

## A2 — P2 laten: basis pajak belum seragam

Kontrak aktif yang diverifikasi dari source dan katalog:

- Dashboard `read.ts`/`accuracy.ts:111` menjumlahkan spend.
- SQL `laba_rugi_summary` menjumlahkan spend, satu kali dalam tiap kolom profit.
- Owner Profit membaca spend_total lalu mengalokasikan cents per produk/platform.
- Generated `ppn_amount = spend × ppn_rate / 100` dan
  `spend_total = spend + ppn_amount`. Default database ppn_rate **0**; form manual
  juga 0 dan memungkinkan rate lain jika billing memisahkan PPN. Import tanpa
  ppn_rate mengikuti default database. Komentar type yang menyebut default12 lama
  tidak menggambarkan default database/form saat audit.

Seluruh **4160 baris saat ini ppn_rate0, PPN0, tanpa spend_total NULL**. Oracle
memverifikasi rumus generated tiap baris. Dampak beda basis saat ini **Rp0**.
Ini konfirmasi baru atas F4 laten sebelumnya, bukan selisih pajak live baru.

Fixture murni memakai fungsi dashboard/allocator asli dan basis SQL yang dibaca,
tanpa memasukkan data sintetis ke database:

| Input spend | Rate contoh | Biaya dashboard/P&L | Biaya Owner Profit | Beda |
| --- | ---: | ---: | ---: | ---: |
| Rp100.000 | 0% | Rp100.000 | Rp100.000 | Rp0 |
| Rp100.000 | 12% | Rp100.000 | Rp112.000 | Rp12.000 |

Rate12 di sini contoh pengujian, bukan instruksi pajak atau perubahan rate.
PPN biaya ADS dan PPN fee COD/SPX adalah kontrak berbeda. Jangan menambah PPN
ke seluruh data atau mengubah rate0 untuk memaksa laporan cocok. Penyatuan basis
reader harus menjadi kandidat terisolasi yang ditinjau/diotorisasi terpisah.

## Alokasi, periode dan cutoff

Semua 136 alokasi saat capture valid, satu produk/100% per kampanye. Seluruh
33 bucket produk/platform September dan 29 Oktober cocok dengan oracle; tidak
ada kehilangan biaya atau biaya tak teralokasi saat capture. Platform September:
GOOGLE Rp59.347.213, META Rp166.638.796, SNACK Rp12.015.297; Oktober GOOGLE
Rp64.717.723, META Rp144.810.563, SNACK Rp6.032.356. Sum tepat ke total bulan.

ADS tetap dicatat saat bucket tidak memiliki final order: September Rp28.968.289;
Oktober seluruh Rp215.560.642 (final order Oktober0). Ini sesuai perilaku tertulis,
bukan biaya ganda atau alasan menghapus biaya. Satu final order September masih
UNKNOWN platform dan dipertahankan; tidak ada atribusi/produk yang diubah.

Alokasi menggunakan campaign_products dan platform kampanye saat ini, tanpa
versi historis bertanggal. UI/API sudah menyatakan batas ini. Kecocokan aritmetika
bukan bukti bahwa mapping hari ini merepresentasikan alokasi historis invoice.

Seluruh platform terakhir memiliki spend_date **22 Oktober**. Tidak ada entri
23–25 Oktober saat capture. Ini cutoff data tercatat, bukan bukti biaya nyata tiga
hari itu nol. Invoice/ekspor platform dan status pembayaran belum diverifikasi.

Default bulan Owner Profit memakai UTC (`DEFAULT_MONTH`, page.tsx:17), sedangkan
dashboard/P&L memakai WIB. Fixture 30 September18:00 UTC = 1 Oktober01:00 WIB
membuktikan default bisa berbeda pada 00:00–06:59 WIB tanggal1. Tidak berdampak
pada tanggal audit25 dan tidak mengubah angka jika bulan dipilih eksplisit.

## Verifikasi dan batas

Native Owner Main: Ad Spend September menampilkan kartu Rp215.429.845/1000 entry
dan header Rp238.001.306; Laba Rugi September kedua kolom Biaya Iklan
Rp238.001.306; Owner Profit September Ads Rp238.001.306/310 order/281 delivered;
dashboard Oktober Ad Spend Rp215.560.642/ROAS4,04 dengan periode WIB yang benar.
Tidak ada successful business response mock atau perubahan UI source.

Private evidence/harnesses:
`/root/backups/grandbook/ads-audit-20261025` — capture, metadata, actual-reader
checks, Decimal oracle, tax/month-boundary fixtures, source pin, browser proof,
dan screenshot tanpa baris pelanggan. Awal capture memiliki kesalahan HEAD query
audit yang tidak menyertakan embedded relation; diperbaiki hanya pada harness
privat, kemudian seluruh capture final lulus. Ini bukan perbaikan produksi.

Yang belum terbukti: invoice/ekspor platform, kebenaran klaim spend sudah mencakup
pajak terhadap billing eksternal, kelengkapan biaya23–25 Oktober, alokasi historis,
seluruh laba kas aktual, dan snapshot atomik selama semua perubahan serentak.
Tidak ada app edit/build baru, SQL activation/recovery/koreksi, push atau deploy.

## Koordinasi dan berikutnya

Vision claim `ef50fa4` untuk validasi ekspor Buku Order tetap miliknya; section
handoff dipertahankan. Audit ADS hanya menulis dokumen/proof agregat dan harness
privat. Tidak mengirim pesan di luar handoff, tidak mengklaim watcher otomatis.

NEXT: siapkan kandidat terisolasi untuk **A1 kelengkapan Ad Spend dan scope
header/kartu** setelah Barry menyetujui; pertahankan data, rate dan rumus bisnis,
uji >1000 serta filter platform/source/error sebelum publikasi terpisah.
