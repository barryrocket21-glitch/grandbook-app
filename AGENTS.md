<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# GrandBook — Build Notes

## Phase Status (snapshot)

| Phase | Status | Tanggal |
|---|---|---|
| Phase 1 — Foundation & Database Schema | ✅ DONE | 2026-05-09 |
| Phase 2A — Settings UI (Master Data) | ✅ DONE | 2026-05-09 |
| Phase 2B — Converter Profiles + Inbox UI | ⏳ NOT STARTED — menunggu brief dari user | — |
| Phase 3 — Converter Engine + Status Sync + Commission Engine v2 | ⏳ NOT STARTED | — |
| Phase 4 — Form Input Order + Detail | ⏳ NOT STARTED | — |

**Phase 2A done. Phase 2B belum dikerjakan.** Brief Phase 2B (Converter Profiles UI + Field Mapping editor + Inbox handler) akan disusun terpisah oleh user. Jangan mulai coding fitur Phase 2B tanpa brief eksplisit.

---

## Phase 1 — Foundation & Database Schema (COMPLETED)

Phase 1 fokus ke fondasi database. Tidak ada UI baru, kecuali banner placeholder yang menggantikan halaman-halaman lama yang menunggu refactor di phase berikutnya.

### Yang sudah dibangun

**Schema (`src/lib/supabase/migrations/010_phase1_foundation.sql`):**

- `organizations` — multi-tenant prep, default org id=1
- `master_wilayah` — 82539 baris kode pos Indonesia (province / city / subdistrict / village / zip + normalized fields)
- `couriers`, `courier_channels`, `courier_channel_rates`, `courier_channel_statuses`
- `converter_profiles`, `converter_field_mappings`, `converter_value_mappings`
- `orders` (struktur baru, struktural address, channel_id, rate_snapshot, status enum baru)
- `order_items` (dengan weight_per_unit, hpp_snapshot, raw fallback fields)
- `order_status_history` (audit trail otomatis via trigger)
- `inbox_unmatched_resi` & `inbox_unmapped_statuses` (review queue untuk converter engine)

**Triggers:**

- `set_updated_at()` di `orders`, `converter_profiles`
- `log_order_status_change()` di `orders` (auto-insert ke `order_status_history` setiap insert/update status; juga update `status_changed_at` di NEW row)

**RLS:**

- Transaksional (orders, order_items, order_status_history, inbox_*) — filter by `organization_id = current_org_id()`
- Master tables (couriers, channels, profiles, mappings, master_wilayah, organizations) — semua authenticated bisa SELECT, hanya owner/admin yang bisa INSERT/UPDATE/DELETE (organizations & master_wilayah owner-only)

**Seed (`src/lib/supabase/seed_phase1.sql`):**

- 1 organization default (id=1)
- 2 couriers: SPX, JNE
- 2 channels: SPX_DIRECT, JNE_VIA_MENGANTAR (aggregator=MENGANTAR)
- 5 status mapping awal untuk SPX (Delivered/Returned to Sender/Cancelled/On Process/Pickup)
- 3 converter profiles dengan total **39 field mappings + 3 value mappings**:
  - `orderonline_inbound` (15 fields, transforms: normalize_phone_id, parse_date_dd-mm-yyyy, uppercase)
  - `spx_financial_rekonsil` (10 fields, header_row_index=2 untuk grouped headers)
  - `mengantar_outbound` (14 fields, target_table=file_column, delimiter `;`, encoding utf-8-sig)

**Master wilayah importer (`scripts/import_master_wilayah.ts`):**

- Reads `scripts/data/Daftar_Kodepos.xlsx` (skip 3 baris intro)
- Normalizes: lowercase, strip parens & special chars, collapse whitespace
- Bulk upsert 1000 per batch, idempotent via UNIQUE constraint
- 82539 rows imported di production (8 in-source duplicates skipped)
- Run: `npm run import:wilayah`
- Friendly error message kalau file tidak ada di `scripts/data/`

