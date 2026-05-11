# Phase 4A — Commission Engine v2 + Pencairan UI — Manual Smoke Test

> Engine + UI yang dibangun di Phase 4A:
> - Migration `016_commission_v2.sql` — convert status enum→TEXT, add PAID + payment fields, FK to orders, compute_commissions, trigger, mark_commission_paid + bulk RPCs, backfill.
> - `src/lib/supabase/queries/commissions.ts` — listCommissions, computeStats, periodToDates, markCommissionPaid, bulkMarkCommissionPaid.
> - `src/lib/schemas/settings.ts` — appended `commissionPaymentSchema` + `COMMISSION_STATUS_LABEL/BADGE_COLOR` + `COMMISSION_PAYMENT_METHODS`.
> - `/commissions/my` — refactor dari banner. Stat cards + filter (period/status) + tabel.
> - `/commissions/manage` — refactor dari banner. Tabs (EARNED/PAID/ESTIMATED/ALL), filter (user/period/search), bulk action, mark paid dialog.
> - Sidebar Komisi sudah role-based (cs/advertiser lihat "Komisi Saya" only, owner lihat semua).
>
> Migration 016 sudah auto-applied via `exec_sql` saat dev (133 orphan commissions cleaned, 2 ESTIMATED backfilled untuk order existing dengan advertiser_id).

## 0. Pre-flight

- [ ] Migration 016 applied. Verifikasi function:
  ```sql
  SELECT proname FROM pg_proc WHERE proname IN
    ('compute_commissions', 'trigger_compute_commissions', 'mark_commission_paid', 'bulk_mark_commission_paid');
  ```
  Expect: 4 rows.
- [ ] Trigger ada di orders:
  ```sql
  SELECT tgname FROM pg_trigger WHERE tgname='trg_compute_commissions';
  ```
- [ ] Status CHECK constraint mengandung PAID:
  ```sql
  SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid
  WHERE t.relname='commissions' AND c.conname='commissions_status_check';
  ```
  Expect: `CHECK (status = ANY (ARRAY['ESTIMATED', 'EARNED', 'CANCELLED', 'PAID']))`
- [ ] FK to orders ada:
  ```sql
  SELECT conname FROM pg_constraint WHERE conname='commissions_order_id_fkey';
  ```

## 1. Pre-test setup

```sql
-- Pastikan commission_rule untuk role 'cs' ada (5% revenue)
INSERT INTO commission_rules (role, rule_type, value, active)
  VALUES ('cs', 'PERCENT_REVENUE', 5.0, true)
  ON CONFLICT DO NOTHING;

-- Pastikan ada user role 'cs' aktif. Cek:
SELECT id, full_name, role FROM profiles WHERE role='cs' AND active=true LIMIT 5;

-- Insert dummy order DITERIMA dengan cs_id
INSERT INTO orders (
  organization_id, order_number, customer_name, customer_phone,
  payment_method, total, subtotal, shipping_cost, status, channel_id,
  cs_id, created_by
) VALUES (
  1, 'GB-TEST-COMM-001', 'Test Komisi', '081234500099',
  'COD', 200000, 185000, 15000, 'DITERIMA',
  (SELECT id FROM courier_channels WHERE code='SPX_DIRECT' LIMIT 1),
  (SELECT id FROM profiles WHERE role='cs' AND active=true LIMIT 1),
  (SELECT id FROM profiles WHERE role='owner' LIMIT 1)
) ON CONFLICT (organization_id, order_number) DO NOTHING;
```

## 2. Trigger compute on insert

- [ ] Setelah INSERT, cek `commissions`:
  ```sql
  SELECT c.id, c.status, c.amount, p.full_name, o.order_number
  FROM commissions c
  JOIN profiles p ON p.id = c.user_id
  JOIN orders o ON o.id = c.order_id
  WHERE o.order_number = 'GB-TEST-COMM-001';
  ```
  Expect: 1 row, status=EARNED, amount=10000 (5% × 200000), user_id = CS yang dipilih.

## 3. Trigger re-compute on status change

- [ ] Update order ke RETUR:
  ```sql
  UPDATE orders SET status='RETUR' WHERE order_number='GB-TEST-COMM-001';
  ```
- [ ] Verify commission status:
  ```sql
  SELECT status FROM commissions WHERE order_id=(SELECT id FROM orders WHERE order_number='GB-TEST-COMM-001');
  ```
  Expect: `CANCELLED`
- [ ] Update order kembali ke DITERIMA → commission status kembali `EARNED` (re-compute jalan)

## 4. /commissions/my (login sebagai CS yang dipilih)

