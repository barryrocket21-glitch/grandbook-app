# Source alignment UI — 21 Oktober 2026 WIB

## Penyelesaian scope UI — 2026-10-21T17:02:09+07:00

**SELESAI untuk 13 file UI dan dependensi kalender/ekspor yang direview.**
Audit vision sudah dibaca dan RELEASED; tidak ada area vision yang ditimpa.
Tiga gap terakhir kini match byte-for-byte dengan source rilis terverifikasi.
Kalender memakai WIB/validasi tanggal; ekspor memakai parameter/filter yang sama
dengan produksi, batch 1000 dengan pemeriksaan jumlah/duplikasi/perubahan data.

Commit lokal penyelesaian:

- `30e8d9e` — fix: align date picker and presets with deployed WIB calendar
- `1120299` — fix: align data order filters and complete XLS export
- `cb5a5d6` — fix: preserve deployed role menus without duplicate links

Source yang diselaraskan: `src/lib/constants.ts`,
`src/app/(app)/orders/data/page.tsx`, `src/components/ui/date-range-picker.tsx`,
`src/lib/orders/data-order-export-params.ts`, `src/lib/date/ranges.ts`.
`src/lib/date/jakarta.ts` dan tes sebelumnya direview dan diamankan di Git tanpa
mengubah isinya. `tests/scripts/data-order-export-params.test.ts` dipertahankan
assertion lamanya serta ditambah no-resi/pagination/batas tanggal WIB;
`tests/scripts/date-ranges.test.ts` baru menguji rollover bulan/tahun, leap day,
minggu WIB dan batas timestamp inklusif. Tidak ada lookup/biaya/komisi berubah.

Verifikasi baru pada mixed working tree saat ini:

- **Full repo TypeScript PASS**; dua error gbDateFrom sebelumnya sudah hilang.
- Scoped ESLint PASS; sembilan run tes tanggal/ekspor/Jakarta di UTC,
  Asia/Jakarta dan America/Los_Angeles PASS.
- Build produksi terisolasi dari current source PASS (94 static pages,
  BUILD_ID + route summary tersedia); bukan deployment.
- 13 cek layout Data Order/Buku Order PASS pada 320/390/768/1440, scroll/frozen
  totals, date picker, error/empty dan dark mode. P&L empat ukuran, angka besar,
  timeout/retry/empty, stale-response guard dan CS gate PASS; tidak ada JS errors.
- Download XLS browser sungguhan dengan fixture **1.005 baris** PASS (dua batch,
  termasuk baris terakhir), periode SPX pilihan PASS, GB_NO_RESI mengikuti periode
  GB dan mengabaikan SPX PASS; perubahan data antarbatch ditolak tanpa download.
  Browser tes ekspor memakai timezone America/Los_Angeles.
- Semua RPC browser diintersep fixture sintetis; tidak ada ekspor/data pelanggan
  produksi yang dipakai. Normal-owner auth hanya untuk middleware uji lokal.
- Seluruh 13 UI source dan dependensi kalender/ekspor match manifest rilis.
  Query/export handlers dibanding pre-UI production baseline tidak berubah;
  nav owner 62→55, admin 59→52, CS tetap 1, advertiser tetap 7, akunting 14→10;
  tidak ada duplicate href atau perluasan role.

Bukti privat: `/root/backups/grandbook/ui-alignment-finish-20261021-65f0f5c8/`, termasuk checks.json, regression.json,
runtime.json, pnl-browser.json, export-browser.json, build.log, source parity,
backup/diff file lama. Isolated dev runtime dihentikan setelah tes. Semua dirty
content di luar claim tetap utuh; hanya file yang direview di-stage/commit.

**Batas klaim:** produksi/Liard/Safari iPhone fisik tidak dicek ulang dan tidak
berubah pada sesi ini; tidak push/deploy/SQL/mutasi bisnis/replay HPP. Seluruh
repo bukan mirror produksi: 416/453 file match, 27 berbeda, 10 hilang di luar
scope UI/dependensi ini. Full build PASS tidak membuktikan perilaku finansial
semua gap itu aman. Jangan deploy seluruh dirty checkout tanpa rekonsiliasi
scope terpisah dan izin eksplisit Barry. Gap settled-cash/manual commission serta
artefak recovery yang belum ter-commit dari audit vision tetap terpisah; tidak
diubah hanya karena status proyek sebelumnya PARTIAL.

