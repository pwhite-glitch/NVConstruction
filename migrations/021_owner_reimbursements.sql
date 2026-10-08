-- Migration 021: Owner Reimbursements
-- Adds reimbursable expense tracking to direct_costs and creates
-- owner_reimb_invoices, owner_reimb_invoice_lines, owner_reimb_payments tables.
-- Backward compatible: all new columns have defaults or are nullable.

-- ── Add columns to direct_costs ──────────────────────────────────────────────
ALTER TABLE direct_costs
  ADD COLUMN IF NOT EXISTS bill_to_owner  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_auth_ref text,
  ADD COLUMN IF NOT EXISTS nv_paid        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nv_paid_date   date,
  ADD COLUMN IF NOT EXISTS nv_paid_ref    text,
  ADD COLUMN IF NOT EXISTS billing_route  text
    CONSTRAINT direct_costs_billing_route_check
    CHECK (billing_route IN ('reimbursement', 'pay_app', 'change_order'));

-- ── Owner reimbursement invoices ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS owner_reimb_invoices (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  invoice_number  text        NOT NULL,
  bill_to_name    text        NOT NULL,
  bill_to_address text,
  issue_date      date        NOT NULL,
  due_date        date,
  notes           text,
  markup_pct      numeric(5,2) NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','issued','partially_paid','paid','overdue','voided')),
  voided_at       timestamptz,
  voided_by       uuid        REFERENCES auth.users(id),
  void_reason     text,
  created_by      uuid        NOT NULL REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_reimb_invoices_uniq UNIQUE (job_id, invoice_number)
);

-- ── Invoice lines (one per expense or ad-hoc item) ───────────────────────────
CREATE TABLE IF NOT EXISTS owner_reimb_invoice_lines (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid        NOT NULL REFERENCES owner_reimb_invoices(id) ON DELETE CASCADE,
  direct_cost_id  uuid        REFERENCES direct_costs(id) ON DELETE SET NULL,
  description     text        NOT NULL,
  expense_date    date,
  vendor          text,
  expense_amount  numeric(12,2) NOT NULL,  -- actual NV cost (informational)
  markup_pct      numeric(5,2)  NOT NULL DEFAULT 0,
  billed_amount   numeric(12,2) NOT NULL,  -- amount charged to owner
  sort_order      int          NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

-- ── Payment receipts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS owner_reimb_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid        NOT NULL REFERENCES owner_reimb_invoices(id) ON DELETE CASCADE,
  received_date   date        NOT NULL,
  amount          numeric(12,2) NOT NULL,
  payment_method  text,
  reference       text,
  notes           text,
  voided          boolean      NOT NULL DEFAULT false,
  voided_at       timestamptz,
  void_reason     text,
  recorded_by     uuid        NOT NULL REFERENCES auth.users(id),
  created_at      timestamptz  NOT NULL DEFAULT now()
);
