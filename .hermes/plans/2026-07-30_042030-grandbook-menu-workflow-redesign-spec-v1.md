# GrandBook Menu & Workflow Redesign Spec v1

> **For Hermes:** This is a planning/spec document only. Do not implement until Barry approves the menu/workflow direction and a sprint scope.

**Goal:** Simplify GrandBook from many scattered technical menus into owner/admin/advertiser-friendly workflows without rebuilding existing foundations.

**Architecture:** Keep current routes and features routable, but progressively regroup, rename, and surface them under fewer business workflows. Start with navigation/terminology and page entry points, then improve the underlying screens sprint-by-sprint.

**Tech Stack:** Next.js 16 / React 19 / Supabase / Vercel. Current sidebar source: `src/lib/constants.ts`. Current app routes under `src/app/(app)`.

---

## 1. Problem Summary

GrandBook already has many foundations, but it feels bertele-tele because the UI is organized around technical modules:

```text
Order
Pelanggan
Keuangan
Komisi
Marketing
Advertiser
CS
Pengaturan
```

For Barry, the app should be organized around daily work:

```text
input order
fix problem data/order
ship & reconcile
COD cair
pay team
decide ads scale/kill
crosscheck finance
```

Core rule:

```text
Rename/regroup first. Rebuild only where gaps are real.
```

---

## 2. Current Top-Level Navigation

Source: `src/lib/constants.ts`.

Current sidebar groups:

```text
Dashboard
Order
Pelanggan
Keuangan
Komisi
Marketing
Advertiser
CS
Pengaturan
```

Current route inventory highlights:

```text
/orders/pembukuan
/orders/new
/orders/wa-paste
/orders/bulk-upload
/orders/draft
/orders/export-resi
/orders/post-export
/import-mengantar
/reconciliation/spx-status
/inbox/*
/crm
/financial-position
/laba-rugi
/reconciliation/*
/export-rekonsiliasi
/shipping-diff
/expenses
/commissions/*
/settings/commission-rules
/performa
/analytics
/marketing/*
/ad-spend
/adv/margin-simulator
/cs-ringkasan
/cs-report
/settings/*
/products
/inventory
```

---

## 3. Proposed New Top-Level Navigation

Target menu:

```text
1. Dashboard Owner
2. Input Order
3. Order Problem / Rescue
4. Pengiriman & Rekonsiliasi
5. COD Cair
6. Gajian CS
7. Advertiser Cockpit
8. Pembukuan & Finance Check
9. Master Data
```

Optional role-specific labels:

```text
Owner sees: Dashboard Owner, COD Cair, Pembukuan & Finance Check
Admin sees: Input Order, Order Problem, Pengiriman
Advertiser sees: Advertiser Cockpit
CS sees: CS Workspace / Komisi Saya / assigned problem orders
```

---

## 4. Proposed Sidebar Structure v1

### 4.1 Dashboard Owner

**Purpose:** Barry's daily control room.

**Primary route:** `/dashboard`

**Secondary routes to link/card into dashboard:**

```text
/financial-position
/laba-rugi
/performa
/orders/pembukuan
/reconciliation/spx-cashflow
/commissions/manage
/inbox/pending-review
```

**Should answer:**

```text
Order hari ini
Profit estimasi
Profit real / COD cair
COD belum cair
Campaign/product boncos
CS performance
Problem orders
Komisi/gaji liability
```

**Current gap:** dashboard likely does not yet combine all owner-critical indicators into one cockpit.

---

### 4.2 Input Order

**Purpose:** Make Indra/admin input orders quickly and safely.

**Primary route candidate:** `/orders/new`

**Routes to group under this workflow:**

```text
/orders/new              → Input Order hub
/orders/wa-paste         → WA Paste mode
/orders/bulk-upload      → Upload CSV/XLSX mode
/orders/list             → optional old list/archive, likely hide
/orders/pembukuan        → do NOT use as input, move to Finance Check
```

**Business workflow:**

```text
Paste WA report
→ parse order
→ validate attribution/product/CS/wilayah/phone/ongkir/COD
→ show red/yellow issues
→ save as draft/ready to ship
```

**New UI language:**

```text
Input Order
Tempel Laporan WA
Upload Order
Cek Error Input
Siap Diproses
```

**What admin should see:**

- jumlah order parsed
- duplicate warning
- attribution missing
- product unmapped
- wilayah/coverage issue
- phone/address issue
- suspicious price/ongkir/COD
- one-click route to fix issue

---

### 4.3 Order Problem / Rescue

