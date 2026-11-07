-- Migration 047: expected payment dates for the Owner cash outlook.
--
-- STATUS: PROPOSED — written, NOT applied. Do not assume 044, 045 or 046 are
-- applied either; this file does not depend on them.
--
-- What this does (additive only; safe to re-run):
--   1. Adds a nullable DATE column expected_payment_date to
--        aia_applications     (when NV expects the owner to pay a pay app)
--        res_owner_draws      (when NV expects the lender/owner to fund a draw)
--        billing_submissions  (when NV plans to pay an approved sub billing)
--      Planning metadata only. No default, no backfill, no data changes:
--      every existing row stays NULL ("Needs expected date" on the card).
--      It does not touch amounts, status, paid_at, payment_received,
--      amount_received, funded_date, or 046's proposed amount_funded /
--      schedule_lines / attachments (046 is not edited and not duplicated).
--   2. Owner-only protection. Office roles keep their existing browser
--      policies on aia_applications / billing_submissions (038 / 028 "FOR ALL"
--      for is_office_user()), so a PM could otherwise PATCH the new column
--      straight through PostgREST. A BEFORE INSERT/UPDATE trigger refuses any
--      change to expected_payment_date unless it comes from a trusted server
--      role (service_role — the /api/expected-payment-date route, which
--      checks isPrincipal — or postgres / supabase_admin for migrations).
--      Every other column and every existing operation is unaffected: the
--      trigger only looks at expected_payment_date.
--
-- Dependencies: none beyond the three tables. The trigger function is
-- SECURITY INVOKER (it must see the caller's current_user) and is not
-- callable through the API.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS aia_applications_expected_payment_date_guard ON public.aia_applications;
--   DROP TRIGGER IF EXISTS res_owner_draws_expected_payment_date_guard ON public.res_owner_draws;
--   DROP TRIGGER IF EXISTS billing_submissions_expected_payment_date_guard ON public.billing_submissions;
--   DROP FUNCTION IF EXISTS public.guard_expected_payment_date();
--   ALTER TABLE public.aia_applications    DROP COLUMN IF EXISTS expected_payment_date;
--   ALTER TABLE public.res_owner_draws     DROP COLUMN IF EXISTS expected_payment_date;
--   ALTER TABLE public.billing_submissions DROP COLUMN IF EXISTS expected_payment_date;

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.aia_applications    ADD COLUMN IF NOT EXISTS expected_payment_date date;
ALTER TABLE public.res_owner_draws     ADD COLUMN IF NOT EXISTS expected_payment_date date;
ALTER TABLE public.billing_submissions ADD COLUMN IF NOT EXISTS expected_payment_date date;

COMMENT ON COLUMN public.aia_applications.expected_payment_date    IS 'PROPOSED (047): Owner planning date for when this pay app is expected to be paid. Planning only; not a payment record.';
COMMENT ON COLUMN public.res_owner_draws.expected_payment_date     IS 'PROPOSED (047): Owner planning date for when this draw is expected to be funded. Planning only; not funded_date.';
COMMENT ON COLUMN public.billing_submissions.expected_payment_date IS 'PROPOSED (047): Owner planning date for when NV expects to pay this approved billing. Planning only; not paid_at.';

-- ── 2. Owner-only (server route) writes to expected_payment_date ────────────
CREATE OR REPLACE FUNCTION public.guard_expected_payment_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.expected_payment_date IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.expected_payment_date IS DISTINCT FROM OLD.expected_payment_date) THEN
    IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'expected_payment_date_owner_only: expected payment dates are set by an Owner through the app'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.guard_expected_payment_date() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aia_applications_expected_payment_date_guard ON public.aia_applications;
CREATE TRIGGER aia_applications_expected_payment_date_guard
  BEFORE INSERT OR UPDATE ON public.aia_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_expected_payment_date();

DROP TRIGGER IF EXISTS res_owner_draws_expected_payment_date_guard ON public.res_owner_draws;
CREATE TRIGGER res_owner_draws_expected_payment_date_guard
  BEFORE INSERT OR UPDATE ON public.res_owner_draws
  FOR EACH ROW EXECUTE FUNCTION public.guard_expected_payment_date();

DROP TRIGGER IF EXISTS billing_submissions_expected_payment_date_guard ON public.billing_submissions;
CREATE TRIGGER billing_submissions_expected_payment_date_guard
  BEFORE INSERT OR UPDATE ON public.billing_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_expected_payment_date();

COMMIT;
