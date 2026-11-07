-- Migration 049: prime (owner) change order approve / apply / reject in ONE transaction.
--
-- STATUS: PROPOSED — written, NOT applied. Apply in a later, approved pass.
-- Does not depend on 042 / 044 / 045 / 046 / 047 / 048 and does not edit them.
--
-- Additive only: two new functions (prime_co_review, and prime_co_revise further
-- down for editing an already-applied CO). No table, column, policy or data change; no
-- UPDATE / DELETE of any existing row by this migration.
--
-- Why: the job pages used to approve a prime CO (status) and set budget_applied
-- straight from the browser, then add the CO's SOV amounts to budget_items one
-- line at a time through /api/budget-items. A failed or preview-blocked line left
-- the CO approved / flagged "applied" with the budget only partly (or not) moved,
-- and a retry could add the saved lines twice.
--
-- public.prime_co_review(...) does it all under row locks in one transaction:
--   1. Locks the prime_change_orders row (FOR UPDATE) and checks it belongs to the
--      job the server resolved (p_job_id) and is in the right state:
--        approve → status 'pending' and not budget_applied
--        apply   → status 'approved' and not budget_applied
--        reject  → 'pending' (or approved but never applied) just becomes 'rejected';
--                  approved + applied is reversed only when p_allow_reverse
--      A second click / tab waits on the lock, then sees the new state and fails
--      ('prime_co_not_pending' / 'prime_co_already_applied'), so a CO is applied once.
--   2. Works out the per-budget-line change from the CO's STORED sov (or p_sov when
--      the reviewer assigns lines while approving): SOV rows with a budget_item_id and
--      a non-zero amount, summed per line. Residential (p_residential) falls back to
--      the whole amount on budget_item_id (p_budget_item_id = the line picked while
--      approving), as the residential page already did; it requires a line.
--   3. Locks those budget_items rows in id order, requires EVERY one to belong to the
--      CO's job ('prime_co_line_wrong_job' otherwise), and adds the change in SQL
--      (budget_amount += d, owner_amount = coalesce(owner_amount, budget_amount, 0) + d),
--      so two COs on the same line can't overwrite each other's increments.
--   4. Only then writes the CO: status / sov / budget_item_id and budget_applied.
--   Any error rolls back everything: the CO stays as it was (pending, or approved and
--   not applied) and no budget line moves, so a retry is safe.
--   jobs.contract_value is never touched (the base contract stays the base contract).
--
-- Called only by POST /api/prime-change-orders/review (service role), which checks
-- the caller's role, job assignment (denyUnlessOnJob) and preview mode first, and
-- answers 503 "needs migration 049" — changing nothing — while this function is missing.
--
-- Columns relied on (already used by the app): prime_change_orders.id / job_id /
-- status / amount / sov / budget_item_id / budget_applied; budget_items.id / job_id /
-- budget_amount / owner_amount.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.prime_co_review(uuid, uuid, text, jsonb, boolean, uuid, boolean, boolean);

BEGIN;

