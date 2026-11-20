-- Prompt 98: SignWell e-signature for subcontracts.
--   subcontracts.signwell_document_id   SignWell document id (the webhook matches on it)
--   subcontracts.signwell_status        sent / viewed / pending / completed / declined / canceled / expired / bounced / error …
--   subcontracts.signwell_sent_at       when the office sent it through SignWell
--   subcontracts.signwell_completed_at  when the completed PDF (with audit page) was stored
--
-- No RLS changes: the existing subcontracts policies are row-level and cover these new
-- columns. Writes go through service-role API routes (/api/signing-requests,
-- /api/subcontracts/signwell, /api/signwell/webhook).
--
-- Before this is applied: sending through SignWell returns a "run migration 081" error and
-- nothing is sent; with no SIGNWELL_API_KEY the built-in e-sign works as before.

BEGIN;
ALTER TABLE public.subcontracts
  ADD COLUMN IF NOT EXISTS signwell_document_id text,
  ADD COLUMN IF NOT EXISTS signwell_status text,
  ADD COLUMN IF NOT EXISTS signwell_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS signwell_completed_at timestamptz;
CREATE INDEX IF NOT EXISTS subcontracts_signwell_document_id_idx ON public.subcontracts(signwell_document_id);
COMMIT;
