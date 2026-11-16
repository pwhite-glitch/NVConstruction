-- Migration 075: daily report drafts until "Finalize – 100% complete" (prompt 85).
--
-- DEPLOY THE CODE BEFORE APPLYING 075.
--   The prompt 85 code works with or without 075. The code that is live today (127f32a and
--   earlier) does NOT: after 075, its inserts get DEFAULT 'draft' and silently become drafts,
--   and their deliveries are left unmarked. Order: deploy prompt 85 → confirm it is live →
--   apply 075. (Finalize also skips materials that already have a delivery for the report,
--   so a row written by old code in between is not double-counted.)
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. Does not touch job_photos or storage policies.
-- Idempotent where practical (IF NOT EXISTS / DROP ... IF EXISTS); the backfill only
-- touches rows whose status is still NULL.
--
-- Why: a daily report used to be official the moment it was inserted. Supers now save a
-- DRAFT and publish it with "Finalize – 100% complete". Peyton's decisions (11/16):
--   1. Drafts are visible to their author AND to Owner (principal) / admin / PM roles on the
--      job (PM = assigned via pm_job_assignments or jobs.pm_email). APMs and supers see only
--      their own drafts. Owner-portal clients and subs never see drafts. Drafts are excluded
--      from the owner portal, owner photos, weather-day counts and the weather-day log.
--   2. Owner / admin / PM can REOPEN a final report (status back to 'draft', reopened_at /
--      reopened_by recorded). Supers cannot reopen. On reopen finalized_at / finalized_by are
--      CLEARED (the CHECK below keeps draft rows free of finalize stamps); reopened_at /
--      reopened_by record that it had been final. Finalizing again stamps new values.
--   3. Office reports (job page) use the same Save draft / Finalize flow.
--
-- What this adds to public.daily_reports:
--   status                text NOT NULL DEFAULT 'draft', CHECK IN ('draft','final')
--   finalized_at          timestamptz   (set on finalize; NULL on drafts)
--   finalized_by          uuid → profiles(id) ON DELETE SET NULL (NULL allowed on finals:
--                         backfilled rows whose super_id was cleared by invite-team, or a
--                         finalizer whose profile was later deleted)
--   reopened_at / reopened_by   last reopen (Owner / admin / PM)
--   deliveries_created_at timestamptz   set the first time a finalize turned the report's
--                         materials into received deliveries (claim against racing finalizes).
--                         Backfilled for existing rows that logged materials.
-- And to public.deliveries:
--   daily_report_id       uuid (nullable, no FK — deliveries keep their history if a report
--                         goes away). Set on deliveries created from a report. Finalize (first
--                         time or after a reopen) inserts only materials with no delivery for
--                         that report yet: rows with this id, or legacy rows (id NULL, source
--                         'daily_report', same job, received_date = report_date).
--   updated_at            timestamptz   last draft edit / status change (server-written)
--   CHECK daily_reports_finalized_stamp: drafts have finalized_at / finalized_by NULL; finals
--         have finalized_at NOT NULL.
--   INDEX daily_reports_job_status_date (job_id, status, report_date DESC)
--
-- Backfill: EVERY existing row becomes 'final' (today's behavior preserved), finalized_at =
-- COALESCE(created_at, now()), finalized_by = super_id when that profile still exists.
--
-- RLS (replaces the wide-open "auth manage daily_reports" FOR ALL true/true and
-- "authenticated_read_daily_reports" FOR SELECT true — every existing policy on the table is
-- dropped so none can OR a draft back into view):
--   SELECT  status = 'final'                                  (unchanged for finals: any
--                                                              authenticated user, as today)
--           OR super_id = auth.uid()                          (author sees own drafts)
--           OR public.daily_report_draft_access(job_id)       (principal / admin; pm on job)
--   INSERT  super_id = auth.uid() AND status = 'draft' AND finalized_at IS NULL
--           (browsers may only create their own drafts; publishing goes through
--            POST /api/daily-reports or /api/daily-reports/finalize, which use the service
--            role and create deliveries exactly once)
--   UPDATE  USING status = 'draft' AND super_id = auth.uid()
--           WITH CHECK status = 'draft' AND super_id = auth.uid() AND finalized_at IS NULL
--           (a browser can never flip a report to final, edit a final, or hand it to someone
--            else; PM edits / finalize / reopen go through the API with the service role)
--   DELETE  status = 'draft' AND super_id = auth.uid()  (no UI deletes reports today)
-- The service role (all API routes) bypasses RLS; those routes filter drafts in code.
--
-- Code that uses it:
--   lib/daily-report-payload.js — isFinalReport / publishedReports / visibleReports /
--     canEditDraft / canReopenReport, draft flag on validate / build
--   app/api/daily-reports/route.js — POST (draft or final), PATCH (edit a draft)
--   app/api/daily-reports/finalize/route.js, app/api/daily-reports/reopen/route.js (new)
--   app/api/daily-reports/job-photos/route.js (new) — photo picker
--   app/field/page.js, app/jobdetail/DailyReportForm.js, app/jobdetail/JobPhotoPicker.js,
--   app/jobdetail/page.js, app/residentialjobdetail/page.js, app/api/owner-photos,
--   lib/owner-photos.js, lib/contract-time.js, app/api/delete-photo, app/api/photo-visibility
--
-- Before 075 is applied the code treats a missing status as FINAL; "Save draft" returns a
-- clear "needs migration 075" message and saves nothing; "Finalize" still publishes.
--
-- Rollback (by hand, after review):
--   DROP POLICY IF EXISTS daily_reports_select_final_or_allowed_drafts ON public.daily_reports;
--   DROP POLICY IF EXISTS daily_reports_insert_own_draft ON public.daily_reports;
--   DROP POLICY IF EXISTS daily_reports_update_own_draft ON public.daily_reports;
--   DROP POLICY IF EXISTS daily_reports_delete_own_draft ON public.daily_reports;
--   CREATE POLICY "auth manage daily_reports" ON public.daily_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   CREATE POLICY "authenticated_read_daily_reports" ON public.daily_reports FOR SELECT TO authenticated USING (true);
--   DROP FUNCTION IF EXISTS public.daily_report_draft_access(text);
--   DROP INDEX IF EXISTS public.daily_reports_job_status_date;
--   ALTER TABLE public.daily_reports DROP CONSTRAINT IF EXISTS daily_reports_finalized_stamp,
--     DROP CONSTRAINT IF EXISTS daily_reports_status_check;
--   -- Drafts written after 075 would become visible/official if the columns were dropped;
--   -- finalize or delete them first. Then (optional) DROP COLUMN status, finalized_at,
--   -- finalized_by, reopened_at, reopened_by, deliveries_created_at, updated_at.
--   DROP INDEX IF EXISTS public.deliveries_daily_report_id;
--   ALTER TABLE public.deliveries DROP COLUMN IF EXISTS daily_report_id;

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deliveries_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS daily_report_id uuid;
CREATE INDEX IF NOT EXISTS deliveries_daily_report_id
  ON public.deliveries (daily_report_id) WHERE daily_report_id IS NOT NULL;

-- ── 2. Backfill: every existing report is final (today's behavior) ───────────
UPDATE public.daily_reports d
SET status = 'final',
    finalized_at = COALESCE(d.created_at, now()),
    -- super_id may be NULL (invite-team clears it) or point at a deleted profile → NULL is ok.
    finalized_by = (SELECT p.id FROM public.profiles p WHERE p.id = d.super_id),
    -- Existing reports that logged materials already created their deliveries (old field
    -- insert / prompt 74 route); mark them so a later reopen + finalize never repeats them.
    -- (::jsonb so this works whether the column is json or jsonb; CASE order guarantees
    -- jsonb_array_length only runs on an array.)
    deliveries_created_at = CASE
      WHEN d.materials_delivered IS NULL THEN NULL
      WHEN jsonb_typeof(d.materials_delivered::jsonb) <> 'array' THEN NULL
      WHEN jsonb_array_length(d.materials_delivered::jsonb) > 0 THEN COALESCE(d.created_at, now())
      ELSE NULL
    END
WHERE d.status IS NULL;

-- ── 3. Default draft, NOT NULL, CHECKs, index ────────────────────────────────
ALTER TABLE public.daily_reports ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.daily_reports ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.daily_reports DROP CONSTRAINT IF EXISTS daily_reports_status_check;
ALTER TABLE public.daily_reports
  ADD CONSTRAINT daily_reports_status_check CHECK (status IN ('draft', 'final'));

ALTER TABLE public.daily_reports DROP CONSTRAINT IF EXISTS daily_reports_finalized_stamp;
ALTER TABLE public.daily_reports
  ADD CONSTRAINT daily_reports_finalized_stamp CHECK (
    (status = 'draft' AND finalized_at IS NULL AND finalized_by IS NULL)
    OR (status = 'final' AND finalized_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS daily_reports_job_status_date
  ON public.daily_reports (job_id, status, report_date DESC);

-- ── 4. Who may see other people's drafts on a job ───────────────────────────
-- principal / admin: any job. pm: jobs they are assigned to (pm_job_assignments) or listed
-- as PM (jobs.pm_email, any letter case). Everyone else (apm, super, owner clients, subs): no.
CREATE OR REPLACE FUNCTION public.daily_report_draft_access(p_job_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_job_id IS NULL OR auth.uid() IS NULL THEN false
    WHEN public.get_my_role() IN ('principal', 'admin') THEN true
    WHEN public.get_my_role() = 'pm' THEN (
      EXISTS (
        SELECT 1 FROM public.pm_job_assignments a
        WHERE a.job_id::text = p_job_id AND a.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id::text = p_job_id
          AND j.pm_email IS NOT NULL
          AND lower(trim(j.pm_email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
          AND coalesce(auth.jwt() ->> 'email', '') <> ''
      )
    )
    ELSE false
  END
$$;

REVOKE EXECUTE ON FUNCTION public.daily_report_draft_access(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.daily_report_draft_access(text) TO authenticated, service_role;

-- ── 5. RLS: drop every existing policy (incl. the two USING (true) ones) ─────
DO $migration$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'daily_reports'
  LOOP
    RAISE NOTICE 'DROPPING public.daily_reports / %', pol.policyname;
    EXECUTE format('DROP POLICY %I ON public.daily_reports', pol.policyname);
  END LOOP;
END
$migration$;

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

-- Finals: any authenticated user, exactly as before. Drafts: author, or Owner / admin / PM on the job.
CREATE POLICY daily_reports_select_final_or_allowed_drafts ON public.daily_reports
  FOR SELECT TO authenticated
  USING (
    status = 'final'
    OR super_id = auth.uid()
    OR public.daily_report_draft_access(job_id::text)
  );

-- Browsers may only create their own DRAFT (publishing is service-role only, via the API).
CREATE POLICY daily_reports_insert_own_draft ON public.daily_reports
  FOR INSERT TO authenticated
  WITH CHECK (super_id = auth.uid() AND status = 'draft' AND finalized_at IS NULL);

-- Browsers may only edit their own draft and it must stay their draft (no flip to final).
CREATE POLICY daily_reports_update_own_draft ON public.daily_reports
  FOR UPDATE TO authenticated
  USING (status = 'draft' AND super_id = auth.uid())
  WITH CHECK (status = 'draft' AND super_id = auth.uid() AND finalized_at IS NULL);

-- Only one's own draft can be deleted from a browser; finals are never browser-deletable.
CREATE POLICY daily_reports_delete_own_draft ON public.daily_reports
  FOR DELETE TO authenticated
  USING (status = 'draft' AND super_id = auth.uid());

COMMIT;
