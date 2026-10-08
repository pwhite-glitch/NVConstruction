-- Migration 018: Role preview sessions and staging data flags
-- Run at: https://supabase.com/dashboard/project/{your-project}/sql/new

-- ── preview_sessions ──────────────────────────────────────────────────────────
-- Records every server-enforced role preview started by an admin/PM user.
CREATE TABLE IF NOT EXISTS preview_sessions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_by         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preview_role       text        NOT NULL CHECK (preview_role IN (
    'pm','apm','super','admin','subcontractor','sub_pm','sub_admin','owner'
  )),
  preview_company_id uuid,       -- required when preview_role is a sub role
  context            jsonb       NOT NULL DEFAULT '{}',
  started_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  user_agent         text,
  ip_address         inet
);

CREATE INDEX IF NOT EXISTS preview_sessions_by_user
  ON preview_sessions(started_by);
CREATE INDEX IF NOT EXISTS preview_sessions_active
  ON preview_sessions(started_by)
  WHERE ended_at IS NULL;

-- RLS: session owner can read/update their own rows; pm/admin can insert
ALTER TABLE preview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "preview_sessions_select_own"
  ON preview_sessions FOR SELECT TO authenticated
  USING (started_by = auth.uid());

CREATE POLICY "preview_sessions_insert_pm"
  ON preview_sessions FOR INSERT TO authenticated
  WITH CHECK (
    started_by = auth.uid()
    AND get_my_role() IN ('pm', 'admin')
  );

CREATE POLICY "preview_sessions_update_own"
  ON preview_sessions FOR UPDATE TO authenticated
  USING (started_by = auth.uid());

-- ── staging data flag ─────────────────────────────────────────────────────────
-- Preview companies and jobs are flagged so they never appear in real reports.
ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS is_preview_data boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_preview_data boolean NOT NULL DEFAULT false;
