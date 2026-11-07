-- Migration 045: billing / draw integrity, stable CO numbers, lookahead review.
--
-- NOT APPLIED. Written only in this pass; apply in a later pass after review.
-- (042_drawings_aia_numbers_owner_draws.sql stays unapplied and untouched; 043 is applied;
--  044 is written but not applied. Nothing here depends on 042 or 044.)
--
-- Additive only: new nullable columns, new functions / triggers, and policy replacements.
-- NO data is changed: no backfill of CO numbers, no UPDATE / DELETE of any existing row,
-- no change to any old migration file.
--
-- PROPOSED NEW columns (none of these exist live today):
--   prime_change_orders.co_number  integer  NULL   (PCO number, per job)
--   change_orders.co_number        integer  NULL   (SCO number, per subcontract)
--   direct_costs.drawn_aia_delta   numeric  NULL   (signed $ actually added to the G703 line
--                                                   by "Draw"; Undo subtracts exactly this)
--   lookaheads.approved_at         timestamptz NULL (code already wrote it; missing live)
--   lookaheads.returned_at         timestamptz NULL ┐
--   lookaheads.returned_by         uuid        NULL │ "Send back" by the office, with the note
--   lookaheads.returned_by_name    text        NULL │ the field app shows
--   lookaheads.return_note         text        NULL ┘
-- Existing columns relied on (verified live 2026-11-06): prime_change_orders.job_id,
-- change_orders.subcontract_id, subcontracts.job_id, direct_costs.drawn_application_id /
-- drawn_at / budget_item_id, aia_applications.status / payment_received / job_id,
-- aia_application_lines.application_id / budget_item_id / dollar_this_period /
-- pct_this_period / dollar_prev, billing_sov_lines.sov_line_id, subcontract_sov_lines.*.
--
-- What it does:
--   1. CO numbers. Assigned by a BEFORE INSERT trigger under a transaction advisory lock per
--      scope (job for prime, subcontract for sub) as max(co_number)+1; any number the client
--      sends is overwritten. A partial UNIQUE index per scope backs it. The number can't be
--      changed afterwards (BEFORE UPDATE trigger), and a numbered CO can't be hard-deleted
--      (BEFORE DELETE trigger: reject it instead), so the latest number is never freed and
--      never reused. Exception: when the parent job / subcontract itself is being deleted
--      (FK cascade), the CO goes with it — that whole numbering scope is gone.
--      Legacy rows keep co_number NULL (shown as "Legacy CO <id suffix>"). Numbering them is
--      separate approval work.
--   2. Pay-app draw of a direct cost: public.aia_dc_draw_apply() changes the cost's tag and
--      the G703 line in ONE transaction, with row locks and compare-and-set on the line, so a
--      tag can never be left without its G703 amount (or the reverse). service_role only;
--      /api/aia-draw validates job, sequence and lock / Owner override first.
--   3. SOV lines: a line referenced by ANY billing_sov_lines row can't be deleted and its
--      scheduled value / description / budget line / contract can't change (trigger, with a
--      row lock so a concurrent billing insert is seen). billing_sov_lines.sov_line_id is
--      ON DELETE CASCADE live; this keeps that cascade from ever removing billing detail.
--      RLS: the ALL USING(true) policies on subcontract_sov_lines and billing_sov_lines (and
--      any other policy with a bare `true` predicate on them) are DROPPED and replaced with
--      office-only SELECT. Browser writes stop; writes go through service-role routes:
--      /api/subcontract-sov (office edits), /api/sub-portal/sov (sub initial SOV),
--      /api/sub-portal/billing (billing lines), /api/co-response + /api/sov-co-backfill
--      (approved CO lines).
--   4. Lookahead columns above.
--
-- Runs in one transaction. Safe to re-run.
-- Rollback (one block):
--   DROP TRIGGER IF EXISTS prime_co_number_insert ON public.prime_change_orders;
--   DROP TRIGGER IF EXISTS prime_co_number_update ON public.prime_change_orders;
--   DROP TRIGGER IF EXISTS prime_co_number_delete ON public.prime_change_orders;
--   DROP TRIGGER IF EXISTS sub_co_number_insert ON public.change_orders;
--   DROP TRIGGER IF EXISTS sub_co_number_update ON public.change_orders;
--   DROP TRIGGER IF EXISTS sub_co_number_delete ON public.change_orders;
--   DROP TRIGGER IF EXISTS subcontract_sov_lines_billed_guard ON public.subcontract_sov_lines;
--   DROP FUNCTION IF EXISTS public.assign_prime_co_number(), public.assign_sub_co_number(),
--     public.co_number_immutable(), public.prime_co_no_delete(), public.sub_co_no_delete(),
--     public.guard_billed_sov_line(),
--     public.aia_dc_draw_apply(text, uuid, uuid, uuid, numeric, boolean, numeric, numeric, numeric, numeric, boolean);
--   DROP POLICY IF EXISTS "subcontract_sov_lines_office_select" ON public.subcontract_sov_lines;
--   DROP POLICY IF EXISTS "billing_sov_lines_office_select" ON public.billing_sov_lines;
--   CREATE POLICY "Authenticated manage subcontract_sov_lines" ON public.subcontract_sov_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   CREATE POLICY "Authenticated manage billing_sov_lines" ON public.billing_sov_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   -- Columns can stay (nullable, unused by old code), or drop them if nothing was written.

