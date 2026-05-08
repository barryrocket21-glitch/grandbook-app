<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# GrandBook — Build Notes

## Phase 1 — Foundation & Database Schema

Phase 1 fokus ke fondasi database. Tidak ada UI baru di phase ini, kecuali
banner placeholder yang menggantikan halaman-halaman lama yang menunggu
refactor di phase berikutnya.

### Yang sudah dibangun

**Schema (migration 010_phase1_foundation.sql):**

- `organizations` — multi-tenant prep, default org id=1
- `master_wilayah` — 82539 baris kode pos Indonesia (province / city / subdistrict / village / zip + normalized)
- `couriers`, `courier_channels`, `courier_channel_rates`, `courier_channel_statuses`
- `converter_profiles`, `converter_field_mappings`, `converter_value_mappings`
- `orders` (struktur baru, struktural address, channel_id, rate_snapshot)
- `order_items` (dengan weight_per_unit, hpp_snapshot, raw fallback)
- `order_status_history` (audit trail otomatis via trigger)
- `inbox_unmatched_resi` & `inbox_unmapped_statuses` (review queue)

**Triggers:**

- `set_updated_at()` di `orders`, `converter_profiles`
- `log_order_status_change()` di `orders` (auto-insert ke `order_status_history` setiap insert/update status)

**RLS:**

- Transaksional (orders, order_items, order_status_history, inbox_*) — filter by `organization_id = current_org_id()`
- Master (couriers, channels, profiles, mappings, master_wilayah) — semua authenticated bisa SELECT, hanya owner/admin yang bisa INSERT/UPDATE/DELETE

**Seed (`src/lib/supabase/seed_phase1.sql`):**

- 1 organization default
- 2 couriers: SPX, JNE
- 2 channels: SPX_DIRECT, JNE_VIA_MENGANTAR (aggregator=MENGANTAR)
- 5 status mapping awal untuk SPX (Delivered/Returned to Sender/Cancelled/On Process/Pickup)
- 3 converter profiles: orderonline_inbound (15 fields), spx_financial_rekonsil (10 fields), mengantar_outbound (14 fields)
- Value mappings: payment_method (cod→COD, bank_transfer→TRANSFER), Mengantar courier code

**Master wilayah import (`scripts/import_master_wilayah.ts`):**

- Reads `scripts/data/Daftar_Kodepos.xlsx` (~82547 candidate rows)
- Normalizes (lowercase, strip parens & special chars)
- Bulk upserts 1000 per batch, idempotent via UNIQUE constraint

### Setup fresh database (recommended order)

```bash
# 1. Run migration 010 (drops old orders/order_items, creates new schema)
#    Either via Supabase SQL Editor (paste content of file) OR via exec_sql RPC

# 2. Run seed_phase1.sql (org, couriers, channels, profiles, mappings)

# 3. Place file & run wilayah import
cp ~/Downloads/Daftar_Kodepos.xlsx scripts/data/Daftar_Kodepos.xlsx
npm run import:wilayah

# 4. Verify with smoke test (see scripts/test_phase1.sql)
```

### Halaman yang sementara di-banner (akan refactor di phase berikutnya)

| Halaman | Refactor di |
|---|---|
| `/orders/list`, `/orders/bulk-upload` | Phase 3 (Converter Engine + Status Sync) |
| `/orders/new`, `/orders/[id]` | Phase 4 (Form Input Order + Detail) |
| `/analytics`, `/team/*`, `/cs-dashboard`, `/adv-dashboard` | Phase 3 (Analytics Engine + Commission Engine v2) |
| `/cs-report` | Phase 3 (Status Sync Engine) |
| `/duplicates` | Phase 3 (Inbox Review) |
| `/shipping-diff` | Phase 3 (Rekonsil Engine) |
| `/ad-spend` | Phase 2/3 (Settings + Analytics Engine) |
| `/commissions/my`, `/commissions/manage` | Phase 3 (Commission Engine v2) |

Halaman yang **tetap berfungsi** di Phase 1: `/dashboard`, `/reconciliation`, `/products`, `/expenses`, `/campaigns`, `/settings/*` (users, commission-rules, reset-data).

### Audit triggers

`audit_triggers.sql` direferensi di brief tapi tidak ada di repo. Audit trail
sekarang ditangani oleh `order_status_history` (per-order status change).
Audit log generic untuk tabel lain akan didesign ulang di phase berikutnya
(belum prioritas).

## Migration History

Setup database fresh = mulai dari **migration 010**. Migration 001-009 adalah historical
records — sudah pernah diapply ke production lama, tapi schema yang mereka bangun
sudah di-replaced oleh migration 010. **Jangan re-run 001-009 di fresh setup.**

| Migration | Fungsi (historical) | Status |
|---|---|---|
| 001-003 | Resi fields, fix handle_new_user trigger, install repair function | Superseded oleh 010 |
| 004 | Analytics engine (cs_daily_leads, commissions per-order, ad_reconciliation) | Partial — `cs_daily_leads`, `commissions`, `ad_reconciliation` tabel tetap ada |
| 005-006 | Commission engine + product FK fix | Superseded oleh 010 (drop functions) |
| 007 | shipping_cost_actual column | Superseded — column ada di schema baru |
| 008-009 | Commission per-user rules + cleanup | Functions di-drop di 010, akan dibangun ulang Phase 3 |
| 010 | **Phase 1 foundation** | ✅ Active |
| 011+ | TBD next phases | — |

## How to apply migrations going forward

Pakai `exec_sql` RPC function (sudah terinstall di production) untuk run SQL via
service role key, atau Supabase SQL Editor langsung.

```python
# Example via service role
import json, urllib.request, os
sql = open('src/lib/supabase/migrations/010_phase1_foundation.sql').read()
url = os.environ['NEXT_PUBLIC_SUPABASE_URL'] + '/rest/v1/rpc/exec_sql'
key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
req = urllib.request.Request(url, data=json.dumps({'sql': sql}).encode(),
  headers={'apikey': key, 'Authorization': 'Bearer '+key, 'Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
```
