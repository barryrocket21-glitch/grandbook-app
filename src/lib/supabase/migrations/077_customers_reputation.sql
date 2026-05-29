-- 077 — Brief #1: Customer Reputation + Blacklist (by nomor HP)
-- ============================================================================
-- Modul baru: agregasi reputasi pelanggan per nomor HP (cached counters via
-- trigger) → warning saat input order → blacklist management.
--
-- Decision A (dari brief): tabel `customers` + cached counters di-maintain
-- trigger saat status order berubah. Plus kolom manual (blacklist/note/vip)
-- yang tidak bisa di-compute.
--
-- Catatan koreksi brief:
--   - organization_id = BIGINT (bukan uuid) — sesuai schema GrandBook.
--   - Slot migration 077 (072–076 sudah terpakai), bukan 072.
--   - Phone canonical = "8xxxxxxxxx" (strip 62/0 prefix) — MATCH dengan format
--     orders.customer_phone yang sudah dinormalisasi normalize_phone_id (TS).
--
-- Idempotent: DROP IF EXISTS + CREATE IF NOT EXISTS. Standing rules dipatuhi
-- (SECURITY DEFINER + SET search_path, REVOKE EXECUTE dari anon+authenticated
-- untuk trigger functions; RPC SECURITY INVOKER scoped via current_org_id()).

-- ----------------------------------------------------------------------------
-- 1. Phone canonical normalizer (SQL mirror dari normalizeIndonesianPhone TS)
--    Strip non-digit → strip leading 62 / 0 → "8xxxxxxxxx". NULL kalau < 8 digit.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_phone_canonical(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH d AS (
    SELECT regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g') AS digits
  )
  SELECT CASE
    WHEN length(digits) < 8 THEN NULL
    WHEN left(digits, 2) = '62' THEN substr(digits, 3)
    WHEN left(digits, 1) = '0' THEN substr(digits, 2)
    ELSE digits
  END
  FROM d;
$$;

-- ----------------------------------------------------------------------------
-- 2. Tabel customers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   bigint NOT NULL REFERENCES public.organizations(id),
  phone_normalized  text NOT NULL,
  phone_raw_sample  text,
  name_latest       text,
  total_orders      int NOT NULL DEFAULT 0,
  delivered_count   int NOT NULL DEFAULT 0,
  returned_count    int NOT NULL DEFAULT 0,
  fake_count        int NOT NULL DEFAULT 0,
  cancel_count      int NOT NULL DEFAULT 0,
  delivery_rate     numeric NOT NULL DEFAULT 0,
  return_rate       numeric NOT NULL DEFAULT 0,
  ltv_omset         numeric NOT NULL DEFAULT 0,
  ltv_profit        numeric NOT NULL DEFAULT 0,
  first_order_at    timestamptz,
  last_order_at     timestamptz,
  risk_tier         text NOT NULL DEFAULT 'NEW'
                      CHECK (risk_tier IN ('NEW','GOOD','WATCH','HIGH_RISK')),
  is_blacklisted    boolean NOT NULL DEFAULT false,
  blacklist_reason  text,
  blacklisted_by    uuid REFERENCES public.profiles(id),
  blacklisted_at    timestamptz,
  is_vip            boolean NOT NULL DEFAULT false,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_org_phone_uniq UNIQUE (organization_id, phone_normalized)
);

CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized ON public.customers(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_risk_tier ON public.customers(risk_tier);
CREATE INDEX IF NOT EXISTS idx_customers_is_blacklisted ON public.customers(is_blacklisted) WHERE is_blacklisted;
CREATE INDEX IF NOT EXISTS idx_customers_organization_id ON public.customers(organization_id);

-- ----------------------------------------------------------------------------
-- 3. RLS — SELECT semua role dalam org (form butuh warning); UPDATE manual
--    fields only utk owner/admin (column grants); counters via trigger DEFINER.
-- ----------------------------------------------------------------------------
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));

DROP POLICY IF EXISTS customers_update_manual ON public.customers;
CREATE POLICY customers_update_manual ON public.customers
  FOR UPDATE TO authenticated
  USING (organization_id = (SELECT public.current_org_id())
         AND public.get_user_role() IN ('owner','admin'))
  WITH CHECK (organization_id = (SELECT public.current_org_id())
         AND public.get_user_role() IN ('owner','admin'));

