-- Active organization access; browser profile writes are preferences-only.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profiles" ON public.profiles;
DROP POLICY IF EXISTS profiles_org_read ON public.profiles;
DROP POLICY IF EXISTS profiles_own_preferences ON public.profiles;
CREATE POLICY profiles_org_read ON public.profiles FOR SELECT TO authenticated
 USING (id=(SELECT auth.uid()) OR organization_id=(SELECT public.current_org_id()));
CREATE POLICY profiles_own_preferences ON public.profiles FOR UPDATE TO authenticated
 USING (id=(SELECT auth.uid()) AND active IS TRUE)
 WITH CHECK (id=(SELECT auth.uid()) AND active IS TRUE);
REVOKE ALL ON public.profiles FROM PUBLIC,anon,authenticated;
-- Also remove any column-level write grants, which survive a table-level revoke.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='public.profiles'::regclass AND attnum>0 AND NOT attisdropped LOOP
  EXECUTE format('REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.profiles FROM PUBLIC, anon, authenticated',c.attname,c.attname,c.attname);
 END LOOP;
END $$;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (preferences) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_org_profile(p_target uuid,p_patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_catalog AS $$
DECLARE actor public.profiles%ROWTYPE; target public.profiles%ROWTYPE; requested_role text;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid();
 IF NOT FOUND OR actor.active IS NOT TRUE OR actor.organization_id IS NULL OR actor.role::text NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Akses pengelolaan user ditolak' USING ERRCODE='42501';
 END IF;
 -- Serialize user-management changes within this organization, including the actor.
 PERFORM pg_advisory_xact_lock(hashtextextended('manage_profiles:'||actor.organization_id::text,0));
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF actor.active IS NOT TRUE OR actor.role::text NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Akses berubah, muat ulang' USING ERRCODE='42501'; END IF;
 SELECT * INTO target FROM public.profiles WHERE id=p_target AND organization_id=actor.organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'User tidak ditemukan' USING ERRCODE='P0002'; END IF;
 IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('full_name','role','active')) THEN
  RAISE EXCEPTION 'Field perubahan tidak valid' USING ERRCODE='22023';
 END IF;
 IF p_patch ? 'full_name' AND (jsonb_typeof(p_patch->'full_name')<>'string' OR length(trim(p_patch->>'full_name')) NOT BETWEEN 1 AND 200) THEN RAISE EXCEPTION 'Nama tidak valid' USING ERRCODE='22023'; END IF;
 IF p_patch ? 'active' AND jsonb_typeof(p_patch->'active')<>'boolean' THEN RAISE EXCEPTION 'Status tidak valid' USING ERRCODE='22023'; END IF;
 requested_role:=coalesce(p_patch->>'role',target.role::text);
 IF requested_role NOT IN ('owner','admin','cs','advertiser','akunting') OR (p_patch ? 'role' AND jsonb_typeof(p_patch->'role')<>'string') THEN RAISE EXCEPTION 'Role tidak valid' USING ERRCODE='22023'; END IF;
 IF actor.role::text='admin' AND (target.role::text IN ('owner','admin') OR requested_role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Admin hanya dapat mengelola CS, Advertiser, dan Akunting' USING ERRCODE='42501';
 END IF;
 -- Preserves an active owner even when two owners try to demote each other concurrently.
 IF p_target=actor.id AND (requested_role<>actor.role::text OR (p_patch ? 'active' AND NOT (p_patch->>'active')::boolean)) THEN
  RAISE EXCEPTION 'Tidak dapat menurunkan role atau menonaktifkan akun sendiri' USING ERRCODE='42501';
 END IF;
 UPDATE public.profiles SET
  full_name=CASE WHEN p_patch ? 'full_name' THEN trim(p_patch->>'full_name') ELSE full_name END,
  role=(jsonb_populate_record(NULL::public.profiles,jsonb_build_object('role',requested_role))).role,
  active=CASE WHEN p_patch ? 'active' THEN (p_patch->>'active')::boolean ELSE active END
 WHERE id=p_target AND organization_id=actor.organization_id;
END $$;
REVOKE ALL ON FUNCTION public.manage_org_profile(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.manage_org_profile(uuid,jsonb) TO authenticated;
COMMIT;
