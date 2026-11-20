-- Prompt 96: subcontract generator fills itself from the job and remembers what was typed.
--   jobs.owner_address            Owner address, edited in Job Details; prefills the generator.
--   subcontracts.generator_fields Generator form fields saved per subcontract (jsonb; text keys
--                                 only, see lib/subcontract-generator.js GENERATOR_FIELD_KEYS).
--                                 Never holds contract value, numbering, status or signing fields.
--
-- No RLS changes: the existing jobs and subcontracts policies are row-level and cover
-- these new columns. Writes go through POST /api/jobs/details and PUT /api/subcontracts
-- (service role, role + job access checked there).
--
-- The app works before this is applied: the routes drop the missing column and carry on,
-- and the job page reads saved fields without it.

BEGIN;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS owner_address text;
ALTER TABLE public.subcontracts ADD COLUMN IF NOT EXISTS generator_fields jsonb;
COMMIT;
