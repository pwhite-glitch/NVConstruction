-- Migration 038: lock down billing tables, views and SECURITY DEFINER functions.
--
-- Problem: aia_applications, aia_application_lines and direct_costs each have
-- two permissive "true" policies, so every signed-in user (all subs and
-- sub_pms included) can read and edit pay apps and direct costs. anon and
-- authenticated also hold ALL table privileges (TRUNCATE included) on those
-- tables and on draw_requests, general_conditions and change_log. The views
-- subcontract_summary and sales_leaderboard run as their owner (bypassing
-- RLS) and are granted to anon: anyone holding the public anon key can read
-- subcontract_summary today. Several SECURITY DEFINER functions are callable
-- through the API by anon / authenticated, some with a mutable search_path.
-- job_docs and job_schedule_files have TO public USING (true) policies.
--
-- What this does:
--   1. aia_applications, aia_application_lines, direct_costs: drops the six
--      "true" policies and adds one "<table>_office_all" policy each. Office
--      roles (pm, apm, super, admin; bots are pm) keep full read/write from
--      the browser (jobdetail, admin, field). Everyone else gets nothing.
--      Exception: owner keeps SELECT on aia_applications for jobs whose
--      owner_email is their login email (same rule as jobs_owner_select in
--      028), because the /owner portal reads pay apps from the browser.
--   2. Table grants on those three plus draw_requests, general_conditions and
--      change_log: all revoked from anon; TRUNCATE, TRIGGER and REFERENCES
--      revoked from authenticated. draw_requests / general_conditions keep
--      RLS on with no policies (service-role routes only). change_log keeps
--      its existing insert + PM read policies (Bot API writes as the bot).
--   3. subcontract_summary and sales_leaderboard: security_invoker = on, so
--      they respect the caller's RLS. anon loses all access; authenticated
--      keeps SELECT only. Office users still see every row (028 policies on
--      subcontracts / billing_submissions + the change_orders read policy);
--      /api/sub-contracts reads the view with the service role.
--   4. Trigger-only and service-role-only SECURITY DEFINER functions can no
--      longer be called through the API by anon / authenticated. Triggers
--      don't need EXECUTE grants to fire.
--   5. sync_job_assignments(): search_path pinned; anon / PUBLIC can no
--      longer call it. authenticated keeps EXECUTE because the dashboard and
--      job page call it from the browser. Its body is NOT in this repo, so it
--      is not recreated with an office-only guard here (see 039 follow-up).
--   6. search_path pinned on link_sub_to_assignments, increment_sales_order_seq
--      and set_updated_at.
--   7. job_docs: only /api/job-docs (service role) touches it, so the
--      "service_role_all" TO public policy is dropped (service role bypasses
--      RLS) and anon loses its grants. job_schedule_files: jobdetail reads,
--      inserts and deletes it from the browser, so "pm access" is replaced
--      with an office-only policy.
-- The service role (all /api routes) bypasses RLS and is unaffected.
--
-- Runs in one transaction: if any statement fails nothing changes.
-- Safe to re-run.
-- Rollback: see the commented-out section at the bottom.

BEGIN;

-- ── 1. BILLING TABLE POLICIES ────────────────────────────────────────────────
ALTER TABLE public.aia_applications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aia_application_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_costs          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated manage aia_applications"        ON public.aia_applications;
DROP POLICY IF EXISTS "authenticated_read_aia_applications"          ON public.aia_applications;
DROP POLICY IF EXISTS "Authenticated manage aia_application_lines"   ON public.aia_application_lines;
DROP POLICY IF EXISTS "authenticated_read_aia_application_lines"     ON public.aia_application_lines;
DROP POLICY IF EXISTS "Authenticated users can manage direct costs"  ON public.direct_costs;
DROP POLICY IF EXISTS "authenticated_read_direct_costs"              ON public.direct_costs;

DROP POLICY IF EXISTS "aia_applications_office_all" ON public.aia_applications;
CREATE POLICY "aia_applications_office_all" ON public.aia_applications FOR ALL TO authenticated
  USING ((select public.is_office_user())) WITH CHECK ((select public.is_office_user()));

-- /owner portal: Pay Applications list on the owner's own jobs
DROP POLICY IF EXISTS "aia_applications_owner_select" ON public.aia_applications;
CREATE POLICY "aia_applications_owner_select" ON public.aia_applications FOR SELECT TO authenticated
  USING (
    (select public.get_my_role()) = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = aia_applications.job_id
        AND lower(j.owner_email) = lower((select auth.jwt() ->> 'email'))
    )
  );

DROP POLICY IF EXISTS "aia_application_lines_office_all" ON public.aia_application_lines;
CREATE POLICY "aia_application_lines_office_all" ON public.aia_application_lines FOR ALL TO authenticated
  USING ((select public.is_office_user())) WITH CHECK ((select public.is_office_user()));

DROP POLICY IF EXISTS "direct_costs_office_all" ON public.direct_costs;
CREATE POLICY "direct_costs_office_all" ON public.direct_costs FOR ALL TO authenticated
  USING ((select public.is_office_user())) WITH CHECK ((select public.is_office_user()));

-- ── 2. TABLE GRANTS ──────────────────────────────────────────────────────────
REVOKE ALL ON public.aia_applications, public.aia_application_lines, public.direct_costs,
              public.draw_requests, public.general_conditions, public.change_log
  FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES
  ON public.aia_applications, public.aia_application_lines, public.direct_costs,
     public.draw_requests, public.general_conditions, public.change_log
  FROM authenticated;

