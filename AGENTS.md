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
| Phase 2B — Converter Profiles + Inbox UI | ✅ DONE | 2026-05-09 |
| Phase 3A — Inbound Engine + Form Input + Approval | ✅ DONE | 2026-05-09 |
| Phase 3B — Rekonsil Engine + Upload UI | ✅ DONE | 2026-05-10 |
| Phase 3C — Outbound Engine + Export | ✅ DONE | 2026-05-10 |
| Phase 3.5 — Polish (UX & Bug Fixes) | ✅ DONE | 2026-05-10 |
| Phase 4A — Commission Engine v2 + Pencairan UI | ✅ DONE | 2026-05-10 |
| Phase 4B — Analytics Revamp + Per-Role Dashboards | ✅ DONE | 2026-05-10 |
| Phase 4C — Pencairan COD Reconciliation | ⏳ NOT STARTED | — |

**Phase 4B done.** Analytics + per-role dashboard direbuild: `/analytics` 4 tabs (Overview/Per CS/Per Advertiser/Per Channel) + recharts (area/pie/bar) konsumsi 5 server-side aggregation RPCs. `/cs-dashboard` & `/adv-dashboard` refactor jadi thin wrapper di shared `PersonalDashboard` component dengan owner-mode dropdown filter. Existing `/dashboard` tetap functional (sudah pakai schema baru sejak Phase 0).

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

## Phase 2B — Converter & Inbox UI (COMPLETED)

5 halaman baru:

| Path | Fungsi | Permission |
|---|---|---|
| `/settings/converter-profiles` | List + create/edit basic profile (CRUD via dialog) | owner, admin write; semua role read |
| `/settings/converter-profiles/[id]` | Detail editor — 3 tabs: Field Mappings / Value Mappings / Test Parser | owner, admin write; semua role read |
| `/inbox/unmatched-resi` | Resi belum cocok ke order. Resolve dengan link / create / ignore | owner, admin |
| `/inbox/unmapped-statuses` | Raw status belum dimapping. Map → insert ke courier_channel_statuses + clear inbox | owner, admin |

(Tidak ada halaman value-mapping standalone — embedded di tab `[id]/page.tsx`.)

### Highlights pattern

- **Client-side React + Supabase direct + RLS** — same as Phase 2A.
- **Tabs** pakai shadcn `<Tabs>` (Base UI under the hood).
- **Reorder field mappings** pakai up/down arrow (bukan drag-drop) — simpler, swap `display_order` via 2 sequential UPDATE.
- **Bulk copy field mappings** dari profile lain pakai `upsert` dengan `onConflict: 'profile_id,source_field', ignoreDuplicates: true`.
- **Test Parser preview** = pure function di `src/lib/converter/preview.ts` (light-weight, max 3 rows, supports CSV via papaparse + XLSX via xlsx + regex via named groups).

### Files baru

**Pages:**
- `src/app/(app)/settings/converter-profiles/page.tsx`
- `src/app/(app)/settings/converter-profiles/[id]/page.tsx`
- `src/app/(app)/inbox/unmatched-resi/page.tsx`
- `src/app/(app)/inbox/unmapped-statuses/page.tsx`

**Helpers:**
- `src/lib/schemas/settings.ts` — appended: `converterProfileSchema`, `fieldMappingSchema`, `valueMappingSchema`, `inboxResolveSchema`, `DIRECTION_BADGE_COLOR`, `TARGET_TABLE_BADGE_COLOR`, etc.
- `src/lib/converter/transforms.ts` — TRANSFORMS catalog (11 entries) + `applyTransform()` for preview runtime
- `src/lib/converter/preview.ts` — `previewParse(profile, fieldMappings, valueMappings, fileOrText)` returning `{ rows, totalRowsDetected, warnings, errors }`

**Sidebar:**
- `src/lib/constants.ts` — added "Converter Profiles" sub-item under Master Data, new top-level "Inbox" group (owner/admin only)

**Docs:**
- `docs/phase2b-test.md` — manual smoke test checklist

### Implementasi: full vs stub

| Feature | Status |
|---|---|
| CRUD profile basic | ✅ Full |
| Field mapping CRUD + reorder + bulk copy | ✅ Full |
| Value mapping CRUD | ✅ Full |
| Test Parser CSV (orderonline-style) | ✅ Full |
| Test Parser XLSX (header_row_index ≥ 2) | ✅ Full |
| Test Parser WA_PASTE (regex named groups) | ✅ Full |
| Test Parser OUTBOUND_TO_COURIER | ⏸️ Placeholder (Phase 3) |
| Inbox unmatched resi — Link ke order | ✅ Full (cari order via order_number / external_id / customer_name) |
| Inbox unmatched resi — Buat order baru | ⏸️ **Stub** — clear inbox dengan resolution=created_new, tidak benar-benar create order. Phase 4. |
| Inbox unmatched resi — Abaikan | ✅ Full |
| Inbox unmapped statuses — Map | ✅ Full (insert ke courier_channel_statuses + resolve inbox; idempotent kalau mapping sudah ada) |
| Inbox unmapped statuses — Abaikan | ✅ Full |

### Transforms (preview runtime)

Implemented (9): `normalize_phone_id`, `phone_to_628`, `parse_date_dd-mm-yyyy`, `parse_datetime_yyyy-mm-dd`, `numeric_or_zero`, `uppercase`, `lowercase`, `trim`, `kg_format`.

Deferred (2): `concat_address`, `sum_qty` — show "Phase 3" warning kalau dipakai di preview.

### Build status

- `npx tsc --noEmit` pass (no errors)
- `npm run build` pass — 5 routes baru ke-list di output
- ESLint warnings sama pattern dengan Phase 2A pages (`any` types, `useEffect` setState pattern) — diterima konsisten

### Hal yang perlu di-flag untuk Phase 3

- **Engine harus populate `inbox_unmatched_resi` & `inbox_unmapped_statuses`** saat parsing rekonsil. Phase 2B UI sudah siap konsumsi.
- **Outbound preview** — Phase 2B placeholder. Phase 3 engine akan generate output sample dari mock orders.
- **`Buat order baru` di unmatched resi** — Phase 4 nanti benar-benar create order dari raw_data.
- **Auto-trigger inbox saat upload file** — Phase 3 engine sebagai entrypoint. Phase 2B masih manual SQL insert untuk testing.

