-- 057_rfi_number_backfill.sql — PROPOSED, NOT APPLIED.
--
-- Field / super RFIs used to be inserted from the browser with no number and no
-- status (see 040: "Field / super RFIs still insert without a number"). New
-- inserts now go through /api/rfis → insertNumberedRfi (next per-job number,
-- status 'open'), which works with or without this file. This one-time backfill
-- numbers the old rows so the office, field app and owner portal can refer to
-- them as "RFI #N".
--
--   1. Rows with number IS NULL get numbers after the job's current max, in
--      created_at order (id as tie-break). Existing numbers never change, so no
--      collision with rfis_job_number_unique (migration 040).
--   2. Rows with status IS NULL become 'open' (the sub API always set it; the
--      answer action only moves open → answered, so a NULL-status RFI could
--      never be answered).
--
-- Idempotent: a second run finds no NULL numbers / statuses.
-- Check before applying:
--   SELECT job_id, count(*) FROM rfis WHERE number IS NULL GROUP BY job_id;
--   SELECT count(*) FROM rfis WHERE status IS NULL;

BEGIN;

WITH base AS (
  SELECT job_id, COALESCE(MAX(number), 0) AS max_no
  FROM rfis
  GROUP BY job_id
),
todo AS (
  SELECT r.id,
         b.max_no + ROW_NUMBER() OVER (PARTITION BY r.job_id ORDER BY r.created_at, r.id) AS new_no
  FROM rfis r
  JOIN base b ON b.job_id = r.job_id
  WHERE r.number IS NULL
    AND r.job_id IS NOT NULL
)
UPDATE rfis r
SET number = todo.new_no
FROM todo
WHERE r.id = todo.id;

UPDATE rfis SET status = 'open' WHERE status IS NULL;

COMMIT;