**Purpose:** Dedicated workflow for orders still salvageable: in-transit problems, buyer unreachable, address/courier issues.

**Primary route candidate:** `/crm` or new `/rescue` later.

**Routes to group:**

```text
/crm
/crm/[order_id]
/inbox/pending-review
/inbox/address-review
/inbox/phone-review
/inbox/unmatched-resi
/inbox/unmapped-statuses
/inbox/atribusi-required
```

**Existing foundations:**

```text
orders_draft.problem_type
orders_draft.crm_status
orders_draft.sla_due_at
orders_draft.problem_opened_at
orders_draft.assigned_to
list_crm_cases
resolve_crm_case
Inbox tabs
```

**New UI language:**

```text
Order Problem / Rescue
Order Bisa Diselamatkan
Assign Handler
Follow Up Pembeli
Follow Up Ekspedisi
Selesai: Delivered / Retur / Cancel
```

**Role:** possible future role `rescue` / `cs_ekspedisi`, or reuse `admin/cs` with `assigned_to`.

**Metrics:**

```text
Open problem
SLA overdue
Saved to delivered
Saved revenue/profit
Problem by type
Handler performance
```

**Important distinction:** `PROBLEM` is not final loss. It is a queue to save delivery before return/cancel.

---

### 4.4 Pengiriman & Rekonsiliasi

**Purpose:** Ship orders and reconcile delivery status from SPX/Mengantar/JNE/etc.

**Primary route candidate:** `/orders/draft` as shipping queue, plus `/reconciliation/ekspedisi` as reconciliation hub.

**Routes to group:**

```text
/orders/draft              → Kirim Order / shipping queue
/orders/export-resi        → likely tab/action inside Kirim Order
/orders/post-export        → likely tab/action inside Kirim Order
/import-mengantar          → Sync Status Mengantar
/reconciliation/ekspedisi  → Rekonsiliasi Ekspedisi hub
/reconciliation/upload     → Upload recon file
/reconciliation/spx-status → Sync Status SPX
/export-rekonsiliasi       → Export for courier/recon
/settings/status-mapping   → move to Master Data / technical settings
```

**Business workflow:**

```text
Siap kirim
→ export ke ekspedisi
→ dapat resi/tracking
→ upload/sync status ekspedisi
→ preview matched/unmatched/ambiguous
→ apply status
→ problem/unmatched masuk Rescue/Inbox
```

**New UI language:**

```text
Pengiriman
Antrian Kirim
Export Ekspedisi
Sync Status
Preview Match
Apply Status
Masalah Pengiriman
```

**Coverage handling:**

- SPX Direct primary
- if not covered, fallback JNE via Mengantar or other courier
- if no courier covers, flag `Tidak Tercover` before shipping

---

### 4.5 COD Cair

**Purpose:** Show whether delivered COD has become real money.

**Primary route:** `/reconciliation/spx-cashflow`

**Routes to group:**

```text
/reconciliation/spx-cashflow
/reconciliation/spx
/financial-position
/shipping-diff
/inbox/unmatched-resi
```

**Business workflow:**

```text
Delivered COD
→ upload SPX Account Transaction List / payout file
→ preview match by resi/tracking/ref
→ apply cod_settled_at + payout_amount
→ record withdrawal/bank movement
→ unresolved goes to inbox
```

**New UI language:**

```text
COD Cair
Upload Pencairan SPX
Order Belum Cair
Uang Masuk Rekening
Selisih Ongkir/COD
```

**Owner critical cards:**

```text
COD cair bulan ini
COD belum cair
Aging COD > 15 hari
Unmatched payout rows
Selisih ongkir / fee COD
```

**Important:** do not mark profit as fixed until COD settled/payout reconciled.

---

### 4.6 Gajian CS

**Purpose:** Pay base salary + variable commission accurately with carry-over.

**Primary route candidate:** `/commissions/manage` renamed/framed as Gajian CS.

**Routes to group:**

```text
/commissions/manage          → Gajian CS / Bayar Komisi
/settings/commission-rules   → Aturan Fee Tim
/commissions/my              → Komisi Saya
/expenses                    → gaji pokok as OPEX, later link to payroll batch
```

**Existing foundation:**

```text
commission_rules:
- role cs/advertiser
- user-specific
- product-specific
- FLAT_PER_ORDER / PERCENT_REVENUE / NONE
- effective_from / effective_to

commissions:
- PENDING / EARNED / PAID / VOIDED
```

**Missing layer:** payroll cycle.

