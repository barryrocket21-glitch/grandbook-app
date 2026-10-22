-- Verified against the live 11 September schema; test in restored DB first.
-- An absent/inactive profile must never inherit owner or organization 1.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT p.role::text FROM public.profiles p WHERE p.id = auth.uid() AND p.active IS TRUE),
    'anon'::text
  );
$$;
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.organization_id::bigint FROM public.profiles p
  WHERE p.id = auth.uid() AND p.active IS TRUE;
$$;
COMMIT;
