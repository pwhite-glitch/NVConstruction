-- Migration 067: link a direct cost to the purchase order it pays down.
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. No data changes, no backfill (linking is opt-in
-- going forward). Idempotent (safe to run twice).
--
-- Why (prompt 69): the job Cash Flow "POs out" column and lib/cash-outlook poItems count
-- open reimbursement POs as estimated cash out. Once the PO's invoice is logged as an
-- approved direct cost, the PO must not still be counted in full (double count on the job
-- Cash Flow tab; inflated PO estimate on the Owner outlook). This column says which PO a
-- cost pays down; approved linked costs reduce the PO's remaining amount (credits add back).
--
-- What this adds to public.direct_costs:
--   purchase_order_id uuid NULL → purchase_orders(id) ON DELETE SET NULL
--   partial index on purchase_order_id (only linked rows)
--
-- Code that uses it:
--   lib/po-cash.js (new) — shared PO cash rule
--   app/jobdetail/page.js — Cash Flow tab "POs out", DC create + review/edit PO picker, PO badge
--   app/api/direct-costs/route.js POST (validates same-job PO; job move clears the link)
--   app/api/dc-review/route.js action 'edit' (set / clear, same-job check)
--   app/api/cash-outlook/route.js + lib/cash-outlook.js poItems (remaining after linked DCs)
-- Before 067: writes carrying purchase_order_id fail with an undefined-column /
-- schema-cache error and are retried once without it; the outlook skips the linked-cost
-- query; every PO counts at its full amount (today's behavior).

ALTER TABLE public.direct_costs
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid
    REFERENCES public.purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS direct_costs_purchase_order_id_idx
  ON public.direct_costs (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

-- ROLLBACK (run manually only if needed; DC↔PO links are lost):
-- DROP INDEX IF EXISTS public.direct_costs_purchase_order_id_idx;
-- ALTER TABLE public.direct_costs DROP COLUMN IF EXISTS purchase_order_id;