### Deviasi dari brief

1. **Drag-drop reorder field mappings** → pakai up/down arrow saja (per saran brief, effort ringan, UX 90% sebagus).
2. **OUTBOUND preview** → placeholder card "Phase 3" (per brief, skip kalau effort tinggi).
3. **Bulk action di inbox unmapped statuses** → tidak diimplementasi (per brief, skip kalau effort > 30 min).
4. **Notes column di inbox_unmatched_resi** → tidak ditambah migration. Ignore reason di dialog ditampilkan sebagai informational note tapi tidak disimpan ke DB. Kalau dibutuhkan persist, tambah kolom `notes` via migration tambahan di Phase 3.
5. **Sidebar badge unresolved count** → tidak diimplementasi (skip per brief). Badge unresolved count tampil di header page-nya.

### Tidak ada suspicious behavior di pages 2A

Saat dev Phase 2B integrasi dengan Phase 2A (e.g. dropdown channel di profile form mengambil dari `courier_channels`), tidak menemukan glitch yang feel kayak bug 2A. Pattern client-side + Supabase direct match perfectly.

---

## Phase 3A — Inbound Engine + Form Input + Approval (COMPLETED)

Phase paling impactful sejauh ini — Grandbook sekarang punya 3 jalur masuk order + admin approval flow + order detail.

### Halaman baru / refactor

| Path | Fungsi | Permission |
|---|---|---|
| `/orders/bulk-upload` | 4-step upload (Profile → File → Preview → Execute → Done) untuk INBOUND_ORDER profile | owner, admin, cs (write); admin/owner bisa skip review |
| `/orders/wa-paste` | Paste teks WA → engine ekstrak via regex profile (named groups) → batch insert | owner, admin, cs |
| `/orders/new` | Form manual lengkap: cascade wilayah (4 level + zip auto-fill), multi-item, channel picker, payment method, advertiser | owner, admin, cs |
| `/orders/[id]` | Detail order: Info / Items / Timeline / Audit tabs + Edit Status + Edit Order (admin only) | semua role read; admin/owner edit |
| `/orders/list` | List all orders dengan filter status (count badges), channel, search by order#/customer/resi | semua role read |
| `/inbox/pending-review` | Approval inbox — orders BARU. Single + bulk approve/reject FAKE/PROBLEM dengan reason | owner, admin |

### Engine + helpers

**`src/lib/converter/engine.ts`** (NEW — production parser+inserter):
- `ingestInbound({ profile, fieldMappings, valueMappings, fileOrText, initialStatus, organizationId, createdBy, supabase, onProgress? })`
- Support direction = INBOUND_ORDER atau WA_PASTE only (REKONSIL/OUTBOUND di phase belakangan)
- Anti-duplicate by `external_order_id` query check pre-insert (handles both pre-detect dan UNIQUE-constraint fallback 23505)
- Per-row try/catch — 1 row gagal nggak nge-block batch
- cs_name → cs_id auto-resolve via lookup `profiles` table (case-insensitive); tidak auto-create user
- Generate `order_number` via SQL function `generate_order_number(org_id)` (race-safe, format `GB-YYYYMMDD-NNNNNN`)
- Returns `{ inserted, skipped_duplicates, errors[], warnings[], inserted_order_ids[], totalRowsDetected }`

**`src/lib/converter/parser.ts`** (NEW — extracted shared parsing):
- `parseSource(profile, fileOrText, warnings)` — handles CSV (papaparse), XLSX (xlsx), regex named groups (WA_PASTE)
- Used by both `preview.ts` (light, max 3-5 rows) and `engine.ts` (production, unlimited rows)
- `indexValueMappings()`, `parseCsv()`, `parseXlsx()`, `parseRegex()`, `readFileAsText()`

**`src/lib/converter/transforms.ts`** — implemented 2 deferred transforms:
- `concat_address` — gabung field alamat struktural jadi 1 string (uses `TransformContext.orders`)
- `sum_qty` — sum total qty dari order_items (uses `TransformContext.order_items`)
- `applyTransform()` signature now accepts optional `ctx?: TransformContext`

**`src/lib/orders/order-number.ts`** (NEW):
- `generateOrderNumber(supabase, orgId)` — wrapper RPC call
- `updateOrderStatus(supabase, { orderId, newStatus, source, note })` — wrapper RPC call

**`src/lib/wilayah/cascade.ts`** (NEW):
- `loadProvinces`, `loadCities`, `loadSubdistricts`, `loadVillages`, `findWilayahId` — server-side cascade queries
- Pagination 2k batch untuk handle 82k rows

**`src/lib/auth/permissions.ts`** — appended:
- `canApproveOrders(role)` — owner+admin
- `canCreateOrders(role)` — owner+admin+cs

**`src/lib/schemas/settings.ts`** — appended:
- `orderInputSchema` (manual form), `orderItemSchema`, `PAYMENT_METHOD_VALUES`
- `normalizePhoneId()` utility

### Components baru

- `src/components/orders/order-form.tsx` — shared OrderForm dipakai di `/orders/new` + Edit mode di `/orders/[id]`
- `src/components/ui/combobox.tsx` — search-able dropdown (Popover + Command)

### Migration

**`src/lib/supabase/migrations/012_order_number_generator.sql`:**
- `generate_order_number(org_id)` — race-safe loop, format GB-YYYYMMDD-NNNNNN
- Improved `log_order_status_change()` trigger — uses `auth.uid()` for UPDATE case (was always `NEW.created_by`, incorrect for status changes by different user)
- `update_order_status(order_id, new_status, source, note)` — atomic update + patch latest history row dengan note + custom source

**Run order:** Phase 1 (010) → seed → wilayah import → Phase 3A (012). Migration 011 belum ada (skipped).

### Build status

- `npx tsc --noEmit` pass (no errors)
- `npm run build` pass — 7 routes baru/refactor ke-list di output

### Implementasi: full vs stub

| Feature | Status |
|---|---|
| Engine INBOUND_ORDER | ✅ Full |
| Engine WA_PASTE | ✅ Full |
| Engine INBOUND_REKONSIL | ⏸️ Phase 3B |
| Engine OUTBOUND_TO_COURIER | ⏸️ Phase 3C |
| Bulk upload (4 step) | ✅ Full |
| WA paste | ✅ Full |
| Manual form + cascade wilayah | ✅ Full |
| Order detail (4 tabs) | ✅ Full |
| Edit Status + Edit Order | ✅ Full |
| Pending Review (single + bulk approve/reject) | ✅ Full |
| Order number generator (race-safe) | ✅ Full |
| cs_name → cs_id resolve | ✅ Full (lookup, no auto-create) |
| Concat_address & sum_qty transforms | ✅ Full |

