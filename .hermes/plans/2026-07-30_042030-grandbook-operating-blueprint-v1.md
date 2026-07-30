# GrandBook Operating Blueprint v1 Implementation Plan

> **For Hermes:** Use this plan as the operating blueprint and implementation roadmap before coding GrandBook changes. Implement task-by-task only after Barry approves the relevant sprint.

**Goal:** Turn GrandBook into a user-friendly COD dropship operating system for owner, admin, advertiser, CS, rescue/problem handler, and later finance audit/crosscheck.

**Architecture:** GrandBook should not be rebuilt from zero. Keep the existing foundations — orders, WA Paste, courier channels/rates, billing config, commissions, inbox/CRM, Pembukuan, SPX cashflow — but rename and regroup them into business workflows. Add missing layers for payroll cycle, carry-over commission, rescue order workflow, advertiser cockpit, and Excel audit pack.

**Tech Stack:** Next.js 16, React 19, Supabase/Postgres RPC/migrations, Vercel, existing GrandBook repo at `/tmp/grandbook-app-repo`.

---

## 1. North Star

GrandBook exists to help Barry operate and audit a COD dropship business without a finance team.

Owner questions GrandBook must answer:

- Hari ini order/lead masuk berapa?
- Transaksi harian dan all-time berapa?
- Produk mana boncos/bagus?
- Platform iklan mana worth it: Meta, Google, Snack?
- Campaign mana harus dimatiin / scale?
- CS mana perform dan cocok untuk produk/lead tertentu?
- Kalau CS kebanyakan lead, perform turun nggak?
- Estimasi profit harian berapa?
- Fixed/realized profit setelah COD cair berapa?
- COD belum cair berapa?
- Komisi/gajian CS berapa dan mana carry-over dari bulan sebelumnya?
- Kesalahan data/input/reconcile ada di mana?

Principle:

```text
GrandBook = sistem operasional utama
Excel/Spreadsheet = audit backup + crosscheck, bukan pengganti sistem
```

---

## 2. Real Business Flow

Current real-world flow from Barry:

```text
Ads Meta / Google / Snack
→ Landing page
→ Customer isi form
→ Lead masuk OrderOnline.id
→ Customer auto-chat CS
→ CS follow-up / closing
→ CS daily report masuk grup WhatsApp
→ Indra/admin ambil data dari grup WA
→ GrandBook input via WA Paste
→ Validasi order / atribusi / wilayah / ekspedisi
→ Kirim via SPX Direct primary, fallback courier if not covered
→ Sync/reconcile status expedition
→ Delivered / return / cancel / problem
→ SPX cashflow/payout reconciliation
→ COD settled
→ Commission/gajian CS
→ Owner/advertiser decisions
```

Important rules:

- OrderOnline product naming is used for attribution, e.g. `Luna F.B.2`.
- Primary courier: SPX Direct.
- Fallback couriers: JNE via Mengantar.com or others if SPX Direct does not cover area.
- SPX Direct has no direct API key currently; GrandBook must support file/manual reconciliation.
- SPX current assumptions can change monthly/by courier/by aggregator/by sales:
  - COD fee 1%
  - shipping discount/cashback 40%
  - current free two-way return / RTS fee 0
  - PPN 12%

---

## 3. Existing GrandBook Foundations Already Found

Do not duplicate these; rename/regroup/improve them.

| Business language | Existing technical feature/name | Status |
|---|---|---|
| Kontrak Ekspedisi | `couriers`, `courier_channels`, `courier_channel_rates`, `channel_billing_config` | Foundation exists |
| Rate per periode | `rate_key`, `rate_value`, `effective_from`, `effective_to`, `get_active_rate()` | Exists |
| Billing model | `billing_model`, `get_active_billing_config()` | Exists |
| Cost engine | `compute_order_costs()`, `compute_draft_order_costs()` | Exists |
| Aturan fee CS/advertiser | `commission_rules` | Exists |
| Fee per user/product/period | `user_id`, `product_id`, `effective_from/to` in commission rules | Exists |
| Komisi order | `commissions` with `PENDING/EARNED/PAID/VOIDED` | Exists |
| Kelola komisi | `/commissions/manage` | Exists, needs payroll framing |
| WA input order | WA Paste parser/flow | Exists |
| Data problem queues | Inbox tabs: pending, atribusi, unmatched resi, unmapped status, address, phone | Exists |
| Rescue/CRM base | `problem_type`, `crm_status`, `assigned_to`, `sla_due_at`, `list_crm_cases` | Foundation exists |
| Pembukuan ledger | `/orders/pembukuan`, `list_pembukuan` | Exists; timeout fixed/deployed |
| SPX cashflow | `/reconciliation/spx-cashflow` | Exists, needs operationalization |

