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

# Smoke test setup (Phase 8K-Playwright)
npm run capture-session -- owner barry@owner.com 'PASSWORD'
npm run capture-session -- indra indra@mbc.com 'PASSWORD'
```

Detail smoke test workflow: `.claude/skills/grandbook-smoke-test/SKILL.md`

## Big Picture & Roadmap GrandBook

### Visi (kenapa GrandBook ada)

Barry punya bisnis dropship COD multi-supplier multi-channel. Sebelum GrandBook, semua di Excel manual: input order, rekap pencairan SPX/JNE, hitung komisi CS/Advertiser, tracking selisih ongkir. Repot, sering salah hitung, ga ada audit trail.

GrandBook = single source of truth untuk:

1. **Operasional harian** — CS input order, cetak resi, follow-up customer
2. **Financial reconciliation** — pencairan COD per kurir, komisi tim, biaya operasional
3. **Analytics** — best-selling produk, daerah paling rame, ROAS per campaign
4. **Audit trail** — semua perubahan tercatat (siapa, kapan, dari mana)

### Roadmap (urutan prioritas, JANGAN diubah tanpa Barry approval)

**Fase 8 (sedang berjalan):**

- ✅ 8A Multi-Supplier Foundation
- ✅ 8B Resi Lifecycle Timestamps
- ✅ 8E Customizable column + inline edit + audit log
- ✅ 8F Orderonline inbound + SPX outbound
- ✅ 8G SPX Outbound Resolver
- ✅ 8H Antrian Kerja (orders_draft physical separation)
- ✅ 8I SPX Financial Reconciliation
- ✅ 8I-v2 SPX Cashflow Daily
- ⏳ **8K WA Paste** (next priority — CS sering terima order via WhatsApp, butuh paste cepat)
- ⏳ **8J Inventory & Deposit Dashboard** (financial position "duit gw ada di mana": SPX saldo, deposit kurir, HPP terbayar)
- ⏳ **8C Variant Analytics** (ROAS per varian, butuh revisi konsep dulu)
- ⏳ **8H Coverage Area SPX** (pending data)

**Fase 9 (later):**

- Notifikasi in-app (bell icon: "5 resi belum pickup", "12 selisih ongkir minggu ini")
- Bulk edit di list view
- Search global di header
- Export full backup
- Multi-tenant (kalau Barry mau jual ke seller lain)

**Fase 10 (vision, masih jauh):**

- Mobile app native (Indra & CS mobile-first)
- AI-assisted: auto-classify customer issue, generate FU script, predict reject reason
- Forecasting: prediksi cashflow 30 hari ke depan dari pipeline draft + delivery rate

### Pattern Operasional Harian (yang akan terus dipakai)

- **Reconciliation workflow** — upload XLSX → preview diff → apply. Pattern reusable untuk SPX, JNE, J&T, Lazada, dll.
- **Order lifecycle** — orders_draft (CS work) → orders (archive). Trigger promote saat resi keisi.
- **Role-based access** — owner sees all, admin operational, akunting financial, advertiser ads-only, cs order-only.

### Yang JANGAN diubah tanpa diskusi besar

- 8-state status enum
- 3-tier priority (LOW/NORMAL/URGENT)
- 5-role system
- Physical separation orders/orders_draft
- Reconciliation 2-RPC pattern (preview/apply)
- `organization_id` di setiap tabel transaksional (multi-tenant ready)

### Kalau Barry minta fitur baru

1. Klarifikasi dulu — fitur ini cocoknya di fase mana (8K? 9? 10?)
2. Cek standing patterns — bisa pakai pattern existing atau perlu pattern baru?
3. Spec-first — kalau ada decision baru (e.g. tabel baru vs extend existing), kasih opsi A/B
4. Implement → smoke test sendiri → report dengan screenshot

## Autonomous Workflow Mode (POST-PLAYWRIGHT-MCP)

Setelah Playwright MCP installed (SHA setup di skill grandbook-smoke-test), Claude Code MUST execute workflow autonomous end-to-end. Barry cuma intervene di explicit checkpoints.

### Loop Standar per Brief

```
Receive brief from Barry
       ↓
