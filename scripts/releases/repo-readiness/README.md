# Reviewed main release preparation

This tool only reads Git and prepares/verifies a local package. It never pushes,
publishes, deploys, reads credentials, or applies SQL. Barry must separately
authorize any later push/deployment. Main and Liard are independent.

The manifest contains the 453 source inputs verified against main Vercel
`dpl_EbCS3prnBTgsLF1LkgqVGcPjkeuJ`, bom1. Reviewed deviations are a stronger .vercelignore and cleaned-up zero-delay
timers for three initial remote reads. Query payloads, formulas and roles are
unchanged; the exact deviation list is in manifest.json. Generated next-env.d.ts is reconstructed from a committed template;
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

For a later approved main release, retain the explicit bom1 region and the
existing main project identity. Do not assume Liard shares main's version or
settings. This tool deliberately has no push/deploy/promote command. Never run
the Vercel CLI from the shared dirty working directory; it can read an unrelated
local vercel.json before upload exclusions are applied.

The snapshot-specific 453-file gate must be reviewed and updated when adding new
application source. Do not bypass a failed source check by copying untracked
files into the package. A later docs-only commit may share the same input digest;
`verify` checks package bytes against the requested immutable Git revision.

The committed regression tests use fabricated data and no business database
requests. When invoking the candidate-root unit tests, set
GB_PROFIT_CANDIDATE_ROOT, GB_PAYROLL_CANDIDATE_ROOT and
GB_COMMISSION_CANDIDATE_ROOT to the committed checkout directory. Private browser
smoke evidence and its fixture harnesses are linked in the dated readiness doc.

Before an approved upload, run the installed Vercel CLI's dry-run file inventory
in an isolated package copy and compare every uploaded path/hash with the manifest.
Directory exclusions are anchored to the project root: unanchored supabase
also excludes src/lib/supabase. Filesystem package parity alone cannot verify
the uploader's ignore semantics. Do not promote a candidate unless all 453 uploaded
source files match the current manifest; region must still be bom1.
