-- Production created these functions before safe defaults were installed;
-- staging created them afterwards. Make the intended session-only ACL explicit.
-- Requires the operations-hardening package. Does not change business records.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
REVOKE EXECUTE ON FUNCTION
  public.address_search_text(text),
  public.resolve_address_candidates(text,text,text,text,integer),
  public.address_review_queue(text,text,date,date,boolean,bigint),
  public.submit_wa_orders(uuid,jsonb)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.address_search_text(text),
  public.resolve_address_candidates(text,text,text,text,integer),
  public.address_review_queue(text,text,date,date,boolean,bigint),
  public.submit_wa_orders(uuid,jsonb)
TO authenticated;
COMMIT;
