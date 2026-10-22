> Superseded for upload/deployment by [the approved main release](main-release-2026-10-22.md). Source-package checks passed here, but CLI upload later exposed an unanchored ignore rule; commit db7dfc3 fixes it and actual 453-file upload parity is verified. The original evidence below is retained.

# Main repo release readiness — 22 October 2026 WIB

**READY for a controlled main application release; NOT PUSHED / NOT DEPLOYED.**
Verified 2026-10-22T19:18:18+07:00. Barry authorized reconciliation of the remaining 37 source gaps,
explicitly forbidding push/deploy. vision's audit/verification were RELEASED;
coordination and claim were recorded in CODEX-HANDOFF.md before edits.

## Result and source of truth

Fresh Vercel API reads verify main alias still serves
`dpl_EbCS3prnBTgsLF1LkgqVGcPjkeuJ`, READY/bom1, and all 453 archived uploaded source
files match Vercel file hashes. Liard was neither changed nor certified equivalent.
The 27 divergent files and 10 missing files are resolved. All 453 package inputs
now come from committed Git blobs (generated next-env.d.ts comes from a committed
template). No unexplained gap or missing input remains.

Source commit tested: `e943053bb82902db1a12b666f997e2b5bae231d7`. Canonical input SHA-256:
`2d93a10276ce76f412232aa1520e44fda0e4247a56c1ba13dcd2d870c253c086`. The docs-only closing commit may change HEAD without changing this
input digest. The immutable reviewed package is `/root/backups/grandbook/repo-readiness-20261022-3cb68d37/certified-package`;
its preparation audit is the sibling certified-package.readiness.json.

449 inputs are byte-identical to live production. Four reviewed deviations:

- `.vercelignore` — Exclude private/operator/local-config artifacts from uploads.
- `src/app/(app)/financial-position/page.tsx` — Defer initial remote read to a cleaned-up zero-delay timer; no query/formula/role change.
- `src/components/dashboard/cashflow-summary-widget.tsx` — Defer initial remote read to a cleaned-up zero-delay timer; no query/formula/role change.
- `src/app/(app)/reconciliation/spx-cashflow/page.tsx` — Defer initial remote read to a cleaned-up zero-delay timer; no query/formula/role change.

The three scheduling changes defer initial remote reads through zero-delay timers
and clear the timers on unmount. Query bodies, formulas, schemas, roles, Auth/RLS
and business data are unchanged. .gitignore/.vercelignore protect session/env
files, Supabase CLI state, screenshots/spreadsheets and local project settings.
The release tool exports only the fixed allowlist, rejects dirty/missing inputs,
nonregular Git objects, unsafe paths, wrong hashes and credential patterns, and
never overwrites existing output. It contains no push/deploy/promote operation.

## Reconciled paths

