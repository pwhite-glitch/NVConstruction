-- Add versioning columns to drawings table
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES drawings(id) ON DELETE SET NULL;

-- Index for efficient current-drawing lookups
CREATE INDEX IF NOT EXISTS drawings_current_idx ON drawings(job_id, is_current);
