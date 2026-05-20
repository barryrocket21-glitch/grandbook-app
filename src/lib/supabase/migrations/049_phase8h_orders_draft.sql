-- =============================================================
-- PHASE 8H: orders_draft Physical Separation
-- =============================================================
-- Problem: 140 order baru di-input Indra hari ini kecampur dengan
-- 1067 backfill SPX di /orders/list (semua status SIAP_KIRIM).
-- Solution: physical 2-table split:
--   - orders_draft  (workspace: BARU/SIAP_KIRIM tanpa resi)
--   - orders        (archive: semua data settled, resi sudah ada)
-- Auto-promote trigger: BEGITU resi keisi → row dipindah dari draft → orders.
--
-- IDEMPOTENT: safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS).
-- =============================================================

-- =============================================================
-- 1. TABLE: orders_draft
-- =============================================================
-- Struktur identik dengan orders KECUALI:
-- - Tidak ada kolom actual (shipping_cost_actual, payout_amount, cod_settled_at)
-- - Tidak ada kolom delivered_at / returned_at / picked_up_at (cuma di archive)
-- - Tidak ada raw_data / notes / meta (yang ini ada untuk audit di archive)
-- - Status terbatas: BARU, SIAP_KIRIM, PROBLEM, CANCEL
-- =============================================================
CREATE TABLE IF NOT EXISTS public.orders_draft (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),

  -- Order identity
  order_number TEXT NOT NULL,
  external_order_id TEXT,
  resi TEXT,  -- NULL by definition. Begitu keisi → auto-promote ke orders
  source_profile_id BIGINT REFERENCES public.converter_profiles(id),
  channel_id BIGINT REFERENCES public.courier_channels(id),

  -- Customer info
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_province TEXT,
  customer_city TEXT,
  customer_subdistrict TEXT,
  customer_village TEXT,
  customer_zip TEXT,
  customer_address_detail TEXT,
  customer_address TEXT,
  wilayah_id BIGINT REFERENCES public.master_wilayah(id),

  -- Financial (estimated only, no actuals)
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  cod_amount NUMERIC(12,2),

  estimated_shipping_net NUMERIC,
  estimated_cod_fee NUMERIC,
  estimated_ppn NUMERIC,
  estimated_total_cost NUMERIC,
  estimated_cash_in NUMERIC,
  estimated_profit NUMERIC,

  -- Status (limited enum untuk draft)
  payment_method TEXT NOT NULL DEFAULT 'COD'
    CHECK (payment_method IN ('COD','TRANSFER')),
  status TEXT NOT NULL DEFAULT 'BARU'
    CHECK (status IN ('BARU','SIAP_KIRIM','PROBLEM','CANCEL')),
  status_changed_at TIMESTAMPTZ DEFAULT NOW(),
  priority TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  rate_snapshot JSONB,

  -- Team assignment
  cs_id UUID REFERENCES public.profiles(id),
  cs_name TEXT,
  advertiser_id UUID REFERENCES public.profiles(id),
  admin_id UUID REFERENCES public.profiles(id),
  campaign_id BIGINT REFERENCES public.campaigns(id),
  origin_supplier_id BIGINT REFERENCES public.suppliers(id),
  is_multi_origin BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.profiles(id),

  -- Misc (preserved untuk converter inbound)
  notes TEXT,
  meta JSONB,
  raw_data JSONB,

  -- Notes & CS workflow
  internal_note TEXT,
  customer_note TEXT,
  reject_reason TEXT,
  cs_attempts INTEGER NOT NULL DEFAULT 0,
  last_contact_at TIMESTAMPTZ,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Timestamps
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  resi_printed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT orders_draft_org_number_unique UNIQUE (organization_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_orders_draft_org_date ON public.orders_draft(organization_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_draft_status ON public.orders_draft(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_draft_cs ON public.orders_draft(cs_id) WHERE cs_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_draft_created_at ON public.orders_draft(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_draft_external ON public.orders_draft(external_order_id)
  WHERE external_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_draft_channel ON public.orders_draft(channel_id);
CREATE INDEX IF NOT EXISTS idx_orders_draft_advertiser ON public.orders_draft(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_orders_draft_wilayah ON public.orders_draft(wilayah_id);

-- =============================================================
-- 2. TABLE: order_items_draft
-- =============================================================
CREATE TABLE IF NOT EXISTS public.order_items_draft (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  order_id BIGINT NOT NULL REFERENCES public.orders_draft(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES public.products(id),
  variant_id BIGINT REFERENCES public.product_variants(id),
  product_name_raw TEXT NOT NULL,
  variation TEXT,
  product_code_raw TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  weight_per_unit NUMERIC(8,2),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  hpp_snapshot NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_draft_order ON public.order_items_draft(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_draft_product ON public.order_items_draft(product_id);

-- =============================================================
-- 3. RLS — orders_draft (stricter: owner/admin/cs untuk insert/update; owner/admin only delete)
-- =============================================================
ALTER TABLE public.orders_draft ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_draft_select ON public.orders_draft;
CREATE POLICY orders_draft_select ON public.orders_draft
  FOR SELECT
  USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS orders_draft_insert ON public.orders_draft;
CREATE POLICY orders_draft_insert ON public.orders_draft
  FOR INSERT
  WITH CHECK (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin', 'cs')
  );

DROP POLICY IF EXISTS orders_draft_update ON public.orders_draft;
CREATE POLICY orders_draft_update ON public.orders_draft
  FOR UPDATE
  USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin', 'cs')
  )
  WITH CHECK (organization_id = public.current_org_id());

DROP POLICY IF EXISTS orders_draft_delete ON public.orders_draft;
CREATE POLICY orders_draft_delete ON public.orders_draft
  FOR DELETE
  USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin')
  );

-- =============================================================
-- 4. RLS — order_items_draft (permissive in-org sama dengan order_items)
-- =============================================================
ALTER TABLE public.order_items_draft ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS items_draft_all ON public.order_items_draft;
CREATE POLICY items_draft_all ON public.order_items_draft
  FOR ALL
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- =============================================================
-- 5. set_updated_at trigger
-- =============================================================
DROP TRIGGER IF EXISTS trg_set_updated_at_orders_draft ON public.orders_draft;
CREATE TRIGGER trg_set_updated_at_orders_draft
  BEFORE UPDATE ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================
-- 6. Audit triggers (mirror Phase 8E pattern untuk orders_draft + order_items_draft)
-- =============================================================
CREATE OR REPLACE FUNCTION public.audit_log_orders_draft_trigger()
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
    VALUES (v_user_id, 'orders_draft', NEW.id::text, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (v_user_id, 'orders_draft', NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value)
    VALUES (v_user_id, 'orders_draft', OLD.id::text, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_orders_draft ON public.orders_draft;
CREATE TRIGGER trg_audit_log_orders_draft
  AFTER INSERT OR UPDATE OR DELETE ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_orders_draft_trigger();

CREATE OR REPLACE FUNCTION public.audit_log_order_items_draft_trigger()
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
    VALUES (v_user_id, 'order_items_draft', NEW.id::text, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (v_user_id, 'order_items_draft', NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value)
    VALUES (v_user_id, 'order_items_draft', OLD.id::text, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_order_items_draft ON public.order_items_draft;
CREATE TRIGGER trg_audit_log_order_items_draft
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items_draft
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_order_items_draft_trigger();

-- =============================================================
-- 7. Auto-promote trigger: draft → orders saat resi diisi
-- =============================================================
-- Core logic: kalau `resi` di-set non-NULL (was NULL) → row migrate
-- ke `orders` + order_items_draft → order_items + delete draft row.
-- Status di archive default = SIAP_KIRIM (siap dikirim ke courier).
-- Audit log catat PROMOTE_TO_ORDERS event untuk traceability.
-- =============================================================
CREATE OR REPLACE FUNCTION public.promote_draft_to_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_order_id BIGINT;
  v_archive_status TEXT;
BEGIN
  -- Hanya fire kalau resi di-set dari NULL/empty → non-NULL
  IF NEW.resi IS NOT NULL AND TRIM(NEW.resi) <> ''
     AND (OLD.resi IS NULL OR TRIM(OLD.resi) = '') THEN

    -- Archive status: kalau draft status PROBLEM/CANCEL preserve,
    -- else default ke SIAP_KIRIM (resi sudah ada = siap kirim).
    v_archive_status := CASE
      WHEN NEW.status IN ('PROBLEM','CANCEL') THEN NEW.status
      ELSE 'SIAP_KIRIM'
    END;

    -- 1. INSERT ke orders (copy semua field yang relevan)
    INSERT INTO public.orders(
      organization_id, order_number, external_order_id, resi,
      source_profile_id, channel_id,
      customer_name, customer_phone, customer_province, customer_city,
      customer_subdistrict, customer_village, customer_zip,
      customer_address_detail, customer_address, wilayah_id,
      subtotal, shipping_cost, discount, total, cod_amount,
      estimated_shipping_net, estimated_cod_fee, estimated_ppn,
      estimated_total_cost, estimated_cash_in, estimated_profit,
      payment_method, status, status_changed_at, priority, rate_snapshot,
      cs_id, cs_name, advertiser_id, admin_id, campaign_id,
      origin_supplier_id, is_multi_origin, created_by,
      notes, meta, raw_data,
      internal_note, customer_note, reject_reason, cs_attempts,
      last_contact_at, tags,
      order_date, resi_printed_at,
      created_at, updated_at
    )
    VALUES (
      NEW.organization_id, NEW.order_number, NEW.external_order_id, NEW.resi,
      NEW.source_profile_id, NEW.channel_id,
      NEW.customer_name, NEW.customer_phone, NEW.customer_province, NEW.customer_city,
      NEW.customer_subdistrict, NEW.customer_village, NEW.customer_zip,
      NEW.customer_address_detail, NEW.customer_address, NEW.wilayah_id,
      NEW.subtotal, NEW.shipping_cost, NEW.discount, NEW.total, NEW.cod_amount,
      NEW.estimated_shipping_net, NEW.estimated_cod_fee, NEW.estimated_ppn,
      NEW.estimated_total_cost, NEW.estimated_cash_in, NEW.estimated_profit,
      NEW.payment_method, v_archive_status, NOW(), NEW.priority, NEW.rate_snapshot,
      NEW.cs_id, NEW.cs_name, NEW.advertiser_id, NEW.admin_id, NEW.campaign_id,
      NEW.origin_supplier_id, NEW.is_multi_origin, NEW.created_by,
      NEW.notes, NEW.meta, NEW.raw_data,
      NEW.internal_note, NEW.customer_note, NEW.reject_reason, NEW.cs_attempts,
      NEW.last_contact_at, NEW.tags,
      NEW.order_date, COALESCE(NEW.resi_printed_at, NOW()),
      NEW.created_at, NOW()
    )
    RETURNING id INTO v_new_order_id;

    -- 2. INSERT order_items_draft → order_items
    INSERT INTO public.order_items(
      organization_id, order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, notes
    )
    SELECT
      organization_id, v_new_order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, notes
    FROM public.order_items_draft
    WHERE order_id = NEW.id;

    -- 3. Log to audit_log (event: promotion) — explicit untuk traceability
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (
      auth.uid(),
      'orders_draft',
      NEW.id::text,
      'PROMOTE_TO_ORDERS',
      jsonb_build_object('draft_id', NEW.id, 'order_number', NEW.order_number),
      jsonb_build_object('orders_id', v_new_order_id, 'resi', NEW.resi, 'archive_status', v_archive_status)
    );

    -- 4. DELETE dari orders_draft (cascade auto-delete order_items_draft)
    DELETE FROM public.orders_draft WHERE id = NEW.id;

    -- Return NULL untuk cancel update operation (row sudah ter-delete)
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_draft_to_orders ON public.orders_draft;
CREATE TRIGGER trg_promote_draft_to_orders
  BEFORE UPDATE OF resi ON public.orders_draft
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_draft_to_orders();

-- =============================================================
-- 8. RPC: list_orders_draft_enriched
-- =============================================================
-- Mirror dari list_orders_enriched tapi target orders_draft.
-- Cuma field yang relevan untuk Antrian Kerja (no actuals/cashflow).
-- =============================================================
DROP FUNCTION IF EXISTS public.list_orders_draft_enriched(date, date, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.list_orders_draft_enriched(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id BIGINT,
  order_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  customer_province TEXT,
  status TEXT,
  priority TEXT,
  payment_method TEXT,
  subtotal NUMERIC,
  total NUMERIC,
  cod_amount NUMERIC,
  estimated_profit NUMERIC,
  cs_name TEXT,
  channel_name TEXT,
  product_summary TEXT,
  product_count INTEGER,
  cs_attempts INTEGER,
  internal_note TEXT,
  customer_note TEXT,
  reject_reason TEXT,
  last_contact_at TIMESTAMPTZ,
  order_date DATE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  RETURN QUERY
  WITH filtered AS (
    SELECT o.*
    FROM public.orders_draft o
    WHERE o.organization_id = v_org_id
      AND (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to IS NULL OR o.order_date <= p_to)
      AND (p_status IS NULL OR o.status = p_status)
      AND (
        p_search IS NULL
        OR o.order_number ILIKE '%' || p_search || '%'
        OR o.customer_name ILIKE '%' || p_search || '%'
        OR COALESCE(o.customer_phone, '') ILIKE '%' || p_search || '%'
      )
  ),
  products_agg AS (
    SELECT
      oi.order_id,
      STRING_AGG(
        COALESCE(p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)',
        ', '
        ORDER BY oi.id
      ) AS summary,
      COUNT(*)::INT AS cnt
    FROM public.order_items_draft oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id IN (SELECT id FROM filtered)
    GROUP BY oi.order_id
  ),
  total AS (SELECT COUNT(*) AS cnt FROM filtered)
  SELECT
    fo.id,
    fo.order_number,
    fo.customer_name,
    fo.customer_phone,
    fo.customer_city,
    fo.customer_province,
    fo.status,
    fo.priority,
    fo.payment_method,
    fo.subtotal,
    fo.total,
    fo.cod_amount,
    fo.estimated_profit,
    COALESCE((SELECT full_name FROM public.profiles WHERE id = fo.cs_id), fo.cs_name) AS cs_name,
    (SELECT name FROM public.courier_channels WHERE id = fo.channel_id) AS channel_name,
    COALESCE(pa.summary, '—') AS product_summary,
    COALESCE(pa.cnt, 0) AS product_count,
    fo.cs_attempts,
    fo.internal_note,
    fo.customer_note,
    fo.reject_reason,
    fo.last_contact_at,
    fo.order_date,
    fo.created_at,
    fo.updated_at,
    (SELECT cnt FROM total) AS total_count
  FROM filtered fo
  LEFT JOIN products_agg pa ON pa.order_id = fo.id
  ORDER BY fo.created_at DESC, fo.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- =============================================================
-- 9. RPC: get_draft_status_stats
-- =============================================================
DROP FUNCTION IF EXISTS public.get_draft_status_stats(date, date, text);

CREATE OR REPLACE FUNCTION public.get_draft_status_stats(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(status TEXT, cnt BIGINT, pct NUMERIC)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
  v_total BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  SELECT COUNT(*) INTO v_total
  FROM public.orders_draft o
  WHERE o.organization_id = v_org_id
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to IS NULL OR o.order_date <= p_to)
    AND (
      p_search IS NULL
      OR o.order_number ILIKE '%' || p_search || '%'
      OR o.customer_name ILIKE '%' || p_search || '%'
    );

  RETURN QUERY
  SELECT
    o.status,
    COUNT(*)::BIGINT AS cnt,
    CASE WHEN v_total > 0 THEN ROUND(COUNT(*) * 100.0 / v_total, 1) ELSE 0 END AS pct
  FROM public.orders_draft o
  WHERE o.organization_id = v_org_id
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to IS NULL OR o.order_date <= p_to)
    AND (
      p_search IS NULL
      OR o.order_number ILIKE '%' || p_search || '%'
      OR o.customer_name ILIKE '%' || p_search || '%'
    )
  GROUP BY o.status
  ORDER BY
    CASE o.status
      WHEN 'BARU' THEN 1
      WHEN 'SIAP_KIRIM' THEN 2
      WHEN 'PROBLEM' THEN 3
      WHEN 'CANCEL' THEN 4
      ELSE 9
    END;
END;
$$;

-- =============================================================
-- 10. Grant execute (RPCs SECURITY INVOKER → RLS applies)
-- =============================================================
GRANT EXECUTE ON FUNCTION public.list_orders_draft_enriched(date, date, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_draft_status_stats(date, date, text) TO authenticated;
