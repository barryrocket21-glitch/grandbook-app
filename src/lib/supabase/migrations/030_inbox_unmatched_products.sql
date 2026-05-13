-- =============================================================
-- Phase 8.5 — Inbox unmatched products
-- =============================================================
-- Engine bulk upload + WA paste resolve product_name_raw → products.id
-- via exact match (case-insensitive + trimmed). Yang TIDAK match di-log
-- ke table ini supaya admin bisa cleanup nanti.
--
-- Pattern konsisten dengan inbox_unmatched_resi + inbox_unmapped_statuses
-- (Phase 1, migration 010): UNIQUE (org, raw_value), occurrence_count
-- increment, first_seen/last_seen tracking, resolved_to_* FK.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.inbox_unmatched_products (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  raw_name TEXT NOT NULL,
  occurrence_count INT NOT NULL DEFAULT 1,

  -- Sample order context (latest seen — overwrite OK kalau ada batch baru)
  sample_order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  sample_batch_id TEXT,

  -- Resolution
  resolved_to_product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT inbox_unmatched_products_unique UNIQUE (organization_id, raw_name)
);

CREATE INDEX IF NOT EXISTS idx_inbox_unmatched_products_org
  ON public.inbox_unmatched_products(organization_id);
CREATE INDEX IF NOT EXISTS idx_inbox_unmatched_products_unresolved
  ON public.inbox_unmatched_products(organization_id, resolved_at)
  WHERE resolved_at IS NULL;

-- RLS — pakai pattern current_org_id() konsisten Phase 1+
ALTER TABLE public.inbox_unmatched_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_unmatched_products_select ON public.inbox_unmatched_products;
CREATE POLICY inbox_unmatched_products_select ON public.inbox_unmatched_products
  FOR SELECT
  USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS inbox_unmatched_products_write ON public.inbox_unmatched_products;
CREATE POLICY inbox_unmatched_products_write ON public.inbox_unmatched_products
  FOR ALL
  USING (
    organization_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    organization_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- log_unmatched_product RPC
-- -----------------------------------------------------------
-- SECURITY DEFINER supaya CS yang upload via bulk engine bisa log walaupun
-- write policy table di-restrict ke owner+admin. RPC = public API, write
-- policy = direct INSERT guard.
--
-- Returns id of (new atau existing) inbox row.
-- -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.log_unmatched_product(TEXT, BIGINT, TEXT);
CREATE OR REPLACE FUNCTION public.log_unmatched_product(
  p_raw_name        TEXT,
  p_sample_order_id BIGINT DEFAULT NULL,
  p_sample_batch_id TEXT   DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT := public.current_org_id();
  v_id  BIGINT;
  v_normalized TEXT := TRIM(p_raw_name);
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization context (current_org_id is NULL)';
  END IF;
  IF v_normalized IS NULL OR v_normalized = '' THEN
    RAISE EXCEPTION 'raw_name cannot be empty';
  END IF;

  INSERT INTO public.inbox_unmatched_products AS m (
    organization_id, raw_name, sample_order_id, sample_batch_id
  ) VALUES (
    v_org, v_normalized, p_sample_order_id, p_sample_batch_id
  )
  ON CONFLICT (organization_id, raw_name) DO UPDATE
    SET occurrence_count = m.occurrence_count + 1,
        last_seen_at = NOW(),
        sample_order_id = COALESCE(EXCLUDED.sample_order_id, m.sample_order_id),
        sample_batch_id = COALESCE(EXCLUDED.sample_batch_id, m.sample_batch_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.log_unmatched_product(TEXT, BIGINT, TEXT) TO authenticated;

-- =============================================================
-- Smoke test:
--   SELECT log_unmatched_product('Pavio M.Ikan', NULL, NULL);  -- creates row
--   SELECT log_unmatched_product('Pavio M.Ikan', NULL, NULL);  -- increments to 2
--   SELECT raw_name, occurrence_count FROM inbox_unmatched_products;
-- =============================================================
