// PO edit confirms shared by the commercial (app/jobdetail) and residential
// (app/residentialjobdetail) Purchase Orders tabs. Pure — no DB imports.
// Cash wording follows lib/po-cash.js: only open (issued/received) POs with
// payment_type 'reimbursement' are NV cash out; 'check' means the owner writes
// the check to the vendor and it is not NV cash.

export const RECEIVED_EDIT_WARNING = 'This PO is marked received. Editing it can change committed cost and cash outlook. Edit anyway?'
export const CLOSED_LOCKED_MESSAGE = 'Closed — editing locked.'
export const PO_DRAW_AMOUNT_WARNING = 'This PO is on a draw request. Changing the amount can desync the draw package. Continue?'

const cents = n => Math.round((Number(n) || 0) * 100)

/** Amount the edit form will save: same valid-line filter and math as savePOEdit / the API. */
export function editFormAmount(form) {
  return (form?.items || [])
    .filter(i => i.description && i.unit_price)
    .reduce((a, i) => a + (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0), 0)
}

/** editPOForm state for an existing PO (same shape the Edit buttons already build). */
export function editFormFromPO(po) {
  return {
    vendor_name: po.vendor_name,
    description: po.description || '',
    budget_item_id: po.budget_item_id || '',
    notes: po.notes || '',
    payment_type: po.payment_type || 'check',
    items: (po.purchase_order_items || []).map((i, idx) => ({ uid: idx, description: i.description, qty: String(i.qty), unit: i.unit || '', unit_price: String(i.unit_price) })),
  }
}

/**
 * Confirm messages to show (in order) before saving an edit of `po` with `form`.
 * Empty array = nothing to confirm.
 */
export function poEditConfirmMessages(po, form) {
  if (!po || !form) return []
  const out = []
  const oldPt = po.payment_type || 'check'
  const newPt = form.payment_type || 'check'
  if (oldPt !== newPt) {
    out.push(newPt === 'reimbursement'
      ? 'Switching this PO from "Check to vendor" to "Reimbursement" means NV pays the vendor. While the PO is issued or received it will count as NV cash out on the cash outlook. Continue?'
      : 'Switching this PO from "Reimbursement" to "Check to vendor" means the owner writes the check to the vendor. It will come off NV\'s cash outlook (shown as disclosed only, not NV cash out). Continue?')
  }
  if ((po.budget_item_id || '') !== (form.budget_item_id || '')) {
    out.push(!po.budget_item_id
      ? 'Assigning this PO to a budget line adds its amount to that line\'s committed cost. Continue?'
      : !form.budget_item_id
        ? 'Removing the budget line takes this PO\'s amount out of that line\'s committed cost. Continue?'
        : 'Changing the budget line moves this PO\'s committed cost from the old line to the new one. Continue?')
  }
  if (po.draw_request_id && cents(editFormAmount(form)) !== cents(po.amount)) {
    out.push(PO_DRAW_AMOUNT_WARNING)
  }
  return out
}

/** Runs the confirms; true when every one is accepted (or none apply). */
export function confirmPOEdit(po, form, confirmFn) {
  for (const msg of poEditConfirmMessages(po, form)) {
    if (!confirmFn(msg)) return false
  }
  return true
}
