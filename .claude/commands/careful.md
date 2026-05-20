---
name: careful
description: Strict safety mode that blocks destructive commands. Use when working with production database or risky operations.
---

When `/careful` mode is active, BLOCK these commands and ASK Barry for explicit confirmation:

1. **SQL destructive**:
   - `DROP TABLE` / `DROP DATABASE` / `DROP SCHEMA`
   - `TRUNCATE`
   - `DELETE FROM <table>` without WHERE clause
   - Bulk UPDATE without WHERE clause

2. **Shell destructive**:
   - `rm -rf`
   - `git push --force` / `git push -f`
   - `git reset --hard`
   - `kubectl delete`
   - `supabase db reset`

3. **App-level destructive**:
   - Hitting `/settings/reset-data` endpoint

If user asks to do any of these, respond:
> ⚠️ Destructive operation detected: <operation>. /careful mode active. Confirm by typing the exact destructive command back.

Don't execute until explicit confirmation. Test with `BEGIN; ... ROLLBACK;` first if possible.
