-- Migration 009: Add start_date and special_terms to subcontracts
ALTER TABLE subcontracts ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE subcontracts ADD COLUMN IF NOT EXISTS special_terms TEXT;
