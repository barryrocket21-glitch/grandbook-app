-- =============================================================
-- PHASE 8H FIX: generate_order_number draft-aware
-- =============================================================
-- Bug: Phase 3A `generate_order_number()` cuma cek tabel `orders`.
-- Setelah Phase 8H (49) migrasi 140 row hari ini dari orders → orders_draft,
-- RPC selalu return `GB-YYYYMMDD-000001` (count orders today = 0).
-- Tapi nomor itu sudah dipake di orders_draft → UNIQUE violation di INSERT
-- → engine catch sebagai 23505 → "skipped_duplicates" inflated.
--
-- Symptom: paste 3 order via WA Paste → "0 berhasil / 3 duplicate".
--
-- Fix: count + verify uniqueness across BOTH tables.
-- IDEMPOTENT: CREATE OR REPLACE.
-- =============================================================

CREATE OR REPLACE FUNCTION public.generate_order_number(org_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  date_prefix TEXT := TO_CHAR(NOW(), 'YYYYMMDD');
  counter INT;
  candidate TEXT;
  attempt INT := 0;
BEGIN
  LOOP
    -- GREATEST(count_orders, count_draft) + 1 — pakai counter terbesar
    -- supaya nomor selalu maju, ga collision dengan baris yang sudah ada
    -- di salah satu tabel.
    SELECT GREATEST(
      (SELECT COUNT(*) FROM public.orders
         WHERE organization_id = org_id
           AND DATE(created_at AT TIME ZONE 'UTC') = (NOW() AT TIME ZONE 'UTC')::date),
      (SELECT COUNT(*) FROM public.orders_draft
         WHERE organization_id = org_id
           AND DATE(created_at AT TIME ZONE 'UTC') = (NOW() AT TIME ZONE 'UTC')::date)
    ) + 1
    INTO counter;

    candidate := 'GB-' || date_prefix || '-' || LPAD((counter + attempt)::TEXT, 6, '0');

    -- Verify uniqueness across BOTH tables (race-safe loop).
    PERFORM 1 FROM public.orders
      WHERE organization_id = org_id AND order_number = candidate;
    IF NOT FOUND THEN
      PERFORM 1 FROM public.orders_draft
        WHERE organization_id = org_id AND order_number = candidate;
      IF NOT FOUND THEN
        RETURN candidate;
      END IF;
    END IF;

    attempt := attempt + 1;
    IF attempt > 50 THEN
      RAISE EXCEPTION 'generate_order_number: could not produce unique number after 50 attempts';
    END IF;
  END LOOP;
END;
$function$;
