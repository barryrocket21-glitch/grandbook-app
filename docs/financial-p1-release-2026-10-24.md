# F1/F2 financial reader release — 24 October 2026 WIB

STATUS: Main LIVE VERIFIED. Barry explicitly approved push/deploy and continuation.
Vision independent source/evidence review694d32b PASS, RELEASED, preserved verbatim.
Application a148467; guarded activation/recovery5ed5187; normal Git push5ed5187.
Only two report functions and the exact reviewed three-file UI/export patch changed.
Candidate artifacts2ca899c/49b727b and historical recovery sources remain immutable.

## Changes

- laba_rugi_summary(date,date): proven OrderOnline shipping already in gross is
  subtracted from goods revenue once. Requires existing profile + numeric matching
  raw gross. Unproven legacy basis unchanged; stored estimated_profit/GP/net anchors
  unchanged. This is component presentation, not additional profit or a recalculation.
- list_pembukuan(date,date,text,text,int,int): finance roles read original draft/final
  receipts from guarded recorded_cod_receipts, once per reference. Existing staff
  path, signatures/owners/ACL/config/security, Auth/RLS and org isolation preserved.
- src/app/(app)/laba-rugi/page.tsx, src/app/(app)/orders/pembukuan/page.tsx,
  src/lib/orders/pembukuan-export.ts: honest buyer/residual labels, unknown optional
  details remain blank/—; genuine Excel conditional totals; client-mounted Buku date
  control fixes build-date/client-date hydration mismatch. Exact reviewed after-hashes.
- scripts/sql/financial-report-readers/release-20261024/{activation.sql,rollback.sql,
  reader-definitions.sql,review.json}: separate guarded release artifacts. Both
  function bodies exactly equal isolated candidate; rollback restores only readers.
- Recovery successor scripts/migrations/financial-readers-2026-10-24.json:
 36 upgrade/25 fresh references, full contract
 c2c9bafe7db9696ef28f018d4133baafcd4938cb418921facfcb1cbd25fe8d78.
 Historical manifest pnl-ui-2026-10-21.json and all old steps unchanged.

No record, cost engine, HPP snapshot, commission/payment/settlement/status/rate change.
No617/package/31 correction replay. SPX rules unchanged; no Auth/RLS/grant relaxation.

## Verification

- Fresh live source/whole schema match prior baseline8c93820b before activation.
  Guarded REPEATABLE READ activation checks full before/after31,434 Buku identities,
  all receipt cells, all non-target financial fields, GP/net and63 table fingerprints
  in the same snapshot. All pass. Exact full schema delta is only two definitions.
- All5749 receipts/Rp1,082,521,138 now match Buku and guarded source; before Buku
 627,727,510, difference454,793,628 from2348 draft receipts. No new money/payment.
  October component correction112,403,000; GP683,144,005.52 and after-cost projection
 467,583,363.52 unchanged. September component correction6,860,000; stored GP/net
  unchanged. Cohort/time basis is preserved; this is not settled cash profit.
- Isolated release activation, exact rollback/reapply and missing release gate
  rejection pass. Earlier exact-body candidate evidence:14 SQL regressions,
  six historical/empty/reversed cases,7 export checks,6 browser checks1440/390/320.
- Optimized webpack build/TypeScript pass, package14 tests pass. Immutable457 inputs
  match CLI dry inventory and actual uploaded SHA1s. Input digest
 1627afbd2d7066bf7aadc2867550818a96a0af0841847c5a9ce3a6f02263ae7d.
- Four normal Owner hosted REST checks pass: October P&L1.014s, September0.755s,
  searched Buku1.445s, payout1.533s. Observed values, not latency guarantees.
- Native Chrome Mac normal Owner: refreshed new P&L label and actual6325-order
  data/GP/net; Buku draft cash/buyer145000, GP109376, residual5000 and unknown details
  match fresh normal Owner RPC. Actual native Excel download inspected as XLSX:
  numeric buyer/cash/GP/residual, real SUM and conditional unknown-total formula.
  No customer identifiers or raw rows in this report/Git; workbook stays private.
- Automated VPS hosted browser did NOT complete: initial harness row-count issue
  corrected, later runs rejected by Vercel Security Checkpoint code21. No bypass.
  Native Mac checks replace desktop acceptance only; isolated responsive/error
  regressions remain separate evidence, not claimed as hosted passes.
- Existing source checker initially flags pre-existing untracked157 SQL in shared
  legacy folder. File preserved/excluded from app package as before. Unchanged
  checker passes in isolated source copy containing exactly160 pinned legacy files
  plus reviewed step sources and expected live inventory. No historical SQL replay.
  New full36-step fresh/upgrade recovery replay NOT run in this release.

## Production and limits

Main grandbook-app.vercel.app -> dpl_9gTqgjWqz6kXqZT1ir9nVFHy81Zs READY/bom1,
grandbook-4m6c3unwa-barrys-projects-41ecfbbc.vercel.app. Liard untouched/separate.
VPS push HTTP403; normal fast-forward push from isolated Mac bundle checkout works.
Ordinary Git build dpl_CEUNoCtEzAjoKdKPeJCTxVa5ktC5 completed READY/iad1 unchanged,
then reviewed bom1 CLI candidate promoted. No force/rewrite, guard changes or cancel.
Settings/env and three unrelated dirty files preserved; shared checkout not clean.
Private evidence: /root/backups/grandbook/financial-p1-release-20261024.

Closeout docs push also triggers normal Git CI; let it finish then re-promote SAME
approved bom1 candidate and require final-verification.json. No new app/SQL activation.

NOT VERIFIED: physical iPhone, hosted width/fault suite, Excel application
recalculation, full bank/cost/entitlement completeness or final realized cash profit.
Inherited Buku export still exports displayed page; all-data export is NOT fixed.
F3 packing/F4 ADS policy outside this release. Follow-up read-only F3 confirmed
September281 delivered items,9 with packing, omitted22300; no correction applied.

NEXT: prepare an isolated F3 packing candidate, preserving live records/rules.
