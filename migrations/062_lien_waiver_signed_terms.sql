-- Migration 062: record what a sub actually signed on a conditional lien waiver.
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. No data changes, no backfill. Idempotent (safe to run twice).
--
-- Why (prompt 67B #6): a signed waiver stayed "signed" after the billing's amount, retainage
-- or period was edited, and every printout rebuilt the waiver from the live billing and
-- stamped the old signature on it.
--
-- What this adds to public.billing_submissions:
--   lien_waiver_amount  numeric(12,2)  — amount_billed at the moment the sub signed
--   lien_waiver_through date           — billing_period (or the signing date when there is
--                                        no period) at the moment the sub signed
--   lien_waiver_history jsonb NOT NULL DEFAULT '[]' — signatures voided by a later edit:
--     [{ voided_at, voided_by, reason: amount_changed | retainage_changed | period_changed,
--        signed_at, signer_name, amount, through, signature }]
--
-- Existing signed rows keep NULL lien_waiver_amount / lien_waiver_through ("legacy"): the
-- printouts then show the live amount with a note that the waiver was signed before the
-- portal recorded signed amounts. Existing rows get '[]' history from the default.
--
-- Code that uses it:
--   app/api/lien-waiver-sign/route.js — stores amount/through with the signature. Before 062:
--     retries without the two columns (signature still saves; legacy behavior).
--   app/api/billing-entry/route.js PATCH — voids a signed waiver when amount / retainage /
--     period change; appends to lien_waiver_history. Before 062: voids without the history
--     entry (the change_log row is the record).
--   lib/lien-waiver-terms.js signedWaiverTerms — printouts on the job page, sub portal and
--     residential job page print the signed terms (falls back to live values when NULL).
--
-- ROLLBACK:
--   ALTER TABLE public.billing_submissions DROP COLUMN IF EXISTS lien_waiver_history;
--   ALTER TABLE public.billing_submissions DROP COLUMN IF EXISTS lien_waiver_through;
--   ALTER TABLE public.billing_submissions DROP COLUMN IF EXISTS lien_waiver_amount;

ALTER TABLE public.billing_submissions ADD COLUMN IF NOT EXISTS lien_waiver_amount numeric(12,2);
ALTER TABLE public.billing_submissions ADD COLUMN IF NOT EXISTS lien_waiver_through date;
ALTER TABLE public.billing_submissions ADD COLUMN IF NOT EXISTS lien_waiver_history jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.billing_submissions.lien_waiver_amount IS 'Amount the sub signed the conditional lien waiver for. NULL = signed before migration 062 (legacy) or not signed.';
COMMENT ON COLUMN public.billing_submissions.lien_waiver_through IS 'Through date on the waiver the sub signed. NULL = legacy or not signed.';
COMMENT ON COLUMN public.billing_submissions.lien_waiver_history IS 'Signed waivers voided because the billing amount, retainage or period changed afterwards.';