CREATE OR REPLACE FUNCTION public.prime_co_review(
  p_co_id uuid,
  p_job_id uuid,
  p_action text,
  p_sov jsonb,
  p_set_sov boolean,
  p_budget_item_id uuid,
  p_residential boolean,
  p_allow_reverse boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  co record;
  v_sov jsonb;
  v_deltas jsonb := '{}'::jsonb;
  v_ids uuid[];
  v_locked int;
  v_line uuid;
  v_sign numeric := 1;
  v_applied boolean;
  v_residential boolean := coalesce(p_residential, false);
  v_status text;
  v_flag boolean;
  v_new_sov jsonb;
  v_sov_type text;
BEGIN
  -- sov is json or jsonb depending on how the table was created; cast to whichever it is.
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_sov_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.prime_change_orders'::regclass AND a.attname = 'sov' AND NOT a.attisdropped;
  IF v_sov_type NOT IN ('json', 'jsonb') THEN RAISE EXCEPTION 'prime_co_sov_type'; END IF;

  SELECT id, job_id, status, amount, sov, budget_item_id, budget_applied, description INTO co
    FROM public.prime_change_orders WHERE id = p_co_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prime_co_not_found'; END IF;
  IF co.job_id IS DISTINCT FROM p_job_id THEN RAISE EXCEPTION 'prime_co_wrong_job'; END IF;

  v_applied := coalesce(co.budget_applied, false);
  v_sov := CASE WHEN co.sov IS NULL THEN NULL ELSE to_jsonb(co.sov) END;
  v_line := co.budget_item_id;

  IF p_action = 'approve' THEN
    IF co.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'prime_co_not_pending'; END IF;
    IF v_applied THEN RAISE EXCEPTION 'prime_co_already_applied'; END IF;
    IF coalesce(p_set_sov, false) THEN
      IF p_sov IS NOT NULL AND jsonb_typeof(p_sov) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'prime_co_bad_sov'; END IF;
      v_sov := p_sov;
    END IF;
    IF v_residential AND v_line IS NULL THEN v_line := p_budget_item_id; END IF;
  ELSIF p_action = 'apply' THEN
    IF co.status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'prime_co_not_approved'; END IF;
    IF v_applied THEN RAISE EXCEPTION 'prime_co_already_applied'; END IF;
  ELSIF p_action = 'reject' THEN
    IF co.status = 'pending' OR (co.status = 'approved' AND NOT v_applied) THEN
      UPDATE public.prime_change_orders SET status = 'rejected' WHERE id = p_co_id;
      RETURN jsonb_build_object('ok', true, 'status', 'rejected', 'budget_applied', v_applied, 'lines', 0);
    ELSIF co.status = 'approved' AND v_applied THEN
      IF NOT coalesce(p_allow_reverse, false) THEN RAISE EXCEPTION 'prime_co_reverse_not_allowed'; END IF;
      v_sign := -1;
    ELSE
      RAISE EXCEPTION 'prime_co_not_pending';
    END IF;
  ELSE
    RAISE EXCEPTION 'prime_co_bad_action';
  END IF;

  -- Per-line change from the SOV rows that point at a budget line.
  SELECT coalesce(jsonb_object_agg(s.bid, s.amt), '{}'::jsonb) INTO v_deltas
    FROM (
      SELECT (e->>'budget_item_id')::uuid::text AS bid, round(sum((e->>'amount')::numeric), 2) AS amt
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_sov) = 'array' THEN v_sov ELSE '[]'::jsonb END) AS e
       WHERE jsonb_typeof(e) = 'object'
         AND coalesce(e->>'budget_item_id', '') <> ''
         AND coalesce(e->>'amount', '') <> ''
       GROUP BY 1
    ) s
   WHERE s.amt <> 0;

  -- Residential: whole amount on the CO's budget line when it has no SOV rows.
  IF v_deltas = '{}'::jsonb AND v_residential AND v_line IS NOT NULL AND coalesce(co.amount, 0) <> 0 THEN
    v_deltas := jsonb_build_object(v_line::text, round(co.amount::numeric, 2));
  END IF;

  IF v_deltas = '{}'::jsonb AND (p_action <> 'approve' OR v_residential) THEN
    RAISE EXCEPTION 'prime_co_no_lines';
  END IF;

  IF v_deltas <> '{}'::jsonb THEN
    SELECT array_agg(k::uuid ORDER BY k::uuid) INTO v_ids FROM jsonb_object_keys(v_deltas) AS k;
    -- Lock the lines (fixed order, so two COs can't deadlock) and require all on this job.
    SELECT count(*) INTO v_locked FROM (
      SELECT b.id FROM public.budget_items b
       WHERE b.id = ANY(v_ids) AND b.job_id = co.job_id
       ORDER BY b.id
       FOR UPDATE
    ) x;
    IF v_locked <> array_length(v_ids, 1) THEN RAISE EXCEPTION 'prime_co_line_wrong_job'; END IF;

    UPDATE public.budget_items b
       SET budget_amount = coalesce(b.budget_amount, 0) + v_sign * d.value::numeric,
           owner_amount  = coalesce(b.owner_amount, b.budget_amount, 0) + v_sign * d.value::numeric
      FROM jsonb_each_text(v_deltas) AS d
     WHERE b.id = d.key::uuid AND b.job_id = co.job_id;
  END IF;

  IF p_action = 'approve' THEN
    v_status := 'approved';
    v_flag := CASE WHEN v_deltas <> '{}'::jsonb THEN true ELSE co.budget_applied END;
    UPDATE public.prime_change_orders SET status = v_status, budget_applied = v_flag WHERE id = p_co_id;
    IF coalesce(p_set_sov, false) THEN
      EXECUTE format('UPDATE public.prime_change_orders SET sov = $1::%s WHERE id = $2', v_sov_type) USING v_sov, p_co_id;
    END IF;
    IF v_residential THEN
      IF co.budget_item_id IS NULL AND v_line IS NOT NULL THEN
        UPDATE public.prime_change_orders SET budget_item_id = v_line WHERE id = p_co_id;
      END IF;
      -- Record the applied line(s) as SOV rows when the CO had none (as before).
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_sov) = 'array' THEN v_sov ELSE '[]'::jsonb END) AS e
         WHERE jsonb_typeof(e) = 'object' AND coalesce(e->>'budget_item_id', '') <> ''
      ) THEN
        SELECT jsonb_agg(jsonb_build_object('budget_item_id', d.key, 'amount', d.value::numeric, 'description', co.description))
          INTO v_new_sov FROM jsonb_each_text(v_deltas) AS d;
        EXECUTE format('UPDATE public.prime_change_orders SET sov = $1::%s WHERE id = $2', v_sov_type) USING v_new_sov, p_co_id;
      END IF;
    END IF;
  ELSIF p_action = 'apply' THEN
    v_status := 'approved';
    v_flag := true;
    UPDATE public.prime_change_orders SET budget_applied = true WHERE id = p_co_id;
  ELSE
    v_status := 'rejected';
    v_flag := false;
    UPDATE public.prime_change_orders SET status = 'rejected', budget_applied = false WHERE id = p_co_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'budget_applied', coalesce(v_flag, false),
                            'lines', (SELECT count(*) FROM jsonb_object_keys(v_deltas)), 'deltas', v_deltas);
