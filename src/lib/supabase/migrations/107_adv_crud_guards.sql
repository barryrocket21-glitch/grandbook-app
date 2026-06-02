-- 107 — Brief #21: CRUD lengkap ADV (update/delete/toggle) + guard dependent server-side.
-- ============================================================================
-- Pola pintu masuk org-scoped (lanjutan create_ad_account #20). Guard dependent
-- di SERVER (gak bisa di-bypass dari UI). INVOKER + REVOKE anon → advisor 0 baru.
-- Idempotent.

-- ── update_ad_account (org-scoped, dup ramah) ───────────────────────────────
DROP FUNCTION IF EXISTS public.update_ad_account(bigint, text, text, text, uuid);
CREATE OR REPLACE FUNCTION public.update_ad_account(
  p_id bigint, p_platform text, p_account_code text, p_name text DEFAULT NULL, p_advertiser_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE v_org bigint := public.current_org_id(); v_n int;
BEGIN
  IF COALESCE(btrim(p_account_code),'') = '' THEN RAISE EXCEPTION 'Kode akun wajib diisi'; END IF;
  BEGIN
    UPDATE public.ad_accounts SET
      platform = p_platform, account_code = btrim(p_account_code),
      name = NULLIF(btrim(COALESCE(p_name,'')),''), advertiser_id = p_advertiser_id, updated_at = now()
    WHERE id = p_id AND organization_id = v_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Kode akun "%" udah ada di platform %', btrim(p_account_code), p_platform USING ERRCODE = '23505';
  END;
  IF v_n = 0 THEN RAISE EXCEPTION 'Akun gak ketemu di org ini' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_ad_account(bigint, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_ad_account(bigint, text, text, text, uuid) TO authenticated;

-- ── set_ad_account_active (toggle) ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.set_ad_account_active(bigint, boolean);
CREATE OR REPLACE FUNCTION public.set_ad_account_active(p_id bigint, p_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE v_org bigint := public.current_org_id(); v_n int;
BEGIN
  UPDATE public.ad_accounts SET active = p_active, updated_at = now()
  WHERE id = p_id AND organization_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'Akun gak ketemu di org ini' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_ad_account_active(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ad_account_active(bigint, boolean) TO authenticated;

-- ── delete_ad_account (guard: campaign pakai akun → blok, suruh nonaktif) ────
DROP FUNCTION IF EXISTS public.delete_ad_account(bigint);
CREATE OR REPLACE FUNCTION public.delete_ad_account(p_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE v_org bigint := public.current_org_id(); v_camp int; v_n int;
BEGIN
  SELECT count(*) INTO v_camp FROM public.campaigns WHERE account_id = p_id AND organization_id = v_org;
  IF v_camp > 0 THEN
    RAISE EXCEPTION '% campaign masih pakai akun ini — nonaktifin aja (jangan hapus) biar atribusi lama aman', v_camp USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.ad_accounts WHERE id = p_id AND organization_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'Akun gak ketemu di org ini' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_ad_account(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_ad_account(bigint) TO authenticated;

-- ── delete_campaign (guard: order ter-atribusi / ad_spend → blok) ───────────
DROP FUNCTION IF EXISTS public.delete_campaign(bigint);
CREATE OR REPLACE FUNCTION public.delete_campaign(p_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE v_org bigint := public.current_org_id(); v_ord int; v_spend int; v_n int;
BEGIN
  SELECT (SELECT count(*) FROM public.orders_draft WHERE campaign_id = p_id AND organization_id = v_org)
       + (SELECT count(*) FROM public.orders WHERE campaign_id = p_id AND organization_id = v_org)
    INTO v_ord;
  SELECT count(*) INTO v_spend FROM public.ad_spend WHERE campaign_id = p_id AND organization_id = v_org;
  IF v_ord > 0 OR v_spend > 0 THEN
    RAISE EXCEPTION '% order + % spend ke-link campaign ini — nonaktifin aja (jangan hapus)', v_ord, v_spend USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.campaign_products WHERE campaign_id = p_id;
  DELETE FROM public.campaigns WHERE id = p_id AND organization_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'Campaign gak ketemu di org ini' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_campaign(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_campaign(bigint) TO authenticated;
