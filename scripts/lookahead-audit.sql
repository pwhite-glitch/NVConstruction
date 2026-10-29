-- 2-week lookahead audit. READ-ONLY: every statement is a SELECT.
-- Run in the Supabase SQL editor, one block at a time. Nothing here changes data.

-- 1. lookahead_activities column types and nullability. sub_id should be a nullable
--    uuid and manpower a nullable integer (the forms used to send '' for both).
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'lookahead_activities'
ORDER BY ordinal_position;

-- 2. Constraints on lookahead_activities (look for a CHECK or NOT NULL that needs a sub).
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.lookahead_activities'::regclass;

-- 3. Where a duplicate sub in the lookahead dropdown comes from.
--    3a: the same vendor has more than one subcontract on a job.
SELECT job_id, lower(trim(vendor_name)) AS vendor_key, count(*) AS n, array_agg(id) AS subcontract_ids, array_agg(status) AS statuses
FROM subcontracts
GROUP BY 1, 2 HAVING count(*) > 1;

--    3b: the subcontract_summary view (job page source) returns the same contract id twice.
SELECT job_id, id, vendor_name, count(*) AS n
FROM subcontract_summary
GROUP BY 1, 2, 3 HAVING count(*) > 1;

-- 4. Equipment rows with the "Eathwork" typo (fixed by migration 034).
SELECT id, name, category FROM company_equipment
WHERE name LIKE '%Eathwork%' OR category LIKE '%Eathwork%';
