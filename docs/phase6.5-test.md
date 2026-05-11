# Phase 6.5 — Smoke Test Checklist: Shipping Diff Revival

Phase 6.5 = revive page `/shipping-diff` dari archived banner ke full table per-order shipping diff. 3 angka ongkir (charge customer / gross / net after cashback) + 2 selisih per order. Mini-phase: 1 migration (2 RPCs), 1 page refactor, 1 sidebar update.

## Pre-test setup

Pastikan ada minimal 5-10 orders dengan field shipping lengkap (Phase 4C trigger compute_order_costs harus sudah jalan):

```sql
-- Check orders dengan shipping triple terisi
SELECT o.id, o.order_number, o.order_date,
       o.shipping_cost AS customer,
       o.shipping_cost_actual AS gross,
       o.estimated_shipping_net AS net
FROM orders o
WHERE o.organization_id = 1
  AND o.shipping_cost > 0
  AND o.shipping_cost_actual IS NOT NULL
LIMIT 10;
```

Kalau cuma sedikit yang punya `shipping_cost_actual` populated, trigger recompute manual:

```sql
SELECT compute_order_costs(id) FROM orders
WHERE organization_id = 1 AND shipping_cost_actual IS NULL;
```

## Test 1 — Page load + RPC callable

- [ ] Buka `/shipping-diff` → BUKAN banner archived lagi
- [ ] Default load: date range Bulan Ini, filter All
- [ ] Owner / admin bisa akses, cs / advertiser di-redirect dengan link ke /analytics Per Channel
- [ ] Page render PageHeader + filter bar + stat cards + tabel + legend
- [ ] No console errors

## Test 2 — Filter functionality

- [ ] Date range change → fetch ulang, tabel refresh
- [ ] Channel filter "Semua" → tampil semua channel
- [ ] Channel filter spesifik (e.g. SPX_DIRECT) → cuma rows channel itu
- [ ] Courier filter "Semua" → tampil semua courier
- [ ] Courier filter spesifik → cuma rows courier itu
- [ ] Status filter "DITERIMA" → cuma rows status DITERIMA
- [ ] Combo filter (channel + courier + status) → apply semua

## Test 3 — Summary stat cards

- [ ] Total Orders = count rows table
- [ ] "Selisih After CB" = sum kolom Sel Net di table
- [ ] "Selisih Before CB" = sum (charge − gross)
- [ ] Avg Margin % match between summary & table totals row
- [ ] Sub-text di Total Orders: profit/breakeven/loss count benar
- [ ] Color KPI: emerald kalau selisih_net ≥0, red kalau <0
- [ ] Detail breakdown card (4 cells): Total charge customer / Total gross / Total net / Total cashback — match aggregate

## Test 4 — Sortable kolom

- [ ] Klik header Order # → sort ascending (alfabetik order_number)
- [ ] Klik lagi → descending
- [ ] Date sort default DESC (newest first)
- [ ] Click Date → asc / desc toggle
- [ ] Charge / Gross / Net / Sel Net / Margin % → numeric sort (bukan string)
- [ ] Channel / Courier → alphabetic sort
- [ ] Indicator icon (chevron up/down) muncul di kolom aktif, ArrowUpDown muted di kolom lain

## Test 5 — Color coding & badges

- [ ] Sel Net positive: text emerald (`text-emerald-600`), prefix "+"
- [ ] Sel Net negative: text red bold (`text-red-600 font-medium`)
- [ ] Sel Net 0: muted text
- [ ] Margin % badge color:
  - ≥30% emerald (`bg-emerald-500/10`)
  - 0-30% amber
  - <0% red
- [ ] Status badge pakai STATUS_BADGE_COLOR dari schemas

## Test 6 — Edge cases

- [ ] Order dengan shipping_cost = 0 (gratis ongkir): margin% = 0 (no div-by-zero)
- [ ] Order tanpa shipping_cost_actual: fallback ke shipping_cost (selisih = 0, no error)
- [ ] Order tanpa estimated_shipping_net: fallback ke shipping_cost_actual → shipping_cost
- [ ] Cashback column tampil "—" kalau cashback = 0
- [ ] Tabel kosong (filter no-match): EmptyState "Belum ada order dalam filter ini"
- [ ] Footer total row hilang kalau no data

## Test 7 — RLS / Permissions

- [ ] Owner: akses page, lihat semua orders
- [ ] Admin: akses page, lihat semua orders
- [ ] CS / advertiser / akunting: redirect ke message "owner/admin only"

## Test 8 — Sidebar visibility

- [ ] Login owner: sidebar group "Reconciliation" → sub-item "Selisih Ongkir"
- [ ] Login admin: same
- [ ] Login cs/akunting/advertiser: sub-item TIDAK muncul (group reconciliation owner+admin only)
- [ ] Click sub-item → navigate ke `/shipping-diff`

## Test 9 — Order detail link

- [ ] Klik order_number di kolom Order # → navigate ke `/orders/[id]` (existing detail page)

## Test 10 — Idempotency migration

```bash
python3 -c "
import json, urllib.request
sql=open('src/lib/supabase/migrations/024_shipping_diff_rpc.sql').read()
env={l.split('=',1)[0].strip():l.split('=',1)[1].strip() for l in open('.env.local') if '=' in l and not l.startswith('#')}
req=urllib.request.Request(env['NEXT_PUBLIC_SUPABASE_URL']+'/rest/v1/rpc/exec_sql',
  data=json.dumps({'sql':sql}).encode(),
  headers={'apikey':env['SUPABASE_SERVICE_ROLE_KEY'],'Authorization':'Bearer '+env['SUPABASE_SERVICE_ROLE_KEY'],'Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
"
```

- [ ] Re-run migration 024 → "ok", no errors
- [ ] RPCs masih callable + return shape sama
