# Buku Order complete export — 25 October 2026 WIB

STATUS: candidate complete, committed and packaged; NOT pushed/deployed.
Application commit `148110fd94d17d13a095b99ed9a9b05b67a344e8`.
Tests/reproduction commit `74f698b`; ownership claim `07fd7c1`.

## Problem and resulting behavior

`/orders/pembukuan` loads one page (default 50, selectable up to 1000). Its
previous export passed only `displayed` from that page into the workbook builder.
Comments incorrectly claimed all filtered data had already been loaded.

The export scope selector now offers all matching rows or checked rows across
pages. Date range/all-time, status, search and zone apply to the entire export.
Selected rows use compound `source:id` identity and fresh reader values. Individual
and current-page selection, selection count and clear controls are available;
changing filters clears selection. An off-page zone no longer disables export or
strands pagination. Page summary values still describe the loaded page.

The existing normal-session RPC is read in HTTP batches of at most 500. Its
internal limit is explicitly null and offset zero, allowing PostgREST to apply
complete-result ordering and ranges. The additional `source` tie-breaker makes
date/id ordering unique across final/draft rows. No SQL change is required.
The collector checks counts, identities, overlapping boundaries, termination
and a final leading-row recheck. Failure/drift/cancellation produces no file.
Progress, cancellation, concurrent-export guard and scope/auth/navigation aborts
are included. Page reads also reject aborted stale responses.

## Excel and financial semantics

Numeric cells, original decimals, attribution, string identifiers, unknown blanks,
SUM total formulas and conditional unknown-total formulas are preserved. Values
come from the existing financial reader; this does not recalculate stored order
finances or introduce new commission/settlement/packing rules. CSV contains values,
not live formulas. Excel's native one-sheet row limit is checked and excess rows
are rejected rather than silently cut.

## Verified evidence

- Nine reader/workbook regression tests pass with 2407 synthetic rows: overlapping
  ranges, source/id collisions, short responses, zone and selected scope, missing
  selection, error/count/identity/boundary/head drift, invalid responses, abort,
  empty results, numeric decimals, formulas, attribution and identifiers.
- Ten built-loopback browser scenarios pass, with eight actual downloads:
  2407 single-period rows, three checked rows across pages with freshly changed
  synthetic financial values, page selection/clear, 307 off-page zone matches,
  1000 search matches, 1050 status matches, 30 different-period rows, 2454 all-time
  rows, mid-read error/count drift without downloads, cancellation and retry.
  No unexpected external requests or browser errors; business writes zero.
  Ringkas/Keuangan/export controls contained at 1440, 390 and 320 pixels.
- Actual normal Owner/RLS reader scan, September 2026: 6763 rows / 6763 unique
  identities, 16 requests, approximately 59 seconds. No mocked successful data
  for this reader check; no customer rows/tokens saved in repository evidence.
- Optimized Next 16.2.4 build, TypeScript, scoped ESLint and 14 release-package
  regression tests pass. Existing middleware deprecation warning remains.
- Immutable package: 457 inputs, only two application files changed; 455 input
  hashes retained. Input SHA256:
  `bc8cd470ae5d840f29685f7e43a0c04547d3720e88db08a2ded5e745db39d35e`.

Detailed reproduction: `scripts/releases/buku-export/README.md` and
`tests/orders/pembukuan-export.{test.ts,browser.cjs}`.
Private evidence/package: `/root/backups/grandbook/buku-export-20261025`.
Business fixture screenshots/downloads and normal-session material stay private.

## Production, coordination and limits

Changed app paths: `src/app/(app)/orders/pembukuan/page.tsx` and
`src/lib/orders/pembukuan-export.ts`; release manifest updated for those hashes.
No live data, financial rules, Auth/RLS/roles, SQL definition/activation, recovery
manifest or completed correction was changed/replayed. Liard untouched.
No push/deploy in this scope. Last verified Main remains the packing release
`dpl_E7yyof7ufEkNHFjiDSHmEzwMerm3` / app `bff45db`; this is not a new alias check.
Vision's independent packing PASS `6c05de7` is preserved. Export review requested
through the handoff only; no automatic dispatch or export verdict claimed.

NOT VERIFIED: independent vision export review, hosted release of this candidate,
physical iPhone/Excel application recalculation, transactional snapshot consistency
during every concurrent same-count edit, extremely large browser-memory workloads.
Completeness guards cannot prove absence of all simultaneous edits. Large exports
take time; detected drift asks for retry. Unrelated operator files/untracked work
are preserved and are not part of the release package.

NEXT: independent read-only review of this exact candidate through the handoff,
then a separately authorized push/deploy; do not replay SQL.
