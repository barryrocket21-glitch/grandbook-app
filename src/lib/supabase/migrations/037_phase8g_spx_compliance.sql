-- =============================================================
-- PHASE 8G: SPX Compliance + Phone Robustness
-- =============================================================
-- Yang ditambah:
-- 1. master_wilayah_spx — authoritative source untuk SPX outbound format
--    (UPPERCASE state + KAB./KOTA prefix + canonical postal code)
-- 2. lookup_spx_wilayah RPC — cross-match dari format master_wilayah lokal
--    ke format SPX (handle "Nusa Tenggara Timur (NTT)" → "NUSA TENGGARA TIMUR (NTT)")
-- 3. inbox_invalid_phone — track phone corrupt dari CSV (scientific notation,
--    too short, too long, non-numeric)
-- 4. Cleanup 9 order stuck (idempotent — kalau sudah dihapus manual, no-op)
--
-- IDEMPOTENT.
-- =============================================================

-- 1. master_wilayah_spx
CREATE TABLE IF NOT EXISTS public.master_wilayah_spx (
  id BIGSERIAL PRIMARY KEY,
  state TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  postal_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_serviceable BOOLEAN NOT NULL DEFAULT TRUE,
  state_normalized TEXT GENERATED ALWAYS AS (LOWER(REGEXP_REPLACE(state, '\s*\([^)]*\)\s*', '', 'g'))) STORED,
  city_normalized TEXT GENERATED ALWAYS AS (LOWER(REGEXP_REPLACE(city, '^(KAB\.|KOTA)\s+', '', 'i'))) STORED,
  district_normalized TEXT GENERATED ALWAYS AS (LOWER(district)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(state, city, district)
);

CREATE INDEX IF NOT EXISTS idx_master_wilayah_spx_state ON public.master_wilayah_spx(state);
CREATE INDEX IF NOT EXISTS idx_master_wilayah_spx_city ON public.master_wilayah_spx(city);
CREATE INDEX IF NOT EXISTS idx_master_wilayah_spx_district ON public.master_wilayah_spx(district);
CREATE INDEX IF NOT EXISTS idx_master_wilayah_spx_normalized
  ON public.master_wilayah_spx(state_normalized, city_normalized, district_normalized);

GRANT SELECT ON public.master_wilayah_spx TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.master_wilayah_spx FROM authenticated;

-- 2. RPC lookup_spx_wilayah (3-tier match: normalized exact → district+city partial → district only)
CREATE OR REPLACE FUNCTION public.lookup_spx_wilayah(
  p_province TEXT, p_city TEXT, p_subdistrict TEXT
)
RETURNS TABLE (
  spx_state TEXT, spx_city TEXT, spx_district TEXT, spx_postal_code TEXT,
  is_serviceable BOOLEAN, match_confidence TEXT
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_prov_norm TEXT;
  v_city_norm TEXT;
  v_dist_norm TEXT;
BEGIN
  IF p_province IS NULL OR p_city IS NULL OR p_subdistrict IS NULL THEN RETURN; END IF;
  v_prov_norm := LOWER(REGEXP_REPLACE(p_province, '\s*\([^)]*\)\s*', '', 'g'));
  v_city_norm := LOWER(REGEXP_REPLACE(p_city, '^(KAB\.|KOTA|KABUPATEN)\s+', '', 'i'));
  v_dist_norm := LOWER(p_subdistrict);

  RETURN QUERY
  SELECT mws.state, mws.city, mws.district, COALESCE(mws.postal_codes[1], ''),
         mws.is_serviceable, 'normalized'::TEXT
  FROM public.master_wilayah_spx mws
  WHERE mws.state_normalized = v_prov_norm
    AND mws.city_normalized = v_city_norm
    AND mws.district_normalized = v_dist_norm
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT mws.state, mws.city, mws.district, COALESCE(mws.postal_codes[1], ''),
         mws.is_serviceable, 'partial'::TEXT
  FROM public.master_wilayah_spx mws
  WHERE mws.district_normalized = v_dist_norm
    AND mws.city_normalized ILIKE '%' || v_city_norm || '%'
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT mws.state, mws.city, mws.district, COALESCE(mws.postal_codes[1], ''),
         mws.is_serviceable, 'district_only'::TEXT
  FROM public.master_wilayah_spx mws
  WHERE mws.district_normalized = v_dist_norm
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::BOOLEAN, 'not_found'::TEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_spx_wilayah(TEXT, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.lookup_spx_wilayah(TEXT, TEXT, TEXT) TO authenticated;

-- 3. inbox_invalid_phone
CREATE TABLE IF NOT EXISTS public.inbox_invalid_phone (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  raw_phone TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('scientific_notation','too_short','too_long','non_numeric','empty')),
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,
  resolved_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbox_phone_unresolved
  ON public.inbox_invalid_phone(organization_id, created_at DESC) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_inbox_phone_order ON public.inbox_invalid_phone(order_id);

ALTER TABLE public.inbox_invalid_phone ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_phone_select ON public.inbox_invalid_phone;
DROP POLICY IF EXISTS inbox_phone_insert ON public.inbox_invalid_phone;
DROP POLICY IF EXISTS inbox_phone_update ON public.inbox_invalid_phone;

CREATE POLICY inbox_phone_select ON public.inbox_invalid_phone
  FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY inbox_phone_insert ON public.inbox_invalid_phone
  FOR INSERT WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY inbox_phone_update ON public.inbox_invalid_phone
  FOR UPDATE
  USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin', 'cs')
  )
  WITH CHECK (organization_id = public.current_org_id());

-- 4. Cleanup Task F: 9 order stuck dari smoke test Phase 8F (GB-20260518-000001..009)
DELETE FROM public.orders
WHERE order_number SIMILAR TO 'GB-20260518-00000[1-9]';

-- ============================================
-- Catatan:
-- - master_wilayah_spx seed data (~7092 row) di-apply via script terpisah
--   (Node + service role REST API). Tidak include di file SQL ini karena
--   size 600KB+ ga praktis di-edit manual. Reproducible via:
--   `node scripts/seed-master-wilayah-spx.mjs` (atau equivalent).
-- - Update mapping spx_outbound (display_order 4,5,6,7,19) ke SPX lookup
--   resolvers di-apply terpisah via execute_sql MCP.
-- ============================================
