# Financial readers F1/F2 — isolated candidate

Status: READY FOR REVIEW, NOT APPLIED LIVE. Session began23 October2026 and
crossed24 October WIB. Barry authorized candidate preparation only; no push/deploy.

## Exact scope

- F1: source-proven OrderOnline gross includes buyer shipping once. P&L derives
  goods revenue by subtracting already-included shipping; Buku buyer bill uses
  proven gross directly. All legacy/unproven inputs retain their prior basis.
  Profile identity AND a valid numeric gross_revenue equal to stored total are
  required. Malformed/mismatched/missing evidence never implies a correction.
- GP remains anchored to stored estimated_profit. No recalculation of orders,
  rates, HPP, commissions, payments or statuses. Residual columns retain legacy
  field names for RPC compatibility; UI/export call them Komisi/selisih estimasi,
  covering all roles/residual differences, not CS entitlement or payment.
- F2: manager Buku uses the same guarded recorded_cod_receipts source as dashboard,
  joins once by stable order number, and returns original amount/settled_at.
  Draft→final, mirrored final settlement, conflict/duplicate guards are covered.
  Staff keep their existing receipt access path. No new helpers, grants or RLS.
- UI patch changes three files only. Buyer bill/commission/receipt labels are
  honest. Existing absent row-detail fields stay unknown instead of fabricated
  zero; optional XLSX totals use real conditional COUNT/ROWS/SUM formulas.
  Buku date picker mounts on the client to avoid a cached-build-day hydration
  error after midnight WIB. Selection, period semantics and formulas stay intact.

## Artifacts and isolation

20261023000100-financial-readers.candidate.sql replaces only laba_rugi_summary
and list_pembukuan, with unchanged signatures/owner/ACL/security/config.
Both candidate and isolated-rollback.sql reject hosted/TCP databases and any
database other than financial_p1_review on a server with no TCP listener.
Baseline definition hashes also reject stale source. These are review artifacts,
not production activation scripts. SQL is NOT added to the active recovery manifest.

ui-labels.patch reconstructs exactly the tested private app sources; it has NOT
been applied to the shared authoritative src tree. review.json pins source hashes.

Do not apply these files to live. A later approved release needs fresh source/
data checks, a separately reviewed production activation artifact and recovery
successor; this session does not authorize those actions.

## Evidence

Private restore: checksum-verified20261022T192012Z-8e4d12b2, PG17, private Unix socket,
normal authenticated Owner/CS roles and existing RLS. All business table fingerprints
and function contracts match before/after tests.
Six historical/empty/reversed period comparisons preserve GP/net and unrelated
columns; no join duplicates/omissions, all receipt cells match guarded source.
Global Buku5749 receipts/Rp1082521138 exactly equals receipt source.

Fourteen synthetic SQL regressions, rollback/reapply, four normal8s latency
checks, seven XLSX/CSV checks and six built-app browser checks pass.
No JS errors or unexpected browser business calls. Widths1440/390/320 pass.
Optimized local build/TypeScript/scoped ESLint pass. UI screenshots/workbooks are
synthetic fixtures generated from real isolated SQL, not production screenshots.

Observed restore latencies: P&L Sept0.397s, Oct0.235s; Buku Sept50rows2.601s,
all-time50rows5.134s, each under8s. Not a hosted latency guarantee.

Regression runner (explicit dedicated socket only):
python3 tests/financial-report-readers/run.py --psql /path/to/psql \
 --socket /tmp/grandbook-financial-p1-socket-20261023 --port 55543 \
 --baseline-book /private/captured-list_pembukuan.sql --output /private/new-result

Browser/export tests require GRANDBOOK_P1_REVIEW pointing to the private review
directory; browser also requires GRANDBOOK_P1_BASE loopback URL and a private
GRANDBOOK_P1_SESSION path. No session values are included in these artifacts.

## Limits

Production activation/hosted browser/physical iPhone/Excel application recalculation
are NOT VERIFIED. Values and formula records were read back from downloaded XLSX.
This is not final realized cash profit or bank/invoice/expense completeness.
F3 packing and F4 ADS policy are outside this candidate.

The inherited Buku export action exports displayed page rows; this candidate does
not implement all-data export. Separate that existing limitation from completeness
of the SQL reader, whose full restored rows/receipts were verified.

NEXT: vision independently reviews candidate code/evidence read-only via
docs/CODEX-HANDOFF.md, without app/SQL/data changes or push/deploy.
