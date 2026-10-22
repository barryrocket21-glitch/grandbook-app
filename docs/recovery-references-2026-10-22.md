# Current recovery references — 22 October 2026 WIB

Two active P&L artifacts identified by vision are preserved with existing bytes:
scripts/migrations/pnl-ui-2026-10-21.json and
scripts/sql/pnl-performance/20261021000100-materialized-summary.sql.

Reader script SHA-256: 2f52ac8bde8acf27d17a78a2d41e7a7fed218579eb98d0b009098e543db49fb9. The contained function is byte-identical to the
previously applied candidate; the script adds a transaction and local lock timeout.
Manifest contract: 8c93820be367235647016c2aa3de335f74d80d905e46a14508f384867f5caaeb.
All 35 unique dependency hashes match the preserved workspace.
Before capture, 35 dependencies (including this reader) were outside Git.
Other dependencies remain preserved and need separate review/versioning; this
capture alone is not a self-contained fresh-checkout recovery kit.

The function is STABLE and retains its organization scope and invoker context.
The installation script is historical: no SQL was executed, schema/grant/RLS
changed, customer data updated, historical correction replayed, or fresh restore
claimed. HPP 617, package batch, and 31 HPP remain completed.
Private archives remain external. Provider/Auth recovery and financial-policy
gaps stay separately open.

Next: review remaining manifest dependencies per scope before portable recovery.
