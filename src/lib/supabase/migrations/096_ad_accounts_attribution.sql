-- 096 — Brief #15 backbone: master Akun (ad_accounts) + resolusi token → campaign.
-- ============================================================================
-- #14 parkir token di orders_draft.meta (platform/atribusi_account/atribusi_campaign).
-- #15 ngubah jadi entity: ad_accounts (rumah segmen "A") + campaigns.account_id +
-- campaign_marker (segmen "1"). Kunci resolusi = (platform, account_code, marker)
-- → 1 campaign. resolve_order_attribution baca meta → set campaign_id/advertiser_id
-- + pending=false. NEVER bikin akun/campaign dari token. Idempotent.
-- orders_draft.campaign_id/advertiser_id udah ADA (gak nambah).

-- ---- 1. ad_accounts (master Akun) ----
CREATE TABLE IF NOT EXISTS public.ad_accounts (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  platform TEXT NOT NULL,                 -- Facebook / Google / Snack / Tiktok
  account_code TEXT NOT NULL,             -- segmen "A" (pendek/unik per platform)
  name TEXT,
  advertiser_id UUID REFERENCES public.profiles(id),  -- nullable (advertiser nanti)
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, platform, account_code)
);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_org ON public.ad_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_advertiser ON public.ad_accounts(advertiser_id);

ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_accounts_select ON public.ad_accounts;
CREATE POLICY ad_accounts_select ON public.ad_accounts FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));
DROP POLICY IF EXISTS ad_accounts_write ON public.ad_accounts;
CREATE POLICY ad_accounts_write ON public.ad_accounts FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()) AND public.get_user_role() IN ('owner','admin','advertiser'))
  WITH CHECK (organization_id = (SELECT public.current_org_id()) AND public.get_user_role() IN ('owner','admin','advertiser'));
REVOKE ALL ON public.ad_accounts FROM anon;

DROP TRIGGER IF EXISTS trg_ad_accounts_updated_at ON public.ad_accounts;
CREATE TRIGGER trg_ad_accounts_updated_at BEFORE UPDATE ON public.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 2. campaigns: link ke akun + marker (kunci resolusi) ----
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES public.ad_accounts(id);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS campaign_marker TEXT;  -- segmen "1"
CREATE INDEX IF NOT EXISTS idx_campaigns_account ON public.campaigns(account_id);
-- Kunci resolusi unik: 1 (account, marker) → 1 campaign
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_account_marker
  ON public.campaigns(account_id, campaign_marker) WHERE account_id IS NOT NULL AND campaign_marker IS NOT NULL;

-- ---- 3. resolve_order_attribution(ids) — token meta → campaign_id ----
-- Cari campaign via (platform, account_code, marker). Ketemu → set campaign_id +
-- advertiser_id (dari campaign) + meta.atribusi_pending=false. Gak ketemu → biarin
-- pending (masuk distribusi manual). NEVER bikin entity. Idempotent.
DROP FUNCTION IF EXISTS public.resolve_order_attribution(bigint[]);
CREATE OR REPLACE FUNCTION public.resolve_order_attribution(p_ids BIGINT[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
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
    SELECT c.id AS campaign_id, c.advertiser_id
    INTO v_camp
    FROM public.campaigns c
    JOIN public.ad_accounts a ON a.id = c.account_id
    WHERE a.organization_id = v_org
      AND lower(a.platform) = lower(COALESCE(r.meta->>'platform',''))
      AND lower(a.account_code) = lower(r.meta->>'atribusi_account')
      AND lower(c.campaign_marker) = lower(r.meta->>'atribusi_campaign')
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
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_order_attribution(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_order_attribution(bigint[]) TO authenticated;
