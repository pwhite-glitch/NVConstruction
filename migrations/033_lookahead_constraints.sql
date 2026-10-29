-- Migration 033: separate Constraints field on 2-week lookahead activities.
--
-- The Add/Edit Activity forms (job page > Lookahead, and the field app) now have
-- a "Constraints" box for blockers (missing approvals, material delays, weather)
-- separate from "Notes". Constraints drive the ⚠ flags, the Constraints count and
-- the Attention Items list; Notes (constraints_notes) are just shown on the card.
--
-- The app works before this is applied: writes that include constraints are
-- retried without it (lib/lookahead-fields.js) and the user is told the
-- constraint text was not saved.

alter table public.lookahead_activities
  add column if not exists constraints text;

-- Existing text was entered in the old combined "Constraints / Notes" box and was
-- flagged as a constraint, so move it to the new column to keep it flagged.
-- Delete this statement to keep existing text as plain notes instead.
update public.lookahead_activities
set constraints = constraints_notes,
    constraints_notes = null
where constraints is null
  and nullif(trim(constraints_notes), '') is not null;
