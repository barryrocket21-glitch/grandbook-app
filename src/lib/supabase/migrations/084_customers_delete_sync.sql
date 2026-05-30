-- 084 — Fix ghost data: customers gak ke-recompute saat order di-DELETE.
-- ============================================================================
-- Bug: trg_orders_sync_customer cuma AFTER INSERT/UPDATE (bukan DELETE). Pas
-- order dihapus (termasuk reset), counter customers gak ke-update + row gak
-- kehapus → ghost (customers nyangkut tanpa order). Verified: orders=0 tapi
-- customers=1506 semua ghost.
--
-- Fix:
--   (b1) recompute_for_phone: kalau 0 order tersisa utk nomor → HAPUS row
--        customers (kecuali ada data manual blacklist/vip/note → zero counters,
--        pertahankan reputasi manual).
--   (b2) trigger fire juga di DELETE → recompute nomor OLD. Early-exit kalau
--        row customers udah gak ada (mis. reset hapus customers duluan) supaya
--        bulk delete tetap cepat (cuma index lookup, bukan full-scan per row).
-- Idempotent.

-- (b1) — recompute: hapus row saat 0 order (preserve manual data)
CREATE OR REPLACE FUNCTION public.customers_recompute_for_phone(p_org bigint, p_phone_raw text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_phone     text := public.normalize_phone_canonical(p_phone_raw);
  v_total     int;  v_delivered int; v_returned int; v_fake int; v_cancel int; v_final int;
  v_delivery  numeric; v_return numeric; v_omset numeric; v_profit numeric;
  v_name      text; v_first timestamptz; v_last timestamptz; v_sample text;
  v_cfg       jsonb; v_new_max int; v_hr_bad int; v_watch numeric; v_bad int; v_tier text;
BEGIN
  IF v_phone IS NULL THEN RETURN; END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'DITERIMA'),
    count(*) FILTER (WHERE status = 'RETUR'),
    count(*) FILTER (WHERE status = 'FAKE'),
    count(*) FILTER (WHERE status = 'CANCEL'),
    COALESCE(sum(total) FILTER (WHERE status = 'DITERIMA'), 0),
    COALESCE(sum(estimated_profit) FILTER (WHERE status = 'DITERIMA'), 0),
    min(order_date)::timestamptz, max(order_date)::timestamptz,
    (array_agg(customer_name ORDER BY order_date DESC NULLS LAST))[1],
    (array_agg(customer_phone ORDER BY order_date DESC NULLS LAST))[1]
  INTO v_total, v_delivered, v_returned, v_fake, v_cancel, v_omset, v_profit, v_first, v_last, v_name, v_sample
  FROM public.orders
  WHERE organization_id = p_org
    AND public.normalize_phone_canonical(customer_phone) = v_phone;

  IF v_total = 0 THEN
    -- Tidak ada order tersisa. Hapus row (ghost) KECUALI ada data manual
    -- (blacklist/vip/note) yang harus dipertahankan → zero counters tapi keep.
    DELETE FROM public.customers
      WHERE organization_id = p_org AND phone_normalized = v_phone
        AND NOT (is_blacklisted OR is_vip OR note IS NOT NULL);
    UPDATE public.customers
      SET total_orders = 0, delivered_count = 0, returned_count = 0, fake_count = 0,
          cancel_count = 0, delivery_rate = 0, return_rate = 0, ltv_omset = 0, ltv_profit = 0,
          updated_at = now()
      WHERE organization_id = p_org AND phone_normalized = v_phone;
    RETURN;
  END IF;

  v_final    := v_delivered + v_returned;
  v_delivery := CASE WHEN v_final > 0 THEN round(v_delivered::numeric / v_final, 4) ELSE 0 END;
  v_return   := CASE WHEN v_final > 0 THEN round(v_returned::numeric / v_final, 4) ELSE 0 END;

  SELECT settings -> 'customer_risk' INTO v_cfg FROM public.organizations WHERE id = p_org;
  v_new_max := COALESCE((v_cfg ->> 'new_max_orders')::int, 1);
  v_hr_bad  := COALESCE((v_cfg ->> 'highrisk_bad_min')::int, 2);
  v_watch   := COALESCE((v_cfg ->> 'watch_return_rate')::numeric, 0.30);
  v_bad     := v_returned + v_fake;

  IF v_total >= 2 AND v_bad >= v_hr_bad THEN v_tier := 'HIGH_RISK';
  ELSIF v_bad >= 1 OR (v_final > 0 AND v_return >= v_watch) THEN v_tier := 'WATCH';
  ELSIF v_total <= v_new_max THEN v_tier := 'NEW';
  ELSE v_tier := 'GOOD';
  END IF;

  INSERT INTO public.customers (
    organization_id, phone_normalized, phone_raw_sample, name_latest,
    total_orders, delivered_count, returned_count, fake_count, cancel_count,
    delivery_rate, return_rate, ltv_omset, ltv_profit,
    first_order_at, last_order_at, risk_tier, updated_at
  ) VALUES (
    p_org, v_phone, v_sample, v_name,
    v_total, v_delivered, v_returned, v_fake, v_cancel,
    v_delivery, v_return, v_omset, v_profit,
    v_first, v_last, v_tier, now()
  )
  ON CONFLICT (organization_id, phone_normalized) DO UPDATE SET
    phone_raw_sample = EXCLUDED.phone_raw_sample,
    name_latest      = EXCLUDED.name_latest,
    total_orders     = EXCLUDED.total_orders,
    delivered_count  = EXCLUDED.delivered_count,
    returned_count   = EXCLUDED.returned_count,
    fake_count       = EXCLUDED.fake_count,
    cancel_count     = EXCLUDED.cancel_count,
    delivery_rate    = EXCLUDED.delivery_rate,
    return_rate      = EXCLUDED.return_rate,
    ltv_omset        = EXCLUDED.ltv_omset,
    ltv_profit       = EXCLUDED.ltv_profit,
    first_order_at   = EXCLUDED.first_order_at,
    last_order_at    = EXCLUDED.last_order_at,
    risk_tier        = EXCLUDED.risk_tier,
    updated_at       = now();
