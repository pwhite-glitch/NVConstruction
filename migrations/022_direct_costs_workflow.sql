-- Migration 022: direct_costs workflow improvements
-- Adds fields needed for rejection-with-reason, preserving records, audit trail,
-- vendor tracking, and submitter notification dedup.

ALTER TABLE direct_costs
  ADD COLUMN IF NOT EXISTS vendor           text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at      timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by      uuid,
  ADD COLUMN IF NOT EXISTS review_cycle     int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviewed_by      uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS notif_sent_at    timestamptz;
