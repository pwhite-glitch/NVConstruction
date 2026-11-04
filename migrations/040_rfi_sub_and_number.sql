-- Migration 040: sub-submitted RFIs — sub_id, per-job number, uniqueness.
--
-- Problem: the sub portal inserted into rfis with a "question" column that
-- does not exist, so no sub RFI ever saved. Inserts now go through
-- /api/rfis (service role), which writes job_id, sub_id, title, description,
-- status and number. The CREATE TABLE for rfis is NOT in this repo, so it is
-- not known here whether sub_id and number exist, or whether anything stops
-- two RFIs on one job from getting the same number. /api/rfis computes
-- max(number) + 1 per job and retries on a unique violation (23505), which
-- only protects against races when the unique index below exists.
--
-- What this does (all idempotent; safe to re-run):
--   1. Adds rfis.sub_id (uuid → profiles.id, ON DELETE SET NULL) if missing.
--      Skipped entirely, FK included, if the column already exists.
--   2. Adds rfis.number (integer) if missing. Field / super RFIs still insert
--      without a number; NULLs are allowed and never collide.
--   3. Adds a unique index on rfis(job_id, number). Postgres treats NULLs as
--      distinct, so un-numbered RFIs are unaffected.
--   4. Index on rfis(sub_id) for the sub portal's "my RFIs" list.
--
-- Before applying, run this read-only check. If it returns rows, step 3 will
-- fail; renumber or null out the duplicates first:
--
--   SELECT job_id, number, count(*) FROM rfis
--   WHERE number IS NOT NULL GROUP BY job_id, number HAVING count(*) > 1;
--
-- No RLS changes: /api/rfis uses the service role for both read and write.

ALTER TABLE rfis ADD COLUMN IF NOT EXISTS sub_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE rfis ADD COLUMN IF NOT EXISTS number integer;

CREATE UNIQUE INDEX IF NOT EXISTS rfis_job_number_unique ON rfis(job_id, number);
CREATE INDEX IF NOT EXISTS rfis_sub_id ON rfis(sub_id);
