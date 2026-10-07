-- 014_change_log.sql
-- Audit log for high-value changes: billing status, contract values, job status, COs

CREATE TABLE IF NOT EXISTS change_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  job_id       uuid        REFERENCES jobs(id) ON DELETE CASCADE,
  entity_type  text        NOT NULL,   -- 'billing', 'subcontract', 'change_order', 'job', 'coi'
  entity_id    uuid,
  field_name   text,                   -- 'status', 'contract_value', 'amount_billed', etc.
  old_value    text,
  new_value    text,
  changed_by   uuid,                   -- auth.users(id)
  changed_by_name text,
  note         text                    -- human-readable summary
);

CREATE INDEX IF NOT EXISTS change_log_job_id_idx    ON change_log(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_log_created_at_idx ON change_log(created_at DESC);

ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;

-- PM roles can read all log entries
CREATE POLICY "PM roles can read change_log"
  ON change_log FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('pm','apm','super','admin')
  );

-- Authenticated users may insert their own entries (used by the /api/log-change endpoint)
CREATE POLICY "Authenticated can insert change_log"
  ON change_log FOR INSERT
  TO authenticated
  WITH CHECK (changed_by = auth.uid());
