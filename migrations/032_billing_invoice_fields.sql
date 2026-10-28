-- Migration 032: invoice number and invoice date on billing submissions.
--
-- The office billing create/edit forms on the job page and the sub portal
-- billing form record the sub's invoice number and invoice date, and the
-- billing card shows them.
--
-- invoice_number may already exist (the sub portal has been writing it), so
-- both columns use IF NOT EXISTS. Both are nullable; no backfill.
--
-- The app works before this is applied: writes that include invoice_date are
-- retried without it (lib/billing-fields.js), so only the date is not saved.

alter table public.billing_submissions
  add column if not exists invoice_number text,
  add column if not exists invoice_date date;

create index if not exists billing_submissions_invoice_number_idx
  on public.billing_submissions (invoice_number);
