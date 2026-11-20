-- Prompt 97: how a subcontract was signed.
--   subcontracts.signed_method       'esign' (signed on the signing page) or 'manual_upload'
--                                    (office uploaded a signed copy: POST /api/subcontracts/signed-upload)
--   subcontracts.signed_uploaded_by  the office user who uploaded the signed copy (auth user id)
--
-- No RLS changes: the existing subcontracts policies are row-level and cover these new
-- columns. Writes go through the service-role API routes (role + job access checked there).
--
-- The app works before this is applied: the routes drop the missing columns and still save the
-- signed contract, and the job page shows plain "signed" until signed_method can be read.

BEGIN;
ALTER TABLE public.subcontracts
  ADD COLUMN IF NOT EXISTS signed_method text,
  ADD COLUMN IF NOT EXISTS signed_uploaded_by uuid;
COMMIT;
