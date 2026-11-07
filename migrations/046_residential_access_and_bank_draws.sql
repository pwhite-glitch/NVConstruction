-- Migration 046: residential table access (res_*) and owner/lender bank draws.
--
-- NOT APPLIED. Written only in this pass (prompt 50); apply in a later pass after review.
-- Does not depend on 042 (unapplied, untouched), 044 or 045 (written, not applied).
-- Applied live today: through 043_merge_companies.
--
-- Additive only: new nullable columns, a CHECK on new data, functions, a trigger, and
-- policy REPLACEMENTS. NO data is changed: no backfill of amount_funded (legacy funded
-- draws stay "amount unknown"), no copy of res_punch_list / job_docs rows, no UPDATE /
-- DELETE / INSERT of any existing row, no DROP TABLE / COLUMN, no edit of an old migration.
--
-- Verified live 2026-11-06 (read-only): res_inspections, res_lien_waivers, res_owner_draws
-- and res_punch_list each have ONE policy "auth_all" FOR ALL USING (true) WITH CHECK (true),
-- i.e. any signed-in user (sub, client owner, sales rep) can read/change every job's rows.
-- res_owner_draws columns: id, job_id, draw_number, title, period_start, period_end,
-- amount_requested, status, submitted_date, funded_date, notes, created_at.
--
-- PROPOSED NEW columns (none exist live today):
--   res_owner_draws.amount_funded   numeric NULL  cash actually received for a funded draw
--                                                 (NULL on legacy funded rows = unknown)
--   res_owner_draws.schedule_lines  jsonb   NULL  [{ budget_item_id, description,
--                                                 scheduled_value, this_period }] snapshot
--   res_owner_draws.attachments     jsonb   NULL  [{ path, name, uploaded_at, uploaded_by }]
-- PROPOSED status value: 'void' (kept on record instead of deleting a sent draw).
--
-- What it does:
--   1. public.res_job_office_access(job_id): Owner (principal) and admin on every job;
--      PM / APM only on jobs they are assigned to (pm_job_assignments) or listed as PM
--      (jobs.pm_email, any case). Reads role from profiles via get_my_role() and identity
--      from auth.uid() / the JWT email, never user_metadata or the browser.
--   2. Drops EVERY existing policy on the four res_* tables (including "auth_all") and
--      creates office-only ones, so nothing permissive is left beside them. RLS stays on.
--      res_owner_draws: SELECT only from the browser; writes go through
--      /api/res-owner-draws (service role, same job check).
--   3. New res_owner_draws columns + CHECKs (array JSON, funded >= 0, known statuses,
--      NOT VALID so the three existing rows are not re-checked).
--   4. Trigger: a draw that has left draft keeps its amount, lines, number and job; a
--      non-draft draw can't be deleted (void it).
--
-- Rollback (by hand, after review):
--   DROP TRIGGER IF EXISTS res_owner_draws_lock ON public.res_owner_draws;
--   DROP FUNCTION IF EXISTS public.res_owner_draws_lock();
--   ALTER TABLE public.res_owner_draws DROP CONSTRAINT IF EXISTS res_owner_draws_status_check,
--     DROP CONSTRAINT IF EXISTS res_owner_draws_schedule_lines_array,
--     DROP CONSTRAINT IF EXISTS res_owner_draws_attachments_array,
--     DROP CONSTRAINT IF EXISTS res_owner_draws_amount_funded_nonneg;
--   (new columns can stay; they are nullable and unused by older code)
--   For each res_* table: DROP the *_office_* policies and
--   CREATE POLICY "auth_all" ON public.<table> FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   DROP FUNCTION IF EXISTS public.res_job_office_access(text);

BEGIN;

