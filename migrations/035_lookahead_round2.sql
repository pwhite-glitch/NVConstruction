-- Migration 035: 2-week lookahead round 2.
--
-- lookahead_activities
--   end_date         last day of a multi-day activity. NULL = one day (planned_date).
--                    The activity shows on every working day (Mon–Fri) from
--                    planned_date to end_date.
--   status           not_started / in_progress / done / delayed (the status chip).
--   carried_from_id  the activity this one was copied from by "Copy from last
--                    week", so pressing it twice does not copy the same item again.
--
-- lookaheads: who did each workflow step (Draft > Submitted > Reviewed/Approved >
-- Sent to subs). submitted_at / approved_at / submitted_by already exist.
-- "Sent to subs" is not a new status value: it is status = 'approved' with
-- sent_to_subs_at set, so no existing check constraint on lookaheads.status
-- has to change.
--
-- The app works before this is applied: writes that include a new column are
-- retried without it (lib/lookahead-fields.js) and the user is told what was
-- not saved. Safe to run more than once.

alter table public.lookahead_activities
  add column if not exists end_date date,
  add column if not exists status text not null default 'not_started',
  add column if not exists carried_from_id uuid references public.lookahead_activities(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lookahead_activities_status_check') then
    alter table public.lookahead_activities
      add constraint lookahead_activities_status_check
      check (status in ('not_started', 'in_progress', 'done', 'delayed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lookahead_activities_end_date_check') then
    alter table public.lookahead_activities
      add constraint lookahead_activities_end_date_check
      check (end_date is null or end_date >= planned_date);
  end if;
end $$;

create index if not exists lookahead_activities_carried_from_idx
  on public.lookahead_activities(carried_from_id) where carried_from_id is not null;

alter table public.lookaheads
  add column if not exists submitted_by_name text,
  add column if not exists approved_by uuid,
  add column if not exists approved_by_name text,
  add column if not exists sent_to_subs_at timestamptz,
  add column if not exists sent_to_subs_by uuid,
  add column if not exists sent_to_subs_by_name text,
  add column if not exists sent_to_subs_recipients jsonb;

-- Dashboard "Awaiting review" list filters on status across all jobs.
create index if not exists lookaheads_status_idx on public.lookaheads(status);