-- Column-level: user hanya boleh UPDATE kolom manual. Counter/computed columns
-- hanya bisa diubah oleh trigger function (SECURITY DEFINER = owner, bypass grant).
REVOKE UPDATE ON public.customers FROM authenticated;
GRANT SELECT ON public.customers TO authenticated;
GRANT UPDATE (is_blacklisted, blacklist_reason, blacklisted_by, blacklisted_at, is_vip, note, updated_at)
  ON public.customers TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Recompute counters + risk_tier untuk 1 nomor (single-phone, konsisten
--    walau status loncat). Sumber agregasi: orders (arsip), bukan orders_draft.
--    Manual fields (blacklist/vip/note) TIDAK di-clobber on conflict.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customers_recompute_for_phone(p_org bigint, p_phone_raw text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    min(order_date)::timestamptz,
    max(order_date)::timestamptz,
    (array_agg(customer_name ORDER BY order_date DESC NULLS LAST))[1],
    (array_agg(customer_phone ORDER BY order_date DESC NULLS LAST))[1]
  INTO v_total, v_delivered, v_returned, v_fake, v_cancel, v_omset, v_profit, v_first, v_last, v_name, v_sample
  FROM public.orders
  WHERE organization_id = p_org
    AND public.normalize_phone_canonical(customer_phone) = v_phone;

  IF v_total = 0 THEN
    -- Tidak ada order tersisa utk nomor ini. Biarkan row customers (preserve
    -- manual blacklist/note); set counters ke 0 kalau row sudah ada.
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

  -- Threshold dari organizations.settings->'customer_risk' (owner bisa tune nanti)
  SELECT settings -> 'customer_risk' INTO v_cfg FROM public.organizations WHERE id = p_org;
  v_new_max := COALESCE((v_cfg ->> 'new_max_orders')::int, 1);
  v_hr_bad  := COALESCE((v_cfg ->> 'highrisk_bad_min')::int, 2);
  v_watch   := COALESCE((v_cfg ->> 'watch_return_rate')::numeric, 0.30);
  v_bad     := v_returned + v_fake;

  IF v_total >= 2 AND v_bad >= v_hr_bad THEN
    v_tier := 'HIGH_RISK';
  ELSIF v_bad >= 1 OR (v_final > 0 AND v_return >= v_watch) THEN
    v_tier := 'WATCH';
  ELSIF v_total <= v_new_max THEN
    v_tier := 'NEW';
  ELSE
    v_tier := 'GOOD';
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
$$;

-- ----------------------------------------------------------------------------
-- 5. Trigger di orders: AFTER INSERT / UPDATE OF status, customer_phone
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_orders_sync_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.customer_phone IS NOT NULL THEN
    PERFORM public.customers_recompute_for_phone(NEW.organization_id, NEW.customer_phone);
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.customer_phone IS DISTINCT FROM NEW.customer_phone
     AND OLD.customer_phone IS NOT NULL THEN
    PERFORM public.customers_recompute_for_phone(NEW.organization_id, OLD.customer_phone);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_sync_customer ON public.orders;
CREATE TRIGGER trg_orders_sync_customer
  AFTER INSERT OR UPDATE OF status, customer_phone ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_orders_sync_customer();

-- ----------------------------------------------------------------------------
-- 6. Audit trigger di customers — log perubahan manual (blacklist/vip/note)
--    ke audit_log (pattern existing). Counter recompute TIDAK di-log (noise).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_customers_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (OLD.is_blacklisted IS DISTINCT FROM NEW.is_blacklisted)
     OR (OLD.is_vip IS DISTINCT FROM NEW.is_vip)
     OR (OLD.note IS DISTINCT FROM NEW.note)
     OR (OLD.blacklist_reason IS DISTINCT FROM NEW.blacklist_reason) THEN
    INSERT INTO public.audit_log (user_id, table_name, record_id, action, old_value, new_value, created_at)
    VALUES (
      auth.uid(), 'customers', NEW.id::text, 'UPDATE',
      jsonb_build_object('is_blacklisted', OLD.is_blacklisted, 'blacklist_reason', OLD.blacklist_reason,
                         'is_vip', OLD.is_vip, 'note', OLD.note, 'phone', OLD.phone_normalized),
      jsonb_build_object('is_blacklisted', NEW.is_blacklisted, 'blacklist_reason', NEW.blacklist_reason,
                         'is_vip', NEW.is_vip, 'note', NEW.note, 'phone', NEW.phone_normalized),
      now()
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_audit ON public.customers;
CREATE TRIGGER trg_customers_audit
  AFTER UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.trg_customers_audit();

-- ----------------------------------------------------------------------------
-- 7. RPC get_customer_reputation(p_phone) — dipanggil dari form input.
--    SECURITY INVOKER + RLS scope (cs/admin/owner boleh SELECT customers).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_customer_reputation(text);
CREATE OR REPLACE FUNCTION public.get_customer_reputation(p_phone text)
RETURNS TABLE (
  found            boolean,
  phone_normalized text,
  name_latest      text,
  risk_tier        text,
  is_blacklisted   boolean,
  blacklist_reason text,
  is_vip           boolean,
  total_orders     int,
  delivered_count  int,
  returned_count   int,
  fake_count       int,
  cancel_count     int,
  delivery_rate    numeric,
  return_rate      numeric,
  last_order_at    timestamptz,
  blacklist_mode   text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_phone text := public.normalize_phone_canonical(p_phone);
  v_mode  text;
BEGIN
  SELECT COALESCE(settings -> 'customer_risk' ->> 'blacklist_mode', 'block')
    INTO v_mode
    FROM public.organizations
    WHERE id = (SELECT public.current_org_id());
  v_mode := COALESCE(v_mode, 'block');

  IF v_phone IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, 'NEW'::text, false, NULL::text, false,
      0, 0, 0, 0, 0, 0::numeric, 0::numeric, NULL::timestamptz, v_mode;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    true,
    c.phone_normalized,
    c.name_latest,
    c.risk_tier,
    c.is_blacklisted,
    c.blacklist_reason,
    c.is_vip,
    c.total_orders,
    c.delivered_count,
    c.returned_count,
    c.fake_count,
    c.cancel_count,
    c.delivery_rate,
    c.return_rate,
    c.last_order_at,
    v_mode
  FROM public.customers c
  WHERE c.organization_id = (SELECT public.current_org_id())
    AND c.phone_normalized = v_phone;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, v_phone, NULL::text, 'NEW'::text, false, NULL::text, false,
      0, 0, 0, 0, 0, 0::numeric, 0::numeric, NULL::timestamptz, v_mode;
  END IF;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 8. RPC list_customers_enriched — halaman /customers. Filter + pagination.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_customers_enriched(text, text, boolean, int, int);
CREATE OR REPLACE FUNCTION public.list_customers_enriched(
  p_search       text DEFAULT NULL,
  p_tier         text DEFAULT NULL,
  p_blacklisted  boolean DEFAULT NULL,
  p_limit        int DEFAULT 50,
  p_offset       int DEFAULT 0
)
RETURNS TABLE (
  id               bigint,
  phone_normalized text,
  phone_raw_sample text,
  name_latest      text,
  total_orders     int,
  delivered_count  int,
  returned_count   int,
  fake_count       int,
  cancel_count     int,
  delivery_rate    numeric,
  return_rate      numeric,
  ltv_omset        numeric,
  ltv_profit       numeric,
  risk_tier        text,
  is_blacklisted   boolean,
  is_vip           boolean,
  last_order_at    timestamptz,
  total_count      bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_search text := NULLIF(TRIM(COALESCE(p_search, '')), '');
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT c.*
    FROM public.customers c
    WHERE c.organization_id = (SELECT public.current_org_id())
      AND (p_tier IS NULL OR c.risk_tier = p_tier)
      AND (p_blacklisted IS NULL OR c.is_blacklisted = p_blacklisted)
      AND (
        v_search IS NULL
        OR c.phone_normalized ILIKE '%' || v_search || '%'
        OR c.phone_raw_sample ILIKE '%' || v_search || '%'
        OR c.name_latest ILIKE '%' || v_search || '%'
      )
  )
  SELECT
    f.id, f.phone_normalized, f.phone_raw_sample, f.name_latest,
    f.total_orders, f.delivered_count, f.returned_count, f.fake_count, f.cancel_count,
    f.delivery_rate, f.return_rate, f.ltv_omset, f.ltv_profit,
    f.risk_tier, f.is_blacklisted, f.is_vip, f.last_order_at,
    (SELECT count(*) FROM filtered) AS total_count
  FROM filtered f
  ORDER BY
    CASE f.risk_tier WHEN 'HIGH_RISK' THEN 0 WHEN 'WATCH' THEN 1 WHEN 'GOOD' THEN 2 ELSE 3 END,
    f.last_order_at DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 9. Grants — REVOKE EXECUTE pada SECURITY DEFINER functions dari anon+auth.
-- ----------------------------------------------------------------------------
-- REVOKE dari PUBLIC (bukan cuma anon/authenticated) — default Postgres grant
-- EXECUTE ke PUBLIC; anon inherit via PUBLIC. Wajib utk advisor 0028.
REVOKE EXECUTE ON FUNCTION public.customers_recompute_for_phone(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_orders_sync_customer() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_customers_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_reputation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_customers_enriched(text, text, boolean, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_phone_canonical(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. Backfill 1x — set-based (1 INSERT...SELECT...GROUP BY, jauh lebih cepat
--     dari loop per-nomor; aman dari statement timeout). Idempotent via
--     ON CONFLICT (counters di-refresh, manual fields preserved).
-- ----------------------------------------------------------------------------
INSERT INTO public.customers (
  organization_id, phone_normalized, phone_raw_sample, name_latest,
  total_orders, delivered_count, returned_count, fake_count, cancel_count,
  delivery_rate, return_rate, ltv_omset, ltv_profit,
  first_order_at, last_order_at, risk_tier, updated_at
)
SELECT
  agg.org, agg.phone, agg.sample, agg.cname,
  agg.n_total, agg.n_delivered, agg.n_returned, agg.n_fake, agg.n_cancel,
  CASE WHEN agg.n_final > 0 THEN round(agg.n_delivered::numeric / agg.n_final, 4) ELSE 0 END,
  CASE WHEN agg.n_final > 0 THEN round(agg.n_returned::numeric / agg.n_final, 4) ELSE 0 END,
  agg.omset, agg.profit, agg.first_at, agg.last_at,
  CASE
    WHEN agg.n_total >= 2 AND (agg.n_returned + agg.n_fake) >= COALESCE((o.settings -> 'customer_risk' ->> 'highrisk_bad_min')::int, 2) THEN 'HIGH_RISK'
    WHEN (agg.n_returned + agg.n_fake) >= 1
         OR (agg.n_final > 0 AND round(agg.n_returned::numeric / agg.n_final, 4) >= COALESCE((o.settings -> 'customer_risk' ->> 'watch_return_rate')::numeric, 0.30)) THEN 'WATCH'
    WHEN agg.n_total <= COALESCE((o.settings -> 'customer_risk' ->> 'new_max_orders')::int, 1) THEN 'NEW'
    ELSE 'GOOD'
  END,
  now()
FROM (
  SELECT
    organization_id AS org,
    public.normalize_phone_canonical(customer_phone) AS phone,
    count(*) AS n_total,
    count(*) FILTER (WHERE status = 'DITERIMA') AS n_delivered,
    count(*) FILTER (WHERE status = 'RETUR') AS n_returned,
    count(*) FILTER (WHERE status = 'FAKE') AS n_fake,
    count(*) FILTER (WHERE status = 'CANCEL') AS n_cancel,
    count(*) FILTER (WHERE status IN ('DITERIMA', 'RETUR')) AS n_final,
    COALESCE(sum(orders.total) FILTER (WHERE status = 'DITERIMA'), 0) AS omset,
    COALESCE(sum(estimated_profit) FILTER (WHERE status = 'DITERIMA'), 0) AS profit,
    min(order_date)::timestamptz AS first_at,
    max(order_date)::timestamptz AS last_at,
    (array_agg(customer_name ORDER BY order_date DESC NULLS LAST))[1] AS cname,
    (array_agg(customer_phone ORDER BY order_date DESC NULLS LAST))[1] AS sample
  FROM public.orders
  WHERE customer_phone IS NOT NULL
    AND public.normalize_phone_canonical(customer_phone) IS NOT NULL
  GROUP BY organization_id, public.normalize_phone_canonical(customer_phone)
) agg
JOIN public.organizations o ON o.id = agg.org
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
