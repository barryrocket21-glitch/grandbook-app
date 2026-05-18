# Phase 8G — SPX Compliance + Phone Robustness + Parser Tuning: Test Playbook

> Comprehensive bug fix campaign untuk 4 systemic issues discovered post-Phase 8F deploy.
> **Migration:** `037_phase8g_spx_compliance.sql` (slot 037, next free).
> **Seed:** `scripts/seed-master-wilayah-spx.mjs` (Node script, 7092 row dari template SPX V2).

---

## Test 1 — DB Schema & Seed (3 menit)

```sql
-- Table + seed
SELECT
  (SELECT COUNT(*) FROM master_wilayah_spx) AS spx_total,         -- expect 7092
  (SELECT COUNT(DISTINCT state) FROM master_wilayah_spx) AS states, -- expect 34
  (SELECT COUNT(DISTINCT city) FROM master_wilayah_spx) AS cities;  -- expect 514

-- inbox_invalid_phone + policies
SELECT 1 FROM pg_tables WHERE tablename = 'inbox_invalid_phone';     -- 1 row
SELECT count(*) FROM pg_policies WHERE tablename = 'inbox_invalid_phone'; -- 3

-- RPC ada
SELECT proname FROM pg_proc WHERE proname = 'lookup_spx_wilayah';    -- 1 row
```

## Test 2 — SPX Wilayah Lookup RPC (3 menit)

```sql
-- Bug D real case (Jeksenn original):
SELECT * FROM lookup_spx_wilayah('Nusa Tenggara Timur (NTT)', 'Sumba Timur', 'Umalulu');
-- Expect: NUSA TENGGARA TIMUR (NTT) | KAB. SUMBA TIMUR | UMALULU | 87181 | normalized

-- Petarukan (Bug D test case dari brief):
SELECT * FROM lookup_spx_wilayah('Jawa Tengah', 'Pemalang', 'Petarukan');
-- Expect: JAWA TENGAH | KAB. PEMALANG | PETARUKAN | 52362 | normalized

-- Tangerang (city dengan prefix "Kota"):
SELECT * FROM lookup_spx_wilayah('Banten', 'Tangerang', 'Pinang');
-- Expect: BANTEN | KOTA TANGERANG | PINANG | <postal> | normalized atau partial

-- Not found:
SELECT * FROM lookup_spx_wilayah('XXX', 'YYY', 'ZZZ');
-- Expect: NULL | NULL | NULL | NULL | NULL | not_found
```

## Test 3 — Phone Normalizer (5 menit)

Smoke test via tsx:
```typescript
import { normalize_phone_id_safe } from './src/lib/converter/transforms'

normalize_phone_id_safe(6287808123771)        // { phone: '87808123771', isValid: true }
normalize_phone_id_safe('6.28781E+12')        // { phone: '6.28781E+12', isValid: false, reason: 'scientific_notation' }
normalize_phone_id_safe('081234567890')       // { phone: '81234567890', isValid: true }
normalize_phone_id_safe('+628123-4567')       // { phone: '81234567', isValid: false, reason: 'too_short' } — should be 'too_short' karena strip non-digit, hasilnya 8 digit
normalize_phone_id_safe('0878112')            // { phone: '0878112', isValid: false, reason: 'too_short' }
normalize_phone_id_safe('')                   // { phone: '', isValid: false, reason: 'empty' }
normalize_phone_id_safe(null)                 // { phone: '', isValid: false, reason: 'empty' }
```

## Test 4 — Address Parser V2 (5 menit)

```typescript
import { parseAddress, extractTokensWithPatterns } from './src/lib/converter/address-parser'

// Pure pattern extraction (no DB call):
extractTokensWithPatterns('Kios Martani, Jl. Manduro, RT 002 RW 001, Desa Klareyan, Kec. Petarukan, Kab. Pemalang, Jawa Tengah')
// Expect:
//   subdistrict_candidates: ['Petarukan']
//   city_candidates: ['Pemalang']
//   village_candidates: ['Klareyan']
//   province_candidates: ['Jawa Tengah']

// End-to-end (butuh DB):
await parseAddress({ address: '... Kec. Petarukan, Kab. Pemalang, Jawa Tengah', ... }, sb)
// Expect: { success: true, confidence: 'high', province: 'JAWA TENGAH', city: 'KAB. PEMALANG', ... }
```

4 test case Orderonline (brief): **4/4 must succeed** dengan confidence high/medium.

## Test 5 — End-to-End Re-Upload XLSX (15 menit)

