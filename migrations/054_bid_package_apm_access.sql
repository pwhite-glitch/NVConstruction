-- Migration 054: bid package "APM Access" enforced in the database
-- (prompt 58, item 2).
--
-- STATUS: PROPOSED — written, NOT applied. Does not depend on 042 or 044–053.
--
-- Problem: 011's SELECT policies let every pm/apm/super/admin read every bid
-- package, plan, invitation and submission, and bid_rfis is USING (true). The
-- dashboard and /bid/[id] read these tables from the browser, so the
-- allowed_users ("APM Access") list only hid rows in the UI. Supers could also
-- write through any permissive write policy that exists live.
--
-- What this does (additive; safe to re-run):
--   • Adds RESTRICTIVE policies only. A restrictive policy is AND-ed with
--     whatever permissive policies already exist (in the repo or created live),
--     so this file never drops or rewrites an existing policy and cannot
--     widen access. Sub / client paths that already work keep working unless
--     noted.
--   • can_read_bid_package(id): true for principal / pm / admin / super; for
--     apm only when auth.uid() is in that package's allowed_users; true for
--     any other role (their own permissive policies — e.g. a sub's invitation
--     by email — still decide). SECURITY DEFINER so it can read bid_packages
--     without recursing through these policies.
--   • can_write_bid_package(id): false for super; apm only when listed;
--     other roles fall through to the existing permissive policies.
--   • bid_packages: APM SELECT/UPDATE limited to listed packages; super has no
--     INSERT/UPDATE/DELETE; DELETE only principal / pm; allowed_users can only
--     be changed by principal / pm (trigger; the service role is exempt — the
--     /api/bid-packages route checks the same rule).
--   • bid_plans, bid_invitations, bid_submissions, bid_scope_items, bid_rfis
--     (when present): APM SELECT only on listed packages; super no writes; APM
--     writes only on listed packages.
--   • bid_rfis: SELECT (previously USING (true)) limited to office roles that
--     can read the package. Subs and client logins never read bid RFIs in the
--     app (only /bid/[id], which is staff-only).
--   • Job scoping (see the amendment section at the end): job-limited PM /
--     APM only see / write job-linked packages and their child rows —
--     including bid_leveling_entries — when they are on that job.
--
-- Rollback:
--   DROP POLICY IF EXISTS "<name>" ON public.<table>; for each policy named
--   bid54_* below; DROP TRIGGER IF EXISTS bid_packages_allowed_users_guard ON
--   public.bid_packages; DROP FUNCTION IF EXISTS
--   public.guard_bid_allowed_users(), public.can_read_bid_package(uuid),
--   public.can_write_bid_package(uuid).

BEGIN;

