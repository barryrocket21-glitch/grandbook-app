# Phase 4B — Analytics Revamp + Per-Role Dashboards — Manual Smoke Test

> Engine + UI yang dibangun di Phase 4B:
> - Migration `017_analytics_aggregations.sql` — 5 RPCs (analytics_overview, daily_revenue, per_cs, per_advertiser, per_channel). Server-side aggregation supaya tidak transfer banyak rows ke browser.
> - `src/lib/supabase/queries/analytics.ts` — RPC wrappers + `fetchPersonalDashboard()` untuk personal-stats query.
> - `src/components/analytics/personal-dashboard.tsx` — shared component reuse di /cs-dashboard + /adv-dashboard. Owner-mode dengan dropdown filter user.
> - `/analytics` — refactor dari banner. 4 tabs (Overview / Per CS / Per Advertiser / Per Channel) + recharts (area + pie + bar).
> - `/cs-dashboard`, `/adv-dashboard` — refactor dari banner. Thin wrapper di atas PersonalDashboard.
> - `/dashboard` (existing) — sudah pakai schema baru (CANCEL/FAKE filter), tidak diubah.
>
> Migration 017 sudah auto-applied via `exec_sql` saat dev. Branch base: `phase-4a-commission`.

## 0. Pre-flight

- [ ] Migration 017 applied. Verifikasi 5 RPCs:
  ```sql
  SELECT proname FROM pg_proc WHERE proname IN
    ('analytics_overview', 'analytics_daily_revenue', 'analytics_per_cs',
     'analytics_per_advertiser', 'analytics_per_channel');
  ```
  Expect: 5 rows.
- [ ] Test RPC dengan service role context (returns 0 karena tidak ada org context):
  ```sql
  SELECT * FROM analytics_overview('2026-04-01'::DATE, '2026-05-31'::DATE);
  ```

## 1. Pre-test seed data

Phase 4A backfill membuat 2 ESTIMATED commissions untuk 2 order existing dengan advertiser_id. Untuk analytics yang lebih meaningful, butuh data beragam. Setup minimal:

```sql
-- Pastikan ada user role 'cs' dan 'advertiser' aktif. Cek:
SELECT id, full_name, role FROM profiles WHERE role IN ('cs','advertiser') AND active=TRUE;

-- Kalau belum ada, bikin via /settings/users.

-- Seed dummy orders dengan berbagai status (commissions auto-compute via trigger Phase 4A)
DO $$
DECLARE
  v_cs_id UUID;
  v_adv_id UUID;
  v_owner_id UUID;
  v_channel_id BIGINT;
BEGIN
  SELECT id INTO v_cs_id FROM profiles WHERE role='cs' AND active=TRUE LIMIT 1;
  SELECT id INTO v_adv_id FROM profiles WHERE role='advertiser' AND active=TRUE LIMIT 1;
  SELECT id INTO v_owner_id FROM profiles WHERE role='owner' LIMIT 1;
  SELECT id INTO v_channel_id FROM courier_channels WHERE code='SPX_DIRECT' LIMIT 1;

  IF v_cs_id IS NULL OR v_adv_id IS NULL THEN
    RAISE NOTICE 'Pre-test setup butuh minimal 1 user cs + 1 user advertiser aktif. Bikin di /settings/users dulu.';
    RETURN;
  END IF;

  INSERT INTO orders (
    organization_id, order_number, customer_name, customer_phone,
    payment_method, total, subtotal, shipping_cost, status, channel_id,
    cs_id, advertiser_id, created_by, order_date
  )
  SELECT 1,
    'GB-TEST-AN-' || lpad(g::text, 3, '0'),
    'Customer ' || g,
    '081234500' || lpad(g::text, 3, '0'),
    'COD',
    100000 + (g * 10000),
    90000 + (g * 9000),
    10000 + (g * 1000),
    -- 5 DITERIMA, 3 RETUR, 2 DIKIRIM
    CASE WHEN g <= 5 THEN 'DITERIMA'::text
         WHEN g <= 8 THEN 'RETUR'::text
         ELSE 'DIKIRIM'::text END,
    v_channel_id, v_cs_id, v_adv_id, v_owner_id,
    CURRENT_DATE - (g - 1)
  FROM generate_series(1, 10) g
  ON CONFLICT DO NOTHING;
END $$;
```

