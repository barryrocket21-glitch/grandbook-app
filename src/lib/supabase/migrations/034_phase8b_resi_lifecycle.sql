-- =============================================================
-- PHASE 8B: Resi Lifecycle Timestamps
-- =============================================================
-- Masalah: resi yang sudah dicetak (status SIAP_KIRIM) tapi belum
-- di-pickup ekspedisi. Saat ini tidak ada visibility kapan resi
-- dicetak vs kapan di-handover.
--
-- Solusi: 2 kolom timestamp granular di orders + trigger auto-fill
-- + 2 RPC untuk widget dashboard & filter list.
--
-- IDEMPOTENT: aman di-re-run.
--
-- CATATAN NOMOR FILE: brief minta 012_phase8b_resi_lifecycle.sql,
-- tapi slot 012 sudah dipakai 012_order_number_generator.sql (Phase 3A).
-- Pakai slot 034 (next free) — sama persis content-nya dengan brief.
-- =============================================================

-- 1. Kolom timestamp
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS resi_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS picked_up_at    TIMESTAMPTZ;

-- 2. Index partial untuk query alert (resi stuck > N days)
CREATE INDEX IF NOT EXISTS idx_orders_resi_pending_pickup
  ON public.orders(resi_printed_at)
  WHERE status = 'SIAP_KIRIM' AND picked_up_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_picked_up_at ON public.orders(picked_up_at);

-- 3. Backfill existing data dari status_changed_at
-- Order yang sudah lewat status SIAP_KIRIM → asumsi resi_printed_at = status_changed_at
UPDATE public.orders
   SET resi_printed_at = status_changed_at
 WHERE resi_printed_at IS NULL
   AND status_changed_at IS NOT NULL
   AND status IN ('SIAP_KIRIM', 'DIKIRIM', 'DITERIMA', 'PROBLEM', 'RETUR');

-- Order yang lewat status DIKIRIM → asumsi picked_up_at = status_changed_at
-- (untuk yang BARU → DIKIRIM direct, ini juga reasonable approximation)
UPDATE public.orders
   SET picked_up_at = status_changed_at
 WHERE picked_up_at IS NULL
   AND status_changed_at IS NOT NULL
   AND status IN ('DIKIRIM', 'DITERIMA', 'PROBLEM', 'RETUR');

-- 4. Trigger: auto-set timestamps saat status berubah
-- Note: BEFORE UPDATE supaya NEW.* assignment effective sebelum row di-write.
--       Trigger names alfabetik (auto_* < trg_*) jadi mine runs first,
--       baru trg_log_order_status_update & trg_set_updated_at_orders.
CREATE OR REPLACE FUNCTION public.auto_set_resi_lifecycle_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Status berubah ke SIAP_KIRIM dan resi_printed_at masih NULL → set NOW()
  IF NEW.status = 'SIAP_KIRIM'
     AND OLD.status IS DISTINCT FROM 'SIAP_KIRIM'
     AND NEW.resi_printed_at IS NULL THEN
    NEW.resi_printed_at := NOW();
  END IF;

  -- Status berubah ke DIKIRIM dan picked_up_at masih NULL → set NOW()
  IF NEW.status = 'DIKIRIM'
     AND OLD.status IS DISTINCT FROM 'DIKIRIM'
     AND NEW.picked_up_at IS NULL THEN
    NEW.picked_up_at := NOW();
    -- Edge case: direct BARU → DIKIRIM (skip SIAP_KIRIM) → resi_printed_at masih NULL
    IF NEW.resi_printed_at IS NULL THEN
      NEW.resi_printed_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_set_resi_lifecycle_timestamps_trigger ON public.orders;
CREATE TRIGGER auto_set_resi_lifecycle_timestamps_trigger
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_resi_lifecycle_timestamps();

