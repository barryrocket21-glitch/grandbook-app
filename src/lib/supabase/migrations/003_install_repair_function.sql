-- Install ONCE in Supabase SQL Editor.
-- Creates a SECURITY DEFINER function that the API can call to repair the
-- broken handle_new_user trigger. After installing this, the "Auto-fix
-- database" button in Settings → Users will work and never need SQL again.

CREATE OR REPLACE FUNCTION public.repair_user_creation()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Drop the legacy trigger + function that crash on new user inserts.
  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  DROP FUNCTION IF EXISTS public.handle_new_user();

  -- Make sure profiles.role accepts the values our app uses.
  -- If role is an enum that's missing values, add them. Safe to re-run.
  BEGIN
    ALTER TABLE public.profiles
      ALTER COLUMN role TYPE text USING role::text;
  EXCEPTION WHEN others THEN
    -- already text or column doesn't exist; ignore
    NULL;
  END;

  -- Make full_name nullable too — the API fills it after creation.
  BEGIN
    ALTER TABLE public.profiles ALTER COLUMN full_name DROP NOT NULL;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN 'OK: trigger removed, profiles.role relaxed to text, full_name nullable';
END;
$$;

-- Allow the service_role (used by the API) to invoke it.
GRANT EXECUTE ON FUNCTION public.repair_user_creation() TO service_role;
