-- Migration 076: keep the revision history when a final daily report is reopened (prompt 86).
--
-- STATUS: PROPOSED — written, NOT applied. Apply only when Peyton names it.
-- REQUIRES 075 (status / finalized_at / reopened_at). The guard below aborts if 075 is missing.
-- Idempotent (IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE); one transaction.
--
-- Why: final reports reach the owner portal immediately and back up weather-day time
-- extensions and disputes. 075's reopen clears finalized_at / finalized_by (its CHECK
-- daily_reports_finalized_stamp requires that on drafts), a second reopen overwrites
-- reopened_at / reopened_by, and draft edits overwrite the fields in place. Nothing of the
-- earlier final version was kept. This migration keeps it.
--
-- What this adds:
--   public.daily_reports
--     first_finalized_at  timestamptz   set once (first finalize), never overwritten
--     first_finalized_by  uuid → profiles(id) ON DELETE SET NULL
--     revision_count      integer NOT NULL DEFAULT 0   +1 on each re-finalize after a reopen
--     revised_by_name     text          full_name of whoever re-finalized the latest revision
--   public.daily_report_versions        one snapshot (to_jsonb of the whole final row) per reopen
--   TRIGGER daily_reports_revision_guard (BEFORE INSERT OR UPDATE, plpgsql, SECURITY INVOKER):
--     • final → draft (reopen): inserts the snapshot IN THE SAME STATEMENT. If the insert fails
--       the reopen UPDATE fails too — a reopen without a snapshot is impossible.
--     • draft → final after a reopen: revision_count + 1, revised_by_name stamped.
--     • first_finalized_at immutable once set. first_finalized_by likewise, except value →
--       NULL alone (its FK's ON DELETE SET NULL); same rule for 075's reopened_by.
--     • Trigger-owned columns (first_finalized_*, revision_count, revised_by_name,
--       reopened_*) are reset on INSERT and server-derived on UPDATE — a browser draft
--       INSERT / UPDATE cannot forge them.
--     Only the service role can flip final ↔ draft (075's browser RLS forbids touching finals
--     or setting status final), and it bypasses RLS, so no SECURITY DEFINER is needed.
--   RLS on daily_report_versions: SELECT for principal / admin any job, pm on the job
--     (075's daily_report_draft_access). No write policies — only the trigger writes.
--   075's browser UPDATE / DELETE policies gain `AND reopened_at IS NULL`, so a once-final
--     report can never be edited or deleted from a browser (the app writes only via the API).
--
-- Backfill (rows with first_finalized_at IS NULL):
--   final                         → first_finalized_* = finalized_*
--   draft with reopened_at set    → first_finalized_at = reopened_at (best-known upper bound),
--                                   first_finalized_by = NULL
--   revision_count stays 0 (no history exists before 076).
--
-- DEPLOY ORDER — safe in EITHER order. Recommended: apply 076, then deploy the prompt 86 code.
--   • 076 first, old code (f36758a) still live: the trigger snapshots every reopen made by the
--     old reopen route, keeps first_finalized_*, counts revisions. The old code just doesn't
--     log to change_log or show labels. The tightened browser policies don't affect the app
--     (it writes through the API).
--   • Code first, before 076: Reopen returns 409 "needs migration 076" (no reopen without a
--     snapshot). Save draft / Finalize / PATCH work as today. Labels and links are hidden. The
--     versions route returns an empty list with migration_required '076'.
--
-- ROLLBACK (manual; not run by this file):
--   BEGIN;
--   DROP TRIGGER IF EXISTS daily_reports_revision_guard ON public.daily_reports;
--   DROP FUNCTION IF EXISTS public.daily_reports_revision_guard();
--   DROP TABLE IF EXISTS public.daily_report_versions;
--   ALTER TABLE public.daily_reports
--     DROP COLUMN IF EXISTS first_finalized_at, DROP COLUMN IF EXISTS first_finalized_by,
--     DROP COLUMN IF EXISTS revision_count,     DROP COLUMN IF EXISTS revised_by_name;
--   DROP POLICY IF EXISTS daily_reports_update_own_draft ON public.daily_reports;
--   CREATE POLICY daily_reports_update_own_draft ON public.daily_reports
--     FOR UPDATE TO authenticated
--     USING (status = 'draft' AND super_id = auth.uid())
--     WITH CHECK (status = 'draft' AND super_id = auth.uid() AND finalized_at IS NULL);
--   DROP POLICY IF EXISTS daily_reports_delete_own_draft ON public.daily_reports;
--   CREATE POLICY daily_reports_delete_own_draft ON public.daily_reports
--     FOR DELETE TO authenticated
--     USING (status = 'draft' AND super_id = auth.uid());
--   COMMIT;
--   (Rolling back loses the saved versions. Deploy code that tolerates a missing 076 first —
--    the prompt 86 code does.)

BEGIN;

-- ── 0. Guard: 075 must be applied ───────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_reports' AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'apply 075 first (public.daily_reports.status is missing)';
  END IF;
END
$guard$;

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS first_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_finalized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revised_by_name    text;

-- ── 2. Backfill ─────────────────────────────────────────────────────────────
-- Must be a plain update: on a re-run of this file the trigger from the first run exists and
-- would force first_finalized_* back to NULL on drafts, so drop it first (step 5 recreates
-- it in this same transaction).
DROP TRIGGER IF EXISTS daily_reports_revision_guard ON public.daily_reports;

UPDATE public.daily_reports
SET first_finalized_at = finalized_at,
    first_finalized_by = finalized_by
WHERE first_finalized_at IS NULL AND status = 'final';

-- A final report already reopened before 076: its original finalize stamp was LOST — 075's
-- reopen cleared finalized_at / finalized_by — which is why this migration exists. reopened_at
-- is the best-known upper bound for when it was first finalized; the finalizer is unknown.
UPDATE public.daily_reports
SET first_finalized_at = reopened_at,
    first_finalized_by = NULL
WHERE first_finalized_at IS NULL AND status = 'draft' AND reopened_at IS NOT NULL;

-- ── 3. Versions table ───────────────────────────────────────────────────────
-- daily_reports was created outside migrations; its id is a uuid (every route treats it so).
-- ON DELETE CASCADE so job deletes (delete_job_if_unprotected, migration 044) keep working.
-- Browser deletes of reopened reports are blocked in step 6.
CREATE TABLE IF NOT EXISTS public.daily_report_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_report_id  uuid NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  rev_number       integer NOT NULL,          -- the revision this snapshot WAS: 0 = original final
  snapshot         jsonb NOT NULL,            -- to_jsonb(OLD): every column incl. photos / logs
  finalized_at     timestamptz,
  finalized_by     uuid,
  reopened_at      timestamptz NOT NULL,
  reopened_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_report_versions_report_rev_key UNIQUE (daily_report_id, rev_number)
);

CREATE INDEX IF NOT EXISTS daily_report_versions_report_rev
  ON public.daily_report_versions (daily_report_id, rev_number DESC);

-- ── 4. RLS on versions (defense in depth; the app reads through the API) ────
ALTER TABLE public.daily_report_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_report_versions FROM anon, authenticated;
GRANT SELECT ON public.daily_report_versions TO authenticated;

DROP POLICY IF EXISTS daily_report_versions_office_select ON public.daily_report_versions;
CREATE POLICY daily_report_versions_office_select ON public.daily_report_versions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.daily_reports d
    WHERE d.id = daily_report_id
      AND public.daily_report_draft_access(d.job_id::text)
  ));
