# Phase 4C — Estimated Cost Engine + Multi-Model Billing — Manual Smoke Test

> Engine + UI yang dibangun di Phase 4C:
> - Migration `018_billing_models.sql` — extends courier_channels (billing_model + label), adds `channel_billing_config` table, adds 7 estimated_* columns ke orders, 4 RPCs (`get_active_rate`, `get_active_billing_config`, `compute_order_costs`, updated `analytics_overview` & `analytics_per_channel`), trigger on orders, seed SPX_DIRECT defaults (40/1/12 + NOMINAL_COD/FLOOR/COD_FEE_ONLY), backfill compute existing orders.
> - `src/lib/cost/calculator.ts` — TypeScript mirror dari `compute_order_costs` SQL untuk client-side preview calculator.
> - `src/lib/supabase/queries/billing-config.ts` — wrapper queries (`fetchChannelCostBundle`, `upsertBillingConfig`, `recomputeOrderCosts`, dst).
> - `src/lib/schemas/settings.ts` — appended `channelBillingConfigSchema` + 4 enum/label sets (BILLING_MODEL/COD_FEE_BASE/COD_FEE_ROUNDING/PPN_APPLIED).
> - `/settings/courier-rates` — extended dengan **BillingConfigPanel** (channel picker, billing model + categorical config + numeric rates summary, **Preview Cost Calculator**).
> - `/orders/[id]` — tab baru **Cost & Profit** (role-gated owner+admin), breakdown estimasi + recompute button.
> - `/analytics` — Overview tambah row 3 stat cards (Estimated Total Cost / Cash In / Profit / Margin %). Per Channel tab tambah kolom Est. Cost / Cash In / Profit / Margin %.
>
> Migration 018 sudah auto-applied via `exec_sql` saat dev. Branch base: `phase-4b-analytics`.

## 0. Pre-flight

- [ ] Migration 018 applied. Verifikasi:
  ```sql
  -- Functions
  SELECT proname FROM pg_proc WHERE proname IN
    ('get_active_rate', 'get_active_billing_config', 'compute_order_costs', 'trigger_compute_order_costs');
  -- Trigger
  SELECT tgname FROM pg_trigger WHERE tgname='trg_compute_order_costs';
  -- Estimated columns
  SELECT column_name FROM information_schema.columns
   WHERE table_name='orders' AND column_name LIKE 'estimated_%';
  -- channel_billing_config table
  SELECT column_name FROM information_schema.columns
   WHERE table_name='channel_billing_config';
  ```
- [ ] SPX_DIRECT seed:
  ```sql
  SELECT id, code, billing_model, shipping_discount_label
   FROM courier_channels WHERE code='SPX_DIRECT';
  -- Expect: billing_model='MONTHLY_INVOICE', label='Cashback Ongkir'
  SELECT rate_key, rate_value FROM courier_channel_rates
   WHERE channel_id=(SELECT id FROM courier_channels WHERE code='SPX_DIRECT')
     AND rate_key IN ('shipping_discount_rate','cod_fee_rate','ppn_rate');
  -- Expect: 0.40, 0.01, 0.12
  SELECT cod_fee_base, cod_fee_rounding, ppn_applied_to FROM channel_billing_config
   WHERE channel_id=(SELECT id FROM courier_channels WHERE code='SPX_DIRECT');
  -- Expect: NOMINAL_COD, FLOOR, COD_FEE_ONLY
  ```

## 1. Pre-test seed: dummy SPX order

```sql
INSERT INTO orders (
  organization_id, order_number, customer_name, customer_phone,
  payment_method, total, subtotal, shipping_cost, status, channel_id,
  cs_id, created_by
) VALUES (
  1, 'GB-TEST-COST-001', 'Test Cost SPX', '081234500700',
  'COD', 150000, 135000, 15000, 'BARU',
  (SELECT id FROM courier_channels WHERE code='SPX_DIRECT' LIMIT 1),
  (SELECT id FROM profiles WHERE role='cs' AND active=TRUE LIMIT 1),
  (SELECT id FROM profiles WHERE role='owner' LIMIT 1)
)
ON CONFLICT (organization_id, order_number) DO NOTHING;
```

## 2. Trigger compute on insert

