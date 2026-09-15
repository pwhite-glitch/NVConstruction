-- Migration 001: Add hide_budget column to profiles
-- Rollout order: run this FIRST, before deploying any code that references hide_budget.
-- Preflight: verify the column does not already exist.
-- Rollback: ALTER TABLE profiles DROP COLUMN IF EXISTS hide_budget;

-- Preflight check (run before applying):
-- SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name='hide_budget';

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hide_budget boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.hide_budget IS
  'When true, this user cannot see the Budget tab in job detail. Set per-user by a PM.';