---

## 4. Menu/Workflow Target

Proposed simple navigation for business users:

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

Mapping from current menus:

```text
Settings/Couriers/Courier Rates       → Kontrak Ekspedisi
Commission Rules                      → Aturan Fee Tim
Commissions Manage                    → Gajian CS / Bayar Komisi
Inbox + CRM                           → Order Problem / Rescue
SPX Cashflow + Reconciliation         → COD Cair
Pembukuan + Laba Rugi + Reports       → Pembukuan & Finance Check
Marketing/Distribusi/Performa         → Advertiser Cockpit
WA Paste / Bulk Upload / Draft Orders → Input Order
```

---

## 5. Role-Based Goals

### Owner

Owner dashboard must show:

- daily order/lead/closing/shipped/delivered/return/fake/cancel counts
- estimated profit vs realized/fixed profit
- COD unsettled amount and aging
- campaign/product/platform profitability
- CS performance and CS-product fit
- ad spend vs funnel outcome
- commission/payroll liability
- problem/rescue queue impact
- finance audit warning flags

### Admin / Indra

Admin workflow must be simple:

```text
Paste WA report
→ GrandBook parses
→ system marks red/yellow issues
→ admin fixes only what is needed
→ order ready to ship/reconcile
```

Admin should not think about finance formulas.

Required issue flags:

- attribution missing/ambiguous
- invalid phone
- address/wilayah not parsed
- SPX coverage not available
- duplicate/customer reputation issue
- suspicious price/ongkir/COD amount
- product not mapped
- campaign not mapped

### Advertiser

Advertiser cockpit must answer:

- campaign lanjut/matiin?
- produk perlu scale atau stop?
- platform Meta/Google/Snack mana paling profit?
- lead source/campaign cocok untuk CS siapa?
- apakah lead terlalu banyak ke CS tertentu menurunkan success rate?
- cost per lead/closing/shipped/delivered/settled COD
- estimated profit and realized profit by campaign/product/platform

Advertiser metrics must not stop at lead/order; they must continue to delivered and COD settled.

### CS Closing

CS view should stay simple:

- order assigned/follow-up
- own performance
- own commissions/earned/paid
- problem orders if assigned

### Rescue / CS Ekspedisi

Dedicated role/person for in-transit problematic orders:

```text
DIKIRIM/PROBLEM orders
→ assigned to rescue handler
→ follow up buyer/courier/dashboard
→ record attempt/result
→ saved to delivered or final return/cancel
```

Metrics:

- cases assigned
- cases saved to delivered
- saved revenue/profit
- unresolved aging/SLA
- problem type distribution

### Finance/Audit Layer

Because Barry is weak in finance/accounting and has no finance team, GrandBook needs double-check controls:

- export finance audit pack to Excel
- compare GrandBook calculations against spreadsheet formulas
- prepare future journal/P&L/balance sheet style views
- flag formula/data discrepancies

---

## 6. Critical Business Definitions

### Dates to separate

Do not mix these in reporting:

```text
lead_date      = lead from ads / landing / OrderOnline
order_date     = CS/admin created/closed order in GrandBook
shipped_date   = order exported/picked up/sent
terminal_date  = delivered/return/cancel final status
settled_date   = COD payout/cair date
payroll_date   = CS payday batch date, e.g. tanggal 23
```

### Profit layers

```text
Estimated profit
= projected based on order/shipping/courier rules before final payout

Realized/fixed profit
= after final delivery status + COD settlement/payout

Audit profit
= spreadsheet/export crosscheck result
```

### Funnel metrics to define later

Working terms for now:

```text
CPR / Cost per Lead
Cost per Closing
Cost per Shipped
Cost per Delivered
Cost per Settled COD
```

