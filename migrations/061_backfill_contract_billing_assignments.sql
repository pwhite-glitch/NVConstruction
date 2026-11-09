-- Migration 061: backfill job_assignments for subs that are on a job ONLY through a
-- non-draft subcontract (no assignment row), so the billing gate keeps today's behavior.
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Data-only. Does not edit any other migration. Idempotent (safe to run twice: the second
-- run finds the rows from the first and inserts nothing).
--
-- Why: lib/sub-access.js used to treat "no assignment rows" as billing ON for a sub who
-- sees a job only through a subcontract. Prompt 67A makes "no rows" mean billing OFF
-- (migration 026 rule: the PM turns billing on). The code grandfathers companies that
-- already billed on the job, so it is safe before this runs; this migration makes that
-- state explicit with real rows (billing_enabled TRUE = nobody who can bill today loses it).
--
-- What it inserts, for every subcontract with (status IS NULL OR status <> 'draft') on a
-- job where NO job_assignments row on that job matches the contract's company_id, or the
-- sub_id / lower(sub_email) of the contract's sub_id profile or of any profile with
-- company_id = the contract's company_id:
--   • subcontract.company_id not null → one company-level row
--       (job_id, company_id, sub_id NULL, sub_email NULL, billing_enabled true)
--   • subcontract.sub_id not null, that person has no row on the job, AND the person's
--     profile has NO company_id → one person row
--       (job_id, sub_id, sub_email = lower(trim(profile.invite_email)),
--        company_id NULL, billing_enabled true)
--     No person row when the profile HAS a company_id:
--       - same company as the contract → the company row above already covers them;
--       - a different company (Jake Paladino's case) → a person row would make the job
--         visible AND billable to every other person at his profile company (sub-access
--         counts any row whose sub_id is a company member). He keeps billing through the
--         grandfather rule instead (no rows of his own + an approved billing on the job).
--   All inserted rows are tagged: invited_at = '2026-11-09 00:00:00-06' (fixed literal),
--   billing_enabled_by NULL, billing_enabled_at now(). The rollback targets exactly that tag.
--
-- Expected as of Nov 9, 2026 (read-only check, ~9:45 AM CT) — 5 rows:
--   company rows (5):
--     #115   Cedar Heights Underground Utility — Solid Steam Utilities  (company 69dfbd58…)
--     #117   Module X Solutions                — Goldman Geotechnical    (company 849bcd5f…)
--     #121   SRS Distribution                  — Macedonio Hernandez     (company a4cb6341…)
--     #7551  Braum's Conway                    — Paladino-Nash Inc.      (company e089b80b…)
--     #R-101 NoLo Lot 2 Blk 4                  — On Time Plumbing LLC    (company 00f7213f…)
--   person rows (0):
--     #7551  Jake Paladino        (a1ab143a…) — NOT inserted: his profile company 194dac43…
--            differs from the contract company; he keeps billing via the grandfather rule.
--     #R-101 Leah Akutagawa-Fu    (b5df0a10…) — NOT inserted: her profile company is the
--            contract company, so the On Time Plumbing company row covers her.
--   Nothing for #R-101 Fernando Concrete (no company_id, no sub_id).
--   Run the preview below first; if it lists anything else, stop and ask Peyton.
--
-- Code that relates to it: lib/sub-access.js (billingOnFor / jobsWithPriorBilling /
-- ensureContractAssignment), app/api/company-job-access/route.js. The code works before
-- and after this is applied.
--
-- PREVIEW (read-only):
--   -- company_row = a company-level row will be inserted; person_row = a person row will be
--   -- inserted (sub_id set and the sub's profile has no company_id).
--   SELECT DISTINCT sc.job_id, j.job_number, sc.vendor_name, sc.company_id, sc.sub_id,
--          sp.company_id AS sub_profile_company_id,
--          (sc.company_id IS NOT NULL) AS company_row,
--          (sc.sub_id IS NOT NULL AND sp.id IS NOT NULL AND sp.company_id IS NULL) AS person_row
--   FROM public.subcontracts sc
--   JOIN public.jobs j ON j.id = sc.job_id
--   LEFT JOIN public.profiles sp ON sp.id = sc.sub_id
--   WHERE (sc.status IS NULL OR sc.status <> 'draft')
--     AND (sc.company_id IS NOT NULL OR sc.sub_id IS NOT NULL)
--     AND NOT EXISTS (
--       SELECT 1 FROM public.job_assignments ja
--       WHERE ja.job_id = sc.job_id
--         AND ( (sc.company_id IS NOT NULL AND ja.company_id = sc.company_id)
--            OR EXISTS (
--              SELECT 1 FROM public.profiles p
--              WHERE (p.id = sc.sub_id OR (sc.company_id IS NOT NULL AND p.company_id = sc.company_id))
--                AND (ja.sub_id = p.id
--                     OR (p.invite_email IS NOT NULL AND lower(ja.sub_email) = lower(trim(p.invite_email))))
--            ) )
--     )
--   ORDER BY j.job_number;
--
-- ROLLBACK (deletes only the rows this migration inserted):
--   DELETE FROM public.job_assignments
--   WHERE invited_at = '2026-11-09 00:00:00-06'::timestamptz
--     AND billing_enabled_by IS NULL;

WITH targets AS (
  SELECT DISTINCT sc.job_id, sc.company_id, sc.sub_id
  FROM public.subcontracts sc
  WHERE sc.job_id IS NOT NULL
    AND (sc.status IS NULL OR sc.status <> 'draft')
    AND (sc.company_id IS NOT NULL OR sc.sub_id IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.job_assignments ja
      WHERE ja.job_id = sc.job_id
        AND ( (sc.company_id IS NOT NULL AND ja.company_id = sc.company_id)
           OR EXISTS (
             SELECT 1 FROM public.profiles p
             WHERE (p.id = sc.sub_id OR (sc.company_id IS NOT NULL AND p.company_id = sc.company_id))
               AND (ja.sub_id = p.id
                    OR (p.invite_email IS NOT NULL AND lower(ja.sub_email) = lower(trim(p.invite_email))))
           ) )
    )
),
company_rows AS (
  INSERT INTO public.job_assignments
    (job_id, company_id, sub_id, sub_email, invited_at, billing_enabled, billing_enabled_at, billing_enabled_by)
  SELECT DISTINCT t.job_id, t.company_id, NULL::uuid, NULL::text,
         '2026-11-09 00:00:00-06'::timestamptz, true, now(), NULL::uuid
  FROM targets t
  WHERE t.company_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.job_assignments ja
      WHERE ja.job_id = t.job_id AND ja.company_id = t.company_id AND ja.sub_id IS NULL AND ja.sub_email IS NULL
    )
  ON CONFLICT DO NOTHING
  RETURNING id
)
INSERT INTO public.job_assignments
  (job_id, company_id, sub_id, sub_email, invited_at, billing_enabled, billing_enabled_at, billing_enabled_by)
SELECT DISTINCT ON (t.job_id, p.id)
       t.job_id, NULL::uuid, p.id, lower(trim(p.invite_email)),
       '2026-11-09 00:00:00-06'::timestamptz, true, now(), NULL::uuid
FROM targets t
JOIN public.profiles p ON p.id = t.sub_id
WHERE t.sub_id IS NOT NULL
  AND p.company_id IS NULL  -- only company-less subs; see header (Jake Paladino)
  AND NOT EXISTS (
    SELECT 1 FROM public.job_assignments ja
    WHERE ja.job_id = t.job_id
      AND (ja.sub_id = p.id
           OR (p.invite_email IS NOT NULL AND lower(ja.sub_email) = lower(trim(p.invite_email))))
  )
ON CONFLICT DO NOTHING;