**Business workflow target:**

```text
Pilih payroll date, e.g. tanggal 23
→ pilih CS
→ show base salary
→ show earned current-period delivered orders
→ show carry-over delivered orders from previous period
→ show voided/return/hangus
→ total payable
→ mark paid
→ optionally create expense/payment record
```

**New UI language:**

```text
Gajian CS
Aturan Fee Tim
Slip Gaji / Batch Gajian
Carry-over Order Bulan Lalu
Komisi Hangus
Sudah Dibayar
```

**Example to support:**

```text
Lisa 23 Juni:
base salary + fee from 1000 delivered out of ~1500 orders.
In-transit orders not paid yet.

Lisa 23 Juli:
base salary + 900 July delivered + 32 carried-over June orders delivered later.
Returned orders voided/hangus.
```

---

### 4.7 Advertiser Cockpit

**Purpose:** Help advertiser and owner decide scale/kill campaigns/products/platforms.

**Primary route candidate:** `/performa` or new `/advertiser-cockpit` later.

**Routes to group:**

```text
/performa
/analytics
/marketing/ad-setup
/marketing/distribusi
/marketing/performa
/ad-spend
/adv/margin-simulator
/adv-dashboard
/campaigns
/team/advertisers
/team/advertisers/[userId]
```

**Business workflow:**

```text
Input/verify ad spend
→ link spend to campaign/product/platform/advertiser
→ compare lead/order/ship/delivered/settled
→ detect product/campaign/platform/CS fit
→ decide scale/watch/kill
```

**Decision cards:**

```text
Scale
Watch
Kill
Data belum cukup
COD belum settled, hati-hati
CS overload detected
Lead quality weak
Product margin weak
Return rate too high
```

**Metrics:**

```text
Spend
Lead dashboard
Lead real / order created
Closing
Shipped
Delivered
Return
COD settled
Estimated profit
Realized profit
Cost per lead
Cost per closing
Cost per shipped
Cost per delivered
Cost per settled COD
```

**Important:** If lead closes next day/month, report must explain by which date basis it is being measured.

---

### 4.8 Pembukuan & Finance Check

**Purpose:** Ledger + finance crosscheck + export backup.

**Primary route:** `/orders/pembukuan`

**Routes to group:**

```text
/orders/pembukuan
/laba-rugi
/reports/financial
/reports/export
/reports/ads
/financial-position
/expenses
/shipping-diff
```

**Business workflow:**

```text
Review ledger
→ compare estimated vs realized
→ inspect mismatches
→ export finance audit pack
→ use spreadsheet to crosscheck GrandBook formulas
```

**New UI language:**

```text
Pembukuan
Finance Check
Audit Excel
Laba Rugi
Jurnal/Neraca later
```

**Excel audit pack later:**

```text
Orders Ledger
Ad Spend
Courier Cost
COD Payout
Commission Payroll
Product Profit
Campaign Profit
P&L Summary
Reconciliation Checks
Journal Draft later
```

**Important:** This is the double-crosscheck layer because Barry does not have a finance/accounting team.

---

### 4.9 Master Data

**Purpose:** Config/control center, not daily workflow.

**Routes to group:**

```text
/products
/inventory
/settings/suppliers
/settings/couriers
/settings/courier-channels
/settings/courier-rates
/settings/master-kurir
/settings/status-mapping
/settings/converter-profiles
/settings/converter-profiles/[id]
/settings/wilayah
/settings/users
/settings/audit-log
/settings/reset-data
/team/cs
/team/cs/[userId]
/team/advertisers
/team/advertisers/[userId]
```

**New UI language:**

```text
Produk
Stok
Supplier
Kontrak Ekspedisi
Mapping Status Ekspedisi
Template Import/Export
Wilayah & Coverage
Tim & Role
Audit Log
```

**Potential subgroups:**

```text
Produk & Stok
Ekspedisi & Wilayah
Tim & Akses
Import/Converter
System
```

---

## 5. Route Mapping Table

