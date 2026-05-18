-- =============================================================
-- PHASE 8G HOTFIX: lookup_spx_wilayah strip alias parenthesis
-- =============================================================
-- Smoke test verify Phase 8G nemu: master_wilayah lokal punya alias dalam
-- parenthesis di kolom subdistrict (e.g. "Pinang (Penang)"). Saat parser
-- store ke orders.customer_subdistrict, lookup_spx_wilayah gagal match
-- ke SPX master ("PINANG" tanpa alias) karena normalize cuma LOWER tanpa
-- strip parenthesis.
--
-- Fix: extend normalize untuk district + city → strip alias `(...)` sama
-- seperti state. Konsisten dengan generated columns di master_wilayah_spx.
--
-- IDEMPOTENT (CREATE OR REPLACE).
-- =============================================================

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
  -- Strip parenthesis alias dari semua 3 input
  v_prov_norm := LOWER(REGEXP_REPLACE(p_province, '\s*\([^)]*\)\s*', '', 'g'));
  v_city_norm := LOWER(REGEXP_REPLACE(
    REGEXP_REPLACE(p_city, '^(KAB\.|KOTA|KABUPATEN)\s+', '', 'i'),
    '\s*\([^)]*\)\s*', '', 'g'
  ));
  v_dist_norm := LOWER(REGEXP_REPLACE(p_subdistrict, '\s*\([^)]*\)\s*', '', 'g'));

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
