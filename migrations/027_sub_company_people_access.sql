-- Migration 027: multi-user subcontractor companies — per-person job access,
-- per-person billing permission, and company contacts without a portal login.
--
-- 1. profiles.job_access: which of the company's jobs a portal user sees.
--      'company'  → every job the company is on (default; matches what the
--                   sub portal already tries to do today)
--      'assigned' → only jobs where this person has their own job_assignments
--                   row (sub_id or sub_email matches them)
-- 2. profiles.can_bill: whether this person may submit billing at all. Billing
--    on a given job still has to be turned on for the company (job_assignments
--    .billing_enabled). Default true so nobody who can bill today loses it.
-- 3. company_contacts: people at a sub company who should be offered as email
--    recipients but may not have (or need) a portal login, e.g. field PMs.
--    Written only through the service role (/api/company-people).
-- 4. jobs_select RLS: migration 011 re-created this policy without the
--    company-wide clauses that 007 added, so a teammate who wasn't assigned by
--    name couldn't read the job row. Re-created here using a helper that also
--    honours profiles.job_access. The sub portal now loads its jobs through
--    /api/sub-portal (service role), so this mainly protects direct reads.
--
-- No existing rows are changed apart from the new columns getting their
-- defaults. Safe to re-run.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS job_access text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS can_bill   boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_job_access_check') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_job_access_check CHECK (job_access IN ('company', 'assigned'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS company_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name   text,
  email       text,
  phone       text,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS company_contacts_company_email_uniq
  ON company_contacts (company_id, lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE company_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_contacts_select" ON company_contacts;
CREATE POLICY "company_contacts_select" ON company_contacts
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));

-- True when the current user is a sub who may see this job.
-- SECURITY DEFINER so it can read job_assignments / subcontracts / profiles
-- without tripping their own RLS.
CREATE OR REPLACE FUNCTION public.sub_can_see_job(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT id, company_id, job_access, lower(coalesce(invite_email, '')) AS email
    FROM profiles WHERE id = auth.uid()
  )
  SELECT
    -- Assigned by name
    EXISTS (
      SELECT 1 FROM job_assignments ja, me
      WHERE ja.job_id = p_job_id
        AND (ja.sub_id = me.id OR (me.email <> '' AND lower(ja.sub_email) = me.email))
    )
    -- Company is on the job and this person sees all company jobs
    OR EXISTS (
      SELECT 1 FROM me
      WHERE me.company_id IS NOT NULL
        AND me.job_access = 'company'
        AND (
          EXISTS (
            SELECT 1 FROM job_assignments ja
            WHERE ja.job_id = p_job_id
              AND (ja.company_id = me.company_id
                   OR ja.sub_id IN (SELECT id FROM profiles WHERE company_id = me.company_id))
          )
          OR EXISTS (
            SELECT 1 FROM subcontracts sc
            WHERE sc.job_id = p_job_id
              AND sc.company_id = me.company_id
              AND (sc.status IS NULL OR sc.status <> 'draft')
          )
        )
    )
$$;

DROP POLICY IF EXISTS "jobs_select" ON jobs;
CREATE POLICY "jobs_select" ON jobs
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR public.sub_can_see_job(id)
  );
