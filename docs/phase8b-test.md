# Phase 8B — Resi Lifecycle Timestamps: Test Playbook

> Manual smoke test untuk verifikasi acceptance criteria Phase 8B.
> Migration `034_phase8b_resi_lifecycle.sql` (filename slot 012 di brief, tapi 012 sudah dipakai migration lain — Phase 8B pakai slot 034) harus sudah di-apply.

---

## Test 1 — Migration & Backfill (3 menit)

**Tujuan:** Verifikasi schema dan backfill berjalan.

```sql
-- Kolom timestamp ada
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name IN ('resi_printed_at','picked_up_at');
-- Expect: 2 row

-- Trigger terpasang
SELECT tgname FROM pg_trigger
 WHERE tgrelid='public.orders'::regclass
   AND tgname='auto_set_resi_lifecycle_timestamps_trigger';
-- Expect: 1 row

-- Index partial ada
SELECT indexname FROM pg_indexes
 WHERE tablename='orders'
   AND indexname IN ('idx_orders_resi_pending_pickup','idx_orders_picked_up_at');
-- Expect: 2 rows

-- Backfill jalan: order status >= SIAP_KIRIM harus punya resi_printed_at
SELECT
  COUNT(*) FILTER (WHERE status IN ('SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR')) AS shouldve_resi,
  COUNT(*) FILTER (WHERE status IN ('SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR')
                    AND resi_printed_at IS NOT NULL) AS got_resi,
  COUNT(*) FILTER (WHERE status IN ('DIKIRIM','DITERIMA','PROBLEM','RETUR')) AS shouldve_pickup,
  COUNT(*) FILTER (WHERE status IN ('DIKIRIM','DITERIMA','PROBLEM','RETUR')
                    AND picked_up_at IS NOT NULL) AS got_pickup
FROM orders;
-- Expect: shouldve_resi == got_resi, shouldve_pickup == got_pickup
```

**Pass:** Semua query return expected.

---

## Test 2 — Auto-Trigger Status Change (5 menit)

**Tujuan:** Verifikasi trigger auto-fill timestamp saat status berubah.

### 2.1 BARU → SIAP_KIRIM
1. Login admin/owner → `/orders/new`
2. Buat order dummy → akan masuk dengan status BARU (kalau role cs) atau SIAP_KIRIM (kalau role admin/owner).
3. Kalau auto SIAP_KIRIM: cek DB
   ```sql
   SELECT id, status, resi_printed_at, picked_up_at FROM orders ORDER BY id DESC LIMIT 1;
   ```
   **Expect:** `resi_printed_at` ter-set (NOW), `picked_up_at` NULL.
4. Kalau BARU: buka detail order → "Edit Status" → pilih SIAP_KIRIM → save.
5. Reload → header "Resi Dicetak" tampil tanggal hari ini.

### 2.2 SIAP_KIRIM → DIKIRIM
1. Buka order yang barusan SIAP_KIRIM → "Edit Status" → pilih DIKIRIM → save.
2. Reload → "Di-pickup Ekspedisi" tampil tanggal hari ini.
3. Verifikasi `resi_printed_at` tidak berubah:
   ```sql
   SELECT id, resi_printed_at, picked_up_at FROM orders WHERE id = <id>;
   ```

### 2.3 Edge case: BARU → DIKIRIM (skip SIAP_KIRIM)
1. Buat order baru di DB dengan status BARU (atau force update).
2. Update langsung ke DIKIRIM:
   ```sql
   UPDATE orders SET status = 'DIKIRIM' WHERE id = <id>;
   SELECT resi_printed_at, picked_up_at FROM orders WHERE id = <id>;
   ```
   **Expect:** Kedua timestamp ter-set (NOW).

**Pass:** Trigger behavior correct di 3 skenario.

---

## Test 3 — Manual Override (3 menit)

**Tujuan:** Owner/admin bisa edit timestamp manual via UI.

1. Login owner → buka order detail `/orders/[id]`
2. Scroll ke section "Resi Lifecycle" (3 row: Resi Dicetak / Di-pickup / Diterima)
3. Klik pencil icon di "Resi Dicetak" → dialog muncul
4. Input datetime kustom (misal "2026-05-10 09:00") → Simpan
5. **Expect:** toast "Timestamp diupdate", row update value tampil
6. Reload halaman → value persist
7. Login CS → buka order yang sama → pencil icon **hidden** (PermissionGuard)
8. Test clear: edit lagi, kosongkan field → save → value kembali NULL → display "(belum)" atau "—"

**Pass:** Edit jalan, persist, dan role-gated.

---

## Test 4 — Quick Filter "Resi Stuck" (4 menit)

**Tujuan:** Filter chip di `/orders/list` benar.

