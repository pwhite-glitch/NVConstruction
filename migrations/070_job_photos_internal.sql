-- Migration 070: internal-only job photos (hide a gallery photo from the owner portal).
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. No data changes, no backfill, no index, no
-- storage policy changes. Idempotent (safe to run twice). Independent of 066 / 068.
--
-- Why (prompt 73): every job_photos row and every daily_reports.photos[] entry was
-- signed and shown to the client owner by GET /api/owner-photos. There was no way to
-- keep a field shot internal.
--
-- What this adds:
--   public.job_photos.internal_only   boolean NOT NULL DEFAULT false
--     true = excluded from the owner portal Photos list (and never signed for it);
--     staff galleries (field, commercial, residential job pages) still show it with
--     an "Internal" badge. Existing rows become false (visible) via the DEFAULT.
--   Daily-report photos store the flag on the jsonb element
--   (daily_reports.photos[].internal_only) and need NO migration.
--
-- Code that uses it:
--   lib/photo-visibility.js (new) — isInternalPhoto / filterOwnerVisible / paging /
--     insertJobPhotoWithFallbacks / setReportPhotoInternal
--   lib/owner-photos.js ownerPhotoList — drops internal photos
--   app/api/owner-photos/route.js — select('*'), filter, page (limit/offset/total/has_more)
--   app/api/photo-visibility/route.js (new) — Hide from owner / Show to owner toggle
--   app/field/page.js — "Internal only" switch on gallery upload + daily-report photos
--   app/jobdetail/page.js, app/residentialjobdetail/page.js — badge + Hide/Show toggle
--     (residential also has the upload switch)
-- Before 070:
--   • gallery upload with Internal only ON → refused: no row inserted, the uploaded
--     file + thumb are removed, the user is told it needs migration 070;
--   • gallery upload with Internal only OFF → inserted without the column (visible);
--   • Hide/Show on a gallery photo → 503 { migration_required: '070' }, nothing changed;
--   • owner-photos reads select('*'), so the column is simply absent (every gallery row
--     visible); daily-report internal_only, filtering and paging work before 070.

ALTER TABLE public.job_photos
  ADD COLUMN IF NOT EXISTS internal_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.job_photos.internal_only IS
  'When true, exclude from owner portal Photos (staff galleries still show it).';

-- ROLLBACK (manual; run only if Peyton asks to undo 070):
--   ALTER TABLE public.job_photos DROP COLUMN IF EXISTS internal_only;
