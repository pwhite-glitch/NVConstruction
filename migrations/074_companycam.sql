-- Migration 074: CompanyCam photos auto-upload into portal job Photos (prompt 82).
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. No data changes, no backfill. Idempotent (safe to
-- run twice). 072 / 073 are reserved by other unmerged branches and are not used here.
--
-- Why: a photo taken in CompanyCam on a project linked to a portal job should land in that
-- job's Photos (job_photos gallery) automatically, internal-only, with who took it, when,
-- its caption and tags. Photos from projects not linked to a job wait in an Owner-only
-- "Unmatched CompanyCam photos" inbox until an Owner assigns them.
--
-- What this adds:
--   a) public.jobs.companycam_project_id  text NULL, partial UNIQUE (one CompanyCam
--      project ↔ one job). One column covers commercial and residential jobs (same table).
--      public.jobs.companycam_import_state  jsonb NULL (Addendum A): the resumable one-time
--      import — { start_date, end_date, cursor, imported, skipped, failed,
--      status: 'running'|'paused'|'done', updated_at, updated_by }. Server-written only.
--   b) public.job_photos.companycam_photo_id / companycam_creator_name / companycam_tags,
--      partial UNIQUE on companycam_photo_id (a CompanyCam photo is imported at most once;
--      a parallel webhook delivery hits 23505 and is treated as a duplicate).
--   c) public.job_photos.internal_only boolean NOT NULL DEFAULT false — the SAME definition
--      as migration 070. CompanyCam photos are always written internal_only = true and must
--      never land owner-visible, so 074 alone is enough; 070 stays as-is and becomes a
--      no-op (ADD COLUMN IF NOT EXISTS) if applied later.
--   d) public.companycam_photo_inbox — unmatched / failed CompanyCam photos (server only:
--      RLS on, no policies, anon/authenticated revoked).
--   e) Guard triggers: only the service role (the API routes) may set or change
--      jobs.companycam_project_id / companycam_import_state and job_photos.companycam_* — browsers update jobs
--      directly in places and supers can insert job_photos under RLS, so without the guard
--      someone could relink a job or squat a CompanyCam photo id and block its import.
--
-- Code that uses it:
--   lib/companycam.js (new) — signature check, API client, normalize, import, inbox
--   app/api/companycam/webhook/route.js (new) — CompanyCam photo.created receiver
--   app/api/companycam/link/route.js (new) — link / unlink a job to a CompanyCam project
--   app/api/companycam/import/route.js (new) — one-time import of a project's photos
--   app/api/companycam/unmatched/route.js (new) — Owner inbox (list / assign / dismiss)
--   app/api/companycam/register-webhook/route.js (new) — Owner registers the webhook
--   app/api/job-save/route.js — strips companycam_project_id from the generic save
--   app/components/CompanyCamLinkBar.js, app/companycam/page.js (new);
--   app/jobdetail/page.js, app/residentialjobdetail/page.js — Photos tab bar + labels
--
-- Before 074:
--   • webhook → 200 { status: 'skipped' } and nothing is written (a 5xx would burn
--     CompanyCam's 25-error budget and disable the webhook);
--   • link / assign → 503 { migration_required: '074' }; import → 409 "Apply migration 074
--     first" { migration_required: '074' }; nothing written;
--   • unmatched list → 200 { rows: [], migration_required: '074' };
--   • Photos tabs and job-save keep working; the CompanyCam bar is hidden for everyone
--     except the Owner, who sees "Needs database migration 074".

BEGIN;

-- ── a) jobs.companycam_project_id ────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS companycam_project_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_companycam_project_id_key
  ON public.jobs (companycam_project_id)
  WHERE companycam_project_id IS NOT NULL;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS companycam_import_state jsonb NULL;

COMMENT ON COLUMN public.jobs.companycam_import_state IS
  'Resumable CompanyCam one-time import (074): range, cursor, counts, status. Written only by /api/companycam/import and /api/companycam/link (service role).';

COMMENT ON COLUMN public.jobs.companycam_project_id IS
  'CompanyCam project id linked to this job (074). Set only by /api/companycam/link (service role).';

-- ── b) job_photos CompanyCam columns ─────────────────────────────────────────
ALTER TABLE public.job_photos
  ADD COLUMN IF NOT EXISTS companycam_photo_id     text   NULL,
  ADD COLUMN IF NOT EXISTS companycam_creator_name text   NULL,
  ADD COLUMN IF NOT EXISTS companycam_tags         text[] NULL;

CREATE UNIQUE INDEX IF NOT EXISTS job_photos_companycam_photo_id_key
  ON public.job_photos (companycam_photo_id)
  WHERE companycam_photo_id IS NOT NULL;