### Setup data
```sql
-- Buat satu order dummy stuck > 3 hari (langsung manipulate timestamp)
UPDATE orders
   SET status = 'SIAP_KIRIM',
       resi_printed_at = NOW() - INTERVAL '5 days',
       picked_up_at = NULL
 WHERE id = <some_order_id>;
```

### Test
1. Buka `/orders/list`
2. **Expect:** Chip "⚠️ Resi Stuck (1)" tampil di bawah filter, warna amber (kalau count > 0)
3. Klik chip → list ter-filter, hanya tampilkan order yang stuck
4. URL bar berubah jadi `/orders/list?stuck_pickup=true` (kalau di-navigate via widget) atau chip aktif tanpa URL change (kalau klik manual — initial state from URL param)
5. Klik chip lagi (sudah aktif) → toggle off, kembali ke list full
6. Tutup browser, buka `/orders/list?stuck_pickup=true` direct → chip aktif on mount
7. Update order ke status DIKIRIM via UI → reload → chip count jadi 0

**Pass:** Chip count akurat, filter on/off jalan, URL param respected.

---

## Test 5 — Dashboard Widget (5 menit)

**Tujuan:** Widget "Resi Pending Pickup" di dashboard render benar.

### Setup
- Pastikan ada minimal 1 order stuck (dari Test 4) atau:
  ```sql
  UPDATE orders SET status='SIAP_KIRIM', resi_printed_at = NOW() - INTERVAL '4 days', picked_up_at = NULL WHERE id IN (...);
  ```

### Test
1. Login owner → `/dashboard`
2. Scroll ke warning row (Retur Rate / Fake Order Rate)
3. **Expect:** Widget ke-3 muncul: "Resi Pending Pickup (> 3 hari)" border amber
4. Widget tampilkan:
   - 3 metric: Order stuck count, Total nilai (Rp), Paling lama (hari)
   - Per-channel breakdown (kalau order link ke channel)
   - Button "Lihat Detail" → navigate ke `/orders/list?stuck_pickup=true`
5. Klik Refresh icon → spinner sekejap → data reload
6. Wait 2 menit → auto-refresh (verify via browser DevTools network)
7. Klik away ke tab lain → kembali → auto-refresh on focus

### Visibility test
8. Login CS → `/dashboard` (kalau ada akses) → widget **hidden**
9. Logout, login admin → widget visible

### Empty state
10. Mark all stuck orders as DIKIRIM → reload dashboard
11. Widget tampilkan "✅ Tidak ada resi stuck" hijau (border emerald)

**Pass:** Widget render, refresh jalan, role-gated, empty state ok.

---

## Test 6 — RPC Verification (2 menit)

```sql
-- Setup minimal 1 stuck order dulu (lihat Test 4)

SELECT * FROM get_pending_pickup_orders(3);
-- Expect: rows yang sesuai (order_number, customer, days_pending, dst)

SELECT * FROM pending_pickup_summary(3);
-- Expect: single row (total_count, total_value, oldest_days_pending, by_channel JSONB)

-- Threshold besar → return 0
SELECT * FROM pending_pickup_summary(30);
```

**Pass:** RPC callable, return data benar.

---

## Test 7 — Build & Typecheck (1 menit)

```bash
npx tsc --noEmit
# Expect: exit 0

npm run build
# Expect: ✓ Compiled successfully
```

---

## Acceptance Checklist (recap brief)

**Database:**
- [x] Migration jalan tanpa error (slot 034, file `034_phase8b_resi_lifecycle.sql`)
- [x] Kolom `resi_printed_at` & `picked_up_at` ada di `orders`
- [x] Index partial `idx_orders_resi_pending_pickup` ter-create
- [x] Backfill jalan untuk order existing
- [x] Trigger `auto_set_resi_lifecycle_timestamps_trigger` aktif
- [x] RPC `get_pending_pickup_orders` & `pending_pickup_summary` ada
- [x] Advisor security: zero issue baru terkait kolom/RPC ini

**TypeScript:**
- [x] Types updated: `Order`, `PendingPickupOrder`, `PendingPickupSummary`
- [x] `npx tsc --noEmit` exit 0
- [x] `npm run build` sukses

**UI:**
- [x] Order detail tampilkan section "Resi Lifecycle"
- [x] Owner & admin bisa edit timestamp manual (datetime-local picker)
- [x] Badge warning ⚠️ kalau `days_pending > 2`, danger 🔴 kalau > 7
- [x] `/orders/list` punya chip "⚠️ Resi Stuck" dengan count
- [x] Dashboard widget muncul untuk owner+admin
- [x] Widget tampilkan: count, total value, oldest days, per-channel
- [x] "Lihat Detail" → navigate ke filtered list

---

*Last updated: 2026-05-16 — Phase 8B v1.0*
