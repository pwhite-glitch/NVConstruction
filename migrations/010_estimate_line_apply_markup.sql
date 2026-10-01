-- Migration 010: Per-line markup toggle on estimate line items
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS apply_markup BOOLEAN DEFAULT true;
