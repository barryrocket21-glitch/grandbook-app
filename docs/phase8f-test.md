# Phase 8F — Inbound Parsing + Outbound Resolver Fix: Test Playbook

> Manual smoke test untuk verifikasi acceptance criteria Phase 8F.
> **Migration:** `036_phase8f_address_parsing.sql` (slot 036, next free setelah 035 Phase 8E).

---

## Test 1 — Migration & Schema (3 menit)

```sql
-- Table inbox_unparsed_address ada
SELECT 1 FROM pg_tables WHERE tablename = 'inbox_unparsed_address';
-- Expect: 1

-- 3 RLS policy
SELECT count(*) FROM pg_policies WHERE tablename = 'inbox_unparsed_address';
-- Expect: 3 (select, insert, update)

-- 2 RPC ada
SELECT proname FROM pg_proc WHERE proname IN ('search_wilayah_fuzzy', 'check_order_export_ready');
-- Expect: 2 rows

-- Mapping orderonline_inbound — sebelumnya 15, sekarang 30 (15 baru ter-insert)
SELECT count(*) FROM converter_field_mappings fm
JOIN converter_profiles cp ON cp.id = fm.profile_id
WHERE cp.code = 'orderonline_inbound';
-- Expect: 30

-- Verify field-field baru ada
SELECT source_field FROM converter_field_mappings fm
JOIN converter_profiles cp ON cp.id = fm.profile_id
WHERE cp.code = 'orderonline_inbound' AND fm.source_field IN
  ('province','city','subdistrict','zip','weight','cogs','notes','tags',
   'dropshipper_name','dropshipper_phone','utm_campaign','utm_medium','utm_source','utm_content','utm_term')
ORDER BY source_field;
-- Expect: 15 rows
```

## Test 2 — RPC search_wilayah_fuzzy (3 menit)

```sql
-- Test case Jeksenn — "umalulu" → kecamatan match
SELECT * FROM search_wilayah_fuzzy('umalulu', 5);
-- Expect: 5 rows NTT/Sumba Timur/Umalulu, semua match_score=100

-- Test typo "mutugeding" → "Mutunggeding" via fuzzy
SELECT * FROM search_wilayah_fuzzy('mutugeding', 5);
-- Expect: ada Mutunggeding (id 36340) dengan score >= 55

-- Test too-short query
SELECT * FROM search_wilayah_fuzzy('ab', 5);
-- Expect: 0 rows
```

## Test 3 — RPC check_order_export_ready (2 menit)

```sql
-- Pick any existing order
SELECT id FROM orders LIMIT 1;
-- Call check
SELECT * FROM check_order_export_ready(<id>);
-- Expect: 1 row dengan is_ready + missing_fields array
```

## Test 4 — Address Parser (Unit Verify, 5 menit)

Buat fixture order via CSV upload Orderonline atau via SQL insert dengan field address yang berisi "Kecamatan umalulu" tanpa province/city/subdistrict struktural.

- **Case 1:** `address="Jl X RT 01 Kecamatan Umalulu"`, province=NULL → parser harus return success, province="Nusa Tenggara Timur (NTT)", city="Sumba Timur", subdistrict="Umalulu", confidence='high' (score 100)
- **Case 2:** province="DKI Jakarta", city="Jakarta Pusat", subdistrict="Menteng" (struktural lengkap) → STEP 1 short-circuit, confidence='high'
- **Case 3:** address="Rumah ada pohon mangga" (zero keyword wilayah) → return failure reason='no_match', insert ke inbox
- **Case 4:** address="" (kosong) + struktural kosong → reason='empty_input'

## Test 5 — End-to-End Inbound Orderonline (10 menit)

1. Siapkan CSV dengan 3 row Orderonline:
   - Row A: alamat struktur lengkap (province/city/subdistrict)
   - Row B: alamat free-text only dengan "Kecamatan Umalulu"
   - Row C: alamat free-text yang nggak match wilayah ("Rumah saya yang ada pohon mangga")
2. Upload via `/orders/bulk-upload` → pilih profile `orderonline_inbound`
3. Verify warnings di summary:
   - Row B: "Order id=X alamat butuh review manual? (high/medium confidence)"
   - Row C: "Order id=Y alamat butuh review manual (reason: no_match). Cek /inbox/address-review."
4. Cek di DB:
   ```sql
   SELECT id, customer_province, customer_city, customer_subdistrict, meta->'address_parse_confidence'
   FROM orders ORDER BY id DESC LIMIT 3;
   ```
   - Row A: province dari CSV langsung
   - Row B: province="Nusa Tenggara Timur (NTT)", meta.address_parse_confidence='high'
   - Row C: province=NULL, meta.address_parse_failed='no_match'
5. ```sql
   SELECT order_id, raw_address, parsing_attempt FROM inbox_unparsed_address ORDER BY id DESC LIMIT 5;
   ```
   - Row C harus ada di sini

## Test 6 — Inbox Address Review UI (10 menit)

