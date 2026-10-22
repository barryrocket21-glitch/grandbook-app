-- Calculate postcode tokens and candidate features once per suggestion.
-- Ranking/context and authoritative IDs are preserved; no business rows change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.resolve_address_candidates(
 p_raw text, p_city text, p_subdistrict text, p_province text, p_limit integer DEFAULT 6)
RETURNS TABLE(id bigint, province text, city text, subdistrict text, zip text, score integer, source text)
LANGUAGE sql STABLE SET search_path TO public, extensions AS $$
 WITH context AS MATERIALIZED (
 SELECT public.address_search_text(left(p_raw,10000)) raw,
 public.address_search_text(regexp_replace(coalesce(p_city,''),'^(kabupaten|kab|kota)[. ]+','','i')) city,public.address_search_text(regexp_replace(coalesce(p_subdistrict,''),'^(kecamatan|kec)[. ]+','','i')) sub,
 public.address_search_text(p_province) province
 ), postcodes AS MATERIALIZED (
 SELECT DISTINCT token[1] zip FROM context,regexp_matches(raw,'[0-9]+','g') token WHERE length(token[1])=5
 ), words AS MATERIALIZED (
 SELECT w,ord FROM context,regexp_split_to_table(raw,'\s+') WITH ORDINALITY x(w,ord)
 ), grams AS MATERIALIZED (
 SELECT w g FROM words WHERE length(w)>=4
 UNION SELECT a.w||' '||b.w FROM words a JOIN words b ON b.ord=a.ord+1
 UNION SELECT a.w||' '||b.w||' '||c.w FROM words a JOIN words b ON b.ord=a.ord+1 JOIN words c ON c.ord=a.ord+2
 ), locations AS MATERIALIZED (
 SELECT min(id) id,province,city,subdistrict,zip,province_normalized,city_normalized,subdistrict_normalized
 FROM public.master_wilayah
 GROUP BY province,city,subdistrict,zip,province_normalized,city_normalized,subdistrict_normalized
 ), features AS MATERIALIZED (
 SELECT m.*,c.raw,c.city ctx_city,c.province ctx_province,
 (m.zip IN (SELECT zip FROM postcodes)) postal,
 (position(' '||m.subdistrict_normalized||' ' IN ' '||c.raw||' ')>0) exact_sub,
 (m.city_normalized=c.city OR position(' '||m.city_normalized||' ' IN ' '||c.raw||' ')>0) city_match,
 (m.province_normalized=c.province OR position(' '||m.province_normalized||' ' IN ' '||c.raw||' ')>0) province_match,
 similarity(m.subdistrict_normalized,c.sub) structured_similarity
 FROM locations m CROSS JOIN context c
 ), matches AS (
 SELECT f.* FROM features f
 WHERE postal OR exact_sub OR (city_match AND structured_similarity>=0.42 AND city_normalized=ctx_city)
 OR ((city_match OR province_match) AND EXISTS (
   SELECT 1 FROM grams WHERE f.subdistrict_normalized % g AND similarity(f.subdistrict_normalized,g)>=0.55))
 ), scored AS (
 SELECT m.id,m.province,m.city,m.subdistrict,m.zip,
 (CASE WHEN postal THEN 120 ELSE 0 END
 + CASE WHEN exact_sub THEN 100
        WHEN city_match AND structured_similarity>=0.42 THEN 60+round(structured_similarity*40)::int ELSE 60 END
 + CASE WHEN city_match THEN 30 ELSE 0 END + CASE WHEN province_match THEN 20 ELSE 0 END)::int score,
 CASE WHEN postal THEN 'kodepos' WHEN exact_sub THEN 'nama' ELSE 'fuzzy' END source
 FROM matches m
 -- Explicit geography narrows fuzzy guesses; exact/postal evidence remains visible for human review.
 WHERE postal OR exact_sub OR ((ctx_city='' OR city_match) AND (ctx_province='' OR province_match))
 ), ranked AS (
 SELECT DISTINCT ON (province,city,subdistrict) * FROM scored
 ORDER BY province,city,subdistrict,score DESC,id
 ) SELECT * FROM ranked ORDER BY score DESC,province,city,subdistrict,id LIMIT least(20,greatest(1,p_limit));
$$;

COMMIT;
