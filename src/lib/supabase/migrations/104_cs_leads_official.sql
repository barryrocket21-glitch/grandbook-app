-- 104 — Brief #18: cs_daily_leads jadi sumber resmi; daily_cs_report diarsipin.
-- ============================================================================
-- Keputusan Barry: PAKAI cs_daily_leads. daily_cs_report (1 baris test Phase 6)
-- → migrasiin dulu, lalu jadiin VIEW facade atas cs_daily_leads (single source —
-- gak ada dual storage). 6 RPC analitik lama (FROM daily_cs_report) tetap jalan
-- via facade tanpa edit. Tulis cuma ke cs_daily_leads. Idempotent.

-- 1) Migrasi 1 baris daily_cs_report → cs_daily_leads (preserve, idempotent)
INSERT INTO public.cs_daily_leads (cs_id, product_id, report_date, leads_count, closing_count, rejected_count, notes, submitted_at)
SELECT cs_id, product_id, report_date, lead_in, closing, 0, notes, COALESCE(created_at, now())
FROM public.daily_cs_report
ON CONFLICT (cs_id, product_id, report_date) DO NOTHING;

-- 2) product_id opsional (CS kadang lapor total harian tanpa pecah produk)
ALTER TABLE public.cs_daily_leads ALTER COLUMN product_id DROP NOT NULL;

-- 3) Arsip daily_cs_report TABLE → VIEW facade atas cs_daily_leads.
--    org_id diturunkan dari profiles (cs_daily_leads gak punya kolom org).
DROP TABLE IF EXISTS public.daily_cs_report CASCADE;
CREATE VIEW public.daily_cs_report WITH (security_invoker = on) AS
SELECT
  l.id, p.organization_id, l.report_date, l.cs_id, l.product_id,
  l.leads_count AS lead_in, l.closing_count AS closing,
  l.notes, l.submitted_at AS created_at, NULL::uuid AS created_by, l.submitted_at AS updated_at
FROM public.cs_daily_leads l
JOIN public.profiles p ON p.id = l.cs_id;
REVOKE ALL ON public.daily_cs_report FROM PUBLIC, anon;
GRANT SELECT ON public.daily_cs_report TO authenticated;

