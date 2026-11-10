-- Migration 064: inspection log for every job type (commercial + residential).
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. No data changes, no backfill. Idempotent (safe to
-- run twice).
--
-- Why (prompt 67D #9): the inspection tracker (public.res_inspections) only worked on
-- residential jobs. Commercial jobs now use the same table. The table name is kept.
-- RLS is unchanged: res_inspections_office_all (migration 046) uses
-- res_job_office_access(job_id::text), which checks role + PM assignment, not job_type,
-- so it already covers commercial jobs.
--
-- What this adds to public.res_inspections:
--   agency                text NULL   — inspecting agency (City, Fire Marshal, Health Dept…)
--   lookahead_activity_id uuid NULL   → lookahead_activities(id) ON DELETE SET NULL
--                                       (inspection logged from a lookahead activity)
--   index (job_id, scheduled_date), partial index (lookahead_activity_id)
--
-- Code that uses it:
--   lib/res-inspections.js (INSPECTION_SELECT / allow-list incl. agency, lookahead_activity_id)
--   app/api/res-inspections/route.js (same-job check on the activity; sets
--     lookahead_activities.inspection_scheduled when a linked inspection gets a date)
--   app/field/FieldInspections.js (Agency field), app/jobdetail/page.js (Inspections tab,
--     Lookahead "Log inspection" link)
-- Before 064: reads/writes naming the new columns fail with 42703 / PGRST204 and are retried
-- with the pre-064 column list; the Agency field and the lookahead link are hidden.
-- Commercial inspections themselves work before 064.

ALTER TABLE public.res_inspections ADD COLUMN IF NOT EXISTS agency text;
ALTER TABLE public.res_inspections ADD COLUMN IF NOT EXISTS lookahead_activity_id uuid
  REFERENCES public.lookahead_activities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS res_inspections_job_scheduled_idx
  ON public.res_inspections (job_id, scheduled_date);
CREATE INDEX IF NOT EXISTS res_inspections_lookahead_activity_idx
  ON public.res_inspections (lookahead_activity_id)
  WHERE lookahead_activity_id IS NOT NULL;

COMMENT ON TABLE public.res_inspections IS
  'Building / agency inspections for ALL job types (residential and commercial). Name kept from the residential module (migration 064).';

-- ROLLBACK (run manually only if needed; agency text and lookahead links are lost):
-- DROP INDEX IF EXISTS public.res_inspections_lookahead_activity_idx;
-- DROP INDEX IF EXISTS public.res_inspections_job_scheduled_idx;
-- ALTER TABLE public.res_inspections DROP COLUMN IF EXISTS lookahead_activity_id;
-- ALTER TABLE public.res_inspections DROP COLUMN IF EXISTS agency;
-- COMMENT ON TABLE public.res_inspections IS NULL;