1. Login owner/admin/cs → `/inbox/address-review` muncul di sidebar group Inbox
2. List tampilkan Row C (unresolved)
3. Klik "Resolve" → dialog muncul dengan:
   - Raw address full
   - Extracted keywords sebagai chip
   - Kandidat list (mungkin kosong untuk Row C, atau ada untuk Row B kalau parsing borderline)
   - Manual search via WilayahAutocomplete
4. Klik kandidat → form ke-fill (province/city/subdistrict/village/zip)
5. Atau ketik di autocomplete → debounce 300ms → dropdown muncul → pilih
6. Edit manual zip kalau perlu
7. Klik "Save & Resolve" → toast "Address ter-resolve & order ke-update"
8. Verify DB: orders table updated, inbox row resolved=TRUE

## Test 7 — Export Gate (5 menit)

1. Setup: 1 order siap export (alamat lengkap + channel SPX_DIRECT) + 1 order alamat NULL
2. `/orders/export-resi` → filter SIAP_KIRIM → pilih kedua → next → pilih profile SPX Direct → Preview → Generate
3. **Expect:** toast error "1 order belum siap export" + list missing fields + tombol "Buka Inbox Address Review"
4. Klik tombol → redirect ke `/inbox/address-review`
5. Resolve alamat order ke-2 → kembali ke `/orders/export-resi` → Generate lagi → jalan
6. File XLSX ter-download dengan 2 row

## Test 8 — SPX Outbound Resolver (verify Bug #2 fix, 5 menit)

1. 1 order COD + 1 order TRANSFER, status SIAP_KIRIM, channel SPX_DIRECT, alamat complete
2. `/orders/export-resi` → SPX Direct → Preview
3. Verify preview rows: **0 warning** untuk `payment_method_cod_label_id`, `payment_method_label_id`, `insurance_default_n`
4. Kolom output:
   - Kolom 10 (*COD?): "Paket COD" (COD) / "Bukan Paket COD" (TRANSFER)
   - Kolom 12 (*Asuransi): "N" (semua)
   - Kolom 19 (*Metode Pembayaran): "COD" (COD) / "Bank Transfer" (TRANSFER)
5. Generate → buka XLSX di Excel → verify 3 kolom ter-isi

## Test 9 — Build & Typecheck

```bash
npx tsc --noEmit      # exit 0
npm run build         # ✓ Compiled successfully
                      # /inbox/address-review ke-list di routes
```

---

## Acceptance Checklist (recap brief)

**Database:**
- [x] Migration `036_phase8f_address_parsing.sql` jalan tanpa error
- [x] Tabel `inbox_unparsed_address` ada dengan RLS aktif (3 policy)
- [x] RPC `search_wilayah_fuzzy` callable, return scored matches
- [x] RPC `check_order_export_ready` callable, return missing_fields array
- [x] 15 mapping baru ter-insert di `orderonline_inbound` (existing 15 + new 15 = 30)
- [x] Advisor security: zero issue baru terkait Phase 8F

**Transform Functions:**
- [x] `null_if_empty`, `numeric_or_null`, `split_csv_to_array` ada di `transforms.ts` (3, bukan 4 — `link_product_by_sku` skip karena product-matcher.ts sudah handle)

**Address Parser:**
- [x] File `src/lib/converter/address-parser.ts` ada
- [x] Function `parseAddress`, `extractKeywords` exported
- [x] Logic: STEP 1 short-circuit struktural, STEP 2-4 keyword search + grouping + winner detection

**Inbound Engine Integration:**
- [x] `engine.ts` import `parseAddress`, ENABLE_ADDRESS_PARSER cuma untuk `orderonline_inbound`
- [x] Success → update ordersData + meta.address_parse_confidence
- [x] Failure → insert ke `inbox_unparsed_address` setelah order ke-create + warning ke result
- [x] Whitelist extended: `customer_note`, `tags`, `priority`, `hpp_snapshot`

**UI Inbox:**
- [x] Halaman `/inbox/address-review` ada
- [x] List unresolved + filter showResolved
- [x] Modal resolve dengan: raw address, keywords, kandidat list, WilayahAutocomplete, form manual
- [x] Save & Resolve update orders + mark resolved
- [x] Skip button (resolved=TRUE tanpa update orders)
- [x] Sidebar entry "Address Review" untuk owner/admin/cs

**Export Gate:**
- [x] `/orders/export-resi` block generate kalau ada order `check_order_export_ready=FALSE`
- [x] Toast error dengan list missing fields + tombol redirect ke inbox

**Outbound Resolver Fix:**
- [x] 3 resolver (`payment_method_cod_label_id`, `payment_method_label_id`, `insurance_default_n`) ada di switch case `resolveSourceValue` outbound-resolvers.ts (line 67-71). Note: udah fix di SPX deploy turn sebelumnya, brief mungkin di-tulis sebelum fix.
- [x] Smoke test verify: case statement returns correct values

**Build & Verify:**
- [x] `npx tsc --noEmit` exit 0
- [x] `npm run build` sukses, 57 routes (`/inbox/address-review` baru)

---

*Last updated: 2026-05-16 — Phase 8F v1.0*