**Smoke test (`scripts/test_phase1.sql`):**

18 query verifikasi (organisasi, profile linkage, master_wilayah count, NTB sample, couriers/channels/status mappings/converter profiles/field mappings counts, log_order_status_change trigger, status_changed_at, wilayah_id link, UNIQUE external_order_id, 14 tabel present). **Semua 18 lulus** saat verifikasi production.

### Setup fresh database (recommended order)

```bash
# 1. Run migration 010 (drops legacy orders/order_items, creates new schema)
#    Via Supabase SQL Editor (paste content) atau exec_sql RPC

# 2. Run seed_phase1.sql

# 3. Place file & run wilayah import
cp ~/Downloads/Daftar_Kodepos.xlsx scripts/data/Daftar_Kodepos.xlsx
npm run import:wilayah

# 4. Verify dengan smoke test queries di scripts/test_phase1.sql
```

### Halaman: banner vs functional

**Banner placeholder (akan refactor di phase berikutnya — render `<RefactorBanner phase=...>`):**

| Halaman | Refactor di |
|---|---|
| `/orders/list` | Phase 3 (Converter Engine + Status Sync) |
| `/orders/bulk-upload` | Phase 3 (Converter Engine) |
| `/orders/new` | Phase 4 (Form Input Order) |
| `/orders/[id]` | Phase 4 (Detail Order + Status History) |
| `/analytics` | Phase 3 (Analytics Engine) |
| `/cs-dashboard` | Phase 3 (Commission Engine v2) |
| `/adv-dashboard` | Phase 3 (Analytics Engine) |
| `/team/cs`, `/team/advertisers` | Phase 3 (Analytics + Commission Engine v2) |
| `/cs-report` | Phase 3 (Status Sync Engine) |
| `/duplicates` | Phase 3 (Inbox Review) — concept replaced by `inbox_unmatched_resi` |
| `/shipping-diff` | Phase 3 (Rekonsil Engine) |
| `/ad-spend` | Phase 2/3 (Settings + Analytics Engine) |
| `/commissions/my`, `/commissions/manage` | Phase 3 (Commission Engine v2) |

Banner component: `src/components/ui/refactor-banner.tsx` — renders construction icon + phase reference.

**Halaman yang TETAP berfungsi di Phase 1:**

- `/dashboard` (KPI owner — pakai status enum baru, masih jalan dengan filter CANCEL/FAKE/RETUR yang masih valid)
- `/reconciliation` (independen, hanya pakai `ad_spend` + `ad_reconciliation`)
- `/products` (tabel products tidak diubah)
- `/expenses` (independen)
- `/campaigns` (independen)
- `/settings/users` (admin API, independen)
- `/settings/commission-rules` (tabel intact, walau engine yang konsumsi rules akan dibangun ulang Phase 3)
- `/settings/reset-data` (admin tool)
- `/login` (auth, independen)

---

## Phase 2A — Settings UI Master Data (COMPLETED)

5 halaman setting baru untuk CRUD master data:

| Path | Fungsi | Permission write |
|---|---|---|
| `/settings/couriers` | CRUD courier (induk dari channels) | owner, admin |
| `/settings/courier-channels` | CRUD channel per courier; aggregator support; deep-link `?courier=X` | owner, admin |
| `/settings/courier-rates` | CRUD rate dengan effective period; auto-replace rate aktif saat tambah baru | owner, admin |
| `/settings/status-mapping` | Mapping raw status → 8 internal status enum; bulk copy antar channel | owner, admin |
| `/settings/wilayah` | **Read-only** viewer 82k baris dengan cascade filter (Province → City → Subdistrict) + search by village/zip | semua role |

### Pattern yang dipakai