-- ── c) job_photos.internal_only (same definition as 070) ─────────────────────
ALTER TABLE public.job_photos
  ADD COLUMN IF NOT EXISTS internal_only boolean NOT NULL DEFAULT false;

-- ── d) companycam_photo_inbox ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companycam_photo_inbox (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  companycam_photo_id   text        NOT NULL UNIQUE,
  companycam_project_id text,
  project_name          text,
  creator_name          text,
  captured_at           timestamptz,
  caption               text,
  thumbnail_url         text,
  status                text        NOT NULL DEFAULT 'unmatched'
                                    CHECK (status IN ('unmatched', 'failed', 'imported', 'dismissed')),
  last_error            text,
  attempts              integer     NOT NULL DEFAULT 0,
  job_id                uuid        REFERENCES public.jobs(id) ON DELETE SET NULL,
  job_photo_id          uuid        REFERENCES public.job_photos(id) ON DELETE SET NULL,
  resolved_by           uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS companycam_photo_inbox_status_idx
  ON public.companycam_photo_inbox (status, created_at DESC);
CREATE INDEX IF NOT EXISTS companycam_photo_inbox_project_idx
  ON public.companycam_photo_inbox (companycam_project_id);

ALTER TABLE public.companycam_photo_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.companycam_photo_inbox FROM anon, authenticated;
-- Intentionally no CREATE POLICY: with RLS on and no policy, browser (anon/authenticated)
-- clients get zero rows even if a grant is added later by mistake. Server / service role only.

COMMENT ON TABLE public.companycam_photo_inbox IS
  'PROPOSED (074): CompanyCam photos not yet in a job gallery (unlinked project or failed import). Written only by /api/companycam/* (service role).';

-- ── e) Guards: CompanyCam columns are server-only ────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_jobs_companycam_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.companycam_project_id IS NOT NULL OR NEW.companycam_import_state IS NOT NULL THEN
      RAISE EXCEPTION 'companycam_server_only: link CompanyCam projects from the job Photos tab'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.companycam_project_id IS DISTINCT FROM OLD.companycam_project_id
     OR NEW.companycam_import_state IS DISTINCT FROM OLD.companycam_import_state THEN
    RAISE EXCEPTION 'companycam_server_only: link CompanyCam projects from the job Photos tab'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.guard_jobs_companycam_project() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS jobs_companycam_project_guard ON public.jobs;
CREATE TRIGGER jobs_companycam_project_guard
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_jobs_companycam_project();

CREATE OR REPLACE FUNCTION public.guard_job_photos_companycam()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.companycam_photo_id IS NOT NULL
       OR NEW.companycam_creator_name IS NOT NULL
       OR NEW.companycam_tags IS NOT NULL THEN
      RAISE EXCEPTION 'companycam_server_only: CompanyCam photos are imported by the server'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.companycam_photo_id IS DISTINCT FROM OLD.companycam_photo_id
     OR NEW.companycam_creator_name IS DISTINCT FROM OLD.companycam_creator_name
     OR NEW.companycam_tags IS DISTINCT FROM OLD.companycam_tags THEN
    RAISE EXCEPTION 'companycam_server_only: CompanyCam photos are imported by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.guard_job_photos_companycam() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS job_photos_companycam_guard ON public.job_photos;
CREATE TRIGGER job_photos_companycam_guard
  BEFORE INSERT OR UPDATE ON public.job_photos
  FOR EACH ROW EXECUTE FUNCTION public.guard_job_photos_companycam();

COMMIT;

-- ROLLBACK (manual; run only if Peyton asks to undo 074):
--   DROP TRIGGER IF EXISTS job_photos_companycam_guard ON public.job_photos;
--   DROP FUNCTION IF EXISTS public.guard_job_photos_companycam();
--   DROP TRIGGER IF EXISTS jobs_companycam_project_guard ON public.jobs;
--   DROP FUNCTION IF EXISTS public.guard_jobs_companycam_project();
--   DROP TABLE IF EXISTS public.companycam_photo_inbox;
--   DROP INDEX IF EXISTS public.job_photos_companycam_photo_id_key;
--   DROP INDEX IF EXISTS public.jobs_companycam_project_id_key;
--   ALTER TABLE public.job_photos DROP COLUMN IF EXISTS companycam_tags,
--                                 DROP COLUMN IF EXISTS companycam_creator_name,
--                                 DROP COLUMN IF EXISTS companycam_photo_id;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS companycam_import_state,
--                           DROP COLUMN IF EXISTS companycam_project_id;
--   NOT internal_only: it belongs to 070 too. Drop it only if 070 is also being undone:
--   ALTER TABLE public.job_photos DROP COLUMN IF EXISTS internal_only;
