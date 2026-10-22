-- Apply with the auth hardening package. No business-row updates.
BEGIN;
CREATE OR REPLACE FUNCTION public.address_search_text(p_text text)
RETURNS text LANGUAGE sql STABLE SET search_path TO public AS $$
 SELECT public.wilayah_expand_aliases(regexp_replace(coalesce(p_text,''),
   '([a-z])(kecamatan|kabupaten|kelurahan|provinsi)', '\1 \2', 'gi'));
$$;

CREATE OR REPLACE FUNCTION public.wilayah_autocomplete(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE(id bigint, province text, city text, subdistrict text, zip text, score real)
LANGUAGE sql STABLE SET search_path TO public, extensions AS $$
 WITH q AS (SELECT public.address_search_text(left(p_query,200)) s), candidates AS (
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

CREATE OR REPLACE FUNCTION public.resolve_address_candidates(
 p_raw text, p_city text, p_subdistrict text, p_province text, p_limit integer DEFAULT 6)
RETURNS TABLE(id bigint, province text, city text, subdistrict text, zip text, score integer, source text)
LANGUAGE sql STABLE SET search_path TO public, extensions AS $$
 WITH context AS MATERIALIZED (
 SELECT public.address_search_text(left(p_raw,10000)) raw,
 public.address_search_text(regexp_replace(coalesce(p_city,''),'^(kabupaten|kab|kota)[. ]+','','i')) city,public.address_search_text(regexp_replace(coalesce(p_subdistrict,''),'^(kecamatan|kec)[. ]+','','i')) sub,
 public.address_search_text(p_province) province
 ), words AS (
 SELECT w,ord FROM context,regexp_split_to_table(raw,'\s+') WITH ORDINALITY x(w,ord)
 ), grams AS (
 SELECT w g FROM words WHERE length(w)>=4
 UNION SELECT a.w||' '||b.w FROM words a JOIN words b ON b.ord=a.ord+1
 UNION SELECT a.w||' '||b.w||' '||c.w FROM words a JOIN words b ON b.ord=a.ord+1 JOIN words c ON c.ord=a.ord+2
 ), matches AS (
 SELECT m.*,c.raw,c.city ctx_city,c.province ctx_province,
 (nullif(m.zip,'') IS NOT NULL AND (' '||c.raw||' ') ~ ('(^|[^0-9])'||m.zip||'([^0-9]|$)')) postal,
 (position(' '||m.subdistrict_normalized||' ' IN ' '||c.raw||' ')>0) exact_sub,
 (m.city_normalized=c.city OR position(' '||m.city_normalized||' ' IN ' '||c.raw||' ')>0) city_match,
 (m.province_normalized=c.province OR position(' '||m.province_normalized||' ' IN ' '||c.raw||' ')>0) province_match,
 similarity(m.subdistrict_normalized,c.sub) structured_similarity
 FROM public.master_wilayah m CROSS JOIN context c
 WHERE (nullif(m.zip,'') IS NOT NULL AND (' '||c.raw||' ') ~ ('(^|[^0-9])'||m.zip||'([^0-9]|$)'))
 OR position(' '||m.subdistrict_normalized||' ' IN ' '||c.raw||' ')>0
 OR (m.city_normalized=c.city AND similarity(m.subdistrict_normalized,c.sub)>=0.42)
 OR ((m.city_normalized=c.city OR m.province_normalized=c.province
   OR position(' '||m.city_normalized||' ' IN ' '||c.raw||' ')>0
   OR position(' '||m.province_normalized||' ' IN ' '||c.raw||' ')>0) AND EXISTS (
   SELECT 1 FROM grams WHERE m.subdistrict_normalized % g AND similarity(m.subdistrict_normalized,g)>=0.55))
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

CREATE OR REPLACE FUNCTION public.suggest_draft_wilayah(p_draft_id bigint,p_limit integer DEFAULT 6)
RETURNS TABLE(id bigint,province text,city text,subdistrict text,zip text,score integer,source text)
LANGUAGE sql STABLE SET search_path TO public AS $$
 SELECT r.* FROM public.orders_draft d CROSS JOIN LATERAL public.resolve_address_candidates(
 concat_ws(' ',d.customer_zip,d.customer_address_detail,d.customer_address,d.customer_subdistrict,d.customer_city,d.customer_province),
 d.customer_city,d.customer_subdistrict,d.customer_province,p_limit) r
 WHERE d.id=p_draft_id AND d.organization_id=public.current_org_id();
$$;

CREATE OR REPLACE FUNCTION public.address_review_queue(
 p_status text DEFAULT NULL,p_search text DEFAULT NULL,p_from date DEFAULT NULL,p_to date DEFAULT NULL,
 p_include_complete boolean DEFAULT false,p_after bigint DEFAULT 0)
RETURNS SETOF jsonb LANGUAGE sql STABLE SET search_path TO public AS $$
 SELECT jsonb_build_object('id',d.id,'order_number',d.order_number,'customer_name',d.customer_name,
 'customer_phone',d.customer_phone,'customer_address',d.customer_address,'customer_address_detail',d.customer_address_detail,
 'customer_province',d.customer_province,'customer_city',d.customer_city,'customer_subdistrict',d.customer_subdistrict,
 'customer_zip',d.customer_zip,'total',d.total,'updated_at',d.updated_at,
 'product',coalesce((SELECT string_agg(i.product_name_raw||' ('||i.qty||'x)',', ') FROM public.order_items_draft i WHERE i.order_id=d.id),'—'))
 FROM public.orders_draft d LEFT JOIN public.master_wilayah w ON w.id=d.wilayah_id
 WHERE d.organization_id=public.current_org_id() AND public.get_user_role() IN ('owner','admin','cs')
 AND d.id>p_after AND (p_status IS NULL OR p_status='ALL' OR d.status::text=p_status)
 AND (p_from IS NULL OR d.order_date>=p_from) AND (p_to IS NULL OR d.order_date<=p_to)
 AND (nullif(trim(p_search),'') IS NULL OR position(lower(trim(p_search)) IN lower(concat_ws(' ',d.order_number,d.customer_name,d.customer_phone)))>0)
 AND (p_include_complete OR w.id IS NULL OR d.customer_province IS DISTINCT FROM w.province
 OR d.customer_city IS DISTINCT FROM w.city OR d.customer_subdistrict IS DISTINCT FROM w.subdistrict
 OR nullif(trim(d.customer_address_detail),'') IS NULL)
 ORDER BY d.id LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.address_search_text(text),public.resolve_address_candidates(text,text,text,text,integer),public.address_review_queue(text,text,date,date,boolean,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.address_search_text(text),public.resolve_address_candidates(text,text,text,text,integer),public.address_review_queue(text,text,date,date,boolean,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wilayah_autocomplete(text,integer),public.suggest_draft_wilayah(bigint,integer) TO authenticated;
COMMIT;