- **Client-side React** dengan `createClient()` Supabase, sesuai pola existing `/settings/*`. Brief saran Server Actions ditolak di favor pattern existing per instruksi brief sendiri.
- **RLS handle permission**: tabel master read-all-auth, write-admin-only (sudah ada di migration 010). UI gating tambahan via `<PermissionGuard>` untuk hide tombol Tambah/Edit/Hapus.
- **Soft delete via `active` flag** untuk couriers + channels. Rates pakai effective period (set `effective_to`). Status mapping hard delete OK.
- **Cascade disable di app layer**: disable courier → channel-channelnya ikut di-disable (single transaction via 2 update sequential).
- **Replace rate logic**: saat tambah rate baru untuk pasangan (channel, key) yang sudah ada aktif, prompt confirm + auto-set `effective_to` rate lama ke `(new_from - 1 day)`.

### Files baru

- 4 helper:
  - `src/lib/auth/permissions.ts` — `canManageSettings(role)` returns true untuk owner/admin
  - `src/lib/schemas/settings.ts` — Zod schemas + UI helpers (RATE_KEY_PRESETS, STATUS_BADGE_COLOR, formatRateValue)
- 1 shared component:
  - `src/components/settings/permission-guard.tsx` — wrapper render-or-fallback by role
- 5 pages: `couriers`, `courier-channels`, `courier-rates`, `status-mapping`, `wilayah`
- Sidebar nav: group "Master Data" baru (visible untuk semua role karena read-only mode untuk non-admin)
- `/settings` redirect updated dari `/settings/users` → `/settings/couriers`
- `docs/phase2a-test.md` — manual smoke test checklist

### Build status

- `tsc --noEmit` pass
- `npm run build` pass (5 halaman baru ke-list di output: settings/couriers, courier-channels, courier-rates, status-mapping, wilayah)

### Deviasi dari brief

1. **Tidak pakai TanStack Table** — pakai existing `<Table>` dari shadcn/ui. Existing pages konsisten pakai ini, lebih ringan, sorting/pagination minimal cukup.
2. **Tidak pakai Server Actions** — direct Supabase mutation client-side. Brief eksplisit minta "prefer existing pattern" kalau conflict; existing pattern client-side.
3. **Tidak buat `data-table.tsx`, `form-dialog.tsx`, `delete-confirm-dialog.tsx` shared component** — pages langsung pakai Dialog + Table inline (matches existing pattern). Bisa di-refactor jadi shared kalau Phase 2B butuh.
4. **Tidak buat `src/lib/supabase/queries/settings.ts`** — query inline di useEffect setiap page. Reusable abstraction belum perlu untuk 5 page sederhana.

### Hal yang perlu di-flag untuk Phase 2B

- **Phase 2B = Converter Profiles + Inbox UI**. Tabel-tabelnya sudah ada di Phase 1: `converter_profiles`, `converter_field_mappings`, `converter_value_mappings`, `inbox_unmatched_resi`, `inbox_unmapped_statuses`.
- Belum ada UI untuk edit converter profiles. Saat ini 3 profile pre-seeded (orderonline_inbound, spx_financial_rekonsil, mengantar_outbound) di seed_phase1.sql. Owner butuh UI untuk:
  - CRUD converter profile (basic fields)
  - Field mapping editor (drag-drop reorder, transform picker, target_table picker)
  - Value mapping editor
  - Test parser dengan sample file (preview output)
- Inbox Review UI untuk handle `inbox_unmatched_resi` & `inbox_unmapped_statuses` saat converter engine (Phase 3) populate-nya.

---

## Flag untuk diskusi sebelum Phase 2B atau Phase 3

Saat brief Phase 2 disusun, mohon dipertimbangkan/diklarifikasi:

### 1. Audit triggers — `audit_triggers.sql` tidak ada di repo

Brief Phase 1 reference `audit_triggers.sql` "sudah berfungsi otomatis di tabel-tabel utama" — file tidak ada di repo. Audit trail sekarang hanya untuk **status changes di orders** (via `order_status_history`).

Audit generic untuk tabel lain (siapa edit produk kapan, rate berubah, dll.) belum ada. Perlu didesign ulang kalau dibutuhkan — apakah:
- Tabel `audit_log` generic dengan trigger di tiap tabel master (heavy)?
- Skip — pakai Supabase logs / manual cek `updated_at` saja?

