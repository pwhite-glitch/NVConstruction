-- Migration 078: daily report delete goes through the logged API only; final reports are
-- readable only on jobs the reader is staff-assigned to (prompt 91).
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton names it ("apply 078").
-- REQUIRES migration 075 (daily report drafts) to be applied first; this file stops with an
-- error, changing nothing, if 075's status column or daily_report_draft_access() is missing.
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS before every CREATE POLICY.
-- No app code depends on 078: every daily report write / delete and every owner-portal read
-- already goes through API routes using the service role (bypasses RLS), and the job pages /
-- field app only read daily_reports for jobs their user is on.
--
-- Why (Peyton 11/18: Delete button for daily reports — PM / Owner / Supers; supers only reports
-- they wrote; delete permanently, no recovery):
--   (a) DELETE /api/daily-reports writes the full row to change_log BEFORE deleting, unlinks
--       deliveries and removes report-only photo files. 075's daily_reports_delete_own_draft
--       let a browser delete its own draft directly, skipping all of that. 078 drops it, so
--       with RLS on and no DELETE policy, browsers cannot delete daily_reports at all.
--   (b) 075 kept FINAL reports readable by every authenticated user (any job, any role —
--       including owner-portal clients and subs through the browser client). 078 limits
--       finals to staff on the job:
--         principal / admin → every job
--         pm / apm / super  → jobs they are assigned to (pm_job_assignments) or listed as PM
--                             (jobs.pm_email, any letter case) — the same rule as the API's
--                             denyUnlessOnJob (lib/roles.js) and change_log_job_access (055)
--         anyone else       → none (owner clients read only through the owner API, which
--                             uses the service role; subs never read daily_reports)
--       Drafts keep 075's rules exactly: the author (super_id = auth.uid()), or
--       daily_report_draft_access(job_id) (principal / admin; pm on the job).
--   INSERT / UPDATE policies from 075 (own draft only) are unchanged.
--
-- Rows NOT affected: daily_report_versions (076) has its own policies and rows cascade with
-- the report (ON DELETE CASCADE); deliveries are kept by the API (daily_report_id cleared).
--
-- ROLLBACK (by hand, after review) — restores exactly 075's SELECT and DELETE policies:
--   BEGIN;
--   DROP POLICY IF EXISTS daily_reports_select_staff_final_or_allowed_drafts ON public.daily_reports;
--   DROP POLICY IF EXISTS daily_reports_select_final_or_allowed_drafts ON public.daily_reports;
--   CREATE POLICY daily_reports_select_final_or_allowed_drafts ON public.daily_reports
--     FOR SELECT TO authenticated
--     USING (status = 'final' OR super_id = auth.uid() OR public.daily_report_draft_access(job_id::text));
--   DROP POLICY IF EXISTS daily_reports_delete_own_draft ON public.daily_reports;
--   CREATE POLICY daily_reports_delete_own_draft ON public.daily_reports
--     FOR DELETE TO authenticated
--     USING (status = 'draft' AND super_id = auth.uid());
--   DROP FUNCTION IF EXISTS public.daily_report_staff_job_access(text);
--   COMMIT;

BEGIN;

-- ── 0. Precondition: 075 is applied ─────────────────────────────────────────
DO $precheck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_reports' AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION '078 needs migration 075 (daily_reports.status) — apply 075 first. Nothing was changed.';
  END IF;
  IF to_regprocedure('public.daily_report_draft_access(text)') IS NULL THEN
    RAISE EXCEPTION '078 needs migration 075 (public.daily_report_draft_access) — apply 075 first. Nothing was changed.';
  END IF;
END
$precheck$;

-- ── 1. Staff job access for FINAL reports ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.daily_report_staff_job_access(p_job_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.get_my_role() IN ('principal', 'admin') THEN true
    WHEN p_job_id IS NULL THEN false
    WHEN public.get_my_role() IN ('pm', 'apm', 'super') THEN (
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
    ELSE false
  END
$$;

REVOKE EXECUTE ON FUNCTION public.daily_report_staff_job_access(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.daily_report_staff_job_access(text) TO authenticated, service_role;

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

-- ── 2. (a) No browser deletes: every delete goes through DELETE /api/daily-reports ──
DROP POLICY IF EXISTS daily_reports_delete_own_draft ON public.daily_reports;

-- ── 3. (b) SELECT: finals only for staff on the job; drafts exactly as 075 ──────
DROP POLICY IF EXISTS daily_reports_select_final_or_allowed_drafts ON public.daily_reports;
DROP POLICY IF EXISTS daily_reports_select_staff_final_or_allowed_drafts ON public.daily_reports;
CREATE POLICY daily_reports_select_staff_final_or_allowed_drafts ON public.daily_reports
  FOR SELECT TO authenticated
  USING (
    (status = 'final' AND public.daily_report_staff_job_access(job_id::text))
    OR (status = 'draft' AND (super_id = auth.uid() OR public.daily_report_draft_access(job_id::text)))
  );

COMMIT;
