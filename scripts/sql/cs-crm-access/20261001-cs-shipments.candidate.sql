-- Candidate: read-only own-CS shipments, exact terminal groups and follow-up context.
CREATE OR REPLACE FUNCTION public.list_my_cs_shipments(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_group text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, order_number text, order_date date, spx_created_at timestamp with time zone, customer_name text, customer_phone text, customer_city text, product_summary text, product_variation text, cod_amount numeric, tracking_no text, tracking_status text, delivered_at timestamp with time zone, returned_at timestamp with time zone, cs_name text, total_count bigint, delivered_count bigint, returned_count bigint, in_progress_count bigint, no_resi_count bigint, problem_count bigint, order_status text, problem_type text, reject_reason text, source text, delivery_group text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org BIGINT;
  v_uid UUID;
  v_role TEXT;
  v_full_name TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT p.organization_id, p.role, p.full_name
    INTO v_org, v_role, v_full_name
  FROM public.profiles p
  WHERE p.id = v_uid
    AND p.active = TRUE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF v_role <> 'cs' THEN
    RAISE EXCEPTION 'forbidden_cs_only';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      d.id,
      d.order_number,
      d.order_date,
      d.spx_created_at,
      d.customer_name,
      d.customer_phone,
      d.customer_city,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items_draft oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = d.id), '—') AS product_summary,
      (SELECT STRING_AGG(COALESCE(oi.variation, ''), ', ' ORDER BY oi.id)
         FROM public.order_items_draft oi WHERE oi.order_id = d.id) AS product_variation,
      d.cod_amount,
      COALESCE(NULLIF(BTRIM(d.tracking_no), ''), d.resi) AS tracking_no,
      d.tracking_status,
      d.delivered_at,
      d.returned_at,
      d.status::text AS order_status, d.problem_type, d.reject_reason, 'draft'::text AS source,
      COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = d.cs_id), d.cs_name) AS cs_name
    FROM public.orders_draft d
    WHERE d.organization_id = v_org
      AND (
        (NULLIF(TRIM(v_full_name), '') IS NOT NULL AND LOWER(TRIM(COALESCE(d.cs_name, ''))) = LOWER(TRIM(v_full_name)))
        OR (COALESCE(TRIM(d.cs_name), '') = '' AND d.cs_id = v_uid)
      )
      AND (
        d.fulfillment_category = 'FIX_ORDER'
        OR COALESCE(TRIM(COALESCE(NULLIF(BTRIM(d.tracking_no), ''),d.resi)), '') <> ''
      )

    UNION ALL

    SELECT
      o.id,
      o.order_number,
      o.order_date,
      o.spx_created_at,
      o.customer_name,
      o.customer_phone,
      o.customer_city,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = o.id), '—') AS product_summary,
      (SELECT STRING_AGG(COALESCE(oi.variation, ''), ', ' ORDER BY oi.id)
         FROM public.order_items oi WHERE oi.order_id = o.id) AS product_variation,
      o.cod_amount,
      COALESCE(NULLIF(BTRIM(o.tracking_no), ''), o.resi) AS tracking_no,
      o.tracking_status,
      o.delivered_at,
      o.returned_at,
      o.status::text AS order_status, o.problem_type, o.reject_reason, 'final'::text AS source,
      COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = o.cs_id), o.cs_name) AS cs_name
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND (
        (NULLIF(TRIM(v_full_name), '') IS NOT NULL AND LOWER(TRIM(COALESCE(o.cs_name, ''))) = LOWER(TRIM(v_full_name)))
        OR (COALESCE(TRIM(o.cs_name), '') = '' AND o.cs_id = v_uid)
      )
      AND (
        o.fulfillment_category = 'FIX_ORDER'
        OR COALESCE(TRIM(COALESCE(NULLIF(BTRIM(o.tracking_no), ''), o.resi)), '') <> ''
      )
  ),
  classified AS (
    SELECT b.*, CASE
      WHEN UPPER(BTRIM(COALESCE(b.tracking_status,''))) IN ('DELIVERED','DITERIMA') THEN 'delivered'
      WHEN UPPER(BTRIM(COALESCE(b.tracking_status,''))) IN ('RETURNED','RETUR','RETURN COMPLETED') THEN 'returned'
      WHEN b.order_status='PROBLEM' OR COALESCE(b.tracking_status,'') ~* '(fail|unsuccess|exception|hold|kendala|return|cancel|lost|damaged|bermasalah)' THEN 'problem'
      WHEN COALESCE(BTRIM(b.tracking_no),'')='' THEN 'no_resi'
      ELSE 'progress' END AS delivery_group
    FROM base b
  ),
  filtered AS (
    SELECT * FROM classified b
    WHERE (p_group IS NULL OR b.delivery_group=p_group)
      AND (p_from IS NULL OR COALESCE((b.spx_created_at AT TIME ZONE 'Asia/Jakarta')::date, b.order_date) >= p_from)
      AND (p_to IS NULL OR COALESCE((b.spx_created_at AT TIME ZONE 'Asia/Jakarta')::date, b.order_date) <= p_to)
      AND (p_status IS NULL OR COALESCE(b.tracking_status, '') ILIKE '%' || p_status || '%')
      AND (
        p_search IS NULL
        OR b.order_number ILIKE '%' || p_search || '%'
        OR COALESCE(b.tracking_no, '') ILIKE '%' || p_search || '%'
        OR COALESCE(b.customer_name, '') ILIKE '%' || p_search || '%'
        OR COALESCE(b.customer_phone, '') ILIKE '%' || p_search || '%'
        OR COALESCE(b.product_summary, '') ILIKE '%' || p_search || '%'
      )
  ),
  cnt AS (
    SELECT
      COUNT(*)::BIGINT AS total_n,
      COUNT(*) FILTER (WHERE c.delivery_group='delivered')::BIGINT AS delivered_n,
      COUNT(*) FILTER (WHERE c.delivery_group='returned')::BIGINT AS returned_n,
      COUNT(*) FILTER (WHERE c.delivery_group='progress')::BIGINT AS in_progress_n,
      COUNT(*) FILTER (WHERE c.delivery_group='no_resi')::BIGINT AS no_resi_n,
      COUNT(*) FILTER (WHERE c.delivery_group='problem')::BIGINT AS problem_n
    FROM filtered c
  )
  SELECT
    f.id, f.order_number, f.order_date, f.spx_created_at,
    f.customer_name, f.customer_phone, f.customer_city,
    f.product_summary, f.product_variation, f.cod_amount,
    f.tracking_no, f.tracking_status, f.delivered_at, f.returned_at,
    f.cs_name,
    (SELECT total_n FROM cnt),
    (SELECT delivered_n FROM cnt),
    (SELECT returned_n FROM cnt),
    (SELECT in_progress_n FROM cnt),
    (SELECT no_resi_n FROM cnt), (SELECT problem_n FROM cnt),
    f.order_status, f.problem_type, f.reject_reason, f.source, f.delivery_group
  FROM filtered f
  ORDER BY f.spx_created_at DESC NULLS LAST, f.order_number DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000) OFFSET GREATEST(p_offset, 0);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_my_cs_shipments(date,date,text,text,integer,integer,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_cs_shipments(date,date,text,text,integer,integer,text) TO authenticated;
