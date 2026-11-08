-- Migration 050: Metal-building order forms, native e-sign, deposit request,
-- supplier turn-in and 40/40/20 commission inputs.
--
-- ADDITIVE ONLY. No data backfill, no UPDATE/DELETE of business rows.
-- Nothing here changes roofing or subcontract behavior.
--
--   1. sales_order_docs.category: adds 'supplier_order_form' and 'client_order_form'
--      (all seven existing categories kept).
--   2. signing_requests: optional association to a metal-building sales order and the
--      exact pinned client order form (doc id + storage path + SHA-256), snapshots of
--      the deposit amount and supplier used at send time, and the signed-copy record.
--      job_id becomes nullable (a sales order is not a job). A NOT VALID check keeps
--      new MB rows from also pointing at a job/subcontract; existing rows untouched.
--   3. mb_order_workflow: per-order durable state for the automatic deposit-request
--      email (idempotency key, claim, attempts, outcome), the deposit-receipt marker
--      and the "turn in supplier order form" actor/time.
--   4. mb_order_private: concrete charge / concrete cost (commission inputs).
--   5. company_payment_settings: the Owner-edited payment instructions (one row).
--   6. Two guard triggers (MB rows only) so signing / received-deposit locks hold at the
--      database even when a request lands between the API's check and its write.
--
-- Tables 3-5 have RLS enabled with NO policies and table privileges revoked from
-- anon/authenticated, so only the service role (API routes) can read or write them.
-- The API decides who sees what (Owner = role 'principal').
-- No banking data is seeded.

