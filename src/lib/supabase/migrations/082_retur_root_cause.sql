-- 082 — Brief #4: Retur Root-Cause Analytics (RPC-only, read-only)
-- ============================================================================
-- Jawab pertanyaan owner: kenapa barang retur + siapa/apa penyebabnya.
-- 5 dimensi (CS / Produk / Campaign / Wilayah / Kurir) + drill reject_reason.
--
-- Keputusan Barry:
--   - return_rate = RETUR / (DITERIMA+RETUR)  [basis outcome-final, samain
--     analytics_per_cs + customer reputation]. FAKE dipisah (kolom sendiri).
--   - small_sample = total_final < 5 (jangan di-ranking di puncak).
--   - Akses owner/admin (semua) + cs (auto-filter cs_id = dia).
--
-- Semua RPC SECURITY INVOKER (read-only, RLS orders sudah scope org).
-- org_id = bigint. Slot 082. Idempotent. Tidak ada tabel/field baru.

-- Threshold sampel kecil (hard-coded sesuai keputusan; bisa di-tune nanti).
-- 5 → dimensi dengan <5 order final ditandai small_sample.

-- ----------------------------------------------------------------------------
-- 1. analytics_retur_per_cs
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_retur_per_cs(date, date);
CREATE OR REPLACE FUNCTION public.analytics_retur_per_cs(p_start date DEFAULT NULL, p_end date DEFAULT NULL)
RETURNS TABLE (
  cs_id uuid, cs_name text,
  total_final bigint, diterima bigint, retur bigint, fake bigint,
  return_rate numeric, lead_in bigint, closing bigint, closing_rate numeric,
  small_sample boolean
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_role text := public.get_user_role(); v_uid uuid := (SELECT auth.uid()); v_org bigint := public.current_org_id();
BEGIN
  IF v_role NOT IN ('owner','admin','cs') THEN RETURN; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT o.cs_id, o.cs_name, o.status
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND o.status IN ('DITERIMA','RETUR','FAKE')
      AND (p_start IS NULL OR o.order_date >= p_start)
      AND (p_end IS NULL OR o.order_date <= p_end)
      AND (v_role IN ('owner','admin') OR o.cs_id = v_uid)
      AND o.cs_id IS NOT NULL
  ), agg AS (
    SELECT b.cs_id,
      max(b.cs_name) AS cs_name,
      count(*) FILTER (WHERE b.status IN ('DITERIMA','RETUR')) AS total_final,
      count(*) FILTER (WHERE b.status = 'DITERIMA') AS diterima,
      count(*) FILTER (WHERE b.status = 'RETUR') AS retur,
      count(*) FILTER (WHERE b.status = 'FAKE') AS fake
    FROM base b GROUP BY b.cs_id
  ), cs AS (
    SELECT d.cs_id, SUM(d.lead_in) AS lead_in, SUM(d.closing) AS closing
    FROM public.daily_cs_report d
    WHERE d.organization_id = v_org
      AND (p_start IS NULL OR d.report_date >= p_start)
      AND (p_end IS NULL OR d.report_date <= p_end)
    GROUP BY d.cs_id
  )
  SELECT a.cs_id, a.cs_name, a.total_final, a.diterima, a.retur, a.fake,
    ROUND(a.retur::numeric / NULLIF(a.diterima + a.retur, 0), 4) AS return_rate,
    COALESCE(cs.lead_in, 0)::bigint, COALESCE(cs.closing, 0)::bigint,
    ROUND(cs.closing::numeric / NULLIF(cs.lead_in, 0), 4) AS closing_rate,
    (a.total_final < 5) AS small_sample
  FROM agg a LEFT JOIN cs ON cs.cs_id = a.cs_id
  ORDER BY (a.total_final < 5), return_rate DESC NULLS LAST;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. analytics_retur_per_produk
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_retur_per_produk(date, date);
CREATE OR REPLACE FUNCTION public.analytics_retur_per_produk(p_start date DEFAULT NULL, p_end date DEFAULT NULL)
RETURNS TABLE (
  product_id bigint, product_name text,
  total_final bigint, diterima bigint, retur bigint, fake bigint,
  return_rate numeric, small_sample boolean
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_role text := public.get_user_role(); v_uid uuid := (SELECT auth.uid()); v_org bigint := public.current_org_id();
BEGIN
  IF v_role NOT IN ('owner','admin','cs') THEN RETURN; END IF;
  RETURN QUERY
  WITH oi AS (
    SELECT DISTINCT it.product_id, o.id AS order_id, o.status
    FROM public.order_items it JOIN public.orders o ON o.id = it.order_id
    WHERE o.organization_id = v_org
      AND o.status IN ('DITERIMA','RETUR','FAKE')
      AND it.product_id IS NOT NULL
      AND (p_start IS NULL OR o.order_date >= p_start)
      AND (p_end IS NULL OR o.order_date <= p_end)
      AND (v_role IN ('owner','admin') OR o.cs_id = v_uid)
  ), agg AS (
    SELECT oi.product_id,
      count(*) FILTER (WHERE oi.status IN ('DITERIMA','RETUR')) AS total_final,
      count(*) FILTER (WHERE oi.status = 'DITERIMA') AS diterima,
      count(*) FILTER (WHERE oi.status = 'RETUR') AS retur,
      count(*) FILTER (WHERE oi.status = 'FAKE') AS fake
    FROM oi GROUP BY oi.product_id
  )
  SELECT a.product_id, COALESCE(p.name, 'Produk #' || a.product_id),
    a.total_final, a.diterima, a.retur, a.fake,
    ROUND(a.retur::numeric / NULLIF(a.diterima + a.retur, 0), 4),
    (a.total_final < 5)
  FROM agg a LEFT JOIN public.products p ON p.id = a.product_id
  ORDER BY (a.total_final < 5), 7 DESC NULLS LAST;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. analytics_retur_per_campaign — sanding CPR / CPA / net_profit_after_ads
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_retur_per_campaign(date, date);
CREATE OR REPLACE FUNCTION public.analytics_retur_per_campaign(p_start date DEFAULT NULL, p_end date DEFAULT NULL)
RETURNS TABLE (
  campaign_id bigint, campaign_name text, platform text,
  total_final bigint, diterima bigint, retur bigint, fake bigint,
  return_rate numeric, spend numeric, meta_leads bigint,
  cpr numeric, cpa numeric, net_profit_after_ads numeric, small_sample boolean
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_role text := public.get_user_role(); v_uid uuid := (SELECT auth.uid()); v_org bigint := public.current_org_id();
BEGIN
  IF v_role NOT IN ('owner','admin','cs') THEN RETURN; END IF;
  RETURN QUERY
  WITH ord AS (
    SELECT o.campaign_id,
      count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR')) AS total_final,
      count(*) FILTER (WHERE o.status = 'DITERIMA') AS diterima,
      count(*) FILTER (WHERE o.status = 'RETUR') AS retur,
      count(*) FILTER (WHERE o.status = 'FAKE') AS fake,
      count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR','DIKIRIM','SIAP_KIRIM','BARU')) AS akuisisi,
      COALESCE(SUM(o.estimated_profit) FILTER (WHERE o.status = 'DITERIMA'), 0) AS profit_diterima
    FROM public.orders o
    WHERE o.organization_id = v_org AND o.campaign_id IS NOT NULL
      AND (p_start IS NULL OR o.order_date >= p_start)
      AND (p_end IS NULL OR o.order_date <= p_end)
      AND (v_role IN ('owner','admin') OR o.cs_id = v_uid)
    GROUP BY o.campaign_id
  ), spend AS (
    SELECT a.campaign_id, COALESCE(SUM(a.spend), 0) AS spend, COALESCE(SUM(a.meta_lead_count), 0) AS leads
    FROM public.ad_spend a
    WHERE a.organization_id = v_org
      AND (p_start IS NULL OR a.spend_date >= p_start)
      AND (p_end IS NULL OR a.spend_date <= p_end)
    GROUP BY a.campaign_id
  )
  SELECT o.campaign_id, COALESCE(c.campaign_name, 'Campaign #' || o.campaign_id), c.platform,
    o.total_final, o.diterima, o.retur, o.fake,
    ROUND(o.retur::numeric / NULLIF(o.diterima + o.retur, 0), 4),
    COALESCE(s.spend, 0), COALESCE(s.leads, 0)::bigint,
    ROUND(s.spend / NULLIF(s.leads, 0), 0) AS cpr,
    ROUND(s.spend / NULLIF(o.akuisisi, 0), 0) AS cpa,
    (o.profit_diterima - COALESCE(s.spend, 0)) AS net_profit_after_ads,
    (o.total_final < 5)
  FROM ord o
  LEFT JOIN spend s ON s.campaign_id = o.campaign_id
  LEFT JOIN public.campaigns c ON c.id = o.campaign_id
  ORDER BY (o.total_final < 5), 8 DESC NULLS LAST;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. analytics_retur_per_wilayah (per kota)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_retur_per_wilayah(date, date);
CREATE OR REPLACE FUNCTION public.analytics_retur_per_wilayah(p_start date DEFAULT NULL, p_end date DEFAULT NULL)
RETURNS TABLE (
  city text, province text,
  total_final bigint, diterima bigint, retur bigint, fake bigint,
  return_rate numeric, small_sample boolean
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_role text := public.get_user_role(); v_uid uuid := (SELECT auth.uid()); v_org bigint := public.current_org_id();
BEGIN
  IF v_role NOT IN ('owner','admin','cs') THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    COALESCE(NULLIF(TRIM(o.customer_city), ''), '(kota kosong)') AS city,
    max(o.customer_province) AS province,
    count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR')) AS total_final,
    count(*) FILTER (WHERE o.status = 'DITERIMA') AS diterima,
    count(*) FILTER (WHERE o.status = 'RETUR') AS retur,
    count(*) FILTER (WHERE o.status = 'FAKE') AS fake,
    ROUND(count(*) FILTER (WHERE o.status = 'RETUR')::numeric
      / NULLIF(count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR')), 0), 4) AS return_rate,
    (count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR')) < 5) AS small_sample
  FROM public.orders o
  WHERE o.organization_id = v_org
    AND o.status IN ('DITERIMA','RETUR','FAKE')
    AND (p_start IS NULL OR o.order_date >= p_start)
    AND (p_end IS NULL OR o.order_date <= p_end)
    AND (v_role IN ('owner','admin') OR o.cs_id = v_uid)
  GROUP BY COALESCE(NULLIF(TRIM(o.customer_city), ''), '(kota kosong)')
  ORDER BY (count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR')) < 5), 7 DESC NULLS LAST;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. analytics_retur_per_kurir (per courier_channel)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_retur_per_kurir(date, date);
CREATE OR REPLACE FUNCTION public.analytics_retur_per_kurir(p_start date DEFAULT NULL, p_end date DEFAULT NULL)
RETURNS TABLE (
  channel_id bigint, channel_code text, channel_name text,
  total_final bigint, diterima bigint, retur bigint, fake bigint,
  return_rate numeric, small_sample boolean
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_role text := public.get_user_role(); v_uid uuid := (SELECT auth.uid()); v_org bigint := public.current_org_id();
BEGIN
  IF v_role NOT IN ('owner','admin','cs') THEN RETURN; END IF;
  RETURN QUERY
  SELECT o.channel_id,
    max(ch.code), max(ch.name),
    count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR')) AS total_final,
    count(*) FILTER (WHERE o.status = 'DITERIMA') AS diterima,
    count(*) FILTER (WHERE o.status = 'RETUR') AS retur,
    count(*) FILTER (WHERE o.status = 'FAKE') AS fake,
    ROUND(count(*) FILTER (WHERE o.status = 'RETUR')::numeric
      / NULLIF(count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR')), 0), 4) AS return_rate,
    (count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR')) < 5) AS small_sample
  FROM public.orders o
  LEFT JOIN public.courier_channels ch ON ch.id = o.channel_id
  WHERE o.organization_id = v_org
    AND o.status IN ('DITERIMA','RETUR','FAKE')
    AND o.channel_id IS NOT NULL
    AND (p_start IS NULL OR o.order_date >= p_start)
    AND (p_end IS NULL OR o.order_date <= p_end)
    AND (v_role IN ('owner','admin') OR o.cs_id = v_uid)
  GROUP BY o.channel_id
  ORDER BY (count(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR')) < 5), 8 DESC NULLS LAST;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. analytics_retur_reasons — drill reject_reason per dimensi value
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_retur_reasons(text, text, date, date);
CREATE OR REPLACE FUNCTION public.analytics_retur_reasons(
  p_dimension text, p_value text, p_start date DEFAULT NULL, p_end date DEFAULT NULL
)
RETURNS TABLE (reject_reason text, n bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_role text := public.get_user_role(); v_uid uuid := (SELECT auth.uid()); v_org bigint := public.current_org_id();
BEGIN
  IF v_role NOT IN ('owner','admin','cs') THEN RETURN; END IF;
  RETURN QUERY
  SELECT COALESCE(NULLIF(TRIM(o.reject_reason), ''), '(tanpa alasan)') AS reject_reason, count(*) AS n
  FROM public.orders o
  WHERE o.organization_id = v_org
    AND o.status = 'RETUR'
    AND (p_start IS NULL OR o.order_date >= p_start)
    AND (p_end IS NULL OR o.order_date <= p_end)
    AND (v_role IN ('owner','admin') OR o.cs_id = v_uid)
    AND (
      CASE p_dimension
        WHEN 'cs'       THEN o.cs_id = p_value::uuid
        WHEN 'campaign' THEN o.campaign_id = p_value::bigint
        WHEN 'wilayah'  THEN COALESCE(NULLIF(TRIM(o.customer_city), ''), '(kota kosong)') = p_value
        WHEN 'kurir'    THEN o.channel_id = p_value::bigint
        WHEN 'produk'   THEN EXISTS (SELECT 1 FROM public.order_items it WHERE it.order_id = o.id AND it.product_id = p_value::bigint)
        ELSE true
      END
    )
  GROUP BY COALESCE(NULLIF(TRIM(o.reject_reason), ''), '(tanpa alasan)')
  ORDER BY n DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.analytics_retur_per_cs(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_retur_per_produk(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_retur_per_campaign(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_retur_per_wilayah(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_retur_per_kurir(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_retur_reasons(text, text, date, date) TO authenticated;