- [ ] Buka `/commissions/my`
- [ ] Stat cards:
  - Estimated: Rp 0 (kalau cuma ada GB-TEST-COMM-001)
  - Pending Pencairan (Earned): **Rp 10.000** (1 order)
  - Sudah Dicairkan: Rp 0
  - Cancelled: 0
- [ ] Tabel: 1 row dengan order# `GB-TEST-COMM-001`, customer "Test Komisi", status order DITERIMA, komisi Rp 10.000, status EARNED, paid at "-"
- [ ] Filter "Bulan Ini" (default) → tampil
- [ ] Filter "Custom" + range yang nggak include hari ini → 0 row
- [ ] Filter status "PAID" → 0 row
- [ ] Login sebagai CS lain → komisi user pertama nggak tampil (RLS)

## 5. /commissions/manage (login sebagai owner)

- [ ] Buka `/commissions/manage` → tab default "Pending Pencairan" (EARNED)
- [ ] Tampil 1 row commission GB-TEST-COMM-001
- [ ] Klik tombol "Pay" di kolom Aksi → dialog "Mark Komisi sebagai PAID" muncul
- [ ] Total komisi: 1 baris, total nilai: Rp 10.000
- [ ] Pilih Method = Transfer Bank, Reference = BCA-12345, Catatan = "Pencairan Mei test"
- [ ] Klik "Konfirmasi Pencairan" → toast "Komisi di-mark PAID", row hilang dari tab EARNED
- [ ] Switch tab "Paid" → row tampil dengan paid_at = waktu sekarang
- [ ] Verify SQL:
  ```sql
  SELECT status, paid_at, paid_by, payment_method, payment_reference, payment_note
  FROM commissions WHERE order_id=(SELECT id FROM orders WHERE order_number='GB-TEST-COMM-001');
  ```
  Expect: status=PAID, paid_at recent, paid_by=owner uid, payment_method='TRANSFER', payment_reference='BCA-12345', payment_note='Pencairan Mei test'

## 6. Bulk mark paid

```sql
-- Bikin 5 dummy order DITERIMA dengan cs_id terisi
INSERT INTO orders (
  organization_id, order_number, customer_name, payment_method, total, subtotal,
  shipping_cost, status, channel_id, cs_id, created_by
) SELECT
  1,
  'GB-TEST-COMM-' || lpad(generate_series::text, 3, '0'),
  'Bulk Test ' || generate_series, 'COD', 100000, 90000, 10000, 'DITERIMA',
  (SELECT id FROM courier_channels WHERE code='SPX_DIRECT' LIMIT 1),
  (SELECT id FROM profiles WHERE role='cs' AND active=true LIMIT 1),
  (SELECT id FROM profiles WHERE role='owner' LIMIT 1)
FROM generate_series(101, 105)
ON CONFLICT DO NOTHING;
```

- [ ] Buka `/commissions/manage` tab EARNED → 5 baris baru tampil (komisi Rp 5.000 each)
- [ ] Centang checkbox di header → 5 baris terpilih, banner "5 komisi terpilih" + tombol Bulk Mark Paid
- [ ] Klik Bulk Mark Paid → dialog (5 baris, total Rp 25.000)
- [ ] Konfirmasi → toast "5 komisi di-mark PAID"
- [ ] Tab EARNED kosong, tab PAID +5

## 7. Mark paid: hanya EARNED

- [ ] Insert dummy order status BARU (commission akan jadi ESTIMATED via trigger)
- [ ] `/commissions/manage` tab "Estimated" → row tampil
- [ ] Verify checkbox kolom **disabled** (only EARNED selectable)
- [ ] Verify tidak ada tombol "Pay" untuk row ESTIMATED — hanya "—"

## 8. PAID immutability

- [ ] Pilih order GB-TEST-COMM-001 yang sudah PAID
- [ ] Update status order ke RETUR:
  ```sql
  UPDATE orders SET status='RETUR' WHERE order_number='GB-TEST-COMM-001';
  ```
- [ ] Verify commission tetap PAID:
  ```sql
  SELECT status, paid_at FROM commissions
  WHERE order_id=(SELECT id FROM orders WHERE order_number='GB-TEST-COMM-001');
  ```
  Expect: status=PAID (tidak ke-CANCELLED), paid_at preserved

## 9. Rules priority

