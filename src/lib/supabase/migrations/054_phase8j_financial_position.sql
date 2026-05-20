-- =============================================================
-- PHASE 8J: Inventory & Deposit Dashboard — Financial Position v1
-- =============================================================
-- Goal: Barry mau tau "duit gw ada di mana" — 3 bucket utama:
--   1. Saldo SPX (yang bisa di-withdraw)        ← from bank_withdrawals.balance_after
--   2. In-transit COD (resi cetak, belum settle) ← aggregate orders
--   3. HPP terutang ke supplier (dropship)       ← new table supplier_payable
--
-- Schema baru:
--   - supplier_payable: snapshot per order_item × supplier saat order shipped
--   - Trigger auto-populate saat status → DIKIRIM/DITERIMA
--   - Owner/admin mark as paid via UI (Phase 8J-v2)
--
-- RPC v1: get_financial_position() return 3 aggregate.
-- RPC drilldown: list_in_transit_cod, list_supplier_payable_groups.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + DROP IF EXISTS + CREATE OR REPLACE.
-- =============================================================

-- =============================================================
-- 1. TABLE: supplier_payable
-- =============================================================
-- Per order × supplier: snapshot HPP cost yang Barry "berhutang" ke supplier.
-- Status:
--   - PENDING : order shipped, supplier belum dibayar (default)
--   - PAID    : owner/admin tandain sudah ditransfer
--   - VOIDED  : order retur/cancel → HPP cost di-batalin
-- =============================================================
CREATE TABLE IF NOT EXISTS public.supplier_payable (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES public.suppliers(id),

  -- Snapshot saat trigger fire (lock biaya supaya audit-safe)
  hpp_total NUMERIC(12,2) NOT NULL DEFAULT 0,    -- sum(qty × hpp_snapshot) per order×supplier
  qty_total INTEGER NOT NULL DEFAULT 0,           -- sum qty per order×supplier

  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PAID','VOIDED')),

  -- Payment audit
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES public.profiles(id),
  payment_reference TEXT,
  payment_note TEXT,

  -- Snapshot timestamps
  shipped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT supplier_payable_order_supplier_unique UNIQUE (order_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_org_status ON public.supplier_payable(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_sp_supplier ON public.supplier_payable(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_sp_order ON public.supplier_payable(order_id);

-- RLS — owner+admin+akunting read; owner+admin manage
ALTER TABLE public.supplier_payable ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sp_select ON public.supplier_payable;
CREATE POLICY sp_select ON public.supplier_payable
  FOR SELECT USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner','admin','akunting')
  );

DROP POLICY IF EXISTS sp_insert ON public.supplier_payable;
CREATE POLICY sp_insert ON public.supplier_payable
  FOR INSERT WITH CHECK (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner','admin')
  );

DROP POLICY IF EXISTS sp_update ON public.supplier_payable;
CREATE POLICY sp_update ON public.supplier_payable
  FOR UPDATE USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner','admin')
  )
  WITH CHECK (organization_id = public.current_org_id());

DROP POLICY IF EXISTS sp_delete ON public.supplier_payable;
CREATE POLICY sp_delete ON public.supplier_payable
  FOR DELETE USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() = 'owner'
  );

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_set_updated_at_supplier_payable ON public.supplier_payable;
CREATE TRIGGER trg_set_updated_at_supplier_payable
  BEFORE UPDATE ON public.supplier_payable
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================
-- 2. Trigger function: auto-populate supplier_payable saat order shipped
-- =============================================================
CREATE OR REPLACE FUNCTION public.populate_supplier_payable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Fire saat status berubah ke DIKIRIM/DITERIMA (resi sudah dipakai)
  IF (TG_OP = 'UPDATE' AND NEW.status IN ('DIKIRIM','DITERIMA') AND (OLD.status IS NULL OR OLD.status NOT IN ('DIKIRIM','DITERIMA')))
     OR (TG_OP = 'INSERT' AND NEW.status IN ('DIKIRIM','DITERIMA')) THEN

    -- Insert 1 row per (order, supplier) — aggregate hpp from items
    INSERT INTO public.supplier_payable(
      organization_id, order_id, supplier_id, hpp_total, qty_total, shipped_at
    )
    SELECT
      NEW.organization_id,
      NEW.id,
      p.supplier_id,
      COALESCE(SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)), 0),
      COALESCE(SUM(oi.qty), 0),
      NOW()
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = NEW.id
      AND p.supplier_id IS NOT NULL
    GROUP BY p.supplier_id
    ON CONFLICT (order_id, supplier_id) DO NOTHING;  -- idempotent
  END IF;

  -- Void on RETUR/CANCEL/FAKE (kalau ada payable PENDING untuk order ini)
  IF (TG_OP = 'UPDATE' AND NEW.status IN ('RETUR','CANCEL','FAKE')
      AND OLD.status NOT IN ('RETUR','CANCEL','FAKE')) THEN
    UPDATE public.supplier_payable
    SET status = 'VOIDED', updated_at = NOW()
    WHERE order_id = NEW.id AND status = 'PENDING';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.populate_supplier_payable() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS trg_populate_supplier_payable ON public.orders;
