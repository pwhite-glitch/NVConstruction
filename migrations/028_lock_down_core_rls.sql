-- Migration 028: replace the wide-open RLS policies on the core tables.
--
-- Problem: Postgres ORs every permissive policy on a table, so the old
-- "true" / "authenticated" policies on jobs (and possibly the other tables
-- below) let ANY signed-in user — including any sub — read, edit or delete
-- every row, no matter what jobs_select (027) says.
--
-- What this does, for jobs, subcontracts, job_assignments,
-- billing_submissions, profiles and companies:
--   1. Drops EVERY existing policy on those six tables (whatever its name),
--      then creates the complete set below. Run scripts/rls-audit.sql block 1
--      first to see exactly which live policies will be dropped.
--   2. Office roles (pm, apm, super, admin) keep full read/write from the
--      browser, which the dashboard / job pages use directly.
--   3. Sub roles (subcontractor, sub_estimator, sub_pm, sub_admin) get
--      SELECT only, limited to their own / their company's rows on jobs they
--      can see (sub_can_see_job from 027). No browser writes — the sub portal
--      writes through /api routes with the service role.
--   4. owner gets SELECT on jobs whose owner_email is their login email
--      (the /owner portal reads jobs that way).
--   5. metal_rep / roofing_rep get nothing on these tables beyond their own
--      profile row: /sales goes through /api/sales-* with the service role.
--   6. A trigger stops non-office users changing their own role, company_id,
--      invite_email, job_access or can_bill. (Before this, a sub could set
--      can_bill / job_access on themselves, or set invite_email to someone
--      else's address and see jobs assigned to that email.)
-- The service role (all /api routes) bypasses RLS and is unaffected.
--
-- Runs in one transaction: if any statement fails nothing changes.
-- Safe to re-run.
-- Rollback: re-create the old policies (names/definitions from rls-audit.sql
-- block 1, saved before running) and DROP TRIGGER protect_profile_access_columns.

BEGIN;

-- ── HELPERS ──────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can read profiles without recursing into
-- profiles' own RLS. search_path pinned so they can't be hijacked.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_office_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(public.get_my_role() IN ('pm', 'apm', 'super', 'admin'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_sub_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(public.get_my_role() IN ('subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'), false)
$$;

CREATE OR REPLACE FUNCTION public.my_company_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;

-- True when p_user is at the caller's company (and the caller has one).
CREATE OR REPLACE FUNCTION public.is_company_teammate(p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user
      AND company_id IS NOT NULL
      AND company_id = public.my_company_id()
  )
$$;

-- ── DROP EVERY EXISTING POLICY ON THE SIX TABLES ─────────────────────────────
-- Includes, on jobs: "Authenticated users can view jobs", "authenticated_read_jobs",
-- "Authenticated users can insert jobs", "Authenticated users can update jobs",
-- "Authenticated users can delete jobs", "PMs can delete jobs", "jobs_select".
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('jobs', 'subcontracts', 'job_assignments', 'billing_submissions', 'profiles', 'companies')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE jobs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontracts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies           ENABLE ROW LEVEL SECURITY;

-- ── JOBS ─────────────────────────────────────────────────────────────────────
CREATE POLICY "jobs_office_select" ON jobs FOR SELECT TO authenticated
  USING (public.is_office_user());
CREATE POLICY "jobs_sub_select" ON jobs FOR SELECT TO authenticated
  USING (public.is_sub_user() AND public.sub_can_see_job(id));
CREATE POLICY "jobs_owner_select" ON jobs FOR SELECT TO authenticated
  USING (public.get_my_role() = 'owner' AND lower(owner_email) = lower(auth.jwt() ->> 'email'));
CREATE POLICY "jobs_office_insert" ON jobs FOR INSERT TO authenticated
  WITH CHECK (public.is_office_user());
CREATE POLICY "jobs_office_update" ON jobs FOR UPDATE TO authenticated
  USING (public.is_office_user()) WITH CHECK (public.is_office_user());
CREATE POLICY "jobs_office_delete" ON jobs FOR DELETE TO authenticated
  USING (public.is_office_user());

-- ── SUBCONTRACTS ─────────────────────────────────────────────────────────────
CREATE POLICY "subcontracts_office_all" ON subcontracts FOR ALL TO authenticated
  USING (public.is_office_user()) WITH CHECK (public.is_office_user());
-- Never drafts; own contracts, or the company's / a teammate's on a job they see
CREATE POLICY "subcontracts_sub_select" ON subcontracts FOR SELECT TO authenticated
  USING (
    public.is_sub_user()
    AND (status IS NULL OR status <> 'draft')
    AND (
      sub_id = auth.uid()
      OR ((company_id = public.my_company_id() OR public.is_company_teammate(sub_id))
          AND public.sub_can_see_job(job_id))
    )
  );

-- ── JOB_ASSIGNMENTS ──────────────────────────────────────────────────────────
CREATE POLICY "job_assignments_office_all" ON job_assignments FOR ALL TO authenticated
  USING (public.is_office_user()) WITH CHECK (public.is_office_user());
CREATE POLICY "job_assignments_sub_select" ON job_assignments FOR SELECT TO authenticated
  USING (
    public.is_sub_user()
    AND (
      sub_id = auth.uid()
      OR lower(sub_email) = lower(auth.jwt() ->> 'email')
      OR (company_id IS NOT NULL AND company_id = public.my_company_id())
    )
  );

-- ── BILLING_SUBMISSIONS ──────────────────────────────────────────────────────
CREATE POLICY "billing_office_all" ON billing_submissions FOR ALL TO authenticated
  USING (public.is_office_user()) WITH CHECK (public.is_office_user());
-- Own submissions, plus teammates' on jobs the caller sees (same as /api/sub-portal)
CREATE POLICY "billing_sub_select" ON billing_submissions FOR SELECT TO authenticated
  USING (
    public.is_sub_user()
    AND (sub_id = auth.uid() OR (public.is_company_teammate(sub_id) AND public.sub_can_see_job(job_id)))
  );

-- ── PROFILES ─────────────────────────────────────────────────────────────────
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY "profiles_office_select" ON profiles FOR SELECT TO authenticated
  USING (public.is_office_user());
-- Own row (name, phone, company_name on /set-password). The trigger below
-- blocks changes to the access columns.
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- Office edits team members and roles from the dashboard Team tab
CREATE POLICY "profiles_office_update" ON profiles FOR UPDATE TO authenticated
  USING (public.is_office_user()) WITH CHECK (public.is_office_user());
-- No INSERT/DELETE policies: profiles are created/removed by the service role.

CREATE OR REPLACE FUNCTION public.protect_profile_access_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role, SQL editor and auth triggers run without a user: allow.
  IF auth.uid() IS NULL OR public.is_office_user() THEN
    RETURN NEW;
  END IF;
  IF NEW.role         IS DISTINCT FROM OLD.role
  OR NEW.company_id   IS DISTINCT FROM OLD.company_id
  OR NEW.invite_email IS DISTINCT FROM OLD.invite_email
  OR NEW.job_access   IS DISTINCT FROM OLD.job_access
  OR NEW.can_bill     IS DISTINCT FROM OLD.can_bill THEN
    RAISE EXCEPTION 'Only NV Construction staff can change role, company, login email or access settings'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS protect_profile_access_columns ON profiles;
CREATE TRIGGER protect_profile_access_columns
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_access_columns();

-- ── COMPANIES ────────────────────────────────────────────────────────────────
CREATE POLICY "companies_office_all" ON companies FOR ALL TO authenticated
  USING (public.is_office_user()) WITH CHECK (public.is_office_user());
CREATE POLICY "companies_sub_select_own" ON companies FOR SELECT TO authenticated
  USING (public.is_sub_user() AND id = public.my_company_id());

COMMIT;
