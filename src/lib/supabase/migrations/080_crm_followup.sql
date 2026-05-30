-- 080 — Brief #2: Modul CRM (Follow-Up Order Bermasalah)
-- ============================================================================
-- Order PROBLEM dapet workflow follow-up: antrian → catat aktivitas → resolve.
-- Keputusan Barry: SLA 48 jam · CS lihat kasus EKSPEDISI order-nya (read-only) ·
-- 4 outcome resolve (reschedule→DIKIRIM / sampai→DITERIMA / RTS→RETUR / cancel→CANCEL).
--
-- Hard constraints dijaga: 8-state status enum & 5-role enum TIDAK disentuh.
-- crm_status = field terpisah. Order-centric (field di orders + 1 tabel log).
-- org_id = bigint. Slot 080. Idempotent.

-- ----------------------------------------------------------------------------
-- 1. orders — field CRM (reuse cs_attempts / last_contact_at / reject_reason)
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS problem_type text
    CHECK (problem_type IN ('PEMBELI','EKSPEDISI')),
  ADD COLUMN IF NOT EXISTS crm_status text
    CHECK (crm_status IN ('OPEN','IN_PROGRESS','RESOLVED','ESCALATED')),
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS problem_opened_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_crm_status ON public.orders(crm_status) WHERE crm_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_problem_type ON public.orders(problem_type) WHERE problem_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_assigned_to ON public.orders(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_sla_due_at ON public.orders(sla_due_at) WHERE sla_due_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Seed default config CRM ke organizations.settings (kalau belum ada)
-- ----------------------------------------------------------------------------
UPDATE public.organizations
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{crm}',
  COALESCE(settings->'crm', '{}'::jsonb) || jsonb_build_object(
    'sla_hours', 48,
    'problem_type_default', 'EKSPEDISI',
    'wa_templates', jsonb_build_object(
      'PEMBELI', 'Halo kak {nama}, saya dari tim CS terkait pesanan {order_number}. Boleh konfirmasi mengenai pengiriman paketnya? Terima kasih 🙏',
      'EKSPEDISI', 'Halo kak {nama}, paket pesanan {order_number} (resi {resi}) sedang kami follow up ke ekspedisi. Mohon ditunggu ya.'
    )
  ),
  true
)
WHERE settings->'crm' IS NULL OR settings->'crm'->'sla_hours' IS NULL;

-- ----------------------------------------------------------------------------
-- 3. Trigger: set field CRM saat order MASUK status PROBLEM. BEFORE supaya
--    NEW.* effective tanpa second update. Auto problem_type dari settings
--    default (admin override di UI). Saat KELUAR PROBLEM → crm_status RESOLVED.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_crm_on_problem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg jsonb;
BEGIN
  IF NEW.status = 'PROBLEM'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'PROBLEM') THEN
    SELECT settings -> 'crm' INTO v_cfg FROM public.organizations WHERE id = NEW.organization_id;
    NEW.crm_status := COALESCE(NEW.crm_status, 'OPEN');
    NEW.problem_opened_at := COALESCE(NEW.problem_opened_at, now());
    NEW.sla_due_at := COALESCE(
      NEW.sla_due_at,
      now() + (COALESCE((v_cfg ->> 'sla_hours')::int, 48) || ' hours')::interval
    );
    NEW.problem_type := COALESCE(NEW.problem_type, v_cfg ->> 'problem_type_default', 'EKSPEDISI');
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> 'PROBLEM' AND OLD.status = 'PROBLEM' THEN
    -- order keluar dari PROBLEM (resolve / transisi lain) → tutup kasus
    IF NEW.crm_status IS DISTINCT FROM 'RESOLVED' THEN
      NEW.crm_status := 'RESOLVED';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_crm_on_problem ON public.orders;
CREATE TRIGGER trg_set_crm_on_problem
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_crm_on_problem();

-- ----------------------------------------------------------------------------
-- 4. Tabel crm_activities (log follow-up per order)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_activities (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES public.organizations(id),
  order_id        bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('WA','TELEPON','EKSPEDISI','LAIN')),
  result          text,
  note            text,
  next_action     text,
  next_due_at     timestamptz,
  created_by      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_order_id ON public.crm_activities(order_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_organization_id ON public.crm_activities(organization_id);

ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_activities_select ON public.crm_activities;
CREATE POLICY crm_activities_select ON public.crm_activities
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));

DROP POLICY IF EXISTS crm_activities_insert ON public.crm_activities;
CREATE POLICY crm_activities_insert ON public.crm_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND public.get_user_role() IN ('owner','admin','cs')
  );

GRANT SELECT, INSERT ON public.crm_activities TO authenticated;

-- 4b. AFTER INSERT → update orders.last_contact_at + cs_attempts (reuse field).
CREATE OR REPLACE FUNCTION public.trg_crm_activity_touch_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.orders
    SET last_contact_at = now(),
        cs_attempts = COALESCE(cs_attempts, 0) + 1,
        updated_at = now()
    WHERE id = NEW.order_id;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_crm_activity_touch_order ON public.crm_activities;
