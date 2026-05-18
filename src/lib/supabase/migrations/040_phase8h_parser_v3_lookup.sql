-- =============================================================
-- PHASE 8H-1: parse_address_v3_lookup RPC
-- =============================================================
-- Parser V3 strategy: pattern extraction generate kandidat tuples, lalu
-- DB lookup yang validate dan pick winner. RPC ini di-call dengan
-- (province?, city?, subdistrict?) — minimum subdistrict wajib.
--
-- 4-tier matching:
--   Tier 1 (score 100): province + city + subdistrict semua match exact
--                       normalized
--   Tier 2 (score 95):  province + subdistrict match, city di-infer dari DB
--                       (handles "Kec.Bendo Jawa Timur" tanpa Kab./Kota
--                       prefix di input)
--   Tier 3 (score 95):  city + subdistrict match, province di-infer dari DB
--                       (handles "Kec. Pondok Aren. Tangerang Selatan" —
--                       city as last segment, no province in text)
--   Tier 4 (score 70):  subdistrict only — fallback ambigu, return up to
--                       10 row, caller pick winner via context
--
-- Filter is_serviceable=TRUE (Phase 8H-2 nanti seed 157 wilayah jadi FALSE).
-- Sekarang semua row default TRUE → filter no-op forward-safe.
--
-- Alias strip district di KEDUA sisi (consistent dengan migration 039 pattern):
--   - Input: LOWER(REGEXP_REPLACE(p_subdistrict, '\s*\([^)]*\)\s*', '', 'g'))
--   - DB:    LOWER(REGEXP_REPLACE(mws.district, ...))
--
-- City normalization: pakai generated column `city_normalized` (sudah strip
-- KOTA/KAB. prefix di DB side). Input v_city_norm strip prefix juga via
-- REGEXP_REPLACE. Tier 3 pakai ILIKE %x% untuk substring match (handle
-- input "Tangerang Selatan" → match "tangerang selatan").
--
-- Standing rule: #variable_conflict use_column directive di RETURNS TABLE
-- (output column name bisa shadow ke column reference).
--
-- IDEMPOTENT (CREATE OR REPLACE).
-- =============================================================

CREATE OR REPLACE FUNCTION public.parse_address_v3_lookup(
  p_province TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_subdistrict TEXT DEFAULT NULL
)
RETURNS TABLE (
  province TEXT,
  city TEXT,
  subdistrict TEXT,
  zip TEXT,
  match_score INT,
  matched_via TEXT
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_prov_norm TEXT;
  v_city_norm TEXT;
  v_dist_norm TEXT;
BEGIN
  -- District wajib (4 tier semua butuh district anchor)
  IF p_subdistrict IS NULL THEN RETURN; END IF;

  v_dist_norm := LOWER(REGEXP_REPLACE(p_subdistrict, '\s*\([^)]*\)\s*', '', 'g'));

  v_prov_norm := CASE WHEN p_province IS NOT NULL
    THEN LOWER(REGEXP_REPLACE(p_province, '\s*\([^)]*\)\s*', '', 'g'))
    ELSE NULL END;

  v_city_norm := CASE WHEN p_city IS NOT NULL
    THEN LOWER(REGEXP_REPLACE(
      REGEXP_REPLACE(p_city, '^(KAB\.|KOTA|KABUPATEN)\s+', '', 'i'),
      '\s*\([^)]*\)\s*', '', 'g'
    ))
    ELSE NULL END;

  -- Tier 1: exact match (province + city + subdistrict)
  IF v_prov_norm IS NOT NULL AND v_city_norm IS NOT NULL THEN
    RETURN QUERY
    SELECT
      mws.state, mws.city, mws.district,
      COALESCE(mws.postal_codes[1], ''),
      100, 'tier1_exact'::TEXT
    FROM public.master_wilayah_spx mws
    WHERE mws.state_normalized = v_prov_norm
      AND mws.city_normalized = v_city_norm
      AND LOWER(REGEXP_REPLACE(mws.district, '\s*\([^)]*\)\s*', '', 'g')) = v_dist_norm
      AND mws.is_serviceable = TRUE
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Tier 2: province + subdistrict, infer city
  IF v_prov_norm IS NOT NULL THEN
    RETURN QUERY
    SELECT
      mws.state, mws.city, mws.district,
      COALESCE(mws.postal_codes[1], ''),
      95, 'tier2_infer_city'::TEXT
    FROM public.master_wilayah_spx mws
    WHERE mws.state_normalized = v_prov_norm
      AND LOWER(REGEXP_REPLACE(mws.district, '\s*\([^)]*\)\s*', '', 'g')) = v_dist_norm
      AND mws.is_serviceable = TRUE
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Tier 3: city + subdistrict, infer province
  IF v_city_norm IS NOT NULL THEN
    RETURN QUERY
    SELECT
      mws.state, mws.city, mws.district,
      COALESCE(mws.postal_codes[1], ''),
      95, 'tier3_infer_province'::TEXT
    FROM public.master_wilayah_spx mws
    WHERE mws.city_normalized ILIKE '%' || v_city_norm || '%'
      AND LOWER(REGEXP_REPLACE(mws.district, '\s*\([^)]*\)\s*', '', 'g')) = v_dist_norm
      AND mws.is_serviceable = TRUE
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Tier 4: district only (fallback ambigu, up to 10 row)
  RETURN QUERY
  SELECT
    mws.state, mws.city, mws.district,
    COALESCE(mws.postal_codes[1], ''),
    70, 'tier4_district_only'::TEXT
  FROM public.master_wilayah_spx mws
  WHERE LOWER(REGEXP_REPLACE(mws.district, '\s*\([^)]*\)\s*', '', 'g')) = v_dist_norm
    AND mws.is_serviceable = TRUE
  LIMIT 10;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.parse_address_v3_lookup FROM anon;
GRANT EXECUTE ON FUNCTION public.parse_address_v3_lookup TO authenticated;