| Current route | Current label | Proposed workflow | Proposed label | Action |
|---|---|---|---|---|
| `/dashboard` | Dashboard | Dashboard Owner | Dashboard Owner | Keep, improve cards |
| `/orders/new` | Input Order | Input Order | Input Order | Keep as hub |
| `/orders/wa-paste` | WA Paste | Input Order | Tempel Laporan WA | Merge/tab under Input Order |
| `/orders/bulk-upload` | Bulk Upload | Input Order | Upload Order | Merge/tab under Input Order |
| `/orders/draft` | Kirim Order | Pengiriman & Rekonsiliasi | Antrian Kirim | Keep/improve |
| `/orders/export-resi` | Export Resi | Pengiriman & Rekonsiliasi | Export Ekspedisi | Merge into Antrian Kirim tab/action |
| `/orders/post-export` | Post Export | Pengiriman & Rekonsiliasi | Setelah Export | Merge into Antrian Kirim tab/action |
| `/import-mengantar` | Sync Status Mengantar | Pengiriman & Rekonsiliasi | Sync Mengantar/JNE | Keep, regroup |
| `/reconciliation/spx-status` | Sync Status SPX | Pengiriman & Rekonsiliasi | Sync Status SPX | Keep, regroup |
| `/reconciliation/ekspedisi` | Rekonsiliasi Ekspedisi | Pengiriman & Rekonsiliasi | Rekonsiliasi Status | Keep hub |
| `/reconciliation/upload` | Upload Recon | Pengiriman & Rekonsiliasi | Upload File Status | Keep/hide behind hub |
| `/export-rekonsiliasi` | Export Rekonsiliasi | Pengiriman & Rekonsiliasi | Export File Ekspedisi | Keep/regroup |
| `/inbox/*` | Inbox | Order Problem / Rescue | Antrian Masalah | Regroup under Rescue |
| `/crm` | Follow Up | Order Problem / Rescue | Rescue Order | Rename/framing |
| `/crm/[order_id]` | CRM Detail | Order Problem / Rescue | Detail Rescue | Keep |
| `/reconciliation/spx-cashflow` | SPX Cashflow | COD Cair | COD Cair SPX | Promote to top-level |
| `/reconciliation/spx` | SPX Payout legacy/status | COD Cair | Payout SPX | Evaluate merge/hide |
| `/financial-position` | Posisi Keuangan | COD Cair + Finance Check | Posisi Uang | Link from both |
| `/shipping-diff` | Selisih Ongkir | COD Cair + Finance Check | Selisih Ongkir/COD | Keep |
| `/commissions/manage` | Kelola Komisi | Gajian CS | Gajian CS | Rename/framing |
| `/commissions/my` | Komisi Saya | Gajian CS / CS Workspace | Komisi Saya | Keep |
| `/settings/commission-rules` | Aturan Komisi | Gajian CS / Master Data | Aturan Fee Tim | Rename |
| `/expenses` | Biaya Operasional | Finance Check + Gajian CS | Biaya/Gaji/OPEX | Keep |
| `/performa` | Performa Bisnis | Advertiser Cockpit | Campaign Profit | Keep/improve |
| `/analytics` | Analytics | Advertiser Cockpit | Analytics Produk/Campaign | Keep/regroup |
| `/marketing/ad-setup` | Setup Iklan | Advertiser Cockpit | Setup Campaign | Keep |
| `/marketing/distribusi` | Distribusi Atribusi | Advertiser Cockpit | Distribusi Lead/CS | Keep |
| `/marketing/performa` | Performa Iklan | Advertiser Cockpit | Performa Iklan | Merge with `/performa` later |
| `/ad-spend` | Input Harian | Advertiser Cockpit | Input Spend Iklan | Keep |
| `/adv/margin-simulator` | Margin Simulator | Advertiser Cockpit | Simulasi Margin/CPR | Keep |
| `/adv-dashboard` | Advertiser Dashboard | Advertiser Cockpit | Dashboard Advertiser | Evaluate merge |
| `/orders/pembukuan` | Pembukuan | Pembukuan & Finance Check | Pembukuan Ledger | Keep |
| `/laba-rugi` | Laporan Laba Rugi | Pembukuan & Finance Check | Laba Rugi | Keep |
| `/reports/*` | Reports | Pembukuan & Finance Check | Export/Audit Reports | Regroup |
| `/products` | Produk | Master Data | Produk | Keep |
| `/inventory` | Inventory | Master Data | Stok | Keep |
| `/settings/suppliers` | Supplier | Master Data | Supplier | Keep |
| `/settings/master-kurir` | Setup Kurir | Master Data | Kontrak Ekspedisi | Rename/framing |
| `/settings/couriers` | Couriers | Master Data | Master Kurir | Keep/hide behind Kontrak Ekspedisi |
| `/settings/courier-channels` | Courier Channels | Master Data | Channel/Aggregator | Keep/hide behind Kontrak Ekspedisi |
| `/settings/courier-rates` | Courier Rates | Master Data | Rate Ekspedisi | Keep/hide behind Kontrak Ekspedisi |
| `/settings/status-mapping` | Status Mapping | Master Data | Mapping Status Ekspedisi | Keep |
| `/settings/converter-profiles` | Converter Profiles | Master Data | Template Import/Export | Rename |
| `/settings/wilayah` | Master Wilayah | Master Data | Wilayah & Coverage | Keep/improve |
| `/settings/users` | Users & Roles | Master Data | Tim & Akses | Keep |
| `/settings/audit-log` | Audit Log | Master Data | Audit Log | Keep |
| `/settings/reset-data` | Reset Data | Master Data/System | Reset Data | Owner only, keep hidden/low priority |
| `/cs-ringkasan` | Ringkasan CS | Dashboard/CS Workspace | Ringkasan CS | Keep role-specific |
| `/cs-report` | Laporan Harian | Input/CS Workspace | Laporan Harian CS | Keep/regroup |
| `/team/cs` | Team CS | Master Data + Analytics | Tim CS | Move to Master/CS analytics |
| `/team/advertisers` | Team Advertisers | Master Data + Advertiser | Tim Advertiser | Move to Master/Advertiser |

