-- 089 — Brief #8 PART B: Kamus Singkatan + Disambiguasi + Phone double-prefix
-- ============================================================================
-- Akar 51 ⚠️ (diff B1): singkatan provinsi/kabupaten (NTT, sulbar, tanjab timur,
-- Mateng, parimo, loteng, bolmut, dst) bikin token alamat GAK match master →
-- korroborasi gagal → resolver gak berani. Fix: kamus alias (DATA, bukan
-- hardcode) → expand SEBELUM gram scan. Disambiguasi tetap konservatif: ambigu
-- (>1 entitas, gak ada penguat) → ⚠️, JANGAN tebak (anti salah-provinsi).
-- Plus phone: "+62085..." sekarang nyangkut "085..." → fix strip iteratif.
-- Idempotent. INVOKER. Set-based. Alias = tabel + RLS read-all.

-- ============================================================================
-- 1. Tabel kamus alias (master reference, read-all authenticated)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.wilayah_alias (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('province', 'kabupaten')),
  alias_norm TEXT NOT NULL,        -- bentuk singkat (sudah ter-normalize: lower/alnum)
  canonical_norm TEXT NOT NULL,    -- nama resmi (match province_normalized / city_normalized)
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, alias_norm)
);
CREATE INDEX IF NOT EXISTS idx_wilayah_alias_norm ON public.wilayah_alias(alias_norm);

ALTER TABLE public.wilayah_alias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wilayah_alias_select ON public.wilayah_alias;
CREATE POLICY wilayah_alias_select ON public.wilayah_alias FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.wilayah_alias FROM anon;

-- ---- Seed provinsi (canonical = province_normalized resmi di master_wilayah) ----
INSERT INTO public.wilayah_alias (kind, alias_norm, canonical_norm, note) VALUES
  ('province','ntt','nusa tenggara timur',NULL),
  ('province','ntb','nusa tenggara barat',NULL),
  ('province','sulbar','sulawesi barat',NULL),
  ('province','sulsel','sulawesi selatan',NULL),
  ('province','sulteng','sulawesi tengah',NULL),
  ('province','sultra','sulawesi tenggara',NULL),
  ('province','sulut','sulawesi utara',NULL),
  ('province','sulawisi utara','sulawesi utara','typo umum'),
  ('province','sulawesi tenggara timur','sulawesi tenggara','typo'),
  ('province','sumbar','sumatera barat',NULL),
  ('province','sumsel','sumatera selatan',NULL),
  ('province','sumut','sumatera utara',NULL),
  ('province','sumatra barat','sumatera barat','ejaan'),
  ('province','sumatra utara','sumatera utara','ejaan'),
  ('province','sumatra selatan','sumatera selatan','ejaan'),
  ('province','kalbar','kalimantan barat',NULL),
  ('province','kalteng','kalimantan tengah',NULL),
  ('province','kaltim','kalimantan timur',NULL),
  ('province','kalsel','kalimantan selatan',NULL),
  ('province','kaltara','kalimantan utara',NULL),
  ('province','jabar','jawa barat',NULL),
  ('province','jatim','jawa timur',NULL),
  ('province','jateng','jawa tengah',NULL),
  ('province','jogja','di yogyakarta',NULL),
  ('province','yogyakarta','di yogyakarta',NULL),
  ('province','jogjakarta','di yogyakarta',NULL),
  ('province','diy','di yogyakarta',NULL),
  ('province','babel','bangka belitung',NULL),
  ('province','kepri','kepulauan riau',NULL),
  ('province','malut','maluku utara',NULL),
  ('province','nad','nanggroe aceh darussalam',NULL),
  ('province','papua tengah','papua','master pra-pemekaran')
ON CONFLICT (kind, alias_norm) DO UPDATE SET canonical_norm = EXCLUDED.canonical_norm;