1. DELETE order existing kalau ada
2. Upload XLSX bersih (test_1.xlsx style) via `/orders/bulk-upload` profile `orderonline_inbound`
3. Verify:
   - 9 order created, semua phone 12-13 digit utuh
   - **Address ke-parse: 9/9 success** (atau ≥ 7/9 untuk address yang well-structured)
   - `inbox_unparsed_address` minimal entry (cuma untuk address tanpa marker)
   - `inbox_invalid_phone` 0 entry (XLSX preserves typing, no scientific notation)

## Test 6 — SPX Outbound (CRITICAL — verify Bug A & B fix)

1. Pilih order alamat lengkap, channel SPX_DIRECT, payment_method=COD
2. `/orders/export-resi` → profile SPX Direct → Preview
3. **Expect warnings: 0** untuk:
   - `payment_method_cod_label_id` (Phase 8E fix, sudah verified)
   - `insurance_default_n` (Phase 8E fix)
   - `shipping_payment_default_id` (Phase 8G fix — NEW)
   - `spx_state_lookup`, `spx_city_lookup`, `spx_district_lookup`, `spx_postal_lookup` (Phase 8G NEW)
4. **Verify output kolom:**
   - Kolom #4 *Provinsi: `NUSA TENGGARA TIMUR (NTT)` (UPPERCASE + parenthesis)
   - Kolom #5 *Kota: `KAB. SUMBA TIMUR` (PREFIX `KAB.` ada)
   - Kolom #6 *Kecamatan: `UMALULU` (UPPERCASE)
   - Kolom #7 *Kode Pos: `87181` (5 digit dari SPX master)
   - Kolom #10 *COD?: `Paket COD` (kalau payment_method=COD)
   - Kolom #12 *Asuransi: `N`
   - Kolom #19 *Metode Pembayaran: `Dibayar Pengirim` (NOT "COD" atau "Bank Transfer")
5. Generate XLSX → upload ke SPX dashboard
6. **Expected SPX validation: 0 issue**

## Test 7 — Phone Inbox UI (3 menit)

1. Simulate: insert order dengan `customer_phone = '6.28781E+12'` via SQL atau upload corrupt CSV
2. Login owner/admin/cs → `/inbox/phone-review` muncul di sidebar Inbox group
3. Entry muncul dengan reason badge "Scientific notation (Excel CSV corrupt)"
4. Klik Resolve → dialog:
   - Raw phone shown read-only
   - Input baru — typing `081234567890` → preview "✓ Valid → akan disimpan sebagai 081234567890"
   - Typing `12345` → "✗ Invalid: too_short"
5. Save → orders.customer_phone updated, inbox resolved
6. Skip button untuk leave-as-is

## Test 8 — Build & Verify

```bash
npx tsc --noEmit      # exit 0
npm run build         # ✓ Compiled, /inbox/phone-review ke-list
```

## Test 9 — DB Mapping spx_outbound

```sql
SELECT display_order, source_field, transform
FROM converter_field_mappings fm
JOIN converter_profiles cp ON cp.id = fm.profile_id
WHERE cp.code = 'spx_outbound' AND display_order IN (4,5,6,7,19)
ORDER BY display_order;
-- Expect:
--   4 | spx_state_lookup               | NULL
--   5 | spx_city_lookup                | NULL
--   6 | spx_district_lookup            | NULL
--   7 | spx_postal_lookup              | NULL
--  19 | shipping_payment_default_id    | NULL
```

---

## Acceptance Checklist (recap brief)

**Database:**
- [x] Migration 037 jalan tanpa error
- [x] `master_wilayah_spx` ada (7092 rows seeded)
- [x] `inbox_invalid_phone` ada + 3 RLS policy
- [x] RPC `lookup_spx_wilayah` SECURITY INVOKER + search_path locked
- [x] 9 stuck order cleanup (no-op kalau sudah dihapus)
- [x] Advisor security: zero issue baru

**Code:**
- [x] `normalize_phone_id_safe` discriminated union (isValid + reason)
- [x] Legacy `normalize_phone_id` defensive: detect sci notation, return raw kalau invalid
- [x] Resolver `shipping_payment_default_id` → "Dibayar Pengirim"
- [x] 4 SPX lookup resolvers (state/city/district/postal) async via cache
- [x] `parseAddressV2` pattern-aware (subdistrict_candidates + city + village + province match)
- [x] `extractTokensWithPatterns` exported
- [x] Engine inbound: phone validation + inbox routing
- [x] Engine outbound: async refactor + SPX lookup cache per-order

**UI:**
- [x] `/inbox/phone-review` accessible owner/admin/cs
- [x] Sidebar entry "Phone Review" muncul

**DB Mappings:**
- [x] spx_outbound #4-7: spx_*_lookup (transform null)
- [x] spx_outbound #19: shipping_payment_default_id

**Build:** `tsc --noEmit` exit 0, `npm run build` sukses

---

*Last updated: 2026-05-18 — Phase 8G v1.0*