-- No INSERT / UPDATE / DELETE policy: rows are written only by the trigger (service role).

-- ── 5. Trigger ──────────────────────────────────────────────────────────────
-- SECURITY INVOKER (the default). Only the service role can flip final ↔ draft, and it
-- bypasses RLS, so the insert into daily_report_versions needs no definer rights.
CREATE OR REPLACE FUNCTION public.daily_reports_revision_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  is_reopen boolean;
  old_j jsonb;
  new_j jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Inserted directly as final (POST finalize:true): first finalize is now. A new row has
    -- no history, so nothing a client sends can pre-set the trigger-owned columns
    -- (a browser-inserted reopened_at would otherwise fake a re-finalize later).
    IF NEW.status = 'final' THEN
      NEW.first_finalized_at := NEW.finalized_at;
      NEW.first_finalized_by := NEW.finalized_by;
    ELSE
      NEW.first_finalized_at := NULL;
      NEW.first_finalized_by := NULL;
    END IF;
    NEW.revision_count := 0;
    NEW.revised_by_name := NULL;
    NEW.reopened_at := NULL;
    NEW.reopened_by := NULL;
    RETURN NEW;
  END IF;

  -- The trigger-owned columns on UPDATE: first_finalized_*, revision_count, revised_by_name,
  -- reopened_*. Whatever an UPDATE sends for them is replaced by OLD or by the values this
  -- function derives below, so a browser draft UPDATE cannot forge them.
  --
  -- One exception, for the FKs first_finalized_by (076) and reopened_by (075), both
  -- REFERENCES profiles ON DELETE SET NULL: deleting a profile makes Postgres run
  -- UPDATE ... SET <col> = NULL, which fires this trigger. Restoring the old id there would
  -- leave a dangling pointer or fail the profile delete. So <col> may go from a value to
  -- NULL, and only when nothing else in the row changes (updated_at ignored, in case another
  -- trigger touches it) — exactly the shape of the RI action. NULL → value is never allowed.
  is_reopen := OLD.status = 'final' AND NEW.status = 'draft';
  old_j := to_jsonb(OLD) - 'updated_at';
  new_j := to_jsonb(NEW) - 'updated_at';

  -- a) first_finalized_at: set once (first finalize), never changed or cleared after.
  IF OLD.first_finalized_at IS NOT NULL THEN
    NEW.first_finalized_at := OLD.first_finalized_at;
    IF NOT (OLD.first_finalized_by IS NOT NULL AND NEW.first_finalized_by IS NULL
            AND (new_j - 'first_finalized_by') = (old_j - 'first_finalized_by')) THEN
      NEW.first_finalized_by := OLD.first_finalized_by;
    END IF;
  ELSIF NEW.status = 'final' THEN
    NEW.first_finalized_at := NEW.finalized_at;
    NEW.first_finalized_by := NEW.finalized_by;
  ELSE
    NEW.first_finalized_at := NULL;
    NEW.first_finalized_by := NULL;
  END IF;

  -- Server-derived only; step (c) is the one place that changes them.
  NEW.revision_count := COALESCE(OLD.revision_count, 0);
  NEW.revised_by_name := OLD.revised_by_name;

  -- reopened_*: written only by a reopen (final → draft); kept as-is on every other UPDATE.
  IF is_reopen THEN
    NEW.reopened_at := COALESCE(NEW.reopened_at, now());
  ELSE
    NEW.reopened_at := OLD.reopened_at;
    IF NOT (OLD.reopened_by IS NOT NULL AND NEW.reopened_by IS NULL
            AND (new_j - 'reopened_by') = (old_j - 'reopened_by')) THEN
      NEW.reopened_by := OLD.reopened_by;
    END IF;
  END IF;

  -- b) Reopen: snapshot the final row in this same statement. No exception handler — any
  --    failure aborts the UPDATE, so a reopen without a snapshot cannot happen.
  IF is_reopen THEN
    INSERT INTO public.daily_report_versions
      (daily_report_id, rev_number, snapshot, finalized_at, finalized_by, reopened_at, reopened_by)
    VALUES
      (OLD.id, COALESCE(OLD.revision_count, 0), to_jsonb(OLD), OLD.finalized_at, OLD.finalized_by,
       NEW.reopened_at, NEW.reopened_by);
  END IF;

  -- c) Re-finalize after a reopen (only a reopen turns a final into a draft, so reopened_at
  --    set means it was final before).
  IF OLD.status = 'draft' AND NEW.status = 'final' AND OLD.reopened_at IS NOT NULL THEN
    NEW.revision_count := COALESCE(OLD.revision_count, 0) + 1;
    NEW.revised_by_name := (SELECT NULLIF(trim(full_name), '') FROM public.profiles WHERE id = NEW.finalized_by);
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.daily_reports_revision_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS daily_reports_revision_guard ON public.daily_reports;
CREATE TRIGGER daily_reports_revision_guard
  BEFORE INSERT OR UPDATE ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.daily_reports_revision_guard();

-- ── 6. Tighten 075's browser policies: a once-final report is never browser-editable ──
DROP POLICY IF EXISTS daily_reports_update_own_draft ON public.daily_reports;
CREATE POLICY daily_reports_update_own_draft ON public.daily_reports
  FOR UPDATE TO authenticated
  USING (status = 'draft' AND super_id = auth.uid() AND reopened_at IS NULL)
  WITH CHECK (status = 'draft' AND super_id = auth.uid() AND finalized_at IS NULL AND reopened_at IS NULL);

DROP POLICY IF EXISTS daily_reports_delete_own_draft ON public.daily_reports;
CREATE POLICY daily_reports_delete_own_draft ON public.daily_reports
  FOR DELETE TO authenticated
  USING (status = 'draft' AND super_id = auth.uid() AND reopened_at IS NULL);

COMMIT;