Final naming can be decided later.

### COD/dropship complexity to support

- ad spend today can create leads that close tomorrow/later
- lead does not always close
- closing does not always ship due to courier coverage
- shipped COD can return
- delivered does not mean money is settled yet
- transfer orders are minority but must still work
- ongkir charged to customer can differ from real courier cost/payout deduction

---

## 7. Payroll / Gajian CS Design

Current foundation:

- `commission_rules` supports user/product/period and flat/percent/none.
- `commissions` supports `PENDING/EARNED/PAID/VOIDED`.
- `/commissions/manage` can batch mark commissions paid.

Missing business layer:

```text
Payroll Cycle / Slip Gaji CS
```

Required model concept:

```text
payroll_batch
- id
- user_id
- payroll_date, e.g. 2026-07-23
- period_from / period_to
- base_salary
- current_period_earned_commission
- carryover_earned_commission
- voided_count/amount
- total_to_pay
- paid_at / payment_reference / notes
```

Barry example to support:

```text
Lisa paid on 23 June:
- base salary
- fee from 1000 successfully delivered orders out of ~1500 orders
- in-transit orders excluded

Lisa paid on 23 July:
- base salary
- fee from 900 July delivered orders
- plus 32 prior-period orders that later delivered
- returned orders voided/hangus
```

Important decision:

- Commission is earned by delivery/terminal success date, not merely order date.
- Payroll batch should show carry-over separately so Barry trusts the number.

---

## 8. Courier / Shipping Contract Design

Current foundation exists. Need owner-friendly UI and rule completeness.

Existing tables/functions:

```text
couriers
courier_channels
courier_channel_rates
channel_billing_config
get_active_rate()
get_active_billing_config()
compute_order_costs()
```

Business UI should become:

```text
Kontrak Ekspedisi
```

Fields to surface:

- courier: SPX/JNE/etc
- channel/aggregator: Direct/Mengantar/other
- sales/account if relevant
- valid from/to
- COD fee rate
- PPN rate
- shipping discount/cashback
- return/RTS cost rule
- billing model: monthly invoice / nett off per order / direct transfer / no reconciliation
- notes/evidence

Important: rule must be versioned by date and not alter old historical order calculations incorrectly. Existing `rate_snapshot` helps; verify usage and backfill behavior before changing formula.

---

## 9. Rescue Order / Problem Handling Design

Current foundation exists but needs workflow identity.

Existing:

```text
Inbox tabs
problem_type
crm_status
assigned_to
sla_due_at
list_crm_cases
resolve_crm_case
```

Target screen:

```text
Order Problem / Rescue
```

Required fields:

- source: draft/final
- order id/order number
- current status
- problem type: unreachable buyer, address issue, courier issue, coverage issue, COD refusal, other
- assigned_to
- SLA due
- follow-up attempts
- last contact timestamp
- resolution: saved delivered / return / cancel / fake / still pending
- notes

Target metrics:

- problem orders open
- aging/SLA overdue
- saved-to-delivered count
- saved revenue/profit
- by handler performance

---

## 10. Finance Excel Audit Pack

Purpose:

```text
Crosscheck GrandBook calculations and provide finance/accounting backup.
```

Not a replacement for GrandBook.

Export workbook target:

```text
grandbook_finance_audit_pack_YYYY-MM.xlsx
```

Suggested sheets:

1. `Orders Ledger`
   - all orders union with key dates/statuses/source/campaign/CS/channel/payment
2. `Ad Spend`
   - spend by date/platform/campaign/product/advertiser
3. `Courier Cost`
   - shipping charged, shipping actual, cashback, COD fee, PPN, RTS/return cost
4. `COD Payout`
   - delivered orders, payout amount, settled date, unsettled aging
5. `Commission Payroll`
   - user, base salary placeholder, earned, paid, carry-over, voided
6. `Product Profit`
   - product revenue/HPP/shipping/ad allocation/profit
7. `Campaign Profit`
   - campaign/platform lead/order/delivered/retur/COD settled/profit
8. `P&L Summary`
   - estimated vs realized profit
9. `Reconciliation Checks`
   - mismatches, missing campaign/CS/resi/payout/rate rule
10. `Journal Draft` later
    - future accounting layer, not first sprint

