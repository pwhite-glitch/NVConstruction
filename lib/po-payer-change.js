// Payer-change guard (prompt 108). Server-side, but takes the Supabase client as an
// argument (no top-level createClient), so /api/jobs/details and /api/purchase-orders share
// one implementation and the tests can pass a mock.
//
// When "Who pays vendors" changes on a job or a PO, approved/paid invoices keep the payer
// their own row proves (lib/po-invoices.js lockedInvoicePayer); only untouched invoices
// follow the new setting. If any locked invoice would end up on a payer different from the
// new setting, the save is refused with 409 { needs_payer_confirm } until the caller resends
// with applyTo: 'new_only'. Nothing moves either way — the confirm is so nobody is surprised.

import { isMissingRelation } from './budget-line-refs'
import { payerChangeImpact, payerChangeMessage, PAYER_APPLY_NEW_ONLY } from './po-invoices'

const CHUNK = 200
const ZERO = () => ({ locked_keep: 0, open_move: 0, locked_total: 0 })

/**
 * @param db        Supabase client (service role)
 * @param poIds     POs whose effective payer changes to newPayer
 * @param newPayer  'nv' | 'owner'
 * @param scope     'job' | 'po' (wording of the confirm)
 * @param applyTo   only exactly 'new_only' counts as confirmed
 * @returns { ok: true, impact } | { ok: false, response }
 */
export async function payerChangeGuard(db, { poIds, newPayer, scope, applyTo } = {}) {
  const ids = [...new Set((poIds || []).filter(Boolean))]
  if (!ids.length) return { ok: true, impact: ZERO() }
  const rows = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await db.from('po_invoices')
      .select('id, po_id, approved_at, ready_to_pay, paid_amount, paid_at, paid_by_owner')
      .in('po_id', chunk)
    if (error) {
      // Before migration 082 there are no invoices to protect: the save goes ahead as before.
      if (isMissingRelation(error)) return { ok: true, impact: ZERO() }
      return { ok: false, response: Response.json({ error: error.message }, { status: 500 }) }
    }
    rows.push(...(data || []))
  }
  const impact = payerChangeImpact(rows, newPayer)
  if (impact.locked_keep > 0 && applyTo !== PAYER_APPLY_NEW_ONLY) {
    return {
      ok: false,
      response: Response.json({
        error: payerChangeMessage(impact, newPayer, scope),
        needs_payer_confirm: true,
        locked_invoices: impact.locked_keep,
        open_invoices: impact.open_move,
        new_payer: newPayer,
      }, { status: 409 }),
    }
  }
  return { ok: true, impact }
}
