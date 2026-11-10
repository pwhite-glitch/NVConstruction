-- Migration 065: estimate proposals — exclusions, clarifications, alternates, proposal date,
-- validity, revision; company default exclusions / clarifications.
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. No change to existing rows except the new column
-- defaults (valid_days 30, revision 0). Idempotent (safe to run twice).
--
-- Why (prompt 67D #10): the Cost Proposal PDF had no exclusions / clarifications /
-- alternates, printed created_at as the date, a fixed "Valid 30 days" note and no revision.
--
-- What this adds:
--   public.estimates
--     exclusions            text NULL   (one item per line)
--     clarifications        text NULL   (one item per line)
--     proposal_date         date NULL   (set to today, Central, on first export if empty)
--     valid_days            integer NOT NULL DEFAULT 30, CHECK 1..365
--     revision              integer NOT NULL DEFAULT 0  (bumped when an export's content changed)
--     proposal_exported_at  timestamptz NULL
--     proposal_export_hash  text NULL   (hash of the printed content at the last export)
--   public.estimate_alternates (add / deduct alternates; never in the base total)
--     RLS: ALL for profiles role pm / principal / apm (same rule as estimate_line_items)
--   public.estimate_proposal_defaults (single row, id = 1)
--     RLS: SELECT for pm / principal / apm; INSERT / UPDATE for principal / pm
--     Seeded with a starter exclusions list (ON CONFLICT DO NOTHING — never overwrites edits).
--
-- Code that uses it:
--   app/api/estimates/route.js (update: new fields + alternates replace-all)
--   app/api/estimates/export/route.js (new: revision / proposal date / export hash)
--   app/api/estimates/proposal-defaults/route.js (new: GET / PUT defaults)
--   app/api/estimates/to-job/route.js + lib/estimate-to-job.js (accepted alternates → budget)
--   lib/generate-estimate-pdf.js, app/components/estimating/EstimateWorkspace.js
-- Before 065: the update retries without the new fields (old fields still save, with a
-- warning); export returns the saved estimate unchanged (no revision, date = today);
-- convert ignores alternates; the defaults route answers 503 with a friendly message.

-- ── estimates columns ────────────────────────────────────────────────────────
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS exclusions           text;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS clarifications       text;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS proposal_date        date;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS valid_days           integer NOT NULL DEFAULT 30;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS revision             integer NOT NULL DEFAULT 0;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS proposal_exported_at timestamptz;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS proposal_export_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimates_valid_days_check') THEN
    ALTER TABLE public.estimates
      ADD CONSTRAINT estimates_valid_days_check CHECK (valid_days BETWEEN 1 AND 365);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimates_revision_check') THEN
    ALTER TABLE public.estimates
      ADD CONSTRAINT estimates_revision_check CHECK (revision >= 0);
  END IF;
END $$;

-- ── estimate_alternates ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.estimate_alternates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  description text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('add', 'deduct')),
  amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
  accepted    boolean NOT NULL DEFAULT false,
  sort_order  integer,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimate_alternates_estimate_id_idx ON public.estimate_alternates (estimate_id);

ALTER TABLE public.estimate_alternates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PM can manage estimate alternates" ON public.estimate_alternates;
CREATE POLICY "PM can manage estimate alternates" ON public.estimate_alternates
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('pm', 'principal', 'apm'))
  WITH CHECK (public.get_my_role() IN ('pm', 'principal', 'apm'));

-- ── estimate_proposal_defaults (one row) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.estimate_proposal_defaults (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_exclusions     text,
  default_clarifications text,
  updated_at             timestamptz,
  updated_by             uuid
);

ALTER TABLE public.estimate_proposal_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "proposal_defaults_select" ON public.estimate_proposal_defaults;
CREATE POLICY "proposal_defaults_select" ON public.estimate_proposal_defaults
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('pm', 'principal', 'apm'));
DROP POLICY IF EXISTS "proposal_defaults_insert" ON public.estimate_proposal_defaults;
CREATE POLICY "proposal_defaults_insert" ON public.estimate_proposal_defaults
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('principal', 'pm'));
DROP POLICY IF EXISTS "proposal_defaults_update" ON public.estimate_proposal_defaults;
CREATE POLICY "proposal_defaults_update" ON public.estimate_proposal_defaults
  FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('principal', 'pm'))
  WITH CHECK (public.get_my_role() IN ('principal', 'pm'));

-- Starter list (Peyton will edit). Never overwrites an existing row.
INSERT INTO public.estimate_proposal_defaults (id, default_exclusions, default_clarifications, updated_at)
VALUES (
  1,
  'Permits and plan review fees
Utility company fees, impact fees and tap fees
Testing and special inspections
Rock excavation and unsuitable soils
After-hours or weekend work
Owner-furnished equipment
Sales tax, unless shown',
  NULL,
  now()
)
ON CONFLICT (id) DO NOTHING;

-- ROLLBACK (run manually only if needed; alternates, defaults and proposal fields are lost):
-- DROP TABLE IF EXISTS public.estimate_proposal_defaults;
-- DROP TABLE IF EXISTS public.estimate_alternates;
-- ALTER TABLE public.estimates DROP CONSTRAINT IF EXISTS estimates_revision_check;
-- ALTER TABLE public.estimates DROP CONSTRAINT IF EXISTS estimates_valid_days_check;
-- ALTER TABLE public.estimates DROP COLUMN IF EXISTS proposal_export_hash;
-- ALTER TABLE public.estimates DROP COLUMN IF EXISTS proposal_exported_at;
-- ALTER TABLE public.estimates DROP COLUMN IF EXISTS revision;
-- ALTER TABLE public.estimates DROP COLUMN IF EXISTS valid_days;
-- ALTER TABLE public.estimates DROP COLUMN IF EXISTS proposal_date;
-- ALTER TABLE public.estimates DROP COLUMN IF EXISTS clarifications;
-- ALTER TABLE public.estimates DROP COLUMN IF EXISTS exclusions;