CREATE OR REPLACE FUNCTION public.can_read_bid_package(p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.get_my_role() = 'apm' THEN EXISTS (
      SELECT 1 FROM public.bid_packages b
       WHERE b.id = p_id AND auth.uid()::text = ANY (coalesce(b.allowed_users::text[], '{}'::text[]))
    )
    ELSE true
  END
$$;

CREATE OR REPLACE FUNCTION public.can_write_bid_package(p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.get_my_role() = 'super' THEN false
    ELSE public.can_read_bid_package(p_id)
  END
$$;

REVOKE EXECUTE ON FUNCTION public.can_read_bid_package(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_write_bid_package(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_bid_package(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_bid_package(uuid) TO authenticated;

-- ── bid_packages ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bid54_packages_apm_select" ON public.bid_packages;
CREATE POLICY "bid54_packages_apm_select" ON public.bid_packages AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.can_read_bid_package(id));

DROP POLICY IF EXISTS "bid54_packages_insert" ON public.bid_packages;
CREATE POLICY "bid54_packages_insert" ON public.bid_packages AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (coalesce(public.get_my_role(), '') <> 'super');

DROP POLICY IF EXISTS "bid54_packages_update" ON public.bid_packages;
CREATE POLICY "bid54_packages_update" ON public.bid_packages AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.can_write_bid_package(id))
  WITH CHECK (public.can_write_bid_package(id));

DROP POLICY IF EXISTS "bid54_packages_delete" ON public.bid_packages;
CREATE POLICY "bid54_packages_delete" ON public.bid_packages AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (coalesce(public.get_my_role(), '') IN ('principal', 'pm'));

CREATE OR REPLACE FUNCTION public.guard_bid_allowed_users()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.allowed_users IS DISTINCT FROM OLD.allowed_users
     AND coalesce(public.get_my_role(), '') NOT IN ('principal', 'pm') THEN
    RAISE EXCEPTION 'bid_allowed_users_owner_pm_only: only an Owner or PM can change APM Access'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.guard_bid_allowed_users() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bid_packages_allowed_users_guard ON public.bid_packages;
CREATE TRIGGER bid_packages_allowed_users_guard
  BEFORE UPDATE ON public.bid_packages
  FOR EACH ROW EXECUTE FUNCTION public.guard_bid_allowed_users();

-- ── Child tables keyed by bid_package_id ─────────────────────────────────────
DO $child$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bid_plans', 'bid_invitations', 'bid_submissions', 'bid_scope_items', 'bid_rfis'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skip %: table not present', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'bid54_' || t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.can_read_bid_package(bid_package_id))', 'bid54_' || t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'bid54_' || t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_write_bid_package(bid_package_id))', 'bid54_' || t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'bid54_' || t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_write_bid_package(bid_package_id)) WITH CHECK (public.can_write_bid_package(bid_package_id))', 'bid54_' || t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'bid54_' || t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_write_bid_package(bid_package_id))', 'bid54_' || t || '_delete', t);
  END LOOP;
END
$child$;

-- bid_rfis: staff only (was USING (true) for every login).
DO $rfis$
BEGIN
  IF to_regclass('public.bid_rfis') IS NOT NULL THEN
    DROP POLICY IF EXISTS "bid54_bid_rfis_staff_only" ON public.bid_rfis;
    CREATE POLICY "bid54_bid_rfis_staff_only" ON public.bid_rfis AS RESTRICTIVE
      FOR SELECT TO authenticated
      USING (coalesce(public.get_my_role(), '') IN ('principal', 'pm', 'apm', 'super', 'admin'));
  END IF;
END
$rfis$;

-- ── Job scoping for job-linked packages (amendment, prompt 58 follow-up) ─────
-- Same rule as /api/bid-packages (denyPackageJob): a job-limited PM / APM
-- only reads or writes a package (and its plans, invitations, submissions,
-- scope items, RFIs and leveling amounts) when they are on the package's job
-- — pm_job_assignments row, or jobs.pm_email = their login email. A package
-- with no job (pre-award) is not job-scoped; the APM Access rules above still
-- apply to it. Principal / admin / super are not job-limited here (supers stay
-- read-only via can_write_bid_package). Every policy below is RESTRICTIVE,
-- so it can only narrow access.
--
-- bid_leveling_entries (detailed per-scope bid amounts, read / upserted from
-- /bid/[id] and the dashboard) is keyed by bid_submission_id; it now gets the
-- same APM-package and job rules as the other child tables via the
-- submission's package.
--
-- Rollback (in addition to the list at the top):
--   DROP POLICY IF EXISTS "bid54_<table>_job_scope" ON public.<table>; for
--   bid_packages and each child table; DROP POLICY IF EXISTS
--   "bid54_bid_leveling_entries_<select|insert|update|delete>" ON
--   public.bid_leveling_entries; DROP FUNCTION IF EXISTS
--   public.bid_job_access(text), public.bid_package_job(uuid),
--   public.bid_submission_package(uuid).

