-- Migration 039: Estimate -> job budget, in one transaction.
-- Run after migration 038. Review before applying; nothing in the app calls
-- these functions until this migration is applied.
--
-- Problem: "Convert to Job" (EstimateWorkspace) inserted budget_items with
-- columns that don't exist (amount, category) and never checked the error,
-- so every converted job got an empty budget. It also never set
-- jobs.contract_value, jobs.source_estimate_id or estimates.job_id.
--
-- What this adds (all called only by /api/estimates/to-job with the service
-- role; EXECUTE is revoked from PUBLIC, anon and authenticated):
--   1. budget_line_references(job_id): which tables still point at a job's
--      budget lines. Looks at every FK to budget_items plus the known
--      columns that reference budget lines without an FK (JSON allocations
--      on subcontracts, the SOV on prime change orders). Used to refuse
--      "Replace" when anything depends on the lines.
--   2. convert_estimate_to_job(...): creates the job, its budget lines,
--      contract_value, source_estimate_id, estimates.job_id/status, the APM
--      assignment and a change_log row. All or nothing.
--   3. link_estimate_to_job(...): links an estimate to an existing job: add
--      to or replace its budget lines (with merges), optionally set the
--      contract value, set both link columns, mark the estimate won, log it.
--      Refuses if the estimate changed (expected_updated_at), if the job's
--      budget lines / contract value changed since the user looked, if
--      either side is already linked, or (Replace) if the lines are
--      referenced.
--
-- Errors are raised as 'NV_<CODE>: <message>'; the API route maps the code
-- to an HTTP status and shows the message.
--
-- Audit: uses the existing change_log table (014); no new table.

-- Double links are prevented by row locks: both functions lock the estimate
-- row (FOR UPDATE) and link also locks the job row before checking.

-- ── 1. budget_line_references ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.budget_line_references(p_job_id uuid)
RETURNS TABLE(source_table text, source_column text, ref_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ids text[];
  r     record;
  n     bigint;
BEGIN
  SELECT coalesce(array_agg(id::text), '{}') INTO v_ids FROM budget_items WHERE job_id = p_job_id;
  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  FOR r IN
    WITH fk AS (
      -- Every single-column FK that points at budget_items.
      SELECT ns.nspname::text AS sch, cl.relname::text AS tbl, att.attname::text AS col, 'id'::text AS kind
      FROM pg_constraint con
      JOIN pg_class cl      ON cl.oid = con.conrelid
      JOIN pg_namespace ns  ON ns.oid = cl.relnamespace
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f'
        AND con.confrelid = 'public.budget_items'::regclass
        AND cardinality(con.conkey) = 1
        AND con.conrelid <> 'public.budget_items'::regclass
    ),
    known(tbl, col, kind) AS (
      -- Columns the app uses to point at budget lines, FK or not.
      VALUES
        ('subcontracts',             'budget_item_id',     'id'),
        ('subcontracts',             'budget_allocations', 'json_array'),
        ('subcontract_sov_lines',    'budget_item_id',     'id'),
        ('purchase_orders',          'budget_item_id',     'id'),
        ('aia_application_lines',    'budget_item_id',     'id'),
        ('direct_costs',             'budget_item_id',     'id'),
        ('general_conditions',       'budget_item_id',     'id'),
        ('employee_job_allocations', 'budget_item_id',     'id'),
        ('prime_change_orders',      'sov',                'json_array')
    ),
    present AS (
      SELECT 'public'::text AS sch, k.tbl, k.col, k.kind
      FROM known k
      JOIN information_schema.columns ic
        ON ic.table_schema = 'public' AND ic.table_name = k.tbl AND ic.column_name = k.col
    )
    SELECT DISTINCT sch, tbl, col, kind FROM (SELECT * FROM fk UNION ALL SELECT * FROM present) x
  LOOP
    IF r.kind = 'id' THEN
      EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::text = ANY($1)', r.sch, r.tbl, r.col)
        INTO n USING v_ids;
    ELSE
      EXECUTE format(
        'SELECT count(*) FROM %1$I.%2$I t
          WHERE jsonb_typeof(t.%3$I::jsonb) = ''array''
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.%3$I::jsonb) e
                         WHERE jsonb_typeof(e) = ''object'' AND e->>''budget_item_id'' = ANY($1))',
        r.sch, r.tbl, r.col)
        INTO n USING v_ids;
    END IF;
    IF n > 0 THEN
      source_table  := r.tbl;
      source_column := r.col;
      ref_count     := n;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ── 2. convert_estimate_to_job ───────────────────────────────────────────────
