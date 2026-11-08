-- Migration 059: first review of a draw-tagged billing only while its draw is still OPEN.
--
-- STATUS: PROPOSED — written, NOT applied. Apply in a later, approved pass.
-- Does not edit any other migration. No data changes.
--
-- Why: prompt 61 lets a PM do the first review (pending → approved / rejected) of a sub
-- invoice that is already on an OPEN Draw Request. /api/billing-entry checked the draw's
-- status in one query and wrote billing_submissions in another, so a Close of that draw
-- landing in between let the approval (or the rejection, which also takes the invoice off
-- the draw) change a CLOSED draw's package. Draw status lives on draw_requests, so a
-- compare-and-set on billing_submissions alone can't see it.
--
-- What this adds:
--   public.billing_first_review(p_billing_id uuid, p_draw_id uuid, p_status text, p_patch jsonb)
--     In ONE transaction:
--       1. SELECT the draw FOR SHARE, only if it is still status = 'open'. FOR SHARE makes a
--          concurrent Close (UPDATE draw_requests … status = 'closed') wait until this
--          transaction ends, and if a Close is already in flight this waits for it and then
--          re-checks the row, so a draw that became closed is seen as closed.
--          Not open (or gone) → returns {"updated": false, "reason": "draw_not_open"}.
--       2. UPDATE billing_submissions with p_patch, only WHERE id = p_billing_id AND
--          status = 'pending' AND draw_request_id = p_draw_id (the row is still exactly the
--          pending invoice on that draw that the API read).
--          0 rows → {"updated": false, "reason": "changed"}.
--       Success → {"updated": true}.
--     p_status must be 'approved' or 'rejected' and must equal p_patch->>'status'.
--     p_patch may clear draw_request_id (null) but may not move it to another draw.
--     Only real billing_submissions columns are written; id / job_id / sub_id / created_at
--     and the money columns (amount_billed, retainage_*, nv_reimbursement, billing_period)
--     are refused — they stay locked while tagged (the API already enforces this).
--     Keys that are not columns of billing_submissions (e.g. invoice_date before 032) are
--     skipped, matching the API's schema-cache retry.
--   Execute: service_role only (the API calls it with the service key).
--
-- Until this is applied, /api/billing-entry refuses a first review on a draw with 409
-- (migration_required) and writes nothing / sends no email or waiver.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.billing_first_review(uuid, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.billing_first_review(
  p_billing_id uuid,
  p_draw_id    uuid,
  p_status     text,
  p_patch      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_set   text;
  v_bad   text;
  v_id    uuid;
BEGIN
  IF p_billing_id IS NULL OR p_draw_id IS NULL THEN
    RAISE EXCEPTION 'billing_first_review_bad_args';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'billing_first_review_bad_status';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR (p_patch->>'status') IS DISTINCT FROM p_status THEN
    RAISE EXCEPTION 'billing_first_review_bad_patch';
  END IF;
  -- May leave the draw (null) but never move to another one.
  IF p_patch ? 'draw_request_id'
     AND jsonb_typeof(p_patch->'draw_request_id') <> 'null'
     AND (p_patch->>'draw_request_id') IS DISTINCT FROM p_draw_id::text THEN
    RAISE EXCEPTION 'billing_first_review_moves_draw';
  END IF;

  SELECT k INTO v_bad
  FROM jsonb_object_keys(p_patch) AS k
  WHERE k IN ('id', 'job_id', 'sub_id', 'created_at',
              'amount_billed', 'retainage_pct', 'retainage_held', 'nv_reimbursement', 'billing_period')
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'billing_first_review_locked_field: %', v_bad;
  END IF;

  -- 1. The draw must still be open; hold it so Close waits for this review.
  PERFORM 1 FROM public.draw_requests
   WHERE id = p_draw_id AND status = 'open'
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'draw_not_open');
  END IF;

  -- 2. Guarded billing write (only real columns from the patch, typed via the row type).
  SELECT string_agg(format('%I = r.%I', c.column_name::text, c.column_name::text), ', ')
    INTO v_set
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'billing_submissions'
     AND p_patch ? (c.column_name::text);
  IF v_set IS NULL THEN
    RAISE EXCEPTION 'billing_first_review_bad_patch';
  END IF;

  EXECUTE format(
    'UPDATE public.billing_submissions b SET %s
       FROM jsonb_populate_record(NULL::public.billing_submissions, $1) r
      WHERE b.id = $2 AND b.status = ''pending'' AND b.draw_request_id = $3
      RETURNING b.id', v_set)
    INTO v_id
    USING p_patch, p_billing_id, p_draw_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'changed');
  END IF;
  RETURN jsonb_build_object('updated', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.billing_first_review(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_first_review(uuid, uuid, text, jsonb)
  TO service_role;