### Decision yang Claude Code ambil

1. **Order number race condition** — pakai SQL function dengan retry loop (Opsi A per brief), aman untuk concurrent inserts.
2. **Status history note for rejection reason** — pakai `update_order_status()` RPC yang patch row terakhir history dengan note + source. Cleaner daripada double-insert workaround di app layer.
3. **Edit & Approve di pending-review** — diarahkan ke `/orders/[id]` lalu klik "Edit Order" (consistency). Tidak ada inline edit di list page.
4. **Auto-create user dari cs_name** — TIDAK diimplementasi (per brief). cs_name disimpan text only kalau full_name tidak match `profiles`.
5. **OUTBOUND profile preview di /orders/bulk-upload** — di-filter out di list profile (only INBOUND_ORDER). Outbound nanti ada UI sendiri di Phase 3C.
6. **Combobox** — dibuat custom component (shadcn-style) pakai Popover + Command (keduanya sudah ada). Kalau perform jelek di mobile dengan 8k+ city items, fallback strategy: limit dropdown size, prioritize search.
7. **Refactor preview.ts** — extract shared parser logic ke `parser.ts` agar engine + preview share core. Tidak duplicate.

### Hal yang perlu di-flag untuk Phase 3B (Rekonsil)

- Engine perlu support direction=INBOUND_REKONSIL: **update existing orders** by resi (dari rekonsil ekspedisi), set status berdasarkan `courier_channel_statuses` mapping, populate `shipping_cost_actual` + `payout_amount`.
- Untuk resi yang nggak match: insert ke `inbox_unmatched_resi` (UI sudah jadi di Phase 2B).
- Untuk raw status yang belum ke-mapping: insert ke `inbox_unmapped_statuses` (UI sudah jadi di Phase 2B).
- Reuse `parser.ts` dan `applyMappings` logic dari engine.ts.
- Tidak overlap dengan Phase 3A — clean separation by direction.

### Catatan

- 5 Phase 2A pages + 4 Phase 2B pages tetap intact (Settings → Master Data + Converter Profiles + Inbox Review).
- Migration 011 nomor di-skip — kalau Phase 3B butuh migration baru, pakai 011 dulu (atau 013 — konsistensi numerik tergantung). Saran: 013 (skip 011 secara permanen, dokumentasi sebagai gap).

---

## Phase 3B — Rekonsil Engine + Upload UI (COMPLETED)

Engine rekonsil yang match orders by resi/order_number → update status + biaya aktual + route mismatches ke inbox tables. Sekarang daily ops jadi semi-otomatis: upload financial_report dari ekspedisi → status orders auto-update + biaya aktual masuk + anomali ke inbox.

### Engine + helpers

**`src/lib/converter/engine-rekonsil.ts`** (NEW):
- `ingestRekonsil({ profile, fieldMappings, valueMappings, statusMappings, fileOrText, organizationId, performedBy, supabase, onProgress? })`
- Direction harus `INBOUND_REKONSIL`. Validates upfront.
- Lookup order by `profile.primary_key_target` (`resi` / `external_order_id` / `order_number`)
- Status determination:
  1. Strategy keyed by `profile.code` di `status-inference.ts` (e.g. `spx_financial_rekonsil` → `inferSpxStatus`)
  2. Fallback: `extractedRow.status_raw` lookup di `courier_channel_statuses` mapping
  3. Mapping miss → insert ke `inbox_unmapped_statuses` (UNIQUE constraint handle dedup, occurrence_count increment)
- Cost updates: `shipping_cost_actual`, `payout_amount`, `cod_amount` di-update via RPC (whitelist di engine)
- Order tidak ketemu → insert ke `inbox_unmatched_resi`. Idempotent: skip kalau row dengan raw_resi+resolved=FALSE udah ada
- Returns `{ matched, status_updated, cost_updated, inbox_unmatched, inbox_unmapped_status, errors[], warnings[], totalRowsDetected }`

**`src/lib/converter/status-inference.ts`** (NEW):
- `inferStatusForProfile(profile, rawRow)` — switch by `profile.code`. Returns `null` → caller fallback ke status_raw mapping
- `inferSpxStatus(rawRow)` — implementasi SPX:
  - `Return Fee > 0` → `RETUR` (raw_status: `INFERRED_RETUR (return_fee>0)`)
  - `Escrow > 0` → `DITERIMA` (raw_status: `INFERRED_DITERIMA (escrow>0)`)
  - else → null (tidak update status, tidak masuk inbox unmapped — sengaja, karena `INFERRED_UNKNOWN` bukan "raw status missing")

**`src/lib/converter/preview.ts`** — appended `previewRekonsil(supabase, orgId, profile, fms, vms, statusMappings, fileOrText, maxRows=5)`:
- Enriched preview: per row, lookup order existing & display match status (Found/Not Found), planned status badge before→after, cost updates, inbox unmapped warning
- Read-only — no DB writes

### Pages

- `/reconciliation/upload` — multi-step (Profile → File → Preview → Process → Done) UI dengan stat cards di final step + tombol navigate ke inbox masing-masing kalau ada anomali
- `/reconciliation` (existing dari sebelum Phase 1) NOT modified — coexist sebagai "Cross-check Platform"

### Migration

**`src/lib/supabase/migrations/014_rekonsil_helpers.sql`:**
- `update_order_from_rekonsil(order_id, new_status, shipping_cost_actual, payout_amount, cod_amount, meta_merge, status_changed_at, source_profile_id, raw_status, note)` RPC
- Atomic: UPDATE orders SET ... (COALESCE-based, NULL params no-op) → trigger fires kalau status berubah → patch latest history row dengan source='converter_rekonsil' + raw_status + note
- Schema mendukung `'converter_rekonsil'` di enum `order_status_history.source` — sudah ada sejak migration 010, no schema change needed
- `inbox_unmapped_statuses` UNIQUE (organization_id, channel_id, raw_status) — sudah ada sejak migration 010, app pakai SELECT-then-UPDATE/INSERT pattern (tidak pakai ON CONFLICT karena ingin kondisi `resolved=true` tetap increment occurrence tapi tidak counter result.inbox_unmapped_status)
- Verified runnable: RPC dengan bogus order_id → throws P0002 'Order not found' (callable + working)

