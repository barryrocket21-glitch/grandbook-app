-- 106 — Brief #20 PART 1: insert ad_accounts via RPC (set org_id server-side).
-- ============================================================================
-- BUG: form "Tambah Akun" insert tanpa organization_id → langgar RLS with_check
-- (organization_id = current_org_id()) → gagal + toast [object Object].
-- Fix robust: RPC INVOKER set organization_id := current_org_id() di server,
-- client gak usah ngirim org_id. Dup (org,platform,account_code) → pesan jelas.
-- Idempotent. INVOKER + REVOKE anon → advisor 0 baru.

DROP FUNCTION IF EXISTS public.create_ad_account(text, text, text, uuid);
CREATE OR REPLACE FUNCTION public.create_ad_account(
  p_platform text, p_account_code text, p_name text DEFAULT NULL, p_advertiser_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE v_org bigint; v_id bigint;
BEGIN
  v_org := public.current_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Sesi gak punya organization — coba login ulang' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_account_code),'') = '' THEN
    RAISE EXCEPTION 'Kode akun wajib diisi';
  END IF;
  BEGIN
    INSERT INTO public.ad_accounts (organization_id, platform, account_code, name, advertiser_id, active)
    VALUES (v_org, p_platform, btrim(p_account_code), NULLIF(btrim(COALESCE(p_name,'')),''), p_advertiser_id, true)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Kode akun "%" udah ada di platform %', btrim(p_account_code), p_platform USING ERRCODE = '23505';
  END;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_ad_account(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ad_account(text, text, text, uuid) TO authenticated;