Investigate state (DB via Supabase MCP, files via grep/view)
       ↓
Apply changes (DB migration + code edit)
       ↓
Local verify (tsc + build pass)
       ↓
Commit + push
       ↓
Wait Vercel deploy ready (~90 sec)
       ↓
Autonomous smoke test via Playwright MCP
       ↓
   ┌─ Pass → Report success + screenshots
   └─ Fail → Debug + propose fix + ask Barry "OK to apply?"
```

### Mandatory Smoke Test Triggers

Run smoke test SECARA OTOMATIS setelah:

- `git push` ke main branch
- Migration applied via Supabase MCP
- Schema-affecting RPC change
- Sidebar/permission update

### Smoke Test Scope per Feature Type

| Feature changed | Test what |
|---|---|
| New page | Page loads, accessibility OK, role-restricted correctly |
| New RPC | RPC return data via UI, not just SQL |
| Sidebar/nav update | Login as affected role, verify visibility |
| Form/dialog | Submit dummy → verify side effect (toast, redirect) |
| Reconciliation | Upload sample file (from fixtures/), verify preview, JANGAN apply |
| Destructive operation | NEVER smoke test, ask Barry manual |

### Test Account Available

- `tests/auth/owner-session.json` — Barry (owner)
- `tests/auth/indra-session.json` — Indra (admin)
- Tambahkan kalau perlu role lain

### Reporting Format Wajib

Setelah smoke test, kasih Barry format ini:

```
## ✅/❌ Patch SHA <sha> — Smoke Test Result
**Feature:** <feature name>
**Deployed:** <Vercel URL>

### Tests Run
| Test | Result |
|---|---|
| Page loads | ✅/❌ |
| Critical interaction works | ✅/❌ |
| Side effect verified | ✅/❌ |

### Screenshots
- `tests/screenshots/<feature>-<timestamp>-1.png` — initial state
- `tests/screenshots/<feature>-<timestamp>-2.png` — after action
- etc.

### Next Action
- [ ] Barry approve OR specify issue
```

### Hard Constraints

Claude Code MUST NOT:

- Run smoke test against `/settings/reset-data`
- Click Apply pada reconciliation tanpa Barry approval
- Test dengan data production untuk destructive operations
- Skip smoke test untuk save time
- Claim "done" tanpa screenshot evidence

Claude Code MUST:

- Run smoke test even kalau perubahan "kecil"
- Screenshot per major step (3-5 screenshots typical)
- Report fail dengan reproducible steps (URL, action, expected vs actual)

### When Smoke Test Fails

1. Capture failure screenshot
2. Read DOM accessibility tree at fail point
3. Cek browser console (warnings/errors)
4. Propose hypothesis
5. Ask Barry: "Fail at step X. Hypothesis: <reason>. Proposed fix: <code change>. OK to apply?"
6. Don't auto-fix without approval

### Pre-Approval Categories

Barry pre-approves Claude Code to auto-fix (without asking) for:

- TypeScript compile errors
- Missing imports
- Lint warnings
- Migration file numbering (rename to next sequence)

Everything else: ASK FIRST.

### Loop Efficiency Metrics

Target untuk setiap brief:

- Brief intake → first commit: ≤ 30 min
- First commit → smoke test pass: ≤ 5 min
- Barry intervention: ≤ 2 messages

Kalau lebih dari ini, brief mungkin kurang spesifik. Flag ke Barry.

### Communication Style

- Bahasa: Indonesia (mix English untuk technical term)
- Format: ringkas, bullet, screenshot link
- Tone: factual, no fluff, no excessive apology
- Frequency: report final result + screenshot, BUKAN play-by-play setiap edit file

Don't post:

- "Saya akan mulai dengan..."
- "Sekarang saya..."
- "Step 1: ..."
- "Step 2: ..."

Do post:

- Final result dengan SHA + screenshots
- Blockers atau decision points yang butuh Barry

## When in Doubt

Barry's priorities:

1. Don't break what works
2. Smoke test wajib screenshot evidence
3. Concise answers first, deep dive only when needed
4. Spec-first — kalau ada decision baru, kasih opsi A/B, jangan asumsi