CREATE TRIGGER trg_crm_activity_touch_order
  AFTER INSERT ON public.crm_activities
  FOR EACH ROW EXECUTE FUNCTION public.trg_crm_activity_touch_order();

-- ----------------------------------------------------------------------------
-- 5. Audit perubahan crm_status / assigned_to (pattern existing, hanya log
--    perubahan manual, bukan tiap update).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_orders_crm_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (OLD.crm_status IS DISTINCT FROM NEW.crm_status)
     OR (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to)
     OR (OLD.problem_type IS DISTINCT FROM NEW.problem_type) THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (
      auth.uid(), 'orders', NEW.id::text, 'CRM_UPDATE',
      jsonb_build_object('crm_status', OLD.crm_status, 'assigned_to', OLD.assigned_to, 'problem_type', OLD.problem_type),
      jsonb_build_object('crm_status', NEW.crm_status, 'assigned_to', NEW.assigned_to, 'problem_type', NEW.problem_type)
    );
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_crm_audit ON public.orders;
CREATE TRIGGER trg_orders_crm_audit
  AFTER UPDATE OF crm_status, assigned_to, problem_type ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_orders_crm_audit();

REVOKE EXECUTE ON FUNCTION public.set_crm_on_problem() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_crm_activity_touch_order() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_orders_crm_audit() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC list_crm_cases — antrian role-aware. owner/admin lihat semua PROBLEM;
--    cs lihat order-nya sendiri (cs_id = me, PEMBELI + EKSPEDISI read-only);
--    akunting kosong. SECURITY INVOKER (RLS scope org).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_crm_cases(text, text, text, boolean, date, date, int, int);
CREATE OR REPLACE FUNCTION public.list_crm_cases(
  p_problem_type text DEFAULT NULL,     -- 'PEMBELI' | 'EKSPEDISI' | NULL
  p_crm_status   text DEFAULT NULL,     -- OPEN|IN_PROGRESS|ESCALATED|RESOLVED | NULL
  p_scope        text DEFAULT 'all',    -- 'mine' | 'all'
  p_overdue      boolean DEFAULT NULL,  -- true = overdue saja
  p_from         date DEFAULT NULL,
  p_to           date DEFAULT NULL,
  p_limit        int DEFAULT 100,
  p_offset       int DEFAULT 0
)
RETURNS TABLE (
  id               bigint,
  order_number     text,
  order_date       date,
  customer_name    text,
  customer_phone   text,
  status           text,
  problem_type     text,
  crm_status       text,
  reject_reason    text,
  priority         text,
  cs_id            uuid,
  cs_name          text,
  assigned_to      uuid,
  sla_due_at       timestamptz,
  problem_opened_at timestamptz,
  last_contact_at  timestamptz,
  cs_attempts      int,
  days_in_problem  int,
  is_overdue       boolean,
  can_act          boolean,
  total_count      bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_role text := public.get_user_role();
  v_uid  uuid := (SELECT auth.uid());
BEGIN
  IF v_role NOT IN ('owner','admin','cs') THEN
    RETURN;  -- akunting/advertiser: no access
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT o.*
    FROM public.orders o
    WHERE o.organization_id = (SELECT public.current_org_id())
      AND o.status = 'PROBLEM'
      AND (v_role IN ('owner','admin') OR o.cs_id = v_uid)            -- cs: order sendiri
      AND (p_problem_type IS NULL OR o.problem_type = p_problem_type)
      AND (p_crm_status IS NULL OR o.crm_status = p_crm_status)
      AND (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to IS NULL OR o.order_date <= p_to)
      AND (
        p_scope <> 'mine'
        OR o.assigned_to = v_uid OR o.cs_id = v_uid
      )
      AND (
        p_overdue IS NOT TRUE
        OR (o.sla_due_at IS NOT NULL AND now() > o.sla_due_at AND o.crm_status <> 'RESOLVED')
      )
  )
  SELECT
    f.id, f.order_number, f.order_date, f.customer_name, f.customer_phone, f.status,
    f.problem_type, f.crm_status, f.reject_reason, f.priority,
    f.cs_id, f.cs_name, f.assigned_to, f.sla_due_at, f.problem_opened_at,
    f.last_contact_at, f.cs_attempts,
    GREATEST(0, EXTRACT(DAY FROM now() - COALESCE(f.problem_opened_at, now()))::int) AS days_in_problem,
    (f.sla_due_at IS NOT NULL AND now() > f.sla_due_at AND f.crm_status <> 'RESOLVED') AS is_overdue,
    -- CS hanya boleh aksi di kasus PEMBELI (EKSPEDISI read-only); owner/admin selalu boleh
    (v_role IN ('owner','admin') OR (f.cs_id = v_uid AND f.problem_type = 'PEMBELI')) AS can_act,
    (SELECT count(*) FROM filtered) AS total_count
  FROM filtered f
  ORDER BY is_overdue DESC, f.sla_due_at ASC NULLS LAST, f.problem_opened_at ASC NULLS LAST
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_crm_cases(text, text, text, boolean, date, date, int, int) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC resolve_crm_case — set crm RESOLVED + transisi main-status lewat
--    UPDATE status (fire trigger komisi/cost/history existing). 4 outcome.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_crm_case(bigint, text, text);
CREATE OR REPLACE FUNCTION public.resolve_crm_case(
  p_order_id bigint,
  p_outcome  text,       -- 'DIKIRIM' | 'DITERIMA' | 'RETUR' | 'CANCEL'
  p_note     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org bigint; v_cs uuid; v_old text; v_ptype text;
  v_role text := public.get_user_role();
  v_uid  uuid := (SELECT auth.uid());
BEGIN
  IF p_outcome NOT IN ('DIKIRIM','DITERIMA','RETUR','CANCEL') THEN
    RAISE EXCEPTION 'Outcome tidak valid: % (harus DIKIRIM/DITERIMA/RETUR/CANCEL)', p_outcome;
  END IF;

  SELECT organization_id, cs_id, status, problem_type INTO v_org, v_cs, v_old, v_ptype
  FROM public.orders WHERE id = p_order_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF v_org <> (SELECT public.current_org_id()) THEN RAISE EXCEPTION 'Order di luar organisasi'; END IF;

  -- CS cuma boleh resolve kasus PEMBELI order-nya sendiri.
  IF v_role = 'cs' AND NOT (v_cs = v_uid AND v_ptype = 'PEMBELI') THEN
    RAISE EXCEPTION 'CS hanya boleh resolve kasus PEMBELI order sendiri' USING ERRCODE = '42501';
  ELSIF v_role NOT IN ('owner','admin','cs') THEN
    RAISE EXCEPTION 'Tidak punya akses resolve' USING ERRCODE = '42501';
  END IF;

  -- Transisi: trigger set_crm_on_problem auto set crm_status=RESOLVED saat keluar PROBLEM.
  UPDATE public.orders
    SET status = p_outcome, status_changed_at = now(), updated_at = now()
    WHERE id = p_order_id;

  INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
  VALUES (
    v_uid, 'orders', p_order_id::text, 'CRM_RESOLVE',
    jsonb_build_object('status', v_old, 'problem_type', v_ptype),
    jsonb_build_object('status', p_outcome, 'crm_status', 'RESOLVED', 'note', p_note)
  );

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'new_status', p_outcome);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_crm_case(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_crm_case(bigint, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. get_sidebar_counts — tambah crm_my_cases + crm_overdue (role-aware).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_sidebar_counts();
CREATE OR REPLACE FUNCTION public.get_sidebar_counts()
RETURNS TABLE(drafts_total bigint, drafts_baru bigint, drafts_problem bigint, supplier_payable_pending bigint, inbox_pending_review bigint, inbox_unmatched_resi bigint, inbox_unmapped_statuses bigint, inbox_address_review bigint, inbox_phone_review bigint, commissions_earned bigint, attribution_required bigint, crm_my_cases bigint, crm_overdue bigint)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT := public.current_org_id();
  v_role   text := public.get_user_role();
  v_uid    uuid := (SELECT auth.uid());
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.orders_draft WHERE organization_id = v_org_id)::BIGINT,
    (SELECT COUNT(*) FROM public.orders_draft WHERE organization_id = v_org_id AND status = 'BARU')::BIGINT,
    (SELECT COUNT(*) FROM public.orders_draft WHERE organization_id = v_org_id AND status = 'PROBLEM')::BIGINT,
    (SELECT COUNT(*) FROM public.supplier_payable WHERE organization_id = v_org_id AND status = 'PENDING')::BIGINT,
    (SELECT COUNT(*) FROM public.orders WHERE organization_id = v_org_id AND status = 'BARU')::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_unmatched_resi WHERE organization_id = v_org_id AND resolved = FALSE)::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_unmapped_statuses WHERE organization_id = v_org_id AND resolved = FALSE)::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_unparsed_address WHERE organization_id = v_org_id AND resolved_at IS NULL)::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_invalid_phone WHERE organization_id = v_org_id AND resolved_at IS NULL)::BIGINT,
    (SELECT COUNT(*) FROM public.commissions c JOIN public.orders o ON o.id = c.order_id
       WHERE o.organization_id = v_org_id AND c.status = 'EARNED')::BIGINT,
    (SELECT COUNT(*) FROM public.orders WHERE organization_id = v_org_id AND (cs_id IS NULL OR advertiser_id IS NULL))::BIGINT,
    -- CRM: kasus-ku (PROBLEM, belum resolved). cs → order sendiri; owner/admin → semua.
    (SELECT COUNT(*) FROM public.orders
       WHERE organization_id = v_org_id AND status = 'PROBLEM'
         AND crm_status IS DISTINCT FROM 'RESOLVED'
         AND (v_role IN ('owner','admin') OR cs_id = v_uid))::BIGINT,
    (SELECT COUNT(*) FROM public.orders
       WHERE organization_id = v_org_id AND status = 'PROBLEM'
         AND crm_status IS DISTINCT FROM 'RESOLVED'
         AND sla_due_at IS NOT NULL AND now() > sla_due_at
         AND (v_role IN ('owner','admin') OR cs_id = v_uid))::BIGINT;
END;
$function$;
