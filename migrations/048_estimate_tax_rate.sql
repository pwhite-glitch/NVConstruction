-- Migration 048: per-estimate sales tax rate.
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after review.
--
-- What this does (additive only; safe to re-run):
--   Adds estimates.tax_rate numeric(6,4), in PERCENTAGE POINTS
--   (8.25 = 8.25%, 9.125 = Conway, 9 = Russellville), DEFAULT 8.25, with a
--   CHECK that it is between 0 and 20 inclusive. Nullable on purpose: the app
--   (lib/calc-total.js effectiveTaxRate) treats NULL/missing as 8.25 and an
--   explicit 0 as 0%.
--
--   No UPDATE/backfill statement is run. Because the default is a constant,
--   Postgres records it in the catalog and existing rows simply read back as
--   8.25 — which is exactly the rate the app has always used for them, so no
--   existing estimate total changes.
--
-- Math (unchanged, now rate-aware): tax = raw cost x tax_rate / 100 when
-- estimates.taxable, added after markup and not marked up.
--
-- App behavior before this is applied: saving an estimate at the default
-- 8.25% still works (the app retries without tax_rate when PostgREST reports
-- the column missing); saving any other rate is refused with a message that
-- this migration is required. Nothing is silently dropped.
--
-- Rollback:
--   ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_tax_rate_range;
--   ALTER TABLE estimates DROP COLUMN IF EXISTS tax_rate;

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS tax_rate numeric(6,4) DEFAULT 8.25;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'estimates_tax_rate_range'
       AND conrelid = 'public.estimates'::regclass
  ) THEN
    ALTER TABLE estimates
      ADD CONSTRAINT estimates_tax_rate_range CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 20));
  END IF;
END $$;

COMMENT ON COLUMN estimates.tax_rate IS
  'Sales tax rate in percentage points (8.25 = 8.25%). Applied to raw cost when taxable; not marked up. NULL = default 8.25.';

-- PostgREST must see the new column.
NOTIFY pgrst, 'reload schema';