- [ ] Setelah INSERT (status BARU), cek estimated_* terhitung:
  ```sql
  SELECT estimated_shipping_net, estimated_cod_fee, estimated_ppn,
         estimated_total_cost, estimated_cash_in, estimated_profit, cost_computed_at
  FROM orders WHERE order_number = 'GB-TEST-COST-001';
  ```
  Expected (status=BARU, COD=150k, ongkir=15k, NO HPP, NO komisi, MONTHLY_INVOICE):
  - shipping_net = **9000** (15000 × 0.6)
  - cod_fee = **1500** (floor 0.01 × 150000)
  - ppn = **180** (0.12 × 1500)
  - total_cost = **10680**
  - cash_in = **150000** (MONTHLY_INVOICE = COD cair full)
  - profit = **150000 − 0 − 0 − 10680 = 139320** (no HPP/komisi)

## 3. Trigger re-compute saat status / shipping_cost_actual change

- [ ] Update status ke DITERIMA → trigger fire → estimated_* re-compute (commission jadi EARNED → akan masuk profit calc)
- [ ] Update shipping_cost_actual=12000 → trigger fire → shipping_net = 12000×0.6 = 7200, total_cost recalc

## 4. Multi-model

```sql
-- Setup channel B = NETT_OFF
UPDATE courier_channels SET billing_model='NETT_OFF_PER_ORDER' WHERE code='JNE_VIA_MENGANTAR';
INSERT INTO courier_channel_rates (channel_id, rate_key, rate_value, effective_from)
SELECT id, 'shipping_discount_rate', 0.30, '2026-01-01'::DATE FROM courier_channels WHERE code='JNE_VIA_MENGANTAR'
ON CONFLICT (channel_id, rate_key, effective_from) DO UPDATE SET rate_value=EXCLUDED.rate_value;
INSERT INTO courier_channel_rates (channel_id, rate_key, rate_value, effective_from)
SELECT id, 'cod_fee_rate', 0.015, '2026-01-01'::DATE FROM courier_channels WHERE code='JNE_VIA_MENGANTAR'
ON CONFLICT (channel_id, rate_key, effective_from) DO UPDATE SET rate_value=EXCLUDED.rate_value;
INSERT INTO courier_channel_rates (channel_id, rate_key, rate_value, effective_from)
SELECT id, 'ppn_rate', 0.12, '2026-01-01'::DATE FROM courier_channels WHERE code='JNE_VIA_MENGANTAR'
ON CONFLICT (channel_id, rate_key, effective_from) DO UPDATE SET rate_value=EXCLUDED.rate_value;
INSERT INTO channel_billing_config (channel_id, cod_fee_base, cod_fee_rounding, ppn_applied_to, effective_from)
SELECT id, 'NOMINAL_COD', 'FLOOR', 'COD_FEE_ONLY', '2026-01-01'::DATE FROM courier_channels WHERE code='JNE_VIA_MENGANTAR'
ON CONFLICT (channel_id, effective_from) DO UPDATE SET cod_fee_base=EXCLUDED.cod_fee_base;

-- Insert order pakai channel B
INSERT INTO orders (organization_id, order_number, customer_name, payment_method, total, subtotal,
  shipping_cost, status, channel_id, cs_id, created_by) VALUES (
  1, 'GB-TEST-COST-NETT', 'Test Cost Mengantar', 'COD', 200000, 180000, 20000, 'DITERIMA',
  (SELECT id FROM courier_channels WHERE code='JNE_VIA_MENGANTAR'),
  (SELECT id FROM profiles WHERE role='cs' AND active=TRUE LIMIT 1),
  (SELECT id FROM profiles WHERE role='owner' LIMIT 1)
);
```

- [ ] Verify NETT_OFF: cash_in = total − total_cost (sudah dipotong)
  ```sql
  SELECT estimated_total_cost, estimated_cash_in, estimated_profit
   FROM orders WHERE order_number='GB-TEST-COST-NETT';
  -- shipping_net = 20000 × 0.7 = 14000
  -- cod_fee = floor(200000 × 0.015) = 3000
  -- ppn = 3000 × 0.12 = 360
  -- total_cost = 17360
  -- cash_in = 200000 − 17360 = 182640
  -- profit = 182640 − HPP − komisi (NETT_OFF: cash_in already nett, no extra deduction)
  ```

- [ ] Test DIRECT_TRANSFER: order TRANSFER → cash_in = total
- [ ] Test NO_RECONCILIATION: cash_in = total kalau COD, default fields tetap di-compute walau cost simbolis

## 5. PPN config variants

- [ ] Update channel SPX → PPN_APPLIED_TO = `COD_FEE_PLUS_SHIPPING`:
  ```sql
  UPDATE channel_billing_config SET ppn_applied_to='COD_FEE_PLUS_SHIPPING'
   WHERE channel_id=(SELECT id FROM courier_channels WHERE code='SPX_DIRECT') AND effective_to IS NULL;
  ```
