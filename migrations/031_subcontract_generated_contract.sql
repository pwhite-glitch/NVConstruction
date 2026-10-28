-- Migration 031: remember the last contract generated for each subcontract.
--
-- When a PM uses "Edit & Print Contract" or sends a contract for e-signature,
-- the app stores the generated HTML in the 'documents' storage bucket under
-- subcontracts/<subcontract id>/generated-<time>.html and records the newest
-- one here. The job page shows a "Last generated contract" button from it.
--
-- The app works before this is applied: files are still stored, the row just
-- isn't updated (the "Last generated contract" button then only appears for
-- contracts generated in the current page session).

alter table public.subcontracts
  add column if not exists generated_contract_path text,
  add column if not exists generated_at timestamptz,
  add column if not exists generated_by uuid references auth.users(id) on delete set null;
