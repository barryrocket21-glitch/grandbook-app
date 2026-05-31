-- 087 — Brief #6: Smart Address Resolver (Konorder-grade). Extend #5.
-- ============================================================================
-- Akar masalah #5: (1) gak pakai KODE POS, (2) cuma jalan kalau ada penanda
-- kecamatan/kota. Fix: resolver bertingkat set-based, high-confidence only:
--   A. KODE POS (primary) — extract 5-digit dari alamat → map ke kelurahan/
--      kecamatan/kota/provinsi via master_wilayah.zip (paling reliable).
--   B. kota+kecamatan terstruktur exact (dari #5).
--   C. GRAM SCAN nama tempat (port Konorder scan): tokenize blob → grams 1-3
--      kata → match ke subdistrict_normalized (indexed) → corroborate dgn
--      kota/provinsi yg muncul di blob → resolve kalau unik. (fix "nama berderet
--      tanpa penanda").
--   D. kota→provinsi (dari #5, partial fill).
-- Tiap step cuma sentuh draft yang BELUM resolve (wilayah_id IS NULL).
-- Anti-nebak: resolve cuma kalau ketemu SATU entitas wilayah jelas; ambigu →
-- biarin ⚠️. Set-based (jaga perf #5). INVOKER. Idempotent.

-- Index kode pos (set-based postal lookup) — idx_wilayah_zip udah ada (#1),
-- tambah index buat zip exact + 5-digit.
CREATE INDEX IF NOT EXISTS idx_mw_zip_btree ON public.master_wilayah(zip);

CREATE OR REPLACE FUNCTION public.resolve_draft_wilayah(p_org bigint, p_draft_ids bigint[])
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE v_a int; v_b int; v_c int; v_d int;
BEGIN
  -- ========== A. KODE POS (primary) ==========
  -- zip yang map ke TEPAT 1 (prov,kota,kec). Extract semua 5-digit dari alamat,
  -- pakai cuma kalau semua zip valid yang ketemu setuju 1 lokasi (anti-konflik).
  WITH zip_unique AS (
    SELECT zip,
      (array_agg(province ORDER BY id))[1] AS province,
      (array_agg(city ORDER BY id))[1] AS city,
      (array_agg(subdistrict ORDER BY id))[1] AS subdistrict,
      (array_agg(id ORDER BY id))[1] AS wid
    FROM public.master_wilayah
    WHERE zip ~ '^\d{5}$'
    GROUP BY zip
    HAVING count(DISTINCT province_normalized || '|' || city_normalized || '|' || subdistrict_normalized) = 1
  ),
  draft_postal AS (
    SELECT d.id, m[1] AS zip
    FROM public.orders_draft d
    CROSS JOIN LATERAL regexp_matches(
      COALESCE(d.customer_zip, '') || ' ' || COALESCE(d.customer_address_detail, '') || ' ' || COALESCE(d.customer_address, ''),
      '(\d{5})', 'g') AS m
    WHERE d.id = ANY(p_draft_ids) AND d.wilayah_id IS NULL
  ),
  pr AS (
    SELECT dp.id,
      (array_agg(zu.province))[1] AS province,
      (array_agg(zu.city))[1] AS city,
      (array_agg(zu.subdistrict))[1] AS subdistrict,
      (array_agg(zu.wid))[1] AS wid,
      (array_agg(zu.zip))[1] AS zip
    FROM draft_postal dp JOIN zip_unique zu ON zu.zip = dp.zip
    GROUP BY dp.id
    -- anti-konflik: semua zip valid yang ketemu di alamat harus setuju 1 lokasi
    HAVING count(DISTINCT zu.city || '|' || zu.subdistrict) = 1
  )
  UPDATE public.orders_draft d SET
    customer_province = pr.province,
    customer_city = pr.city,
    customer_subdistrict = pr.subdistrict,
    customer_zip = COALESCE(NULLIF(btrim(d.customer_zip), ''), pr.zip),
    wilayah_id = pr.wid,
    updated_at = now()
  FROM pr
  WHERE d.id = pr.id AND d.wilayah_id IS NULL;
  GET DIAGNOSTICS v_a = ROW_COUNT;

  -- ========== B. kota+kecamatan terstruktur exact (dari #5) ==========
  UPDATE public.orders_draft d
    SET wilayah_id = m.id,
        customer_province = COALESCE(NULLIF(btrim(d.customer_province), ''), m.province),
        customer_zip = COALESCE(NULLIF(btrim(d.customer_zip), ''), m.zip),
        updated_at = now()
  FROM public.master_wilayah m
  WHERE d.id = ANY(p_draft_ids) AND d.wilayah_id IS NULL
    AND d.customer_city IS NOT NULL AND d.customer_subdistrict IS NOT NULL
    AND m.city_normalized = public.wilayah_norm(d.customer_city)
    AND m.subdistrict_normalized = public.wilayah_norm(d.customer_subdistrict);
  GET DIAGNOSTICS v_b = ROW_COUNT;

  -- ========== C. GRAM SCAN nama tempat (port Konorder scan) ==========
  WITH unresolved AS (
    SELECT d.id,
      public.wilayah_norm(
        COALESCE(d.customer_address_detail, '') || ' ' || COALESCE(d.customer_address, '') || ' ' ||
        COALESCE(d.customer_subdistrict, '') || ' ' || COALESCE(d.customer_city, '') || ' ' ||
        COALESCE(d.customer_province, '')
      ) AS nblob
    FROM public.orders_draft d
    WHERE d.id = ANY(p_draft_ids) AND d.wilayah_id IS NULL
  ),
  words AS (
    SELECT u.id, w.w, w.ord
    FROM unresolved u, regexp_split_to_table(u.nblob, '\s+') WITH ORDINALITY w(w, ord)
    WHERE w.w <> ''
  ),
  grams AS (
    SELECT id, w AS g FROM words
    UNION ALL SELECT a.id, a.w || ' ' || b.w FROM words a JOIN words b ON b.id = a.id AND b.ord = a.ord + 1
    UNION ALL SELECT a.id, a.w || ' ' || b.w || ' ' || c.w FROM words a JOIN words b ON b.id = a.id AND b.ord = a.ord + 1 JOIN words c ON c.id = a.id AND c.ord = a.ord + 2
  ),
  gram_set AS (SELECT DISTINCT id, g FROM grams),
  cand AS (
    SELECT gs.id, mw.province, mw.city, mw.subdistrict, mw.zip, mw.id AS wid,
      mw.city_normalized, mw.province_normalized
    FROM gram_set gs JOIN public.master_wilayah mw ON mw.subdistrict_normalized = gs.g
  ),
  -- corroborasi: kota ATAU provinsi kandidat juga muncul sebagai gram di blob
  corrob AS (
    SELECT c.id, c.province, c.city, c.subdistrict, c.zip, c.wid, c.city_normalized
    FROM cand c
    WHERE EXISTS (SELECT 1 FROM gram_set g WHERE g.id = c.id AND g.g = c.city_normalized)
       OR EXISTS (SELECT 1 FROM gram_set g WHERE g.id = c.id AND g.g = c.province_normalized)
  ),
  best AS (
    SELECT id,
      (array_agg(province))[1] AS province,
      (array_agg(city))[1] AS city,
      (array_agg(subdistrict))[1] AS subdistrict,
      (array_agg(zip))[1] AS zip,
      (array_agg(wid))[1] AS wid
    FROM corrob
    GROUP BY id
    HAVING count(DISTINCT city_normalized || '|' || public.wilayah_norm(subdistrict)) = 1
  )
  UPDATE public.orders_draft d SET
    customer_province = best.province,
    customer_city = best.city,
    customer_subdistrict = best.subdistrict,
    customer_zip = COALESCE(NULLIF(btrim(d.customer_zip), ''), best.zip),
    wilayah_id = best.wid,
    updated_at = now()
  FROM best
  WHERE d.id = best.id AND d.wilayah_id IS NULL;
  GET DIAGNOSTICS v_c = ROW_COUNT;

  -- ========== D. kota→provinsi (partial fill, dari #5) ==========
  WITH city_prov AS (
    SELECT city_normalized, max(province) AS province
    FROM public.master_wilayah
    GROUP BY city_normalized
    HAVING count(DISTINCT province_normalized) = 1
  )
  UPDATE public.orders_draft d
    SET customer_province = cp.province, updated_at = now()
  FROM city_prov cp
  WHERE d.id = ANY(p_draft_ids)
    AND (d.customer_province IS NULL OR btrim(d.customer_province) = '')
    AND d.customer_city IS NOT NULL
    AND public.wilayah_norm(d.customer_city) = cp.city_normalized;
  GET DIAGNOSTICS v_d = ROW_COUNT;

  RETURN v_a + v_b + v_c + v_d;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_draft_wilayah(bigint, bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_draft_wilayah(bigint, bigint[]) TO authenticated;
