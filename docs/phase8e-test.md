# Phase 8E — Customizable Column View + Order Operations: Test Playbook

> Manual smoke test untuk verifikasi acceptance criteria Phase 8E.
>
> **Migration:** `035_phase8e_order_enrichment.sql` (slot 013 yang diminta brief sudah dipakai `013_wilayah_distinct_helpers.sql`, jadi pakai next free slot 035).
> Dependency check di migration verify Phase 8B (`resi_printed_at`) sudah ada.

---

## Test 1 — Migration & Schema (3 menit)

```sql
-- Kolom baru di orders
SELECT count(*) FROM information_schema.columns
 WHERE table_name='orders'
   AND column_name IN ('delivered_at','returned_at','tags','priority','internal_note',
                       'customer_note','reject_reason','cs_attempts','last_contact_at');
-- Expect: 9

-- profiles.preferences + organizations.settings
SELECT
  (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='preferences') AS prefs,
  (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='settings') AS settings;

-- notifications table + 3 RLS policies
SELECT
  (SELECT 1 FROM pg_tables WHERE tablename='notifications') AS tbl,
  (SELECT count(*) FROM pg_policies WHERE tablename='notifications') AS policies; -- Expect: 3

-- 3 trigger baru
SELECT tgname FROM pg_trigger WHERE tgrelid='public.orders'::regclass
 AND tgname IN ('auto_set_delivery_timestamps_trigger',
                'notify_owner_on_admin_financial_edit_trigger',
                'orders_block_admin_actual_trigger');
-- Expect: 3 rows

-- 2 RPC baru
SELECT proname FROM pg_proc WHERE proname IN ('list_orders_enriched', 'list_audit_logs');
-- Expect: 2 rows

-- Dependency check fires kalau Phase 8B belum ada
-- (re-run migration di env tanpa 8B → exception "Phase 8B belum dijalankan")
```

---

## Test 2 — RPC list_orders_enriched (3 menit)

```sql
SELECT * FROM list_orders_enriched(NULL, NULL, NULL, NULL, 5, 0);
-- Expect: max 5 rows dengan kolom enriched (actual_profit, profit_margin_pct,
--         shipping_diff, days_in_status, is_repeat_customer, supplier_name)

-- Filter status
SELECT * FROM list_orders_enriched(NULL, NULL, 'DITERIMA', NULL, 100, 0);

-- Search
SELECT order_number, customer_name FROM list_orders_enriched(NULL, NULL, NULL, 'GB', 10, 0);

-- Pagination + total_count
SELECT order_number, total_count FROM list_orders_enriched(NULL, NULL, NULL, NULL, 5, 5);
-- Expect: rows 6-10, total_count konsisten di semua row
```

---

## Test 3 — Column Customization (5 menit)

1. Login owner → `/orders/list`
2. Klik tombol **"⚙️ Kolom"** di header → Sheet kanan terbuka 3 tab.

### Tab Visibility
3. Search "profit" → hanya kolom profit-related tampil
4. Toggle off "Channel" → reload halaman → kolom tetap hidden (persist ke `profiles.preferences`)
5. Klik **Reset default** → kembali ke system default

### Tab Urutan
6. Switch tab "Urutan" → list visible columns
7. Drag kolom "Resi" ke posisi paling atas → reload → urutan persist

### Tab Saved Views
8. Klik **Save current** → input "Profit View" → Save
9. Toggle visibility beberapa kolom → switch view "Profit View" → Apply → kolom kembali sesuai save
10. **(Owner only)** klik **Team default** di view tertentu → reload
11. Login admin baru → `/orders/list` → tampilan otomatis mirip team default (sebelum user override)

---

## Test 4 — Inline Edit per Field (10 menit)

### Status (CS bisa edit)
1. Login CS → klik cell Status di salah satu row → Select dropdown muncul → ubah → toast "Status → X"
2. Verify di DB: `SELECT status FROM orders WHERE id = <id>;`

### Priority (owner/admin only)
3. Login owner → klik cell Priority → ubah → save
4. Login CS → cell Priority tidak ada pencil icon (read-only)

### Internal Note
5. Login CS → klik cell "Catatan Internal" (atau apply visibility dulu) → popover textarea → ketik → Simpan

### Tags
6. Login owner → klik cell Tags → popover multi-chip → tambah "urgent", "vip" → Simpan
7. Verify: `SELECT tags FROM orders WHERE id = <id>;` → `{urgent,vip}`

### Financial (admin → notif ke owner)
8. Login admin → klik cell Total → confirm modal "Anda akan ubah Total..."
9. Input nilai baru → Konfirmasi → toast "Tersimpan. Owner akan dapat notifikasi."
10. Logout, login owner → bell di header punya badge (1) → klik bell → notif "Admin edit financial: GB-XXX"
11. **Verify body multi-line:**
    ```
    [Nama admin] ubah order GB-XXX:
    Total: Rp 150.000 → Rp 200.000
    ```
12. Klik notif → redirect ke /orders/[id] + notif jadi read (badge berkurang)

### Block direct edit actual/payout
13. Login admin → buka DevTools Console:
    ```js
    const sb = (await import('@/lib/supabase/client')).createClient()
    const r = await sb.from('orders').update({ payout_amount: 999 }).eq('id', 1)
    console.log(r)
    ```
14. **Expect:** error "payout_amount hanya bisa diubah via halaman /reconciliation"
15. Via halaman `/reconciliation/upload` → upload file → `payout_amount` ke-update (RPC pakai bypass)

### Forbidden roles
16. Login adv → semua cell read-only (no pencil icon)
17. Login akunting → cell financial show lock icon, cell operational read-only

---