CREATE TRIGGER trg_populate_supplier_payable
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.populate_supplier_payable();

-- =============================================================
-- 3. Backfill existing orders DIKIRIM/DITERIMA
-- =============================================================
INSERT INTO public.supplier_payable(
  organization_id, order_id, supplier_id, hpp_total, qty_total, shipped_at, status
)
SELECT
  o.organization_id,
  o.id,
  p.supplier_id,
  COALESCE(SUM(oi.qty * COALESCE(oi.hpp_snapshot, 0)), 0),
  COALESCE(SUM(oi.qty), 0),
  COALESCE(o.picked_up_at, o.status_changed_at, o.created_at),
  CASE WHEN o.status IN ('RETUR','CANCEL','FAKE') THEN 'VOIDED' ELSE 'PENDING' END
FROM public.orders o
JOIN public.order_items oi ON oi.order_id = o.id
LEFT JOIN public.products p ON p.id = oi.product_id
WHERE o.status IN ('DIKIRIM','DITERIMA','RETUR')
  AND p.supplier_id IS NOT NULL
GROUP BY o.organization_id, o.id, p.supplier_id, o.picked_up_at, o.status_changed_at, o.created_at, o.status
ON CONFLICT (order_id, supplier_id) DO NOTHING;

-- =============================================================
-- 4. Audit trigger (mirror Phase 8E pattern)
-- =============================================================
CREATE OR REPLACE FUNCTION public.audit_log_supplier_payable_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, new_value)
    VALUES (v_user_id, 'supplier_payable', NEW.id::text, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (v_user_id, 'supplier_payable', NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value)
    VALUES (v_user_id, 'supplier_payable', OLD.id::text, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_log_supplier_payable_trigger() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS trg_audit_log_supplier_payable ON public.supplier_payable;
CREATE TRIGGER trg_audit_log_supplier_payable
  AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payable
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_supplier_payable_trigger();

-- =============================================================
-- 5. RPC: get_financial_position()
-- =============================================================
DROP FUNCTION IF EXISTS public.get_financial_position();

CREATE OR REPLACE FUNCTION public.get_financial_position()
RETURNS TABLE(
  saldo_spx NUMERIC,
  saldo_spx_updated_at TIMESTAMPTZ,
  in_transit_cod NUMERIC,
  in_transit_orders BIGINT,
  hpp_supplier_owed NUMERIC,
  hpp_supplier_orders BIGINT,
  hpp_supplier_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  RETURN QUERY
  SELECT
    -- Saldo SPX: balance_after dari withdrawal terbaru (Phase 8I-v2)
    COALESCE((
      SELECT balance_after FROM public.bank_withdrawals
      WHERE organization_id = v_org_id AND status IN ('APPROVED','COMPLETED')
      ORDER BY withdrawal_date DESC, id DESC LIMIT 1
    ), 0) AS saldo_spx,
    (
      SELECT MAX(withdrawal_date) FROM public.bank_withdrawals
      WHERE organization_id = v_org_id
    ) AS saldo_spx_updated_at,

    -- In-transit COD: sum cod_amount untuk order yang masih SIAP_KIRIM/DIKIRIM
    COALESCE((
      SELECT SUM(cod_amount) FROM public.orders
      WHERE organization_id = v_org_id
        AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD'
        AND cod_amount IS NOT NULL
    ), 0) AS in_transit_cod,
    (
      SELECT COUNT(*) FROM public.orders
      WHERE organization_id = v_org_id
        AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD'
    )::BIGINT AS in_transit_orders,

    -- HPP terutang supplier (sum PENDING)
    COALESCE((
      SELECT SUM(hpp_total) FROM public.supplier_payable
      WHERE organization_id = v_org_id AND status = 'PENDING'
    ), 0) AS hpp_supplier_owed,
    (
      SELECT COUNT(*) FROM public.supplier_payable
      WHERE organization_id = v_org_id AND status = 'PENDING'
    )::BIGINT AS hpp_supplier_orders,
    (
      SELECT COUNT(DISTINCT supplier_id) FROM public.supplier_payable
      WHERE organization_id = v_org_id AND status = 'PENDING'
    )::INTEGER AS hpp_supplier_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_financial_position() TO authenticated;

-- =============================================================
-- 6. RPC: list_supplier_payable_groups
-- Per-supplier aggregate: hpp owed + order count + oldest unpaid date
-- =============================================================
DROP FUNCTION IF EXISTS public.list_supplier_payable_groups(text);

CREATE OR REPLACE FUNCTION public.list_supplier_payable_groups(
  p_status TEXT DEFAULT 'PENDING'
)
RETURNS TABLE(
  supplier_id BIGINT,
  supplier_code TEXT,
  supplier_name TEXT,
  total_owed NUMERIC,
  order_count BIGINT,
  qty_total BIGINT,
  oldest_shipped_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  RETURN QUERY
  SELECT
    sp.supplier_id,
    s.code AS supplier_code,
    s.name AS supplier_name,
    SUM(sp.hpp_total) AS total_owed,
    COUNT(*)::BIGINT AS order_count,
    SUM(sp.qty_total)::BIGINT AS qty_total,
    MIN(sp.shipped_at) AS oldest_shipped_at
  FROM public.supplier_payable sp
  JOIN public.suppliers s ON s.id = sp.supplier_id
  WHERE sp.organization_id = v_org_id
    AND sp.status = p_status
  GROUP BY sp.supplier_id, s.code, s.name
  ORDER BY total_owed DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_supplier_payable_groups(text) TO authenticated;

-- =============================================================
-- 7. RPC: mark_supplier_payable_paid (bulk)
-- =============================================================
DROP FUNCTION IF EXISTS public.mark_supplier_payable_paid(bigint[], text, text);

CREATE OR REPLACE FUNCTION public.mark_supplier_payable_paid(
  p_payable_ids BIGINT[],
  p_payment_reference TEXT DEFAULT NULL,
  p_payment_note TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role TEXT;
  v_org_id BIGINT;
  v_updated INTEGER;
BEGIN
  v_role := public.get_user_role();
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Hanya owner/admin yang bisa mark paid' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.current_org_id();

  UPDATE public.supplier_payable
  SET status = 'PAID',
      paid_at = NOW(),
      paid_by = auth.uid(),
      payment_reference = p_payment_reference,
      payment_note = p_payment_note,
      updated_at = NOW()
  WHERE id = ANY(p_payable_ids)
    AND organization_id = v_org_id
    AND status = 'PENDING';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_supplier_payable_paid(bigint[], text, text) TO authenticated;
