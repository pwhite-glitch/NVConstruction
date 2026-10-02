-- Migration 011: Grant admin role full internal access
-- The 'admin' role already exists in the profiles_role_check constraint (migration 006)
-- but was omitted from all RLS SELECT policies in migrations 002 and 003.
-- This migration adds 'admin' alongside pm/apm/super on every affected table
-- by adding supplemental SELECT policies (Postgres ORs multiple policies per table).
-- Write operations go through adminSupabase (service role) and are unaffected.

-- ── PROFILES ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR get_my_role() IN ('pm', 'apm', 'super', 'admin')
  );

-- ── JOBS ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "jobs_select" ON jobs;
CREATE POLICY "jobs_select" ON jobs
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR EXISTS (
      SELECT 1 FROM job_assignments
      WHERE job_assignments.job_id = jobs.id
        AND job_assignments.sub_id = auth.uid()
    )
  );

-- ── BILLING_SUBMISSIONS ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "billing_select" ON billing_submissions;
CREATE POLICY "billing_select" ON billing_submissions
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR sub_id = auth.uid()
    OR (
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
DROP POLICY IF EXISTS "drawings_insert" ON drawings;
CREATE POLICY "drawings_insert" ON drawings
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('pm', 'apm', 'super', 'admin'));

DROP POLICY IF EXISTS "drawings_delete" ON drawings;
CREATE POLICY "drawings_delete" ON drawings
  FOR DELETE TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));

-- ── SUB_DIRECTORY ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sub_directory_select" ON sub_directory;
CREATE POLICY "sub_directory_select" ON sub_directory
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR email = (SELECT invite_email FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "sub_directory_update" ON sub_directory;
CREATE POLICY "sub_directory_update" ON sub_directory
  FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR email = (SELECT invite_email FROM profiles WHERE id = auth.uid())
  );

-- ── BUDGET_ITEMS ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "budget_items_select" ON budget_items;
CREATE POLICY "budget_items_select" ON budget_items
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR EXISTS (
      SELECT 1 FROM job_assignments
      WHERE job_assignments.job_id = budget_items.job_id
        AND job_assignments.sub_id = auth.uid()
    )
  );

-- ── BID TABLES ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bid_packages_select" ON bid_packages;
CREATE POLICY "bid_packages_select" ON bid_packages
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));

DROP POLICY IF EXISTS "bid_plans_select" ON bid_plans;
CREATE POLICY "bid_plans_select" ON bid_plans
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));

DROP POLICY IF EXISTS "bid_invitations_select" ON bid_invitations;
CREATE POLICY "bid_invitations_select" ON bid_invitations
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR sub_email = (SELECT invite_email FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "bid_submissions_select" ON bid_submissions;
CREATE POLICY "bid_submissions_select" ON bid_submissions
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR sub_id = auth.uid()
  );

-- ── RETAINAGE_RELEASES ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "retainage_select" ON retainage_releases;
CREATE POLICY "retainage_select" ON retainage_releases
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR sub_id = auth.uid()
  );

-- ── MEETINGS (migration 003) ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "meetings_select" ON meetings;
DROP POLICY IF EXISTS "meetings_insert" ON meetings;
DROP POLICY IF EXISTS "meetings_delete" ON meetings;
CREATE POLICY "meetings_select" ON meetings
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));
CREATE POLICY "meetings_insert" ON meetings
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('pm', 'apm', 'super', 'admin'));
CREATE POLICY "meetings_delete" ON meetings
  FOR DELETE TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));
