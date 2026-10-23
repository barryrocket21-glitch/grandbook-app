# Dashboard Owner accuracy — 23 October 2026

Scope #1: complete dashboard totals and explicit unavailable states. Candidate only;
no push/deployment, financial-rule change, schema/SQL execution, customer/order
mutation, role/RLS change, or replay of completed corrections.

## Findings and correction

The previous client read five tables without pagination/count validation and
ignored query/RPC errors. Client-side sums covered at most one server page;
unavailable responses could render as valid zero. The thirty-day chart also
lacked previous-month rows and mixed browser/UTC dates.

The candidate reads all five sources in ascending ID order using the existing
completeReportRead helper, exact remaining counts, and a final full-count check.
A short page does not imply completion. Errors, missing counts, duplicate IDs,
changed counts, mismatched item/parent relationships, overlapping order numbers,
invalid numeric/date fields and malformed payout summaries reject the result.
An oversized read (the shared helper's existing 100,000-row guard) also fails
explicitly; no successful truncated result is displayed.

The source interval is the union of the current month and the last thirty days,
ending today in Asia/Jakarta. Monthly KPIs and top products remain month-only.
The chart includes previous-month dates; future-dated rows are excluded. A
successful screen displays its period, source coverage and read time. Failed
reads or refreshes display retry without old/partial totals. Valid empty responses
still produce legitimate zero. Null stored estimates produce unavailable totals
and a coverage notice, rather than invented zero.

Pickup and cashflow widgets now validate their existing RPC responses and show
explicit retry states. Requests are scoped to verified user/profile/organization/
role; cancellation, sequencing, cleanup and a ninety-second timeout protect reads.

## Preserved financial basis

- Omzet: stored totals excluding CANCEL and FAKE, draft plus final.
- Running estimate/cost/COD fee/PPN: stored fields for nonterminal orders.
- Delivered estimate: stored estimated profit in final DITERIMA orders, retaining
  previous scope. Label clarifies it is an estimate, not realized cash.
- ROAS: existing ad_spend.spend basis; no switch to spend_total.
- Returns: RETUR / (DITERIMA + RETUR); fake rate: FAKE / all monthly orders.
- Product ranking: canonical lookup names, quantity times item price.
- Chart difference: omzet minus ad spend, explicitly not net profit.
- COD: existing get_payout_position, all periods, separately labelled.
- No HPP, commission, settlement, SPX tariff, attribution or business-engine
  changes. The separate semantic/accounting audit remains outside scope #1.

## Evidence

Normal Owner Auth with existing RLS, read-only capture: 8,673 draft rows for the
combined source window; 6,325 monthly draft rows and 6,325 monthly items;
1,097 ad-spend rows (770 monthly); zero final orders in this window. No
cross-source identity overlap or missing monthly items. No null estimates in
this sample. Payout/cashflow/pickup RPCs each returned one valid row. This does
not assert all historical business estimates are correct.

A separate normal-session request with no limit/pagination confirmed the live
default response:1,000 monthly drafts and1,000 monthly items, versus6,325 each.
The previous screen omitted5,325 monthly draft/item rows in this sample.

Actual candidate reader completed in 5.572 seconds. Its result matched the
source capture and an independent Python Decimal calculation: seventeen numeric
metrics, all ninety daily chart values, all status counts and five top products.
Private raw data/session material stays outside Git and docs.

Twenty-two SDK/model tests pass: all five tables >1,000, exact boundaries,
smaller server caps, failures in every paged table, changing counts, duplicates,
failed final counts, unavailable/malformed RPCs, empty data, WIB midnight/month/
year/leap boundaries, previous-month chart, future exclusion, preserved formulas,
null estimates, overlapping sources, missing/changed relations and cancellation.
Full TypeScript and scoped ESLint pass.

Fourteen browser runtime checks PASS, using normal Owner middleware and entirely
synthetic business responses: >1,000 rows under server cap399; plotted paths;
distinct small-value axis labels; desktop/tablet/mobile320/390/768 layout;
initial/page/RPC failures hiding old/partial/zero fallback totals; genuine empty
data; widget failure/retry; stale-response cancellation; client CS gate without
business reads. Screenshot inspection confirms readable chart axes. Compact
Indonesian number labels avoid different ticks rounding to the same 0.1jt label.

Immutable 457-input package verification, independent Git clone source preflight,
and isolated optimized production build PASS. Fourteen packaging tests and eight
recovery-reference tests PASS; the35-reference graph is unchanged, SQL executed0.
Cloud Vercel build/upload, real Safari and production smoke for this candidate
are NOT VERIFIED: no push or deployment was authorized/performed for this scope.

Current application source:61aaa6cf24fafe1aaa1e32aaa0f103dafc68cf0c.
Package digest:3155efade91d06cbbcb5e8c47b5128994fe1f4d864b53372bbc15b190d58dafd.
Private immutable package:release-package; build output:build-release.
451 baseline application inputs are byte-identical to the prior certified
release; exactly six changed/new app inputs, including three new modules.

## Source and coordination

Six application inputs: dashboard page; pickup and cashflow widgets;
src/lib/dashboard/accuracy.ts, read.ts and use-dashboard-read.ts.
Tests: tests/dashboard-accuracy/read.test.ts and browser.cjs.
Release manifest/tool/README/count fixtures advance 454 to 457 reviewed inputs.

vision's read-only validation f4a070f is preserved. Codex's earlier claim was
lost during a concurrent handoff save and restored without modifying vision's
section. All coordination remains in CODEX-HANDOFF.

Private evidence: /root/backups/grandbook/dashboard-accuracy-20261023-0aa019a3.
Unrelated dirty/untracked work is preserved. Main and Liard remain separate;
neither is deployed by this work.

## Limits

Multiple HTTP requests are not a database transaction. Counts, IDs and related
parent fields detect many concurrent changes but cannot guarantee one snapshot
against equal-count edits to already-read values. Period/read time are visible;
refresh if sources change. A future atomic server aggregate requires a separate
reviewed and approved database change.

This fixes completeness/read failures, not historical HPP, settlement evidence,
attribution coverage, or spend versus spend_total policy. New production release
requires Barry's explicit approval.

## Final status

Implementation, verification and local commits complete. All Codex edit claims
released. No push/deployment or database/financial-rule changes. Shared checkout
still contains unrelated dirty/untracked operator work, preserved exactly; use
the immutable reviewed package for any later approved release.

The handoff asks vision to review the candidate evidence read-only. Its original
validation remains unchanged; post-implementation review is not yet confirmed.
NEXT: obtain Barry's approval for this scoped push/deployment.
