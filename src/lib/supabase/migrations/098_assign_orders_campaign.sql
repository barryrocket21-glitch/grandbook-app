-- 098 — Brief #15 PART 3: assign campaign manual ke order (distribusi).
-- ============================================================================
-- Buat order tanpa-kode (1-2 Juni) / token gak ke-resolve. Barry pilih order →
-- assign ke campaign → set campaign_id + advertiser (dari campaign) + meta
-- atribusi_pending=false. Idempotent. INVOKER org-scoped.

DROP FUNCTION IF EXISTS public.assign_orders_campaign(bigint[], bigint);
CREATE OR REPLACE FUNCTION public.assign_orders_campaign(p_ids BIGINT[], p_campaign_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE v_org BIGINT; v_adv UUID; v_n INTEGER;
BEGIN
  v_org := public.current_org_id();
  SELECT advertiser_id INTO v_adv FROM public.campaigns WHERE id = p_campaign_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign % tidak ada di org', p_campaign_id; END IF;

  UPDATE public.orders_draft SET
    campaign_id = p_campaign_id,
    advertiser_id = COALESCE(advertiser_id, v_adv),
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{atribusi_pending}', 'false'::jsonb),
    updated_at = now()
  WHERE id = ANY(p_ids) AND organization_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_orders_campaign(bigint[], bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_orders_campaign(bigint[], bigint) TO authenticated;
