-- 015_notifications.sql
-- In-app notification feed for subs and PMs

CREATE TABLE IF NOT EXISTS notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  recipient_id uuid        NOT NULL,           -- auth.users(id) — who receives it
  type         text        NOT NULL,           -- 'billing_approved','billing_rejected','punch_assigned','rfi_answered'
  title        text        NOT NULL,
  body         text,
  link         text,                           -- tab key or relative URL to jump to
  job_id       uuid        REFERENCES jobs(id) ON DELETE SET NULL,
  entity_type  text,
  entity_id    uuid,
  read_at      timestamptz,
  dedup_key    text                            -- programmatic duplicate guard
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx    ON notifications(recipient_id, read_at) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY "Users see own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

-- Users can mark their own notifications as read
CREATE POLICY "Users mark own notifications read"
  ON notifications FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- Service role (server-side) can insert
CREATE POLICY "Service role can insert notifications"
  ON notifications FOR INSERT
  TO service_role
  WITH CHECK (true);
