# Audit read-only angka dashboard dan laporan — 23 Oktober 2026

STATUS: audit terbatas selesai; perbaikan belum diterapkan. Barry mengizinkan audit
read-only, bukan perubahan data atau aturan keuangan live. Tidak ada push/deploy.

## Lingkup, sumber dan cutoff

Main aktif diperiksa melalui API provider: dpl_a67itdDg1QrLHCUtjBCWb3XkBmCa,
READY/bom1. Aplikasi50e21c3; Git baseline dokumentasi a87e43b. Liard tidak disentuh
dan tidak dianggap identik. SHA256 seluruh source src/ sama sebelum/sesudah audit.

Sumber angka bisnis: sesi Owner normal Supabase ubksitifaprqofujhova, organisasi1,
dengan Auth/RLS yang berlaku; tidak memakai service-role untuk membaca bisnis.
Pagination berurutan dengan exact count dan pemeriksaan ulang count, tanpa
menganggap batas1000 sebagai total. Capture awal selesai23:12 WIB; pembacaan
laporan/bukti dilanjutkan pada sesi23 Oktober ini. Ini beberapa pembacaan terpisah,
bukan snapshot transaksi atomik; kesamaan count tidak menutup perubahan serentak
yang mempertahankan jumlah baris.

Cakupan capture:11206 final orders+items,20228 drafts+items,4160 ADS,
21587 commissions,71 withdrawals,5749 guarded COD receipts,24 rates.
operational_expenses dan supplier_payable keduanya0 baris terlihat oleh Owner.

Definisi sepuluh function aktif, dua union view dan dua generated ADS columns
dibaca melalui pg_catalog dalam transaksi REPEATABLE READ READ ONLY melalui koneksi
CLI resmi yang sudah tersedia. Hanya metadata, tanpa membaca bisnis sebagai admin.
Tidak ada SQL migrasi/koreksi/DDL/DML dijalankan. Function pembaca laporan dipanggil
melalui normal Owner; compute_order_costs/compute_draft_order_costs hanya dibaca
definisinya, tidak dieksekusi.

Periode pembanding:1–30 September dan1–23 Oktober, berdasarkan order_date.
Pencairan global berbeda dari cohort order_date dan dari bulan settled_at.

## Temuan prioritas

### F1 — P1: rincian ongkir dan Fee CS belum mengikuti kontrak OrderOnline

Definisi live compute_draft_order_costs sudah mempertahankan koreksi: jika profil
orderonline_inbound dan gross_revenue sama dengan total, nilai itu sudah termasuk
ongkir pembeli dan tidak ditambah ongkir lagi. Koreksi tersebut tetap utuh.

Namun laba_rugi_summary menganggap total sebagai harga barang dan menambahkan
shipping_cost melalui selisih ongkir. Fee CS bukan dibaca dari komisi CS:
fee_cs=(total+shipping_cost-estimated_shipping_net-estimated_cod_fee-
estimated_ppn-hpp)-estimated_profit.
list_pembukuan memakai padanan penjualan=total+shipping_cost dan residual yang sama.

Oktober:2723 draft memenuhi bukti profil+gross_revenue=total. Ongkir yang sudah
termasuk total berjumlahRp112403000. Selisih tepat sama muncul antara residual
Fee CS yang dilaporkanRp143900500 dan komisi seluruh role tersiratRp31497500
berdasarkan estimated_cash_in, biaya, HPP dan profit tersimpan.
September:171 draft, efek rincianRp6860000.

Ini kesalahan rincian/label pendapatan-ongkir-komisi, BUKAN bukti laba bersih
bertambahRp112403000: GP tetap di-anchor pada estimated_profit tersimpan dan
residual menyerap kelebihan. Jangan memperbaiki dengan menghitung ulang order
atau menjalankan ulang koreksi OrderOnline yang sudah selesai.

Label Fee CS juga mencampurkan role lain: realisasi SeptemberRp1400000, sedangkan
komisi final EARNED/PAID pada cohort itu terdiri dari CSRp702500 dan advertiser
Rp697500. Tidak identik dengan komisi CS Rp2500 per delivered.
Seluruh5566 komisi CS EARNED dalam capture bernilaiRp2500; PAID0 baris.
Audit ini tidak membuktikan setiap entitlement/payment workflow, dan tidak
menjalankan EARNED→PAID.