- [ ] Trigger order recompute → ppn = (cod_fee + shipping_net) × 0.12 = (1500 + 9000) × 0.12 = 1260
- [ ] Set ke `NONE` → ppn = 0
- [ ] Restore ke COD_FEE_ONLY supaya tidak ganggu test selanjutnya

## 6. Rounding variants

- [ ] Test rounding dengan nominal 156350 (raw fee = 1563.5):
  - FLOOR → 1563
  - ROUND → 1564
  - CEIL → 1564

## 7. Rate versioning

- [ ] Tambah rate baru `cod_fee_rate=0.02` effective_from='2026-06-01' untuk SPX
- [ ] `get_active_rate(spx, 'cod_fee_rate', '2026-05-01')` → 0.01 (rate lama)
- [ ] `get_active_rate(spx, 'cod_fee_rate', '2026-06-15')` → 0.02 (rate baru)
- [ ] Rate lama `effective_to` auto-set saat upsert via UI? Note: UI courier-rates existing pakai prompt confirm. RPC engine pakai `effective_from <= date AND (effective_to IS NULL OR effective_to >= date)` jadi range tetap correct.

## 8. UI Settings courier-rates — BillingConfigPanel

- [ ] Buka `/settings/courier-rates` → BillingConfigPanel muncul di atas
- [ ] Pilih channel SPX_DIRECT
- [ ] Form populated:
  - Billing Model: MONTHLY_INVOICE (label panjang)
  - Display Label: "Cashback Ongkir"
  - Numeric rates summary: 40% / 1% / 12%
  - Categorical: NOMINAL_COD / FLOOR / COD_FEE_ONLY
- [ ] Edit Display Label → "Cashback SPX" → klik Simpan Channel Meta → toast sukses
- [ ] Edit Categorical (e.g. ROUND) → Simpan Config Period → period baru ditambah, period lama auto-set effective_to
- [ ] Preview Calculator:
  - Default input: COD 150k / subtotal 135k / ongkir 15k / HPP 50k / komisi 0
  - Output: shipping_net 9000, cod_fee 1500, ppn 180, total_cost 10680, cash_in 150000, profit 89320 (150k − 50k HPP − 10680 cost)
  - Edit payment_method → TRANSFER (MONTHLY_INVOICE): cash_in = 0 (no COD)
  - Edit total → 250000: shipping_net tetap (depends shipping_cost), cod_fee = 2500, dst.

## 9. UI Order Detail — Cost & Profit tab

- [ ] Login owner → buka order GB-TEST-COST-001 → tab "Cost & Profit" muncul (5th tab)
- [ ] Tab content:
  - Header: Channel SPX_DIRECT · Billing: Monthly Invoice
  - Refresh button (Recompute) di kanan
  - Order BARU/SIAP_KIRIM → warning "Estimasi belum final"
  - Breakdown box: Order Total, Shipping Gross/Net, COD Fee, PPN, Total Cost
  - Cash flow box: Cash In, Profit (bold + colored)
  - Footer: Computed at, Rates summary
- [ ] Klik Recompute → toast "Cost recomputed", angka refresh
- [ ] Login as CS → tab Cost & Profit hidden
- [ ] Login as advertiser → tab Cost & Profit hidden
- [ ] Order tanpa channel → tab tampil tapi message "Pilih channel ekspedisi"

## 10. UI Analytics breakdown

- [ ] Buka `/analytics` (owner) → Overview tab
- [ ] Stat cards row 3 muncul:
  - Estimated Total Cost (orange)
  - Estimated Cash In (violet)
  - Estimated Profit (emerald/red)
  - Profit Margin % (badge color berdasarkan threshold)
- [ ] Switch tab "Per Channel":
  - Kolom baru: Est. Cost, Cash In, Profit, Margin %
  - Channel SPX → billing_model "MONTHLY_INVOICE" tampil di sub-row
  - Profit color-coded (hijau/merah)
  - Margin badge: ≥10% emerald, ≥0% amber, <0% red

## 11. Cleanup test data

```sql
DELETE FROM orders WHERE order_number LIKE 'GB-TEST-COST-%';
-- Commissions auto-cleanup via FK CASCADE Phase 4A
-- Estimated_* columns kosong otomatis (orders di-delete)
```

## 12. Build / type check

- [ ] `npx tsc --noEmit` → no errors
- [ ] `npm run build` → success, semua route ke-list

