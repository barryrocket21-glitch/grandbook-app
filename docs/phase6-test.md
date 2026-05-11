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

## Test `/analytics` Tab Funnel (owner only) — Phase 6 UI polish (card-based)

**Layout baru: card-based per produk, bukan tabel datar 12-kolom.**

### Top section: 3 quick insight cards (horizontal grid)
- [ ] **Top Performer** (emerald) — nama produk + close rate (filter min 10 lead untuk noise control). Empty fallback "Belum ada produk dengan ≥10 lead di periode ini."
- [ ] **Need Attention** (amber) — produk dengan ROAS terendah (filter spend > 0). Color KPI red kalau ROAS < 1. Empty fallback kalau no spend.
- [ ] **Net Profit Periode** (violet kalau positif, red kalau negatif) — total revenue − total spend. Subtitle "simplified — belum include HPP/komisi/op expenses".

### Per produk card (1 card per produk; desktop xl≥1280 = 2 columns)
- [ ] Header: nama produk + kategori badge + status badge (Healthy/Warning/Critical) + ●Meta/●CS/●Sys presence dots
- [ ] KPI right (1 angka besar):
  - Kalau spend > 0: tampil **ROAS** (color ≥2 emerald, 1-2 amber, <1 red)
  - Kalau no spend: tampil **Close Rate %** (color ≥30% emerald, 10-30% amber, <10% red)
- [ ] 3 mini metric cards (gray bg): Spend / Revenue / Close Rate (atau "—" kalau no data)
- [ ] **Funnel visual** — 4 boxes horizontal:
  - Meta Lead (bg #F1EFE8 / dark #2C2C2A)
  - CS Lead (bg #EAF3DE / dark #173404)
  - CS Close (bg #E1F5EE / dark #04342C)
  - System Order (bg #FAEEDA / dark #412402)
  - Opacity 0.5 + "no data" subtitle kalau no data di layer tsb
  - Mobile: horizontal scrollable (overflow-x-auto)
- [ ] **Variance arrows antar box**:
  - Meta → CS Lead: `+X organic` (green) atau `-X Meta over` (red), hide kalau 0
  - CS Lead → CS Close: close rate `X%` color-coded
  - CS Close → System Order: `+X` (green) atau `-X backlog` (amber)
- [ ] **Insight box** (bottom) dengan icon bulb + auto-generated message:
  - Priority 1: `Backlog CS` kalau variance_closing < -5
  - Priority 2: `ROAS Loss` kalau roas < 1 dengan spend
  - Priority 3: `Close Rate Rendah` kalau close_rate < 10 dengan min 5 lead
  - Priority 4: `Meta Lead Hilang` kalau spend > 0 tapi meta_lead = 0
  - Priority 5: `Excellent` kalau close_rate ≥ 50 dengan min 10 lead
  - Default: `Funnel Sehat`
  - Background tint match status (red/amber/green)
- [ ] Empty state (no funnel data): "Belum ada data funnel untuk periode ini. Pastikan ada ad_spend, daily_cs_report, atau orders dalam date range."

## Test funnel edge cases (per card)

| Sumber data | Expected behavior |
|---|---|
| Meta only (no CS, no orders) | Card tampil, CS+System boxes "—", variance arrows hide |
| CS only (no Meta, no orders) | Meta box "—", funnel arrow Meta→CS hide variance |
| Orders only (no Meta, no CS) | Hanya System box ada angka, lainnya "—" |
| Meta + CS, no orders | Var Lead computed, System box "—", insight "Backlog?" kalau ada |
| All 3 sources, ROAS < 1 | Status CRITICAL, KPI red, insight "ROAS Loss" |
| All 3 sources, close rate ≥50% + ≥10 lead | Status HEALTHY, insight "Excellent" |
| variance_closing < -5 | Status WARNING, insight "Backlog CS" priority 1 |

## Test responsive

- [ ] Desktop (≥1280px / xl): card grid 2 columns
- [ ] Tablet (768-1023): card grid 1 column, funnel boxes horizontal
- [ ] Mobile (<768): card grid 1 column, **funnel boxes horizontal scrollable** (swipe to reveal 4th box kalau perlu)

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
