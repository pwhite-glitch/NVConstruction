-- Migration 029: the signup trigger must never take a role from signup metadata.
-- Run right after 028.
--
-- Problem: on_auth_user_created → public.handle_new_user() inserted
--   coalesce(raw_user_meta_data->>'role', 'subcontractor')
-- into profiles.role. raw_user_meta_data comes from supabase.auth.signUp()
-- in the browser, so anyone could sign up as 'admin' (or any office role).
-- It also linked job_assignments by exact, case-sensitive email at signup,
-- before the address was confirmed, and overwrote rows already linked to
-- another user.
--
-- What this does:
--   1. Replaces handle_new_user(): every new profile starts as 'subcontractor'.
--      Roles are set afterwards with the service role by the routes that
--      create accounts:
--        /api/invite-team         → office roles (pm, apm, super, admin, metal_rep, roofing_rep)
--        /api/invite-sub,
--        /api/invite-team-member  → sub roles (subcontractor, sub_estimator, sub_pm, sub_admin)
--        /api/fix-profile, /api/manage-sub-user → later corrections
--      Each of these upserts profiles.role after generateLink() creates the
--      user, so they keep working unchanged.
--   2. Links job_assignments to the new user by email (trimmed, case-
--      insensitive) only once the email is confirmed: at signup if Supabase
--      auto-confirms it, otherwise when the user confirms / accepts the invite
--      (new trigger on_auth_user_email_confirmed). Rows already linked to an
--      existing user are left alone.
-- No existing rows are changed. Safe to re-run.
-- Rollback: re-create the previous handle_new_user() and
-- DROP TRIGGER on_auth_user_email_confirmed ON auth.users.

BEGIN;

-- Links unclaimed assignment rows for this email to the user.
CREATE OR REPLACE FUNCTION public.link_job_assignments_by_email(p_user uuid, p_email text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.job_assignments ja
  SET sub_id = p_user
  WHERE lower(trim(ja.sub_email)) = lower(trim(p_email))
    AND trim(coalesce(p_email, '')) <> ''
    AND (ja.sub_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ja.sub_id))
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Never read 'role' from raw_user_meta_data: the browser sets it.
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name', 'subcontractor')
  ON CONFLICT DO NOTHING;

  IF NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM public.link_job_assignments_by_email(NEW.id, NEW.email);
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.handle_user_email_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM public.link_job_assignments_by_email(NEW.id, NEW.email);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_confirmed();

-- These run only from triggers; nobody should call them through the API.
REVOKE EXECUTE ON FUNCTION public.link_job_assignments_by_email(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