### Sidebar

- "Reconciliation" sekarang punya 2 sub-items:
  - Cross-check Platform → `/reconciliation` (existing)
  - Upload File Rekonsil → `/reconciliation/upload` (new)
- Group accessible untuk owner + admin (sebelumnya owner only — admin perlu rekonsil daily)

### Decisions

1. **Engine split** — `engine-rekonsil.ts` separate file dari `engine.ts` (Phase 3A). Beda concern (lookup-update vs insert), beda return shape, beda flow control. Cleaner sebagai 2 file.
2. **Status inference** — switch-case `profile.code` di `status-inference.ts`, bukan strategy pattern formal atau new column `infer_status_strategy` di DB. YAGNI sampai ada 5+ aggregator. Migration column add di-skip dari brief optional.
3. **`INFERRED_UNKNOWN` tidak ke inbox** — kalau SPX inference return null (escrow=0 + return_fee=0), engine skip status update tapi NOT route ke inbox unmapped. Karena `INFERRED_UNKNOWN` bukan "raw status missing from mapping" — itu kondisi data yang ambigu (mungkin file rekonsil incomplete). User bisa cek manual via order detail.
4. **`status_changed_at` source** — kalau profile mapping ada (e.g. SPX `Delivered/Returned Time` → `status_changed_at`), engine pakai value itu. Kalau kosong, fallback `NOW()` saat status berubah (di RPC `COALESCE(p_status_changed_at, NOW())`).
5. **Trigger overlap** — RPC pakai pattern Phase 3A: UPDATE → trigger insert auto history row ('manual') → patch row terakhir. Konsisten + tidak duplicate insert.
6. **Idempotency** — re-upload file aman:
   - Order yang status sudah cocok: trigger nggak fire (no status change), no extra history row
   - Cost yang sama: COALESCE in RPC, no actual diff
   - Unmatched inbox: skip kalau ada row dengan raw_resi+resolved=FALSE
   - Unmapped statuses: increment occurrence_count + last_seen_at via SELECT-then-UPDATE

### Build status

- `npx tsc --noEmit` ✅ no errors
- `npm run build` ✅ `/reconciliation/upload` ke-list (semua 50 routes)

### Hal yang perlu di-flag untuk Phase 3C (Outbound)

- Engine perlu support direction=`OUTBOUND_TO_COURIER`: query orders status SIAP_KIRIM, apply field mappings di reverse (internal → file_column), generate CSV/XLSX file untuk download
- Reuse `applyTransform()` (sebagian transforms cocok untuk outbound, e.g. `phone_to_628`, `kg_format`, `concat_address` yang udah implemented Phase 3A)
- Profile `mengantar_outbound` udah di-seed Phase 1 dengan 14 field mappings target_table='file_column' — Phase 3C engine tinggal konsumsi
- Setelah download, mark orders status DIKIRIM atau biarkan SIAP_KIRIM sampai ada konfirmasi resi dari ekspedisi (Phase 3B akan update saat upload rekonsil)
- Tidak overlap dengan Phase 3A/3B engine — separate file `engine-outbound.ts`

---

## Phase 3C — Outbound Engine + Export (COMPLETED)

Loop converter engine GrandBook sudah lengkap. Untuk daily ops, Barry sekarang bisa:
1. Filter & pilih order yang sudah SIAP_KIRIM (channel/status/date range/search)
2. Pilih outbound profile → preview rows
3. Generate file CSV/XLSX sesuai format ekspedisi/agregator (Mengantar pre-seeded)
4. Optional: mark orders DIKIRIM dengan catatan batch (note → order_status_history)

### Engine + helpers (4 files)

**`src/lib/converter/engine-outbound.ts`** (NEW):
- `generateOutbound({ profile, fieldMappings, valueMappings, orderIds, organizationId, performedBy, supabase, onProgress? })`
  - Returns `{ rowsGenerated, ordersIncluded, ordersSkipped, fileBlob, fileName, headers, rows, warnings, errors }`
  - Internally calls `buildOutboundRows()` (lower-level shared with preview) → `serializeForProfile()` → `suggestOutboundFilename()`
- `buildOutboundRows(opts)` — rows-only result (no Blob). Direction harus `OUTBOUND_TO_COURIER`. Bulk-load orders+items+channel chunked 200/req
- `markOrdersExported(supabase, orderIds, newStatus, sourceProfileId, note)` — wrapper RPC call
- Re-exports for convenience: `resolveSourceValue`, `serializeCsv/Xlsx/ForProfile`, `downloadBlob`, `suggestOutboundFilename`

**`src/lib/converter/outbound-resolvers.ts`** (NEW — pure functions):
- `resolveSourceValue(sourceField, order, warnings)` — handles all source_field patterns:
  - Direct order column (`customer_name`, `order_number`, `notes`, ...)
  - `order_items.<aggregate>` → `total_qty`, `total_weight`, `total_price`, `product_summary`, `product_names`, `count`, `first_product_name`, `first_product_variation`
  - `channel_courier_code` / `channel_aggregator` / `channel_name`
  - `total_if_cod`, `total_if_transfer`, `cod_amount_or_empty` — return `null` (not '') so empty cells stay empty
  - `concat_address` — single-string full address
  - `meta.<key>` → orders.meta JSON value
- `computeTotalWeight(items, order, warnings)` — sums `qty × weight_per_unit`, falls back to `DEFAULT_ITEM_WEIGHT_KG=1` per item if any item has no weight, emits warning
- `formatProductSummary(items)` — "1x Baju Wanita Hitam M, 2x Kaos Pria Putih L" format (qty di depan, variation appended dengan space)
- `concatFullAddress(order)` — gabung detail + village + subdistrict + city + province + zip

**`src/lib/converter/serializer.ts`** (NEW):
- `serializeCsv(rows, headers, delimiter, encoding)` — pakai `Papa.unparse`, prepend `﻿` BOM kalau encoding='utf-8-sig'
- `serializeXlsx(rows, headers, sheetName)` — pakai `XLSX.write` (array buffer)
- `serializeForProfile(profile, rows, headers)` — branch by `profile.file_format`, single entry-point untuk engine + UI
- `downloadBlob(blob, filename)` — trigger browser download via `URL.createObjectURL` + temporary `<a>`
- `suggestOutboundFilename(profile, at?)` → `${code}_YYYYMMDD_HHMMSS.${ext}` (HHMMSS, includes seconds)

