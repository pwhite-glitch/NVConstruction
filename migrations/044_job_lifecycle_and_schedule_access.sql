-- Migration 044: job lifecycle (Owner-only delete) + schedule-files access.
--
-- NOT APPLIED. Write-only in this pass; apply in a later pass after review.
-- (042_drawings_aia_numbers_owner_draws.sql is still unapplied and is not
-- touched here. 043_merge_companies.sql is applied and is not touched here.)
--
-- No existing rows are changed and nothing is backfilled.
--
-- What it does:
--   1. delete_job_if_unprotected(p_job_id uuid) → jsonb. Used by
--      /api/jobs/delete (Owner-only; the route checks isPrincipal and calls this
--      with the service role). All-or-nothing in one transaction:
--        - locks the jobs row (FOR UPDATE)
--        - refuses ({ ok: false, reasons: [...] }) when the job has ANY
--          billing_submissions row (it never deletes billings), a closed
--          draw_request, a submitted / certified / paid aia_application, a
--          signed subcontract, a direct cost / PO / general-conditions entry on
--          a draw (or a direct cost marked nv_paid), or an owner reimbursement
--          invoice that has left draft
--        - otherwise deletes the job's job_assignments and pm_job_assignments
--          rows and then the jobs row, and returns { ok: true }.
--      Any other FK that blocks the delete raises, and the whole call rolls back.
--      Comparisons use job_id::text so they work whether a table's job_id is
--      uuid or text.
--   2. jobs: drops the office-wide jobs_office_delete policy. Nothing in the app
--      deletes jobs from the browser any more; deletes go through
--      /api/jobs/delete (service role, bypasses RLS).
--   3. job_schedule_files: drops the office-wide job_schedule_files_office_all
--      policy (RLS stays on, no policies) so only the service role
--      (/api/schedule-files, which runs the job check) can read or write it.
--   4. storage.objects: drops every policy that mentions the 'schedule-files'
--      bucket (they only check bucket_id), so browsers can't read, upload or
--      delete another job's schedule files directly. /api/schedule-files hands
--      out signed upload / read URLs instead. Policy names for this bucket are
--      not in the repo, so they are matched by their USING / WITH CHECK text.
--      A policy whose text also has IN ( / ANY ( / OR (it may cover other
--      buckets) is NOT dropped; a WARNING prints it for hand review.
--      If the migration role can't alter storage.objects (owned by
--      supabase_storage_admin), it prints a WARNING with the statement to run
--      as the table owner and carries on.
--
-- Rollback (run as one block):
--   DROP FUNCTION IF EXISTS public.delete_job_if_unprotected(uuid);
--   CREATE POLICY "jobs_office_delete" ON public.jobs FOR DELETE TO authenticated
--     USING (public.is_office_user());
--   CREATE POLICY "job_schedule_files_office_all" ON public.job_schedule_files FOR ALL TO authenticated
--     USING ((select public.is_office_user())) WITH CHECK ((select public.is_office_user()));
--   -- storage policies: re-create from the NOTICE lines this migration printed.

BEGIN;

-- ── 1. delete_job_if_unprotected ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_job_if_unprotected(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job text := p_job_id::text;
  v_reasons text[] := ARRAY[]::text[];
  n int;
BEGIN
  PERFORM 1 FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reasons', jsonb_build_array('Job not found.'));
  END IF;

  SELECT count(*) INTO n FROM public.billing_submissions b
   WHERE b.job_id::text = v_job
     AND (b.status = 'approved' OR b.draw_request_id IS NOT NULL OR b.paid_at IS NOT NULL OR coalesce(b.payment_amount, 0) > 0);
  IF n > 0 THEN v_reasons := v_reasons || format('%s sub billing(s) are approved, on a draw, or paid.', n); END IF;

  SELECT count(*) INTO n FROM public.billing_submissions b
   WHERE b.job_id::text = v_job
     AND NOT (b.status = 'approved' OR b.draw_request_id IS NOT NULL OR b.paid_at IS NOT NULL OR coalesce(b.payment_amount, 0) > 0);
  IF n > 0 THEN v_reasons := v_reasons || format('%s other sub billing(s) exist. Delete or reject them from the Billing tab first.', n); END IF;

  SELECT count(*) INTO n FROM public.draw_requests d WHERE d.job_id::text = v_job AND d.status = 'closed';
  IF n > 0 THEN v_reasons := v_reasons || format('%s draw request(s) are closed.', n); END IF;

  SELECT count(*) INTO n FROM public.aia_applications a
   WHERE a.job_id::text = v_job AND (a.status IN ('submitted', 'certified') OR coalesce(a.payment_received, false));
  IF n > 0 THEN v_reasons := v_reasons || format('%s owner pay app(s) are submitted, certified, or paid.', n); END IF;

  SELECT count(*) INTO n FROM public.subcontracts s
   WHERE s.job_id::text = v_job AND (s.signed_at IS NOT NULL OR s.status = 'signed');
  IF n > 0 THEN v_reasons := v_reasons || format('%s subcontract(s) are signed.', n); END IF;

  SELECT count(*) INTO n FROM public.direct_costs dc
   WHERE dc.job_id::text = v_job AND (dc.draw_request_id IS NOT NULL OR coalesce(dc.nv_paid, false));
  IF n > 0 THEN v_reasons := v_reasons || format('%s direct cost(s) are on a draw or paid.', n); END IF;

  SELECT count(*) INTO n FROM public.purchase_orders po WHERE po.job_id::text = v_job AND po.draw_request_id IS NOT NULL;
  IF n > 0 THEN v_reasons := v_reasons || format('%s purchase order(s) are on a draw.', n); END IF;

  SELECT count(*) INTO n FROM public.general_conditions gc WHERE gc.job_id::text = v_job AND gc.draw_request_id IS NOT NULL;
  IF n > 0 THEN v_reasons := v_reasons || format('%s general conditions entr(ies) are on a draw.', n); END IF;

  SELECT count(*) INTO n FROM public.owner_reimb_invoices oi WHERE oi.job_id::text = v_job AND oi.status <> 'draft';
  IF n > 0 THEN v_reasons := v_reasons || format('%s owner reimbursement invoice(s) have been issued.', n); END IF;

  IF array_length(v_reasons, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reasons', to_jsonb(v_reasons));
  END IF;

  DELETE FROM public.job_assignments    WHERE job_id::text = v_job;
  DELETE FROM public.pm_job_assignments WHERE job_id::text = v_job;
  DELETE FROM public.jobs WHERE id = p_job_id;

  RETURN jsonb_build_object('ok', true);
END
$$;

REVOKE EXECUTE ON FUNCTION public.delete_job_if_unprotected(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_job_if_unprotected(uuid) TO service_role;

-- ── 2. jobs: no browser deletes ──────────────────────────────────────────────
DROP POLICY IF EXISTS "jobs_office_delete" ON public.jobs;

-- ── 3. job_schedule_files: service role only ─────────────────────────────────
ALTER TABLE public.job_schedule_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_schedule_files_office_all" ON public.job_schedule_files;
DROP POLICY IF EXISTS "pm access" ON public.job_schedule_files;
REVOKE ALL ON public.job_schedule_files FROM anon;

-- ── 4. storage: no browser policies on the schedule-files bucket ─────────────
DO $migration$
DECLARE
  pol record;
  stmt text;
BEGIN
  FOR pol IN
    SELECT policyname, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (coalesce(qual, '') LIKE '%schedule-files%' OR coalesce(with_check, '') LIKE '%schedule-files%')
  LOOP
    stmt := format('DROP POLICY %I ON storage.objects', pol.policyname);
    -- A policy that also covers other buckets is left alone (dropping it would
    -- cut access to them); review and narrow it by hand.
    IF coalesce(pol.qual, '') ~* '(ANY \(|\mIN \(| OR )' OR coalesce(pol.with_check, '') ~* '(ANY \(|\mIN \(| OR )' THEN
      RAISE WARNING E'NOT DROPPED (covers more than schedule-files, narrow by hand): storage.objects / %\n  USING: %\n  CHECK: %',
        pol.policyname, pol.qual, pol.with_check;
      CONTINUE;
    END IF;
    RAISE NOTICE E'DROPPING storage.objects / % (%; roles %)\n  USING: %\n  CHECK: %',
      pol.policyname, pol.cmd, pol.roles, pol.qual, pol.with_check;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'NOT DROPPED (no privilege, run as the storage.objects owner): %', stmt;
    END;
  END LOOP;
END
$migration$;

COMMIT;
