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
| Phase 3B — Rekonsil Engine | ⏳ NOT STARTED | — |
| Phase 3C — Outbound Engine + Export | ⏳ NOT STARTED | — |
| Phase 4 — Commission Engine v2 + Analytics | ⏳ NOT STARTED | — |

**Phase 3A done.** GrandBook sekarang bisa receive order dari 3 jalur (manual form, bulk upload, WA paste) → admin approval inbox → order detail dengan status timeline. Phase 3B (rekonsil ekspedisi) akan handle status update + biaya aktual; Phase 3C handle export ke ekspedisi.

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