-- ── 1. Document categories ────────────────────────────────────────────────────
-- Drop ONLY the category enumeration: our own named constraint (re-run safety) and the
-- original inline CHECK from migration 023, recognised as a single-column check on
-- category whose literal set is exactly the old seven values. Any other CHECK that
-- happens to mention "category" (compound / other columns / other values) is left alone.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'sales_order_docs' AND con.contype = 'c'
  LOOP
    IF c.conname = 'sales_order_docs_category_check'
       OR (
         c.def ~* '^CHECK \(+category(::text)? = ANY \(+ARRAY\['
         AND c.def !~* '\m(AND|OR)\M'
         AND (SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) FROM regexp_matches(c.def, '''([^'']*)''', 'g') AS m)
             = ARRAY['completion','contract','general','other','permit','photo','quote']::text[]
       )
    THEN
      EXECUTE format('ALTER TABLE public.sales_order_docs DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.sales_order_docs
  ADD CONSTRAINT sales_order_docs_category_check
  CHECK (category IN (
    'contract','quote','photo','permit','completion','other','general',
    'supplier_order_form','client_order_form'
  ));

-- ── 2. Native signing association for metal-building sales orders ─────────────
ALTER TABLE public.signing_requests
  ADD COLUMN IF NOT EXISTS sales_order_id          uuid REFERENCES public.sales_orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sales_doc_id            uuid REFERENCES public.sales_order_docs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS document_storage_path   text,
  ADD COLUMN IF NOT EXISTS document_file_name      text,
  ADD COLUMN IF NOT EXISTS document_sha256         text,
  ADD COLUMN IF NOT EXISTS deposit_amount_snapshot numeric,
  ADD COLUMN IF NOT EXISTS mb_supplier_id          uuid REFERENCES public.mb_suppliers(id),
  ADD COLUMN IF NOT EXISTS signed_document_path    text,
  ADD COLUMN IF NOT EXISTS signed_doc_id           uuid REFERENCES public.sales_order_docs(id) ON DELETE RESTRICT;

-- A sales-order request has no job. Dropping NOT NULL is a no-op if already nullable.
ALTER TABLE public.signing_requests ALTER COLUMN job_id DROP NOT NULL;

-- Every new/updated row is exactly one of:
--   a job/subcontract request: job_id set, no sales order; or
--   an MB request: sales order set, no job/subcontract, pinned doc + hash + deposit snapshot.
-- (So a row with neither job_id nor sales_order_id is refused.) NOT VALID: existing rows
-- are not scanned or rewritten; they were all created with job_id NOT NULL.
ALTER TABLE public.signing_requests DROP CONSTRAINT IF EXISTS signing_requests_sales_order_shape;
ALTER TABLE public.signing_requests
  ADD CONSTRAINT signing_requests_sales_order_shape
  CHECK (
    (job_id IS NOT NULL AND sales_order_id IS NULL)
    OR (
      sales_order_id IS NOT NULL
      AND job_id IS NULL AND subcontract_id IS NULL
      AND sales_doc_id IS NOT NULL
      AND document_sha256 IS NOT NULL
      AND deposit_amount_snapshot IS NOT NULL AND deposit_amount_snapshot > 0
    )
  ) NOT VALID;

-- At most one pending and one signed client-order-form request per sales order.
CREATE UNIQUE INDEX IF NOT EXISTS signing_requests_one_pending_per_sales_order
  ON public.signing_requests(sales_order_id) WHERE sales_order_id IS NOT NULL AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS signing_requests_one_signed_per_sales_order
  ON public.signing_requests(sales_order_id) WHERE sales_order_id IS NOT NULL AND status = 'signed';
CREATE INDEX IF NOT EXISTS signing_requests_sales_doc_idx
  ON public.signing_requests(sales_doc_id) WHERE sales_doc_id IS NOT NULL;

-- ── 3. Workflow state (deposit-request email, receipt marker, supplier turn-in) ─
CREATE TABLE IF NOT EXISTS public.mb_order_workflow (
  order_id                     uuid        PRIMARY KEY REFERENCES public.sales_orders(id) ON DELETE RESTRICT,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  -- Deposit-request email. One automatic request per signed client order form.
  signing_request_id           text,
  deposit_email_status         text CHECK (deposit_email_status IN ('queued','sending','sent','failed','not_needed')),
  deposit_email_key            text UNIQUE,      -- base idempotency key (mb-deposit-<request id>)
  deposit_email_key_gen        integer NOT NULL DEFAULT 0, -- bumped only after a definite provider rejection
  deposit_email_attempts       integer NOT NULL DEFAULT 0,
  deposit_email_claimed_at     timestamptz,
  -- First provider attempt of the CURRENT key generation (cleared only when the
  -- generation is bumped). The ~23h idempotency window is measured from here, never
  -- from the latest retry.
  deposit_email_first_attempt_at timestamptz,
  deposit_email_sent_at        timestamptz,
  deposit_email_provider_id    text,
  deposit_email_failure_kind   text CHECK (deposit_email_failure_kind IN ('rejected','uncertain','config')),
  deposit_email_last_error     text,
  deposit_email_to             text,
  deposit_email_amount         numeric,
  -- Exact message sent under the current key generation, reused on every retry so the
  -- provider's idempotency check sees the same request (never re-built mid-generation).
  deposit_email_payload        jsonb,

  -- Deposit receipt marker from the finance checkbox (payments path needs no marker).
  deposit_receipt_source       text CHECK (deposit_receipt_source IN ('checkbox','payments')),
  deposit_receipt_marked_at    timestamptz,
  deposit_receipt_marked_by    uuid REFERENCES auth.users(id),
  deposit_receipt_marked_by_name text,
  -- Authoritative received amount, written once by whoever records the receipt (checkbox
  -- or full payments) from the deposit_amount stored at that moment. Commission's deposit
  -- leg uses it. Cleared only when the receipt itself is reversed (un-mark / refund).
  deposit_received_amount      numeric CHECK (deposit_received_amount IS NULL OR deposit_received_amount > 0),
  deposit_received_amount_at   timestamptz,

  -- "Turn in supplier order form" (office/Owner). First actor/time is kept.
  supplier_turned_in_at        timestamptz,
  supplier_turned_in_by        uuid REFERENCES auth.users(id),
  supplier_turned_in_by_name   text,
  supplier_turned_in_supplier_id uuid REFERENCES public.mb_suppliers(id),
  supplier_turned_in_doc_id    uuid REFERENCES public.sales_order_docs(id) ON DELETE RESTRICT,
  supplier_order_row_id        uuid REFERENCES public.sales_supplier_orders(id) ON DELETE SET NULL
);

-- ── 4. Private commission inputs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mb_order_private (
  order_id         uuid        PRIMARY KEY REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  concrete_charge  numeric     CHECK (concrete_charge IS NULL OR concrete_charge >= 0),
  concrete_cost    numeric     CHECK (concrete_cost   IS NULL OR concrete_cost   >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        REFERENCES auth.users(id)
);

-- ── 5. Owner-edited payment instructions (single row, id = 1) ─────────────────
CREATE TABLE IF NOT EXISTS public.company_payment_settings (
  id                   smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payment_instructions text        NOT NULL CHECK (length(btrim(payment_instructions)) BETWEEN 1 AND 4000),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid        REFERENCES auth.users(id),
  updated_by_name      text
);

-- ── Privacy: service role only ────────────────────────────────────────────────
ALTER TABLE public.mb_order_workflow        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mb_order_private         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_payment_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mb_order_workflow        FROM anon, authenticated;
REVOKE ALL ON public.mb_order_private         FROM anon, authenticated;
REVOKE ALL ON public.company_payment_settings FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mb_order_workflow        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mb_order_private         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_payment_settings TO service_role;
-- Intentionally no CREATE POLICY: with RLS on and no policy, browser (anon/authenticated)
-- clients get zero rows even if a grant is added later by mistake.

-- ── 6. Locks enforced by the database (metal-building orders only) ────────────
-- The API checks these first; the triggers close the read/write race. Both take the
-- sales_orders row lock, so an order edit and a new signing request are serialized:
--   a. sales_orders BEFORE UPDATE: on an MB order, deposit_amount / customer_email /
--      customer_name / supplier_id cannot change while a pending or signed client-form
--      request exists; deposit_amount cannot change once deposit_received is true.
--   b. signing_requests BEFORE INSERT (MB rows only, sales_order_id set): locks the order
--      row and refuses a request whose snapshot differs from what is stored now.
-- Job/subcontract signing rows (sales_order_id NULL) and roofing orders are untouched.
-- No policies or grants on signing_requests are added or changed here.
CREATE OR REPLACE FUNCTION public.mb_sales_order_lock_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.division IS DISTINCT FROM 'metal_buildings' THEN
    RETURN NEW;
  END IF;
  IF OLD.deposit_received IS TRUE AND NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount THEN
    RAISE EXCEPTION 'mb_deposit_locked: deposit amount cannot change after the deposit is received'
      USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount
      OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
      OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
      OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id)
     AND EXISTS (
       SELECT 1 FROM public.signing_requests sr
       WHERE sr.sales_order_id = OLD.id AND sr.status IN ('pending', 'signed')
     ) THEN
    RAISE EXCEPTION 'mb_signing_locked: order fields are locked by a pending or signed client order form'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mb_sales_order_lock_guard ON public.sales_orders;
CREATE TRIGGER mb_sales_order_lock_guard
  BEFORE UPDATE OF deposit_amount, customer_email, customer_name, supplier_id ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.mb_sales_order_lock_guard();

CREATE OR REPLACE FUNCTION public.mb_signing_request_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE o record;
BEGIN
  IF NEW.sales_order_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id, division, deposit_amount, customer_email, customer_name, supplier_id
    INTO o FROM public.sales_orders WHERE id = NEW.sales_order_id FOR UPDATE;
  IF NOT FOUND OR o.division IS DISTINCT FROM 'metal_buildings' THEN
    RAISE EXCEPTION 'mb_snapshot_mismatch: not a metal-building order' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.deposit_amount_snapshot IS DISTINCT FROM o.deposit_amount
     OR NEW.mb_supplier_id IS DISTINCT FROM o.supplier_id
     OR lower(btrim(coalesce(NEW.signer_email, ''))) <> lower(btrim(coalesce(o.customer_email, '')))
     OR btrim(coalesce(NEW.signer_name, '')) <> btrim(coalesce(o.customer_name, '')) THEN
    RAISE EXCEPTION 'mb_snapshot_mismatch: the order changed while the request was being created'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mb_signing_request_insert_guard ON public.signing_requests;
CREATE TRIGGER mb_signing_request_insert_guard
  BEFORE INSERT ON public.signing_requests
  FOR EACH ROW EXECUTE FUNCTION public.mb_signing_request_insert_guard();

REVOKE ALL ON FUNCTION public.mb_sales_order_lock_guard()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mb_signing_request_insert_guard() FROM PUBLIC, anon, authenticated;