END
$$;

REVOKE EXECUTE ON FUNCTION public.prime_co_review(uuid, uuid, text, jsonb, boolean, uuid, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prime_co_review(uuid, uuid, text, jsonb, boolean, uuid, boolean, boolean)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- public.prime_co_revise(...) — edit an approved + APPLIED commercial prime CO
-- (description / amount / notes / SOV) and re-sync its budget lines, all at once.
--
-- The job page used to save the new SOV first and then move each budget line through
-- /api/budget-items; a failed line left the new SOV stored and budget_applied true
-- with only some lines moved, and a retry compared against the already-saved SOV so
-- the missing change was never recovered.  This function, in ONE transaction:
--   1. Locks the CO (FOR UPDATE); it must belong to p_job_id, be 'approved' and
--      budget_applied ('prime_co_not_applied' otherwise — un-applied edits move no
--      money and are saved by the API without this function).
--   2. Works out the per-line change: new linked SOV amount − stored linked SOV amount,
--      summed per budget_item_id (same meaning as lib/prime-co-budget.js sovBudgetDeltas).
--   3. Locks those budget_items in id order, requires every one to be on the CO's job
--      ('prime_co_line_wrong_job'), and adds the change in SQL.
--   4. Only then writes description / amount / notes / sov (budget_applied stays true).
-- Any error rolls back everything, CO row included. A second click waits on the CO lock,
-- then sees the new SOV already stored and moves nothing (deltas are all zero).

CREATE OR REPLACE FUNCTION public.prime_co_revise(
  p_co_id uuid,
  p_job_id uuid,
  p_description text,
  p_amount numeric,
  p_notes text,
  p_sov jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  co record;
  v_old jsonb;
  v_deltas jsonb := '{}'::jsonb;
  v_ids uuid[];
  v_locked int;
  v_sov_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_sov_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.prime_change_orders'::regclass AND a.attname = 'sov' AND NOT a.attisdropped;
  IF v_sov_type NOT IN ('json', 'jsonb') THEN RAISE EXCEPTION 'prime_co_sov_type'; END IF;
  IF p_sov IS NOT NULL AND jsonb_typeof(p_sov) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'prime_co_bad_sov'; END IF;
  IF coalesce(btrim(p_description), '') = '' OR p_amount IS NULL THEN RAISE EXCEPTION 'prime_co_bad_input'; END IF;

  SELECT id, job_id, status, sov, budget_applied INTO co
    FROM public.prime_change_orders WHERE id = p_co_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prime_co_not_found'; END IF;
  IF co.job_id IS DISTINCT FROM p_job_id THEN RAISE EXCEPTION 'prime_co_wrong_job'; END IF;
  IF co.status IS DISTINCT FROM 'approved' OR NOT coalesce(co.budget_applied, false) THEN
    RAISE EXCEPTION 'prime_co_not_applied';
  END IF;

  v_old := CASE WHEN co.sov IS NULL THEN NULL ELSE to_jsonb(co.sov) END;

  -- Net per-line change: reverse the stored linked amounts, apply the new ones.
  SELECT coalesce(jsonb_object_agg(x.bid, x.amt), '{}'::jsonb) INTO v_deltas
    FROM (
      SELECT t.bid, round(sum(t.amt), 2) AS amt
        FROM (
          SELECT (e->>'budget_item_id')::uuid::text AS bid, -(e->>'amount')::numeric AS amt
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_old) = 'array' THEN v_old ELSE '[]'::jsonb END) AS e
           WHERE jsonb_typeof(e) = 'object' AND coalesce(e->>'budget_item_id', '') <> '' AND coalesce(e->>'amount', '') <> ''
          UNION ALL
          SELECT (e->>'budget_item_id')::uuid::text, (e->>'amount')::numeric
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_sov) = 'array' THEN p_sov ELSE '[]'::jsonb END) AS e
           WHERE jsonb_typeof(e) = 'object' AND coalesce(e->>'budget_item_id', '') <> '' AND coalesce(e->>'amount', '') <> ''
        ) t
       GROUP BY t.bid
    ) x
   WHERE x.amt <> 0;

  IF v_deltas <> '{}'::jsonb THEN
    SELECT array_agg(k::uuid ORDER BY k::uuid) INTO v_ids FROM jsonb_object_keys(v_deltas) AS k;
    SELECT count(*) INTO v_locked FROM (
      SELECT b.id FROM public.budget_items b
       WHERE b.id = ANY(v_ids) AND b.job_id = co.job_id
       ORDER BY b.id
       FOR UPDATE
    ) x;
    IF v_locked <> array_length(v_ids, 1) THEN RAISE EXCEPTION 'prime_co_line_wrong_job'; END IF;

    UPDATE public.budget_items b
       SET budget_amount = coalesce(b.budget_amount, 0) + d.value::numeric,
           owner_amount  = coalesce(b.owner_amount, b.budget_amount, 0) + d.value::numeric
      FROM jsonb_each_text(v_deltas) AS d
     WHERE b.id = d.key::uuid AND b.job_id = co.job_id;
  END IF;

  -- CO written last; budget_applied stays true.
  UPDATE public.prime_change_orders
     SET description = p_description, amount = p_amount, notes = p_notes
   WHERE id = p_co_id;
  EXECUTE format('UPDATE public.prime_change_orders SET sov = $1::%s WHERE id = $2', v_sov_type) USING p_sov, p_co_id;

  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'budget_applied', true,
                            'lines', (SELECT count(*) FROM jsonb_object_keys(v_deltas)), 'deltas', v_deltas);
END
$$;

REVOKE EXECUTE ON FUNCTION public.prime_co_revise(uuid, uuid, text, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prime_co_revise(uuid, uuid, text, numeric, text, jsonb)
  TO service_role;

COMMIT;