-- p_job:   { job_number, project_name, owner_name, start_date }
-- p_lines: [{ description, cost_code, budget_amount, owner_amount, sort_order }]
CREATE OR REPLACE FUNCTION public.convert_estimate_to_job(
  p_estimate_id          uuid,
  p_expected_updated_at  timestamptz,
  p_job                  jsonb,
  p_lines                jsonb,
  p_contract_value       numeric,
  p_user_id              uuid,
  p_user_role            text,
  p_user_name            text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  est      estimates%ROWTYPE;
  v_job_id uuid;
  v_added  int := 0;
  v_now    timestamptz := now();
BEGIN
  SELECT * INTO est FROM estimates WHERE id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NV_NOT_FOUND: Estimate not found.';
  END IF;
  IF est.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'NV_STALE: Someone else saved this estimate. Reload to see the latest.';
  END IF;
  IF est.job_id IS NOT NULL OR EXISTS (SELECT 1 FROM jobs WHERE source_estimate_id = p_estimate_id) THEN
    RAISE EXCEPTION 'NV_ALREADY_LINKED: This estimate is already linked to a job.';
  END IF;
  IF coalesce(btrim(p_job->>'job_number'), '') = '' THEN
    RAISE EXCEPTION 'NV_INVALID: Job number is required.';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'NV_INVALID: Budget lines are missing.';
  END IF;

  INSERT INTO jobs (job_number, project_name, owner_name, start_date, status, billing_type, nv_role, job_type,
                    contract_value, source_estimate_id)
  VALUES (btrim(p_job->>'job_number'),
          p_job->>'project_name',
          nullif(p_job->>'owner_name', ''),
          nullif(p_job->>'start_date', '')::date,
          'active', 'aia', 'gc', 'commercial',
          p_contract_value, p_estimate_id)
  RETURNING id INTO v_job_id;

  INSERT INTO budget_items (job_id, description, cost_code, budget_amount, owner_amount, sort_order)
  SELECT v_job_id, l.description, nullif(l.cost_code, ''), l.budget_amount, l.owner_amount, l.sort_order
  FROM jsonb_to_recordset(p_lines) AS l(description text, cost_code text, budget_amount numeric, owner_amount numeric, sort_order int);
  GET DIAGNOSTICS v_added = ROW_COUNT;

  UPDATE estimates SET job_id = v_job_id, status = 'won', updated_at = v_now WHERE id = p_estimate_id;

  -- Same as dashboard "New job": an APM who creates a job is assigned to it.
  IF p_user_role = 'apm' THEN
    INSERT INTO pm_job_assignments (job_id, user_id, assigned_by) VALUES (v_job_id, p_user_id, p_user_id);
  END IF;

  INSERT INTO change_log (job_id, entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_by_name, note)
  VALUES (v_job_id, 'estimate', p_estimate_id, 'source_estimate_id', NULL, p_estimate_id::text, p_user_id, p_user_name,
          format('Converted estimate %s to job %s: %s budget line(s), contract value %s',
                 coalesce(est.estimate_number, p_estimate_id::text), btrim(p_job->>'job_number'), v_added,
                 coalesce(p_contract_value::text, 'not set')));

  RETURN jsonb_build_object('job_id', v_job_id, 'lines_added', v_added, 'estimate_updated_at', v_now);
END;
$$;

-- ── 3. link_estimate_to_job ──────────────────────────────────────────────────
-- p_expected_lines: the job's budget lines as the user saw them
--                   [{ id, description, cost_code, budget_amount, owner_amount }]
-- p_expected_contract_value: the job's contract_value as the user saw it
-- p_mode:  'add' | 'replace' (required when the job has budget lines)
-- p_lines: [{ description, cost_code, budget_amount, owner_amount, sort_order, merge_into }]
--          merge_into = id of an existing line to add the amounts to (add mode only)
CREATE OR REPLACE FUNCTION public.link_estimate_to_job(
  p_estimate_id             uuid,
  p_expected_updated_at     timestamptz,
  p_job_id                  uuid,
  p_expected_lines          jsonb,
  p_expected_contract_value numeric,
  p_mode                    text,
  p_lines                   jsonb,
  p_set_contract            boolean,
  p_contract_value          numeric,
  p_user_id                 uuid,
  p_user_name               text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  est         estimates%ROWTYPE;
  j           jobs%ROWTYPE;
  v_now       timestamptz := now();
  v_cur_count int;
  v_exp_count int;
  v_has_lines boolean;
  v_refs      text;
  v_deleted   text;
  v_del_count int := 0;
  v_added     int := 0;
  v_merged    int := 0;
  v_targets   int;
  v_offset    int;
BEGIN
  -- Estimate: lock, freshness, not already linked.
  SELECT * INTO est FROM estimates WHERE id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NV_NOT_FOUND: Estimate not found.';
  END IF;
  IF est.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'NV_STALE: Someone else saved this estimate. Reload to see the latest.';
  END IF;
  IF est.job_id IS NOT NULL OR EXISTS (SELECT 1 FROM jobs WHERE source_estimate_id = p_estimate_id) THEN
    RAISE EXCEPTION 'NV_ALREADY_LINKED: This estimate is already linked to a job.';
  END IF;

  -- Job: lock, eligible, not already linked.
  SELECT * INTO j FROM jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NV_NOT_FOUND: Job not found.';
  END IF;
  IF j.source_estimate_id IS NOT NULL THEN
    RAISE EXCEPTION 'NV_JOB_LINKED: Job % is already linked to another estimate.', j.job_number;
  END IF;
  IF j.status IS DISTINCT FROM 'active' OR coalesce(j.is_preview_data, false) OR coalesce(j.archived, false) THEN
    RAISE EXCEPTION 'NV_JOB_NOT_ELIGIBLE: Job % is not an active, non-archived, non-preview job.', j.job_number;
  END IF;

  -- The job's budget lines and contract value must be exactly what the user saw.
  PERFORM 1 FROM budget_items WHERE job_id = p_job_id FOR UPDATE;
  IF jsonb_typeof(p_expected_lines) IS DISTINCT FROM 'array' OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'NV_INVALID: Budget lines are missing.';
  END IF;
  SELECT count(*) INTO v_cur_count FROM budget_items WHERE job_id = p_job_id;
  SELECT count(DISTINCT e.id) INTO v_exp_count
    FROM jsonb_to_recordset(p_expected_lines) AS e(id uuid);
  IF v_cur_count <> v_exp_count
     OR v_exp_count <> jsonb_array_length(p_expected_lines)
     OR EXISTS (
       SELECT 1 FROM budget_items b
       WHERE b.job_id = p_job_id
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_to_recordset(p_expected_lines)
                    AS e(id uuid, description text, cost_code text, budget_amount numeric, owner_amount numeric)
           WHERE e.id = b.id
             AND e.description   IS NOT DISTINCT FROM b.description::text
             AND e.cost_code     IS NOT DISTINCT FROM b.cost_code::text
             AND e.budget_amount IS NOT DISTINCT FROM b.budget_amount::numeric
             AND e.owner_amount  IS NOT DISTINCT FROM b.owner_amount::numeric))
     OR j.contract_value::numeric IS DISTINCT FROM p_expected_contract_value THEN
    RAISE EXCEPTION 'NV_JOB_CHANGED: Job % changed since you opened it. Review it again.', j.job_number;
  END IF;

  v_has_lines := v_cur_count > 0;
  IF v_has_lines AND p_mode IS DISTINCT FROM 'add' AND p_mode IS DISTINCT FROM 'replace' THEN
    RAISE EXCEPTION 'NV_MODE_REQUIRED: This job already has budget lines. Choose Add to existing or Replace.';
  END IF;
  IF NOT v_has_lines THEN
    p_mode := 'add';
  END IF;

  -- Replace: refuse if anything references the lines, then delete exactly the
  -- lines the user saw (never a line added since).
  IF p_mode = 'replace' THEN
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS l(merge_into uuid) WHERE l.merge_into IS NOT NULL) THEN
      RAISE EXCEPTION 'NV_INVALID: Merging is only possible when adding to existing lines.';
    END IF;
    SELECT string_agg(format('%s.%s (%s)', source_table, source_column, ref_count), ', ')
      INTO v_refs FROM budget_line_references(p_job_id);
    IF v_refs IS NOT NULL THEN
      RAISE EXCEPTION 'NV_REFERENCED: Cannot replace: these records use the job''s budget lines: %', v_refs;
    END IF;
    SELECT string_agg(coalesce(nullif(cost_code::text, '') || ' ', '') || coalesce(description, '') ||
                      ' (' || coalesce(budget_amount::text, '0') || ')', '; ' ORDER BY sort_order)
      INTO v_deleted
      FROM budget_items
     WHERE job_id = p_job_id
       AND id IN (SELECT e.id FROM jsonb_to_recordset(p_expected_lines) AS e(id uuid));
    DELETE FROM budget_items
     WHERE job_id = p_job_id
       AND id IN (SELECT e.id FROM jsonb_to_recordset(p_expected_lines) AS e(id uuid));
    GET DIAGNOSTICS v_del_count = ROW_COUNT;
  END IF;

  -- Merges: every target must be one of this job's lines.
  SELECT count(DISTINCT l.merge_into) INTO v_targets
    FROM jsonb_to_recordset(p_lines) AS l(merge_into uuid) WHERE l.merge_into IS NOT NULL;
  IF v_targets > 0 THEN
    UPDATE budget_items b
       SET budget_amount = coalesce(b.budget_amount, 0) + m.budget_amount,
           owner_amount  = coalesce(b.owner_amount, 0)  + m.owner_amount
      FROM (SELECT l.merge_into, sum(coalesce(l.budget_amount, 0)) AS budget_amount, sum(coalesce(l.owner_amount, 0)) AS owner_amount
              FROM jsonb_to_recordset(p_lines) AS l(merge_into uuid, budget_amount numeric, owner_amount numeric)
             WHERE l.merge_into IS NOT NULL
             GROUP BY l.merge_into) m
     WHERE b.id = m.merge_into AND b.job_id = p_job_id;
    GET DIAGNOSTICS v_merged = ROW_COUNT;
    IF v_merged <> v_targets THEN
      RAISE EXCEPTION 'NV_INVALID: A merge target is not a budget line on this job.';
    END IF;
  END IF;

  -- New lines go after whatever remains on the job.
  SELECT coalesce(max(sort_order) + 1, 0) INTO v_offset FROM budget_items WHERE job_id = p_job_id;
  INSERT INTO budget_items (job_id, description, cost_code, budget_amount, owner_amount, sort_order)
  SELECT p_job_id, l.description, nullif(l.cost_code, ''), l.budget_amount, l.owner_amount, v_offset + row_number() OVER (ORDER BY l.sort_order) - 1
  FROM jsonb_to_recordset(p_lines) AS l(description text, cost_code text, budget_amount numeric, owner_amount numeric, sort_order int, merge_into uuid)
  WHERE l.merge_into IS NULL;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  UPDATE jobs
     SET source_estimate_id = p_estimate_id,
         contract_value     = CASE WHEN p_set_contract THEN p_contract_value ELSE contract_value END
   WHERE id = p_job_id;

  UPDATE estimates SET job_id = p_job_id, status = 'won', updated_at = v_now WHERE id = p_estimate_id;

  INSERT INTO change_log (job_id, entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_by_name, note)
  VALUES (p_job_id, 'estimate', p_estimate_id, 'source_estimate_id', NULL, p_estimate_id::text, p_user_id, p_user_name,
          format('Linked estimate %s to job %s (%s): %s line(s) added, %s merged, %s deleted%s',
                 coalesce(est.estimate_number, p_estimate_id::text), j.job_number, p_mode,
                 v_added, v_merged, v_del_count,
                 CASE WHEN v_deleted IS NULL THEN '' ELSE '. Deleted: ' || v_deleted END));

  IF p_set_contract AND j.contract_value IS DISTINCT FROM p_contract_value THEN
    INSERT INTO change_log (job_id, entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_by_name, note)
    VALUES (p_job_id, 'job', p_job_id, 'contract_value', j.contract_value::text, p_contract_value::text, p_user_id, p_user_name,
            format('Contract value set from estimate %s', coalesce(est.estimate_number, p_estimate_id::text)));
  END IF;

  RETURN jsonb_build_object('job_id', p_job_id, 'mode', p_mode, 'lines_added', v_added, 'lines_merged', v_merged,
                            'lines_deleted', v_del_count, 'estimate_updated_at', v_now);
