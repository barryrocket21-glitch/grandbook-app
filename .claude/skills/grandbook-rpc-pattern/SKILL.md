---
name: grandbook-rpc-pattern
description: GrandBook RPC creation pattern. Use whenever creating, modifying, or refactoring PostgreSQL stored procedures/functions, especially RETURNS TABLE functions. Triggers on terms like "create RPC", "ALTER FUNCTION", "supabase RPC", "RETURNS TABLE", "preview/apply pattern", or any SQL function for GrandBook (project_id ubksitifaprqofujhova). Encodes mandatory standing rules: variable_conflict use_column, search_path locked, RLS-aware, idempotent migration, advisor check.
---

# GrandBook RPC Standing Pattern

## Mandatory Boilerplate

Every `RETURNS TABLE` function MUST follow this template:

```sql
DROP FUNCTION IF EXISTS public.<function_name>(<param_types>);

CREATE OR REPLACE FUNCTION public.<function_name>(
  p_param_name <type> DEFAULT <default>
)
RETURNS TABLE(col_a text, col_b numeric)
LANGUAGE plpgsql
SET search_path TO 'public'      -- ← MANDATORY
SECURITY <DEFINER|INVOKER>
AS $function$
#variable_conflict use_column     -- ← MANDATORY for RETURNS TABLE
DECLARE v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();
  RETURN QUERY SELECT ... WHERE organization_id = v_org_id;
END;
$function$;
```

## Recurring Bug (avoid)

`RETURNS TABLE(col_a, col_b)` defines OUT parameters with same name as columns. Without `#variable_conflict use_column`, PL/pgSQL throws ambiguity error at runtime. **This has bit us in `list_orders_enriched`, `check_order_export_ready`, `list_orders_draft_enriched` — always include the directive.**

## After Every Migration

```python
mcp__supabase__get_advisors(project_id="ubksitifaprqofujhova", type="security")
```

Zero new warnings = OK.

## Common Security Fix

If `function_search_path_mutable` reported on SECURITY DEFINER function meant trigger-only:

```sql
REVOKE EXECUTE ON FUNCTION public.<function_name>(...) FROM anon, authenticated;
```

## RLS Helper Functions

- `current_org_id()` — BIGINT
- `get_user_role()` — text ('owner'|'admin'|'cs'|'advertiser'|'akunting')

## Smoke Test via Transaction

```sql
BEGIN;
-- test trigger fire
ROLLBACK;
```

## MCP Quirks

- MCP runs outside auth context → `current_org_id()` returns NULL → RPC returns empty.
- For smoke testing data, use raw SQL `WHERE organization_id = 1` instead.

## Verification Snippet

```sql
SELECT
  p.proname,
  CASE WHEN array_to_string(p.proconfig, ',') LIKE '%search_path%' THEN 'LOCKED ✓' ELSE 'MUTABLE ✗' END AS search_path,
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%variable_conflict use_column%' THEN 'YES ✓' ELSE 'NO ✗' END AS variable_conflict
FROM pg_proc p WHERE p.proname = '<your_function>';
```
