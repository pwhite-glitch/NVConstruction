-- Migration 055: Job Change History can no longer be faked from the browser,
-- and job-limited staff only read their own jobs' history (prompt 58, item 6).
--
-- STATUS: PROPOSED — written, NOT applied. Does not depend on 042 or 044–054
-- (it defines its own job-access helper instead of reusing 046's).
--
-- Problem (014 / 041): "Authenticated can insert change_log" only checked
-- changed_by = auth.uid(), so any login (sub, client owner, super) could insert
-- a row for any job with any note and any changed_by_name. "PM roles can read
-- change_log" let every office role read every job's history.
--
-- What this does (only touches public.change_log; safe to re-run):
--   1. Drops the browser INSERT policy and revokes INSERT / UPDATE / DELETE
--      from anon and authenticated. Every write now goes through the service
--      role (lib/change-log.js logChange — API routes and the Bot API).
--   2. BEFORE INSERT trigger stamps changed_by_name from profiles.full_name
--      whenever changed_by is set, so the name always matches the real person
--      even if a caller passes something else. A caller-supplied name is never
--      kept: no changed_by, or a profile with no name, stores NULL.
--   3. Replaces the SELECT policy with a job-scoped one:
--        principal / admin: every row;
--        pm / apm / super: rows whose job they are on (pm_job_assignments, or
--          jobs.pm_email = their login email);
--        everyone else: nothing. Rows with no job_id: principal / admin only.
--      Same rule as /api/change-log (denyUnlessOnJob).
--
-- Rollback:
--   DROP POLICY IF EXISTS "change_log_job_scoped_select" ON public.change_log;
--   DROP TRIGGER IF EXISTS change_log_stamp_name ON public.change_log;
--   DROP FUNCTION IF EXISTS public.change_log_stamp_name();
--   DROP FUNCTION IF EXISTS public.change_log_job_access(uuid);
--   then re-create 014's two policies (with 041's 'principal') if wanted.

BEGIN;

-- ── 1. No browser writes ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can insert change_log" ON public.change_log;
REVOKE INSERT, UPDATE, DELETE ON public.change_log FROM anon, authenticated;

-- ── 2. Name always from the profile ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.change_log_stamp_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Never keep a caller-supplied name: the profile's name, or NULL (no
  -- changed_by, or the profile has no name).
  IF NEW.changed_by IS NOT NULL THEN
    NEW.changed_by_name := (
      SELECT nullif(trim(p.full_name), '') FROM public.profiles p WHERE p.id = NEW.changed_by
    );
  ELSE
    NEW.changed_by_name := NULL;
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.change_log_stamp_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS change_log_stamp_name ON public.change_log;
CREATE TRIGGER change_log_stamp_name
  BEFORE INSERT ON public.change_log
  FOR EACH ROW EXECUTE FUNCTION public.change_log_stamp_name();

-- ── 3. Job-scoped reads ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.change_log_job_access(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.get_my_role() IN ('principal', 'admin') THEN true
    WHEN p_job_id IS NULL THEN false
    WHEN public.get_my_role() IN ('pm', 'apm', 'super') THEN (
      EXISTS (
        SELECT 1 FROM public.pm_job_assignments a
         WHERE a.job_id = p_job_id AND a.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE j.id = p_job_id
           AND j.pm_email IS NOT NULL
           AND coalesce(auth.jwt() ->> 'email', '') <> ''
           AND lower(trim(j.pm_email)) = lower(trim(auth.jwt() ->> 'email'))
      )
    )
    ELSE false
  END
$$;

REVOKE EXECUTE ON FUNCTION public.change_log_job_access(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.change_log_job_access(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "PM roles can read change_log" ON public.change_log;
DROP POLICY IF EXISTS "change_log_job_scoped_select" ON public.change_log;
CREATE POLICY "change_log_job_scoped_select" ON public.change_log
  FOR SELECT TO authenticated
  USING (public.change_log_job_access(job_id));

COMMIT;