## Test 5 — Quick Actions per Row (5 menit)

1. Klik tombol "⋮" di row → dropdown menu muncul
2. **Edit** → navigate ke /orders/[id]
3. **Duplicate** (owner/admin/cs) → modal/loading → toast "Order baru GB-XXX dibuat" → redirect ke order baru, status BARU
4. **Cancel Order** (owner/admin only) → dialog input alasan "Customer ga jadi" → konfirmasi → status CANCEL + reject_reason tersimpan
5. **Mark as Fake** (owner/admin only) → dialog input alasan → status FAKE
6. **View Audit Trail** (owner only) → modal show audit log entries untuk order ini
7. Login CS → tombol Cancel/Mark Fake hidden, View Audit Trail hidden, Duplicate ada

---

## Test 6 — Notification Bell (3 menit)

1. Bell icon tampil di header (sebelah breadcrumb)
2. Badge angka unread (red) muncul kalau ada notif
3. Klik bell → popover 380px lebar, list 10 notif terbaru
4. Body notif `admin_edit_financial`:
   - Header dengan icon ⚠️ + title
   - Body multi-line preserved (whitespace-pre-line) — TIDAK truncate
   - Footer: relative time (Indonesian locale) + chevron kanan
5. Click notif → mark read + navigate
6. **Tandai semua** button (kalau ada unread)
7. Verify polling:
   - Tab aktif + ada unread → polling 30s
   - Tab hidden → polling pause (visibilitychange)
   - On focus → immediate refresh

---

## Test 7 — Audit Log Page (3 menit)

1. Login owner → `/settings/audit-log` → list muncul (default: 7 hari terakhir)
2. Filter:
   - Date range (from/to)
   - User dropdown
   - Table dropdown (distinct table_name)
   - Action: INSERT/UPDATE/DELETE
   - Search by record_id/table_name
3. Klik **Detail** di row UPDATE → modal dengan side-by-side diff (red old / green new)
4. Klik Detail di row INSERT → JSON dump new_value
5. Pagination next/prev jika >50 entries
6. Login admin → akses /settings/audit-log → **"Akses Dibatasi"** banner

---

## Test 8 — Trigger Auto-Set Delivery (2 menit)

1. Pilih order status DIKIRIM → ubah ke DITERIMA → cek DB:
   ```sql
   SELECT delivered_at FROM orders WHERE id = <id>;
   -- Expect: ter-set ke NOW
   ```
2. Ubah status ke RETUR → `returned_at` ter-set

---

## Test 9 — Build & Typecheck (1 menit)

```bash
npx tsc --noEmit      # exit 0
npm run build         # ✓ Compiled successfully
                      # /orders/list, /settings/audit-log ke-list
```

---

## Acceptance Checklist (recap brief)

**Database:**
- [x] Migration `035_phase8e_order_enrichment.sql` jalan tanpa error
- [x] Dependency check fail kalau Phase 8B belum dijalankan
- [x] 9 kolom baru di `orders`
- [x] Backfill `delivered_at` & `returned_at` jalan
- [x] Trigger `auto_set_delivery_timestamps` aktif
- [x] Trigger `notify_owner_on_admin_financial_edit` aktif
- [x] Trigger `orders_block_admin_direct_actual_edit` aktif (block + bypass via RPC)
- [x] `profiles.preferences` + `organizations.settings` ada
- [x] `notifications` table + 3 RLS policies
- [x] RPC `list_orders_enriched` ada + computed columns
- [x] RPC `list_audit_logs` ada + owner-only enforcement

**TypeScript:** Types updated, `tsc --noEmit` exit 0

**UI — Customizable Column View:**
- [x] Tombol "⚙️ Kolom" di toolbar
- [x] Sheet 3 tab: Visibility, Urutan, Saved Views
- [x] Drag-drop column order pakai @dnd-kit
- [x] Settings persist ke `profiles.preferences` (debounce 500ms auto-save)
- [x] Owner bisa "Team default" → `organizations.settings`
- [x] Saat new user buka halaman → pakai team default kalau ada

**UI — Inline Edit:**
- [x] status, priority, resi, internal_note, customer_note, tags, cs_attempts, last_contact_at, customer_phone/city/province editable
- [x] Financial fields (subtotal/shipping/discount/total) → confirm modal
- [x] CS hanya status + internal_note
- [x] Adv & Akunting read-only inline
- [x] Edit financial → notif ke owner via DB trigger
- [x] Admin/akunting blocked dari direct edit `payout_amount` / `shipping_cost_actual`

**UI — Quick Actions:**
- [x] Tombol "⋮" dropdown menu per row
- [x] Edit, Duplicate (owner/admin/cs), Cancel (owner/admin), Mark Fake (owner/admin), View Audit (owner)
- [x] Cancel/Fake → modal dengan input alasan wajib → save ke `reject_reason`

**UI — Audit Log:**
- [x] `/settings/audit-log` owner-only
- [x] Non-owner → "Akses Dibatasi"
- [x] 6 filter (date, user, table, action, search) + pagination 50
- [x] Detail modal: INSERT/UPDATE/DELETE handling, side-by-side diff

**UI — Notifications:**
- [x] Bell icon di header dengan badge
- [x] Popover 10 notif terbaru
- [x] Body multi-line preserve `\n` untuk admin_edit_financial
- [x] Body tidak truncate untuk admin_edit_financial
- [x] Klik notif → mark read + navigate
- [x] Adaptive polling (30s aktif + unread / 60s idle / pause saat hidden)

**Build & Verify:**
- [x] `npm run build` sukses
- [x] Advisor: zero issue baru

---

*Last updated: 2026-05-16 — Phase 8E v1.0*