BEGIN;

-- ── 1. CO NUMBERS ────────────────────────────────────────────────────────────
ALTER TABLE public.prime_change_orders ADD COLUMN IF NOT EXISTS co_number integer;
ALTER TABLE public.change_orders       ADD COLUMN IF NOT EXISTS co_number integer;

CREATE UNIQUE INDEX IF NOT EXISTS prime_change_orders_job_co_number_key
  ON public.prime_change_orders (job_id, co_number) WHERE co_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS change_orders_subcontract_co_number_key
  ON public.change_orders (subcontract_id, co_number) WHERE co_number IS NOT NULL;

-- SECURITY DEFINER so max() sees every row of the scope whatever the caller's RLS.
CREATE OR REPLACE FUNCTION public.assign_prime_co_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.job_id IS NULL THEN
    NEW.co_number := NULL;
    RETURN NEW;
  END IF;
  -- Serialises creation per job until commit; the next insert then sees this row.
  PERFORM pg_advisory_xact_lock(hashtextextended('prime_co_number:' || NEW.job_id::text, 0));
  SELECT coalesce(max(co_number), 0) + 1 INTO NEW.co_number
    FROM public.prime_change_orders WHERE job_id = NEW.job_id;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.assign_sub_co_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.subcontract_id IS NULL THEN
    NEW.co_number := NULL;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sub_co_number:' || NEW.subcontract_id::text, 0));
  SELECT coalesce(max(co_number), 0) + 1 INTO NEW.co_number
    FROM public.change_orders WHERE subcontract_id = NEW.subcontract_id;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.co_number_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.co_number IS DISTINCT FROM OLD.co_number THEN
    RAISE EXCEPTION 'co_number_immutable: a change order number can''t be changed once assigned';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.prime_co_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.co_number IS NOT NULL AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = OLD.job_id) THEN
    RAISE EXCEPTION 'co_numbered_no_delete: PCO-% can''t be deleted (reject it instead)', lpad(OLD.co_number::text, 3, '0');
  END IF;
  RETURN OLD;
END
$$;

CREATE OR REPLACE FUNCTION public.sub_co_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.co_number IS NOT NULL AND EXISTS (SELECT 1 FROM public.subcontracts s WHERE s.id = OLD.subcontract_id) THEN
    RAISE EXCEPTION 'co_numbered_no_delete: SCO-% can''t be deleted (reject it instead)', lpad(OLD.co_number::text, 3, '0');
  END IF;
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS prime_co_number_insert ON public.prime_change_orders;
CREATE TRIGGER prime_co_number_insert BEFORE INSERT ON public.prime_change_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_prime_co_number();
DROP TRIGGER IF EXISTS prime_co_number_update ON public.prime_change_orders;
CREATE TRIGGER prime_co_number_update BEFORE UPDATE OF co_number ON public.prime_change_orders
  FOR EACH ROW EXECUTE FUNCTION public.co_number_immutable();
DROP TRIGGER IF EXISTS prime_co_number_delete ON public.prime_change_orders;
CREATE TRIGGER prime_co_number_delete BEFORE DELETE ON public.prime_change_orders
  FOR EACH ROW EXECUTE FUNCTION public.prime_co_no_delete();

DROP TRIGGER IF EXISTS sub_co_number_insert ON public.change_orders;
CREATE TRIGGER sub_co_number_insert BEFORE INSERT ON public.change_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_sub_co_number();
DROP TRIGGER IF EXISTS sub_co_number_update ON public.change_orders;
CREATE TRIGGER sub_co_number_update BEFORE UPDATE OF co_number ON public.change_orders
  FOR EACH ROW EXECUTE FUNCTION public.co_number_immutable();
