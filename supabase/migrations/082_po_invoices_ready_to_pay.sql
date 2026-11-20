-- Migration 082 (prompt 99): Purchase Order "Ready to pay" for the admin team.
--
-- STATUS: PROPOSED — written, NOT applied. Peyton applies it by hand.
-- Idempotent (safe to run twice). Runs in one transaction.
--
-- What this adds
--   1. jobs.po_payer  text NOT NULL DEFAULT 'nv'  ('nv' | 'owner')
--        Job Details → "Who pays vendors (POs)". 'nv' = NV pays vendors (default; the PO
--        invoices go on the admin Ready to pay list). 'owner' = the owner pays vendors
--        directly (e.g. Braum's): invoices are tracked ("Paid by owner") but never put on
--        the admin check list. Separate from jobs.payment_type ("Who pays subs").
--   2. purchase_orders.payer_override  text NULL  ('nv' | 'owner')
--        Explicit per-PO exception to the job setting. NULL = follow the job.
--        Precedence (lib/po-invoices.js effectivePOPayer):
--          payer_override (when set)  →  jobs.po_payer  →  (before this migration only)
--          the legacy payment_type rule ('reimbursement' = NV pays, anything else = owner).
--        purchase_orders.payment_type stays (other code reads it) and the PO API keeps it in
--        step with the effective payer on every save. Its column default was always 'check',
--        so a stored 'check' is NOT treated as a choice. A stored 'reimbursement' WAS a
--        deliberate choice, so it is carried over as payer_override = 'nv' below (it then stays
--        NV-paid even if its job is switched to "Owner pays vendors").
--   3. public.po_invoices — vendor invoices against a PO (several per PO allowed).
--        due_date defaults to invoice_date + 30 (trigger; the API also fills it).
--        ready_to_pay requires an approval (approved_at). paid_amount accumulates partial
--        checks; paid_at is stamped when the invoice is paid in full.
--        paid_by_owner marks an owner-pays invoice as paid by the owner.
--        over_po_override_*: an Owner's override (with a note) when the PO's invoices total
--        more than the PO amount.
--        source: 'app' or 'backfill_083' (so migration 083 can be rolled back exactly).
--   4. role_permissions seed: 'po.mark_paid' (admin on; pm / apm / super off). Owners
--        (principal) always have every feature, as with the rest of the matrix.
--
-- Activity log: every invoice action is written to the existing change_log table
-- (entity_type 'po_invoice', entity_id = the invoice id) by /api/po-invoices.
--
-- RLS: purchase_orders is only read and written through service-role API routes
-- (/api/purchase-orders); no browser code touches it. po_invoices follows the same rule:
-- RLS ON with no policies, and anon / authenticated hold no table privileges. Only
-- /api/po-invoices (service role, session + role + job checks in code) reads or writes it.
--
-- The app works before this is applied: /api/po-invoices answers "migration 082 needed",
-- the admin Orders tab and the job PO cards show that message, the Job Details "Who pays
-- vendors" control is hidden, and cash math keeps the legacy payment_type rule.

BEGIN;

-- ── 1. Job setting ──────────────────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS po_payer text NOT NULL DEFAULT 'nv';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_po_payer_check') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_po_payer_check CHECK (po_payer IN ('nv', 'owner'));
  END IF;
END $$;

-- ── 2. Per-PO override ──────────────────────────────────────────────────────
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS payer_override text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_payer_override_check') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_payer_override_check
      CHECK (payer_override IS NULL OR payer_override IN ('nv', 'owner'));
  END IF;
END $$;

-- 'reimbursement' was the only non-default value a PM could pick: keep it as an explicit choice.
UPDATE public.purchase_orders
   SET payer_override = 'nv'
 WHERE payment_type = 'reimbursement' AND payer_override IS NULL;

-- ── 3. PO invoices ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.po_invoices (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: an invoice is a payment record; a PO can only be deleted as a draft anyway.
  po_id                  uuid          NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  invoice_number         text          NOT NULL,
  invoice_date           date          NOT NULL,
  amount                 numeric(12,2) NOT NULL CHECK (amount > 0),
  file_url               text,                       -- storage path in purchase-order-docs
  due_date               date,                       -- trigger: invoice_date + 30 when null
  approved_by            uuid,
  approved_at            timestamptz,
  ready_to_pay           boolean       NOT NULL DEFAULT false,
  paid_at                timestamptz,                -- stamped when paid in full
  paid_amount            numeric(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  last_payment_date      date,                       -- check date of the latest payment
  paid_by                uuid,                       -- who recorded the latest payment
  check_number           text,                       -- every check # recorded, comma separated
  payment_notes          text,
  paid_by_owner          boolean       NOT NULL DEFAULT false,
  sent_back_reason       text,
  sent_back_at           timestamptz,
  sent_back_by           uuid,
  over_po_override_by    uuid,
  over_po_override_note  text,
  over_po_override_at    timestamptz,
  source                 text          NOT NULL DEFAULT 'app',
  created_by             uuid,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT po_invoices_paid_not_over CHECK (paid_amount <= amount),
  CONSTRAINT po_invoices_ready_needs_approval CHECK (ready_to_pay = false OR approved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS po_invoices_po_id_idx ON public.po_invoices (po_id);
CREATE INDEX IF NOT EXISTS po_invoices_unpaid_due_idx ON public.po_invoices (due_date) WHERE paid_at IS NULL;

CREATE OR REPLACE FUNCTION public.po_invoices_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := NEW.invoice_date + 30;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.po_invoices_defaults() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS po_invoices_defaults_trg ON public.po_invoices;
CREATE TRIGGER po_invoices_defaults_trg
  BEFORE INSERT OR UPDATE ON public.po_invoices
  FOR EACH ROW EXECUTE FUNCTION public.po_invoices_defaults();

ALTER TABLE public.po_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.po_invoices FROM anon, authenticated;

-- ── 4. Permission ───────────────────────────────────────────────────────────
INSERT INTO public.role_permissions (role, feature_key, enabled) VALUES
  ('admin', 'po.mark_paid', true),
  ('pm',    'po.mark_paid', false),
  ('apm',   'po.mark_paid', false),
  ('super', 'po.mark_paid', false)
ON CONFLICT (role, feature_key) DO NOTHING;

COMMIT;

-- ROLLBACK (run manually only if needed; every PO invoice and payment record is lost):
-- BEGIN;
-- DELETE FROM public.role_permissions WHERE feature_key = 'po.mark_paid';
-- DROP TABLE IF EXISTS public.po_invoices;
-- DROP FUNCTION IF EXISTS public.po_invoices_defaults();
-- ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_payer_override_check;
-- ALTER TABLE public.purchase_orders DROP COLUMN IF EXISTS payer_override;
-- ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_po_payer_check;
-- ALTER TABLE public.jobs DROP COLUMN IF EXISTS po_payer;
-- COMMIT;
