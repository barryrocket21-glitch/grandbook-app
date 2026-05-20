---
name: grandbook-reconciliation-pattern
description: GrandBook reconciliation feature pattern. Use when building any "upload file → preview → apply" workflow for SPX/JNE/other channel reconciliation. Triggers on terms like "reconciliation", "upload preview apply", "WA Paste", "import file", "INBOUND_REKONSIL", "converter profile". Encodes the standard 2-RPC pattern (preview + apply), staging via reconciliation_batches, audit log integration, and 4-step UI scaffold.
---

# GrandBook Reconciliation Pattern

Standard pattern used in Phase 8I (Financial Report) and 8I-v2 (Cashflow Daily). Reuse for Phase 8K (WA Paste), JNE Mengantar.

## Architecture

```
[Upload XLSX/Paste] → [Parser] → [preview RPC] → [Preview UI 4-tab] → [apply RPC] → [DB write + audit]
                                       ↓                                    ↓
                              reconciliation_batches.status='PREVIEW'  status='APPLIED'
```

## DB Schema (reuse existing)

Use existing `reconciliation_batches` table for all recon features:
- `channel_id` — courier (1=SPX, 2=JNE)
- `profile_id` — converter profile
- `preview_payload` JSONB — full diff for resume
- `status` — `PREVIEW | APPLIED | CANCELLED | FAILED`

Don't create per-feature batches table.

## RPC Pair Pattern

### Preview RPC

```sql
CREATE OR REPLACE FUNCTION public.preview_<feature>_recon(
  p_rows jsonb,
  p_file_name text DEFAULT NULL,
  p_file_size_bytes integer DEFAULT NULL
)
RETURNS TABLE(
  batch_id bigint,
  total_rows integer,
  matched_count integer,
  unmatched_count integer,
  variance_count integer,
  preview_data jsonb
)
LANGUAGE plpgsql SET search_path TO 'public' SECURITY DEFINER
AS $$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT; v_batch_id BIGINT;
  v_matched JSONB := '[]'::JSONB;
  v_unmatched JSONB := '[]'::JSONB;
  v_variance JSONB := '[]'::JSONB;
BEGIN
  v_org_id := public.current_org_id();

  INSERT INTO reconciliation_batches(organization_id, channel_id, profile_id, uploaded_by, file_name, file_size_bytes, status, total_rows)
  VALUES(v_org_id, <channel_id>, <profile_id>, auth.uid(), p_file_name, p_file_size_bytes, 'PREVIEW', jsonb_array_length(p_rows))
  RETURNING id INTO v_batch_id;

  -- Process rows, categorize

  UPDATE reconciliation_batches
  SET preview_payload = jsonb_build_object('matched', v_matched, 'variance', v_variance, 'unmatched', v_unmatched)
  WHERE id = v_batch_id;

  RETURN QUERY SELECT v_batch_id, ...;
END $$;
```

### Apply RPC

```sql
CREATE OR REPLACE FUNCTION public.apply_<feature>_recon(p_batch_id bigint)
RETURNS TABLE(applied bigint, ...)
LANGUAGE plpgsql SET search_path TO 'public' SECURITY DEFINER
AS $$
#variable_conflict use_column
DECLARE v_batch RECORD; v_payload JSONB;
BEGIN
  SELECT * INTO v_batch FROM reconciliation_batches
  WHERE id = p_batch_id AND organization_id = public.current_org_id();

  IF v_batch.status != 'PREVIEW' THEN
    RAISE EXCEPTION 'Batch status is %, can only apply PREVIEW', v_batch.status;
  END IF;

  v_payload := v_batch.preview_payload;

  -- Apply matched/variance to target table
  -- Insert unmatched to inbox
  -- Mark as APPLIED

  UPDATE reconciliation_batches SET status='APPLIED', applied_at=NOW(), applied_by=auth.uid() WHERE id = p_batch_id;
END $$;
```

## UI Scaffold (4-step)

```
src/app/(app)/reconciliation/<feature>/
├── page.tsx              # UPLOAD → PREVIEW → CONFIRM → DONE
├── actions.ts
└── _components/
    ├── upload-card.tsx
    ├── preview-tabs.tsx  # tabs: Matched | Variance | Unmatched
    └── history-list.tsx
```

## Variance Threshold

Standard: **Rp 100**. Bedanya < 100 ignore (rounding noise).

## Audit Log

Audit triggers handle UPDATE on orders/order_items automatically (from Skenario A). Apply RPC doesn't need manual audit_log insert for row-level changes.

For meta-events (batch applied):

```sql
INSERT INTO audit_log(user_id, table_name, record_id, action, new_value)
VALUES (auth.uid(), 'reconciliation_batches', p_batch_id::text, 'BATCH_APPLIED', jsonb_build_object('summary', ...));
```