---

## 6. Recommended Sidebar Implementation v1

Do not delete old routes. Update only `NAV_ITEMS` grouping/labels when ready.

Suggested `NAV_ITEMS` business structure:

```text
Dashboard Owner
  - Dashboard Owner (/dashboard)

Input Order
  - Input Order (/orders/new)
  - Tempel Laporan WA (/orders/wa-paste) [or tab]
  - Upload Order (/orders/bulk-upload) [or tab]
  - Antrian Validasi (/inbox/pending-review)

Order Problem / Rescue
  - Rescue Order (/crm)
  - Atribusi Kosong (/inbox/atribusi-required)
  - Resi Nyangkut (/inbox/unmatched-resi)
  - Status Asing (/inbox/unmapped-statuses)
  - Alamat Bermasalah (/inbox/address-review)
  - No HP Bermasalah (/inbox/phone-review)

Pengiriman & Rekonsiliasi
  - Antrian Kirim (/orders/draft)
  - Sync Mengantar/JNE (/import-mengantar)
  - Sync SPX (/reconciliation/spx-status)
  - Rekonsiliasi Status (/reconciliation/ekspedisi)
  - Export Ekspedisi (/export-rekonsiliasi)

COD Cair
  - Cashflow SPX (/reconciliation/spx-cashflow)
  - Posisi Uang (/financial-position)
  - Selisih Ongkir/COD (/shipping-diff)

Gajian CS
  - Gajian CS (/commissions/manage)
  - Aturan Fee Tim (/settings/commission-rules)
  - Komisi Saya (/commissions/my)

Advertiser Cockpit
  - Performa Campaign (/performa)
  - Distribusi Lead/CS (/marketing/distribusi)
  - Input Spend Iklan (/ad-spend)
  - Setup Campaign (/marketing/ad-setup)
  - Simulasi Margin/CPR (/adv/margin-simulator)

Pembukuan & Finance Check
  - Pembukuan Ledger (/orders/pembukuan)
  - Laba Rugi (/laba-rugi)
  - Finance Audit Pack (/reports/export) [future]
  - Biaya/Gaji/OPEX (/expenses)

Master Data
  - Produk (/products)
  - Stok (/inventory)
  - Supplier (/settings/suppliers)
  - Kontrak Ekspedisi (/settings/master-kurir)
  - Wilayah & Coverage (/settings/wilayah)
  - Template Import/Export (/settings/converter-profiles)
  - Tim & Akses (/settings/users)
  - Audit Log (/settings/audit-log)
```

---

## 7. Role Visibility v1

### Owner

Show all business workflows:

```text
Dashboard Owner
Input Order
Order Problem / Rescue
Pengiriman & Rekonsiliasi
COD Cair
Gajian CS
Advertiser Cockpit
Pembukuan & Finance Check
Master Data
```

### Admin

Show operational workflows:

```text
Input Order
Order Problem / Rescue
Pengiriman & Rekonsiliasi
COD Cair limited/read-only if needed
Gajian CS limited/no salary if needed
Pembukuan limited
Master Data limited
```

### Advertiser

Show only ad decision workflows:

```text
Advertiser Cockpit
- Performa Campaign
- Distribusi Lead/CS
- Input Spend Iklan if allowed
- Setup Campaign if allowed
- Simulasi Margin/CPR
```

### CS

Show minimal workspace:

```text
Input Order if CS can input
Order Problem assigned to them
Komisi Saya
Ringkasan CS
```

### Akunting

Future/optional:

```text
COD Cair read-only
Pembukuan & Finance Check
Biaya/OPEX
Export Audit Pack
```

---

## 8. UI Terminology Dictionary

Use these names in UI copy and sidebar.

| Avoid / technical | Use / business-friendly |
|---|---|
| Courier Rates | Rate Ekspedisi / Kontrak Ekspedisi |
| Courier Channels | Channel/Aggregator Ekspedisi |
| Channel Billing Config | Aturan Tagihan Ekspedisi |
| Commission Rules | Aturan Fee Tim |
| Manage Commissions | Gajian CS / Bayar Fee Tim |
| CRM | Rescue Order / Order Bermasalah |
| Inbox | Antrian Masalah |
| Reconciliation | Rekonsiliasi Status / COD Cair depending context |
| SPX Cashflow | COD Cair SPX |
| Ad Spend | Spend Iklan |
| Analytics | Performa Campaign / Produk |
| Pembukuan | Pembukuan Ledger |
| Financial Position | Posisi Uang |
| Operational Expenses | Biaya/Gaji/OPEX |
| Converter Profiles | Template Import/Export |
| Master Wilayah | Wilayah & Coverage |

---

## 9. First Implementation Scope Recommendation

Do not change deep logic first. Start with a low-risk UI/navigation sprint.

### Sprint 0A — Navigation rename/regroup only

**Objective:** Make GrandBook feel less bertele-tele without breaking routes.

**Likely file:**

```text
src/lib/constants.ts
```

**Steps:**

1. Update `NAV_ITEMS` titles and children into the proposed business structure.
2. Keep all existing route hrefs unchanged.
3. Do not delete old pages.
4. Run lint/build.
5. Deploy.
6. Barry reviews whether menu feels easier.

**Acceptance criteria:**

- Owner sees fewer, clearer workflow groups.
- Admin can find Input Order, Rescue/Problem, Pengiriman quickly.
- Advertiser can find campaign performance/spend/attribution quickly.
- Existing URLs still work.

### Sprint 0B — Page header/copy cleanup

**Objective:** Make labels inside key pages match new business terminology.

**Likely pages:**

```text
/orders/pembukuan/page.tsx
/reconciliation/spx-cashflow/page.tsx
/commissions/manage/page.tsx
/settings/commission-rules/page.tsx
/crm/page.tsx
/inbox/layout.tsx
/performa/page.tsx
```

**Acceptance criteria:**

- No finance/technical jargon when business term is clearer.
- Pages explain what owner/admin/advertiser should do next.

---

## 10. Risks / Warnings

1. **Role confusion:** Renaming sidebar can confuse existing users if too much changes at once. Mitigate with old route still routable and clear labels.
2. **Duplicate concepts:** Some routes overlap (`/performa`, `/analytics`, `/marketing/performa`, `/adv-dashboard`). Do not delete until reviewed.
3. **Finance sensitivity:** Do not rewrite formulas in menu sprint.
4. **Commission sensitivity:** Payroll/carry-over must be designed before changing payment logic.
5. **Operational dependency:** Admin workflow must remain fast; do not bury WA Paste.
6. **Advertiser trust:** Advertiser cockpit must clearly distinguish estimated vs realized profit.

---

## 11. Open Questions Before Coding Sprint 0A

1. Final top-level label: `Order Problem / Rescue` or Indonesian `Order Bermasalah`?
2. `COD Cair` should be standalone top-level, or under Finance? Recommendation: standalone.
3. `Gajian CS` should include advertiser fee later or be called `Gajian Tim`? Recommendation now: `Gajian CS`, with internal support for advertiser.
4. Should `Pembukuan & Finance Check` be called `Finance Check` or `Pembukuan`? Recommendation: `Pembukuan & Finance Check` for owner clarity.
5. Should admin see `COD Cair` or only owner/admin? Recommendation: admin can see operational matching, owner controls apply/payment.

---

## 12. Recommended Next Action

Ask Barry to approve or edit these top-level labels:

```text
Dashboard Owner
Input Order
Order Problem / Rescue
Pengiriman & Rekonsiliasi
COD Cair
Gajian CS
Advertiser Cockpit
Pembukuan & Finance Check
Master Data
```

If approved, implement **Sprint 0A: Navigation rename/regroup only**.

Do not implement payroll, rescue, advertiser cockpit, or finance export yet. Those are later sprints after the workflow language is accepted.
