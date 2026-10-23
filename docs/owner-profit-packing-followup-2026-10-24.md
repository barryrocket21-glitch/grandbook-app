# Owner Profit packing follow-up — 24 October 2026 WIB

STATUS: READ-ONLY AUDIT COMPLETE, no source/SQL/data/rule changes.
Follows approved F1/F2 publication; independent work scope, not another deployment.
Coordination through CODEX-HANDOFF only; vision F1/F2 review remains preserved.

Deployed source src/app/api/reports/owner-profit/route.ts SHA256
49e95be0720759b557b4cb747d172d4caacfb77a844e337d76f00e01a5d9aac9.
OrderItemLite/select omit packing_fee_snapshot (:29,:146); delivered item cost
(:257) only qty*hpp_snapshot. Existing P&L cost includes packing snapshot*qty.
This is a report-reader omission; never rewrite historical item snapshots.

Fresh normal Owner/RLS paginated reads with exact counts:
September281 delivered orders/items,9 items nonzero packing, item HPP8621700,
packing22300, combined8644000. Under unchanged deployed route, omitted expense
overstates that cohort's gross/after-ADS result by22300 relative to same basis
including packing. This does not reconcile all P&L/Owner Profit basis differences.
October0 delivered items, packing effect0. Hosted October Owner Profit API HTTP200:
ADS215560642, after-ADS result−215560642, delivered0. September hosted API HTTP403
from VPS, current API totals NOT VERIFIED; source + fresh item arithmetic confirms
omission without treating older audit API totals as a new live response.
Reads not atomic; no customer fields included in this doc/Git.

Private evidence: financial-p1-release-20261024/f3-readonly-result.json +
private per-period rows. Zero writes/corrections/replay. No route edited.
NEXT: prepare isolated candidate adding packing snapshot to complete item read and
per-item cost, with report regression tests; no new P2 live change in this session.
