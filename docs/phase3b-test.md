# Phase 3B — Manual Smoke Test

> Halaman/engine yang dibangun di Phase 3B:
> - `src/lib/converter/engine-rekonsil.ts` — `ingestRekonsil()` engine
> - `src/lib/converter/preview.ts` — `previewRekonsil()` enriched preview
> - `src/lib/converter/status-inference.ts` — SPX inferred status
> - `/reconciliation/upload` — multi-step UI
>
> Migration 014 perlu di-apply sebelum testing (di production migrasinya
> sudah di-apply via `exec_sql` saat dev).

## 0. Pre-flight

- [ ] Migration 014 applied (auto saat Phase 3B dev). Verifikasi:
  ```sql
  SELECT proname FROM pg_proc WHERE proname='update_order_from_rekonsil';
  ```
- [ ] Profile rekonsil ada:
  ```sql
  SELECT id, code, direction, channel_id, primary_key_target
  FROM converter_profiles WHERE code='spx_financial_rekonsil';
  ```
- [ ] (Optional) Insert dummy orders supaya ada match:
  ```sql
  INSERT INTO orders (
    organization_id, order_number, customer_name, payment_method, total,
    status, channel_id, resi, created_by
  ) VALUES
    (1, 'GB-TEST-R001', 'Test Reko 1', 'COD', 100000, 'SIAP_KIRIM',
     (SELECT id FROM courier_channels WHERE code='SPX_DIRECT'),
     'SPXID067146703094', auth.uid()),
    (1, 'GB-TEST-R002', 'Test Reko 2', 'COD', 150000, 'SIAP_KIRIM',
     (SELECT id FROM courier_channels WHERE code='SPX_DIRECT'),
     'SPXID064462826974', auth.uid());
  ```

## 1. Upload UI happy path

- [ ] Buka `/reconciliation/upload` sebagai owner/admin → tampil
- [ ] Step 1: dropdown profile cuma show INBOUND_REKONSIL active (1 profile: SPX Financial Report)
- [ ] Pilih SPX → klik Lanjut
- [ ] Step 2: profile detail tampil (XLSX, header row 2, match by `resi`, 10 field mappings)
- [ ] Upload `financial_report.xlsx` → klik Preview
- [ ] Step 3: preview tampil 5 rows. Per row:
  - Found order → tampil order_number + customer + status badge before→after
  - Inferred status: DITERIMA (Escrow > 0) atau RETUR (Return Fee > 0)
  - Cost updates: shipping_cost_actual, payout, cod
  - Order tidak ditemukan → "akan masuk Inbox Unmatched Resi"
- [ ] Klik "Proses N row rekonsil"
- [ ] Step 4: progress bar bergerak dari 0 → N
- [ ] Step 5: report 6 stat cards (matched / status_updated / cost_updated / unmatched / unmapped / error)

## 2. Verify in DB

- [ ] Match dummy resi `SPXID067146703094`:
  ```sql
  SELECT status, payout_amount, shipping_cost_actual, cod_amount, status_changed_at
  FROM orders WHERE resi='SPXID067146703094';
  ```
  Expect: status=DITERIMA atau RETUR (sesuai escrow/return_fee), 3 cost fields filled.

- [ ] History entry source='converter_rekonsil':
  ```sql
  SELECT to_status, source, raw_status, note, source_profile_id
  FROM order_status_history
  WHERE order_id=(SELECT id FROM orders WHERE resi='SPXID067146703094')
  ORDER BY id DESC LIMIT 3;
  ```
  Latest entry: source='converter_rekonsil', raw_status mengandung 'INFERRED_DITERIMA' atau 'INFERRED_RETUR'.

- [ ] Unmatched inbox populated untuk resi yang nggak ada di DB:
  ```sql
  SELECT COUNT(*) FROM inbox_unmatched_resi
  WHERE source_profile_id=(SELECT id FROM converter_profiles WHERE code='spx_financial_rekonsil')
    AND resolved=FALSE;
  ```
  Expect: > 0 (semua resi di file yang nggak ada di orders).

- [ ] (Kalau ada raw_status non-inferred yang belum di-map) Unmapped statuses:
  ```sql
  SELECT raw_status, occurrence_count, resolved
  FROM inbox_unmapped_statuses
  WHERE channel_id=(SELECT id FROM courier_channels WHERE code='SPX_DIRECT');
  ```

## 3. Idempotency

Re-upload file yang sama:
- [ ] Step 5 result: `matched` count sama (semua re-match), `status_updated` 0 (karena status sudah di-update sebelumnya), `cost_updated` mungkin 0 (RPC pakai COALESCE — kalau cost sama dengan existing, no actual change)
- [ ] `inbox_unmatched_resi` count tidak nambah (skip insert kalau row dengan raw_resi sama + resolved=FALSE udah ada)
- [ ] `inbox_unmapped_statuses.occurrence_count` increment kalau ada raw status baru

## 4. Inbox UI integration (sudah jadi di Phase 2B)

- [ ] Buka `/inbox/unmatched-resi` → list dengan source `spx_financial_rekonsil`
- [ ] Klik resolve → 3 pilihan (link / create / abaikan) jalan
- [ ] Buka `/inbox/unmapped-statuses` → kalau ada → tampil dengan occurrence_count

## 5. Edge cases

- [ ] Profile bukan INBOUND_REKONSIL → engine throw error
- [ ] File invalid (PDF) → error preview message friendly
- [ ] Header row 2 → XLSX parse skip baris 1 dengan benar (kolom name persis match field mapping `Tracking Number`, `Escrow amount (IDR)`, dll.)
- [ ] Resi yang sama 2x di file → engine treat sebagai 2 update sequential, tidak crash

## 6. Build / type check

- [ ] `npx tsc --noEmit` → no errors
- [ ] `npm run build` → success, `/reconciliation/upload` ke-list

## Catatan
- Engine support **direction=INBOUND_REKONSIL only**. INBOUND_ORDER (Phase 3A engine) dan OUTBOUND_TO_COURIER (Phase 3C) di-handle di file lain.
- Profile `mengantar_rekonsil` belum di-seed — user perlu bikin manual via Settings → Converter Profiles kalau butuh proses Mengantar.
- Inferred status SPX hardcoded di `status-inference.ts` switch-case `profile.code='spx_financial_rekonsil'`. Kalau ada aggregator baru yang butuh inferred logic, tambah case di file itu (bukan di engine).
- Status update melewati trigger DB (auto-insert history dengan source='manual'), lalu RPC patch source ke 'converter_rekonsil' + raw_status + note. Konsisten dengan pattern Phase 3A.
