# Historical migration sources

These 160 SQL files are immutable historical references. Their numeric prefixes
are not a runnable migration order. In particular, 072, 136, 150 and 151 each
refer to multiple distinct files, and some files contain one-time business-data
changes. Do not rename, replay or mark these files applied based on numbering.

Use the unique full-file IDs and actual ledger timestamps in the
[history catalog](../../../../scripts/migrations/catalog-2026-09-14.json).
Fresh schema setup and recovery now use the
[verified baseline and ordered upgrade](../../../../scripts/migrations/README.md).
The earlier instruction to start a fresh database at migration 010 is historical
and does not reproduce the current application on its own.
