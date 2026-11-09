-- Migration 066: optional GPS (from photo EXIF) on job_photos.
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. No data changes, no backfill. Idempotent (safe to run twice).
--
-- Why (prompt 68): new field-gallery and residential photo uploads now read the capture
-- time from the ORIGINAL file's EXIF before the canvas re-encode strips it. When the EXIF
-- also carries GPSLatitude/GPSLongitude, the upload can keep it here.
--
-- What this adds to public.job_photos:
--   latitude  double precision NULL  — signed decimal degrees (S negative), from EXIF
--   longitude double precision NULL  — signed decimal degrees (W negative), from EXIF
-- Existing rows (and photos without GPS) stay NULL. No index.
--
-- NOT added: uploaded_at (created_at already is the upload time, DB default now()) and
-- tag (out of scope for this package).
--
-- Code that uses it:
--   lib/photo-taken-at.js resolveTakenAt / photoRowFields / insertJobPhoto
--   app/field/page.js uploadGalleryPhoto, app/residentialjobdetail/page.js uploadPhoto
-- Before 066: an insert carrying latitude/longitude fails with an undefined-column /
-- schema-cache error and is retried once without them (taken_at is kept). taken_at and
-- the Central-date display/grouping need NO migration; only GPS storage waits on 066.

ALTER TABLE public.job_photos ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.job_photos ADD COLUMN IF NOT EXISTS longitude double precision;

-- ROLLBACK (run manually only if needed; GPS values are lost):
-- ALTER TABLE public.job_photos DROP COLUMN IF EXISTS latitude;
-- ALTER TABLE public.job_photos DROP COLUMN IF EXISTS longitude;