**`src/lib/converter/preview.ts`** — appended `previewOutbound(supabase, orgId, profile, fms, vms, orderIds, maxOrders=5)`:
- Thin wrapper around `buildOutboundRows(orderIds.slice(0, max))` returning `OutboundPreviewResult` (extends `OutboundRowsResult` dengan `totalOrdersRequested`)
- Read-only — no DB writes

### Pages

- `/orders/export-resi` — 5-step UI (Filter → Profile → Preview → Generate → Done)
  - **Step 1 (Filter):** channel filter + status filter (SIAP_KIRIM default, BARU, ELIGIBLE=both, DIKIRIM=re-export) + date range from/to + search by order#/customer/kota. Multi-select dengan select-all-filtered di header
  - **Step 2 (Profile):** dropdown OUTBOUND profiles aktif. Mixed-channels warning kalau selection campur >1 channel
  - **Step 3 (Preview):** table 14 kolom + max 5 row sample. Channel-mismatch warning kalau profile.channel_id ≠ semua channel di selection
  - **Step 4 (Generate):** progress bar + auto-download file
  - **Step 5 (Done):** filename + 4 stat cards. Pertanyaan card: 2 buttons "Selesai" / "Update Status & Selesai". Optional textarea "Catatan ekspor" → masuk `order_status_history.note` untuk audit (200 char max)

### Migration

**`src/lib/supabase/migrations/015_outbound_helpers.sql`:**
- Extend `order_status_history.source` CHECK constraint dengan `'outbound_export'` (sebelumnya 6 nilai, sekarang 7)
- `mark_orders_exported(order_ids[], new_status, source_profile_id, note)` RPC bulk-update orders ke status (DIKIRIM typically) + patch row history terakhir per order dengan source='outbound_export'. Returns count yang actually updated (skip no-ops). Pattern konsisten dengan `update_order_from_rekonsil`.
- Verified runnable: RPC dengan empty array → return 0; with bogus org context → 'No organization context' (callable + working).

### Sidebar

- Group "Orders" sekarang punya 5 sub-items (sebelumnya 4):
  - Input Order Baru, Upload Massal, WA Paste, **Export ke Ekspedisi**, Daftar Order
- Permission check di page (`canApproveOrders`), bukan di sidebar — non-owner/admin lihat empty state.

### Decisions

1. **Engine separate file** — `engine-outbound.ts` ≠ `engine.ts` (3A) ≠ `engine-rekonsil.ts` (3B). Beda concern (read-many-orders → produce-file vs row-then-insert/update). Split tambahan: `outbound-resolvers.ts` (pure resolvers) + `serializer.ts` (file generation) untuk testability.
2. **Computed source_field syntax** — pakai prefix konvensional (`order_items.total_qty`, `meta.<key>`, `channel_courier_code`, `total_if_cod`). Recognized di `resolveSourceValue()` dengan switch. Alternative (DB column `computed_expression` JSON) di-skip (YAGNI sampai user butuh expression baru di luar list yang sudah ada).
3. **`previewOutbound`** — thin wrapper, bukan implementasi independent. Share semua logic dengan `buildOutboundRows`. Outbound preview tetap query DB (orders + items + channel) — beda dari preview parser inbound yang pure (file-only). OK karena cost kecil (5 orders).
4. **Post-action UX (2 buttons setelah download, bukan checkbox sebelum)** — sesuai brief Phase 3C. UX rationale: user perlu lihat file dulu sebelum decide apakah commit ke DIKIRIM. Default `Selesai` = orders tetap SIAP_KIRIM (workflow ideal: rekonsil Phase 3B akan auto-update). `Update Status & Selesai` untuk org yang butuh tanda "handover ke ekspedisi" segera (internal SLA / batch tracking).
5. **Optional batch note** — textarea kecil di Step 5. Disimpan di `order_status_history.note` untuk audit. Tidak required, kalau kosong fallback ke "Outbound export via {code} ({filename})".
6. **CSV BOM** — prepend `﻿` ke Blob hanya kalau `profile.file_encoding='utf-8-sig'`. Mengantar pakai utf-8-sig sehingga otomatis BOM-friendly buat Excel.
7. **File generation client-side** — Papa.unparse + XLSX.write di browser. Tidak butuh server endpoint. Konsisten dengan pattern client-side + Supabase direct.
8. **Bulk vs loop RPC** — `mark_orders_exported` PASS array dan loop di server (bukan loop dari client) untuk efisiensi. Beda dari 3A/3B yang loop per-row di client karena tiap row punya data berbeda.
9. **Default weight fallback 1kg** — kalau `weight_per_unit` null/0, fallback `DEFAULT_ITEM_WEIGHT_KG=1` per unit dengan warning. Mengantar minta Berat field, jadi gak boleh kosong. User bisa fix product master nanti dari warning yang ditampilkan.
10. **Source enum value 'outbound_export'** — bukan 'converter_outbound'. Sesuai brief: action-oriented naming (export = action) konsisten dengan 'admin_review' di enum yang sudah ada.
11. **Per-field operation order** — resolve → value mapping → transform. Mengikuti existing pattern engine-rekonsil/engine. Brief sebut transform-then-mapping di salah satu paragraf — di-skip karena pattern existing lebih konsisten + mendukung mapping yang depend pada transformed value (e.g. uppercase pre-mapping).

### Build status

- `npx tsc --noEmit` ✅ no errors
- `npm run build` ✅ `/orders/export-resi` ke-list di output (50 routes total)

### Hal yang perlu di-flag untuk Phase 4 (Commission Engine v2 + Analytics)

- Outbound engine tidak touch commissions table. Phase 4 commission engine bisa-bisa hooking ke status transition (e.g. trigger di order_status_history) atau on-demand recompute.
- Outbound flow konsisten dengan brief — tidak ada side-effect ke commission yet.
- Profile `mengantar_outbound` channel JNE_VIA_MENGANTAR → cocok untuk demo Phase 4 perhitungan commission per channel/courier.

---

## Phase 3.5 — Polish (UX & Bug Fixes) (COMPLETED)