-- ── 3. VIEWS ─────────────────────────────────────────────────────────────────
ALTER VIEW public.subcontract_summary SET (security_invoker = on);
ALTER VIEW public.sales_leaderboard   SET (security_invoker = on);

REVOKE ALL ON public.subcontract_summary, public.sales_leaderboard FROM anon, authenticated;
GRANT SELECT ON public.subcontract_summary, public.sales_leaderboard TO authenticated;

-- ── 4. FUNCTIONS NOBODY SHOULD CALL THROUGH THE API ──────────────────────────
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_email_confirmed()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_access_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_sales_order_seq(text, int) FROM PUBLIC, anon, authenticated;
-- /api/sales-orders calls it with the service role
GRANT  EXECUTE ON FUNCTION public.increment_sales_order_seq(text, int) TO service_role;

-- link_sub_to_assignments isn't defined in this repo, so match it by name
-- (every overload) instead of guessing its signature. Also step 6.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'link_sub_to_assignments'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END $$;

-- ── 5. SYNC_JOB_ASSIGNMENTS ──────────────────────────────────────────────────
-- Called as supabase.rpc('sync_job_assignments') with no arguments.
ALTER FUNCTION public.sync_job_assignments() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.sync_job_assignments() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_job_assignments() TO authenticated, service_role;

-- ── 6. PIN SEARCH_PATH ───────────────────────────────────────────────────────
ALTER FUNCTION public.increment_sales_order_seq(text, int) SET search_path = public;
ALTER FUNCTION public.set_updated_at()                     SET search_path = public;

-- ── 7. JOB_DOCS / JOB_SCHEDULE_FILES ─────────────────────────────────────────
-- job_docs: service role only (/api/job-docs). RLS on with no policies.
ALTER TABLE public.job_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.job_docs;
REVOKE ALL ON public.job_docs FROM anon;

-- job_schedule_files: jobdetail Schedule tab reads / inserts / deletes in the browser
ALTER TABLE public.job_schedule_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pm access" ON public.job_schedule_files;
DROP POLICY IF EXISTS "job_schedule_files_office_all" ON public.job_schedule_files;
CREATE POLICY "job_schedule_files_office_all" ON public.job_schedule_files FOR ALL TO authenticated
  USING ((select public.is_office_user())) WITH CHECK ((select public.is_office_user()));
REVOKE ALL ON public.job_schedule_files FROM anon;

COMMIT;

-- ── EMERGENCY ROLLBACK (restores the pre-038 state; run as one block) ───────
-- Policy definitions below assume the old "true" policies were TO
-- authenticated (the read ones FOR SELECT, the manage ones FOR ALL). Check
-- against the pre-038 audit output before running.
--
-- BEGIN;
-- DROP POLICY IF EXISTS "aia_applications_office_all"      ON public.aia_applications;
-- DROP POLICY IF EXISTS "aia_applications_owner_select"    ON public.aia_applications;
-- DROP POLICY IF EXISTS "aia_application_lines_office_all" ON public.aia_application_lines;
-- DROP POLICY IF EXISTS "direct_costs_office_all"          ON public.direct_costs;
-- CREATE POLICY "Authenticated manage aia_applications" ON public.aia_applications FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "authenticated_read_aia_applications" ON public.aia_applications FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Authenticated manage aia_application_lines" ON public.aia_application_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "authenticated_read_aia_application_lines" ON public.aia_application_lines FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Authenticated users can manage direct costs" ON public.direct_costs FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "authenticated_read_direct_costs" ON public.direct_costs FOR SELECT TO authenticated USING (true);
--
-- GRANT ALL ON public.aia_applications, public.aia_application_lines, public.direct_costs,
--              public.draw_requests, public.general_conditions, public.change_log
--   TO anon, authenticated;
--
-- ALTER VIEW public.subcontract_summary SET (security_invoker = off);
-- ALTER VIEW public.sales_leaderboard   SET (security_invoker = off);
-- GRANT ALL ON public.subcontract_summary, public.sales_leaderboard TO anon, authenticated;
--
-- GRANT EXECUTE ON FUNCTION public.handle_new_user()                     TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.handle_user_email_confirmed()         TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.protect_profile_access_columns()      TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.increment_sales_order_seq(text, int)  TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.sync_job_assignments()                TO PUBLIC, anon, authenticated;
-- ALTER FUNCTION public.increment_sales_order_seq(text, int) RESET search_path;
-- ALTER FUNCTION public.set_updated_at()                     RESET search_path;
-- ALTER FUNCTION public.sync_job_assignments()               RESET search_path;
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--            WHERE n.nspname = 'public' AND p.proname = 'link_sub_to_assignments'
--   LOOP
--     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', r.sig);
--     EXECUTE format('ALTER FUNCTION %s RESET search_path', r.sig);
--   END LOOP;
-- END $$;
--
-- CREATE POLICY "service_role_all" ON public.job_docs TO public USING (true) WITH CHECK (true);
-- GRANT ALL ON public.job_docs TO anon;
-- DROP POLICY IF EXISTS "job_schedule_files_office_all" ON public.job_schedule_files;
-- CREATE POLICY "pm access" ON public.job_schedule_files TO public USING (true);
-- GRANT ALL ON public.job_schedule_files TO anon;
-- COMMIT;
