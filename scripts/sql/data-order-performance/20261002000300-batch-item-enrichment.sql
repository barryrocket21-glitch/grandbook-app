-- Preserve invoker/RLS and result contracts; paginate before item enrichment.
BEGIN;
CREATE OR REPLACE FUNCTION public.list_data_orders(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_category text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_date_basis text DEFAULT 'order_date'::text, p_gb_from date DEFAULT NULL::date, p_gb_to date DEFAULT NULL::date, p_spx_from date DEFAULT NULL::date, p_spx_to date DEFAULT NULL::date)
 RETURNS TABLE(id bigint, order_number text, order_date date, spx_created_at timestamp with time zone, status text, fulfillment_category text, customer_name text, payment_method text, customer_phone text, customer_city text, cs_name text, attribution_code_raw text, product_summary text, product_variation text, total numeric, cod_amount numeric, tracking_no text, tracking_status text, exported_at timestamp with time zone, channel_name text, total_count bigint, fix_count bigint, non_coverage_count bigint, pending_count bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org BIGINT;
  v_gb_from DATE;
  v_gb_to DATE;
  v_spx_from DATE;
  v_spx_to DATE;
BEGIN
  v_org := public.current_org_id();

  v_gb_from := p_gb_from;
  v_gb_to := p_gb_to;
  v_spx_from := p_spx_from;
  v_spx_to := p_spx_to;

  IF v_gb_from IS NULL AND v_gb_to IS NULL AND v_spx_from IS NULL AND v_spx_to IS NULL THEN
    IF COALESCE(NULLIF(BTRIM(p_date_basis), ''), 'order_date') = 'spx_created_at' THEN
      v_spx_from := p_from;
      v_spx_to := p_to;
    ELSE
      v_gb_from := p_from;
      v_gb_to := p_to;
    END IF;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      'draft'::text AS source, d.id, d.order_number, d.order_date, d.spx_created_at, d.status, d.fulfillment_category,
      d.customer_name, d.payment_method, d.customer_phone, d.customer_city,
      COALESCE(pr.full_name, d.cs_name) AS cs_name,
      d.attribution_code_raw,
      NULL::text AS product_summary,
      NULL::text AS product_variation,
      d.total, d.cod_amount, coalesce(nullif(trim(d.tracking_no),''),nullif(trim(d.resi),'')) AS tracking_no, d.tracking_status,
      d.exported_at,
      NULL::text AS channel_name, d.exported_channel_id AS lookup_channel_id
    FROM public.orders_draft d LEFT JOIN public.profiles pr ON pr.id=d.cs_id
    WHERE d.organization_id = v_org
    UNION ALL
    SELECT
      'orders'::text AS source, o.id, o.order_number, o.order_date, o.spx_created_at, o.status, o.fulfillment_category,
      o.customer_name, o.payment_method, o.customer_phone, o.customer_city,
      COALESCE(pr.full_name, o.cs_name) AS cs_name,
      o.attribution_code_raw,
      NULL::text AS product_summary,
      NULL::text AS product_variation,
      o.total, o.cod_amount, coalesce(nullif(trim(o.tracking_no),''),nullif(trim(o.resi),'')) AS tracking_no, o.tracking_status,
      NULL::timestamptz AS exported_at,
      NULL::text AS channel_name, o.channel_id AS lookup_channel_id
    FROM public.orders o LEFT JOIN public.profiles pr ON pr.id=o.cs_id
    WHERE o.organization_id = v_org
  ),
  searchable AS (
    SELECT b.*,
           nullif(trim(b.tracking_no),'') IS NOT NULL AS is_fix_order
    FROM base b
    WHERE (p_search IS NULL
           OR b.order_number ILIKE '%'||p_search||'%'
           OR b.customer_name ILIKE '%'||p_search||'%'
           OR b.customer_phone ILIKE '%'||p_search||'%'
           OR COALESCE(b.attribution_code_raw,'') ILIKE '%'||p_search||'%'
           OR COALESCE(b.cs_name,'') ILIKE '%'||p_search||'%'
           OR COALESCE(b.tracking_no,'') ILIKE '%'||p_search||'%')
  ),
  gb_scoped AS (
    SELECT * FROM searchable s
    WHERE (v_gb_from IS NULL OR s.order_date >= v_gb_from)
      AND (v_gb_to IS NULL OR s.order_date <= v_gb_to)
  ),
  fix_scoped AS (
    SELECT * FROM searchable s
    WHERE s.is_fix_order
      AND (v_spx_from IS NULL OR s.spx_created_at >= v_spx_from::timestamp AT TIME ZONE 'Asia/Jakarta')
      AND (v_spx_to IS NULL OR s.spx_created_at < (v_spx_to+1)::timestamp AT TIME ZONE 'Asia/Jakarta')
  ),
  row_filtered AS (
    -- Semua Data: include GB-date ledger rows plus independently SPX-date FIX_ORDER rows.
    SELECT * FROM gb_scoped s WHERE p_category IS NULL
    UNION
    SELECT * FROM fix_scoped s WHERE p_category IS NULL AND (v_spx_from IS NOT NULL OR v_spx_to IS NOT NULL)
    UNION
    SELECT * FROM fix_scoped s WHERE p_category = 'FIX_ORDER'
    UNION
    SELECT * FROM gb_scoped s WHERE p_category = 'GB_NO_RESI' AND NOT s.is_fix_order
    UNION
    SELECT * FROM gb_scoped s WHERE p_category IS NOT NULL AND p_category NOT IN ('FIX_ORDER','GB_NO_RESI') AND s.fulfillment_category = p_category
  ),
  cnt AS (
    SELECT
      (SELECT COUNT(*)::BIGINT FROM row_filtered) AS row_n,
      (SELECT COUNT(*)::BIGINT FROM fix_scoped) AS fix_n,
      (SELECT COUNT(*)::BIGINT FROM gb_scoped WHERE NOT is_fix_order) AS no_resi_n
  ), page AS MATERIALIZED (SELECT * FROM row_filtered b ORDER BY b.exported_at DESC NULLS LAST,b.order_number DESC LIMIT p_limit OFFSET p_offset), item_details AS MATERIALIZED (
 SELECT i.source,i.order_id,
 STRING_AGG(COALESCE(p.display_name,p.name,i.product_name_raw)||' ('||i.qty||'x)', ', ' ORDER BY i.id) product_summary,
 STRING_AGG(COALESCE(i.variation,''), ', ' ORDER BY i.id) product_variation
 FROM (
 SELECT 'draft'::text source,oi.id,oi.order_id,oi.product_id,oi.product_name_raw,oi.qty,oi.variation FROM public.order_items_draft oi JOIN page z ON z.source='draft' AND z.id=oi.order_id
 UNION ALL
 SELECT 'orders'::text source,oi.id,oi.order_id,oi.product_id,oi.product_name_raw,oi.qty,oi.variation FROM public.order_items oi JOIN page z ON z.source='orders' AND z.id=oi.order_id
 ) i LEFT JOIN public.products p ON p.id=i.product_id
 GROUP BY i.source,i.order_id
 )
  SELECT b.id, b.order_number, b.order_date, b.spx_created_at, b.status, b.fulfillment_category,
         b.customer_name, b.payment_method, b.customer_phone, b.customer_city,
         b.cs_name, b.attribution_code_raw, COALESCE(e.product_summary,'—'), e.product_variation,
         b.total, b.cod_amount, b.tracking_no, b.tracking_status,
         b.exported_at, (SELECT name FROM public.courier_channels cc WHERE cc.id=b.lookup_channel_id),
         (SELECT row_n FROM cnt),
         (SELECT fix_n FROM cnt),
         (SELECT no_resi_n FROM cnt),
         (SELECT no_resi_n FROM cnt)
  FROM page b LEFT JOIN item_details e ON e.source=b.source AND e.order_id=b.id
  ORDER BY b.exported_at DESC NULLS LAST, b.order_number DESC
;
END;
$function$;
COMMIT;
