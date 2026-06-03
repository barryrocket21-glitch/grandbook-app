-- 109 — Brief #29: marker campaign per-PRODUK (bukan per-akun) + resolver cocokin produk.
-- ============================================================================
-- Model Barry: kode = Produk.Platform.Akun.Marker (Luna F.A.1). Marker reset per
-- produk dalam 1 akun → "Luna F.A.1" & "Pavio F.A.1" dua-duanya marker 1, produk
-- beda, HARUS boleh. Identitas penuh = (produk, platform, akun, marker).
--   1) Lepas unique (account_id, campaign_marker) — itu yg ngeblok.
--   2) resolve_order_attribution: cocokin PRODUK order juga (order_items_draft vs
--      campaign_products), biar "Luna F.A.1" gak ketuker sama "Pavio F.A.1".
-- Idempotent.

DROP INDEX IF EXISTS public.uq_campaigns_account_marker;

CREATE OR REPLACE FUNCTION public.resolve_order_attribution(p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
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
    -- Cocokin platform+akun+marker; PRIORITASKAN campaign yg produk-nya ada di
    -- order ini (biar Luna F.A.1 ke campaign Luna, bukan Pavio F.A.1).
    SELECT c.id AS campaign_id, c.advertiser_id
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