4 bug yang muncul setelah daily ops dimulai. Goal: bikin sistem lebih cepat dipakai keyboard, dropdown konsisten cross-OS, label benar, dan empty-state guidance.

### Files yang berubah

**Component:**
- `src/components/ui/combobox.tsx` — refactor:
  - `autoOpenOnFocus` (default true) — popover auto-open saat trigger Tab/click. `skipNextAutoOpenRef` guard mencegah re-open setelah selection/Esc/outside-click.
  - `emptyHint?: { message, actionLabel?, actionHref? }` — render CTA card saat `options.length === 0`. Berbeda dari `emptyText` (yang muncul saat search yield 0).
  - `CommandList` override class jadi `max-h-72 overflow-y-auto overflow-x-hidden` — scrollbar visible (sebelumnya `no-scrollbar` dari command.tsx default — bermasalah di Mac Safari).
  - `PopoverContent` width: `w-[var(--anchor-width)] min-w-[260px]` — match trigger width.
  - Trigger button accepts `onFocus` → `setOpen(true)`.
- `src/components/ui/refactor-banner.tsx` — tambah optional `description` prop dengan fallback ke teks default.

**Pages dengan SelectValue render-fn injected (Bug #4):**
- `src/app/(app)/orders/bulk-upload/page.tsx` — profile picker
- `src/app/(app)/orders/wa-paste/page.tsx` — profile picker
- `src/app/(app)/orders/export-resi/page.tsx` — profile picker + Step 1 channel filter
- `src/app/(app)/reconciliation/upload/page.tsx` — profile picker
- `src/app/(app)/orders/list/page.tsx` — channel filter
- `src/app/(app)/inbox/pending-review/page.tsx` — channel + source filter
- `src/app/(app)/inbox/unmatched-resi/page.tsx` — source profile filter
- `src/app/(app)/inbox/unmapped-statuses/page.tsx` — channel filter
- `src/app/(app)/settings/courier-channels/page.tsx` — courier filter
- `src/app/(app)/settings/courier-rates/page.tsx` — channel filter
- `src/app/(app)/settings/status-mapping/page.tsx` — channel filter
- `src/app/(app)/settings/converter-profiles/page.tsx` — direction + channel filter
- `src/app/(app)/settings/converter-profiles/[id]/page.tsx` — bulk-copy source profile

**Pages converted Select → Combobox (with emptyHint):**
- `src/components/orders/order-form.tsx` — Channel dropdown (was Select with render-fn) + Advertiser dropdown (was Select). Both now Combobox with emptyHint linking ke `/settings/courier-channels` resp `/settings/users`.

**Analytics:**
- `src/app/(app)/analytics/page.tsx` — banner update dengan `phase="Phase 4 (Commission Engine v2 + Analytics Revamp)"` + description.

### Decisions

1. **In-place SelectValue patch vs convert ke Combobox** — chosen in-place patch untuk filter dropdowns (channel/source) supaya minimize change, lebih konservatif. Hanya ubah ke Combobox di `/orders/new` (Channel + Advertiser) karena di sana flow keyboard cascade Wilayah lebih penting + user benefit dari empty-state hint.
2. **`autoOpenOnFocus` default true** — sesuai brief. Bisa di-opt-out per call site kalau ada page yang butuh behavior beda (belum ada use-case sekarang).
3. **`skipNextAutoOpenRef` ref-based guard** — alternative pakai state akan trigger re-render yang nggak perlu. Ref read/write lebih cocok untuk transient flag yang nggak mempengaruhi UI.
4. **Empty hint render replaces CommandInput** — saat data benar-benar kosong, search input tidak ditampilkan (nothing to search). CommandInput muncul lagi saat `options.length > 0`.
5. **`no-scrollbar` removal** — dilakukan di Combobox, bukan di `command.tsx` global. Reasoning: command.tsx default mungkin dipakai di context lain (e.g. command palette / dialog) di mana hidden scrollbar diinginkan. Combobox ditunjuk explicit.
6. **Bug #1 Analytics deferred** — sesuai brief, hanya update banner. Analytics rebuild masuk Phase 4 bersama Commission Engine v2.

### Build status

- `npx tsc --noEmit` ✅ no errors
- `npm run build` ✅ 50 routes intact (no new routes, no removed routes)

### Hal yang perlu di-flag

- **Audit Mac Safari rendering** — Phase 3.5 fix berdasarkan reasonable hypothesis (hidden scrollbar via `no-scrollbar` Tailwind utility). User wajib verify di Safari Mac yang real — kalau masih ada issue, identify root cause spesifik (animation glitch? z-index? portal positioning?) baru fix lanjutan.
- **Pages yang masih pakai Select dengan numeric ID di luar audit Phase 3.5** — sudah comprehensive scan, tapi kalau ada page baru ditambah next phase, ingat pattern: pass render-function child ke `<SelectValue>` untuk lookup label.
- **Combobox emptyHint** — bisa dipakai di lebih banyak dropdown kalau ada empty-state UX. Phase 3.5 hanya wire ke advertiser + channel di `/orders/new` untuk demo.

---

## Phase 4A — Commission Engine v2 + Pencairan UI (COMPLETED)

Re-aktifkan commission engine yang lama (drop di Phase 1) dengan adjust ke status enum baru + add PAID workflow + payment audit fields. Setelah Phase 4A: tiap order DITERIMA otomatis trigger commission compute, owner bisa mark komisi PAID.

### Files yang dibuat / berubah

**Migration:**
- `src/lib/supabase/migrations/016_commission_v2.sql` — comprehensive:
  1. Cleanup 133 orphan commissions (FK ke orders missing dari pre-Phase 1)
  2. Convert `commissions.status` dari ENUM type (legacy `commission_status`) → TEXT, drop type, add CHECK constraint dengan 'PAID'
  3. Add 5 pencairan kolom: `paid_at`, `paid_by` (FK profiles), `payment_method`, `payment_reference`, `payment_note`
  4. Add 3 indexes (status PAID partial, user+status composite, order_id)
  5. Re-add FK `commissions_order_id_fkey` (REFERENCES orders ON DELETE CASCADE) — sebelumnya tidak ada
  6. `compute_commissions(order_id)` function — status enum baru (DITERIMA→EARNED, RETUR/CANCEL/FAKE→CANCELLED, lainnya→ESTIMATED). Lookup priority: (user+product) > (user) > (product) > (role only). PAID immutable via WHERE clause.
  7. `trigger_compute_commissions()` + `trg_compute_commissions` AFTER INSERT OR UPDATE OF status ON orders
  8. `mark_commission_paid(id, method, ref?, note?)` — single. Validate org + status='EARNED'. Throws P0002 / 42501 / 22023.
  9. `bulk_mark_commission_paid(ids[], method, ref?, note?)` — bulk single UPDATE. Returns ROW_COUNT.
  10. Backfill loop — process all existing orders.

**Helper queries:**
- `src/lib/supabase/queries/commissions.ts` (NEW):
  - `listCommissions(supabase, filter)` — embed user, paid_by_user, order (`!inner` join). Client-side search filter karena PostgREST nggak bisa ilike across embedded.
  - `computeStats(rows)` — sum amount + count by status
  - `periodToDates(period, customFrom?, customTo?)` — preset 'this_month'/'last_month'/'all'/'custom'
  - `markCommissionPaid` + `bulkMarkCommissionPaid` — RPC wrappers

**Schema/Types:**
- `src/lib/types.ts` — `CommissionStatus` union extended (legacy values kept), `COMMISSION_V2_STATUSES`, `CommissionV2Status` type, `CommissionPaymentMethod`. `Commission` interface tambah pencairan fields.
- `src/lib/schemas/settings.ts` — appended `commissionPaymentSchema` (Zod), `COMMISSION_PAYMENT_METHODS`, `COMMISSION_PAYMENT_METHOD_LABEL`, `COMMISSION_STATUS_LABEL`, `COMMISSION_STATUS_BADGE_COLOR`.

**Pages:**
- `src/app/(app)/commissions/my/page.tsx` — refactor dari banner. 4 stat cards (Estimated/Earned/Paid/Cancelled) + filter (period preset + custom range, status) + tabel komisi user. RLS + explicit `userId` filter ke `auth.uid()`.
- `src/app/(app)/commissions/manage/page.tsx` — refactor dari banner. Owner-only (gate). Tabs (EARNED default → Pending Pencairan / Paid / Estimated / Semua). Filter user + period + search. Multi-select checkbox header (only EARNED selectable). Bulk action banner. Mark Paid Dialog dengan total + warning. Reuse single + bulk via `dialogTargetIds`.

**Sidebar:**
- `src/lib/constants.ts` — Komisi group sudah role-based dari sebelumnya. `getNavItemsForRole` filter non-owner ke "Komisi Saya" only (line 238-240). Owner lihat keduanya. Aturan Komisi (group Settings) tetap owner-only.

**Docs:**
- `docs/phase4a-test.md` — manual smoke test 13 sections incl. trigger compute, re-compute on status change, both pages happy paths, bulk mark paid, PAID immutability, rules priority, sidebar visibility.

### Decisions

1. **Status ENUM → TEXT conversion** — production sebenarnya pakai `commission_status` ENUM type (Phase 0 schema). Brief assumes TEXT + CHECK. ALTER TYPE ADD VALUE 'PAID' nggak bisa di-jalankan inside transaction (Postgres limitation). Pilih convert ke TEXT supaya migration clean + idempotent. Drop legacy type kalau tidak ada dependency.
2. **Cleanup orphan commissions sebelum add FK** — 133 baris commissions referensi order yang sudah dihapus di Phase 1. Tanpa cleanup, FK `ON DELETE CASCADE` add akan fail. Brief tidak mention orphan — discovered via probe.
3. **Brief redundancy CASE-WHEN di compute_commissions di-skip** — `WHERE public.commissions.status <> 'PAID'` sudah cukup untuk PAID immutability. CASE inside SET dead code.
4. **`!inner` join syntax di SELECT** — order_date filter via embedded relation defaults LEFT JOIN, jadi filter nggak affect parent rows. `order:orders!commissions_order_id_fkey!inner(...)` confirmed working via probe.
5. **Search filter client-side** — PostgREST nggak support `ilike` chained dengan `in()` filter di embedded. Search across `order_number`/`customer_name` dilakukan setelah fetch (cap 500 rows).
6. **Tabs default = EARNED** — most-actionable workflow untuk owner (lihat komisi yang perlu dibayar). Brief sebut "EARNED (Pending Pencairan)" sebagai default.
7. **Bulk checkbox header hanya enabled saat tab EARNED** — selection logic per-row check `r.status === 'EARNED'`. Tab lain → checkbox header disabled, no checkbox per row.
8. **Backward-compat `CommissionStatus` union** — added `'PAID'` ke union (sebelumnya `'PENDING' | 'APPROVED' | ...`). Halaman legacy yang reference `CommissionStatus` tidak break karena union extend.
9. **Stats client-side** — `computeStats(rows)` dari fetched rows (max 500). Acceptable untuk current scale. Phase 4B Analytics akan butuh server-side aggregation RPC kalau volume tumbuh.
10. **Per-user breakdown stat card brief** — di-skip. UX lebih clean dengan filter user di card sendiri. Phase 4B Analytics bisa add full breakdown.

### Build status

- `npx tsc --noEmit` ✅ no errors
- `npm run build` ✅ 50 routes total. `/commissions/my` + `/commissions/manage` ke-list (sebelumnya banner placeholder).

### Hal yang perlu di-flag untuk Phase 4B (Analytics Revamp)

- **Stats client-side limited 500 rows** — kalau scale lebih dari itu, butuh server-side aggregation RPC (`commission_stats(p_user_id, p_from, p_to)` returning sum + count per status).
- **No realtime refresh** — owner mark paid sambil CS lihat /commissions/my → CS perlu reload manual. Phase 4B / 4C bisa add Supabase realtime channel subscription.
- **PAID commission tidak ter-cover audit trail change ke orders** — kalau order dengan PAID commission di-RETUR, status order berubah tapi commission tetap PAID. Ini intentional (preserve audit trail) tapi mungkin perlu warning UI di order detail "Commission untuk order ini sudah dicairkan."
- **Backfill limit** — DO block backfill loop processes semua orders (current 41 di production). Kalau >10k orders, perlu batch atau async backfill.

---

## Phase 4B — Analytics Revamp + Per-Role Dashboards (COMPLETED)

Visibility layer komplit. Owner punya overview business lengkap; CS/advertiser punya dashboard personal mereka.

### Files yang dibuat/berubah

**Migration:**
- `src/lib/supabase/migrations/017_analytics_aggregations.sql` — 5 RPCs server-side aggregation:
  1. `analytics_overview(from, to)` — single-row aggregate (orders, revenue, COGS via hpp_snapshot, shipping, commissions per status, status counts)
  2. `analytics_daily_revenue(from, to)` — line chart series
  3. `analytics_per_cs(from, to)` — breakdown per CS dengan conversion rate + commissions earned/paid
  4. `analytics_per_advertiser(from, to)` — mirror per CS
  5. `analytics_per_channel(from, to)` — per channel dengan shipping_diff (charged - actual)
- Semua function `STABLE SECURITY DEFINER` + scoped ke `current_org_id()`. Conversion rate hanya count order final (DITERIMA + RETUR), bukan total.

**Helper queries:**
- `src/lib/supabase/queries/analytics.ts` (NEW): RPC wrappers + `fetchPersonalDashboard({ role, userId, from, to })` untuk personal-stats query (orders + commissions filter by user_id, daily series compute client-side karena dataset kecil per user).

**Pages:**
- `src/app/(app)/analytics/page.tsx` — refactor dari banner. 4 tabs (Overview/Per CS/Per Advertiser/Per Channel). Overview: 8 stat cards + AreaChart daily revenue + PieChart status distribution. Per CS / Per Advertiser: sortable table (orders/revenue/conv/commission) + horizontal Top-5 BarChart. Per Channel: table dengan shipping_diff color-coded.
- `src/app/(app)/cs-dashboard/page.tsx` — refactor dari banner ke thin wrapper PersonalDashboard role='cs'.
- `src/app/(app)/adv-dashboard/page.tsx` — refactor dari banner ke thin wrapper PersonalDashboard role='advertiser'.

**Components:**
- `src/components/analytics/personal-dashboard.tsx` (NEW): shared component untuk /cs-dashboard + /adv-dashboard. Stat cards (Total/Revenue/Diterima/Retur/Commission Earned/Paid) + AreaChart daily orders + 10 order terbaru table. Owner-mode tampil dropdown filter user (Combobox dengan emptyHint Phase 3.5).

**Sidebar:**
- `src/lib/constants.ts` — `/analytics` already owner-only. `/cs-dashboard` keep admin di sidebar group (untuk akses sub-pages /cs-report, /team/cs) — page-level gate di PersonalDashboard deny non-(cs|owner). `/adv-dashboard` already cs-clear (owner+advertiser).

### Decisions

1. **Server-side aggregation RPCs** — bukan fetch-then-reduce di client. Untuk /analytics page (owner overview), RPC pattern lebih efisien untuk volume orders besar. Conversion rate computed di SQL dengan ROUND(...,2).
2. **Personal dashboard pakai direct query, bukan RPC** — karena scope lebih sempit (1 user) + butuh row-level detail (10 order terbaru). Overhead minimal, dan reuse `fetchPersonalDashboard` cleaner.
3. **Reuse DateRangePicker existing** — sudah ada dari Phase 0 dengan presets lengkap (Hari ini, Minggu ini, Bulan ini, Bulan lalu, 30 hari terakhir, custom). Tidak perlu rebuild.
4. **Recharts** — sudah ada di package.json (`^3.8.0`). Tidak install ulang.
5. **Pie label custom callback di-skip** — Recharts v3 strict TS typing bikin custom label sulit. Pakai default tooltip + legend di samping.
6. **PersonalDashboard component reuse** — `/cs-dashboard` & `/adv-dashboard` cuma diff `role` prop. DRY, single source of truth untuk personal-stats UI.
7. **Owner override dropdown** — di PersonalDashboard, owner lihat Combobox filter user. Non-owner langsung self. emptyHint Phase 3.5 wired ke `/settings/users`.
8. **Hydration drift fix** — `range` state di-init dengan stale `thisMonth` import (constant), lalu `useEffect` overwrite ke `thisMonth()` (current). `rangeReady` flag mencegah fetch sebelum client value resolved.
9. **Existing /dashboard tidak diubah** — sudah pakai schema baru (CANCEL/FAKE filter), no `duplicate_of`/`SAMPAI`/`SELESAI` reference.
10. **Per-CS query CTE pattern** — `cs_orders` CTE di-reference 2x (untuk agg + commission lookup) supaya tidak double-scan orders. Performance-friendly.

### Build status

- `npx tsc --noEmit` ✅ no errors
- `npm run build` ✅ 50 routes intact. `/analytics`, `/cs-dashboard`, `/adv-dashboard` semua organic (bukan banner).

### Hal yang perlu di-flag untuk Phase 4C (Pencairan COD Reconciliation)

- **Realtime refresh masih manual** — Phase 4B punya RefreshCw button, tapi tidak listen Supabase realtime channel. Phase 4C bisa add subscription supaya commission/order changes auto-reflect tanpa user interaction.
- **Export PDF/Excel report** — explicit out-of-scope Phase 4B. Owner perlu screenshot atau copy table manual. Phase 4C bisa wire library jspdf atau exceljs.
- **Drill-down belum ada** — klik row Per CS di /analytics tidak deeplink ke /commissions/manage filter user X. UX improvement nice-to-have.
- **Mobile table overflow** — table lebar (8+ kolom) overflow horizontal di mobile. ResponsiveContainer chart OK, tabel butuh wrapper scroll.
- **Product-level analytics** — top seller per produk tidak di-cover. Phase 5 candidate.
- **Cache strategy** — semua tab di /analytics fetch sekaligus. Tab switching tidak refetch. Date range change → refetch all 5 RPCs paralel. Untuk dataset besar, butuh per-tab lazy fetch atau React Query.

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
| **012** | **Phase 3A — order_number generator + status RPC** | **✅ Active** |
| **013** | **Phase 1.5 — wilayah distinct helpers** | **✅ Active** |
| **014** | **Phase 3B — rekonsil RPC** | **✅ Active** |
| **015** | **Phase 3C — outbound source enum + bulk mark RPC** | **✅ Active** |
| **016** | **Phase 4A — commission engine v2 + pencairan RPCs** | **✅ Active** |
| **017** | **Phase 4B — analytics aggregation RPCs** | **✅ Active** |
| 018+ | TBD next phases | — |

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
