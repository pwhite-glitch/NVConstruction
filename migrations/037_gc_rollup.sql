-- Migration 037: roll General Conditions up into one line on the owner's pay app.
--
-- Some owners want every GC budget line (Project Manager, Car Expense, ...) shown
-- as a single "General Conditions" row on the G703. Internally the detail lines
-- stay as they are — the rollup only happens when the G702/G703 PDF is printed.
--
--   jobs.rollup_general_conditions  per-job switch (Job settings)
--   budget_items.roll_into_gc       which budget lines get combined (Budget tab)
--   aia_applications.rollup_gc      copied from the job when a pay app is created,
--                                   so old pay apps reprint exactly as sent
--
-- All default false, so existing jobs and pay apps are unchanged. The app works
-- before this is applied (saving the job retries without the new column).

alter table public.jobs
  add column if not exists rollup_general_conditions boolean not null default false;

alter table public.budget_items
  add column if not exists roll_into_gc boolean not null default false;

alter table public.aia_applications
  add column if not exists rollup_gc boolean not null default false;
