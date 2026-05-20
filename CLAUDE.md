@AGENTS.md

# GrandBook — Project Context for Claude Code

> Aplikasi pembukuan COD untuk seller online Indonesia. Multi-supplier dropship, multi-channel (SPX, JNE), 5 role (owner/admin/cs/advertiser/akunting).

## Stack

- **Next.js 16** (App Router, Server Components) + React 19 + TypeScript
- **Tailwind CSS 4** + shadcn/ui
- **Supabase** (Postgres 17.6.1, project_id `ubksitifaprqofujhova`, region ap-south-1)
- **TanStack Table v8** + react-hook-form + Zod + Recharts + Sonner
- **Vercel** deploy → grandbook-app.vercel.app
- **Repo**: github.com/barryrocket21-glitch/grandbook-app

## Owner & Team

- **Barry** (barry@mbc.com) — owner, complete beginner di sistem building, deep biz domain knowledge
- **Indra** (admin) — admin, main operator harian
- Plus role: cs (input order), advertiser (campaign), akunting (recon)

## Workflow (CRITICAL)

```
Barry (chat / Claude Opus) → spec & QA via Supabase MCP
       ↓                           ↓
   Brief markdown ← commit & smoke-test via DB
       ↓
Claude Code (terminal) → edit kode + commit + push
       ↓
Vercel deploy → Barry smoke-test browser
```

**Don't:**
- Don't litigate decisions ulang. Barry mengikat keputusan dengan jelas, jangan re-ask.
- Don't claim "fixed" tanpa runtime test. **grep ≠ runtime test, build pass ≠ deploy success.**
- Don't run destructive command tanpa explicit Barry approval (DROP, TRUNCATE, force-push).

## Standing Rules (NON-NEGOTIABLE)

### Database

1. **Setiap RPC `RETURNS TABLE(...)` MUST**:
   - Include `#variable_conflict use_column` directive
   - `SET search_path TO 'public'`
   - Idempotent: pakai `DROP FUNCTION IF EXISTS` dulu, baru `CREATE OR REPLACE`
2. **Setiap migration file**: idempotent (DROP IF EXISTS + CREATE IF NOT EXISTS)
3. **Setiap habis migration**: jalankan `mcp__supabase__get_advisors(type='security')`. Zero new warnings = OK.
4. **Audit trigger pattern**: SECURITY DEFINER + SET search_path. REVOKE EXECUTE dari anon+authenticated.
5. **RLS**: semua tabel transaksional wajib RLS dengan `organization_id = current_org_id()` di SELECT, role check di INSERT/UPDATE/DELETE.

### Frontend

1. **File creation**: ≤100 lines langsung tulis. >100 lines bikin outline dulu.
2. **shadcn components**: pakai existing primitives sebelum bikin custom. Don't import lucide-react icons tidak dipakai.
3. **Forms**: react-hook-form + Zod. Schema di `src/lib/schemas/`.
4. **Server Actions**: di `actions.ts` di sebelah `page.tsx`. Wajib `revalidatePath()` setelah mutation.
5. **Edit ColumnConfig**: jangan break user preference. Gunakan `mergeNewColumnsByAnchor` helper.

### Code Quality

1. Setelah edit: `npx tsc --noEmit` MUST pass. `npm run build` MUST pass.
2. Jangan claim done tanpa: build pass + smoke test data + screenshot dari Barry.
3. Commit message format: clear what + why (1-2 line).

## Tabel Penting

- `organizations`, `profiles` (uuid PK from auth.users)
- `orders` (archive — semua resi sudah terisi) + `order_items`
- `orders_draft` (active workflow — belum ada resi) + `order_items_draft`
- `suppliers`, `products`, `product_variants`
- `couriers`, `courier_channels`, `courier_channel_rates`, `courier_channel_statuses`
- `converter_profiles`, `converter_field_mappings`, `converter_value_mappings`
- `campaigns`, `campaign_products`, `ad_spend`
- `commissions`, `commission_rules`
- `audit_log` (INSERT/UPDATE/DELETE on orders, order_items, order_status_history, commissions, orders_draft, bank_withdrawals)
- `reconciliation_batches` (Phase 8I), `bank_withdrawals` (Phase 8I-v2)
- `inbox_unmatched_resi`, `inbox_unmapped_statuses`, `inbox_unmatched_products`

## Aturan Hard Constraints (DON'T BREAK)

- Status enum 8-state: `BARU | SIAP_KIRIM | DIKIRIM | DITERIMA | PROBLEM | RETUR | CANCEL | FAKE`. **DON'T add new state without owner approval.**
- Priority enum: `LOW | NORMAL | URGENT` (3 only, not 4)
- Role enum: `owner | admin | cs | advertiser | akunting`
- `orders_draft` table: hanya untuk pre-resi workflow. Trigger `promote_draft_to_orders` auto-migrate begitu `resi` ke-set.

## Convention Path

```
src/app/(app)/<feature>/
  page.tsx                 # Server Component default
  actions.ts               # Server Actions
  _components/             # Local components, underscored = not routable

src/lib/
  supabase/migrations/     # numbered: 049_, 050_, ...
  schemas/                 # Zod schemas
  types.ts                 # Single source of truth types
  constants.ts             # Sidebar config, role-based nav
```

## MCP Available

- **Supabase MCP** (project `ubksitifaprqofujhova`):
  - `execute_sql` untuk DML/DDL
  - `apply_migration` untuk migration file
  - `get_advisors` untuk security lint (run after every migration)
  - `list_tables verbose=False` lebih ringan dari verbose=True

## Known Bugs / Backlog

- User creation flow: `organization_id` ga auto-inherit pas bikin user baru → blank state akun baru
- Indra (admin) ga bisa akses banyak menu → audit sidebar + page guards
- Phase 8K (WA Paste parser key-value format) — pending
- Phase 8J (Inventory & Deposit dashboard) — pending
- JNE Mengantar Mei backfill — pending file

## Recovery Pattern

Kalau pernah accidental delete:
1. Cek `audit_log WHERE action IN ('DELETE', 'BULK_DELETE') AND created_at >= incident_time`
2. `old_value` jsonb berisi full row before delete
3. Reconstruct via `INSERT INTO <table> SELECT * FROM jsonb_to_record(...)`

## Useful Commands

```bash
npx tsc --noEmit
npm run build
```

## When in Doubt

Barry's priorities:

1. Don't break what works
2. Smoke test wajib screenshot evidence
3. Concise answers first, deep dive only when needed
4. Spec-first — kalau ada decision baru, kasih opsi A/B, jangan asumsi
