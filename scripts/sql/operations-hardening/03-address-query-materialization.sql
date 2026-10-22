-- Normalize the search once per request. Inlining this CTE repeatedly runs
-- alias expansion across the full wilayah table and can exceed 30 seconds.
-- Keep ranking, authoritative IDs, permissions and existing records unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE OR REPLACE FUNCTION public.wilayah_autocomplete(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE(id bigint, province text, city text, subdistrict text, zip text, score real)
LANGUAGE sql STABLE SET search_path TO public, extensions AS $$
 WITH q AS MATERIALIZED (SELECT public.address_search_text(left(p_query,200)) s), candidates AS (
 SELECT m.id,m.province,m.city,m.subdistrict,m.zip,
 (CASE WHEN m.zip=q.s THEN 200 WHEN m.subdistrict_normalized=q.s THEN 150
       WHEN m.city_normalized=q.s THEN 140 ELSE 50 END
  + greatest(similarity(m.subdistrict_normalized,q.s),similarity(m.city_normalized,q.s))*30)::real score
 FROM public.master_wilayah m CROSS JOIN q
 WHERE length(q.s)>=2 AND (
   m.zip LIKE q.s||'%' OR m.subdistrict_normalized % q.s OR m.city_normalized % q.s
   OR m.subdistrict_normalized LIKE '%'||q.s||'%' OR m.city_normalized LIKE '%'||q.s||'%'
   OR m.province_normalized=q.s
   OR (m.subdistrict_normalized||' '||m.city_normalized) LIKE '%'||q.s||'%'
  )
 ), ranked AS (
 SELECT DISTINCT ON (province,city,subdistrict,zip) * FROM candidates
 ORDER BY province,city,subdistrict,zip,score DESC,id
 ) SELECT * FROM ranked ORDER BY score DESC,province,city,subdistrict,zip,id LIMIT least(20,greatest(1,p_limit));
$$;
COMMIT;
