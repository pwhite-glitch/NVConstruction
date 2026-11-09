-- Migration 069: commercial contract time — original completion date + owner CO days.
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. No data changes, no backfill, no index.
-- Idempotent (safe to run twice).
--
-- Why (prompt 71): commercial jobs had no contract completion date and owner (prime)
-- change orders had no days field, so the portal could not show
--   original completion + approved CO days = current completion, days left,
-- or flag jobs within 14 days of completion on the dashboard.
-- Weather-delay days (daily_reports.weather_delay, already present) are counted and
-- printed as a log only; they do NOT change the completion date and need no column.
--
-- What this adds:
--   public.jobs.contract_completion_date      date NULL (original contract completion)
--   public.prime_change_orders.days_added     integer NOT NULL DEFAULT 0
--                                             (time extension on an owner CO; negative =
--                                             reduction; only status = 'approved' counts)
--
-- Code that uses it:
--   lib/contract-time.js (new, pure) — approved days / current completion / days left / flag
--   lib/job-details.js commercialDetailsUpdate + app/api/jobs/details/route.js
--   app/api/prime-change-orders/review/route.js revise (separate days_added update)
--   app/jobdetail/page.js — Details "Contract completion", owner CO "Days added",
--     Overview "Contract time" card + weather-day log print (lib/weather-day-log-print.js)
--   app/dashboard/page.js — commercial Jobs "Due in N days" / "N days overdue" badge
--   lib/change-log.js — CLIENT_LOG_FIELDS (contract_completion_date, prime_change_order.days_added)
-- Before 069: writes carrying either column fail with a schema-cache / undefined-column
-- error and are retried once without it (lib/missing-column-retry.js); the user is told
-- the value needs migration 069. Reads use select('*'), so the columns are simply absent
-- (treated as null / 0): no completion math, no dashboard flag, every CO counts 0 days.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS contract_completion_date date;

ALTER TABLE public.prime_change_orders
  ADD COLUMN IF NOT EXISTS days_added integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.jobs.contract_completion_date IS
  'Original contract substantial-completion date (commercial). Current completion = this + sum(days_added) of approved prime COs.';
COMMENT ON COLUMN public.prime_change_orders.days_added IS
  'Calendar days of contract time this owner CO adds (negative = reduction). Counted only when status = approved.';

-- ROLLBACK (run manually only if needed; entered dates / CO days are lost):
-- ALTER TABLE public.prime_change_orders DROP COLUMN IF EXISTS days_added;
-- ALTER TABLE public.jobs DROP COLUMN IF EXISTS contract_completion_date;
