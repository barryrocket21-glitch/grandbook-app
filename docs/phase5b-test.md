# Phase 5B — Smoke Test Checklist

Phase 5B = Ad Spend + Campaigns + ROAS + Net Profit per Produk. Verifikasi schema audit, migration idempotent, CRUD pages, CSV upload, analytics ROAS tab + Net Profit After Ads.

## Pre-test setup (SQL Editor)

```sql
-- Verify migration applied + existing data preserved
SELECT id, campaign_name, platform, organization_id, status, campaign_code
FROM campaigns ORDER BY id;
-- Expect: 2 rows (id 7, 8), org=1, status='ACTIVE'

SELECT id, spend_date, campaign_id, organization_id, source, conversions, lead_platform
FROM ad_spend ORDER BY id;
-- Expect: 5 rows, org=1, source='MANUAL', conversions=NULL, lead_platform preserved

-- Link existing campaign to a real product (for Per Produk test)
INSERT INTO campaign_products (organization_id, campaign_id, product_id, allocation_pct)
SELECT 1, 7, p.id, 100
FROM products p WHERE p.active = TRUE LIMIT 1;

-- Insert dummy spend dengan conversions untuk test ROAS
INSERT INTO ad_spend (
  organization_id, spend_date, campaign_id, spend,
  impressions, clicks, conversions, source, created_by
) VALUES (
  1, CURRENT_DATE, 7, 750000, 15000, 320, 35, 'MANUAL',
  (SELECT id FROM profiles WHERE role='owner' LIMIT 1)
) ON CONFLICT (organization_id, spend_date, campaign_id) DO NOTHING;
```

## Test `/campaigns` page

- [ ] Buka `/campaigns` → tabel tampil 2 existing campaigns (id 7, 8)
- [ ] Stat: total + active count
- [ ] Filter platform "META" → row META aja
- [ ] Filter status "ACTIVE" → row ACTIVE aja
- [ ] Search by name → filter jalan
- [ ] Klik "Tambah Campaign" → dialog buka
  - [ ] Combobox advertiser dengan emptyHint kalau kosong
  - [ ] Platform dropdown 5 opsi
  - [ ] Status dropdown 3 opsi (ACTIVE/PAUSED/ENDED)
  - [ ] Start/End date pickers
  - [ ] Daily budget input
  - [ ] Objective dropdown 6 opsi
  - [ ] Save → row baru muncul
- [ ] Edit campaign → ubah status → ke-update
- [ ] Power icon (toggle active) → row jadi opaque
- [ ] Trash icon (owner only) → warn dengan count linked products
- [ ] Klik Linked Products icon → dialog buka
  - [ ] Tabel produk yang sudah di-link
  - [ ] Total allocation display
  - [ ] Add produk: pilih dari Combobox (filtered, exclude yang sudah linked) + allocation %
  - [ ] Validation client: total > 100 → error
  - [ ] Validation server: trigger guard fire kalau total > 100 (test dengan 2 produk 60%+50%)
  - [ ] Edit allocation → ke-update
  - [ ] Delete link → row hilang

## Test `/ad-spend` page

- [ ] Buka `/ad-spend` → existing 5 rows + dummy 1 row muncul (kalau dummy diinsert)
- [ ] DateRangePicker default = Bulan Ini
- [ ] Stat cards: Total Spend, Conversions (35), Impressions, Clicks (+CTR%)
- [ ] By-platform breakdown chips: META Rp xxx
- [ ] Filter platform "META" → row aja
- [ ] Filter source "MANUAL" → row source=MANUAL aja
- [ ] Tambah manual:
  - [ ] Combobox campaign (active only) dengan emptyHint kalau kosong
  - [ ] Required fields: tanggal, campaign, spend
  - [ ] Opsional: impressions, reach, clicks, conversions, revenue_reported, notes
  - [ ] Save → row baru muncul + summary update
  - [ ] Duplicate (sama tanggal+campaign) → toast error "Sudah ada spend"
- [ ] Edit spend → ubah angka → ke-update
- [ ] Delete spend (owner only) → row hilang

## Test `/ad-spend` CSV Upload

Bikin sample CSV (`sample-meta-ads.csv`):
```csv
Day,Campaign name,Campaign ID,Amount spent (IDR),Impressions,Reach,Link clicks,Purchases,Purchases conversion value
2026-05-08,1-5 Nature Gemuk Badan ABO-BID Advented+,12345,500000,12000,8500,180,15,4500000
2026-05-09,1-5 Nature Gemuk Badan ABO-BID Advented+,12345,450000,11000,7800,170,14,4200000
2026-05-08,Campaign Yang Belum Ada,67890,300000,8000,6500,120,8,2400000
```