## 2. /analytics (login owner)

- [ ] Buka `/analytics` → page tampil tanpa error
- [ ] Date range picker default ke "Bulan ini"
- [ ] Tab Overview default aktif
- [ ] **Stat cards row 1:** Total Orders, Revenue, COGS, Gross Profit
  - Numbers match SQL: `SELECT * FROM analytics_overview(<from>, <to>);`
- [ ] **Stat cards row 2:** Komisi Earned, Komisi Paid, Shipping Diff, Total Payout
- [ ] **Daily Revenue chart** (area chart, ungu) — render kalau ada > 0 hari
- [ ] **Order Status Distribution** pie chart — colored slices per status, legend di samping
- [ ] Switch tab "Per CS" → table dengan kolom: CS, Orders, Revenue, Diterima, Retur, Conv %, Komisi Earned, Komisi Paid
- [ ] Klik header "Revenue" / "Conv %" → table re-sort
- [ ] Top 5 CS bar chart (horizontal) tampil di bawah table
- [ ] Switch tab "Per Advertiser" → table & bar chart untuk advertiser
- [ ] Switch tab "Per Channel" → table dengan shipping_diff (positive=hijau, negative=merah)

## 3. Date range presets

- [ ] Klik picker → preset list muncul (Hari ini, 7 hari terakhir, Bulan ini, Bulan lalu, dll)
- [ ] Pilih "Bulan lalu" → angka berubah (atau 0 kalau belum ada data bulan lalu)
- [ ] Pilih custom "Dari/Sampai" → re-fetch
- [ ] Refresh button (RefreshCw icon) → re-fetch tanpa ubah range

## 4. Empty state

- [ ] Pilih date range yang tidak ada order (misal tahun 2024) → empty state tampil:
  > "Belum ada order di periode ini"

## 5. /cs-dashboard (login as cs)

- [ ] Buka `/cs-dashboard` → page tampil
- [ ] Header: "Performance CS — Saya" (bukan "Pilih CS dari dropdown" karena bukan owner)
- [ ] Date range picker default "Bulan ini"
- [ ] Stat cards: Total Orders, Revenue, Diterima (+ conv rate), Retur, Komisi Earned, Komisi Paid
- [ ] Numbers match SQL:
  ```sql
  SELECT count(*), SUM(total) FROM orders WHERE cs_id=auth.uid() AND order_date BETWEEN '<from>' AND '<to>';
  ```
- [ ] Daily chart "Daily Orders" — area chart dengan 2 series (orders ungu, diterima hijau)
- [ ] Table 10 order terbaru — kolom Order#/Tanggal/Customer/Status/Total/Komisi
- [ ] Komisi cell tampil amount + status badge (EARNED/PAID/ESTIMATED)
- [ ] Login sebagai CS lain → angka beda (data isolated)

## 6. /cs-dashboard (login as owner)

- [ ] Buka `/cs-dashboard` → header punya dropdown Combobox di kiri date picker
- [ ] Empty state awal: "Pilih CS dari dropdown atas"
- [ ] Pilih CS X → data CS X tampil
- [ ] Pilih CS Y → data switch ke CS Y
- [ ] Empty hint kalau tidak ada CS terdaftar: link ke `/settings/users`

## 7. /adv-dashboard

- [ ] Login as advertiser → tampil personal stats sesuai pola CS dashboard
- [ ] Login as owner → ada dropdown filter advertiser
- [ ] Numbers match SQL:
  ```sql
  SELECT count(*), SUM(total) FROM orders WHERE advertiser_id=auth.uid() AND order_date BETWEEN '<from>' AND '<to>';
  ```

## 8. Permission gate

