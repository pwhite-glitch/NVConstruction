-- Migration 026: subcontract drafts + separate "enable billing" from job assignment
--
-- 1. subcontracts.status can now be 'draft'. Drafts are hidden from the sub
--    portal, can't be billed or signed, and become 'active' via an explicit
--    Activate step in the PM portal. activated_at / activated_by record that step.
-- 2. job_assignments.billing_enabled lets a sub be assigned to a job (portal
--    access) without being able to submit billing. Existing rows are backfilled
--    to true so nobody who can bill today loses access. The column default stays
--    true for other insert paths (invites, sync_job_assignments); the job page
--    and dashboard "Assign" buttons now pass billing_enabled = false explicitly.

ALTER TABLE subcontracts
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_by uuid;

-- status is free text in the app today. If a CHECK constraint on status exists
-- and doesn't allow 'draft', stop here so it can be widened deliberately rather
-- than failing later on the first "Save as draft".
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.subcontracts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%draft%'
  LOOP
    RAISE EXCEPTION 'subcontracts constraint % (%) does not allow status = ''draft''. Widen it before running this migration.', r.conname, r.def;
  END LOOP;
END $$;

ALTER TABLE job_assignments
  ADD COLUMN IF NOT EXISTS billing_enabled    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS billing_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_enabled_by uuid;
