-- =============================================================
-- Migration 013 — Phase 3A fix
-- Server-side DISTINCT helpers for master_wilayah cascade dropdowns.
--
-- The previous client-side fetchAll + Set dedup approach broke against
-- Supabase REST default db_max_rows=1000 (PostgREST clamp): page-size 2000
-- only returns 1000, then the "chunk < page_size" break exits the loop —
-- so only ~1000 rows are seen, which happens to be ~2 alphabetical provinces
-- (BALI, BANGKA BELITUNG) instead of all 34.
--
-- Pulling DISTINCT from the DB is also faster than shipping 82k rows.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_distinct_provinces()
RETURNS TABLE(province TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT province
  FROM public.master_wilayah
  WHERE province IS NOT NULL
  ORDER BY province;
$$;

CREATE OR REPLACE FUNCTION public.get_distinct_cities(p_province TEXT)
RETURNS TABLE(city TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT city
  FROM public.master_wilayah
  WHERE province = p_province
    AND city IS NOT NULL
  ORDER BY city;
$$;

CREATE OR REPLACE FUNCTION public.get_distinct_subdistricts(p_province TEXT, p_city TEXT)
RETURNS TABLE(subdistrict TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT subdistrict
  FROM public.master_wilayah
  WHERE province = p_province
    AND city = p_city
    AND subdistrict IS NOT NULL
  ORDER BY subdistrict;
$$;

-- Villages return id + village + zip because the form needs all three
-- (id → wilayah_id link, zip → auto-fill). Within (province, city, subdistrict)
-- the UNIQUE constraint on (province, city, subdistrict, village, zip) means
-- no two rows have the exact same village+zip — but the same village can have
-- multiple zips in rare cases, so each row is its own picker entry.
CREATE OR REPLACE FUNCTION public.get_distinct_villages(
  p_province TEXT,
  p_city TEXT,
  p_subdistrict TEXT
)
RETURNS TABLE(id BIGINT, village TEXT, zip TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, village, zip
  FROM public.master_wilayah
  WHERE province = p_province
    AND city = p_city
    AND subdistrict = p_subdistrict
    AND village IS NOT NULL
  ORDER BY village, zip;
$$;

GRANT EXECUTE ON FUNCTION public.get_distinct_provinces() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distinct_cities(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distinct_subdistricts(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distinct_villages(TEXT, TEXT, TEXT) TO authenticated;
