-- =============================================================
-- PHASE 8F: Hybrid Address Parsing + Inbox + Export Gate Helpers
-- =============================================================
-- Yang ditambah:
-- 1. inbox_unparsed_address — inbox manual review address yang gagal parse otomatis
-- 2. RPC search_wilayah_fuzzy — fuzzy keyword search di master_wilayah dengan scoring
-- 3. RPC check_order_export_ready — gate check sebelum order bisa di-export ekspedisi
--
-- IDEMPOTENT.
-- =============================================================

-- 1. Tabel inbox baru: address yang gagal di-parse otomatis
CREATE TABLE IF NOT EXISTS public.inbox_unparsed_address (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  raw_address TEXT NOT NULL,
  parsing_attempt JSONB,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbox_address_unresolved
  ON public.inbox_unparsed_address(organization_id, created_at DESC)
  WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_inbox_address_order
  ON public.inbox_unparsed_address(order_id);

ALTER TABLE public.inbox_unparsed_address ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_address_select ON public.inbox_unparsed_address;
DROP POLICY IF EXISTS inbox_address_insert ON public.inbox_unparsed_address;
DROP POLICY IF EXISTS inbox_address_update ON public.inbox_unparsed_address;

CREATE POLICY inbox_address_select ON public.inbox_unparsed_address
  FOR SELECT USING (organization_id = public.current_org_id());

CREATE POLICY inbox_address_insert ON public.inbox_unparsed_address
  FOR INSERT WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY inbox_address_update ON public.inbox_unparsed_address
  FOR UPDATE
  USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin', 'cs')
  )
  WITH CHECK (organization_id = public.current_org_id());

-- 2. Helper RPC: search wilayah dengan fuzzy match + scoring
CREATE OR REPLACE FUNCTION public.search_wilayah_fuzzy(
  p_query TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  province TEXT,
  city TEXT,
  subdistrict TEXT,
  village TEXT,
  zip TEXT,
  match_score INT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_query TEXT;
BEGIN
  v_query := LOWER(TRIM(p_query));
  IF LENGTH(v_query) < 3 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    mw.id, mw.province, mw.city, mw.subdistrict, mw.village, mw.zip,
    (CASE
      WHEN LOWER(mw.subdistrict) = v_query THEN 100
      WHEN LOWER(mw.village)     = v_query THEN 95
      WHEN LOWER(mw.city)        = v_query THEN 90
      WHEN LOWER(mw.subdistrict) LIKE v_query || '%' THEN 80
      WHEN LOWER(mw.village)     LIKE v_query || '%' THEN 75
      WHEN LOWER(mw.subdistrict) LIKE '%' || v_query || '%' THEN 60
      WHEN LOWER(mw.village)     LIKE '%' || v_query || '%' THEN 55
      WHEN LOWER(mw.city)        LIKE '%' || v_query || '%' THEN 50
      ELSE 0
    END)::INT AS match_score
  FROM public.master_wilayah mw
  WHERE
       LOWER(mw.subdistrict) LIKE '%' || v_query || '%'
    OR LOWER(mw.village)     LIKE '%' || v_query || '%'
    OR LOWER(mw.city)        LIKE '%' || v_query || '%'
  ORDER BY match_score DESC, mw.subdistrict, mw.village
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_wilayah_fuzzy(TEXT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.search_wilayah_fuzzy(TEXT, INT) TO authenticated;

-- 3. Helper RPC: check apakah order siap export ke ekspedisi
CREATE OR REPLACE FUNCTION public.check_order_export_ready(p_order_id BIGINT)
RETURNS TABLE (
  is_ready BOOLEAN,
  missing_fields TEXT[]
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_order   RECORD;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RETURN QUERY SELECT FALSE, ARRAY['order_not_found']::TEXT[];
    RETURN;
  END IF;

  IF v_order.customer_address_detail IS NULL OR LENGTH(TRIM(v_order.customer_address_detail)) = 0 THEN
    v_missing := v_missing || 'customer_address_detail';
  END IF;
  IF v_order.customer_province IS NULL OR LENGTH(TRIM(v_order.customer_province)) = 0 THEN
    v_missing := v_missing || 'customer_province';
  END IF;
  IF v_order.customer_city IS NULL OR LENGTH(TRIM(v_order.customer_city)) = 0 THEN
    v_missing := v_missing || 'customer_city';
  END IF;
  IF v_order.customer_subdistrict IS NULL OR LENGTH(TRIM(v_order.customer_subdistrict)) = 0 THEN
    v_missing := v_missing || 'customer_subdistrict';
  END IF;
  IF v_order.customer_zip IS NULL OR LENGTH(TRIM(v_order.customer_zip)) = 0 THEN
    v_missing := v_missing || 'customer_zip';
  END IF;
  IF v_order.channel_id IS NULL THEN
    v_missing := v_missing || 'channel_id';
  END IF;

  RETURN QUERY SELECT (array_length(v_missing, 1) IS NULL), v_missing;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_order_export_ready(BIGINT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.check_order_export_ready(BIGINT) TO authenticated;
