# Phase 6 — Smoke Test Checklist

Phase 6 = CS Daily Report + ADV-CS Cross-Check Funnel. Verifikasi schema, RLS isolation per CS, validation `closing <= lead_in`, upsert pattern, funnel 3-layer.

## Pre-test setup (SQL Editor)

```sql
-- Migration sanity check
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='daily_cs_report') AS dcr_exists,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ad_spend' AND column_name='meta_lead_count') AS meta_lead_col;

-- Test fixture: ensure ada user CS, produk, dan campaign yang link ke produk
SELECT id, full_name, role FROM profiles WHERE role='cs' AND active=TRUE;
SELECT id, name, sku FROM products WHERE active=TRUE LIMIT 5;
SELECT id, campaign_name FROM campaigns WHERE active=TRUE;

-- Update 1 existing ad_spend row dengan meta_lead_count untuk test funnel
UPDATE ad_spend SET meta_lead_count = 25, conversions = 8
WHERE id = (SELECT id FROM ad_spend ORDER BY spend_date DESC LIMIT 1);

-- Insert dummy CS report (replace IDs sesuai produksi)
INSERT INTO daily_cs_report (
  organization_id, report_date, cs_id, product_id, lead_in, closing
)
SELECT 1, CURRENT_DATE,
  (SELECT id FROM profiles WHERE role='cs' LIMIT 1),
  p.id, 100, 25
FROM products p WHERE p.active=TRUE LIMIT 1
ON CONFLICT (organization_id, report_date, cs_id, product_id) DO UPDATE
  SET lead_in = EXCLUDED.lead_in, closing = EXCLUDED.closing;
```

## Test `/cs-report` page (login as CS)

- [ ] Buka `/cs-report` → header "Laporan Harian CS", date picker default today, CS field auto-set ke profile.full_name (read-only)
- [ ] 3 stat cards di top: Total Lead Masuk / Total Closing / Close Rate
- [ ] Empty state kalau belum ada produk: "Belum ada produk untuk hari ini"
- [ ] Tambah produk via Combobox di bottom → row baru muncul dengan badge "unsaved"
- [ ] Input lead_in 120, closing 30 → ✅ rate 25%, no error
- [ ] Input closing 150 (> lead 120) → ✅ error inline "Closing tidak boleh > lead masuk", row jadi pink, Save All disabled
- [ ] Fix closing 30, tambah 2 produk lain → totals real-time update
- [ ] Klik Save All → toast "X laporan disimpan"
- [ ] Reload page → data persist, badge "unsaved" hilang
- [ ] Edit angka existing row → Save All → upsert berhasil (1 row instead of 2)
- [ ] Combobox produk exclude yang sudah di-add (filtered)

## Test "Copy dari Kemarin" helper

```sql
-- Insert dummy laporan kemarin
INSERT INTO daily_cs_report (organization_id, report_date, cs_id, product_id, lead_in, closing)
SELECT 1, CURRENT_DATE - INTERVAL '1 day',
  (SELECT id FROM profiles WHERE role='cs' LIMIT 1),
  p.id, 50, 12
FROM products p WHERE p.active=TRUE LIMIT 2
ON CONFLICT (organization_id, report_date, cs_id, product_id) DO UPDATE
  SET lead_in = EXCLUDED.lead_in;
```

- [ ] Buka /cs-report (hari ini, fresh) → klik "Copy dari Kemarin"
- [ ] Toast: "2 produk ditambahkan dari [YYYY-MM-DD] (angka di-prefill, adjust sebelum save)"
- [ ] Row baru muncul (badge "unsaved") dengan angka kemarin → adjust → save
- [ ] Buka /cs-report di tanggal yang sudah ada row → "Copy dari Kemarin" cuma append produk yang BELUM ada (merge, not overwrite)

## Test owner/admin CS picker

- [ ] Login owner → buka /cs-report → header description "Mode edit untuk [CS Name]" kalau pilih CS lain
- [ ] Combobox CS muncul (bukan read-only badge)
- [ ] Pilih CS lain → data CS muncul
- [ ] Edit angka → Save → upsert dengan cs_id = CS lain (preserved)
- [ ] Delete row existing → ✅ allowed (owner override)

