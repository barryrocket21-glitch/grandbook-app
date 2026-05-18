-- =============================================================
-- PHASE 8G HOTFIX 2: lookup_spx_wilayah strip alias dari KEDUA sisi
-- =============================================================
-- Migration 038 strip alias parenthesis di INPUT side aja (v_dist_norm).
-- Tapi generated column `district_normalized` formula = lower(district)
-- TANPA strip alias. Untuk row BANTEN/KOTA TANGERANG/PINANG (PENANG):
--   district_normalized = "pinang (penang)"
-- Input "Pinang" → v_dist_norm = "pinang" (alias stripped) → mismatch
-- dengan "pinang (penang)" → lookup return not_found.
--
-- Bug pattern mirror Phase 8E/8F: asymmetric normalization antara
-- input dan DB column comparison.
--
-- Fix: strip alias di KEDUA sisi via LOWER(REGEXP_REPLACE(mws.district, ...))
-- di WHERE clause. Tier 1/2/3 semua di-update konsisten.
--
-- Verified empiris pre-fix:
--   SELECT * FROM lookup_spx_wilayah('Banten','Tangerang','Pinang')
--   → not_found (BUG)
--
-- Expected post-fix:
--   spx_state='BANTEN' / spx_city='KOTA TANGERANG' /
--   spx_district='PINANG (PENANG)' / spx_postal_code='15142' /
--   match_confidence='normalized'
--
-- Tetap include: 3-tier match (normalized → partial city → district only)
-- Tetap include: #variable_conflict use_column directive (standing rule
-- PL/pgSQL RETURNS TABLE — kolom output bisa shadow column reference).
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
#variable_conflict use_column
DECLARE
  v_prov_norm TEXT;
  v_city_norm TEXT;
  v_dist_norm TEXT;
BEGIN
  IF p_province IS NULL OR p_city IS NULL OR p_subdistrict IS NULL THEN RETURN; END IF;

  -- Strip parenthesis alias dari input side (sama dengan migration 038)
  v_prov_norm := LOWER(REGEXP_REPLACE(p_province, '\s*\([^)]*\)\s*', '', 'g'));
  v_city_norm := LOWER(REGEXP_REPLACE(
    REGEXP_REPLACE(p_city, '^(KAB\.|KOTA|KABUPATEN)\s+', '', 'i'),
    '\s*\([^)]*\)\s*', '', 'g'
  ));
  v_dist_norm := LOWER(REGEXP_REPLACE(p_subdistrict, '\s*\([^)]*\)\s*', '', 'g'));

  -- Tier 1: exact normalized match. District comparison strip alias di
  -- KEDUA sisi (input v_dist_norm sudah strip + DB side via REGEXP_REPLACE
  -- on the fly karena generated column district_normalized cuma lower()).
  RETURN QUERY
  SELECT mws.state, mws.city, mws.district, COALESCE(mws.postal_codes[1], ''),
         mws.is_serviceable, 'normalized'::TEXT
  FROM public.master_wilayah_spx mws
  WHERE mws.state_normalized = v_prov_norm
    AND mws.city_normalized = v_city_norm
    AND LOWER(REGEXP_REPLACE(mws.district, '\s*\([^)]*\)\s*', '', 'g')) = v_dist_norm
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Tier 2: partial city match (district alias-stripped both sides,
  -- city ILIKE substring).
  RETURN QUERY
  SELECT mws.state, mws.city, mws.district, COALESCE(mws.postal_codes[1], ''),
         mws.is_serviceable, 'partial'::TEXT
  FROM public.master_wilayah_spx mws
  WHERE LOWER(REGEXP_REPLACE(mws.district, '\s*\([^)]*\)\s*', '', 'g')) = v_dist_norm
    AND mws.city_normalized ILIKE '%' || v_city_norm || '%'
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Tier 3: district only (alias-stripped both sides, ignore state+city).
  RETURN QUERY
  SELECT mws.state, mws.city, mws.district, COALESCE(mws.postal_codes[1], ''),
         mws.is_serviceable, 'district_only'::TEXT
  FROM public.master_wilayah_spx mws
  WHERE LOWER(REGEXP_REPLACE(mws.district, '\s*\([^)]*\)\s*', '', 'g')) = v_dist_norm
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::BOOLEAN, 'not_found'::TEXT;
END;
$$;
