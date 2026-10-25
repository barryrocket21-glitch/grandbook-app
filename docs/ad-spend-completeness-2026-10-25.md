# Ad Spend complete filtered totals — 25 October 2026 WIB

STATUS: CANDIDATE VERIFIED, NOT PUSHED OR DEPLOYED.
Application commit c07422aa1be06bcc1294f03cf313e093f6592466.
Tests/evidence commit b5598cf; ownership claim 09b2a46.

## Result

The previous listAdSpend stopped at 1000 rows before filtering platform.
September lost 122 entries / Rp22,571,461 in table/KPI; the header separately
used an unfiltered full-range RPC. The candidate reads the complete chosen
period/source/campaign with checked normal-session ID-keyset batches of at most
500, then applies platform selection and deterministic date/creation/ID order.
Short pages cannot terminate the scan. Remaining counts, identity order, an empty
terminal response and final full count must agree; invalid costs reject the read.

Header and all four top cards share the identical complete filtered result and
existing KPI basis spend_total ?? spend. Recorded tax is included and labelled;
no rate/default/financial rule or stored value changes. Table pagination is 50
entries and never limits totals. The fourth card now counts distinct campaigns;
campaign profit moves into the separate Performa tab. Its existing RPC/calculations
are preserved, follow period/platform, and explicitly cover all sources. Selecting
a source withholds profit and explains the unsupported dimension rather than
inventing source-specific order/profit attribution.

Read failures hide prior/partial figures and provide retry. The existing shared
reader hook supplies scope/auth isolation, abort/sequence checks, unmount cleanup
and a 90-second timeout. Performance RPC failure/truncation has a separate error
and does not erase successfully read Ad Spend. Current normal-session performance
RPC returns 74 complete September rows with matching META/GOOGLE/SNACK identifiers.
Existing manual/CSV/import/update/delete payloads and handlers are byte-identical.

## Verified

- Actual candidate helper with normal Owner/RLS, no successful business mocks:
  September 1122 rows / Rp238001306, META930 / Rp166638796,
  GOOGLE129 / Rp59347213, SNACK63 / Rp12015297. Every identity and total matches
  the independently captured full reference. MANUAL1122 matches separately.
  26 read-only requests, no writes. The previously missing Rp22571461 is retained.
- Six transport/reader regression groups: 2307 matching rows over 123-row server
  pages, all platform/source combinations, campaign/date boundaries, tax decimals,
  null-total fallback, lead/CPR/campaign totals, valid empty, missing count/null
  data/invalid costs, duplicated identities, mid-read failure, drift and aborts.
- Nine built-loopback browser scenarios: all2407 rows across49 table pages,
  constant header/KPI totals, platform+source filters, delayed superseded responses,
  explicit performance scope, independent RPC error/truncation/retry, read errors/
  count drift without plausible partial totals, genuine empty periods, responsive
  1440/390/320 layouts and existing writer visibility for a synthetic CS profile.
  Browser business responses are entirely synthetic; no unexpected requests or
  browser errors and no business writes. Screenshots inspected at1440/390.
- Optimized Next16.2.4 build/TypeScript and scoped lint pass (three pre-existing
  unused-variable warnings retained). All14 immutable release-package tests pass.
- Immutable reviewed package457 inputs, exactly2 application paths changed,
  455 unchanged; built application matches packaged source (framework-generated
  next-env excluded from runtime-byte comparison; package uses its pinned template).
  Input SHA256 c8e2e2c3ab563019897e4b7118825c3420935865380fb543a0954ca4ad6e9777.
  Package /root/backups/grandbook/ad-spend-candidate-20261025/package.

Paths: src/lib/supabase/queries/ad-spend.ts,
src/app/(app)/ad-spend/page.tsx and their two intended release-manifest hashes.
Tests: tests/ad-spend-completeness/*.
Aggregate evidence/reproduction: scripts/releases/ad-spend-completeness/*.
Private evidence/build/screenshots remain outside Git at
/root/backups/grandbook/ad-spend-candidate-20261025. No tokens/customer rows in Git.

## Production and pending review

No push/deploy or SQL/recovery/correction replay. No live financial data/rates/
allocations/commission/settlement, Auth/RLS or role changes. Main last verified
dpl_2j1bzJSUTd3JNErNnKARXkcyo7a8 READY/bom1 is unchanged by this work; this is
not a fresh alias check. Liard separate/untouched. Three unrelated tracked dirty
files, operator/untracked work and active recovery manifest are preserved.

Independent vision review completed in 5e45dc3 at 08:21:11 WIB: all six Barry
checks PASS at source/mechanism and existing-artifact level. vision checked the
exact c07422a/b5598cf and current pins; no actionable candidate findings. They did
NOT rerun tests or validate the unpublished candidate in live. This bounded verdict
does not imply a hosted workflow pass. No application fix was needed; all457 input
hashes and the immutable package still match the reviewed candidate.

NOT VERIFIED: hosted publication of this candidate,
physical iPhone, transaction-wide consistency across every concurrent same-count
edit and extreme memory loads. The common reader explicitly rejects scopes above
100000 rows; a timeout or oversized scope is an error, never a complete capped total.
Cross-report spend versus spend_total tax-policy discrepancy remains outside scope;
no policy change is implied by aligning this page to its existing KPI basis.

vision e59aa83 export verdict is preserved: period/filter PASS, all-time31686
statement timeout P1 pending separately; no Buku source changes in this task.
Review request is recorded only in CODEX-HANDOFF.md; no automatic dispatch claimed.

NEXT: retain the reviewed candidate unchanged until Barry explicitly instructs
publication; no push/deploy is authorized now.
