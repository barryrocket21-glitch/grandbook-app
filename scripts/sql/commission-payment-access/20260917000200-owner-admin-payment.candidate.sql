-- Candidate: normal active owner/admin only; no historical/payment backfill.
CREATE OR REPLACE FUNCTION public.mark_commission_paid(p_commission_id bigint, p_payment_method text, p_payment_reference text DEFAULT NULL::text, p_payment_note text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org bigint; v_count integer;
BEGIN
  SELECT organization_id INTO v_org FROM public.profiles
  WHERE id=auth.uid() AND active AND role IN ('owner','admin');
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Active owner/admin required' USING ERRCODE='42501';
  END IF;
  UPDATE public.commissions c
  SET status='PAID',paid_at=NOW(),paid_by=auth.uid(),payment_method=p_payment_method,
      payment_reference=p_payment_reference,payment_note=p_payment_note
  FROM public.orders o
  WHERE c.id=p_commission_id AND c.order_id=o.id AND o.organization_id=v_org
    AND c.status='EARNED';
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN
    RAISE EXCEPTION 'Commission unavailable or no longer EARNED' USING ERRCODE='22023';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.bulk_mark_commission_paid(p_commission_ids bigint[], p_payment_method text, p_payment_reference text DEFAULT NULL::text, p_payment_note text DEFAULT NULL::text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org bigint; v_count integer;
BEGIN
  SELECT organization_id INTO v_org FROM public.profiles
  WHERE id=auth.uid() AND active AND role IN ('owner','admin');
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Active owner/admin required' USING ERRCODE='42501';
  END IF;
  IF p_commission_ids IS NULL OR array_length(p_commission_ids,1) IS NULL THEN RETURN 0; END IF;
  UPDATE public.commissions c
  SET status='PAID',paid_at=NOW(),paid_by=auth.uid(),payment_method=p_payment_method,
      payment_reference=p_payment_reference,payment_note=p_payment_note
  FROM public.orders o
  WHERE c.id=ANY(p_commission_ids) AND c.order_id=o.id AND o.organization_id=v_org
    AND c.status='EARNED';
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $function$;

REVOKE ALL ON FUNCTION public.mark_commission_paid(bigint,text,text,text) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.bulk_mark_commission_paid(bigint[],text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.mark_commission_paid(bigint,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_mark_commission_paid(bigint[],text,text,text) TO authenticated;