DROP TRIGGER IF EXISTS sub_co_number_delete ON public.change_orders;
CREATE TRIGGER sub_co_number_delete BEFORE DELETE ON public.change_orders
  FOR EACH ROW EXECUTE FUNCTION public.sub_co_no_delete();

REVOKE EXECUTE ON FUNCTION public.assign_prime_co_number(), public.assign_sub_co_number(),
  public.co_number_immutable(), public.prime_co_no_delete(), public.sub_co_no_delete()
  FROM PUBLIC, anon, authenticated;

-- ── 2. PAY-APP DRAW OF A DIRECT COST (atomic tag + G703) ────────────────────
ALTER TABLE public.direct_costs ADD COLUMN IF NOT EXISTS drawn_aia_delta numeric;

-- p_mode: 'draw' | 'undo' | 'legacy_untag'. Raises (rolls back everything) on any mismatch:
--   aia_dc_already_drawn / aia_dc_not_drawn_here / aia_line_changed / aia_app_locked
CREATE OR REPLACE FUNCTION public.aia_dc_draw_apply(
  p_mode text, p_cost_id uuid, p_app_id uuid, p_budget_item_id uuid,
  p_expected_this numeric, p_has_line boolean, p_new_this numeric, p_new_pct numeric,
  p_applied numeric, p_dollar_prev numeric, p_override boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c record;
  a record;
  l record;
BEGIN
  SELECT id, job_id, drawn_application_id, drawn_aia_delta, budget_item_id INTO c
    FROM public.direct_costs WHERE id = p_cost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'aia_dc_not_found'; END IF;

  SELECT id, job_id, status, payment_received INTO a
    FROM public.aia_applications WHERE id = p_app_id FOR UPDATE;
  IF NOT FOUND OR a.job_id::text <> c.job_id::text THEN RAISE EXCEPTION 'aia_app_mismatch'; END IF;
  IF NOT coalesce(p_override, false)
     AND (a.status IN ('submitted', 'certified') OR coalesce(a.payment_received, false)) THEN
    RAISE EXCEPTION 'aia_app_locked';
  END IF;

  IF p_mode = 'draw' THEN
    IF c.drawn_application_id IS NOT NULL THEN RAISE EXCEPTION 'aia_dc_already_drawn'; END IF;
  ELSIF p_mode = 'undo' THEN
    IF c.drawn_application_id IS DISTINCT FROM p_app_id OR c.drawn_aia_delta IS NULL
       OR c.drawn_aia_delta <> p_applied THEN
      RAISE EXCEPTION 'aia_dc_not_drawn_here';
    END IF;
  ELSIF p_mode = 'legacy_untag' THEN
    IF c.drawn_application_id IS DISTINCT FROM p_app_id OR c.drawn_aia_delta IS NOT NULL THEN
      RAISE EXCEPTION 'aia_dc_not_drawn_here';
    END IF;
    UPDATE public.direct_costs SET drawn_application_id = NULL, drawn_at = NULL WHERE id = p_cost_id;
    RETURN jsonb_build_object('ok', true, 'mode', p_mode);
  ELSE
    RAISE EXCEPTION 'aia_bad_mode';
  END IF;

  IF c.budget_item_id IS DISTINCT FROM p_budget_item_id THEN RAISE EXCEPTION 'aia_line_changed'; END IF;

  SELECT id, dollar_this_period INTO l
    FROM public.aia_application_lines
   WHERE application_id = p_app_id AND budget_item_id = p_budget_item_id
   ORDER BY id LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    -- compare-and-set: the route calculated from this exact stored value
    IF NOT coalesce(p_has_line, false) OR l.dollar_this_period IS DISTINCT FROM p_expected_this THEN
      RAISE EXCEPTION 'aia_line_changed';
    END IF;
    UPDATE public.aia_application_lines
       SET dollar_this_period = p_new_this, pct_this_period = p_new_pct
     WHERE id = l.id;
  ELSE
    IF coalesce(p_has_line, false) OR p_mode <> 'draw' THEN RAISE EXCEPTION 'aia_line_changed'; END IF;
    INSERT INTO public.aia_application_lines (application_id, budget_item_id, dollar_this_period, pct_this_period, dollar_prev)
    VALUES (p_app_id, p_budget_item_id, p_new_this, p_new_pct, p_dollar_prev);
  END IF;

  IF p_mode = 'draw' THEN
    UPDATE public.direct_costs
       SET drawn_application_id = p_app_id, drawn_at = now(), drawn_aia_delta = p_applied
     WHERE id = p_cost_id;
  ELSE
    UPDATE public.direct_costs
       SET drawn_application_id = NULL, drawn_at = NULL, drawn_aia_delta = NULL
     WHERE id = p_cost_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'mode', p_mode);
