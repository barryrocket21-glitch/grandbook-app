-- 114 — estimate_commission_amount: SECURITY DEFINER → INVOKER (fix advisor warning).
-- ============================================================================
-- Advisor flag `security_definer_function_executable`: fungsi DEFINER yg bisa
-- dieksekusi anon/authenticated = risiko privilege escalation. estimate_commission_amount
-- cuma baca commission_rules (udah RLS org-scoped, authenticated boleh SELECT), jadi
-- gak butuh DEFINER. Ganti INVOKER → jalan sebagai caller, no escalation. Idempotent.

CREATE OR REPLACE FUNCTION public.estimate_commission_amount(
  p_org BIGINT, p_role TEXT, p_user_id UUID, p_product_ids BIGINT[],
  p_total NUMERIC, p_dt DATE
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.commission_rules cr
  WHERE cr.organization_id = p_org AND cr.role = p_role AND cr.active
    AND (cr.user_id IS NULL OR cr.user_id = p_user_id)
    AND (cr.product_id IS NULL OR cr.product_id = ANY(COALESCE(p_product_ids, ARRAY[]::BIGINT[])))
    AND (cr.effective_from IS NULL OR cr.effective_from <= p_dt)
    AND (cr.effective_to IS NULL OR cr.effective_to >= p_dt)
  ORDER BY (cr.user_id IS NOT NULL) DESC, (cr.product_id IS NOT NULL) DESC, cr.id DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;
  RETURN CASE r.rate_type
    WHEN 'FLAT_PER_ORDER' THEN COALESCE(r.rate_value, 0)
    WHEN 'PERCENT_REVENUE' THEN ROUND(COALESCE(p_total,0) * COALESCE(r.rate_value,0) / 100.0, 2)
    ELSE 0 END;
END $$;
REVOKE EXECUTE ON FUNCTION public.estimate_commission_amount(BIGINT,TEXT,UUID,BIGINT[],NUMERIC,DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.estimate_commission_amount(BIGINT,TEXT,UUID,BIGINT[],NUMERIC,DATE) TO authenticated;
