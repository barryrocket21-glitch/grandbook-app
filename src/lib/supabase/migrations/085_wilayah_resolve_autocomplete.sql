-- 085 — Brief #5 Fase A: foundation auto-resolve alamat + autocomplete wilayah.
-- ============================================================================
-- Keputusan Barry: import = exact/normalized match (set-based, cepet); fuzzy
-- (pg_trgm) cuma dipakai di autocomplete inline-edit antrian.
--
-- Isi:
--  - pg_trgm + GIN index utk fuzzy autocomplete.
--  - btree index di kolom *_normalized master_wilayah (exact set-based match).
--  - wilayah_norm(text): normalizer SAMA dgn cara kolom *_normalized dibuat
--    (lower + strip "(...)" + strip non-alnum + collapse spasi + trim).
--  - resolve_draft_wilayah(org, ids[]): set-based fill provinsi dari kota (kalau
--    kota unik 1 provinsi) + set wilayah_id/zip kalau kota+kecamatan match.
--  - wilayah_autocomplete(query, limit): fuzzy suggest utk inline-edit.
-- Idempotent. SECURITY INVOKER utk autocomplete (RLS gak relevan, master shared);
-- resolve = DEFINER (nulis orders_draft, scoped via param org).

-- pg_trgm di schema `extensions` (bukan public) — hindari advisor
-- extension_in_public. Supabase nyediain schema `extensions` by default.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;

-- Normalizer (mirror kolom *_normalized)
CREATE OR REPLACE FUNCTION public.wilayah_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(COALESCE(p,'')), '\(.*?\)', '', 'g'),  -- buang "(NTB)"
      '[^a-z0-9 ]', ' ', 'g'),                                     -- non-alnum → spasi
    '\s+', ' ', 'g'))                                              -- collapse spasi
$$;

-- Index exact match (set-based resolve)
CREATE INDEX IF NOT EXISTS idx_mw_city_norm ON public.master_wilayah(city_normalized);
CREATE INDEX IF NOT EXISTS idx_mw_subdistrict_norm ON public.master_wilayah(subdistrict_normalized);
CREATE INDEX IF NOT EXISTS idx_mw_city_subdistrict_norm ON public.master_wilayah(city_normalized, subdistrict_normalized);
-- GIN trgm (fuzzy autocomplete)
CREATE INDEX IF NOT EXISTS idx_mw_city_norm_trgm ON public.master_wilayah USING gin (city_normalized extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mw_subdistrict_norm_trgm ON public.master_wilayah USING gin (subdistrict_normalized extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- resolve_draft_wilayah — set-based auto-resolve utk draft ids tertentu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_draft_wilayah(bigint, bigint[]);
CREATE OR REPLACE FUNCTION public.resolve_draft_wilayah(p_org bigint, p_draft_ids bigint[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_n1 int; v_n2 int;
BEGIN
  -- 1) Isi provinsi dari kota (kalau kota itu unik ke 1 provinsi).
  WITH city_prov AS (
    SELECT city_normalized, max(province) AS province
    FROM public.master_wilayah
    GROUP BY city_normalized
    HAVING count(DISTINCT province_normalized) = 1
  )
  UPDATE public.orders_draft d
    SET customer_province = cp.province, updated_at = now()
  FROM city_prov cp
  WHERE d.id = ANY(p_draft_ids) AND d.organization_id = p_org
    AND (d.customer_province IS NULL OR btrim(d.customer_province) = '')
    AND d.customer_city IS NOT NULL
    AND public.wilayah_norm(d.customer_city) = cp.city_normalized;
  GET DIAGNOSTICS v_n1 = ROW_COUNT;

  -- 2) Set wilayah_id (+ provinsi/zip kalau kosong) kalau kota+kecamatan match.
  UPDATE public.orders_draft d
    SET wilayah_id = m.id,
        customer_province = COALESCE(NULLIF(btrim(d.customer_province), ''), m.province),
        customer_zip = COALESCE(NULLIF(btrim(d.customer_zip), ''), m.zip),
        updated_at = now()
  FROM public.master_wilayah m
  WHERE d.id = ANY(p_draft_ids) AND d.organization_id = p_org
    AND d.wilayah_id IS NULL
    AND d.customer_city IS NOT NULL AND d.customer_subdistrict IS NOT NULL
    AND m.city_normalized = public.wilayah_norm(d.customer_city)
    AND m.subdistrict_normalized = public.wilayah_norm(d.customer_subdistrict);
  GET DIAGNOSTICS v_n2 = ROW_COUNT;

  RETURN v_n1 + v_n2;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_draft_wilayah(bigint, bigint[]) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- wilayah_autocomplete — fuzzy suggest (inline-edit). Distinct per kecamatan.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.wilayah_autocomplete(text, int);
CREATE OR REPLACE FUNCTION public.wilayah_autocomplete(p_query text, p_limit int DEFAULT 10)
RETURNS TABLE (id bigint, province text, city text, subdistrict text, zip text, score real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH q AS (SELECT public.wilayah_norm(p_query) AS s)
  SELECT id, province, city, subdistrict, zip, score FROM (
    SELECT DISTINCT ON (city_normalized, subdistrict_normalized)
      m.id, m.province, m.city, m.subdistrict, m.zip,
      GREATEST(similarity(m.subdistrict_normalized, (SELECT s FROM q)),
               similarity(m.city_normalized, (SELECT s FROM q))) AS score
    FROM public.master_wilayah m, q
    WHERE length(q.s) >= 2
      AND (m.subdistrict_normalized % q.s OR m.city_normalized % q.s
           OR m.subdistrict_normalized LIKE q.s || '%' OR m.city_normalized LIKE q.s || '%')
    ORDER BY city_normalized, subdistrict_normalized, score DESC
  ) t
  ORDER BY t.score DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

GRANT EXECUTE ON FUNCTION public.wilayah_autocomplete(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wilayah_norm(text) TO authenticated;