-- ---- Seed kabupaten (canonical = city_normalized resmi) ----
INSERT INTO public.wilayah_alias (kind, alias_norm, canonical_norm, note) VALUES
  ('kabupaten','tanjab barat','tanjung jabung barat',NULL),
  ('kabupaten','tanjab timur','tanjung jabung timur',NULL),
  ('kabupaten','mateng','mamuju tengah',NULL),
  ('kabupaten','parimo','parigi moutong',NULL),
  ('kabupaten','loteng','lombok tengah',NULL),
  ('kabupaten','lobar','lombok barat',NULL),
  ('kabupaten','lotim','lombok timur',NULL),
  ('kabupaten','bolmut','bolaang mongondow utara',NULL),
  ('kabupaten','bolmong','bolaang mongondow',NULL),
  ('kabupaten','bolsel','bolaang mongondow selatan',NULL),
  ('kabupaten','boltim','bolaang mongondow timur',NULL),
  ('kabupaten','bilang mongondow','bolaang mongondow','typo bolaang'),
  ('kabupaten','kuansing','kuantan singingi',NULL),
  ('kabupaten','minsel','minahasa selatan',NULL),
  ('kabupaten','minut','minahasa utara',NULL),
  ('kabupaten','mitra','minahasa tenggara',NULL),
  ('kabupaten','pangkep','pangkajene dan kepulauan',NULL),
  ('kabupaten','banyuwangi','banyuwangi','noop')
ON CONFLICT (kind, alias_norm) DO UPDATE SET canonical_norm = EXCLUDED.canonical_norm;

