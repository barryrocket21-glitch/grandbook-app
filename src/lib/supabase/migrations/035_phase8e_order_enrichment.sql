-- =============================================================
-- PHASE 8E: Order Enrichment + Saved Views + Notifications + Audit RPC
-- =============================================================
-- Dependency: Phase 8B (orders.resi_printed_at, orders.picked_up_at)
--
-- Yang ditambah:
-- 1. orders: delivered_at, returned_at, tags[], priority, internal_note,
--    customer_note, reject_reason, cs_attempts, last_contact_at
-- 2. profiles.preferences JSONB (saved views per user)
-- 3. organizations.settings JSONB (team default view)
-- 4. notifications table (in-app lightweight)
-- 5. Trigger auto_set_delivery_timestamps (DITERIMA→delivered_at, RETUR→returned_at)
-- 6. Trigger notify_owner_on_admin_financial_edit (admin edit → notif ke owner)
-- 7. Trigger orders_block_admin_direct_actual_edit (block payout/actual via direct UPDATE)
-- 8. RPC list_orders_enriched (return enriched data + computed metrics)
-- 9. RPC list_audit_logs (owner-only browsing audit_log table)
-- 10. Patch update_order_from_rekonsil dengan bypass setting
--
-- CATATAN NOMOR FILE: brief minta 013 tapi 013_wilayah_distinct_helpers.sql sudah
-- dipakai (Phase 1.5). Pakai slot 035 (next free, lanjut dari Phase 8B di slot 034).
--
-- IDEMPOTENT.
-- =============================================================

-- ============================================
-- DEPENDENCY CHECK
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'resi_printed_at'
  ) THEN
    RAISE EXCEPTION 'Phase 8B belum dijalankan. Run migration 034_phase8b_resi_lifecycle.sql terlebih dahulu.';
  END IF;
END $$;

-- ============================================
-- 1. Order Enrichment Columns
-- ============================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivered_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS priority       TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW', 'NORMAL', 'URGENT')),
  ADD COLUMN IF NOT EXISTS internal_note  TEXT,
  ADD COLUMN IF NOT EXISTS customer_note  TEXT,
  ADD COLUMN IF NOT EXISTS reject_reason  TEXT,
  ADD COLUMN IF NOT EXISTS cs_attempts    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ;

-- Index untuk filter/search common
CREATE INDEX IF NOT EXISTS idx_orders_priority
  ON public.orders(priority) WHERE priority != 'NORMAL';
CREATE INDEX IF NOT EXISTS idx_orders_tags
  ON public.orders USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at
  ON public.orders(delivered_at);
CREATE INDEX IF NOT EXISTS idx_orders_returned_at
  ON public.orders(returned_at);

-- Backfill
UPDATE public.orders
   SET delivered_at = status_changed_at
 WHERE status = 'DITERIMA'
   AND delivered_at IS NULL
   AND status_changed_at IS NOT NULL;

UPDATE public.orders
   SET returned_at = status_changed_at
 WHERE status = 'RETUR'
   AND returned_at IS NULL
   AND status_changed_at IS NOT NULL;

-- ============================================
-- 2. Trigger: auto-set delivery timestamps
-- ============================================
CREATE OR REPLACE FUNCTION public.auto_set_delivery_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'DITERIMA' AND OLD.status IS DISTINCT FROM 'DITERIMA'
     AND NEW.delivered_at IS NULL THEN
    NEW.delivered_at := NOW();
  END IF;

  IF NEW.status = 'RETUR' AND OLD.status IS DISTINCT FROM 'RETUR'
     AND NEW.returned_at IS NULL THEN
    NEW.returned_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_set_delivery_timestamps_trigger ON public.orders;
CREATE TRIGGER auto_set_delivery_timestamps_trigger
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_delivery_timestamps();

