# Reviewed main release preparation

This tool only reads Git and prepares/verifies a local package. It never pushes,
publishes, deploys, reads credentials, or applies SQL. Barry must separately
authorize any later push/deployment. Main and Liard are independent.

The manifest contains the 453 source inputs verified against main Vercel
`dpl_EbCS3prnBTgsLF1LkgqVGcPjkeuJ`, bom1. The sole source deviation is a stronger
.vercelignore. Generated next-env.d.ts is reconstructed from a committed template;
the ignored working copy is not a source of truth. Historical SQL is retained
without replay. Private operator work stays outside this application release.

From a committed checkout, run:

```sh
python3 scripts/releases/repo-readiness/release.py check
python3 -m unittest discover -s tests/releases/repo-readiness -p 'test_*.py'
python3 scripts/releases/repo-readiness/release.py prepare --output /tmp/grandbook-reviewed-release
python3 scripts/releases/repo-readiness/release.py verify --package /tmp/grandbook-reviewed-release
```

Use a fresh output path; nothing is overwritten. The package has exactly 453
files; audit metadata is a sibling file. Prepare refuses dirty/missing reviewed
inputs, unreviewed application source, Git symlinks, wrong hashes, path traversal
and credential patterns. Unrelated docs/jobs/SQL drafts are not silently added.

`SOURCE_READY` checks source integrity only. Build, lint/typecheck and runtime
acceptance are recorded in docs/repo-readiness-2026-10-22.md. Perform installs and
builds in a separate copy; dependencies and .next are not certified source files.
Production environment values stay in private external configuration, never in
the package or Git. Do not replace source/project settings with the dirty shared
working directory, or copy local vercel.json/pnpm files into this npm-lock release.
Do not use the package as a database migration runner. Preserve all completed
financial corrections, Auth/RLS, and operator data.