| Path | Initial gap | Resolution |
|---|---|---|
| `src/lib/converter/wa-paste-phone-dup.ts` | different | Verified deployed source restored |
| `src/lib/supabase/queries/commissions.ts` | different | Verified deployed source restored |
| `src/components/dashboard/cashflow-summary-widget.tsx` | different | Reviewed deviation above |
| `src/app/(app)/orders/export-resi/page.tsx` | different | Verified deployed source restored |
| `src/lib/schemas/wa-paste-request.ts` | different | Verified deployed source restored |
| `src/app/(app)/orders/new/page.tsx` | different | Verified deployed source restored |
| `src/app/api/orders/wa-paste/existing-phones/route.ts` | different | Verified deployed source restored |
| `src/app/api/orders/wa-paste/submit/route.ts` | different | Verified deployed source restored |
| `src/app/(app)/team/cs/[userId]/page.tsx` | different | Verified deployed source restored |
| `src/lib/analytics/complete-report-read.ts` | missing | Verified deployed source restored |
| `src/lib/format.ts` | different | Verified deployed source restored |
| `src/lib/analytics/profit-cost-evidence.ts` | missing | Verified deployed source restored |
| `src/components/products/product-variant-form.tsx` | different | Verified deployed source restored |
| `src/lib/converter/preview.ts` | different | Verified deployed source restored |
| `src/app/(app)/commissions/spx/page.tsx` | missing | Verified deployed source restored |
| `src/lib/converter/engine.ts` | different | Verified deployed source restored |
| `src/app/(app)/reconciliation/spx-cashflow/page.tsx` | different | Reviewed deviation above |
| `src/lib/orders/export-groups.ts` | missing | Verified deployed source restored |
| `src/components/team/cs-regions.tsx` | missing | Verified deployed source restored |
| `.vercelignore` | missing | Reviewed deviation above |
| `src/lib/commissions/spx-preview.ts` | missing | Verified deployed source restored |
| `src/app/(app)/commissions/my/page.tsx` | different | Verified deployed source restored |
| `src/app/(app)/team/cs/page.tsx` | different | Verified deployed source restored |
| `src/lib/types.ts` | different | Verified deployed source restored |
| `src/lib/supabase/queries/team.ts` | different | Verified deployed source restored |
| `src/app/(app)/reports/owner-profit/page.tsx` | different | Verified deployed source restored |
| `src/app/(app)/orders/wa-paste/page.tsx` | different | Verified deployed source restored |
| `src/app/api/reconciliation/spx-cashflow/sync/route.ts` | different | Verified deployed source restored |
| `src/app/(app)/financial-position/page.tsx` | different | Reviewed deviation above |
| `src/lib/supabase/queries/crm.ts` | different | Verified deployed source restored |
| `src/app/api/commissions/spx-preview/route.ts` | missing | Verified deployed source restored |
| `src/app/(app)/orders/bulk-upload/page.tsx` | different | Verified deployed source restored |
| `src/app/(app)/commissions/manage/page.tsx` | different | Verified deployed source restored |
| `src/lib/reports/owner-profit-export.ts` | different | Verified deployed source restored |
| `src/app/api/reports/owner-profit/route.ts` | different | Verified deployed source restored |
| `src/lib/orders/phone-warning.ts` | missing | Verified deployed source restored |
| `src/lib/analytics/ads-coverage.ts` | missing | Verified deployed source restored |

All prior working versions and before/after patches remain private at
`/root/backups/grandbook/repo-readiness-20261022-3cb68d37/before-source` and `review-diffs`. In particular, the local auto-provision-CS
engine variant and retired cashflow/team implementations were preserved rather
than silently discarded or applied. The six named historical SQL files outside
the release remain in place and are excluded from the certified package. Existing
historical migration references included in the live source were versioned as
references only: no SQL script was applied or replayed.

67 manifest inputs were untracked at the start (including generated next-env).
Reviewed matching dependencies, guards and schema references were committed per
domain so a fresh checkout no longer depends on ignored/untracked source.
The generated file itself stays ignored; its immutable template is versioned.
465 initially dirty paths outside the claim remain byte-for-byte intact.
No stash/reset/clean/force-push/history rewrite was used. Remaining unrelated
work may still be dirty; it is deliberately not an application release input.

## Verification actually performed

- A fresh detached Git clone at the tested source commit; its local origin was
  removed. Source preflight, preparation and verification pass for exactly 453
  files. No shared working-tree source is used to fill missing Git inputs.
- **npm ci --include=dev --ignore-scripts**, frozen package-lock, independent
  node_modules (not a symlink to the old pnpm installation): PASS.
- Full fresh-checkout TypeScript: PASS. Scoped restored-source ESLint: zero
  errors; four nonblocking warnings remain about intentional generation-counter
  cleanup and dropping raw courier payload. No broad legacy lint cleanup claimed.
- 18 relevant existing unit suites passed in the shared source; 11 committed
  Node suites passed again against the fresh checkout. Synthetic tests cover
  1,201-record report/payroll reads, failed/truncated pages, exact cost evidence,
  commission deduplication, auth/org/write guards, WIB boundaries, canonical
  product groups and cancellation of duplicate-phone intake without submission.
- 12 packaging tests pass in both environments: Git-only reconstruction, private
  material exclusion, dirty/missing source, extra application files, symlinks,
  traversal, hash tampering, duplicate keys, credential patterns, package changes
  and refusal to overwrite existing output.