-- 4) Upsert lead harian (INVOKER, RLS-safe, optional product, idempotent).
--    CS cuma diri sendiri; owner/admin boleh target cs lain (p_cs_id).
DROP FUNCTION IF EXISTS public.submit_cs_daily_lead(date, bigint, integer, integer, integer, jsonb, text, uuid);
CREATE OR REPLACE FUNCTION public.submit_cs_daily_lead(
  p_report_date date, p_product_id bigint, p_leads integer, p_closing integer,
  p_rejected integer DEFAULT 0, p_reject_reasons jsonb DEFAULT NULL,
  p_notes text DEFAULT NULL, p_cs_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_role text := public.get_user_role(); v_cs uuid; v_id bigint;
BEGIN
  v_cs := COALESCE(p_cs_id, v_uid);
  IF v_role NOT IN ('owner','admin') AND v_cs <> v_uid THEN
    RAISE EXCEPTION 'CS cuma boleh input laporan sendiri' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cs_daily_leads SET
    leads_count = COALESCE(p_leads, 0), closing_count = COALESCE(p_closing, 0),
    rejected_count = COALESCE(p_rejected, 0), reject_reasons = p_reject_reasons,
    notes = p_notes, submitted_at = now()
  WHERE cs_id = v_cs AND report_date = p_report_date
    AND product_id IS NOT DISTINCT FROM p_product_id
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    INSERT INTO public.cs_daily_leads (cs_id, product_id, report_date, leads_count, closing_count, rejected_count, reject_reasons, notes, submitted_at)
    VALUES (v_cs, p_product_id, p_report_date, COALESCE(p_leads,0), COALESCE(p_closing,0), COALESCE(p_rejected,0), p_reject_reasons, p_notes, now())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_cs_daily_lead(date, bigint, integer, integer, integer, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_cs_daily_lead(date, bigint, integer, integer, integer, jsonb, text, uuid) TO authenticated;

-- 5) team_cs_summary + lapor-vs-real + retur rate (PART 3). Rewrite (signature berubah).
DROP FUNCTION IF EXISTS public.team_cs_summary(date, date);
CREATE OR REPLACE FUNCTION public.team_cs_summary(p_date_from date, p_date_to date)
RETURNS TABLE(
  user_id uuid, full_name text, email text, is_active boolean,
  total_orders bigint, closing_count bigint, conv_rate numeric, revenue_handled numeric,
  commission_earned numeric, commission_unpaid numeric, top_product_name text, top_product_orders bigint,
  leads_reported bigint, closing_reported bigint, rejected_reported bigint,
  retur_count bigint, retur_rate numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_org BIGINT := public.current_org_id();
BEGIN
  RETURN QUERY
  WITH cs_users AS (
    SELECT p.id, p.full_name, p.active FROM public.profiles p
    WHERE p.organization_id = v_org AND p.role = 'cs'
  ),
  cs_emails AS (SELECT u.id, au.email::TEXT AS email FROM cs_users u LEFT JOIN auth.users au ON au.id = u.id),
  order_stats AS (
    SELECT o.cs_id,
      COUNT(*)::BIGINT AS total_orders,
      COUNT(*) FILTER (WHERE o.status='DITERIMA')::BIGINT AS closing_count,
      COUNT(*) FILTER (WHERE o.status='RETUR')::BIGINT AS retur_count,
      COUNT(*) FILTER (WHERE o.status IN ('DITERIMA','RETUR'))::BIGINT AS final_count,
      COALESCE(SUM(o.total) FILTER (WHERE o.status='DITERIMA'),0)::NUMERIC AS revenue
    FROM public.orders o
    WHERE o.organization_id=v_org AND o.cs_id IS NOT NULL AND o.order_date BETWEEN p_date_from AND p_date_to
    GROUP BY o.cs_id
  ),
  comm_stats AS (
    SELECT c.user_id,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status IN ('EARNED','PAID')),0)::NUMERIC AS earned,
      COALESCE(SUM(c.amount) FILTER (WHERE c.status='EARNED'),0)::NUMERIC AS unpaid
    FROM public.commissions c JOIN public.orders o ON o.id=c.order_id
    WHERE o.organization_id=v_org AND c.role='cs' AND o.order_date BETWEEN p_date_from AND p_date_to
    GROUP BY c.user_id
  ),
  lapor AS (
    SELECT l.cs_id,
      COALESCE(SUM(l.leads_count),0)::BIGINT AS leads_rep,
      COALESCE(SUM(l.closing_count),0)::BIGINT AS closing_rep,
      COALESCE(SUM(l.rejected_count),0)::BIGINT AS rejected_rep
    FROM public.cs_daily_leads l
    WHERE l.report_date BETWEEN p_date_from AND p_date_to
    GROUP BY l.cs_id
  ),
  top_per_cs AS (
    SELECT DISTINCT ON (o.cs_id) o.cs_id, p.name AS product_name, c.cnt AS product_orders
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id=o.id
    JOIN public.products p ON p.id=oi.product_id
    JOIN LATERAL (
      SELECT COUNT(DISTINCT o2.id)::BIGINT AS cnt FROM public.orders o2
      JOIN public.order_items oi2 ON oi2.order_id=o2.id
      WHERE o2.cs_id=o.cs_id AND o2.organization_id=v_org AND o2.order_date BETWEEN p_date_from AND p_date_to AND oi2.product_id=oi.product_id
    ) c ON true
    WHERE o.organization_id=v_org AND o.cs_id IS NOT NULL AND o.order_date BETWEEN p_date_from AND p_date_to AND oi.product_id IS NOT NULL
    ORDER BY o.cs_id, c.cnt DESC, p.name ASC
  )
  SELECT
    u.id, u.full_name, e.email, u.active,
    COALESCE(o.total_orders,0), COALESCE(o.closing_count,0),
    CASE WHEN COALESCE(o.total_orders,0)>0 THEN ROUND((o.closing_count::NUMERIC/o.total_orders)*100,1) ELSE 0 END,
    COALESCE(o.revenue,0), COALESCE(m.earned,0), COALESCE(m.unpaid,0),
    tp.product_name, COALESCE(tp.product_orders,0),
    COALESCE(lp.leads_rep,0), COALESCE(lp.closing_rep,0), COALESCE(lp.rejected_rep,0),
    COALESCE(o.retur_count,0),
    CASE WHEN COALESCE(o.final_count,0)>0 THEN ROUND((o.retur_count::NUMERIC/o.final_count)*100,1) ELSE 0 END
  FROM cs_users u
  LEFT JOIN cs_emails e ON e.id=u.id
  LEFT JOIN order_stats o ON o.cs_id=u.id
  LEFT JOIN comm_stats m ON m.user_id=u.id
  LEFT JOIN lapor lp ON lp.cs_id=u.id
  LEFT JOIN top_per_cs tp ON tp.cs_id=u.id
  ORDER BY COALESCE(o.total_orders,0) DESC, u.full_name ASC;
END $$;
REVOKE EXECUTE ON FUNCTION public.team_cs_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_cs_summary(date, date) TO authenticated;
