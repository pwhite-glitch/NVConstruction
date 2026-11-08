-- Migration 056: NV Team role / access columns are Owner-only in the database
-- (prompt 58, item 7).
--
-- STATUS: PROPOSED — written, NOT applied. Does not depend on 042 or 044–055.
-- No profile row is changed by this file.
--
-- Problem (028 + 041): profiles_office_update lets any is_office_user()
-- (principal, pm, apm, super, admin) UPDATE any profile, and
-- protect_profile_access_columns() waves every office user through. So an APM
-- or super could run supabase.from('profiles').update({ role: 'principal' })
-- from the browser console and become an Owner, or demote the last Owner.
--
-- What this does (only touches public.profiles; safe to re-run):
--   1. protect_profile_access_columns() (same name, same trigger): role,
--      company_id, invite_email, job_access and can_bill may only be changed
--      by the service role / SQL editor (no auth.uid(), or a service_role
--      JWT) or by a principal (Owner).
--      Everyone else — including pm / apm / super / admin — is refused.
--      In addition, no UPDATE may take the last principal's role away
--      (whoever runs it); add another Owner first.
--      The app's NV Team Role dropdown now uses the Owner-only
--      POST /api/fix-profile { action: 'team_role' } (service role), which
--      also checks ownerChangeError.
--   2. profiles_office_update narrowed to principal. The only browser writes
--      to other people's profiles are on the Owner-only NV Team tab (name /
--      phone / company name). Everyone keeps profiles_update_own for their own
--      row (name, phone, company name; access columns still blocked by 1).
--
-- Rollback:
--   Re-run 028's protect_profile_access_columns() body and
--   DROP POLICY IF EXISTS "profiles_office_update" ON public.profiles;
--   CREATE POLICY "profiles_office_update" ON public.profiles FOR UPDATE TO authenticated
--     USING (public.is_office_user()) WITH CHECK (public.is_office_user());

BEGIN;

CREATE OR REPLACE FUNCTION public.protect_profile_access_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- SECURITY DEFINER, so current_user is the owner here; decide from the JWT:
  -- service role / SQL editor / auth triggers carry no user id.
  trusted boolean := auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  access_changed boolean := NEW.role         IS DISTINCT FROM OLD.role
                         OR NEW.company_id   IS DISTINCT FROM OLD.company_id
                         OR NEW.invite_email IS DISTINCT FROM OLD.invite_email
                         OR NEW.job_access   IS DISTINCT FROM OLD.job_access
                         OR NEW.can_bill     IS DISTINCT FROM OLD.can_bill;
BEGIN
  IF access_changed AND NOT trusted AND coalesce(public.get_my_role(), '') <> 'principal' THEN
    RAISE EXCEPTION 'Only an Owner can change role, company, login email or access settings'
      USING ERRCODE = '42501';
  END IF;
  -- Never leave the company without an Owner.
  IF OLD.role = 'principal' AND NEW.role IS DISTINCT FROM 'principal'
     AND (SELECT count(*) FROM public.profiles WHERE role = 'principal' AND id <> OLD.id) = 0 THEN
    RAISE EXCEPTION 'This is the last Owner account. Add another Owner first.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.protect_profile_access_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profile_access_columns ON public.profiles;
CREATE TRIGGER protect_profile_access_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_access_columns();

DROP POLICY IF EXISTS "profiles_office_update" ON public.profiles;
CREATE POLICY "profiles_office_update" ON public.profiles FOR UPDATE TO authenticated
  USING (coalesce(public.get_my_role(), '') = 'principal')
  WITH CHECK (coalesce(public.get_my_role(), '') = 'principal');

COMMIT;