-- ============================================
-- 3. profiles.preferences (saved views per user)
-- ============================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.profiles.preferences IS
  'User-specific UI prefs. Structure: {orders_list: {column_visibility, column_order, column_widths, saved_views[], active_view_id}}';

-- ============================================
-- 4. organizations.settings (team default view)
-- ============================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.organizations.settings IS
  'Org-wide settings. Structure: {orders_list_default_view: {column_visibility, column_order, column_widths}}';

-- ============================================
-- 5. notifications table
-- ============================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT,
  link           TEXT,
  metadata       JSONB DEFAULT '{}'::JSONB,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications(recipient_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_org
  ON public.notifications(organization_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
DROP POLICY IF EXISTS notifications_update ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;

CREATE POLICY notifications_select ON public.notifications
  FOR SELECT
  USING (recipient_id = auth.uid() AND organization_id = public.current_org_id());

CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT
  WITH CHECK (organization_id = public.current_org_id());

-- ============================================
-- 6. Trigger: notify_owner_on_admin_financial_edit
-- ============================================
CREATE OR REPLACE FUNCTION public.notify_owner_on_admin_financial_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role         TEXT;
  v_owner_id     UUID;
  v_changes      JSONB := '{}'::JSONB;
  v_change_lines TEXT[] := ARRAY[]::TEXT[];
  v_editor_name  TEXT;
  v_body         TEXT;
BEGIN
  -- Only for admin role
  v_role := public.get_user_role();
  IF v_role <> 'admin' THEN
    RETURN NEW;
  END IF;

  -- Detect financial field changes + build human-readable change lines
  IF NEW.subtotal IS DISTINCT FROM OLD.subtotal THEN
    v_changes := v_changes || jsonb_build_object(
      'subtotal', jsonb_build_object('from', OLD.subtotal, 'to', NEW.subtotal));
    v_change_lines := v_change_lines ||
      ('Subtotal: Rp ' || to_char(COALESCE(OLD.subtotal, 0), 'FM999G999G999')
       || ' → Rp ' || to_char(COALESCE(NEW.subtotal, 0), 'FM999G999G999'));
  END IF;

  IF NEW.shipping_cost IS DISTINCT FROM OLD.shipping_cost THEN
    v_changes := v_changes || jsonb_build_object(
      'shipping_cost', jsonb_build_object('from', OLD.shipping_cost, 'to', NEW.shipping_cost));
    v_change_lines := v_change_lines ||
      ('Ongkir: Rp ' || to_char(COALESCE(OLD.shipping_cost, 0), 'FM999G999G999')
       || ' → Rp ' || to_char(COALESCE(NEW.shipping_cost, 0), 'FM999G999G999'));
  END IF;

  IF NEW.discount IS DISTINCT FROM OLD.discount THEN
    v_changes := v_changes || jsonb_build_object(
      'discount', jsonb_build_object('from', OLD.discount, 'to', NEW.discount));
    v_change_lines := v_change_lines ||
      ('Diskon: Rp ' || to_char(COALESCE(OLD.discount, 0), 'FM999G999G999')
       || ' → Rp ' || to_char(COALESCE(NEW.discount, 0), 'FM999G999G999'));
  END IF;

  IF NEW.total IS DISTINCT FROM OLD.total THEN
    v_changes := v_changes || jsonb_build_object(
      'total', jsonb_build_object('from', OLD.total, 'to', NEW.total));
    v_change_lines := v_change_lines ||
      ('Total: Rp ' || to_char(COALESCE(OLD.total, 0), 'FM999G999G999')
       || ' → Rp ' || to_char(COALESCE(NEW.total, 0), 'FM999G999G999'));
  END IF;

  IF v_changes = '{}'::JSONB THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_editor_name FROM public.profiles WHERE id = auth.uid();

  v_body := COALESCE(v_editor_name, 'Admin') || ' ubah order ' || NEW.order_number || ':'
            || E'\n' || array_to_string(v_change_lines, E'\n');

  FOR v_owner_id IN
    SELECT p.id FROM public.profiles p
     WHERE p.organization_id = NEW.organization_id
       AND p.role = 'owner'
       AND p.active = TRUE
  LOOP
    INSERT INTO public.notifications (organization_id, recipient_id, type, title, body, link, metadata)
    VALUES (
      NEW.organization_id,
      v_owner_id,
      'admin_edit_financial',
      'Admin edit financial: ' || NEW.order_number,
      v_body,
      '/orders/' || NEW.id::TEXT,
      jsonb_build_object(
        'order_id', NEW.id,
        'order_number', NEW.order_number,
        'editor_id', auth.uid(),
        'editor_name', v_editor_name,
        'changes', v_changes,
        'change_lines', to_jsonb(v_change_lines)
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_owner_on_admin_financial_edit_trigger ON public.orders;
CREATE TRIGGER notify_owner_on_admin_financial_edit_trigger
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_owner_on_admin_financial_edit();

-- ============================================
-- 7. Trigger: block admin direct edit of actual / payout
-- ============================================
CREATE OR REPLACE FUNCTION public.orders_block_admin_direct_actual_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Bypass via RPC update_order_from_rekonsil (set_config 'true' di sana)
  IF current_setting('grandbook.bypass_actual_check', TRUE) = 'true' THEN
    RETURN NEW;
  END IF;

  v_role := public.get_user_role();
  IF v_role IN ('admin', 'akunting') THEN
    IF NEW.shipping_cost_actual IS DISTINCT FROM OLD.shipping_cost_actual THEN
      RAISE EXCEPTION 'shipping_cost_actual hanya bisa diubah via halaman /reconciliation';
    END IF;
    IF NEW.payout_amount IS DISTINCT FROM OLD.payout_amount THEN
      RAISE EXCEPTION 'payout_amount hanya bisa diubah via halaman /reconciliation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_block_admin_actual_trigger ON public.orders;
CREATE TRIGGER orders_block_admin_actual_trigger
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_block_admin_direct_actual_edit();

-- ============================================
-- 8. Patch update_order_from_rekonsil — bypass actual_check setting
-- ============================================
CREATE OR REPLACE FUNCTION public.update_order_from_rekonsil(
  p_order_id BIGINT,
  p_new_status TEXT,
  p_shipping_cost_actual NUMERIC,
  p_payout_amount NUMERIC,
  p_cod_amount NUMERIC,
  p_meta_merge JSONB,
  p_status_changed_at TIMESTAMP WITH TIME ZONE,
  p_source_profile_id BIGINT,
  p_raw_status TEXT,
  p_note TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_org BIGINT;
  v_old_status TEXT;
  v_history_id BIGINT;
  v_old_meta JSONB;
BEGIN
  -- Phase 8E — allow actual_check bypass for this txn
  PERFORM set_config('grandbook.bypass_actual_check', 'true', TRUE);

  SELECT organization_id, status, COALESCE(meta, '{}'::jsonb)
    INTO v_org, v_old_status, v_old_meta
  FROM public.orders WHERE id = p_order_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_org <> public.current_org_id() THEN
    RAISE EXCEPTION 'Order not in current organization' USING ERRCODE = '42501';
  END IF;

  IF p_new_status IS NOT NULL AND p_new_status NOT IN
    ('BARU','SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR','CANCEL','FAKE') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
    SET status = COALESCE(p_new_status, status),
        shipping_cost_actual = COALESCE(p_shipping_cost_actual, shipping_cost_actual),
        payout_amount = COALESCE(p_payout_amount, payout_amount),
        cod_amount = COALESCE(p_cod_amount, cod_amount),
        meta = v_old_meta || COALESCE(p_meta_merge, '{}'::jsonb),
        status_changed_at = CASE
          WHEN p_new_status IS NOT NULL AND p_new_status <> v_old_status
            THEN COALESCE(p_status_changed_at, NOW())
          ELSE status_changed_at
        END
    WHERE id = p_order_id;

  IF p_new_status IS NOT NULL AND p_new_status <> v_old_status THEN
    UPDATE public.order_status_history
      SET source = 'converter_rekonsil',
          source_profile_id = p_source_profile_id,
          raw_status = p_raw_status,
          note = p_note
      WHERE id = (
        SELECT id FROM public.order_status_history
          WHERE order_id = p_order_id
          ORDER BY id DESC
          LIMIT 1
      )
      RETURNING id INTO v_history_id;
  END IF;

  RETURN v_history_id;
END;
$function$;

-- ============================================
-- 9. RPC: list_orders_enriched (RLS via SECURITY INVOKER)
-- ============================================
CREATE OR REPLACE FUNCTION public.list_orders_enriched(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  order_number TEXT,
  external_order_id TEXT,
  resi TEXT,
  status TEXT,
  priority TEXT,
  payment_method TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  customer_province TEXT,
  subtotal NUMERIC,
  discount NUMERIC,
  shipping_cost NUMERIC,
  shipping_cost_actual NUMERIC,
  total NUMERIC,
  payout_amount NUMERIC,
  estimated_profit NUMERIC,
  actual_profit NUMERIC,
  profit_margin_pct NUMERIC,
  shipping_diff NUMERIC,
  days_in_status INT,
  is_repeat_customer BOOLEAN,
  cs_name TEXT,
  advertiser_name TEXT,
  campaign_name TEXT,
  channel_name TEXT,
  supplier_name TEXT,
  is_multi_origin BOOLEAN,
  tags TEXT[],
  internal_note TEXT,
  customer_note TEXT,
  reject_reason TEXT,
  cs_attempts INT,
  order_date DATE,
  resi_printed_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  status_changed_at TIMESTAMPTZ,
  last_contact_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
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
  WITH filtered_orders AS (
    SELECT o.*
      FROM public.orders o
     WHERE o.organization_id = v_org_id
       AND (p_from IS NULL OR o.order_date >= p_from)
       AND (p_to   IS NULL OR o.order_date <= p_to)
       AND (p_status IS NULL OR o.status = p_status)
       AND (p_search IS NULL OR
            o.order_number  ILIKE '%' || p_search || '%' OR
            o.resi          ILIKE '%' || p_search || '%' OR
            o.customer_name ILIKE '%' || p_search || '%' OR
            o.customer_phone ILIKE '%' || p_search || '%')
  ),
  customer_counts AS (
    SELECT customer_phone, COUNT(*) AS cnt
      FROM public.orders
     WHERE organization_id = v_org_id
       AND customer_phone IS NOT NULL
       AND status NOT IN ('FAKE', 'CANCEL')
     GROUP BY customer_phone
  ),
  total AS (SELECT COUNT(*) AS cnt FROM filtered_orders)
  SELECT
    fo.id,
    fo.order_number,
    fo.external_order_id,
    fo.resi,
    fo.status,
    fo.priority,
    fo.payment_method,
    fo.customer_name,
    fo.customer_phone,
    fo.customer_city,
    fo.customer_province,
    fo.subtotal,
    fo.discount,
    fo.shipping_cost,
    fo.shipping_cost_actual,
    fo.total,
    fo.payout_amount,
    fo.estimated_profit,
    CASE
      WHEN fo.payout_amount IS NOT NULL THEN
        COALESCE(fo.payout_amount, 0)
        - COALESCE(fo.shipping_cost_actual, fo.shipping_cost, 0)
        - COALESCE((SELECT SUM(oi.hpp_snapshot * oi.qty)
                      FROM public.order_items oi WHERE oi.order_id = fo.id), 0)
      ELSE NULL
    END AS actual_profit,
    CASE
      WHEN fo.payout_amount IS NOT NULL AND fo.total > 0 THEN
        ROUND(((
          COALESCE(fo.payout_amount, 0)
          - COALESCE(fo.shipping_cost_actual, fo.shipping_cost, 0)
          - COALESCE((SELECT SUM(oi.hpp_snapshot * oi.qty)
                        FROM public.order_items oi WHERE oi.order_id = fo.id), 0)
        ) / fo.total) * 100, 2)
      ELSE NULL
    END AS profit_margin_pct,
    CASE
      WHEN fo.shipping_cost_actual IS NOT NULL THEN
        fo.shipping_cost_actual - fo.shipping_cost
      ELSE NULL
    END AS shipping_diff,
    EXTRACT(DAY FROM (NOW() - COALESCE(fo.status_changed_at, fo.created_at)))::INT AS days_in_status,
    COALESCE((
      SELECT cc.cnt > 1 FROM customer_counts cc
       WHERE cc.customer_phone = fo.customer_phone
    ), FALSE) AS is_repeat_customer,
    (SELECT full_name    FROM public.profiles         WHERE id = fo.cs_id)            AS cs_name,
    (SELECT full_name    FROM public.profiles         WHERE id = fo.advertiser_id)    AS advertiser_name,
    (SELECT campaign_name FROM public.campaigns       WHERE id = fo.campaign_id)      AS campaign_name,
    (SELECT name         FROM public.courier_channels WHERE id = fo.channel_id)       AS channel_name,
    (SELECT name         FROM public.suppliers        WHERE id = fo.origin_supplier_id) AS supplier_name,
    fo.is_multi_origin,
    fo.tags,
    fo.internal_note,
    fo.customer_note,
    fo.reject_reason,
    fo.cs_attempts,
    fo.order_date,
    fo.resi_printed_at,
    fo.picked_up_at,
    fo.delivered_at,
    fo.returned_at,
    fo.status_changed_at,
    fo.last_contact_at,
    fo.created_at,
    fo.updated_at,
    (SELECT cnt FROM total) AS total_count
  FROM filtered_orders fo
  ORDER BY fo.order_date DESC, fo.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_orders_enriched(DATE, DATE, TEXT, TEXT, INT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.list_orders_enriched(DATE, DATE, TEXT, TEXT, INT, INT) TO authenticated;

-- ============================================
-- 10. RPC: list_audit_logs (owner-only)
-- ============================================
CREATE OR REPLACE FUNCTION public.list_audit_logs(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_table_name TEXT DEFAULT NULL,
  p_action TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  user_id UUID,
  user_name TEXT,
  user_role TEXT,
  table_name TEXT,
  record_id TEXT,
  action TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := public.get_user_role();
  IF v_role <> 'owner' THEN
    RAISE EXCEPTION 'Hanya owner yang bisa akses audit log' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT a.*
      FROM public.audit_log a
     WHERE (p_from IS NULL OR a.created_at >= p_from)
       AND (p_to   IS NULL OR a.created_at <= p_to)
       AND (p_user_id IS NULL OR a.user_id = p_user_id)
       AND (p_table_name IS NULL OR a.table_name = p_table_name)
       AND (p_action IS NULL OR a.action = p_action)
       AND (p_search IS NULL OR
            a.record_id ILIKE '%' || p_search || '%' OR
            a.table_name ILIKE '%' || p_search || '%')
  ),
  total AS (SELECT COUNT(*) AS cnt FROM filtered)
  SELECT
    f.id,
    f.user_id,
    p.full_name AS user_name,
    p.role      AS user_role,
    f.table_name,
    f.record_id,
    f.action,
    f.old_value,
    f.new_value,
    f.created_at,
    (SELECT cnt FROM total) AS total_count
  FROM filtered f
  LEFT JOIN public.profiles p ON p.id = f.user_id
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_audit_logs(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.list_audit_logs(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, INT, INT) TO authenticated;

-- ============================================
-- DONE.
-- ============================================
