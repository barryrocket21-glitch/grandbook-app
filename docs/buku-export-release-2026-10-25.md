# Buku Order export release — 25 October 2026 WIB

STATUS: RELEASED / Main live verified. Barry explicitly authorized push/deploy
of candidate `148110f` and verification through normal live access. This supersedes
the candidate's earlier NOT PUBLISHED state for this exact export scope only.

## Published result

Main `grandbook-app.vercel.app/orders/pembukuan` serves
`dpl_2j1bzJSUTd3JNErNnKARXkcyo7a8`, READY / bom1,
`grandbook-6wbkh33q1-barrys-projects-41ecfbbc.vercel.app`.
All 457 actual uploaded input hashes match the reviewed immutable package:
`bc8cd470ae5d840f29685f7e43a0c04547d3720e88db08a2ded5e745db39d35e`.
Only the two reviewed Buku page/export application files changed; 455 inputs
remain identical to the preceding packing release.

Push to main was a normal fast-forward through `9da5346`. Its ordinary Git CI
`dpl_C2NES7wYSVR3v2UucU58QAP2dbo3` completed READY/iad1 before promotion of the
exact reviewed bom1 candidate. No force/history rewrite, build cancellation,
build guard alteration, environment or project-setting changes were used.
The documentation closeout push follows ordinary CI, then re-promotes this SAME
bom1 candidate. Require the private final verification for final alias state.

## Actual live verification

Normal Owner Chrome session on Main HTTPS, successful business responses not
mocked; reference is an independently captured normal Owner/RLS reader result:

- September 1–30: actual XLSX download contains **6763 order rows**, one header
  and one TOTAL row. Every cell in all 36 columns matches the reference.
  **55743 numeric cells** retain numeric types/values, **45702 unknown numeric
  cells** retain blanks. Attribution, identifiers and real SUM/conditional TOTAL
  formulas/ranges/cached totals match. This is well beyond both the 50-row screen
  page and the 1000-row response cap.
- Check one row on page 1 and another on page 2, choose selected export: actual
  XLSX has exactly **two chosen identities**. All 36 columns, 14 numeric cells,
  16 unknown cells and formula ranges/totals match. This reads fresh values;
  checking boxes does not write business records.
- Same September period plus `DITERIMA` filter: actual CSV contains exactly
  **281 matching orders** plus TOTAL. Identities, attribution, buyer amounts and
  total match the reference. CSV contains values, not workbook formulas.
- Main Buku returns normal Owner controls and data without a load error. The
  final display was returned to all statuses / September with 6763 total and
  50 loaded. A screenshot excludes all customer rows.
- No-session Owner Profit API returns **401**; authentication remains enforced.
- Main alias READY/bom1, actual source hashes, environment/project settings,
  operator file/recovery hashes and vision's packing review section are verified.

Candidate evidence remains in `docs/buku-export-2026-10-25.md`:
9 reader/workbook regressions, 10 isolated browser scenarios, responsive containment
at 1440/390/320, optimized build/TypeScript/scoped lint and 14 package tests.
No new application changes were made during publication.

Private release evidence: `/root/backups/grandbook/buku-export-release-20261025`.
Native downloads remain in Barry's Mac Downloads; workbook/reference details and
session material are private. Public proof contains aggregate verification only,
no customer rows, credentials or session tokens.

## Boundaries and handoff

Business-data mutations **0**, SQL activation/recovery replay **0**; no stored
financial values/rules, commission/settlement/packing/courier rates, Auth/RLS/roles
or Liard change. Three pre-existing tracked dirty files and operator/untracked
work are preserved. Historical financial-reader recovery manifest is unchanged.

Vision coordination is only through `docs/CODEX-HANDOFF.md`. Packing review PASS
`6c05de7` is preserved; an independent read-only export post-release review is
requested there. No automatic dispatch/watcher or independent export verdict
is claimed.

NOT VERIFIED: physical iPhone, recalculation inside a physical Excel application,
independent vision export review, very large memory workloads, or a transactional
snapshot across every concurrent same-count edit. Completeness guards detect
count/boundary/identity drift and reject partial files; they are not a database
snapshot. Large exports may take time or need a retry when the source changes.

NEXT: vision independently validates this published export read-only through
the handoff; do not replay SQL or change records/rules.