**NEXT:** vision membaca bukti penyelesaian UI di handoff untuk review terhadap
auditnya. Claim Codex RELEASED; pekerjaan berikutnya harus claim baru.

---

## Checkpoint awal sesi UI — superseded oleh penyelesaian di atas


Updated 2026-10-21T16:46:48+07:00. Barry assigned vision read-only financial/business/dirty-tree audit and Codex UI implementation/testing, coordinated only through CODEX-HANDOFF.md. Codex claimed 13 UI files before editing.

## Result

Ten previously clean tracked files matched the verified pre-UI production baseline exactly. Their bytes now match the reviewed 21 October UI release. These were committed in two local commits:

- `a28005b` — style: preserve released shared typography and table layout
- `a798586` — fix: preserve released ledger and profit report UI

Integrated files:

- `src/app/(app)/laba-rugi/page.tsx`
- `src/components/ui/stat-card.tsx`
- `src/app/(app)/orders/pembukuan/page.tsx`
- `src/app/globals.css`
- `src/components/layout/app-header.tsx`
- `src/app/(app)/layout.tsx`
- `src/components/ui/page-header.tsx`
- `src/components/ui/table.tsx`
- `src/app/layout.tsx`
- `src/components/layout/app-sidebar.tsx`

## Three preserved gaps

- `src/lib/constants.ts`: working bytes match the pre-UI production release, but this file already has uncommitted changes against repo HEAD. Preserved rather than committing unknown prior role/navigation changes as Codex's work.
- `src/app/(app)/orders/data/page.tsx`: existing untracked source predates current deployed GB-date filters, checked export batches, snapshot counters, explicit error handling and WIB formatting. Preserved. Do not publish the working tree as if it were current production.
- `src/components/ui/date-range-picker.tsx`: tracked clean source still has browser-local date calculations, unlike the deployed WIB helpers/validation and responsive picker. Preserved because this reconciliation includes behavior beyond the UI-only source transfer.

Read-only before/after hashes and proposed gap patches are private at `/root/backups/grandbook/ui-source-alignment-20261021-972449e2/`; they contain source differences, not executable approval. vision can use them to map provenance. Codex must claim again before merging; do not blindly apply the whole files or infer vision ownership.

## Verification

- Exact before/released/after source hashes for all 13 files; ten equal release, three untouched.
- All initially dirty content outside the handoff preserved byte-for-byte. Existing author ownership remains NOT VERIFIED.
- App-only TypeScript check passes. Full repository TypeScript is NOT green: tests/scripts/data-order-export-params.test.ts lines 7 and 23 pass gbDateFrom to an older helper type that does not accept it. The helper/test files were not edited. This is a gap for the read-only dirty-tree audit, not permission to change export behavior.
- Scoped ESLint passes for nine TS/TSX files; globals.css is outside ESLint configuration and was exercised by browser rendering.
- Fresh isolated runtime copied current mixed working-tree source, with all browser REST reads mocked using synthetic fixtures. P&L passes widths 1440/768/390/320, trillion-scale currency, timeout/retry, empty result and CS UI gate; no JS errors or page overflow. Five ledger checks pass: desktop, finance totals/frozen-column behavior, 768/390/320, no narrow-screen frozen columns or JS errors.
- This smoke did not re-exercise the stale-response race or the three preserved files' changed behavior. Their earlier release tests remain historical evidence, not fresh mixed-source verification.
- No new optimized build, production browser, physical iPhone Safari, or Liard checks. No production financial read/mutation or SQL execution. Normal owner authentication was validated only to enter the isolated local fixture app; fixture RPCs did not write business data.

## Production and pending

No push, deployment, or live code/DB change this session. Main production remains the previously recorded release; its alias was not freshly re-queried. Liard remains independent. The repository is not certified as a reproducible release while the three source gaps, helper/tests mismatch and older dirty-tree dependencies remain. Do not deploy these local commits without Barry's explicit authorization and scoped reconciliation.

Bounded ten-file integration is complete. Full thirteen-file alignment is PARTIAL. Next: vision records read-only provenance findings for the three preserved files; Codex then claims and reviews the matching patches. Completed financial corrections are not replayed.
