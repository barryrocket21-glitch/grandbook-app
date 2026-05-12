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
| Phase 4C — Estimated Cost Engine + Multi-Model Billing | ✅ DONE | 2026-05-11 |
| Phase 4D — Actual Reconciliation File Upload | ⏳ NOT STARTED | — |
| Phase 5A — Products Extended + Operational Expenses | ✅ DONE | 2026-05-11 |
| Phase 5B — Ad Spend + Campaigns + ROAS | ✅ DONE | 2026-05-11 |
| Phase 6 — CS Daily Report + ADV-CS Cross-Check Funnel | ✅ DONE | 2026-05-11 |
| Phase 6 redesign — Analytics Horizontal Nav + Detail Per Produk | ✅ DONE | 2026-05-12 |
| Phase 6.5 — Shipping Diff Revival | ✅ DONE | 2026-05-12 |
| Phase 7.5 — Pre-launch UX fixes (login + Combobox) | ✅ DONE | 2026-05-13 |

**Phase 7.5 done.** Pre-launch UX hotfix sebelum tim mulai operasi real. 3 issues fixed di [PR #16](https://github.com/barryrocket21-glitch/grandbook-app/pull/16) (squash merge → main `6ceee36`):
1. **Login input contrast** — `<Input>` di `/login` pakai `bg-zinc-800/50` tanpa explicit text color, di dark gradient page text inherit tidak konsisten cross-browser. Fix: `text-white placeholder:text-zinc-500` + `focus-visible:ring-2 focus-visible:ring-violet-500/30` + `<Label>` pakai `text-zinc-200`. Hardcode `text-white` intentional (login page dark-only, tidak ada theme toggle — `text-foreground` bisa resolve ke light di sistem dengan light preference).
2. **Magic Login removed** — feature passwordless via email link bikin tim non-teknis bingung. Hapus dari `/login`: `<Tabs>` Password/Magic Link wrapper, `handleMagicLink()` + `supabase.auth.signInWithOtp()` call, `Sparkles` icon. KEEP `src/app/auth/callback/route.ts` (generic OAuth code exchange, reusable kalau Barry trigger Supabase password reset email di kemudian hari). Tidak touch Supabase Auth settings di dashboard.
3. **Combobox auto-close** — Base UI Popover tidak fire `onOpenChange` untuk *external* `setOpen(false)` call, jadi `skipNextAutoOpenRef` tetap `false` setelah selection → focus return ke trigger → `onFocus` handler trigger re-open. Fix: set `skipNextAutoOpenRef.current = true` *explicit* di `onSelect` SEBELUM `setOpen(false)`. Base-level fix → semua page yang pakai `<Combobox>` (orders/new, settings/*, campaigns, ad-spend, products) otomatis benefit, tidak perlu per-call-site changes.

LOC delta: +54 / −125 (net −71). Production deploy verified via content check (Magic Link text gone from /login HTML). No DB change, no migration.

**Phase 6.5 done.** Revive `/shipping-diff` dari archived banner ke full per-order table. 3 angka ongkir (charge customer / gross / net after cashback) + 2 selisih per order (margin sebelum vs setelah cashback) + summary stat cards (loss/breakeven/profit count + avg margin). Migration 024 + 2 RPCs (`shipping_diff_per_order`, `shipping_diff_summary`) dengan filter date/channel/courier/status. Sidebar `/shipping-diff` reinstated di group Reconciliation (owner+admin). Tidak ada schema change — reuse Phase 4C columns (`shipping_cost`, `shipping_cost_actual`, `estimated_shipping_net`). Brief column refs adjusted: `orders.courier_id` tidak exist (JOIN via `courier_channels.courier_id`), `orders.estimated_shipping_discount` tidak exist (derive `GREATEST(gross − net, 0)`).

**Phase 6 redesign done.** /analytics refactor: tabs (7-buah, termasuk Funnel) → horizontal pill nav sticky di top content (initial iteration was sidebar nav, user feedback duplikat dengan app shell → swap ke horizontal). 6 items flat: Overview / Per Channel / Per Produk / Per CS / Per Advertiser / ROAS Campaign. Funnel tab standalone DIHAPUS — logic pindah ke detail page `/analytics/produk/[id]` dengan stat cards + funnel visual compact + CS performance table + campaigns linked table + insight box. URL sync via `useSearchParams` (Suspense wrapped per Next.js 16). Migration 023 + 2 RPCs baru (`analytics_cs_performance_per_product`, `analytics_campaigns_per_product`). Removed obsolete `FunnelProductCard` + `FunnelInsightCards` + inline `PerProductTable` (~600 LOC purged).

**Phase 6 done.** Sync layer ADV (Phase 5B) dengan CS (daily lead/closing per produk) + auto-track System Orders. Cross-check 3 layer (Meta vs CS vs System) per produk → identify tracking loss, CS input gap, top performer. New `daily_cs_report` table (per CS × per produk × per tanggal) dengan UNIQUE constraint + CHECK closing≤lead_in + RLS (CS edit sendiri, owner/admin override, owner/admin delete only). New `ad_spend.meta_lead_count` column (Meta-reported leads, top of funnel — beda dari conversions=purchases). 4 RPCs baru: `analytics_funnel_per_product` (4-way JOIN ad_spend×campaign_products + daily_cs_report + orders×order_items), `cs_daily_summary`, `cs_period_summary`, `cs_daily_series`. /cs-report refactor (banner→form): per-row inline input lead+closing+notes, real-time validation, "Copy dari Kemarin" merge helper, owner/admin CS picker untuk override. /cs-dashboard extended dengan stat cards lead/closing + daily trend chart + per-produk performance via new `renderExtraSection` slot di PersonalDashboard. /analytics tab ke-7 "Funnel" dengan 14-col table + Highlights section (organic demand, CS lupa input, top closer). "—" untuk no-data cells distinguish dari "0" eksplisit via `has_meta_data` / `has_cs_data` / `has_system_data` flags.

**Phase 5B done.** Campaigns + ad_spend tables extended dengan organization_id + RLS + Phase 5B fields (campaign_code untuk CSV match, status enum, start/end date, daily_budget, conversions, reach, revenue_reported, source, import_batch_id). New `campaign_products` link table (1:N allocation dengan trigger guard sum ≤ 100%). Meta Ads CSV parser dengan flexible column detection (multiple name variants per field) + idempotent bulk upsert. 4 RPCs baru: `analytics_ad_spend_summary`, `analytics_roas_per_campaign`, `analytics_profit_per_product_v2` (extends v1 dengan allocated_ad_spend + ROAS), `analytics_overview_v3` (extends v2 dengan total_ad_spend + net_profit_before/after_ads). /campaigns refactor: 2-level dialog (campaign + linked products with allocation %). /ad-spend refactor: 4 stat cards, by-platform chips, manual entry + 5-step CSV upload Meta format. /analytics: Row 4 expanded ke 5 cards (Op Expenses/Ad Spend/Net Before/Net After/Net Margin), tab ke-6 "ROAS" per campaign, Per Produk tab extended dengan ad spend allocation + Net After Ads sort default.

**Phase 5A done.** Master produk dengan kategori FK + variation/notes, operational_expenses table dengan 9 preset kategori + recurring helper + "Copy from Last Month", analytics extend dengan row 4 stat cards (Op Expenses / Net Profit / Net Margin) + tab "Per Produk" (revenue/HPP/profit/margin/conv breakdown). RPCs baru: `analytics_overview_v2`, `analytics_profit_per_product`, `analytics_expenses_summary`. Archive `/shipping-diff` + `/duplicates` jadi banner archived dengan deeplinks. Multi-tenant: tambah `organization_id` ke products + RLS. Backfill: 2 kategori dari existing products.category text, 0 operational_expenses (legacy expenses table kosong saat dev).

**Phase 4C done.** Engine estimasi biaya & profit per order dengan 4 billing model (MONTHLY_INVOICE/NETT_OFF_PER_ORDER/DIRECT_TRANSFER/NO_RECONCILIATION). Schema fleksibel: numeric rates di key-value table existing + categorical config di table baru `channel_billing_config` (versioning per period). SPX_DIRECT pre-seeded dengan defaults yang verified via real April 2026 invoice (40% cashback, 1% fee COD floor, 12% PPN, NOMINAL_COD base). Estimated cost columns di orders + trigger compute saat status/shipping/channel/total change. UI: BillingConfigPanel di /settings/courier-rates dengan Preview Calculator, tab Cost & Profit di /orders/[id] (owner+admin), row stat cards baru + per-channel profit columns di /analytics.

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

## Phase 4C — Estimated Cost Engine + Multi-Model Billing (COMPLETED)

Money math layer tuntas. Engine compute estimasi biaya & profit per order dengan support 4 billing model. Schema fleksibel via key-value rates + categorical config dengan period versioning. SPX_DIRECT defaults (40/1/12 + NOMINAL_COD/FLOOR/COD_FEE_ONLY) verified via real April 2026 invoice file (502 COD orders, 100% match floor formula).

### Files yang dibuat / berubah

**Migration:**
- `src/lib/supabase/migrations/018_billing_models.sql`:
  1. `courier_channels` tambah `billing_model` (CHECK: MONTHLY_INVOICE/NETT_OFF_PER_ORDER/DIRECT_TRANSFER/NO_RECONCILIATION) + `shipping_discount_label`
  2. New table `channel_billing_config` (channel_id + cod_fee_base + cod_fee_rounding + ppn_applied_to + effective_from/to). UNIQUE (channel_id, effective_from). RLS owner+admin.
  3. `orders` tambah 7 estimated_* columns (shipping_net, cod_fee, ppn, total_cost, cash_in, profit, cost_computed_at)
  4. `get_active_rate(channel, key, date)` — pick rate aktif by date
  5. `get_active_billing_config(channel, date)` — pick config aktif, fallback default kalau no row
  6. `compute_order_costs(order_id)` — engine: shipping_net = gross × (1 − discount_rate); cod_fee_base by config (NOMINAL_COD / BARANG_PLUS_ONGKIR_GROSS / NET); rounding FLOOR/ROUND/CEIL; PPN by config; cash_in dispatched per billing_model; profit = cash_in − HPP − komisi (− cost untuk MONTHLY_INVOICE)
  7. Trigger `trg_compute_order_costs` AFTER INSERT OR UPDATE OF status/shipping_cost_actual/channel_id/total
  8. Updated `analytics_overview` & `analytics_per_channel` (Phase 4B) tambah field profit/margin
  9. Seed SPX_DIRECT: billing_model='MONTHLY_INVOICE', label='Cashback Ongkir', 3 rates (0.40/0.01/0.12), config NOMINAL_COD/FLOOR/COD_FEE_ONLY
  10. Backfill loop compute existing orders (2 orders di production saat dev)

**Helpers:**
- `src/lib/cost/calculator.ts` (NEW) — TypeScript mirror dari SQL `compute_order_costs` untuk Preview Calculator. Identik formula supaya UI preview matches actual computation.
- `src/lib/supabase/queries/billing-config.ts` (NEW): `fetchChannelCostBundle` (channel + 3 rates + config aktif), `listChannelBillingConfigs`, `listChannelRates`, `updateChannelBillingMeta`, `upsertBillingConfig` (auto-close prev period), `recomputeOrderCosts`.
- `src/lib/types.ts` — `BillingModel`, `CodFeeBase`, `CodFeeRounding`, `PpnAppliedTo` types. `CourierChannel` + `Order` interfaces extended dengan field-field baru. New `ChannelBillingConfig` interface.
- `src/lib/schemas/settings.ts` — appended `channelBillingConfigSchema` (Zod) + 4 enum sets dengan label maps (BILLING_MODEL_LABEL/SHORT, COD_FEE_BASE_LABEL, COD_FEE_ROUNDING_LABEL, PPN_APPLIED_LABEL) + `PHASE4C_RATE_KEYS` constant.

**Pages:**
- `src/app/(app)/settings/courier-rates/page.tsx` — extend dengan **BillingConfigPanel** (Card di atas existing rates list). Channel picker (Combobox dengan Phase 3.5 emptyHint), 2-column form (channel meta + categorical config), Numeric Rates summary (read-only, link ke existing table di bawah), Preview Cost Calculator dengan 6 input fields + breakdown box berwarna. Existing CRUD list tetap intact.
- `src/app/(app)/orders/[id]/page.tsx` — tab ke-5 **Cost & Profit** (role-gated `canApprove` = owner+admin). 2-column breakdown (Cost & Cash Flow boxes), Recompute button, warning banner kalau status pre-final / billing_model NO_RECONCILIATION, footer dengan rate config summary.
- `src/app/(app)/analytics/page.tsx` — Overview tab tambah row 3 stat cards (Estimated Total Cost / Cash In / Profit / Margin %). Per Channel tab tambah kolom Est. Cost / Cash In / Profit / Margin %, billing_model di-display sub-row, color-coded margin badge (≥10% emerald, ≥0% amber, <0% red).

**Sidebar:** No changes (cuma extend existing pages).

### Decisions

1. **Categorical config separate table** vs embed di rate_value (hash) — pilih separate `channel_billing_config` table karena clean + period versioning native. Row-level RLS gampang.
2. **Numeric rates di existing `courier_channel_rates`** — sudah perfect for versioning. Tambah 3 keys (`shipping_discount_rate`, `cod_fee_rate`, `ppn_rate`) tanpa schema change.
3. **Estimated columns denormalized di orders** — supaya analytics SUM tanpa JOIN config setiap query. Trade-off: trigger fire saat update, tapi acceptable.
4. **Trigger ordering** — `trg_compute_order_costs` runs after `trg_compute_commissions` alphabetically, jadi commission row sudah inserted saat compute_order_costs baca commissions. Brief 4C concern resolved via natural alphabetical order.
5. **TypeScript calculator mirror** — `src/lib/cost/calculator.ts` mirror SQL compute_order_costs identik. Preview Calculator client-side jalan tanpa round-trip server. Coupling: kalau SQL formula berubah, calculator.ts harus follow.
6. **BillingConfigPanel di atas existing rates list** (bukan refactor jadi tabs) — minimum disruption. User existing flow tetap jalan.
7. **Cost & Profit tab role-gated `canApprove`** — owner+admin only. CS/advertiser nggak butuh lihat profit margin internal.
8. **PPN ROUND ke 2 desimal**, COD fee FLOOR/ROUND/CEIL ke integer (rupiah penuh) — consistent dengan invoice SPX behavior.
9. **`analytics_overview` ambiguous column fix** — output param names conflict dengan table columns saat function body reference column. Fix: alias FROM clause `o` dan qualify column reference.
10. **Profit formula varies per billing_model** — MONTHLY_INVOICE: kurang cost (cash_in masih full, tagihan bulan depan); NETT_OFF/DIRECT/NO_RECONCILIATION: tidak kurang cost (cash_in sudah net atau no cost). Match brief.

### Build status

- `npx tsc --noEmit` ✅ no errors
- `npm run build` ✅ 50 routes intact
- Migration 018 ✅ applied via `exec_sql`, 2 orders backfilled, all 4 RPCs callable, SPX seeded

### Hal yang perlu di-flag untuk Phase 4D (Actual Reconciliation File Upload)

- **Upload file SPX/agregator** untuk match per-order actual cost vs estimated. Phase 4C cuma compute estimasi dari config; variance tracking belum.
- **Mark as Billed / Settled** workflow untuk track tagihan bulanan SPX yang sudah dibayar.
- **Saldo tracking** — withdraw dari SPX dashboard ke rekening, balance running. Brief 4C explicit skip.
- **Auto-detect bulan periode** dari file SPX. Phase 4D nanti.
- **Bulk recompute** kalau rate berubah retroaktif. Phase 4C trigger fire per order; bulk via `SELECT compute_order_costs(id) FROM orders` di SQL Editor (acceptable manual).
- **PPN config rate update** — kalau Indonesia naik PPN > 12%, pakai rate versioning: tambah rate baru `ppn_rate=0.13` dengan effective_from baru. Existing orders pakai rate lama berdasarkan order_date.

---

## Phase 5A — Products Extended + Operational Expenses (COMPLETED)

Master produk dapat upgrade: kategori FK, variation, notes, multi-tenant via `organization_id` + RLS. Operational expenses table baru dengan 9 preset kategori, recurring helper, vendor tracking. Analytics extend dengan Row 4 stat cards (Op Expenses, Net Profit, Net Margin) + tab "Per Produk".

### Files yang dibuat/berubah

**Migration:**
- `src/lib/supabase/migrations/020_products_expenses.sql`:
  1. Add `organization_id` ke products + backfill ke org=1 + index
  2. New table `product_categories` (slug unique per org, RLS, indexes)
  3. Add `category_id` FK + `variation`/`notes`/`created_at`/`updated_at` ke products
  4. Backfill DO-block: products.category (TEXT) → product_categories (slug-ified) + link products.category_id
  5. RLS migration products: drop legacy Phase 0 policies, install `current_org_id()` policies
  6. New table `operational_expenses` (9 kategori CHECK, recurring + recurrence_period, vendor_name, payment_method, payment_reference, attachment_url, RLS)
  7. Backfill DO-block: legacy `expenses` rows → operational_expenses (mapped category via UPPER/LIKE pattern), idempotent (only kalau target kosong)
  8. Triggers `set_updated_at` di 3 tables
  9. RPC `analytics_expenses_summary(from, to)` — per kategori (total/count/recurring/onetime)
  10. RPC `analytics_profit_per_product(from, to)` — per produk (qty/revenue/HPP/profit/margin/conv)
  11. RPC `analytics_overview_v2(from, to)` — extends Phase 4C overview dengan `total_operational_expenses` + `net_profit` + `net_margin_pct`

**Helpers (queries/):**
- `src/lib/supabase/queries/products.ts` (NEW) — listProducts/listCategories + CRUD wrappers + count helpers (orders/category usage)
- `src/lib/supabase/queries/expenses.ts` (NEW) — listExpenses/listRecurringExpenses + CRUD + bulkDelete + copyRecurringFromLastMonth + fetchExpenseSummary
- `src/lib/supabase/queries/analytics.ts` — extend `AnalyticsOverview` interface dengan field Phase 5A; `fetchOverview` switched ke `analytics_overview_v2`; new `fetchPerProduct` + `PerProductRow` interface

**Types/Schemas/Constants:**
- `src/lib/types.ts` — `ProductCategory`, `Product` extended (category_id, variation, notes, organization_id, created_at, updated_at), `OperationalExpense`, `OperationalExpenseCategory`, `RecurrencePeriod`. Legacy `Expense` interface kept.
- `src/lib/schemas/settings.ts` — appended `productCategorySchema`, `productSchema`, `EXPENSE_CATEGORIES` array (9), `EXPENSE_CATEGORY_LABEL`/`EXPENSE_CATEGORY_COLOR`, `EXPENSE_PAYMENT_METHODS`/labels, `RECURRENCE_PERIODS`/labels, `operationalExpenseSchema`, `slugifyCategory()` helper

**Pages:**
- `src/app/(app)/products/page.tsx` — refactor jadi 2 tabs (Produk + Kategori). Produk tab: 4 stat cards + filter (search/status/category) + sortable table + Add/Edit dialog dengan Combobox kategori (emptyHint linking ke tab Kategori). Kategori tab: tabel dengan product count + Add/Edit dialog dengan auto-slug
- `src/app/(app)/expenses/page.tsx` — refactor lengkap. DateRangePicker default Bulan Ini. 4 stat cards (Total/Top Kategori/Recurring vs One-time/Biaya Rutin Bulanan all-time). Per-category chips clickable filter. Filter search + category + recurring. Bulk select (owner only) + bulk delete. Tombol "Copy Bulan Lalu" → `copyRecurringFromLastMonth` (skip duplicate by category+vendor+amount). Dialog dengan 9 kategori + recurring checkbox → reveal period dropdown + payment method + vendor + reference.
- `src/app/(app)/analytics/page.tsx` — tambah Row 4 stat cards (Op Expenses/Net Profit/Net Margin) + tab ke-5 "Per Produk". Tab Per Produk: sortable table dengan badge color-coded margin/conv + Top 10 Produk by Revenue bar chart.
- `src/app/(app)/shipping-diff/page.tsx` — archived banner dengan CTA "Buka Analytics" (link /analytics Per Channel)
- `src/app/(app)/duplicates/page.tsx` — archived banner dengan CTA "Buka Inbox" (link /inbox/pending-review)

**Sidebar (constants.ts):**
- Hilangkan "Selisih Ongkir" + "Duplicate Inbox" dari NAV_ITEMS
- /products + /expenses sekarang accessible owner+admin+akunting (sebelumnya owner+akunting saja — admin perlu manage produk daily)

**Docs:**
- `docs/phase5a-test.md` — manual smoke test, 8 section incl. CRUD products + categories, expenses dengan recurring, analytics row 4 + per-product tab, archived pages, multi-role permissions, migration idempotency

### Decisions

1. **Legacy `expenses` table tetap ada, app sekarang baca/tulis ke `operational_expenses`** — backfill dilakukan one-shot di migration kalau target kosong (idempotent). Tidak DROP legacy table untuk preserve historical data sebelum Phase 5A.
2. **`organization_id` di products** — sebelumnya schema Phase 0 nggak punya field ini. Backfill ke org=1 (default), NOT NULL constraint setelah backfill. RLS pakai pattern Phase 1 (`organization_id = public.current_org_id()`).
3. **`product_categories.slug` unique per org**, bukan global — multi-tenant prep. Slug auto-generated dari nama via `slugifyCategory()` (lowercase + dash + strip non-alphanumeric), bisa di-override manual di dialog.
4. **Legacy `products.category` TEXT preserved** — saat backfill, value text di-translate jadi category row + link via category_id. Field TEXT tidak di-drop (untuk audit + safe rollback). UI display: kalau ada category_id, pakai itu; kalau cuma TEXT, render dengan italic "(legacy)".
5. **`operational_expenses.category` CHECK constraint (9 preset)** — bukan FK ke separate categories table. Cleaner UX (dropdown fixed) + tidak overlap dengan product_categories yang punya scope berbeda (produk, bukan biaya). Kalau user butuh kategori biaya custom, di-route ke `LAIN_LAIN` + description detail.
6. **`copyRecurringFromLastMonth` di client-side** (di queries/expenses.ts), bukan RPC server — flexible untuk customize duplicate-detection key (category+description+vendor+amount) di TS lebih readable. Trade-off: round-trip 2x (read sources + read targets + bulk insert) acceptable untuk volume kecil (<100 recurring/month).
7. **`fetchOverview` switched ke v2** (vs maintain v1 + v2 separately) — backward compat dijaga di interface level (v1 fields tetap ada di v2 + tambah field baru). Lebih simple maintenance. Calling page tidak break.
8. **Tab "Per Produk" di /analytics** (bukan page baru) — konsisten dengan pattern Phase 4B (per CS/Advertiser/Channel). Re-use TopUsersBar untuk Top 10 Produk visualisasi.
9. **HPP snapshot dari Phase 1 unchanged** — `order_items.hpp_snapshot` tetap sumber truth untuk profit calculation per order. `products.hpp` cuma jadi default value saat input order baru (snapshot taken at order creation). Phase 5A tidak ubah engine ini.
10. **Phase 5A SCOPE — TIDAK include**: Ad Spend ke produk allocation (Phase 5B), Meta Ads API integration, product variation as separate SKU, inventory tracking, product image upload, CSV import (nice-to-have skipped untuk fit time-box).

### Hal yang perlu di-flag untuk Phase 5B (Ad Spend + Campaigns)

- **Allocate ad spend ke produk** lewat campaign — Phase 5B akan butuh schema baru: `campaign_products` table (campaign_id → product_id, allocation %). Net profit per produk = gross_profit − allocated_ad_spend.
- **ROAS per campaign** — sudah ada di analytics existing (`/campaigns`) tapi belum integrated dengan profit per produk. Phase 5B integrate.
- **CSV import ad spend bulk** — campaign id + spend per hari (Meta export format). Phase 5B nice-to-have.
- **Existing `expenses` legacy table — eventually deprecate**. Phase 5A backfill dilakukan one-shot. Setelah verifikasi all data migrated, table bisa di-DROP di future migration. Sekarang tetap ada untuk safety.
- **Product image upload** — Supabase Storage bucket + thumbnail generation. Out of scope Phase 5A, useful kalau owner mau katalog visual.
- **Inventory tracking (stok)** — `products.stock` + decrement on order placed. Out of scope Phase 5A.

---

## Phase 5B — Ad Spend + Campaigns + ROAS (COMPLETED)

Ad spend tracking lengkap. Audit (2026-05-11): campaigns 2 rows, ad_spend 5 rows, 0 orders dengan campaign_id → Skenario B (reuse + extend dengan backfill org=1). Legacy `ad_spend.lead_platform` column dari Phase 0 preserved untuk backward compat.

### Files yang dibuat / berubah

**Migration:**
- `src/lib/supabase/migrations/021_ad_spend_campaigns.sql`:
  1. Extend `campaigns` + add `organization_id` (backfill ke 1) + 8 fields baru (`campaign_code`, `start_date`, `end_date`, `status`, `daily_budget`, `objective`, `notes`, timestamps)
  2. CHECK constraint `status IN ('ACTIVE','PAUSED','ENDED')`, unique `(organization_id, platform, campaign_name)`, partial unique `(organization_id, platform, campaign_code) WHERE campaign_code IS NOT NULL`
  3. New table `campaign_products` (link table dengan `allocation_pct` 0-100, UNIQUE (campaign_id, product_id), ON DELETE CASCADE)
  4. Trigger `check_campaign_allocation_total()` — sum allocation_pct per campaign ≤ 100, raise EXCEPTION '22023' kalau exceed
  5. Extend `ad_spend` + `organization_id` + 6 fields baru (`reach`, `conversions`, `revenue_reported`, `source`, `import_batch_id`, `updated_at`). CHECK source IN MANUAL/CSV_IMPORT/API.
  6. Drop legacy unique (date+campaign), add org-scoped unique (organization_id, spend_date, campaign_id)
  7. RLS pattern Phase 1 (`current_org_id()`) untuk campaigns + campaign_products + ad_spend
  8. RPCs: `analytics_ad_spend_summary` (total spend/campaigns/conv/impr/clicks + by_platform JSONB), `analytics_roas_per_campaign` (per campaign: spend, conv, linked products, orders, revenue, ROAS gross + diterima, cost/conv, cost/order), `analytics_profit_per_product_v2` (extends v1 dengan allocated_ad_spend + net_profit_after_ads + ROAS), `analytics_overview_v3` (extends v2 dengan total_ad_spend + net_profit_before_ads + net_profit_after_ads + net_margin_pct)
  9. Triggers `set_updated_at` di campaigns + ad_spend

**Helpers (queries/):**
- `src/lib/supabase/queries/campaigns.ts` (NEW) — listCampaigns dengan embed advertiser+linked_products+product, CRUD wrappers, `getCampaignAllocationTotal()` helper
- `src/lib/supabase/queries/ad-spend.ts` (NEW) — listAdSpend dengan filter platform/source/campaign, CRUD, `bulkInsertAdSpend()` pakai upsert ignoreDuplicates untuk idempotency
- `src/lib/csv/meta-ads-parser.ts` (NEW) — `parseMetaAdsCsv()` dengan COLUMN_VARIANTS dict (flexible matching across Meta region/account locale: "Amount spent (IDR)" / "Amount spent" / "Spend" / "Cost" / etc), `parseDateFlexible()` (ISO + DD/MM/YYYY Indonesia + Date fallback), `parseNumber()` (handle European decimal separator), `matchToCampaigns()` (priority campaign_code → campaign_name case-insensitive)
- `src/lib/supabase/queries/analytics.ts` — extend `AnalyticsOverview` interface (total_ad_spend, net_profit_before_ads, net_profit_after_ads), `fetchOverview` switched ke v3, new `fetchRoasPerCampaign` + `RoasPerCampaignRow`, `fetchPerProduct` switched ke v2 + extended `PerProductRow` (allocated_ad_spend, net_profit_after_ads, roas)

**Types/Schemas/Constants:**
- `src/lib/types.ts` — `CampaignStatus`, `AdSpendSource` types; `Campaign` interface extended (campaign_code, status, start_date, end_date, daily_budget, objective, notes, timestamps, linked_products); `CampaignProduct` interface NEW; `AdSpend` interface extended (reach, conversions, revenue_reported, source, import_batch_id). Legacy `lead_platform` preserved
- `src/lib/schemas/settings.ts` — appended CAMPAIGN_PLATFORMS/labels/colors, CAMPAIGN_STATUSES/labels/colors, CAMPAIGN_OBJECTIVES/labels, campaignSchema (Zod), campaignProductSchema, AD_SPEND_SOURCES/labels, adSpendSchema

**Pages:**
- `src/app/(app)/campaigns/page.tsx` — refactor lengkap. Search + platform + status filter. Table dengan linked products count + total allocation. Edit dialog dengan 9 fields. Manage Linked Products button → dialog dengan tabel allocation per produk + add/edit dialog (Combobox produk exclude yang sudah linked, validation client total ≤ 100% + DB trigger guard).
- `src/app/(app)/ad-spend/page.tsx` — refactor lengkap. DateRangePicker default Bulan Ini. 4 stat cards (Total Spend/Conversions/Impressions/Clicks + CTR). By-platform breakdown chips. Filter platform/source. Manual entry dialog dengan 9 fields. **5-step CSV upload dialog**: Platform pick → File upload → Preview (detected columns, currency, errors, unmatched campaigns, match status per row) → Import (loader) → Done (4 result cards inserted/skipped/errors).
- `src/app/(app)/analytics/page.tsx` — Overview Row 4 → 5 stat cards (Op Expenses / Ad Spend / Net Before / Net After / Net Margin). Tab ke-6 **ROAS** per campaign (sortable spend/roas/revenue/orders, badge color-coded ≥2x emerald). Per Produk tab extended dengan Ad Spend + Net After Ads + ROAS columns (sort default ke Net After Ads DESC = paling profitable di atas).

**Sidebar:**
- ADV group sekarang accessible owner + admin + advertiser (sebelumnya owner + advertiser saja)

**Docs:**
- `docs/phase5b-test.md` — 9 section smoke test (CRUD campaigns, allocation guard test, ad spend manual, CSV upload format Meta, ROAS analytics tab, Per Produk extension, idempotency re-run migration, end-to-end data linkage)

### Decisions

1. **Skenario B (extend in-place)** — pre-audit memang assume A/B, audit reveal compatible. Backfill organization_id=1 untuk 2 campaigns + 5 ad_spend rows. Legacy `lead_platform` column (Phase 0 BIGINT) preserved tidak di-drop — backward compat untuk historical reads.
2. **CSV parser flexible column matching** — bukan strict required columns. Meta sering rename "Amount spent" vs "Amount spent (IDR)" vs "Spend". COLUMN_VARIANTS dict mapping multi-name → field semantic + fuzzy `contains` fallback. Trade-off: kalau Meta export format ekstrim aneh, parser bisa miss column → user pakai manual entry.
3. **Idempotent bulk insert** — pakai Supabase `upsert` dengan `onConflict: 'organization_id,spend_date,campaign_id', ignoreDuplicates: true`. Re-upload sama file → 0 inserted, X skipped. No need pre-check duplicate.
4. **Match priority CSV → DB** — campaign_code (Meta Campaign ID) dulu, fallback campaign_name case-insensitive. User opt-in lewat /campaigns input campaign_code untuk match yang reliable.
5. **Allocation guard trigger** — `check_campaign_allocation_total()` di DB level (BEFORE INSERT/UPDATE). Client juga validate untuk UX tapi server jadi source of truth. Trade-off: kalau dua user concurrent insert, satunya bakal fail dengan error '22023' — accepted (rare scenario).
6. **No campaign auto-create dari CSV** — per brief (opt-in di future). Unmatched campaign names ditampilkan ke user di Step 3 dengan instruksi tambah di /campaigns + retry.
7. **`analytics_overview_v3` (incremental)** vs replace v2 — pilih incremental version supaya tools/pages lain yang masih reference v2 nggak break. `fetchOverview` helper switched ke v3, tapi v2 + v1 tetap callable via supabase.rpc langsung.
8. **`PerProductRow` extended di v2 (sort default by net_profit_after_ads DESC)** — paling profitable produk di atas. UX: kalau user buka tab Per Produk, langsung lihat winner.
9. **Ad spend allocation = snapshot via campaign_products** — kalau user ubah allocation_pct nanti, retroactive change applies (compute via aggregate SUM(spend × allocation_pct/100)). Per brief: "no retroactive allocation snapshot". Trade-off: simpler model, akurat untuk current state, tapi audit historis sulit kalau allocation berubah-ubah.
10. **`status` enum vs free-text** — pilih CHECK constraint 3 nilai (ACTIVE/PAUSED/ENDED). Simple workflow. Kalau Meta exposes "ARCHIVED" / "DRAFT", futurework extend constraint.
11. **CSV currency warning, not enforced** — kalau detect non-IDR (e.g. "Amount spent (USD)"), tampilkan warning tapi tetap accept. User responsibility untuk pre-convert. Mengikuti pattern parser kategori Phase 2B (warn + continue).
12. **Combobox campaign + product di /ad-spend manual dialog** — dengan emptyHint linking ke /campaigns / /products. Konsisten Phase 3.5 polish pattern.

### Build status

- `npx tsc --noEmit` ✅ no errors (3 type compat fix di middle — type intersection `Omit<T, K> &` instead of `extends`)
- `npm run build` ✅ 50 routes intact

### Hal yang perlu di-flag untuk phase berikutnya

- **Auto-create campaign dari CSV unmatched** — opt-in user (checkbox di Step 3 preview). Out of scope Phase 5B.
- **Meta Marketing API integration** — langsung fetch ad spend harian via API instead of manual CSV. Out of scope (brief explicit skip).
- **TikTok CSV format** — current parser optimized for Meta. TikTok column names mungkin beda — perlu COLUMN_VARIANTS extension atau separate parser. Out of scope Phase 5B, brief support "best-effort".
- **Currency conversion** — kalau Meta export USD, perlu rate harian. Out of scope, user manual convert.
- **Allocation retroactive snapshot** — kalau user ubah allocation_pct, historical analytics ikut berubah. Audit-safe akan butuh snapshot per spend_date (out of scope brief).
- **ROAS alert / notifikasi** — campaign dengan ROAS<1x → notification. Out of scope (brief explicit skip).
- **A/B testing tracking** — campaign variants comparison. Out of scope.

---

## Phase 6 — CS Daily Report + ADV-CS Cross-Check Funnel (COMPLETED)

Cross-check 3 layer data per produk per periode: META (ad_spend × campaign_products allocation, lead Meta klaim + purchases), CS (daily_cs_report manual input), SYSTEM (orders × order_items). Funnel metrics surface tracking loss, input gap, top performer.

### Audit (2026-05-11)
- `daily_cs_report` → doesn't exist (CREATE fresh)
- `ad_spend.meta_lead_count` → doesn't exist (ADD COLUMN)
- legacy `cs_daily_leads` (Phase 0) → EXISTS → preserve, tidak touch

### Files yang dibuat / berubah

**Migration:**
- `src/lib/supabase/migrations/022_cs_daily_report.sql`:
  1. ADD COLUMN `ad_spend.meta_lead_count BIGINT` (NULL untuk pre-existing rows)
  2. New `daily_cs_report` table dengan UNIQUE (org, date, cs, product) + CHECK `closing <= lead_in` (business rule)
  3. RLS: 4 policies — SELECT semua authenticated dalam org (transparency), INSERT/UPDATE CS untuk diri sendiri ATAU owner/admin override, DELETE owner/admin only (audit trail)
  4. Trigger updated_at
  5. RPC `cs_daily_summary` (per CS sehari — untuk footer)
  6. RPC `cs_period_summary` (per CS range — untuk /cs-dashboard stat cards)
  7. RPC `cs_daily_series` (per CS time series — untuk chart)
  8. RPC `analytics_funnel_per_product` — 4-way JOIN (campaign_products × ad_spend, daily_cs_report, orders × order_items, products) dengan 3 presence flags (`has_meta_data`, `has_cs_data`, `has_system_data`) untuk UI distinguish "no data" vs "0 explicit"
- Fix mid-migration: ambiguous `product_id` reference di CTE `all_products` saat RETURNS TABLE punya output column nama sama → alias jadi `pid` di CTE, qualify `ap.pid AS product_id` di outer SELECT

**Helpers (queries/):**
- `src/lib/supabase/queries/cs-report.ts` (NEW) — listReportForDay/Range + upsertReportBatch (pakai `onConflict: 'organization_id,report_date,cs_id,product_id'`) + deleteReportRow + 3 RPC wrappers + `yesterdayOf()` date helper
- `src/lib/supabase/queries/analytics.ts` — extend `FunnelPerProductRow` interface + `fetchFunnelPerProduct` wrapper

**Types/Schemas:**
- `src/lib/types.ts` — `DailyCsReport` interface; `AdSpend.meta_lead_count` extended
- `src/lib/schemas/settings.ts` — appended `dailyCsReportSchema` (Zod, dengan `refine(closing<=lead_in)`)

**Components:**
- `src/components/analytics/personal-dashboard.tsx` — extended dengan `renderExtraSection?: ({userId, from, to}) => ReactNode` slot. Render sebelum stat cards orders (kalau prop given). Non-breaking — /adv-dashboard tetap tidak terpengaruh.
- `src/components/analytics/cs-lead-section.tsx` (NEW) — 4 stat cards (Lead/Closing/Rate/Avg/Day), daily trend area chart (lead+closing overlay), per-produk mini table (top 10), footer link ke /analytics tab Funnel

**Pages:**
- `src/app/(app)/cs-report/page.tsx` — refactor lengkap dari banner. Date picker + CS picker (owner/admin dropdown, CS self read-only). 3 stat cards real-time totals. Per-row inline input dengan validation `closing <= lead_in` (red error inline + Save All disabled kalau hasErrors). "Copy dari Kemarin" merge helper (skip produk yang sudah ada hari ini). Combobox tambah produk (exclude yang sudah di-add). Save All upsert pattern. Delete row owner/admin only. Tips card di bawah.
- `src/app/(app)/cs-dashboard/page.tsx` — wire `renderExtraSection` dari `CsLeadSection`. Existing PersonalDashboard logic (orders/komisi) preserved.
- `src/app/(app)/analytics/page.tsx` — tab ke-7 "Funnel". Highlights cards (3 conditional: high organic, CS lupa input, top closer min-10-lead). 14-column sortable table dengan presence indicators (●Meta/●CS/●Sys) + variance color-coding (blue=organic, amber=lupa input, red=loss) + "—" untuk no-data cells.

### Decisions

1. **Fresh table `daily_cs_report`** (bukan extend legacy `cs_daily_leads`) — Phase 0 legacy schema beda struktur (granular per `lead_event` row vs daily aggregate per produk). Fresh table cleaner + Phase 6 brief eksplisit minta UNIQUE (org, date, cs, product). Legacy table preserved untuk audit/rollback.
2. **RLS policy DELETE owner/admin only** — preserve audit trail. CS bisa edit nilai (upsert update existing row) tapi tidak hapus row historis. Owner/admin bisa kalau perlu cleanup.
3. **SELECT policy permissive (semua user dalam org)** — transparency. Owner cross-check, CS lain bisa lihat performance peer untuk learning. Brief tidak spesifik tapi pattern Phase 4B `/analytics` udah owner-only via UI gate, jadi non-owner role gak punya akses ke tab Funnel anyway.
4. **Funnel RPC presence flags** — `has_meta_data` / `has_cs_data` / `has_system_data` boolean. UI render "—" kalau false vs "0" kalau explicit zero. Penting untuk distinguish "tidak ada laporan CS" vs "ada laporan tapi closing=0".
5. **`renderExtraSection` slot di PersonalDashboard** vs duplicate /cs-dashboard implementation — render-prop pattern minimal change (non-breaking untuk /adv-dashboard). Slot render BEFORE stat cards orders supaya CS metrics di top (priority info).
6. **"Copy dari Kemarin" merge, bukan overwrite** — append produk dari kemarin yang BELUM ada di hari ini. Kalau hari ini sudah ada produk X dengan angka, tidak di-replace. Skip duplikat. UX-safer.
7. **Upsert pattern per Save All** — bukan auto-save per row (kompleksitas + chatty network). Single batch upsert dengan `onConflict` di unique constraint. Edit existing row aman.
8. **CS Combobox exclude already-added** — UX prevent double-add. User tetap bisa pilih produk yang sudah di-table untuk update (cuma edit nilai inline).
9. **General notes fallback** — kalau row-level notes kosong, pakai general notes (1 untuk semua row). Acceptable trade-off untuk simplicity. Future bisa per-row notes wajib.
10. **Validation `closing <= lead_in` 3 layer**: client (inline error), Zod schema (`refine`), DB CHECK constraint. Triple guard.
11. **TIDAK auto-create campaign objective detection dari CSV** — per brief explicit skip. Manual edit meta_lead_count via form di future (Phase 7).
12. **TIDAK auto-create orders dari CS closing** — per brief explicit. CS closing = hint untuk follow-up, bukan source of truth. Orders tetap via /orders/new atau bulk upload.

### Build status

- `npx tsc --noEmit` ✅ no errors
- `npm run build` ✅ 50 routes intact, /cs-report refactor dari banner

### Hal yang perlu di-flag untuk Phase 7+

- **CSV auto-detection campaign objective** (Lead Gen vs Sales) untuk auto-route "Hasil" column ke `meta_lead_count` vs `conversions`. Per brief Phase 6 explicit skip.
- **Per-CS funnel breakdown** — current funnel aggregate semua CS per produk. Owner mungkin perlu filter "per CS A vs per CS B" untuk identify which CS handle which product best.
- **Notification CS belum input laporan** — owner-side reminder (push notif atau email at EOD). Out of scope.
- **CS lead per campaign** — current model aggregate per produk only. Kalau CS perlu track lead per campaign source (e.g. "ini dari iklan A vs B"), butuh extension column `daily_cs_report.campaign_id` (nullable).
- **WA Business API integration** — auto-fill lead masuk dari WA chat count. Out of scope brief.
- **Approve/reject CS report workflow** — admin sign-off. Out of scope brief.
- **Time-series cohort analysis** — produk lifecycle dari first-lead hari X ke first-closing hari Y. Out of scope.

---

## Phase 6 redesign — Analytics Horizontal Nav + Detail Per Produk (COMPLETED)

User feedback Phase 6 iterasi berturut-turut:
1. Initial Phase 6 (PR #11 merged): tabs + 14-col Funnel table → user iterate
2. PR #11 UI polish (merged): Funnel card-based per produk → user iterate lagi
3. PR #12 sidebar nav (Notion/Linear style) + detail page per produk → user feedback: sidebar duplikat dengan app shell sidebar (2 sidebar berdampingan tampak crowded)
4. **PR #12 horizontal nav (final)**: swap vertical sidebar → horizontal pill nav sticky di top content area

### Files yang dibuat / berubah

**Migration:**
- `src/lib/supabase/migrations/023_per_cs_per_product_rpc.sql`:
  1. RPC `analytics_cs_performance_per_product(p_product_id, p_from, p_to)` — aggregate `daily_cs_report` per CS untuk 1 produk, JOIN profiles untuk nama
  2. RPC `analytics_campaigns_per_product(p_product_id, p_from, p_to)` — campaign linked via `campaign_products`, agregat spend/conv/clicks/impressions/meta_lead/ROAS dengan proporsi allocation_pct

**Helpers (queries/):**
- `src/lib/supabase/queries/analytics.ts` — extend dengan `CsPerformanceRow`, `CampaignsForProductRow` interfaces + `fetchCsPerformancePerProduct` + `fetchCampaignsForProduct` wrappers

**Components (NEW):**
- `src/components/analytics/analytics-nav.tsx` (~85 LOC, replaces earlier `analytics-sidebar.tsx`) — horizontal pill nav 6 flat items (Overview / Per Channel / Per Produk / Per CS / Per Advertiser / ROAS Campaign). Sticky `top-0 z-10` dengan backdrop-blur. `overflow-x-auto` untuk responsive scroll di tablet/mobile. Exports `ANALYTICS_SECTIONS`, `isAnalyticsSection`, `getSectionLabel`.
- `src/components/analytics/per-produk-section.tsx` (~110 LOC) — tabel sortable Produk/Revenue/CS Lead/Closing/Close%/ROAS dengan tombol "Detail →" per row navigate ke `/analytics/produk/[id]`. Sumber data dari funnel RPC (sudah include revenue+CS+ROAS).
- `src/app/(app)/analytics/produk/[id]/page.tsx` (~430 LOC) — detail page per produk dengan 5 sections: stat cards 4-col / funnel compact (4 boxes + arrows) / CS performance table / campaigns linked table / insight box auto-generated

**Files refactor:**
- `src/app/(app)/analytics/page.tsx` — replace `<Tabs>` (7 tabs) → sidebar nav (1st iteration) → horizontal pill nav sticky top (final). `<AnalyticsNav>` di atas content + conditional section render. URL state via `useSearchParams` (Suspense wrapped per Next.js 16 requirement). Funnel tab DIHAPUS — logic pindah ke detail page. Per Produk tab pakai PerProdukSection (table dengan Detail button).

**Files removed:**
- `src/components/analytics/funnel-product-card.tsx` (367 LOC) — obsolete, replaced by detail page
- `src/components/analytics/funnel-insight-cards.tsx` (122 LOC) — obsolete, top-3 insight redesigned di detail page (per produk)
- Function `PerProductTable` di analytics/page.tsx (~111 LOC inline) — replaced by PerProdukSection

### Decisions

1. **Sidebar nav vs tabs** — user prefer Notion/Linear style: hierarchical groups (Bisnis/Produk/Tim/Marketing) lebih scalable saat section bertambah. Tabs 7-buah jadi cramped + user mental model lebih fit ke "navigate ke section" daripada "switch tab".
2. **URL sync via useSearchParams** — refresh + back/forward + shareable URL works. Next.js 16 require Suspense wrap untuk CSR bailout — page split jadi outer + inner component.
3. **Per Produk pakai funnel RPC, bukan analytics_profit_per_product_v2** — funnel RPC sudah include `cs_lead_count`, `cs_closing_count`, `system_revenue`, `roas_system`. Tidak perlu 2 RPC. Brief saran option: "atau call analytics_funnel_per_product yang sudah ada" — pilihan itu.
4. **Funnel visual di detail page, BUKAN di main list** — main list ringkas (1 row per produk dengan tombol Detail). Funnel visual + CS table + Campaign table semua di detail page → 1 produk deep-dive view.
5. **Migration 023 idempotent + 2 RPCs** — 1 untuk CS performance per produk, 1 untuk campaign per produk. Separate RPCs vs 1 combined: scoped concern lebih jelas + caller pilih fetch yang perlu.
6. **PostgREST schema cache** — pertama kali call RPC baru return 404 (`PGRST202`). Workaround: `NOTIFY pgrst, 'reload schema'` via exec_sql + retry. Cache settle dalam 1-2 detik.
7. **Suspense wrap mandatory di Next.js 16** — `useSearchParams()` bail out ke CSR, build fail kalau tidak di-Suspense. Pattern: outer page = `<Suspense fallback={<Loader/>}><InnerComponent /></Suspense>`.
8. **Sidebar mobile = pill bar horizontal scroll** vs hamburger menu — pill bar lebih simple, no extra state. Trade-off: 6 items × pill width = scrolling required di mobile, acceptable.

### Build status

- `npx tsc --noEmit` ✅ no errors
- `npm run build` ✅ 51 routes (50 + new `/analytics/produk/[id]` dynamic route)

### Migration 023 verified

- Production verified: 2 RPCs callable (200 OK), service-role returns empty arrays (expected — `current_org_id()` NULL without auth).

### Hal yang perlu di-flag untuk phase berikutnya

- **Section data fetching belum lazy** — current load Promise.all semua (overview+daily+cs+adv+chan+roas+funnel) bahkan kalau section aktif hanya 1. Future: lazy fetch per section saat aktif.
- **Detail page CS performance + campaigns RPC dipanggil bersamaan dengan funnel** — sudah Promise.all parallel, OK untuk current scale. Future bisa cache per produk.
- **Sidebar tidak hierarki nested** — kalau section bertambah banyak dalam 1 group, butuh collapse-expand pattern.
- **Mobile pill bar UX** — pill 6+ items horizontal scroll. Future: kalau jadi 10+, dropdown / hamburger lebih fit.
- **`/analytics/produk/[id]` tidak ada SSR-friendly fallback** — fully CSR. Future: produk metadata bisa pre-render dari `params`.

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
| **018** | **Phase 4C — billing models + cost engine + analytics extension** | **✅ Active** |
| **019** | **Phase 4C bug fix — rate format → percent friendly (codebase convention)** | **✅ Active** |
| **020** | **Phase 5A — Products extended + product_categories + operational_expenses + analytics_overview_v2 + analytics_profit_per_product** | **✅ Active** |
| **021** | **Phase 5B — Campaigns extended + campaign_products + ad_spend extended + analytics_overview_v3 + analytics_roas_per_campaign + analytics_profit_per_product_v2 + analytics_ad_spend_summary** | **✅ Active** |
| **022** | **Phase 6 — daily_cs_report + ad_spend.meta_lead_count + analytics_funnel_per_product + cs_daily_summary + cs_period_summary + cs_daily_series** | **✅ Active** |
| **023** | **Phase 6 redesign — analytics_cs_performance_per_product + analytics_campaigns_per_product (untuk detail page per produk)** | **✅ Active** |
| **024** | **Phase 6.5 — shipping_diff_per_order + shipping_diff_summary (revival /shipping-diff)** | **✅ Active** |
| 025+ | TBD next phases | — |

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
