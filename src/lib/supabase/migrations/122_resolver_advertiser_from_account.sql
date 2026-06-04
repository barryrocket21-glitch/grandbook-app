-- 122 — Fix resolver: advertiser_id dari AKUN IKLAN (bukan campaign).
-- ============================================================================
-- Hierarki: Advertiser → Akun iklan → Campaign. ADV nempel di ad_accounts
-- (9/9 keisi), campaigns.advertiser_id kosong. resolve_order_attribution salah
-- ambil c.advertiser_id (selalu null) → advertiser_id order gak keisi. Fix:
-- ambil a.advertiser_id (dari akun). + backfill order yg udah resolved. Idempotent.

CREATE OR REPLACE FUNCTION public.resolve_order_attribution(p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_org BIGINT; r RECORD; v_camp RECORD; c_resolved INT := 0; c_pending INT := 0;
BEGIN
  v_org := public.current_org_id();
  FOR r IN
    SELECT id, meta FROM public.orders_draft
    WHERE organization_id = v_org
      AND (p_ids IS NULL OR id = ANY(p_ids))
      AND COALESCE(meta->>'atribusi_account','') <> ''
      AND COALESCE(meta->>'atribusi_campaign','') <> ''
      AND campaign_id IS NULL
  LOOP
    -- ADV dari AKUN (a.advertiser_id), produk-aware order by
    SELECT c.id AS campaign_id, a.advertiser_id
    INTO v_camp
    FROM public.campaigns c
    JOIN public.ad_accounts a ON a.id = c.account_id
    WHERE a.organization_id = v_org
      AND lower(a.platform) = lower(COALESCE(r.meta->>'platform',''))
      AND lower(a.account_code) = lower(r.meta->>'atribusi_account')
      AND lower(c.campaign_marker) = lower(r.meta->>'atribusi_campaign')
    ORDER BY
      (EXISTS (
        SELECT 1 FROM public.campaign_products cp
        JOIN public.order_items_draft oi ON oi.product_id = cp.product_id
        WHERE cp.campaign_id = c.id AND oi.order_id = r.id
      )) DESC,
      c.id ASC
    LIMIT 1;

    IF v_camp.campaign_id IS NOT NULL THEN
      UPDATE public.orders_draft SET
        campaign_id = v_camp.campaign_id,
        advertiser_id = COALESCE(advertiser_id, v_camp.advertiser_id),
        meta = jsonb_set(COALESCE(meta,'{}'::jsonb), '{atribusi_pending}', 'false'::jsonb),
        updated_at = now()
      WHERE id = r.id;
      c_resolved := c_resolved + 1;
    ELSE
      c_pending := c_pending + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('resolved', c_resolved, 'still_pending', c_pending);
END;
$function$;

-- Backfill: order yg campaign_id udah keisi tapi advertiser_id kosong
UPDATE public.orders_draft d
SET advertiser_id = a.advertiser_id, updated_at = now()
FROM public.campaigns c
JOIN public.ad_accounts a ON a.id = c.account_id
WHERE d.campaign_id = c.id
  AND d.advertiser_id IS NULL
  AND a.advertiser_id IS NOT NULL;
