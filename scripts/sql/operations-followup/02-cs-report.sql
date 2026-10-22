BEGIN;
CREATE OR REPLACE FUNCTION public.operations_cs_report(p_date_from date,p_date_to date,p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_org bigint; v_result jsonb;
BEGIN
 SELECT organization_id INTO v_org FROM public.profiles WHERE id=auth.uid() AND active AND role::text IN ('owner','admin');
 IF v_org IS NULL THEN RAISE EXCEPTION 'Hanya owner/admin' USING ERRCODE='42501'; END IF;
 IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from>p_date_to THEN RAISE EXCEPTION 'Rentang tanggal tidak valid' USING ERRCODE='22023'; END IF;
 IF p_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id AND organization_id=v_org) THEN RAISE EXCEPTION 'CS tidak tersedia' USING ERRCODE='42501'; END IF;
 WITH raw AS MATERIALIZED (
  SELECT 'orders'::text source,o.id,o.order_number,o.cs_id,o.customer_name,o.customer_city,o.customer_province,o.status::text,
   coalesce(nullif(trim(o.tracking_no),''),nullif(trim(o.resi),'')) tracking_no,o.tracking_status,o.spx_created_at,o.order_date,o.created_at,o.total,o.cod_amount,o.payment_method::text,o.shipping_cost,o.estimated_cod_fee
  FROM orders o WHERE o.organization_id=v_org
   AND ((o.spx_created_at>=p_date_from::timestamp AT TIME ZONE 'Asia/Jakarta' AND o.spx_created_at<(p_date_to+1)::timestamp AT TIME ZONE 'Asia/Jakarta') OR o.order_date BETWEEN p_date_from AND p_date_to)
  UNION ALL
  SELECT 'draft',o.id,o.order_number,o.cs_id,o.customer_name,o.customer_city,o.customer_province,o.status::text,
   coalesce(nullif(trim(o.tracking_no),''),nullif(trim(o.resi),'')) tracking_no,o.tracking_status,o.spx_created_at,o.order_date,o.created_at,o.total,o.cod_amount,o.payment_method::text,o.shipping_cost,o.estimated_cod_fee
  FROM orders_draft o WHERE o.organization_id=v_org
   AND ((o.spx_created_at>=p_date_from::timestamp AT TIME ZONE 'Asia/Jakarta' AND o.spx_created_at<(p_date_to+1)::timestamp AT TIME ZONE 'Asia/Jakarta') OR o.order_date BETWEEN p_date_from AND p_date_to)
 ), unique_cohort AS MATERIALIZED (
  SELECT DISTINCT ON (upper(trim(tracking_no))) *,
   CASE WHEN nullif(trim(tracking_status),'') IS NOT NULL THEN
     CASE upper(trim(tracking_status)) WHEN 'DELIVERED' THEN 'DELIVERED' WHEN 'DITERIMA' THEN 'DELIVERED' WHEN 'RETURNED' THEN 'RETURNED' WHEN 'RETUR' THEN 'RETURNED' ELSE 'ONGOING' END
    WHEN status='DITERIMA' THEN 'DELIVERED' WHEN status='RETUR' THEN 'RETURNED' ELSE 'ONGOING' END metric_status
  FROM raw WHERE nullif(trim(tracking_no),'') IS NOT NULL
   AND spx_created_at>=p_date_from::timestamp AT TIME ZONE 'Asia/Jakarta' AND spx_created_at<(p_date_to+1)::timestamp AT TIME ZONE 'Asia/Jakarta'
  ORDER BY upper(trim(tracking_no)),source DESC,id
 ), cohort AS MATERIALIZED (
  SELECT * FROM unique_cohort WHERE p_user_id IS NULL OR cs_id=p_user_id
 ), items AS MATERIALIZED (
  SELECT o.source,o.id,o.cs_id,o.metric_status,i.product_id,coalesce(p.name,nullif(i.product_name_raw,''),'Produk belum dipetakan') product_name,
   i.qty,i.price,i.hpp_snapshot,i.packing_fee_snapshot
  FROM cohort o JOIN order_items i ON o.source='orders' AND i.order_id=o.id AND i.organization_id=v_org
  LEFT JOIN products p ON p.id=i.product_id AND p.organization_id=v_org
  UNION ALL
  SELECT o.source,o.id,o.cs_id,o.metric_status,i.product_id,coalesce(p.name,nullif(i.product_name_raw,''),'Produk belum dipetakan'),i.qty,i.price,i.hpp_snapshot,i.packing_fee_snapshot
  FROM cohort o JOIN order_items_draft i ON o.source='draft' AND i.order_id=o.id AND i.organization_id=v_org
  LEFT JOIN products p ON p.id=i.product_id AND p.organization_id=v_org
 ), costs AS (
  SELECT source,id,sum(qty*(coalesce(hpp_snapshot,0)+coalesce(packing_fee_snapshot,0))) hpp,
   bool_or(coalesce(hpp_snapshot,0)<=0) incomplete FROM items GROUP BY source,id
 ), leads AS (
  SELECT cs_id,sum(leads_count) leads,sum(closing_count) closing,sum(rejected_count) rejected FROM cs_daily_leads
  WHERE cs_id IN (SELECT id FROM profiles WHERE organization_id=v_org) AND report_date BETWEEN p_date_from AND p_date_to GROUP BY cs_id
 ), commissions_scoped AS MATERIALIZED (
  SELECT c.*,o.order_number FROM commissions c JOIN cohort o ON o.source='orders' AND c.order_id=o.id
  WHERE c.role::text='cs' AND c.user_id=o.cs_id
 ), comm AS (
  SELECT user_id,sum(amount) FILTER(WHERE status::text IN ('EARNED','PAID')) earned,sum(amount) FILTER(WHERE status::text='EARNED') unpaid FROM commissions_scoped GROUP BY user_id
 ), order_stats AS (
  SELECT o.cs_id,count(*) total_orders,count(*) FILTER(WHERE metric_status='DELIVERED') closing_count,
   count(*) FILTER(WHERE metric_status='RETURNED') retur_count,sum(total) revenue_handled,
   count(*) FILTER(WHERE metric_status='DELIVERED' AND coalesce(c.incomplete,true)) incomplete_hpp_orders,
   coalesce(sum(CASE WHEN payment_method='COD' THEN coalesce(cod_amount,0)-coalesce(estimated_cod_fee,0) ELSE coalesce(total,0) END -coalesce(shipping_cost,0)-coalesce(c.hpp,0)) FILTER(WHERE metric_status='DELIVERED'),0) gross_profit
  FROM cohort o LEFT JOIN costs c USING(source,id) GROUP BY o.cs_id
 ), gb AS (
  SELECT cs_id,count(*) gb_orders,count(*) FILTER(WHERE nullif(trim(tracking_no),'') IS NULL) gb_without_resi,
   count(*) FILTER(WHERE nullif(trim(tracking_no),'') IS NOT NULL) gb_with_resi
  FROM raw WHERE order_date BETWEEN p_date_from AND p_date_to GROUP BY cs_id
 ), summaries AS (
  SELECT p.id user_id,p.full_name,coalesce(a.email,'') email,p.active is_active,
   coalesce(s.total_orders,0) total_orders,coalesce(s.closing_count,0) closing_count,coalesce(s.retur_count,0) retur_count,
   coalesce(s.revenue_handled,0) revenue_handled,coalesce(s.gross_profit,0) gross_profit,coalesce(s.incomplete_hpp_orders,0) incomplete_hpp_orders,
   coalesce(l.leads,0) leads_reported,coalesce(l.closing,0) closing_reported,coalesce(l.rejected,0) rejected_reported,
   coalesce(round(100.0*l.closing/nullif(l.leads,0),1),0) conv_rate,
   coalesce(round(100.0*s.closing_count/nullif(s.total_orders,0),1),0) delivered_rate,
   coalesce(round(100.0*s.retur_count/nullif(s.total_orders,0),1),0) retur_rate,
   coalesce(c.earned,0) commission_earned,coalesce(c.unpaid,0) commission_unpaid,
   coalesce(g.gb_orders,0) gb_orders,coalesce(g.gb_without_resi,0) gb_without_resi,coalesce(g.gb_with_resi,0) gb_with_resi
  FROM profiles p LEFT JOIN auth.users a ON a.id=p.id LEFT JOIN order_stats s ON s.cs_id=p.id LEFT JOIN leads l ON l.cs_id=p.id LEFT JOIN comm c ON c.user_id=p.id LEFT JOIN gb g ON g.cs_id=p.id
  WHERE p.organization_id=v_org AND (p.role::text='cs' OR s.cs_id IS NOT NULL OR g.cs_id IS NOT NULL)
   AND (p_user_id IS NULL OR p.id=p_user_id)
 ), products_report AS (
  SELECT product_id,product_name,count(DISTINCT (source,id)) total_orders,
   count(DISTINCT (source,id)) FILTER(WHERE metric_status='DELIVERED') closing_count,
   count(DISTINCT (source,id)) FILTER(WHERE metric_status='RETURNED') returned_count,
   sum(qty) units,coalesce(sum(qty*price) FILTER(WHERE metric_status='DELIVERED'),0) revenue
  FROM items GROUP BY product_id,product_name
 ), gb_items AS (
  SELECT o.source,o.id,i.product_id,coalesce(p.name,nullif(i.product_name_raw,''),'Produk belum dipetakan') product_name,i.qty,o.tracking_no
  FROM raw o JOIN order_items i ON o.source='orders' AND i.order_id=o.id AND i.organization_id=v_org LEFT JOIN products p ON p.id=i.product_id AND p.organization_id=v_org
  WHERE o.order_date BETWEEN p_date_from AND p_date_to AND (p_user_id IS NULL OR o.cs_id=p_user_id)
  UNION ALL
  SELECT o.source,o.id,i.product_id,coalesce(p.name,nullif(i.product_name_raw,''),'Produk belum dipetakan'),i.qty,o.tracking_no
  FROM raw o JOIN order_items_draft i ON o.source='draft' AND i.order_id=o.id AND i.organization_id=v_org LEFT JOIN products p ON p.id=i.product_id AND p.organization_id=v_org
  WHERE o.order_date BETWEEN p_date_from AND p_date_to AND (p_user_id IS NULL OR o.cs_id=p_user_id)
 ), gb_products AS (
  SELECT product_id,product_name,count(DISTINCT(source,id)) orders,sum(qty) units,
   count(DISTINCT(source,id)) FILTER(WHERE tracking_no IS NOT NULL) with_resi,
   count(DISTINCT(source,id)) FILTER(WHERE tracking_no IS NULL) without_resi
  FROM gb_items GROUP BY product_id,product_name
 ), regions AS (
  SELECT coalesce(nullif(trim(customer_province),''),'Belum diisi') province,coalesce(nullif(trim(customer_city),''),'Belum diisi') city,
   count(*) total_orders,count(*) FILTER(WHERE metric_status='DELIVERED') delivered,count(*) FILTER(WHERE metric_status='RETURNED') returned,
   count(*) FILTER(WHERE metric_status='ONGOING') ongoing,
   round(100.0*count(*) FILTER(WHERE metric_status='DELIVERED')/count(*),1) delivered_rate,
   round(100.0*count(*) FILTER(WHERE metric_status='RETURNED')/count(*),1) returned_rate
  FROM cohort GROUP BY 1,2
 ), daily AS (
  SELECT (spx_created_at AT TIME ZONE 'Asia/Jakarta')::date date,count(*) orders,count(*) FILTER(WHERE metric_status='DELIVERED') closing FROM cohort GROUP BY 1
 ) SELECT jsonb_build_object(
  'summary',coalesce((SELECT jsonb_agg(s ORDER BY s.total_orders DESC,s.full_name) FROM summaries s),'[]'::jsonb),
  'stats',(SELECT to_jsonb(s) FROM summaries s WHERE s.user_id=p_user_id),
  'daily_trend',coalesce((SELECT jsonb_agg(d ORDER BY date) FROM daily d),'[]'::jsonb),
  'product_breakdown',coalesce((SELECT jsonb_agg(p ORDER BY closing_count DESC,total_orders DESC,product_name) FROM products_report p),'[]'::jsonb),
  'gb_products',coalesce((SELECT jsonb_agg(g ORDER BY orders DESC,product_name) FROM gb_products g),'[]'::jsonb),
  'regions',coalesce((SELECT jsonb_agg(r ORDER BY delivered DESC,total_orders DESC,province,city) FROM regions r),'[]'::jsonb),
  'recent_orders',coalesce((SELECT jsonb_agg(r) FROM (SELECT source,id,order_number,customer_name,total,status,created_at,tracking_no,spx_created_at FROM cohort ORDER BY spx_created_at DESC,id DESC LIMIT 50) r),'[]'::jsonb),
  'commission_history',coalesce((SELECT jsonb_agg(c) FROM (SELECT id,amount,status,created_at,paid_at,order_number FROM commissions_scoped WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 100) c),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.operations_cs_report(date,date,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operations_cs_report(date,date,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
