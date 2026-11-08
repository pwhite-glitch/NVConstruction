-- Migration 058: residential homeowner change orders — Nv cost vs sale price.
--
-- STATUS: PROPOSED — written, NOT applied. Apply in a later, approved pass.
-- Depends on 049 (replaces public.prime_co_review with the SAME signature). Does not
-- edit 049 or any other migration. No data backfill: COs approved before this is
-- applied keep the both-columns amounts they already added (sale price to Cost too).
--
-- Why: a residential homeowner CO has one amount, the sale price the homeowner pays.
-- 049 adds that amount to BOTH budget_items.budget_amount (Nv's Cost budget) and
-- owner_amount (Bank). A $25,000 upgrade that costs Nv $20,000 raised Cost by $25,000
-- and showed $5,000 of fake savings.
--
-- What changes:
--   1. prime_change_orders.nv_cost numeric, nullable. NULL means "same as amount"
--      (the sale price), so existing rows and COs saved with the field blank behave
--      exactly as today.
--   2. public.prime_co_review (approve / apply / reject-with-reverse), RESIDENTIAL only
--      (p_residential true): owner_amount (Bank) still moves by the sale price (the CO's
--      SOV amount, or the whole amount on its line); budget_amount (Cost) moves by
--      coalesce(nv_cost, sale price). The cost is applied on the CO's single budget
--      line; a residential CO with an nv_cost and more than one line is refused
--      ('prime_co_cost_multi_line') rather than inventing a split.
--      Commercial (p_residential false) is unchanged: the same delta on both columns.
--   prime_co_revise is NOT changed (it is for commercial applied COs; the API refuses
--   residential revise).
--   jobs.contract_value is never touched (it stays the base contract).
--
-- Rollback:
--   Re-run the prime_co_review definition from 049 (CREATE OR REPLACE, same signature).
--   ALTER TABLE public.prime_change_orders DROP COLUMN IF EXISTS nv_cost;  (only if unused)

BEGIN;

ALTER TABLE public.prime_change_orders ADD COLUMN IF NOT EXISTS nv_cost numeric;

COMMENT ON COLUMN public.prime_change_orders.nv_cost IS
  'Residential: Nv''s cost for this homeowner CO. NULL = same as amount (sale price). Cost budget moves by this; Bank moves by amount.';

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
  v_deltas jsonb := '{}'::jsonb;       -- sale price per line (Bank / owner_amount)
  v_cost_deltas jsonb := '{}'::jsonb;  -- Nv cost per line (Cost / budget_amount)
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
  v_key text;
BEGIN
  -- sov is json or jsonb depending on how the table was created; cast to whichever it is.
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_sov_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.prime_change_orders'::regclass AND a.attname = 'sov' AND NOT a.attisdropped;
  IF v_sov_type NOT IN ('json', 'jsonb') THEN RAISE EXCEPTION 'prime_co_sov_type'; END IF;

  SELECT id, job_id, status, amount, nv_cost, sov, budget_item_id, budget_applied, description INTO co
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

  -- Per-line change (sale price) from the SOV rows that point at a budget line.
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

  -- Cost per line. Commercial, and residential with no nv_cost: same as the price.
  -- Residential with nv_cost: that cost on the CO's single line (whether the line came
  -- from SOV rows or the whole-amount fallback). No multi-line cost split is invented.
  v_cost_deltas := v_deltas;
  IF v_residential AND co.nv_cost IS NOT NULL AND v_deltas <> '{}'::jsonb THEN
    IF (SELECT count(*) FROM jsonb_object_keys(v_deltas)) <> 1 THEN
      RAISE EXCEPTION 'prime_co_cost_multi_line';
    END IF;
    SELECT k INTO v_key FROM jsonb_object_keys(v_deltas) AS k;
    v_cost_deltas := jsonb_build_object(v_key, round(co.nv_cost::numeric, 2));
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

    -- Cost moves by the cost delta, Bank by the price delta (both read the OLD row values).
    UPDATE public.budget_items b
       SET budget_amount = coalesce(b.budget_amount, 0) + v_sign * coalesce((v_cost_deltas ->> d.key)::numeric, d.value::numeric),
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
      -- Record the applied line(s) as SOV rows when the CO had none (as before; the SOV
      -- amount stays the sale price).
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
                            'lines', (SELECT count(*) FROM jsonb_object_keys(v_deltas)), 'deltas', v_deltas,
                            'cost_deltas', v_cost_deltas);
END
$$;

REVOKE EXECUTE ON FUNCTION public.prime_co_review(uuid, uuid, text, jsonb, boolean, uuid, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prime_co_review(uuid, uuid, text, jsonb, boolean, uuid, boolean, boolean)
  TO service_role;

COMMIT;