- Production-optimized build from the certified source with the clean locked
  dependencies: PASS, recorded process exit 0. Production environment remains
  external/private; no .env or credentials were copied into Git/package.
- Browser fixture runtime also uses the certified source and clean dependencies:
  13 Data/Buku Order layout checks, P&L four widths/error/retry/stale-response/CS
  gate, XLS 1,005 rows plus chosen SPX/GB-no-resi periods and concurrent-change
  rejection, and ten restored-domain checks all pass, with zero JS errors.
  Restored-domain checks include complete 1,201-row manage/personal commission
  totals, hiding incomplete payment totals, owner-profit success/error, CS
  overview/drilldown cohort/products/regions, read-only SPX commission preview,
  and empty/history views of cashflow/financial position. No Apply/payment/submit
  action was invoked. Business REST/API calls were synthetic, not live DB writes.
- A pinned read-only schema inspector verified the existing production DB contract
  `8c93820be367235647016c2aa3de335f74d80d905e46a14508f384867f5caaeb` (222 public functions),
  identical to the expected checkpoint. This probe reads metadata only, not order
  rows, and applies no SQL. Normal-owner middleware authentication was validated
  separately; browser business responses are fixtures. Completed HPP/package/
  commission/courier corrections are untouched.

Initial failures are retained privately. The old duplicate-message assertion was
updated to the deployed same-WIB-day wording and phone values are fabricated.
Two browser harness defects were fixed without product changes: selecting the
identified ledger total instead of transient loading rows, and exposing the
PostgREST count header in the synthetic cross-origin response.

## Git commits

- `a22987b` — order workflows: converter libraries (10 reviewed files)
- `d566b33` — order workflows: order API routes (8 reviewed files)
- `4d4d7a5` — order workflows: order screens (12 reviewed files)
- `9901cb5` — order workflows: request schemas and helpers (6 reviewed files)
- `ca12557` — commissions (6 reviewed files)
- `1896e22` — financial-readers (10 reviewed files)
- `c64cb30` — auth-guards 1 (8 reviewed files)
- `6689ebe` — auth-guards 2 (8 reviewed files)
- `69d74bb` — auth-guards 3 (2 reviewed files)
- `7eac43e` — release-config (3 reviewed files)
- `5125aeb` — reconciliation (10 reviewed files)
- `0df43a1` — cs-reports (7 reviewed files)
- `c6acaff` — historical-schema 1 (8 reviewed files)
- `42bd0b1` — historical-schema 2 (8 reviewed files)
- `8355ff4` — shared-models (9 reviewed files)
- `8f81a8f` — reviewed-regression-tests (7 reviewed files)
- `e943053` — release-controls (6 reviewed files)

## Release boundary / limits

Use the [reviewed Git preparation tool](../scripts/releases/repo-readiness/README.md),
not the shared dirty directory. That directory still has unrelated local
vercel.json, package-manager files, docs/jobs and operator work; they are not
silently included. For any later approved release use the verified MAIN project
identity from its private configuration and explicit **bom1**; never infer it
from the shared .vercel directory or treat Liard as the same project.

**NOT VERIFIED:** a new Vercel build/deployment, promotion, new production browser
acceptance or physical iPhone Safari. None was attempted because Barry prohibited
push/deploy. Source readiness does not close vision's existing financial-policy
questions about settled cash/manual commission transitions, or certify complete
provider recovery; those behaviors were not changed to make this task pass.
Historical financial corrections must never be replayed because a broader project
status remains PARTIAL. Keep existing private recovery artifacts intact.

Private evidence and fixture harnesses: `/root/backups/grandbook/repo-readiness-20261022-3cb68d37/`. Public review bundle contains only
synthetic screenshots and non-sensitive verification summaries. Test servers were
stopped after acceptance. Claim Codex RELEASED at completion.

**NEXT:** wait for Barry's explicit permission before pushing or deploying the
reviewed Git package. No approval is inferred from this readiness result.
