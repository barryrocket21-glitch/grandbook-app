-- Paired with the application change to verified Supabase user sessions.
-- Retain function definitions for inspection; retire client invocation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
REVOKE EXECUTE ON FUNCTION
  public.verify_owner_password_fallback(text,text),
  public.wa_paste_ref_data_fallback(text),
  public.wa_paste_existing_phones_fallback(text,text[]),
  public.wa_paste_submit_fallback(text,jsonb),
  public.address_review_autocomplete_fallback(text,text,integer),
  public.address_review_suggestions_fallback(text,bigint,integer),
  public.address_review_save_fallback(text,bigint,bigint,text,text,text,text,text),
  public.exec_sql(text)
FROM PUBLIC, anon, authenticated, service_role;
-- Historical environments may also contain temporary smoke-test admin helpers.
-- Revoke each existing overload without calling it or exposing its body.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND proname IN ('_gb_fallback_token_ok', '_tmp_create_fallback_e2e_user', '_tmp_delete_fallback_e2e_user')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f.signature);
  END LOOP;
END $$;
-- The existing owner-only server route uses service_role for this fixed repair.
REVOKE EXECUTE ON FUNCTION public.repair_user_creation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_user_creation() TO service_role;
COMMIT;
