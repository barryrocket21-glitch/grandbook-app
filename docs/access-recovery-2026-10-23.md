# Access routing and complete recovery references — 23 October 2026 WIB

Verified 2026-10-23T13:48:45.182028+07:00. Both requested scopes are complete.

## Screenshot diagnosis and application fix

The existing in-app session is a verified active CS account. Its rejection from
the Owner/Admin dashboard was correct. The inconsistent entry flow caused the
problem: password login already chose a role home, but root and signed-in login
entry sent everyone to /dashboard. No owner role or permission was inferred.

Pure getRoleLanding/getEntryRedirect helpers now unify root, signed-in login and
dashboard entry. CS goes to /cs/resi; advertiser to /adv-dashboard; akunting to
/reconciliation/spx. Admin retains its existing login home /orders/draft and
explicit dashboard access. Owner goes to /dashboard. Unverified/unknown/inactive
profiles never fall back to Owner. OAuth's default entry goes through the same
verified root route. Dashboard loading waits for a verified owner/admin role.

No account, role, active flag, organization, credential, Auth/RLS, financial
formula or business row was changed. The browser was not forcibly signed out.
The current CS session remains CS; Owner Dashboard requires an Owner/Admin session.

### Production and preserved concurrent source

Active main: https://grandbook-app.vercel.app.
Deployment dpl_ESBz5NNf6CbxeSqFEYAsxohjy8d3, READY/bom1.
Input commit1af90e028fb3f30d22e6c556f63ced9be55fa903,454 reviewed source files.
Input SHA-256 d46059f632a803da56fbc11776d4cabb7d34f3f281e187b4b2d532f86882c954.

The previous release had changed to Git-source10fc9d2 in iad1 after the preceding
session. Its bulk-upload timeout fix was preserved, not overwritten. Exactly five
application inputs differ: landing helper, middleware, login, auth callback and
dashboard. Actual CLI dry-run and uploaded Vercel source match all454 paths/hashes.
Cloud production build passed; only the verified bom1 candidate was promoted.

Git pushes use the existing authorized Mac account via an isolated Git bundle;
no credential copied and no global auth change. Temporary ignored-build command
exit0 prevents automatic iad1 builds replacing the reviewed candidate. Original
setting is null; final closeout must restore it with the private final-check.py
restore and verify final-verification.json. No permanent config change authorized.
Main env records matched baseline. Liard was not modified or certified equivalent.

### Verification

- Full repo TypeScript passed.
- Pure role landing3 tests plus a real bundled middleware suite passed: all five
  roles, root/login/direct-dashboard routes, refresh-cookie forwarding, guest
  redirect/API401, inactive/no-org/unknown profiles403, lookup failure503.
  Supabase adapter is synthetic; no business requests or database mutations.
- Auth changed-file lint passes. Dashboard has the same20 pre-existing
  no-explicit-any errors as its saved baseline; no new lint errors. No lint rule
  disabled or financial code refactored to hide those findings.
- Packaging14 tests and recovery8 tests pass. Existing bulk-upload timeout
  regression passes; its source matches live10fc9d2 exactly.
- Fresh independent Git clone passes both the recovery graph verifier and
  application source preflight; no untracked source fallback.
- Actual in-app normal CS session: /, /dashboard and /login all land /cs/resi,
  heading Resi Saya, no Akses Terbatas. Final page has0 alerts/no load failure.
- Separate existing Chrome Mac normal Owner session: root lands /dashboard,
  visible Dashboard, Owner label, no restriction/login, document1434px at1440px.
  Temporary Owner test tab closed; CS tab retained as the useful app result.
- No production write tests, new customer export, recovery SQL or corrections.

## All34 recovery dependencies finished

All34 original files match their existing manifest SHA-256 and were committed
in five scopes. Byte content was not changed. Static source review found no
credential/email/UUID literal flags in these34 references. The original P&L reader
and manifest remain unchanged, including explicit recovery step ordering.

| Scope | Files | Commit |
|---|---:|---|
| access-controls | 5 | 3c7b5e3 |
| order-intake | 7 | 7811087 |
| reports-and-tracking | 8 | 8f0ab78 |
| spx-evidence | 7 | 09153cd |
| cost-commission-import | 7 | 5e0e2b1 |

The complete graph has35 unique SQL references,35 explicit upgrade steps and24
fresh steps. The pinned manifest SHA-256 is
0bfa06384836342373debf5e905378843707c8a653344ee8c9d1113c3425cb66.
It records application contract8c93820be367235647016c2aa3de335f74d80d905e46a14508f384867f5caaeb;
source verification is not a new live database-contract audit.

Run python3 scripts/releases/recovery/verify.py from a committed checkout.
It reads immutable Git blobs only and rejects missing Git input, hash drift,
symlinks, path traversal, duplicate steps and inconsistent shared references.
No apply/run option or SQL executor exists. All35 hashes pass from a fresh clone.
There are0 missing/untracked dependencies in the current reference graph.

SQL execution count for this task is0. HPP617, package batch,31HPP and all completed
corrections remain completed. The tool never replays them.

## Limits and coordination

Reference integrity is complete; a new database restore was deliberately not
performed. Private archives remain external. Provider/Auth recovery, physical
iPhone/Safari, Liard and full financial-policy correctness are NOT VERIFIED.
Dashboard's legacy lint debt and vision's separate profit/settlement/manual
commission findings remain open; this task grants no financial mutation approval.

Claims and results are recorded in CODEX-HANDOFF.md. vision's existing sections
were preserved byte-for-byte. Other dirty operator work was not staged/cleaned.
Private evidence: /root/backups/grandbook/access-recovery-20261023-20f37f51.

Next: vision reviews this completed reference/routing evidence read-only.
