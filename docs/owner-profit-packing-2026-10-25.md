# Owner Profit packing release — 25 October 2026 WIB

STATUS: Main LIVE VERIFIED. Barry explicitly approved isolated candidate preparation
followed by push/deploy; no business-data or financial-rule mutation authorized or done.
Candidate090481b; applicationbff45db; closeout documentation follows.

## Final change

Only src/app/api/reports/owner-profit/route.ts changed among457 application inputs.
Complete per-item read now includes existing packing_fee_snapshot. Delivered item
cost is qty * (hpp_snapshot + packing_fee_snapshot), using the same existing quantity
and null/zero handling. Other statuses retain their prior recognition. The explanatory
note says HPP and stored packing. No new helper/dependency/query cap or schema field.

This deducts an existing historical cost missing from this report. It does not change
stored item/order costs, estimated_profit, commissions, settlement, SPX rates, ADS
policy, Auth/RLS/role gates, or other financial report readers. No SQL/migration/
recovery/correction replay, including617/package/31. Active recovery manifest
financial-readers-2026-10-24.json is byte-identical to238da60.

Artifacts: scripts/releases/owner-profit-packing/{20261025.patch,review.json,README.md}
and tests/analytics/owner-profit-packing/{route-harness.cjs,route.test.cjs}.
Review pins baseline49e95be0 and exact tested after-hash. Data/sessions stay private.

## Verification and impact

- Nine synthetic cases execute actual route + unchanged report helpers offline:
  per-qty/once-only deduction; separate product costs; null/zero parity; decimal
  cents; non-delivered/return/cancel parity;1201 delivered items with short pages;
  failed read ->503; unchanged Auth/roles; platform filter exclusion.
  Synthetic read adapters test arithmetic/contracts, not RLS independently.
- Fresh normal Owner/RLS reads use pagination + exact counts/recheck. Full frozen
  Sept/Oct source captures include orders/items/commissions, campaigns/allocations/
  products/ADS and guarded shipping evidence. Baseline replay EXACTLY matches
  actual live before-API JSON for BOTH months. Reads are not an atomic snapshot.
- Independent Decimal oracle compares every product/platform and totals on identical
  inputs: only gross_profit_before_ads and profit_after_ads change (plus one note).
  All identities, counts, revenue, ADS, commission/shipping effect, coverage and
  non-profit fields remain unchanged. September310 final orders/items:
 281 delivered,29 returned;9 delivered items have packing totaling22300.
- September GP32652792.90 ->32630492.90; after-ADS−205348513.10 ->−205370813.10.
  October0 delivered; packing delta0 and after-ADS−215560642 unchanged.
  These are report results, not settled cash profit or rewritten stored GP.
- Optimized webpack build/TypeScript/scoped ESLint PASS.14 package tests pass.
 457 dry-upload AND actual uploaded source hashes match;456 baseline inputs unchanged.
  New input digest18d320be16bb3e4a0e9eca602dd136d8d85479008452e925b0ee803a8bfa1bbc.
- Built loopback candidate (127.0.0.1:55535), actual normal Owner Auth/RLS and
  successful responses NOT mocked: full Sept/Oct JSON and Facebook subset exactly
  match candidate oracle; absent session rejected.
- Actual Main HTTPS after promotion: same three authenticated cases exactly match;
  no-session401. This verifies deployed API/financial output, not a new browser/
  visual acceptance pass. UI markup/styles/signature remain unchanged.
- Settings/environment unchanged; three unrelated dirty files preserved. Vision's
  prior review sections preserved verbatim. New independent packing review by
  vision NOT VERIFIED; requested through handoff only, no automatic watcher claim.

## Production / rollback / limits

Main grandbook-app.vercel.app -> dpl_E7yyof7ufEkNHFjiDSHmEzwMerm3 READY/bom1.
URLgrandbook-qk1sokq2w-barrys-projects-41ecfbbc.vercel.app. Source pushbff45db
normal fast-forward via isolated Mac bundle. Ordinary Git CI
dpl_Cj9H14n11hmCJYqcBiBu6jPw3L3o finished READY/iad1 before reviewed bom1 promotion.
No force/rewrite, build cancellation or guard/project changes. Liard separate,
untouched. No SQL executed and no business writes. Shared checkout not globally clean.

Rollback uses previous reviewed application deployment
dpl_9gTqgjWqz6kXqZT1ir9nVFHy81Zs after checking for newer work; do not revert records
or replay SQL. New report source can be reverted as a separate reviewed app change.

Private evidence /root/backups/grandbook/owner-profit-packing-20261025:
capture-summary.json, route-tests.log, oracle-result.json, isolated/live-runtime-result,
candidate/precloseout/final-verification.json and source-parity.json.
Closeout docs push triggers normal Git CI: let it finish, re-promote SAME approved
bom1 candidate, require final receipt. No new source/SQL activation in closeout.

NOT VERIFIED: new independent vision packing review, physical iPhone/browser UI
acceptance, final realized cash profit or complete actual-cost/bank/commission
evidence. Existing legacy null packing stays zero basis, not proof no real cost.
ADS tax-policy discrepancy/F4, page-only Buku export and personal dashboard findings
are outside this one-file release.

NEXT: vision independently validates this published packing change read-only via
CODEX-HANDOFF, without record/rule/source changes or SQL replay.
