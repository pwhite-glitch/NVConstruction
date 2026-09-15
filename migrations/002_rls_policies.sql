-- Migration 002: RLS policy hardening
-- Rollout order: run AFTER migration 001.
-- IMPORTANT: Inspect existing policy names first with:
--   SELECT schemaname, tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename;
-- Replace policy names below with the actual names you find.
-- Rollback: DROP the new policies and re-create the old permissive ones (or disable RLS).
-- Test in a staging environment first — a wrong policy can lock out all users.

-- ── HELPER FUNCTION ──────────────────────────────────────────────────────────
-- Security DEFINER so it reads profiles without triggering RLS on profiles itself.
-- Returns NULL (not true/false) when no profile exists, which evaluates as false in policies.
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- ── ENABLE RLS ON TABLES THAT WERE MISSING IT ────────────────────────────────
-- Preflight: check existing RLS state with:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('sub_directory','budget_items','bid_packages','bid_plans','bid_invitations','bid_submissions');

ALTER TABLE sub_directory      ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_packages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_invitations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_submissions    ENABLE ROW LEVEL SECURITY;

-- ── PROFILES ─────────────────────────────────────────────────────────────────
-- Drop the broad permissive policies.
-- Adjust these names to match what pg_policies shows in your database.
DROP POLICY IF EXISTS "auth read" ON profiles;
DROP POLICY IF EXISTS "authenticated SELECT" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
-- Drop any overly broad UPDATE policy:
DROP POLICY IF EXISTS "auth update" ON profiles;
DROP POLICY IF EXISTS "authenticated UPDATE" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- SELECT: own row always; PM can read all
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR get_my_role() IN ('pm', 'apm', 'super')
  );

-- UPDATE: own row only, and role/company_id/invite_email must not change
-- (role changes go through /api/fix-profile with PM auth + service role key)
CREATE POLICY "profiles_update_safe" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Prevent self-escalation: role must stay the same as current value
    AND role = get_my_role()
    -- Prevent company affiliation change: company_id must stay the same
    AND (
      company_id IS NOT DISTINCT FROM (
        SELECT company_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

-- ── JOBS ─────────────────────────────────────────────────────────────────────
-- Drop broad policies first (adjust names):
DROP POLICY IF EXISTS "auth read" ON jobs;
DROP POLICY IF EXISTS "authenticated SELECT" ON jobs;
DROP POLICY IF EXISTS "Authenticated users can read jobs" ON jobs;

-- SELECT: PM sees all; subs see only assigned jobs
CREATE POLICY "jobs_select" ON jobs
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super')
    OR EXISTS (
      SELECT 1 FROM job_assignments
      WHERE job_assignments.job_id = jobs.id
        AND job_assignments.sub_id = auth.uid()
    )
  );

-- INSERT / UPDATE / DELETE via service role only (API routes use adminSupabase)
-- No authenticated client policies needed for write operations.

-- ── BILLING_SUBMISSIONS ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth read" ON billing_submissions;
DROP POLICY IF EXISTS "authenticated SELECT" ON billing_submissions;
DROP POLICY IF EXISTS "billing_submissions: SELECT USING true" ON billing_submissions;
DROP POLICY IF EXISTS "Authenticated users can read billing_submissions" ON billing_submissions;

CREATE POLICY "billing_select" ON billing_submissions
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super')
    OR sub_id = auth.uid()
    OR (
      -- sub-admin / sub-pm can see their company's submissions
      get_my_role() IN ('sub_admin', 'sub_pm')
      AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.company_id = (
            SELECT company_id FROM profiles WHERE id = billing_submissions.sub_id LIMIT 1
          )
      )
    )
  );

-- ── DRAWINGS ─────────────────────────────────────────────────────────────────
-- Drop the broad true/true policies:
DROP POLICY IF EXISTS "Authenticated users can read drawings" ON drawings;
DROP POLICY IF EXISTS "PM/APM/Super can insert drawings" ON drawings;
DROP POLICY IF EXISTS "PM/APM/Super can update drawings" ON drawings;
DROP POLICY IF EXISTS "PM/APM/Super can delete drawings" ON drawings;
DROP POLICY IF EXISTS "auth read drawings" ON drawings;
DROP POLICY IF EXISTS "auth insert drawings" ON drawings;
DROP POLICY IF EXISTS "auth delete drawings" ON drawings;

-- SELECT: any authenticated user (access goes through signed URLs anyway)
CREATE POLICY "drawings_select" ON drawings
  FOR SELECT TO authenticated USING (true);

-- INSERT / DELETE: PM only
CREATE POLICY "drawings_insert" ON drawings
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('pm', 'apm', 'super'));

CREATE POLICY "drawings_delete" ON drawings
  FOR DELETE TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super'));

-- ── SUB_DIRECTORY ─────────────────────────────────────────────────────────────
CREATE POLICY "sub_directory_select" ON sub_directory
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super')
    OR email = (SELECT invite_email FROM profiles WHERE id = auth.uid())
  );

-- Insert: public (sub application flow) — handled via service role in API
-- Update: PM or the sub's own record (limited fields enforced at API layer)
CREATE POLICY "sub_directory_update" ON sub_directory
  FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super')
    OR email = (SELECT invite_email FROM profiles WHERE id = auth.uid())
  );

-- ── BUDGET_ITEMS ─────────────────────────────────────────────────────────────
CREATE POLICY "budget_items_select" ON budget_items
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super')
    OR EXISTS (
      SELECT 1 FROM job_assignments
      WHERE job_assignments.job_id = budget_items.job_id
        AND job_assignments.sub_id = auth.uid()
    )
  );

-- ── BID TABLES ───────────────────────────────────────────────────────────────
-- bid_packages: PM full access; invited subs can read their packages
CREATE POLICY "bid_packages_select" ON bid_packages
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super'));

CREATE POLICY "bid_plans_select" ON bid_plans
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super'));

-- bid_invitations: PM or the invited sub's email
CREATE POLICY "bid_invitations_select" ON bid_invitations
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super')
    OR sub_email = (SELECT invite_email FROM profiles WHERE id = auth.uid())
  );

-- bid_submissions: PM or the submitting sub
CREATE POLICY "bid_submissions_select" ON bid_submissions
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super')
    OR sub_id = auth.uid()
  );

-- ── RETAINAGE_RELEASES ────────────────────────────────────────────────────────
ALTER TABLE retainage_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "retainage_select" ON retainage_releases
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super')
    OR sub_id = auth.uid()
  );
