# Source alignment UI — 21 Oktober 2026 WIB

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
