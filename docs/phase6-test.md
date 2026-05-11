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

## Test `/analytics` — Phase 6 redesign (sidebar nav, owner only)

**Layout baru: sidebar nav (Notion/Linear style), bukan tabs. Funnel tab standalone DIHAPUS → pindah ke detail page per produk.**

### Sidebar nav (desktop ≥768px)
- [ ] Buka `/analytics` → default load section **Overview**
- [ ] Sidebar kiri (width 176-192px) dengan 4 groups: Bisnis, Produk, Tim, Marketing
- [ ] Item nav: icon + label, active state bg-violet/10 text-violet
- [ ] Klik item → URL update ke `/analytics?section=<key>`, section state sync
- [ ] Refresh page dengan `?section=produk` → langsung load Per Produk section
- [ ] Browser back/forward sync (URL ↔ state via useSearchParams)

### Sidebar nav (mobile <768px)
- [ ] Pill bar horizontal scrollable di top (replace sidebar)
- [ ] Tap pill → switch section

### Section: Overview (`?section=overview`)
- [ ] Breadcrumb "Analytics / Bisnis" + title "Overview"
- [ ] Row 1: Orders / Revenue / COGS / Gross Profit
- [ ] Row 2: Komisi Earned / Paid / Shipping Diff / Total Payout
- [ ] Row 3 Phase 4C: Est Cost / Cash In / Profit / Margin %
- [ ] Row 4 Phase 5A+5B: Op Expenses / Ad Spend / Net Before / Net After / Net Margin
- [ ] Daily Revenue area chart + Status Distribution pie

### Section: Per Channel (`?section=channel`)
- [ ] Tabel 8 kolom dengan billing_model sub-row, shipping diff color-code
- [ ] Footer note Phase 4C profit formula

### Section: Per Produk (`?section=produk`) — NEW
- [ ] Tabel sortable kolom: Produk / Revenue / CS Lead / Closing / Close % / ROAS / Aksi
- [ ] "—" untuk cell tanpa data (vs "0" eksplisit)
- [ ] Sortable: Revenue (default desc), CS Lead, Closing, Close %, ROAS
- [ ] Per row tombol **"Detail →"** → klik navigate ke `/analytics/produk/[id]`
- [ ] Empty state kalau no produk data di periode

### Section: Per CS (`?section=cs`)
- [ ] Reuse existing Phase 4B PerUserTable + Top 5 CS chart

### Section: Per Advertiser (`?section=adv`)
- [ ] Reuse existing Phase 4B PerUserTable kind="advertiser"

### Section: ROAS per Campaign (`?section=campaign`)
- [ ] Reuse Phase 5B RoasPerCampaignTable + Top 10 by ROAS chart

### Detail page: `/analytics/produk/[id]` — NEW
- [ ] Breadcrumb "← Per Produk / [Nama Produk]"
- [ ] Title produk + kategori badge + SKU
- [ ] DateRangePicker + refresh button
- [ ] **Section 1 — 4 stat cards horizontal**: Spend / Revenue / Close Rate / ROAS, color-coded sesuai threshold
- [ ] **Section 2 — Funnel visual compact**: 4 boxes (Meta Lead → CS Lead → CS Close → System Order) dengan arrows + variance values. Color spec hardcoded sesuai mockup
  - Mobile: horizontal scrollable
- [ ] **Section 3 — Performa CS per produk**: tabel CS / Lead / Closing / Close % (sort by closing DESC default)
  - Empty state "Belum ada laporan CS untuk produk ini di periode"
- [ ] **Section 4 — Campaign Iklan untuk produk ini**: tabel Campaign / Platform / Alloc % / Spend / Conv / ROAS
  - Empty state "Belum ada campaign linked"
- [ ] **Section 5 — Insight compact**: lightbulb icon + keyword bold + message kontekstual (priority logic: Backlog CS / ROAS Loss / Close Rate Rendah / Meta Lead Hilang / Excellent / Funnel Sehat)
- [ ] Empty state full page kalau produk tidak ada data sama sekali

## Test edge cases — detail page

| Sumber data | Expected behavior |
|---|---|
| Meta only | Box CS+System "—", Section 3 + 4 empty states |
| CS only | Box Meta "—", Section 4 empty (no campaigns) |
| Orders only | Section 3 empty (no CS report), Section 4 empty kalau no link |
| All 3 sources, ROAS < 1 | Insight "ROAS Loss" red tint |
| variance_closing < -5 | Insight "Backlog CS" amber tint |

## Test responsive

- [ ] Desktop (≥1024px): sidebar visible left, content right flex-1
- [ ] Tablet (768-1023): sidebar visible (width 176px lg=192px), content flex-1
- [ ] Mobile (<768): sidebar → pill bar horizontal scroll di top, content full-width
- [ ] Detail page funnel boxes horizontal scrollable kalau viewport sempit

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