- [ ] Klik "Upload CSV" → Step 1 buka
- [ ] Pilih "META" → Lanjut
- [ ] Step 2: klik area drop → pilih file
- [ ] Step 3 Preview: 
  - [ ] Stat: Total Rows / Matched / Unmatched / Errors
  - [ ] Detected columns ditampilkan (date=Day, campaign=Campaign name, spend=Amount spent (IDR))
  - [ ] Currency: IDR (warning kosong)
  - [ ] Sample preview table 10 row (kalau ada)
  - [ ] Unmatched campaign names section: "Campaign Yang Belum Ada"
- [ ] Klik "Import X rows" → Step 4 importing → Step 5 done
  - [ ] Inserted: 2 (yang match)
  - [ ] Skipped duplicate: 0 (first time)
  - [ ] Errors: 0
- [ ] Re-upload sama file → expect: Inserted 0, Skipped 2 (idempotency)
- [ ] CSV currency non-IDR test: tambah header `Amount spent (USD)` → warning muncul

## Test `/analytics` Row 4 (Net Profit After Ads)

- [ ] Buka `/analytics` (owner only) → Tab Overview
- [ ] Row 4 stat cards 5 kolom:
  - [ ] Op. Expenses (dari Phase 5A)
  - [ ] Total Ad Spend (Phase 5B)
  - [ ] Net Profit Before Ads (estimated profit − op expenses)
  - [ ] Net Profit After Ads (− ad spend)
  - [ ] Net Margin % (net after ads / revenue)
- [ ] Net Profit After Ads = Net Profit Before Ads − Total Ad Spend
- [ ] Margin badge color-coded (≥10% emerald, ≥0% amber, <0% red)

## Test `/analytics` Tab ROAS per Campaign

- [ ] Tab "ROAS" muncul di tabs list
- [ ] Tabel:
  - [ ] Campaign name + status badge
  - [ ] Platform badge color
  - [ ] Advertiser name
  - [ ] Linked products (comma-separated, truncated 200px)
  - [ ] Spend, Conv, Orders (linked by campaign_id), Revenue, Revenue DITERIMA
  - [ ] ROAS Diterima badge (≥2x emerald, ≥1x amber, <1x red)
  - [ ] ROAS Gross display kecil di bawah
  - [ ] Cost/Order
- [ ] Sortable by Spend / ROAS / Revenue / Orders
- [ ] Top 10 Campaign by ROAS bar chart

## Test `/analytics` Tab Per Produk (extended)

- [ ] Tab "Per Produk" → kolom-kolom baru:
  - [ ] Ad Spend (orange, dari campaign_products allocation)
  - [ ] Net After Ads (gross − allocated_ad_spend)
  - [ ] ROAS (revenue / allocated_ad_spend, badge color-coded)
- [ ] Sort default = Net After Ads DESC (paling profitable di atas)
- [ ] Sortable juga by Revenue / Gross Profit / ROAS / Qty / Conv

## Test multi-role permissions

- [ ] Login owner: campaigns + ad-spend full access + delete buttons
- [ ] Login admin: campaigns + ad-spend access, no delete (canWrite ok, owner-only hidden)
- [ ] Login advertiser: campaigns + ad-spend access (write own)
- [ ] Login cs/akunting: campaigns + ad-spend HIDDEN dari sidebar

## Test migration idempotency

```bash
# Re-run migration 021
python3 -c "
import json, urllib.request
sql = open('src/lib/supabase/migrations/021_ad_spend_campaigns.sql').read()
env = {l.split('=',1)[0].strip(): l.split('=',1)[1].strip() for l in open('.env.local') if '=' in l and not l.startswith('#')}
req = urllib.request.Request(env['NEXT_PUBLIC_SUPABASE_URL']+'/rest/v1/rpc/exec_sql',
  data=json.dumps({'sql':sql}).encode(),
  headers={'apikey':env['SUPABASE_SERVICE_ROLE_KEY'],'Authorization':'Bearer '+env['SUPABASE_SERVICE_ROLE_KEY'],'Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
"
```

- [ ] Status: "ok" — no errors, no duplicate columns/constraints
- [ ] Existing 2 campaigns + 5 ad_spend tetap utuh
- [ ] organization_id tetap 1
- [ ] campaign_products tabel intact

## Test data linkage end-to-end

1. Bikin order baru dengan campaign_id = 7 + product yang linked
2. Status DITERIMA
3. Buka /analytics:
   - [ ] ROAS tab: campaign 7 row update → linked_orders_count, linked_revenue, ROAS terhitung
   - [ ] Per Produk: produk linked → allocated_ad_spend = spend × 100% (kalau 1:1), Net After Ads = revenue − HPP − allocated

## Cleanup pre-test data (jika perlu)

```sql
-- WARNING: hanya kalau test pakai dummy, jangan delete real data
DELETE FROM campaign_products WHERE campaign_id = 7 AND allocation_pct = 100;
DELETE FROM ad_spend WHERE spend = 750000 AND conversions = 35;
```
