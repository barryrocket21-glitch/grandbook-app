# Dashboard numeric layout release — 2026-10-23

Barry explicitly approved push/deploy of the reviewed three-file preview.
Application commit: 50e21c3322aab5b709ee3774df655b75c488b89b.

## Scope and verification

Hero amounts use responsive font size. Cashflow spans the warnings grid and uses
one column on small screens, three on desktop. Pending pickup metrics stack and
channel rows wrap. No values, selectors, reads, formulas, permissions or financial
policy changed. Exactly three app inputs changed;454 remain identical.

Manifest/package:457 files, input SHA256
d605ccf0b2404bb6573faf24ed71ce9c391f87b5ec17a54ae3564cbf59930aaf.
CLI dry inventory and actual uploaded file SHA1s exactly match the immutable package.
Local optimized webpack build, TypeScript and scoped ESLint passed. Local Turbopack
could not follow the external dependency symlink; normal Vercel cloud build passed
without source changes.

Six normal Owner production browser checks passed: complete metrics match fresh
normal-session read; mobile390 no page overflow; real amounts fit1440/390/320;
refresh; browser-only controlled read failure; retry. Successful data was actual,
with only read calls to production. No business writes or SQL applied.
Environment and project configuration match their private before snapshots.
Original unrelated tracked dirty files retained byte-for-byte.

## Production

Main approved CLI deployment: dpl_a67itdDg1QrLHCUtjBCWb3XkBmCa, READY/bom1.
URL: https://grandbook-cy6wotbro-barrys-projects-41ecfbbc.vercel.app
Alias: https://grandbook-app.vercel.app/dashboard
Normal Git CI for50e21c3 completed READY before promoting this verified CLI candidate.
Closeout docs CI must finish normally, then the same candidate is re-promoted and
final-verification.json records current alias/settings/region. No settings modified,
no builds canceled, no force push. Liard deployment remains separate and untouched.

Private receipts/screenshots (not committed):
/root/backups/grandbook/layout-release-20261023-approved.
Handoff retains vision sections and requests independent read-only review.
Physical iPhone/Safari and vision's post-release review remain NOT VERIFIED.