## Test RLS isolation

- [ ] Login CS A → /cs-report → sidebar shows "Laporan Harian"
- [ ] CS A bisa lihat report dia, tidak bisa lihat CS B di dropdown (no dropdown for cs role)
- [ ] CS A coba insert dengan cs_id = CS B → RLS reject (CHECK policy `cs_id = auth.uid()`)
- [ ] CS A coba delete row → RLS reject (delete owner/admin only)
- [ ] Owner/admin bisa lihat dan edit semua CS

## Test `/cs-dashboard` extension

- [ ] Login CS → /cs-dashboard
- [ ] Sebelumnya: 4 stat cards orders/revenue + komisi (Phase 4B)
- [ ] **Sekarang Phase 6 inject di atas**: 4 stat cards Lead Masuk / Closing / Close Rate / Avg Lead/Day
- [ ] Daily Lead Trend chart muncul (area chart: lead biru + closing emerald)
- [ ] Per-Produk Performance mini table (top 10 by lead)
- [ ] Footer: link ke /analytics tab Funnel
- [ ] Empty state kalau belum ada CS report di periode: "Belum ada laporan CS — klik Input Laporan"

## Test `/analytics` Tab Funnel (owner only)

- [ ] Buka /analytics → Tab Funnel muncul di tab list (ke-7)
- [ ] Tabel 14 kolom: Produk / Spend / Meta Lead / CS Lead / Var L / CS Close / Sys Orders / Var C / Sys Diterima / Revenue / CPL Meta / CPO / Close% CS / ROAS
- [ ] Per row: presence indicators ●Meta ●CS ●Sys (color-coded)
- [ ] Variance Lead (CS - Meta): positive = blue, negative = orange, 0 = muted
- [ ] Variance Closing (Sys - CS Closing): positive = amber (CS lupa input), negative = red, 0 = muted
- [ ] Cells dengan no-data tampil "—" bukan "0"
- [ ] Sortable: Spend / ROAS / Close% CS / Var L (abs) / Var C (abs)
- [ ] **Highlights section di atas tabel** (3 cards conditional):
  - 💡 Banyak Organic (CS Lead > Meta Lead) — biru, top 3
  - ⚠️ CS Lupa Input Order — amber, top 3
  - ✅ Top Close Rate CS — emerald, top 3 (min 10 lead untuk filter noise)
- [ ] Empty state kalau no data: "Belum ada data di periode ini"

## Test funnel edge cases

| Sumber data | Expected behavior |
|---|---|
| Meta only (no CS, no orders) | Row muncul, CS+Sys columns "—", variance "—" |
| CS only (no Meta, no orders) | Row muncul, Meta column "—" |
| Orders only (no Meta, no CS) | Row muncul, all variance "—" |
| Meta + CS, no orders | Var Lead computed, Var Close "—" |
| All 3 sources | Semua kolom + variance terisi |

## Test migration idempotency

```bash
# Re-run migration 022
python3 -c "
import json, urllib.request
sql=open('src/lib/supabase/migrations/022_cs_daily_report.sql').read()
env={l.split('=',1)[0].strip():l.split('=',1)[1].strip() for l in open('.env.local') if '=' in l and not l.startswith('#')}
req=urllib.request.Request(env['NEXT_PUBLIC_SUPABASE_URL']+'/rest/v1/rpc/exec_sql',
  data=json.dumps({'sql':sql}).encode(),
  headers={'apikey':env['SUPABASE_SERVICE_ROLE_KEY'],'Authorization':'Bearer '+env['SUPABASE_SERVICE_ROLE_KEY'],'Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
"
```

- [ ] Status: "ok" — no errors
- [ ] Existing daily_cs_report rows tetap utuh
- [ ] ad_spend.meta_lead_count tetap NULL untuk pre-existing rows (acceptable, akan di-update saat re-upload CSV)

## Cleanup pre-test data (kalau perlu)

```sql
-- WARNING: hapus dummy test data, bukan real data
DELETE FROM daily_cs_report
WHERE report_date IN (CURRENT_DATE, CURRENT_DATE - INTERVAL '1 day')
  AND lead_in IN (50, 100);
```
