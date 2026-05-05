-- Run this in Supabase SQL Editor if "Database error creating new user" still appears
-- after the API switched to no user_metadata.
--
-- The default Supabase auth template ships with a handle_new_user trigger that
-- inserts into profiles using NEW.raw_user_meta_data->>'role'. If profiles.role
-- is an enum (or has a NOT NULL constraint with no default) the cast fails when
-- metadata is missing, which Postgres returns as "Database error creating new user".
--
-- This drops the legacy trigger so the API route's explicit upsert is the single
-- source of truth.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Optional: if profiles.role is a strict enum and you want a permissive default
-- so existing flows that rely on the trigger don't break, recreate it like this:
--
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
-- BEGIN
--   INSERT INTO public.profiles (id, full_name, role, active)
--   VALUES (
--     NEW.id,
--     COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
--     COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'admin'),
--     true
--   )
--   ON CONFLICT (id) DO NOTHING;
--   RETURN NEW;
-- END;
-- $$;
--
-- CREATE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
