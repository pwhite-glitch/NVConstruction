-- Migration 003: Meeting minutes, action items, decisions
-- Run after 001 and 002.
-- Safe to re-run (IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS meetings (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id      text    NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  meeting_date date   NOT NULL,
  title       text,
  attendees   text,   -- free-text, comma-separated names
  raw_transcript text,
  created_by  uuid    REFERENCES profiles(id),
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id  uuid    NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  job_id      text    NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description text    NOT NULL,
  assigned_to text,
  due_date    date,
  status      text    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_decisions (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id  uuid    NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  job_id      text    NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description text    NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS meetings_job_id_idx ON meetings(job_id);
CREATE INDEX IF NOT EXISTS meeting_action_items_meeting_id_idx ON meeting_action_items(meeting_id);
CREATE INDEX IF NOT EXISTS meeting_action_items_job_id_status_idx ON meeting_action_items(job_id, status);
CREATE INDEX IF NOT EXISTS meeting_decisions_meeting_id_idx ON meeting_decisions(meeting_id);

-- RLS: PM sees all; subs cannot access meetings at all (internal tool)
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meetings_pm_only" ON meetings
  FOR ALL TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super'));

CREATE POLICY "action_items_pm_only" ON meeting_action_items
  FOR ALL TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super'));

CREATE POLICY "decisions_pm_only" ON meeting_decisions
  FOR ALL TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super'));

-- Rollback:
-- DROP TABLE IF EXISTS meeting_decisions;
-- DROP TABLE IF EXISTS meeting_action_items;
-- DROP TABLE IF EXISTS meetings;