```sql
-- Bikin rule khusus user X (override default 5%)
INSERT INTO commission_rules (role, user_id, rule_type, value, active)
SELECT 'cs', id, 'PERCENT_REVENUE', 10.0, true
FROM profiles WHERE role='cs' AND active=true LIMIT 1;

-- Insert order baru dengan cs_id = user X
INSERT INTO orders (
  organization_id, order_number, customer_name, payment_method, total,
  subtotal, shipping_cost, status, channel_id, cs_id, created_by
) VALUES (
  1, 'GB-TEST-COMM-PRIO', 'Priority Test', 'COD', 100000, 90000, 10000,
  'DITERIMA', (SELECT id FROM courier_channels WHERE code='SPX_DIRECT' LIMIT 1),
  (SELECT id FROM profiles WHERE role='cs' AND active=true LIMIT 1),
  (SELECT id FROM profiles WHERE role='owner' LIMIT 1)
);
```

- [ ] Verify komisi pakai rate user-specific (10%, bukan default 5%):
  ```sql
  SELECT amount FROM commissions WHERE order_id=(SELECT id FROM orders WHERE order_number='GB-TEST-COMM-PRIO');
  ```
  Expect: 10000 (10% × 100000), bukan 5000

## 10. /settings/commission-rules sanity

- [ ] Buka `/settings/commission-rules` → semua rules tampil
- [ ] Tambah rule baru → muncul di list
- [ ] Edit rule → ke-update
- [ ] Display label user_name (bukan UUID) untuk rule specific user — sudah pakai render-fn pattern dari Phase 3.5

## 11. Cleanup test data

```sql
DELETE FROM orders WHERE order_number LIKE 'GB-TEST-COMM-%';
-- Commissions auto-cleanup via FK CASCADE
```

## 12. Sidebar visibility

- [ ] Login sebagai cs/advertiser → sidebar Komisi cuma show "Komisi Saya"
- [ ] Login sebagai owner → sidebar Komisi show "Komisi Saya" + "Kelola Komisi"
- [ ] Aturan Komisi visible hanya untuk owner di group Settings

## 13. Build / type check

- [ ] `npx tsc --noEmit` → no errors
- [ ] `npm run build` → success, `/commissions/my` + `/commissions/manage` ke-list

## Catatan implementasi

### Schema decisions
- **Status enum → TEXT + CHECK constraint** (bukan ALTER TYPE ADD VALUE) supaya migration bisa dijalankan di dalam single transaction. Brief mengasumsikan TEXT — production sebenarnya pakai ENUM type. Migration 016 idempotent convert.
- **133 commissions orphan dibersihkan** sebelum re-add FK ke orders. FK ke orders sebelumnya tidak ada (terlepas dari brief assumption). Re-added dengan ON DELETE CASCADE.
- **PAID immutability** — UPDATE clause di compute_commissions punya `WHERE public.commissions.status <> 'PAID'`. Plus brief redundancy CASE-WHEN di-skip karena WHERE sudah cukup.

### compute_commissions logic
- INSERT path: target_status berdasarkan order.status sekarang (DITERIMA→EARNED, CANCEL/FAKE/RETUR→CANCELLED, lainnya→ESTIMATED).
- UPDATE path: same logic, tapi ON CONFLICT WHERE skip jika status PAID.
- Lookup priority rule: (user+product) > (user) > (product) > (role only). order_date filter via `effective_from` untuk historic-correct rate.
- Loop per role (cs/advertiser/admin) hanya kalau user_id terisi di order.
- duplicate_of skip — kolom dropped di Phase 1 schema reset.

### RPCs
- `mark_commission_paid` — single, validate org + status='EARNED' before update. Throws P0002 (not found), 42501 (cross-org), 22023 (invalid status).
- `bulk_mark_commission_paid` — bulk, single UPDATE statement filtered by org + status='EARNED'. Returns ROW_COUNT.

### UI patterns
- Tabs default = EARNED (most-actionable for owner).
- Bulk checkbox header hanya enabled saat tab EARNED.
- Selection auto-pruned saat filter ubah (drop ids yang nggak ada di result baru).
- Dialog dipakai single + bulk (single = array of 1 id).

### Hal yang flag untuk Phase 4B

- **Period filter `order_date` lewat embedded relation** — pakai `!inner` syntax di select supaya filter parent rows. Approach ini bisa di-reuse di Phase 4B analytics.
- **Stats client-side compute** dari rows yang di-fetch (max 500) — kalau volume tumbuh > 500, stats jadi tidak akurat. Phase 4B Analytics perlu server-side aggregation RPC (e.g. `commission_stats(p_user_id, p_from, p_to)`).
- **No real-time refresh** — kalau owner mark paid sambil CS buka /commissions/my, CS perlu refresh manual. Future: Supabase realtime subscription.
- **Per-user breakdown stat card di manage** — brief sebut "Per-user breakdown" di stat cards, di-skip karena UX lebih clean dengan filter user di card sendiri. Phase 4B bisa add full breakdown dashboard.