- [ ] Login as cs → buka `/adv-dashboard` → permission denied
- [ ] Login as advertiser → buka `/cs-dashboard` → permission denied
- [ ] Login as akunting → buka `/analytics` → permission denied (owner-only)

## 9. Sidebar visibility

- [ ] Owner: Analytics + ADV (group) + CS (group) semua tampil
- [ ] CS: hanya CS group tampil (tanpa Analytics, tanpa ADV)
- [ ] Advertiser: hanya ADV group tampil (tanpa Analytics, tanpa CS)
- [ ] Admin: ADV + CS group tampil (tanpa Analytics — owner only)
- [ ] Akunting: tidak ada group analytics, ADV, atau CS

## 10. /dashboard (existing — sanity check)

- [ ] Buka `/dashboard` (owner) → masih jalan tanpa error
- [ ] Stat cards omzet menggunakan filter `CANCEL/FAKE` (bukan status enum lama)
- [ ] Charts render (kalau ada data)
- [ ] Tidak ada query yang reference `duplicate_of` (sudah dropped Phase 1)

## 11. Cleanup test data

```sql
DELETE FROM orders WHERE order_number LIKE 'GB-TEST-AN-%';
-- Commissions auto-cleanup via FK CASCADE (added Phase 4A)
```

## 12. Build / type check

- [ ] `npx tsc --noEmit` → no errors
- [ ] `npm run build` → success, `/analytics` + `/cs-dashboard` + `/adv-dashboard` ke-list (semua organic, bukan banner)

## Catatan implementasi

### Migration 017 design
- 5 RPCs semua `STABLE SECURITY DEFINER` — server-side aggregation lebih efisien daripada `select *` lalu reduce di client.
- Date filtering pakai `BETWEEN p_from AND p_to` (inclusive) di kolom `orders.order_date` (DATE type — no timezone).
- Per-CS / Per-Advertiser pakai CTE `cs_orders` + `cs_agg` + `cs_comm` supaya commission lookup tidak nested loop (lebih cepat untuk volume besar).
- Conversion rate: `diterima / (diterima + retur)` — denominator hanya order final (DITERIMA + RETUR), bukan total orders. Order DIKIRIM/PROBLEM tidak counted (belum final).

### UI patterns
- DateRangePicker existing dari Phase 0, reuse — sudah ada preset "Bulan ini" / "Bulan lalu" / "30 hari terakhir" / dll.
- Recharts pie label dipakai default (tooltip) — custom label callback typing sulit di Recharts v3 (TS strict).
- Stat cards punya 7 color variants (blue/amber/emerald/zinc/violet/red/orange) — `red` muncul saat shipping_diff atau gross profit negative.
- PersonalDashboard reuse di /cs-dashboard + /adv-dashboard via thin wrapper — diff cuma `role` prop ('cs' vs 'advertiser') + label.

### Hydration drift fix
- Range picker pakai `setRange(thisMonth())` di useEffect (bukan inline init) supaya server & client first render identical. `rangeReady` flag mencegah fetch sebelum client value resolved.

### Hal yang flag untuk Phase 4C (Pencairan COD Reconciliation)

- **Realtime**: Phase 4B masih manual refresh button. Phase 4C bisa add Supabase realtime subscription supaya commission/order changes auto-reflect di dashboard.
- **Export PDF/Excel**: scope explicitly TIDAK di Phase 4B. Owner perlu manual screenshot atau copy table.
- **Product-level analytics**: top seller produk tidak di-cover. Bisa ditambah di Phase 5.
- **Mobile responsive**: charts ResponsiveContainer width 100% jadi resize OK, tapi table lebar bisa overflow. Mobile user fallback scroll horizontal.
- **Drill-down**: klik row di tabel Per CS → buka /commissions/manage filter user X — bisa improvement di Phase 4C/5.
- **Cache**: tidak ada caching — refetch semua tab saat date range berubah. Untuk dataset besar, butuh per-tab lazy fetch atau React Query.
