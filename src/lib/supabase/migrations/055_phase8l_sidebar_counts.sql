-- =============================================================
-- PHASE 8L: Sidebar count badges
-- =============================================================
-- Single RPC aggregating realtime counts untuk nav entries yang
-- user-actionable. Dipanggil setiap 60s + saat tab visible.
-- IDEMPOTENT: DROP IF EXISTS + CREATE OR REPLACE.
-- =============================================================

DROP FUNCTION IF EXISTS public.get_sidebar_counts();

CREATE OR REPLACE FUNCTION public.get_sidebar_counts()
RETURNS TABLE(
  drafts_total BIGINT,
  drafts_baru BIGINT,
  drafts_problem BIGINT,
  supplier_payable_pending BIGINT,
  inbox_pending_review BIGINT,
  inbox_unmatched_resi BIGINT,
  inbox_unmapped_statuses BIGINT,
  inbox_address_review BIGINT,
  inbox_phone_review BIGINT,
  commissions_earned BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.orders_draft WHERE organization_id = v_org_id)::BIGINT,
    (SELECT COUNT(*) FROM public.orders_draft WHERE organization_id = v_org_id AND status = 'BARU')::BIGINT,
    (SELECT COUNT(*) FROM public.orders_draft WHERE organization_id = v_org_id AND status = 'PROBLEM')::BIGINT,
    (SELECT COUNT(*) FROM public.supplier_payable WHERE organization_id = v_org_id AND status = 'PENDING')::BIGINT,
    (SELECT COUNT(*) FROM public.orders WHERE organization_id = v_org_id AND status = 'BARU')::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_unmatched_resi WHERE organization_id = v_org_id AND resolved = FALSE)::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_unmapped_statuses WHERE organization_id = v_org_id AND resolved = FALSE)::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_unparsed_address WHERE organization_id = v_org_id AND resolved_at IS NULL)::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_invalid_phone WHERE organization_id = v_org_id AND resolved_at IS NULL)::BIGINT,
    (SELECT COUNT(*) FROM public.commissions c
       JOIN public.orders o ON o.id = c.order_id
       WHERE o.organization_id = v_org_id AND c.status = 'EARNED')::BIGINT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_sidebar_counts() TO authenticated;
