-- Migration 007: Allow all members of a company to see jobs assigned to that company
--
-- Problem: the jobs_select RLS policy only grants access when job_assignments.sub_id = auth.uid()
-- This means only the specific person who was directly assigned can see the job.
-- Other members of the same company (same company_id in profiles) are blocked.
--
-- Fix: also grant access when:
--   a) any job_assignments row links this job to the user's company_id, OR
--   b) any subcontracts row links this job to the user's company_id

-- Drop the old narrow policy
DROP POLICY IF EXISTS "jobs_select" ON jobs;

-- Re-create with company-level visibility
CREATE POLICY "jobs_select" ON jobs
  FOR SELECT TO authenticated
  USING (
    -- PMs see all jobs
    get_my_role() IN ('pm', 'apm', 'super', 'admin')

    -- Direct user assignment (legacy / individual sub_id link)
    OR EXISTS (
      SELECT 1 FROM job_assignments
      WHERE job_assignments.job_id = jobs.id
        AND job_assignments.sub_id = auth.uid()
    )

    -- Company-level assignment: any member of the assigned company can see the job
    OR EXISTS (
      SELECT 1 FROM job_assignments ja
      JOIN profiles p ON p.company_id = ja.company_id
      WHERE ja.job_id = jobs.id
        AND ja.company_id IS NOT NULL
        AND p.id = auth.uid()
    )

    -- Company-level subcontract: any member of the subcontracted company can see the job
    OR EXISTS (
      SELECT 1 FROM subcontracts sc
      JOIN profiles p ON p.company_id = sc.company_id
      WHERE sc.job_id = jobs.id
        AND sc.company_id IS NOT NULL
        AND p.id = auth.uid()
    )
  );
