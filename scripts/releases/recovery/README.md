# Current recovery references

Run `python3 scripts/releases/recovery/verify.py` from a committed checkout.
This validates the pinned, existing recovery manifest and all 35 unique SQL
references from immutable Git blobs, preserving both explicit step sequences.
It does not execute SQL, connect to a database, replay migrations, read private
archives, or certify a fresh restore. Missing Git files cannot fall back to the
operator workspace. Hash drift, symlinks, unsafe paths and inconsistent references
are rejected. No apply/run option exists.

The 34 newly tracked dependencies retain their original bytes. The P&L reader
and manifest were captured earlier. A .candidate.sql suffix is historical naming;
neither that name nor PARTIAL status authorizes reapplication.

Private baseline/upgrade backups, credentials, provider/Auth recovery and their
acceptance remain external. Completed HPP617/package/31 corrections stay completed.
Financial policy gaps recorded by vision remain separate from reference integrity.
