-- 088 — Brief #7: Rombak Antrian Kerja (Status Jujur + Benerin Alamat fix-mode)
-- ============================================================================
-- SUMBER TUNGGAL KESIAPAN = wilayah_id. Order ke-resolve ke 1 entitas
-- master_wilayah valid (wilayah_id IS NOT NULL) = "Siap Export". Else ⚠️
-- "Perlu Dibenerin". Chip atas, badge row, filter ⚠️, dan fix-mode SEMUA
-- baca wilayah_id. Fix "124 Siap Kirim 100%" padahal 47 alamat incomplete.
--
-- 3 perubahan:
--   1. list_orders_draft_enriched — expose wilayah_id + customer_subdistrict +
--      customer_zip (sebelumnya cuma province+city PROXY dari #5).
--   2. get_draft_readiness_stats(from,to,status,search) — hitung ready vs
--      not_ready se-FILTER (bukan cuma 1 halaman) → headline jujur.
--   3. suggest_draft_wilayah(draft_id,limit) — versi READ-ONLY resolver #6:
--      kasih kandidat entitas wilayah (kodepos + gram scan) buat chip saran
--      1-klik di fix-mode. Top score = ★. Tidak mutate.
-- Idempotent. INVOKER (RLS cukup). Set-based.

-- ============================================================================
-- 1. list_orders_draft_enriched — tambah wilayah_id + subdistrict + zip
--    (return signature berubah → DROP dulu).
-- ============================================================================
DROP FUNCTION IF EXISTS public.list_orders_draft_enriched(date, date, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.list_orders_draft_enriched(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id BIGINT,
  order_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  customer_province TEXT,
  customer_subdistrict TEXT,
  customer_zip TEXT,
  wilayah_id BIGINT,
  status TEXT,
  priority TEXT,
  payment_method TEXT,
  subtotal NUMERIC,
  total NUMERIC,
  cod_amount NUMERIC,
  estimated_profit NUMERIC,
  cs_name TEXT,
  channel_name TEXT,
  product_summary TEXT,
  product_count INTEGER,
  cs_attempts INTEGER,
  internal_note TEXT,
  customer_note TEXT,
  reject_reason TEXT,
  last_contact_at TIMESTAMPTZ,
  order_date DATE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  RETURN QUERY
  WITH filtered AS (
    SELECT o.*
    FROM public.orders_draft o
    WHERE o.organization_id = v_org_id
      AND (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to IS NULL OR o.order_date <= p_to)
      AND (p_status IS NULL OR o.status = p_status)
      AND (
        p_search IS NULL
        OR o.order_number ILIKE '%' || p_search || '%'
        OR o.customer_name ILIKE '%' || p_search || '%'
        OR COALESCE(o.customer_phone, '') ILIKE '%' || p_search || '%'
      )
  ),
  products_agg AS (
    SELECT
      oi.order_id,
      STRING_AGG(
        COALESCE(p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)',
        ', '
        ORDER BY oi.id
      ) AS summary,
      COUNT(*)::INT AS cnt
    FROM public.order_items_draft oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id IN (SELECT id FROM filtered)
    GROUP BY oi.order_id
  ),
  total AS (SELECT COUNT(*) AS cnt FROM filtered)
  SELECT
    fo.id,
    fo.order_number,
    fo.customer_name,
    fo.customer_phone,
    fo.customer_city,
    fo.customer_province,
    fo.customer_subdistrict,
    fo.customer_zip,
    fo.wilayah_id,
    fo.status,
    fo.priority,
    fo.payment_method,
    fo.subtotal,
    fo.total,
    fo.cod_amount,
    fo.estimated_profit,
    COALESCE((SELECT full_name FROM public.profiles WHERE id = fo.cs_id), fo.cs_name) AS cs_name,
    (SELECT name FROM public.courier_channels WHERE id = fo.channel_id) AS channel_name,
    COALESCE(pa.summary, '—') AS product_summary,
    COALESCE(pa.cnt, 0) AS product_count,
    fo.cs_attempts,
    fo.internal_note,
    fo.customer_note,
    fo.reject_reason,
    fo.last_contact_at,
    fo.order_date,
    fo.created_at,
    fo.updated_at,
    (SELECT cnt FROM total) AS total_count
  FROM filtered fo
  LEFT JOIN products_agg pa ON pa.order_id = fo.id
  ORDER BY fo.created_at DESC, fo.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_orders_draft_enriched(date, date, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_orders_draft_enriched(date, date, text, text, integer, integer) TO authenticated;

-- ============================================================================
-- 2. get_draft_readiness_stats — ready vs not_ready se-FILTER (semua draft,
--    bukan cuma 1 halaman). Headline jujur "Siap Export N · Perlu Dibenerin M".
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_draft_readiness_stats(date, date, text, text);

CREATE OR REPLACE FUNCTION public.get_draft_readiness_stats(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(ready BIGINT, not_ready BIGINT, total BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE o.wilayah_id IS NOT NULL)::BIGINT AS ready,
    COUNT(*) FILTER (WHERE o.wilayah_id IS NULL)::BIGINT AS not_ready,
    COUNT(*)::BIGINT AS total
  FROM public.orders_draft o
  WHERE o.organization_id = v_org_id
    AND (p_from IS NULL OR o.order_date >= p_from)
    AND (p_to IS NULL OR o.order_date <= p_to)
    AND (p_status IS NULL OR o.status = p_status)
    AND (
      p_search IS NULL
      OR o.order_number ILIKE '%' || p_search || '%'
      OR o.customer_name ILIKE '%' || p_search || '%'
      OR COALESCE(o.customer_phone, '') ILIKE '%' || p_search || '%'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_draft_readiness_stats(date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_draft_readiness_stats(date, date, text, text) TO authenticated;

-- ============================================================================
-- 3. suggest_draft_wilayah — READ-ONLY kandidat wilayah dari resolver #6.
--    Buat chip saran 1-klik di fix-mode "Benerin Alamat". Top score = ★.
--    Sumber: (A) KODE POS (score 100), (B) GRAM SCAN nama tempat dengan
--    corroborasi kota/provinsi (score 90 kalau ada corrob, 72 kalau cuma
--    kecamatan match). Dedup per (provinsi,kota,kecamatan). Tidak mutate.
-- ============================================================================
DROP FUNCTION IF EXISTS public.suggest_draft_wilayah(bigint, integer);

CREATE OR REPLACE FUNCTION public.suggest_draft_wilayah(
  p_draft_id BIGINT,
  p_limit INTEGER DEFAULT 6
)
RETURNS TABLE(
  id BIGINT,
  province TEXT,
  city TEXT,
  subdistrict TEXT,
  zip TEXT,
  score INT,
  source TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
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
  v_nblob := public.wilayah_norm(v_blob);

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
    SELECT w AS g FROM words WHERE length(w) >= 4
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
$$;

REVOKE EXECUTE ON FUNCTION public.suggest_draft_wilayah(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_draft_wilayah(bigint, integer) TO authenticated;