-- 5. RPC: get_pending_pickup_orders(p_days_threshold)
-- Return order yang SIAP_KIRIM + resi_printed_at lewat threshold + belum pickup
CREATE OR REPLACE FUNCTION public.get_pending_pickup_orders(
  p_days_threshold INT DEFAULT 3
)
RETURNS TABLE (
  id              BIGINT,
  order_number    TEXT,
  resi            TEXT,
  customer_name   TEXT,
  customer_phone  TEXT,
  customer_city   TEXT,
  channel_name    TEXT,
  total           NUMERIC,
  resi_printed_at TIMESTAMPTZ,
  days_pending    NUMERIC,
  cs_name         TEXT,
  campaign_name   TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.resi,
    o.customer_name,
    o.customer_phone,
    o.customer_city,
    cc.name AS channel_name,
    o.total,
    o.resi_printed_at,
    ROUND((EXTRACT(EPOCH FROM (NOW() - o.resi_printed_at)) / 86400)::numeric, 1) AS days_pending,
    p.full_name AS cs_name,
    c.campaign_name
  FROM public.orders o
  LEFT JOIN public.courier_channels cc ON cc.id = o.channel_id
  LEFT JOIN public.profiles         p  ON p.id  = o.cs_id
  LEFT JOIN public.campaigns        c  ON c.id  = o.campaign_id
  WHERE o.organization_id = v_org_id
    AND o.status = 'SIAP_KIRIM'
    AND o.picked_up_at IS NULL
    AND o.resi_printed_at IS NOT NULL
    AND o.resi_printed_at < (NOW() - (p_days_threshold || ' days')::INTERVAL)
  ORDER BY o.resi_printed_at ASC;  -- paling lama duluan
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_pending_pickup_orders(INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_pending_pickup_orders(INT) TO authenticated;

-- 6. RPC: pending_pickup_summary(p_days_threshold) — untuk dashboard widget
CREATE OR REPLACE FUNCTION public.pending_pickup_summary(
  p_days_threshold INT DEFAULT 3
)
RETURNS TABLE (
  total_count          BIGINT,
  total_value          NUMERIC,
  oldest_days_pending  NUMERIC,
  by_channel           JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  RETURN QUERY
  WITH stuck AS (
    SELECT
      o.id,
      o.total,
      o.resi_printed_at,
      cc.name AS channel_name,
      EXTRACT(EPOCH FROM (NOW() - o.resi_printed_at)) / 86400 AS days_pending
    FROM public.orders o
    LEFT JOIN public.courier_channels cc ON cc.id = o.channel_id
    WHERE o.organization_id = v_org_id
      AND o.status = 'SIAP_KIRIM'
      AND o.picked_up_at IS NULL
      AND o.resi_printed_at IS NOT NULL
      AND o.resi_printed_at < (NOW() - (p_days_threshold || ' days')::INTERVAL)
  ),
  per_channel AS (
    SELECT
      COALESCE(s.channel_name, 'Unknown') AS channel,
      COUNT(*)::int               AS cnt,
      COALESCE(SUM(s.total), 0)   AS val
    FROM stuck s
    GROUP BY COALESCE(s.channel_name, 'Unknown')
  )
  SELECT
    (SELECT COUNT(*)::BIGINT FROM stuck),
    COALESCE((SELECT SUM(s.total) FROM stuck s), 0)::NUMERIC,
    COALESCE((SELECT ROUND(MAX(s.days_pending)::numeric, 1) FROM stuck s), 0)::NUMERIC,
    COALESCE(
      (SELECT jsonb_object_agg(pc.channel, jsonb_build_object('count', pc.cnt, 'value', pc.val))
         FROM per_channel pc),
      '{}'::JSONB
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pending_pickup_summary(INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.pending_pickup_summary(INT) TO authenticated;

-- =============================================================
-- DONE.
-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='orders' AND column_name IN ('resi_printed_at','picked_up_at');
--   SELECT * FROM pending_pickup_summary(3);
-- =============================================================