## Catatan implementasi

### Schema design
- **`channel_billing_config` separate table** (bukan extend `courier_channels`) — supaya bisa version per period. SPX bisa ganti rounding atau PPN basis bulan depan tanpa migration; tinggal upsert config baru dengan `effective_from` baru.
- **Numeric rates di `courier_channel_rates`** (existing key-value table) — sudah perfect untuk versioning. Phase 4C tambah 3 keys spesifik: `shipping_discount_rate`, `cod_fee_rate`, `ppn_rate`.
- **Estimated columns di `orders`** (denormalized) — supaya analytics_per_channel + dashboard bisa SUM langsung tanpa JOIN ke config setiap query. Trade-off: trigger fire di setiap UPDATE, tapi tidak terlalu berat.

### Trigger ordering
- `trg_compute_order_costs` (Phase 4C) > `trg_compute_commissions` (Phase 4A) alphabetically.
- AFTER triggers run alphabetical, jadi commission row sudah inserted saat compute_order_costs baca commissions.

### compute_order_costs design
- ROUND ke 2 desimal di shipping_net + total_cost + cash_in + profit untuk konsistensi numeric storage NUMERIC(12,2).
- ppn pakai ROUND(...,2) sebelum di-store.
- cod_fee pakai FLOOR/ROUND/CEIL (per config) tanpa decimal — fee COD selalu rupiah penuh.
- Profit formula varies per billing_model (MONTHLY_INVOICE kurang cost, lainnya tidak).
- Channel NULL → reset estimated_* ke NULL (clear stale data).

### TypeScript calculator mirror
- `src/lib/cost/calculator.ts` mirror exact logic dari SQL — supaya Preview Calculator di Settings UI menghasilkan angka identik dengan trigger SQL. Kalau formula SQL berubah, calculator.ts juga harus update.

### Decisions yang saya ambil sendiri
1. **Brief inheritance behavior tidak konsisten** — brief mention `compute_order_costs` re-compute "saat status DITERIMA atau cost-related field berubah". Saya pakai trigger fire saat status/shipping/channel/total change. INSERT juga fire (supaya order baru langsung ada estimated_*). Channel NULL → reset estimated_*.
2. **Brief logic profit di MONTHLY_INVOICE** — brief tulis "profit = COD_cair - cost - hpp - komisi" untuk MONTHLY. Saya implement: profit = cash_in − hpp − commission − total_cost (cuma untuk MONTHLY_INVOICE; lainnya tidak kurang cost). Match brief.
3. **Categorical config separate table** vs hash numeric di rate_value — pilih separate table karena lebih clean + supports period versioning native.
4. **BillingConfigPanel di atas tabel rates existing** (bukan refactor jadi tabs) — minimum disruption. User existing flow tetap jalan.
5. **Cost & Profit tab role-gated via `canApprove`** (owner+admin) — sesuai brief "owner+admin bisa lihat".
6. **Analytics row 3 dipisah dari row 2** — Phase 4C semi-konseptual (estimasi, bukan actual). Visual separation lebih clear.
7. **`overflow-x-auto` di Per Channel table** — kolom 8 lebar, mobile butuh scroll horizontal. Phase 4B flag mention this.

### Hal yang flag untuk Phase 4D (Actual Reconciliation File Upload)

- **Upload file SPX/agregator** untuk match per-order actual cost vs estimated. Phase 4C cuma compute estimate dari config. Variance tracking (estimated vs actual) belum.
- **"Mark as Billed" / "Mark as Settled"** workflow untuk track tagihan SPX bulanan yang sudah dibayar.
- **Saldo tracking** — withdraw dari SPX dashboard ke rekening, balance running. Brief 4C explicitly skip ini.
- **Auto-detect bulan periode** dari file SPX — Phase 4D nanti.
- **Bulk recompute** kalau rate berubah retroaktif. Phase 4C trigger fire per order; bulk via `SELECT compute_order_costs(id) FROM orders` di SQL Editor.
- **PPN config rate update kalau Indonesia naik PPN** (12% sudah aktif sejak Jan 2025). Phase 4C support: tambah rate baru `ppn_rate=0.13` dengan effective_from baru.

### Suspicious behavior dari Phase sebelumnya
- Phase 3.5/4A/4B BELUM ditest user. Saat develop Phase 4C, integrasi /analytics + /orders/[id] + /settings/courier-rates semua kompatibel — no suspicious behavior ditemukan dalam scope yang saya gunakan.