-- ── 1. Job access helper ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.res_job_office_access(p_job_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_job_id IS NULL OR auth.uid() IS NULL THEN false
    WHEN public.get_my_role() IN ('principal', 'admin') THEN true
    WHEN public.get_my_role() IN ('pm', 'apm') THEN (
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

REVOKE EXECUTE ON FUNCTION public.res_job_office_access(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.res_job_office_access(text) TO authenticated, service_role;

-- ── 2. Replace every policy on the four res_* tables ─────────────────────────
DO $migration$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('res_inspections', 'res_lien_waivers', 'res_owner_draws', 'res_punch_list')
  LOOP
    RAISE NOTICE 'DROPPING public.% / %', pol.tablename, pol.policyname;
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END
$migration$;

ALTER TABLE public.res_inspections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.res_lien_waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.res_owner_draws  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.res_punch_list   ENABLE ROW LEVEL SECURITY;

-- Office read/write on their jobs (FOR ALL includes the SELECT an UPDATE needs).
CREATE POLICY "res_inspections_office_all" ON public.res_inspections FOR ALL TO authenticated
  USING (public.res_job_office_access(res_inspections.job_id::text))
  WITH CHECK (public.res_job_office_access(res_inspections.job_id::text));

CREATE POLICY "res_lien_waivers_office_all" ON public.res_lien_waivers FOR ALL TO authenticated
  USING (public.res_job_office_access(res_lien_waivers.job_id::text))
  WITH CHECK (public.res_job_office_access(res_lien_waivers.job_id::text));

-- Legacy table: zero rows live, no longer written by the app (punch_list_items is used).
CREATE POLICY "res_punch_list_office_all" ON public.res_punch_list FOR ALL TO authenticated
  USING (public.res_job_office_access(res_punch_list.job_id::text))
  WITH CHECK (public.res_job_office_access(res_punch_list.job_id::text));

-- Money: browser may only read; every write goes through /api/res-owner-draws.
CREATE POLICY "res_owner_draws_office_select" ON public.res_owner_draws FOR SELECT TO authenticated
  USING (public.res_job_office_access(res_owner_draws.job_id::text));

REVOKE ALL ON public.res_inspections, public.res_lien_waivers, public.res_owner_draws, public.res_punch_list FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.res_owner_draws FROM authenticated;

-- ── 3. Owner/lender draw columns (PROPOSED) ──────────────────────────────────
ALTER TABLE public.res_owner_draws ADD COLUMN IF NOT EXISTS amount_funded  numeric;
ALTER TABLE public.res_owner_draws ADD COLUMN IF NOT EXISTS schedule_lines jsonb;
ALTER TABLE public.res_owner_draws ADD COLUMN IF NOT EXISTS attachments    jsonb;

COMMENT ON COLUMN public.res_owner_draws.amount_funded  IS 'PROPOSED (046): cash actually received. NULL on a funded draw = unknown (legacy); never assumed to equal amount_requested.';
COMMENT ON COLUMN public.res_owner_draws.schedule_lines IS 'PROPOSED (046): Bank-line schedule snapshot [{budget_item_id, description, scheduled_value, this_period}], validated by /api/res-owner-draws.';
COMMENT ON COLUMN public.res_owner_draws.attachments    IS 'PROPOSED (046): files in job-documents under <job_id>/owner-draws/<draw_id>/ [{path, name, uploaded_at, uploaded_by}].';

ALTER TABLE public.res_owner_draws DROP CONSTRAINT IF EXISTS res_owner_draws_schedule_lines_array;
ALTER TABLE public.res_owner_draws ADD CONSTRAINT res_owner_draws_schedule_lines_array
  CHECK (schedule_lines IS NULL OR jsonb_typeof(schedule_lines) = 'array') NOT VALID;
ALTER TABLE public.res_owner_draws DROP CONSTRAINT IF EXISTS res_owner_draws_attachments_array;
ALTER TABLE public.res_owner_draws ADD CONSTRAINT res_owner_draws_attachments_array
  CHECK (attachments IS NULL OR jsonb_typeof(attachments) = 'array') NOT VALID;
ALTER TABLE public.res_owner_draws DROP CONSTRAINT IF EXISTS res_owner_draws_amount_funded_nonneg;
ALTER TABLE public.res_owner_draws ADD CONSTRAINT res_owner_draws_amount_funded_nonneg
  CHECK (amount_funded IS NULL OR amount_funded >= 0) NOT VALID;
-- Status list the app uses (draft/submitted/approved/funded) plus PROPOSED 'void'.
ALTER TABLE public.res_owner_draws DROP CONSTRAINT IF EXISTS res_owner_draws_status_check;
ALTER TABLE public.res_owner_draws ADD CONSTRAINT res_owner_draws_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'funded', 'void')) NOT VALID;

-- ── 4. A sent draw keeps its money ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.res_owner_draws_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'res_owner_draw_locked: only a draft draw can be deleted (void it instead)';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IS DISTINCT FROM 'draft' AND (
       NEW.amount_requested IS DISTINCT FROM OLD.amount_requested
    OR NEW.schedule_lines   IS DISTINCT FROM OLD.schedule_lines
    OR NEW.draw_number      IS DISTINCT FROM OLD.draw_number
    OR NEW.job_id           IS DISTINCT FROM OLD.job_id
  ) THEN
    RAISE EXCEPTION 'res_owner_draw_locked: a % draw keeps its amount, schedule and number', OLD.status;
  END IF;
  IF OLD.status = 'void' AND NEW.status IS DISTINCT FROM 'void' THEN
    RAISE EXCEPTION 'res_owner_draw_locked: a void draw stays void';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.res_owner_draws_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS res_owner_draws_lock ON public.res_owner_draws;
CREATE TRIGGER res_owner_draws_lock BEFORE UPDATE OR DELETE ON public.res_owner_draws
  FOR EACH ROW EXECUTE FUNCTION public.res_owner_draws_lock();

COMMIT;
