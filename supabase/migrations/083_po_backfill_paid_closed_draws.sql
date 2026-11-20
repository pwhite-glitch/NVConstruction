-- Migration 083 (prompt 99): backfill — mark RECEIVED POs on CLOSED draws as paid.
--
-- STATUS: PROPOSED — written, NOT applied. Apply AFTER 082 (it needs public.po_invoices).
-- DATA ONLY: no schema change. Idempotent (a PO that already has any invoice row is skipped,
-- so running it twice adds nothing). Runs in one transaction.
--
-- Why: before prompt 99 there was no invoice / paid tracking on POs, so every old PO would
-- otherwise land on the admin "Needs approval" / Ready to pay list once someone logs its
-- invoice. Peyton's rule: received POs on a closed draw were already paid.
--
-- How "on a closed draw" is determined (from the schema and app code):
--   • A PO is put on a draw by /api/draw-requests, which sets purchase_orders.draw_request_id
--     (and stamps purchase_orders.drawn_at).
--   • A draw is closed by PUT /api/draw-requests { status: 'closed' }; draw_requests.status is
--     only ever 'open' or 'closed' (see migration 042 notes and 044's closed-draw check).
--   So: purchase_orders.status = 'received'
--       AND purchase_orders.draw_request_id = draw_requests.id
--       AND draw_requests.status = 'closed'.
--   POs with amount <= 0 are skipped (an invoice must be > $0).
--
-- What each matched PO gets: ONE po_invoices row for the full PO amount, approved and paid:
--   invoice_number  '<po_number> (backfill)'
--   invoice_date / due_date / last_payment_date  = drawn_at date, else issued_date, else created_at date
--   ready_to_pay true, approved_at / paid_at = drawn_at (else now()), paid_amount = amount
--   paid_by_owner = true when the PO's payer is the owner (payer_override, else jobs.po_payer)
--   source 'backfill_083'  ← used by the rollback below
-- plus one change_log row per invoice (entity_type 'po_invoice', note starting 'Backfill 083').
--
-- Count it first (read-only), after 082 is applied:
--   SELECT count(*)
--     FROM public.purchase_orders po
--     JOIN public.draw_requests d ON d.id = po.draw_request_id
--    WHERE po.status = 'received'
--      AND d.status = 'closed'
--      AND coalesce(po.amount, 0) > 0
--      AND NOT EXISTS (SELECT 1 FROM public.po_invoices i WHERE i.po_id = po.id);

BEGIN;

WITH targets AS (
  SELECT po.id AS po_id, po.job_id, po.po_number, po.amount, d.draw_number,
         coalesce(po.drawn_at::date, po.issued_date, po.created_at::date, current_date) AS inv_date,
         coalesce(po.drawn_at, now()) AS paid_ts,
         (coalesce(po.payer_override, j.po_payer, 'nv') = 'owner') AS owner_pays
    FROM public.purchase_orders po
    JOIN public.draw_requests d ON d.id = po.draw_request_id
    LEFT JOIN public.jobs j ON j.id = po.job_id
   WHERE po.status = 'received'
     AND d.status = 'closed'
     AND coalesce(po.amount, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM public.po_invoices i WHERE i.po_id = po.id)
),
ins AS (
  INSERT INTO public.po_invoices
    (po_id, invoice_number, invoice_date, amount, due_date, approved_at, ready_to_pay,
     paid_at, paid_amount, last_payment_date, paid_by_owner, payment_notes, source)
  SELECT t.po_id, coalesce(t.po_number, 'PO') || ' (backfill)', t.inv_date, t.amount, t.inv_date,
         t.paid_ts, true, t.paid_ts, t.amount, t.inv_date, t.owner_pays,
         'Backfill 083: received PO on closed Draw #' || coalesce(t.draw_number::text, '?') || ' — marked paid.',
         'backfill_083'
    FROM targets t
  RETURNING id, po_id, amount
)
INSERT INTO public.change_log (job_id, entity_type, entity_id, field_name, old_value, new_value, note)
SELECT t.job_id, 'po_invoice', ins.id, 'payment_status', NULL, CASE WHEN t.owner_pays THEN 'paid_by_owner' ELSE 'paid' END,
       'Backfill 083: ' || coalesce(t.po_number, 'PO') || ' received on closed Draw #' || coalesce(t.draw_number::text, '?') || ' — marked paid ($' || ins.amount::text || ').'
  FROM ins JOIN targets t ON t.po_id = ins.po_id;

COMMIT;

-- ROLLBACK (run manually; removes exactly what this backfill added, nothing else):
-- BEGIN;
-- DELETE FROM public.change_log
--  WHERE entity_type = 'po_invoice'
--    AND note LIKE 'Backfill 083:%'
--    AND entity_id IN (SELECT id FROM public.po_invoices WHERE source = 'backfill_083');
-- DELETE FROM public.po_invoices WHERE source = 'backfill_083';
-- COMMIT;
