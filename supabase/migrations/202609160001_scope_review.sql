-- Additive schema for the estimating workspace. Review and run separately;
-- this migration does not change grants or row-level security policies.
-- Deploy alongside the independently reviewed authorization repairs.
begin;
alter table public.bid_scope_items
  add column if not exists scope_review jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bid_scope_items'::regclass
      and conname = 'bid_scope_items_review_shape'
  ) then
    alter table public.bid_scope_items add constraint bid_scope_items_review_shape
      check (
        jsonb_typeof(scope_review) = 'object'
        and (not (scope_review ? 'status') or
          (scope_review->>'status' is not null and scope_review->>'status' in ('draft', 'question', 'accepted')))
      );
  end if;
end $$;
comment on column public.bid_scope_items.scope_review is
  'Estimator annotations and document references, not a trusted authorization or signature audit record. Existing items default to needs review.';
commit;

-- Rollback the application first. Keep this additive column to preserve review
-- annotations. Dropping it would destroy user-entered notes and source links.
