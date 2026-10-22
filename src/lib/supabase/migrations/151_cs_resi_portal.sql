-- 151 — CS scoped resi portal
-- CS users can see only their own FIX_ORDER / resi status.

CREATE OR REPLACE FUNCTION public.list_my_cs_resi(
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
  order_date DATE,
  spx_created_at TIMESTAMPTZ,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  product_summary TEXT,
  product_variation TEXT,
  cod_amount NUMERIC,
  tracking_no TEXT,
  tracking_status TEXT,
  delivered_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  cs_name TEXT,
  total_count BIGINT,
  delivered_count BIGINT,
  returned_count BIGINT,
  in_progress_count BIGINT,
  no_resi_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
      d.tracking_no,
      d.tracking_status,
      d.delivered_at,
      d.returned_at,
      COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = d.cs_id), d.cs_name) AS cs_name
    FROM public.orders_draft d
    WHERE d.organization_id = v_org
      AND (
        LOWER(TRIM(COALESCE(d.cs_name, ''))) = LOWER(TRIM(COALESCE(v_full_name, '')))
        OR (COALESCE(TRIM(d.cs_name), '') = '' AND d.cs_id = v_uid)
      )
      AND (
        d.fulfillment_category = 'FIX_ORDER'
        OR COALESCE(TRIM(d.tracking_no), '') <> ''
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
      COALESCE(o.tracking_no, o.resi) AS tracking_no,
      o.tracking_status,
      o.delivered_at,
      o.returned_at,
      COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = o.cs_id), o.cs_name) AS cs_name
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND (
        LOWER(TRIM(COALESCE(o.cs_name, ''))) = LOWER(TRIM(COALESCE(v_full_name, '')))
        OR (COALESCE(TRIM(o.cs_name), '') = '' AND o.cs_id = v_uid)
      )
      AND (
        o.fulfillment_category = 'FIX_ORDER'
        OR COALESCE(TRIM(COALESCE(o.tracking_no, o.resi)), '') <> ''
      )
  ),
  filtered AS (
    SELECT * FROM base b
    WHERE (p_from IS NULL OR COALESCE(b.spx_created_at::date, b.order_date) >= p_from)
      AND (p_to IS NULL OR COALESCE(b.spx_created_at::date, b.order_date) <= p_to)
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
      COUNT(*) FILTER (WHERE COALESCE(c.tracking_status, '') ILIKE '%DELIVER%')::BIGINT AS delivered_n,
      COUNT(*) FILTER (WHERE COALESCE(c.tracking_status, '') ILIKE '%RETURN%' OR c.returned_at IS NOT NULL)::BIGINT AS returned_n,
      COUNT(*) FILTER (WHERE COALESCE(TRIM(c.tracking_no), '') <> '' AND COALESCE(c.tracking_status, '') NOT ILIKE '%DELIVER%' AND COALESCE(c.tracking_status, '') NOT ILIKE '%RETURN%')::BIGINT AS in_progress_n,
      COUNT(*) FILTER (WHERE COALESCE(TRIM(c.tracking_no), '') = '')::BIGINT AS no_resi_n
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
    (SELECT no_resi_n FROM cnt)
  FROM filtered f
  ORDER BY f.spx_created_at DESC NULLS LAST, f.order_number DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000) OFFSET GREATEST(p_offset, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_cs_resi(DATE, DATE, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