---

## 11. Sprint Roadmap

### Sprint 0 — Blueprint & Naming Freeze

**Goal:** Stop adding random features. Agree on workflow names and what current features map to.

Tasks:

1. Create this blueprint doc.
2. Review with Barry and mark wrong/missing items.
3. Make a table: existing route → new business name → keep/merge/hide.
4. Decide final top-level menu names.
5. Create a UI terminology dictionary.

Deliverable:

```text
GrandBook Operating Blueprint v1 approved
```

### Sprint 1 — Admin Input & Error Reading

**Goal:** Make Indra/admin input less risky.

Candidate changes:

- Improve WA Paste review screen.
- Add issue severity badges: red/yellow/green.
- Show exactly what admin must fix.
- Add coverage warning if SPX Direct not available.
- Add suspicious ongkir/COD/price flag.

Validation:

- Paste sample WA group data.
- Confirm parsed orders show campaign/CS/product/channel issues clearly.

### Sprint 2 — COD Cair / SPX Payout

**Goal:** Owner sees real money status.

Candidate changes:

- Harden SPX Account Transaction List upload.
- Preview matched/unmatched/ambiguous.
- Apply `cod_settled_at`, `payout_amount`, bank withdrawal rows.
- Show unpaid/uncair aging.

Validation:

- Use small payout file sample only.
- Match rate reviewed before apply.
- Confirm delivered unsettled decreases.

### Sprint 3 — Payroll/Gajian CS tanggal 23

**Goal:** Make CS payment trustworthy.

Candidate changes:

- Add payroll batch model/view.
- Show current period vs carry-over delivered orders.
- Include base salary manually entered/expense-linked.
- Mark commission paid via payroll batch.

Validation:

- Reproduce Lisa example with period/carry-over logic.
- Confirm returned orders are void/hangus.

### Sprint 4 — Rescue Order Workflow

**Goal:** Increase delivered rate by handling in-transit problems.

Candidate changes:

- Rename/reshape CRM/inbox into Rescue Order screen.
- Assign problem orders to handler.
- Add follow-up attempt logging.
- Add saved-to-delivered metrics.

Validation:

- Problem order can be assigned, followed up, resolved.
- Owner sees saved revenue/profit.

### Sprint 5 — Advertiser Cockpit

**Goal:** Help advertiser decide scale/kill.

Candidate changes:

- Campaign/product/platform cards with funnel metrics.
- Show lead → order → shipped → delivered → settled.
- Show CS-load effect and CS-product fit.
- Add simple recommendations: scale/watch/kill.

Validation:

- Compare top campaigns with live data.
- Confirm not misleading if COD not settled yet.

### Sprint 6 — Finance Audit Pack Excel

**Goal:** Build spreadsheet crosscheck and backup.

Candidate changes:

- Create export endpoint or client export using XLSX.
- Include audit sheets listed above.
- Add check formulas and mismatch flags.

Validation:

- Export a month.
- Sum totals match GrandBook summary.
- Differences are highlighted.

---

## 12. Open Questions for Barry

These should be answered gradually, not all at once.

1. Final top-level menu names: Indonesian owner-friendly or mixed English?
2. Should payday always be tanggal 23 for all CS or configurable per user?
3. Does base salary live as `operational_expenses` or separate payroll table linked to expense?
4. For commission carry-over, should period filter use delivered date, order date, or paid date? Proposed: delivered/earned date for fee, payroll date for payment.
5. What are exact SPX Direct files currently available: status, payout/cashflow, area coverage?
6. Does Mengantar.com provide JNE status files with stable columns?
7. How should ad spend be allocated when a lead closes next day/month?
8. How should advertiser be evaluated if CS overload causes lower closing/delivery rate?
9. Which finance statement matters first: simple P&L, cashflow, or balance-style report?
10. Which reports must be exportable monthly for manual audit?

---

## 13. Immediate Next Action

Review this blueprint with Barry. Do not implement new features until Sprint 0 is accepted.

Recommended next deliverable after review:

```text
GrandBook Menu & Workflow Redesign Spec v1
```

It should include:

- current route list
- proposed renamed menu
- routes to merge/hide
- owner/admin/advertiser/rescue workflows
- first sprint implementation scope
