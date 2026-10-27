-- Migration 030: tag subcontract SOV lines that come from approved change orders.
--
-- Problem: approving a sub CO inserts a "CO: ..." line into subcontract_sov_lines.
-- If that happened before the sub set up their schedule of values, the contract
-- looked like it already had an SOV, so the sub portal skipped the setup step and
-- the sub could only bill the CO line, never the base contract.
--
-- The app now treats CO lines separately from the base schedule. It identifies
-- them by change_order_id, falling back to the "CO: " description prefix for rows
-- this backfill can't link. The app works before this migration is applied
-- (it retries CO-line inserts without the column), so order doesn't matter.

alter table public.subcontract_sov_lines
  add column if not exists change_order_id uuid references public.change_orders(id) on delete set null;

create index if not exists subcontract_sov_lines_change_order_id_idx
  on public.subcontract_sov_lines (change_order_id);

-- Link existing "CO: <description>" lines to their approved CO, only where the
-- match is unambiguous (exactly one approved CO on that contract with that
-- description). Anything else stays null and is still recognised by its prefix.
update public.subcontract_sov_lines l
set change_order_id = m.co_id
from (
  select l2.id as line_id, min(co.id::text)::uuid as co_id
  from public.subcontract_sov_lines l2
  join public.change_orders co
    on co.subcontract_id = l2.subcontract_id
   and co.status = 'approved'
   and l2.description = 'CO: ' || co.description
  where l2.change_order_id is null
  group by l2.id
  having count(*) = 1
) m
where l.id = m.line_id;