Downstream: P&L, Buku Order dan kolom ekspor memakai angka residual tersebut.
Fungsi live captured; padanan sumber:
scripts/sql/pnl-performance/20261021000100-materialized-summary.sql:31–42;
src/lib/orders/pembukuan-export.ts:51–64.
Kolom ekspor Fee CS (Est/Aktual) mengambil est_fee_cs/act_fee_cs.

### F2 — P1: Dicairkan Buku Order tidak memasukkan pencairan draft yang sah

recorded_cod_receipts dan dashboard sudah menyertakan ledger draft/final dengan
penjagaan referensi dan deduplikasi. list_pembukuan masih mengembalikan NULL
untuk dicairkan dan cod_settled_at pada seluruh draft; final hanya memakai payout
saat cod_settled_at terisi. UI/export meneruskan hasil tersebut.

Capture global:5749 receipts/Rp1082521138 terdiri dari3401 final/Rp627727510
dan2348 draft/Rp454793628. Draft yang sudah punya receipt masih berstatus
SIAP_KIRIM1777, DIKIRIM568, PROBLEM3. Jangan ubah status untuk menyamakan laporan.
Tiga normal-Owner RPC sample, satu per status, mereproduksi receipt ada tetapi
Dicairkan Buku Order NULL.

Cohort order September:379 draft/Rp66623009 tersembunyi dari kolom itu.
Buku Order September mencatat pencairan finalRp47442000, sehingga receipt terkait
order September yang dapat direkonsiliasi berjumlahRp114065009. Ini cohort
order_date September, bukan klaim bahwa seluruh uang cair pada September.

Sumber: definisi list_pembukuan aktif yang dicapture; UI
src/app/(app)/orders/pembukuan/page.tsx:359–360 dan ekspor
src/lib/orders/pembukuan-export.ts:64–65.
Perbaikannya harus membaca bukti pencairan yang sama, tanpa mutasi receipt/order.

### F3 — P2: Owner Profit melewatkan packing_fee_snapshot

Route Owner Profit membaca qty dan hpp_snapshot, tetapi tidak membaca packing.
HPP P&L dan compute_order_costs memasukkan packing. Pada281 delivered September:
HPP Owner ProfitRp8621700, HPP P&LRp8644000, selisihRp22300 packing.
Dengan semua komponen lainnya tetap, gross Owner Profit lebih tinggiRp22300
daripada jika packing tersimpan ikut dikurangkan. Ini tidak menyatakan angka
lainnya sudah menjadi laba kas terverifikasi.

Sumber: src/app/api/reports/owner-profit/route.ts, pemilihan order_items dan
perhitungan hpp pada257; definisi live compute_order_costs dan laba_rugi_summary.
Tidak ada HPP, harga, packing snapshot atau koreksi617/batch/31 diubah.

### F4 — P2 laten: basis biaya ADS belum satu kontrak

Dashboard dan P&L menjumlahkan spend; Owner Profit menggunakan spend_total.
Generated columns aktif: ppn_amount=spend*ppn_rate/100 dan
spend_total=spend+ppn_amount. Seluruh4160 ADS terlihat saat capture memiliki
total PPN0, termasuk September dan Oktober, sehingga dampak aktual saat ini0.
Jika ada PPN nonnol kemudian, biaya/perbandingan ROAS/profit dapat berbeda.
Ini risiko struktural, BUKAN selisih uang yang sudah terbukti sekarang.
Jangan mengganti basis atau rate tanpa keputusan sumber/aturan yang disepakati.

## Perbedaan yang terjelaskan dan tidak boleh dipaksa sama

| Angka Oktober1–23 | Nilai | Basis |
| --- | ---: | --- |
| Dashboard omzet bulan ini | Rp833048264 | total order non-CANCEL/FAKE; bukan penerimaan kas |
| Dashboard profit estimasi berjalan | Rp683144005,52 | estimated_profit order berjalan; sebelum ADS/opex periode |
| Laba Rugi proyeksi setelah biaya tercatat | Rp467583363,52 | GP tersimpan dikurangi ADSRp215560642 dan opexRp0 |
| Laba Rugi realisasi setelah biaya tercatat | −Rp215560642 | cohort Oktober belum ada delivered; ADS periode tetap dibebankan |
| COD cair global | Rp1082521138 |5749 guarded receipts, semua periode; bukan laba kas |
| COD delivered belum cair global | Rp337339964 |1978 final delivered belum punya receipt |
| Saldo pada penarikan terakhir | Rp4 | bukti balance_after historis14 September; bukan saldo bank terkini |