END;
$function$;

-- (b2) — trigger handle DELETE (+ early-exit kalau customer row udah gak ada)
CREATE OR REPLACE FUNCTION public.trg_orders_sync_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.customer_phone IS NOT NULL THEN
      v_phone := public.normalize_phone_canonical(OLD.customer_phone);
      -- Early-exit: kalau row customers gak ada (mis. reset hapus customers
      -- duluan), skip — bulk delete tetap cepat (cuma index lookup).
      IF v_phone IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.customers
        WHERE organization_id = OLD.organization_id AND phone_normalized = v_phone
      ) THEN
        PERFORM public.customers_recompute_for_phone(OLD.organization_id, OLD.customer_phone);
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.customer_phone IS NOT NULL THEN
    PERFORM public.customers_recompute_for_phone(NEW.organization_id, NEW.customer_phone);
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.customer_phone IS DISTINCT FROM NEW.customer_phone
     AND OLD.customer_phone IS NOT NULL THEN
    PERFORM public.customers_recompute_for_phone(NEW.organization_id, OLD.customer_phone);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_sync_customer ON public.orders;
CREATE TRIGGER trg_orders_sync_customer
  AFTER INSERT OR DELETE OR UPDATE OF status, customer_phone ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_orders_sync_customer();

REVOKE EXECUTE ON FUNCTION public.customers_recompute_for_phone(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_orders_sync_customer() FROM PUBLIC, anon, authenticated;

-- Cleanup ghost yang udah ada SEKARANG (1506 rows, 0 order, 0 manual data).
-- Hapus row tanpa data manual yang gak punya order sama sekali.
DELETE FROM public.customers c
WHERE NOT (c.is_blacklisted OR c.is_vip OR c.note IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.organization_id = c.organization_id
      AND public.normalize_phone_canonical(o.customer_phone) = c.phone_normalized
  );
