-- 134 — Resi lifecycle timestamps + pending pickup di orders_draft.
-- ============================================================================
-- BUG: auto_set_resi_lifecycle_timestamps trigger hanya di orders — orders_draft
-- tidak pernah dapat resi_printed_at/picked_up_at saat status berubah.
-- Akibat: "Resi Stuck" widget selalu 0, meskipun ada 482 SIAP_KIRIM.
-- Fix: (1) add picked_up_at ke orders_draft, (2) pasang trigger,
--      (3) backfill resi_printed_at dari status_changed_at,
--      (4) update pending_pickup_summary + get_pending_pickup_orders ke orders_draft.
-- Result: 482 order backfilled, 110 stuck >3hr, 60 stuck >7hr.
-- Applied via Supabase MCP. Idempotent.

ALTER TABLE public.orders_draft ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;

DROP TRIGGER IF EXISTS trg_auto_set_resi_lifecycle ON public.orders_draft;
CREATE TRIGGER trg_auto_set_resi_lifecycle
  BEFORE UPDATE OF status ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_resi_lifecycle_timestamps();

UPDATE public.orders_draft SET
  resi_printed_at = COALESCE(resi_printed_at, status_changed_at, created_at)
WHERE status IN ('SIAP_KIRIM', 'DIKIRIM') AND resi_printed_at IS NULL;

DROP FUNCTION IF EXISTS public.pending_pickup_summary(INT);
CREATE OR REPLACE FUNCTION public.pending_pickup_summary(p_days_threshold INT DEFAULT 3)
RETURNS TABLE(total_count BIGINT, total_value NUMERIC, oldest_days_pending NUMERIC, by_channel JSONB)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH stuck AS (
    SELECT d.id, d.total, d.resi_printed_at, cc.name AS channel_name,
           EXTRACT(EPOCH FROM (NOW() - d.resi_printed_at)) / 86400 AS days_pending
    FROM public.orders_draft d
    LEFT JOIN public.courier_channels cc ON cc.id = d.channel_id
    WHERE d.organization_id = v_org AND d.status = 'SIAP_KIRIM'
      AND d.picked_up_at IS NULL AND d.resi_printed_at IS NOT NULL
      AND d.resi_printed_at < (NOW() - (p_days_threshold || ' days')::INTERVAL)
  ),
  per_ch AS (
    SELECT COALESCE(s.channel_name,'Unknown') AS ch,
           COUNT(*)::INT AS cnt, COALESCE(SUM(s.total),0) AS val
    FROM stuck s GROUP BY COALESCE(s.channel_name,'Unknown')
  )
  SELECT
    (SELECT COUNT(*)::BIGINT FROM stuck),
    COALESCE((SELECT SUM(s.total) FROM stuck s),0)::NUMERIC,
    COALESCE((SELECT ROUND(MAX(s.days_pending)::NUMERIC,1) FROM stuck s),0)::NUMERIC,
    COALESCE((SELECT jsonb_object_agg(pc.ch, jsonb_build_object('count',pc.cnt,'value',pc.val)) FROM per_ch pc),'{}'::JSONB);
END $$;
REVOKE EXECUTE ON FUNCTION public.pending_pickup_summary(INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.pending_pickup_summary(INT) TO authenticated;

DROP FUNCTION IF EXISTS public.get_pending_pickup_orders(INT);
CREATE OR REPLACE FUNCTION public.get_pending_pickup_orders(p_days_threshold INT DEFAULT 3)
RETURNS TABLE(id BIGINT, order_number TEXT, resi TEXT, customer_name TEXT, customer_phone TEXT,
  customer_city TEXT, channel_name TEXT, total NUMERIC, resi_printed_at TIMESTAMPTZ,
  days_pending NUMERIC, cs_name TEXT, campaign_name TEXT)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  SELECT d.id, d.order_number, COALESCE(d.tracking_no, d.resi) AS resi,
    d.customer_name, d.customer_phone, d.customer_city,
    cc.name, d.total, d.resi_printed_at,
    ROUND((EXTRACT(EPOCH FROM (NOW() - d.resi_printed_at)) / 86400)::NUMERIC, 1),
    p.full_name, c.campaign_name
  FROM public.orders_draft d
  LEFT JOIN public.courier_channels cc ON cc.id = d.channel_id
  LEFT JOIN public.profiles p ON p.id = d.cs_id
  LEFT JOIN public.campaigns c ON c.id = d.campaign_id
  WHERE d.organization_id = v_org AND d.status = 'SIAP_KIRIM'
    AND d.picked_up_at IS NULL AND d.resi_printed_at IS NOT NULL
    AND d.resi_printed_at < (NOW() - (p_days_threshold || ' days')::INTERVAL)
  ORDER BY d.resi_printed_at ASC;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_pending_pickup_orders(INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_pending_pickup_orders(INT) TO authenticated;
