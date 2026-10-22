# Approved main release — started 22 October; acceptance 23 October 2026 WIB

Verified: 2026-10-23T02:07:36.186359+07:00. Barry explicitly authorized push/deploy and continuation.
Main: https://grandbook-app.vercel.app.
Active deployment: dpl_BucY9PDZtzE1thQZMHZcGv2nKvw8, READY/bom1.
Application input commit: db7dfc3de7b425333e73f964e2ee72715e83bd2c.
453-file input SHA-256: 67625e47043f12edf1babae6140b362196bc32fc9845cf70f5bc347f2f9b59a3.
Immutable package: /root/backups/grandbook/main-release-20261022-1d7fa74c/certified-package-v2.

## Deployment and uploader correction

The first unpromoted candidate failed: unanchored supabase in .vercelignore also
removed src/lib/supabase. Only 272 source files reached Vercel. Local filesystem
package checks alone did not catch uploader semantics. Production stayed on the
old deployment throughout this failure.

db7dfc3 anchors root-only directory exclusions. Fourteen packaging/security tests
pass, including all manifest files surviving ignore rules and private operator
material staying excluded. Actual CLI --dry inventory and Vercel uploaded source
both match exactly 453 paths and SHA-1 file hashes. All application code matches
the tested readiness package; only ignore-file bytes changed. The successor
cloud build passed, then promotion succeeded. Region bom1 is function runtime;
a cloud build-machine location of iad1 is a separate setting.

## Git, settings and production acceptance

Outgoing history was reviewed as fast-forward with 30 initial commits/159 new blobs
and zero potential credentials under the reviewed scanners. Existing legacy remote
history was not rewritten. The VPS account sunoviz cannot push this repo (403).
The existing Mac account konorderbot has push permission. A verified Git bundle
and isolated Mac clone were used; no credential was copied to the VPS or changed.
Initial push ba07d2e..94f9fba succeeded. Later docs/recovery commits are source-neutral.

Git pushes trigger a default iad1 build. The existing main project's ignored-build
command was temporarily exit0 so that Git builds cancel and cannot replace the
verified bom1 candidate. Original value is null. Before release completion run the
saved final-check.py restore; its final-verification.json must confirm restored
baseline, unchanged alias/env/settings and terminal Git-trigger state.
The first Git-triggered deployment was independently verified CANCELED.

All seven Vercel environment records matched the captured baseline. Framework,
Node version, install/build settings, Git provider settings and region defaults
were preserved. No secrets/environment files were uploaded. No SQL/schema/data,
Auth/RLS, payment, settlement or HPP correction was executed.

Normal-owner P&L RPC reads returned HTTP200/one summary row for October1–22,
October22, September and all-time, in 3.95s, 0.51s, 1.77s, 2.37s.
No monetary result values/customer data were recorded in this document.

VPS browser passed P&L (1440/390; Inter/no page overflow), then Data Order reads;
Buku Order navigation hit Vercel Security Checkpoint HTTP403/708. This attempt
remains PARTIAL, with no bypass. Independent Chrome on Barry's Mac, using its
existing normal session, loaded all three production pages successfully:
P&L report visible; Data Order and Buku Order rows visible; Inter;
1440px viewport with document1434px; no loading/failure indicators.
Metrics contain counts only, no customer values. Temporary verification tab closed.
Synthetic 1005-row XLS and other fixture checks are linked in repo readiness;
a full new live customer export was not performed.

Liard was not modified. Its alias lookup returned404 in the existing main team;
its current version/browser acceptance is NOT VERIFIED. Physical iPhone/Safari,
provider/Auth recovery and broad financial-policy audit are also NOT VERIFIED.

## Authorized continuation and coordination

Current recovery manifest and P&L reader were preserved in commit3fcb219,
without byte changes or SQL replay. All35 dependency hashes match the workspace;
34 other dependencies still need review/versioning for a portable recovery kit.
See [recovery references](recovery-references-2026-10-22.md).
All vision handoff sections and unrelated dirty work were preserved.

Next: review the remaining34 recovery dependencies per scope. Keep the separate
settlement/manual-commission and profit-basis findings open; do not infer approval
to change live financial rules or replay completed historical corrections.