-- ============================================================================
-- 2. wilayah_expand_aliases — expand singkatan dalam blob ter-normalize.
--    Phrase-based (space-padded) biar gak ngerusak kata lain. STABLE (baca tabel).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wilayah_expand_aliases(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v TEXT;
  r RECORD;
BEGIN
  v := ' ' || public.wilayah_norm(p_text) || ' ';
  -- alias panjang dulu (mis. "tanjab timur" sebelum potongan pendek)
  FOR r IN SELECT alias_norm, canonical_norm FROM public.wilayah_alias ORDER BY length(alias_norm) DESC LOOP
    IF position(' ' || r.alias_norm || ' ' IN v) > 0 THEN
      v := replace(v, ' ' || r.alias_norm || ' ', ' ' || r.canonical_norm || ' ');
    END IF;
  END LOOP;
  RETURN btrim(regexp_replace(v, '\s+', ' ', 'g'));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.wilayah_expand_aliases(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wilayah_expand_aliases(text) TO authenticated;

-- ============================================================================
-- 3. resolve_draft_wilayah — step C (gram scan) pakai blob ter-EXPAND.
--    Sisanya identik mig 087 (postal, struktural, kota→provinsi). Disambiguasi
--    tetap: HAVING unik → ambigu biarin ⚠️ (anti salah-provinsi / B3).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_draft_wilayah(p_org bigint, p_draft_ids bigint[])
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE v_a int; v_b int; v_c int; v_d int;
BEGIN
  -- ========== A. KODE POS (primary) ==========
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

  -- ========== B. kota+kecamatan terstruktur exact ==========
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

  -- ========== C. GRAM SCAN nama tempat (blob ter-EXPAND + SCORING spesifisitas)
  -- Skor = panjang gram subdistrict (kata) + (jumlah kata city kalau city muncul
  -- utuh sbg gram) + (jumlah kata provinsi kalau muncul). Pilih SATU lokasi
  -- skor-tertinggi; kalau seri antar-lokasi → ⚠️ (anti salah-provinsi / B3).
  -- Stopword 1-kata (barat/timur/tengah/dst) dibuang biar gak false-match ke
  -- kecamatan bernama arah di daerah lain (mis. "barat"→Magetan). City utuh
  -- ("mamuju tengah") ngalahin parsial ("mamuju"); ("kapuas hulu") ngalahin
  -- ("kapuas") → Kapuas Hulu/Kalbar menang, BUKAN Kapuas/Kalteng. ==========
  WITH unresolved AS (
    SELECT d.id,
      public.wilayah_expand_aliases(
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
    -- 1-kata: buang stopword arah/generik (false-match ke kec bernama sama).
    -- sord = posisi kata pertama gram (buat deteksi penanda "kecamatan" di depan).
    SELECT id, w AS g, 1 AS glen, ord AS sord FROM words
      WHERE length(w) >= 4 AND w NOT IN (
        'barat','timur','utara','selatan','tengah','pusat','raya','baru','jaya',
        'kota','desa','dusun','jalan','blok','lingkungan','kelurahan','kecamatan',
        'kabupaten','provinsi','perumahan','komplek','kompleks','gang','nomor')
    UNION ALL SELECT a.id, a.w || ' ' || b.w, 2, a.ord FROM words a JOIN words b ON b.id = a.id AND b.ord = a.ord + 1
    UNION ALL SELECT a.id, a.w || ' ' || b.w || ' ' || c.w, 3, a.ord FROM words a JOIN words b ON b.id = a.id AND b.ord = a.ord + 1 JOIN words c ON c.id = a.id AND c.ord = a.ord + 2
  ),
  -- penanda eksplisit: gram yang persis didahului "kecamatan/kec/kcmtn" → boost
  gram_marked AS (
    SELECT g.id, g.g, g.glen,
      EXISTS (SELECT 1 FROM words wm WHERE wm.id = g.id AND wm.ord = g.sord - 1
              AND wm.w IN ('kecamatan','kec','kcmtn','kcmtn','kcamatan','kacamatan','kecmtn')) AS after_kec
    FROM grams g
  ),
  gram_set AS (SELECT id, g, max(glen) AS glen, bool_or(after_kec) AS after_kec FROM gram_marked GROUP BY id, g),
  cand AS (
    SELECT gs.id, mw.province, mw.city, mw.subdistrict, mw.zip, mw.id AS wid,
      mw.city_normalized, mw.province_normalized, gs.glen AS sub_len, gs.after_kec
    FROM gram_set gs JOIN public.master_wilayah mw ON mw.subdistrict_normalized = gs.g
  ),
  scored AS (
    SELECT c.id, c.province, c.city, c.subdistrict, c.zip, c.wid, c.city_normalized, c.sub_len, c.after_kec,
      c.sub_len
      + COALESCE((SELECT (length(c.city_normalized) - length(replace(c.city_normalized, ' ', '')) + 1)
                  FROM gram_set g WHERE g.id = c.id AND g.g = c.city_normalized LIMIT 1), 0)
      + COALESCE((SELECT (length(c.province_normalized) - length(replace(c.province_normalized, ' ', '')) + 1)
                  FROM gram_set g WHERE g.id = c.id AND g.g = c.province_normalized LIMIT 1), 0)
      + CASE WHEN c.after_kec THEN 5 ELSE 0 END   -- penanda "Kecamatan: X" eksplisit
      AS score
    FROM cand c
  ),
  -- lolos kalau ter-korroborasi (city/provinsi muncul) ATAU ada penanda kecamatan
  corrob AS (SELECT * FROM scored WHERE score > sub_len OR after_kec),
  maxsc AS (SELECT id, max(score) AS ms FROM corrob GROUP BY id),
  top AS (SELECT c.* FROM corrob c JOIN maxsc m ON m.id = c.id AND c.score = m.ms),
  best AS (
    SELECT id,
      (array_agg(province))[1] AS province,
      (array_agg(city))[1] AS city,
      (array_agg(subdistrict))[1] AS subdistrict,
      (array_agg(zip))[1] AS zip,
      (array_agg(wid))[1] AS wid
    FROM top
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

  -- ========== D. kota→provinsi (partial fill) ==========
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

-- ============================================================================
-- 4. suggest_draft_wilayah — pakai blob ter-EXPAND juga (chip saran fix-mode).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.suggest_draft_wilayah(
  p_draft_id BIGINT,
  p_limit INTEGER DEFAULT 6
)
RETURNS TABLE(
  id BIGINT, province TEXT, city TEXT, subdistrict TEXT, zip TEXT, score INT, source TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
  v_blob TEXT;
  v_nblob TEXT;
BEGIN
  v_org_id := public.current_org_id();
  SELECT
    COALESCE(d.customer_zip, '') || ' ' || COALESCE(d.customer_address_detail, '') || ' ' ||
    COALESCE(d.customer_address, '') || ' ' || COALESCE(d.customer_subdistrict, '') || ' ' ||
    COALESCE(d.customer_city, '') || ' ' || COALESCE(d.customer_province, '')
  INTO v_blob
  FROM public.orders_draft d
  WHERE d.id = p_draft_id AND d.organization_id = v_org_id;
  IF v_blob IS NULL THEN RETURN; END IF;
  v_nblob := public.wilayah_expand_aliases(v_blob);

  RETURN QUERY
  WITH
  zips AS (
    SELECT DISTINCT m[1] AS zip
    FROM regexp_matches(v_blob, '(\d{5})', 'g') AS m
  ),
  postal_cand AS (
    SELECT mw.id, mw.province, mw.city, mw.subdistrict, mw.zip, 100 AS score, 'kodepos'::text AS source
    FROM zips z JOIN public.master_wilayah mw ON mw.zip = z.zip
  ),
  words AS (
    SELECT w.w AS w, w.ord AS ord
    FROM regexp_split_to_table(v_nblob, '\s+') WITH ORDINALITY w(w, ord)
    WHERE w.w <> '' AND length(w.w) >= 3
  ),
  grams AS (
    SELECT w AS g FROM words
    WHERE length(w) >= 4 AND w NOT IN (
      'barat','timur','utara','selatan','tengah','pusat','raya','baru','jaya',
      'kota','desa','dusun','jalan','blok','lingkungan','kelurahan','kecamatan',
      'kabupaten','provinsi','perumahan','komplek','kompleks','gang','nomor'
    )
    UNION ALL SELECT a.w || ' ' || b.w FROM words a JOIN words b ON b.ord = a.ord + 1
    UNION ALL SELECT a.w || ' ' || b.w || ' ' || c.w FROM words a JOIN words b ON b.ord = a.ord + 1 JOIN words c ON c.ord = a.ord + 2
  ),
  gram_set AS (SELECT DISTINCT g FROM grams),
  gram_cand AS (
    SELECT mw.id, mw.province, mw.city, mw.subdistrict, mw.zip,
      CASE
        WHEN EXISTS (SELECT 1 FROM gram_set g WHERE g.g = mw.city_normalized)
          OR EXISTS (SELECT 1 FROM gram_set g WHERE g.g = mw.province_normalized)
        THEN 90 ELSE 72
      END AS score,
      'nama'::text AS source
    FROM public.master_wilayah mw
    WHERE mw.subdistrict_normalized IN (SELECT g FROM gram_set)
  ),
  unioned AS (
    SELECT id, province, city, subdistrict, zip, score, source FROM postal_cand
    UNION ALL
    SELECT id, province, city, subdistrict, zip, score, source FROM gram_cand
  ),
  ranked AS (
    SELECT DISTINCT ON (province, city, subdistrict)
      id, province, city, subdistrict, zip, score, source
    FROM unioned
    ORDER BY province, city, subdistrict, score DESC
  )
  SELECT r.id, r.province, r.city, r.subdistrict, r.zip, r.score, r.source
  FROM ranked r
  ORDER BY r.score DESC, r.city, r.subdistrict
  LIMIT GREATEST(1, p_limit);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.suggest_draft_wilayah(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_draft_wilayah(bigint, integer) TO authenticated;

-- ============================================================================
-- 5. normalize_phone_canonical — strip iteratif (handle "+62085..." → "85...").
--    Strip leading "62" lalu strip semua leading "0". Output canonical 8xxx.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.normalize_phone_canonical(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH d AS (SELECT regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g') AS digits),
  s1 AS (SELECT CASE WHEN left(digits, 2) = '62' THEN substr(digits, 3) ELSE digits END AS digits FROM d),
  s2 AS (SELECT regexp_replace(digits, '^0+', '') AS digits FROM s1)
  SELECT CASE WHEN length(digits) < 8 THEN NULL ELSE digits END FROM s2;
$$;