### 2. Commissions table — orphan setelah CASCADE drop

Tabel `commissions` masih utuh strukturnya (tidak di-drop), tapi:
- FK ke `orders.id` ke-dropped via CASCADE saat orders lama di-drop
- Semua row data di-flush (cascade dari orders delete)
- Engine triggers (`compute_commissions`, `transition_commissions`, `orders_commission_trigger`) di-drop di migration 010

Phase 3 commission engine akan dibangun ulang — perlu putusin di brief Phase 3:
- Drop tabel `commissions` total + bikin schema baru, atau
- Reuse struktur existing dengan re-add FK ke orders baru?

### 3. Status enum mapping legacy → baru

Brief tidak bahas migrasi data lama. Karena Phase 1 wipe semua data orders, tidak ada migrasi yang dibutuhkan. Tapi kalau user mau import data historical dari spreadsheet/export lama:
- `DIPROSES` → `SIAP_KIRIM`
- `SAMPAI` → `DIKIRIM` atau `DITERIMA` (tergantung konteks)
- `SELESAI` → `DITERIMA`

User perlu rename manual di file source sebelum import via converter engine (Phase 3).

### 4. Mengantar status mapping belum di-seed

Hanya SPX yang punya 5 status mapping default. JNE_VIA_MENGANTAR belum punya raw status mapping karena user belum provide sample file rekonsil dari Mengantar. Akan di-add saat:
- User upload sample file rekonsil Mengantar, atau
- Phase 2 Settings UI selesai dan user input manual

Saat ini `inbox_unmapped_statuses` akan auto-capture raw status yang belum dikenali (Phase 3 engine), jadi user bisa map dari inbox.

---

## Migration History

Setup database fresh = mulai dari **migration 010**. Migration 001-009 adalah historical records — sudah pernah di-apply ke production lama, tapi schema yang mereka bangun sudah di-replaced oleh migration 010. **Jangan re-run 001-009 di fresh setup.**

| Migration | Fungsi (historical) | Status |
|---|---|---|
| 001-003 | Resi fields, fix handle_new_user trigger, install repair function | Superseded oleh 010 |
| 004 | Analytics engine (cs_daily_leads, commissions per-order, ad_reconciliation) | Partial — `cs_daily_leads`, `commissions`, `ad_reconciliation` tabel tetap ada (struktur saja) |
| 005-006 | Commission engine + product FK fix | Superseded — functions di-drop di 010 |
| 007 | shipping_cost_actual column | Superseded — column ada di schema baru |
| 008-009 | Commission per-user rules + cleanup | Functions di-drop di 010, akan dibangun ulang Phase 3 |
| **010** | **Phase 1 foundation** | **✅ Active** |
| 011+ | TBD next phases | — |

## How to apply migrations going forward

Pakai `exec_sql` RPC function (sudah terinstall di production via migration 003 historical) untuk run SQL via service role key. Atau Supabase SQL Editor langsung.

```python
import json, urllib.request, os
sql = open('src/lib/supabase/migrations/010_phase1_foundation.sql').read()
url = os.environ['NEXT_PUBLIC_SUPABASE_URL'] + '/rest/v1/rpc/exec_sql'
key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
req = urllib.request.Request(url, data=json.dumps({'sql': sql}).encode(),
  headers={'apikey': key, 'Authorization': 'Bearer '+key, 'Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
```

## Test users (dummy)

Test users dari development sebelumnya masih ada di `auth.users` + `profiles`:

| Email | Password | Role |
|---|---|---|
| Owner GrandBook (existing) | (asli user-set) | owner |
| `andi@cs.test` | `pass1234` | cs |
| `budi@cs.test` | `pass1234` | cs |
| lisa (existing) | (asli user-set) | cs |
| chandra (existing) | (asli user-set) | advertiser |

Bisa dihapus via `/settings/users` kalau mau bersih total sebelum prod use.