Definisi dashboard: src/lib/dashboard/accuracy.ts:105–146.
Tautan ke Laba Rugi mengubah basis dari estimasi berjalan sebelum ADS menjadi
laporan cohort setelah ADS. SelisihRp215560642 Oktober terjelaskan oleh biaya
periode, bukan data hilang atau koreksi OrderOnline yang perlu diulang.

September: P&L GP delivered/returRp34655351,34 vs Owner Profit GP sebelum ADS
Rp32652792,90; bedaRp2002558,44. Rekonsiliasi independen mereproduksi tepat:
Owner revenueRp49455000 − HPPRp8621700 − shippingRp6780507,10 − komisiRp1400000.
P&L memakai omzet setelah estimasi ongkir/adminRp44699351,34, HPPRp8644000
dan komisi residualRp1400000. Jembatan beda revenue/cost/packing tepat cocok.
Bukan satu angka identik dengan dua cara pembulatan.

Owner Profit final-only310 order (281 delivered,29 retur); P&L union6763 order.
Dari281 delivered,268 memiliki receipt dan13 belum, COD tersimpanRp479000.
Owner Profit memakai fallback COD/total saat payout tidak ada; halaman memberi
batasan bahwa laba aktual belum terverifikasi. Jadi Owner Profit juga bukan
laporan laba kas hanya atas settlement.

## Yang lolos pemeriksaan

- Oracle Decimal independen mereproduksi25 output P&L untuk dua periode:50/50 cocok.
  Kesamaan dengan implementasi membuktikan jejak perhitungan, bukan kebenaran
  seluruh definisi bisnis di atas.
- Seluruh6763 baris Buku Order September dan6325 Oktober dibaca; delapan
  komponen EST/ACT yang sepadan menjumlah tepat ke P&L pada kedua periode.
- Guarded receipts5749 unik menjumlah tepat ke payout RPC. Split settled/unsettled,
  pipeline, withdrawals, ongkir estimasi dan komisi terutang direkonsiliasi dari
  rows normal Owner ke RPC posisi keuangan tanpa beda.
- Posisi COD setelah penarikanRp442537963 =
  receiptsRp1082521138 + uncairRp337339964 − withdrawalsRp977323139.
  UI sudah menyebut estimasi, bukan saldo kurir/bank terverifikasi.
- Owner Profit live API September/Oktober sukses; seluruh komponen gross September
  cocok dengan oracle dan shipping evidence reader. Coverage September2 verified
  dan279 legacy; tidak dipromosikan menjadi279 biaya terverifikasi.
- Rate SPX aktif tetap cashback40%, COD1%, PPN12%, RTS0. Biaya ADS PPN adalah
  kontrak berbeda dari PPN fee kurir.
- App source dan tiga tracked dirty files operator SHA256 tetap; perubahan sesi
  hanya dokumen audit/handoff. Tidak ada kredensial atau data pelanggan di dokumen.

## Batas verifikasi dan langkah berikutnya

Laba kas final dan seluruh biaya aktual belum dapat disertifikasi. Opex/supplier
ledger0 baris bukan bukti tidak ada kewajiban/biaya nyata. Ongkir terutang memakai
estimated_total_cost, bukan rekonsiliasi seluruh invoice lunas; receipt COD tidak
sendirinya membuktikan invoice kurir sudah dibayar. Saldo bank eksternal, kelengkapan
invoice/ADS platform, seluruh entitlement komisi dan source cutoff eksternal
belum diverifikasi. Tidak ada sumber eksternal yang diubah atau klaim profit final.

Tidak diuji workbook baru atau seluruh UI browser dalam sesi audit ini; lineage
ekspor diverifikasi dari source, nilai RPC diverifikasi live. Hasil browser rilis
sebelumnya bukan pengujian baru sesi audit. Audit vision pascarilis belum tercatat.

Bukti private: /root/backups/grandbook/finance-audit-20261023-readonly:
capture-summary.json, installed-definitions.private.json, oracle-summary.json,
reconciliation-summary.json, owner-profit-bridge.json,
draft-receipt-reproduction.json, verification.json. Raw rows, sessions dan connection
details tetap private, tidak masuk Git.

NEXT: siapkan kandidat perbaikan F1+F2 pada pembaca laporan di lingkungan terisolasi
untuk direview Barry; jangan apply SQL/data/aturan live atau push/deploy tanpa
persetujuan scope berikutnya. vision memvalidasi temuan secara independen read-only
melalui docs/CODEX-HANDOFF.md; CS/advertiser completeness tetap jalurnya.
