-- Migration 008: Add flat markup amount to estimates
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS markup_flat NUMERIC DEFAULT 0;
