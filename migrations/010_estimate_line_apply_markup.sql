-- Migration 010: Per-line markup on estimate line items
-- NULL = inherit estimate-level markup_pct / 0 for markup_flat (backward compatible)
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS markup_pct NUMERIC DEFAULT NULL;
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS markup_flat NUMERIC DEFAULT NULL;
