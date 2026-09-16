-- Migration 004: Add payment_type to purchase_orders
-- Run after 001, 002, 003.
-- Safe to run: ALTER TABLE ... ADD COLUMN IF NOT EXISTS.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'check'
  CHECK (payment_type IN ('check', 'reimbursement'));

-- Rollback:
-- ALTER TABLE purchase_orders DROP COLUMN IF EXISTS payment_type;