END;
$$;

-- ── 4. Service role only ─────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.budget_line_references(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.convert_estimate_to_job(uuid, timestamptz, jsonb, jsonb, numeric, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_estimate_to_job(uuid, timestamptz, uuid, jsonb, numeric, text, jsonb, boolean, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.budget_line_references(uuid) TO service_role;
GRANT  EXECUTE ON FUNCTION public.convert_estimate_to_job(uuid, timestamptz, jsonb, jsonb, numeric, uuid, text, text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.link_estimate_to_job(uuid, timestamptz, uuid, jsonb, numeric, text, jsonb, boolean, numeric, uuid, text) TO service_role;

-- ── Read-only audits (run before applying) ───────────────────────────────────
-- Existing duplicate source_estimate_id links (should be none):
--   SELECT source_estimate_id, count(*) FROM jobs WHERE source_estimate_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- Columns this migration assumes exist:
--   SELECT table_name, column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND (table_name, column_name) IN (('budget_items','cost_code'),('budget_items','budget_amount'),('budget_items','owner_amount'),
--           ('budget_items','sort_order'),('jobs','contract_value'),('jobs','archived'),('jobs','is_preview_data'),
--           ('jobs','source_estimate_id'),('estimates','job_id'),('estimates','updated_at'),('pm_job_assignments','assigned_by'));
-- Jobs created by the old Convert to Job (empty budgets, no link):
--   SELECT e.id AS estimate_id, e.estimate_number, j.id AS job_id, j.job_number, j.project_name
--     FROM estimates e JOIN jobs j ON j.project_name = e.project_name
--    WHERE e.status = 'won' AND e.job_id IS NULL
--      AND NOT EXISTS (SELECT 1 FROM budget_items b WHERE b.job_id = j.id);
