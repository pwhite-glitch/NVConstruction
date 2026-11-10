-- Migration 063: owner pay apps (AIA G702/G703) — materials stored on site, and the
-- schedule of values frozen when a prime pay app is submitted.
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration and does not redefine aia_dc_draw_apply (045).
-- No backfill: existing rows are not rewritten. Idempotent (safe to run twice).
--
-- Why (prompt 67C):
--   #5 There was no way to bill materials stored on site (G703 Column F), and the G703
--      column letters did not match the AIA form.
--   #7 Reprinting an old prime pay app rebuilt it from TODAY's budget and change orders.
--
-- What this adds
--   public.aia_application_lines
--     stored_this_period            numeric(15,2) NOT NULL DEFAULT 0, CHECK >= 0
--                                   new material stored on site / in a yard this period
--     stored_installed_this_period  numeric(15,2) NOT NULL DEFAULT 0, CHECK >= 0
--                                   previously stored material installed this period
--                                   (moves from Column F into Column E)
--     scheduled_value numeric, line_description text
--                                   ALREADY EXIST in the live database (added outside the
--                                   repo); ADD COLUMN IF NOT EXISTS only so the repo matches.
--   public.aia_applications
--     original_contract_sum  numeric(15,2)  G702 line 1 saved at submit
--     net_change_orders      numeric(15,2)  G702 line 2 saved at submit
--     schedule_frozen_at     timestamptz    set when a prime app leaves draft; cleared when
--                                           an Owner override moves it back to draft
--
-- NO BACKFILL of existing apps: the 31 locked legacy prime apps keep the live fallback
-- (schedule rebuilt from the current budget, with a printed note). Backfilling them from
-- today's budget would bake in values that may already have moved since they were sent.
-- Existing lines get 0 stored material from the column defaults, so their numbers do not change.
--
-- Code that uses it (all of it works before 063 is applied, with today's behavior):
--   lib/aia-g703.js              — G703 line math (C…I, F = stored, 5a / 5b retainage)
--   app/jobdetail/page.js        — G703 editor "Stored this period" / "Installed from stored"
--                                  inputs (hidden until 063), save, freeze at submit, PDF
--   lib/contract-cap.js          — total completed & stored includes F; frozen contract sum
--   lib/cash-outlook.js          — aiaCurrentPaymentDue (owner portal, cash outlook,
--                                  aia-payments, Ask AI) includes F; frozen Column C
--   app/api/aia-draw/route.js    — draw bound counts the stored balance
--
-- ROLLBACK:
--   ALTER TABLE public.aia_application_lines DROP CONSTRAINT IF EXISTS aia_application_lines_stored_this_period_nonneg;
--   ALTER TABLE public.aia_application_lines DROP CONSTRAINT IF EXISTS aia_application_lines_stored_installed_nonneg;
--   ALTER TABLE public.aia_application_lines DROP COLUMN IF EXISTS stored_installed_this_period;
--   ALTER TABLE public.aia_application_lines DROP COLUMN IF EXISTS stored_this_period;
--   ALTER TABLE public.aia_applications DROP COLUMN IF EXISTS schedule_frozen_at;
--   ALTER TABLE public.aia_applications DROP COLUMN IF EXISTS net_change_orders;
--   ALTER TABLE public.aia_applications DROP COLUMN IF EXISTS original_contract_sum;
--   (Leave scheduled_value / line_description: they existed before this migration.)

-- ── #5 stored materials (and repo consistency for two live columns) ──────────
ALTER TABLE public.aia_application_lines ADD COLUMN IF NOT EXISTS scheduled_value numeric;
ALTER TABLE public.aia_application_lines ADD COLUMN IF NOT EXISTS line_description text;
ALTER TABLE public.aia_application_lines ADD COLUMN IF NOT EXISTS stored_this_period numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE public.aia_application_lines ADD COLUMN IF NOT EXISTS stored_installed_this_period numeric(15,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aia_application_lines_stored_this_period_nonneg'
      AND conrelid = 'public.aia_application_lines'::regclass
  ) THEN
    ALTER TABLE public.aia_application_lines
      ADD CONSTRAINT aia_application_lines_stored_this_period_nonneg CHECK (stored_this_period >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aia_application_lines_stored_installed_nonneg'
      AND conrelid = 'public.aia_application_lines'::regclass
  ) THEN
    ALTER TABLE public.aia_application_lines
      ADD CONSTRAINT aia_application_lines_stored_installed_nonneg CHECK (stored_installed_this_period >= 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.aia_application_lines.stored_this_period IS 'G703: new material stored on site / in a yard this period (adds to Column F). Migration 063.';
COMMENT ON COLUMN public.aia_application_lines.stored_installed_this_period IS 'G703: previously stored material installed this period (moves from Column F to Column E; the page adds it to dollar_this_period). Migration 063.';

-- ── #7 prime schedule frozen at submit ───────────────────────────────────────
ALTER TABLE public.aia_applications ADD COLUMN IF NOT EXISTS original_contract_sum numeric(15,2);
ALTER TABLE public.aia_applications ADD COLUMN IF NOT EXISTS net_change_orders numeric(15,2);
ALTER TABLE public.aia_applications ADD COLUMN IF NOT EXISTS schedule_frozen_at timestamptz;

COMMENT ON COLUMN public.aia_applications.original_contract_sum IS 'G702 line 1 saved when the prime app left draft. NULL = legacy / draft (live fallback). Migration 063.';
COMMENT ON COLUMN public.aia_applications.net_change_orders IS 'G702 line 2 saved when the prime app left draft. Migration 063.';
COMMENT ON COLUMN public.aia_applications.schedule_frozen_at IS 'When the prime app''s schedule of values (lines'' scheduled_value, lines 1-2) was frozen. NULL = live budget. Migration 063.';
