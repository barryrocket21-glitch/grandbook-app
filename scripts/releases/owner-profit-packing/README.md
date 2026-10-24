# Owner Profit packing — reviewed source candidate

Barry authorized isolated preparation and push/deploy25 October2026.
20261025.patch adds the existing packing_fee_snapshot to the complete item read and
delivered item cost, including qty once. Null/zero remains the existing zero basis.
No orders/items, HPP/packing snapshots, roles, commission/settlement/rates or ADS
policy changed. No SQL, migration, new helper/dependency or recovery replay.
Other financial report readers remain unchanged.

Nine actual-route synthetic cases and before/after replay on frozen normal Owner/
RLS inputs pass; every row/platform reconciles, only GP and after-ADS profit change.
September effect22300 on9 delivered items; October0. All source data remain private.
Built loopback API also matches full candidate JSON for Sept/Oct and Facebook,
with current normal Owner Auth/RLS; missing session rejected. No mocked success
responses in built-runtime tests. Build/typecheck/scoped lint pass.

Run synthetic route tests with explicit GB_PACKING_CANDIDATE_ROOT and
GB_PACKING_BASELINE_ROOT pointing to source trees with existing dependencies:
node --test tests/analytics/owner-profit-packing/route.test.cjs
The harness runs the actual route/helpers offline with synthetic reads only;
it does not demonstrate RLS independently. Normal-session built runtime supplies
that separate evidence. Vision review is requested via handoff, not claimed done.

Review.json pins before/after hashes. Never apply a stale patch. Rollback is the
previous reviewed application deployment/source; do not restore/rewrite records.
