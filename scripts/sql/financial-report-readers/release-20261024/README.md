# Approved F1/F2 reader release

Barry authorized publication24 October2026. See docs/financial-p1-release-2026-10-24.md.
Separate activation/rollback require pinned release session settings and exact
baseline definition hashes. Exactly two CREATE OR REPLACE bodies, no grants or
business DML. Body parity with immutable isolated candidate is pinned by review.json.
Never remove isolation guards from the historical candidate or run old corrections.

reader-definitions.sql is the sole additive recovery successor source; existing
35/24 recovery references remain unchanged. New manifest36/25 was source/hash checked
against exact live schema; no historical replay. Rollback only readers after checking
newer changes. Do not revert records, restore the entire DB, or change Auth/RLS.

Main bom1 release and Liard remain distinct. Workbook evidence/private session files
must not be committed. Buku all-data export remains a separate existing limitation.