END
$$;

REVOKE EXECUTE ON FUNCTION public.aia_dc_draw_apply(text, uuid, uuid, uuid, numeric, boolean, numeric, numeric, numeric, numeric, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aia_dc_draw_apply(text, uuid, uuid, uuid, numeric, boolean, numeric, numeric, numeric, numeric, boolean)
  TO service_role;

-- ── 3. SOV LINES: BILLED LINES ARE FROZEN; CLOSE THE BROWSER WRITE BYPASS ────
CREATE OR REPLACE FUNCTION public.guard_billed_sov_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id public.subcontract_sov_lines.id%TYPE := OLD.id; -- UPDATE and DELETE both have OLD
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.scheduled_value IS NOT DISTINCT FROM OLD.scheduled_value
     AND NEW.description     IS NOT DISTINCT FROM OLD.description
     AND NEW.budget_item_id  IS NOT DISTINCT FROM OLD.budget_item_id
     AND NEW.subcontract_id  IS NOT DISTINCT FROM OLD.subcontract_id THEN
    RETURN NEW; -- sort_order / change_order_id only
  END IF;
  -- FOR UPDATE conflicts with the FOR KEY SHARE lock a concurrent billing_sov_lines insert
  -- takes on this row, so that insert is either seen below or fails its FK afterwards.
  PERFORM 1 FROM public.subcontract_sov_lines WHERE id = v_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.billing_sov_lines b WHERE b.sov_line_id = v_id) THEN
    RAISE EXCEPTION 'sov_line_billed: this SOV line has billing lines and can''t be % (billing history must stay intact)',
      CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'changed' END;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

DROP TRIGGER IF EXISTS subcontract_sov_lines_billed_guard ON public.subcontract_sov_lines;
CREATE TRIGGER subcontract_sov_lines_billed_guard BEFORE UPDATE OR DELETE ON public.subcontract_sov_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_billed_sov_line();
REVOKE EXECUTE ON FUNCTION public.guard_billed_sov_line() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.subcontract_sov_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_sov_lines     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated manage subcontract_sov_lines" ON public.subcontract_sov_lines;
DROP POLICY IF EXISTS "Authenticated manage billing_sov_lines"     ON public.billing_sov_lines;

-- Any other policy on these two tables whose predicate is a bare `true` is permissive in
-- the same way; drop it too (listed in the NOTICE output) so the replacement actually closes.
DO $migration$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('subcontract_sov_lines', 'billing_sov_lines')
       AND policyname NOT IN ('subcontract_sov_lines_office_select', 'billing_sov_lines_office_select')
       AND (btrim(coalesce(qual, '')) = 'true' OR btrim(coalesce(with_check, '')) = 'true')
  LOOP
    RAISE NOTICE 'DROPPING permissive policy %.% (%): USING % / CHECK %', pol.tablename, pol.policyname, pol.cmd, pol.qual, pol.with_check;
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END
$migration$;

-- Office users read SOV and billing lines in the job page. No browser writes.
DROP POLICY IF EXISTS "subcontract_sov_lines_office_select" ON public.subcontract_sov_lines;
CREATE POLICY "subcontract_sov_lines_office_select" ON public.subcontract_sov_lines FOR SELECT TO authenticated
  USING ((select public.is_office_user()));
DROP POLICY IF EXISTS "billing_sov_lines_office_select" ON public.billing_sov_lines;
CREATE POLICY "billing_sov_lines_office_select" ON public.billing_sov_lines FOR SELECT TO authenticated
  USING ((select public.is_office_user()));

REVOKE ALL ON public.subcontract_sov_lines, public.billing_sov_lines FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.subcontract_sov_lines, public.billing_sov_lines FROM authenticated;

-- ── 4. LOOKAHEAD REVIEW COLUMNS ──────────────────────────────────────────────
ALTER TABLE public.lookaheads ADD COLUMN IF NOT EXISTS approved_at      timestamptz;
ALTER TABLE public.lookaheads ADD COLUMN IF NOT EXISTS returned_at      timestamptz;
ALTER TABLE public.lookaheads ADD COLUMN IF NOT EXISTS returned_by      uuid;
ALTER TABLE public.lookaheads ADD COLUMN IF NOT EXISTS returned_by_name text;
ALTER TABLE public.lookaheads ADD COLUMN IF NOT EXISTS return_note      text;

COMMIT;