CREATE OR REPLACE FUNCTION public.bid_job_access(p_job_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_job_id IS NULL THEN true
    WHEN coalesce(public.get_my_role(), '') NOT IN ('pm', 'apm') THEN true
    ELSE (
      EXISTS (
        SELECT 1 FROM public.pm_job_assignments a
         WHERE a.job_id::text = p_job_id AND a.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE j.id::text = p_job_id
           AND j.pm_email IS NOT NULL
           AND coalesce(auth.jwt() ->> 'email', '') <> ''
           AND lower(trim(j.pm_email)) = lower(trim(auth.jwt() ->> 'email'))
      )
    )
  END
$$;

-- The package's job (NULL when the package has none or does not exist).
CREATE OR REPLACE FUNCTION public.bid_package_job(p_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT b.job_id::text FROM public.bid_packages b WHERE b.id = p_id
$$;

-- The package a bid submission belongs to.
CREATE OR REPLACE FUNCTION public.bid_submission_package(p_submission_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT s.bid_package_id FROM public.bid_submissions s WHERE s.id = p_submission_id
$$;

REVOKE EXECUTE ON FUNCTION public.bid_job_access(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bid_package_job(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bid_submission_package(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bid_job_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bid_package_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bid_submission_package(uuid) TO authenticated;

-- bid_packages: job checked on the row's own job_id (so INSERT / re-linking
-- a package to another job is checked too).
DROP POLICY IF EXISTS "bid54_bid_packages_job_scope" ON public.bid_packages;
CREATE POLICY "bid54_bid_packages_job_scope" ON public.bid_packages AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.bid_job_access(job_id::text))
  WITH CHECK (public.bid_job_access(job_id::text));

-- Child tables keyed by bid_package_id.
DO $childjob$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bid_plans', 'bid_invitations', 'bid_submissions', 'bid_scope_items', 'bid_rfis'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skip %: table not present', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'bid54_' || t || '_job_scope', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.bid_job_access(public.bid_package_job(bid_package_id))) WITH CHECK (public.bid_job_access(public.bid_package_job(bid_package_id)))', 'bid54_' || t || '_job_scope', t);
  END LOOP;
END
$childjob$;

-- bid_leveling_entries: APM package rule + job rule through the submission.
DO $leveling$
BEGIN
  IF to_regclass('public.bid_leveling_entries') IS NULL THEN
    RAISE NOTICE 'skip bid_leveling_entries: table not present';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS "bid54_bid_leveling_entries_select" ON public.bid_leveling_entries;
  CREATE POLICY "bid54_bid_leveling_entries_select" ON public.bid_leveling_entries AS RESTRICTIVE
    FOR SELECT TO authenticated
    USING (public.can_read_bid_package(public.bid_submission_package(bid_submission_id)));
  DROP POLICY IF EXISTS "bid54_bid_leveling_entries_insert" ON public.bid_leveling_entries;
  CREATE POLICY "bid54_bid_leveling_entries_insert" ON public.bid_leveling_entries AS RESTRICTIVE
    FOR INSERT TO authenticated
    WITH CHECK (public.can_write_bid_package(public.bid_submission_package(bid_submission_id)));
  DROP POLICY IF EXISTS "bid54_bid_leveling_entries_update" ON public.bid_leveling_entries;
  CREATE POLICY "bid54_bid_leveling_entries_update" ON public.bid_leveling_entries AS RESTRICTIVE
    FOR UPDATE TO authenticated
    USING (public.can_write_bid_package(public.bid_submission_package(bid_submission_id)))
    WITH CHECK (public.can_write_bid_package(public.bid_submission_package(bid_submission_id)));
  DROP POLICY IF EXISTS "bid54_bid_leveling_entries_delete" ON public.bid_leveling_entries;
  CREATE POLICY "bid54_bid_leveling_entries_delete" ON public.bid_leveling_entries AS RESTRICTIVE
    FOR DELETE TO authenticated
    USING (public.can_write_bid_package(public.bid_submission_package(bid_submission_id)));
  DROP POLICY IF EXISTS "bid54_bid_leveling_entries_job_scope" ON public.bid_leveling_entries;
  CREATE POLICY "bid54_bid_leveling_entries_job_scope" ON public.bid_leveling_entries AS RESTRICTIVE
    FOR ALL TO authenticated
    USING (public.bid_job_access(public.bid_package_job(public.bid_submission_package(bid_submission_id))))
    WITH CHECK (public.bid_job_access(public.bid_package_job(public.bid_submission_package(bid_submission_id))));
END
$leveling$;

COMMIT;
