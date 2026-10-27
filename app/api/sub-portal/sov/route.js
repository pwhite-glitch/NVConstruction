import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { billingContext } from '../../../../lib/sub-access'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?job_id → contracts + SOV lines (with % billed to date) the caller can bill against.
// Billing state comes back as { locked: 'billing_off' | 'person_cannot_bill' } or { no_contract: true }.
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  try {
    const jobId = new URL(request.url).searchParams.get('job_id')
    const ctx = await billingContext(auth, jobId)
    if (ctx.error) return ctx.error
    if (!ctx.job.can_bill) return Response.json({ locked: ctx.job.billing_lock_reason, contracts: [], lines: [] })
    if (ctx.contracts.length === 0) return Response.json({ no_contract: true, contracts: [], lines: [] })

    const contractIds = ctx.contracts.map(c => c.id)
    const { data: lines } = await adminSupabase
      .from('subcontract_sov_lines')
      .select('*, subcontracts(description, retainage_pct)')
      .in('subcontract_id', contractIds)
      .order('sort_order')
      .order('created_at')
    const lineIds = (lines || []).map(l => l.id)
    const prevPct = {}
    if (lineIds.length) {
      const { data: prev } = await adminSupabase
        .from('billing_sov_lines')
        .select('sov_line_id, pct_this_period, billing_submissions(status)')
        .in('sov_line_id', lineIds)
      for (const pl of prev || []) {
        if (pl.billing_submissions?.status !== 'rejected') prevPct[pl.sov_line_id] = (prevPct[pl.sov_line_id] || 0) + (parseFloat(pl.pct_this_period) || 0)
      }
    }
    const withLines = new Set((lines || []).map(l => l.subcontract_id))
    return Response.json({
      contracts: ctx.contracts.map(c => ({ ...c, has_sov: withLines.has(c.id) })),
      lines: (lines || []).map(l => ({ ...l, pct_prev: Math.min(100, Math.round((prevPct[l.id] || 0) * 100) / 100) })),
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST { job_id, subcontract_id, lines: [{ description, amount }] } → creates the
// SOV for ONE contract. Refuses if that contract already has lines, so two
// teammates can't both create one.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  try {
    const { job_id, subcontract_id, lines } = await request.json()
    const ctx = await billingContext(auth, job_id)
    if (ctx.error) return ctx.error
    if (!ctx.job.can_bill) return Response.json({ error: 'Billing is not enabled for you on this project.' }, { status: 403 })
    const contract = ctx.contracts.find(c => c.id === subcontract_id)
    if (!contract) return Response.json({ error: 'That subcontract is not available to you.' }, { status: 403 })

    const valid = (lines || []).filter(l => l.description?.trim() && parseFloat(l.amount) > 0)
    if (!valid.length) return Response.json({ error: 'Add at least one line with a description and amount.' }, { status: 400 })
    const total = valid.reduce((a, l) => a + parseFloat(l.amount), 0)
    const contractValue = Number(contract.contract_value || 0)
    if (contractValue > 0 && Math.round(total * 100) !== Math.round(contractValue * 100)) {
      return Response.json({ error: `Lines total $${total.toFixed(2)} but the contract is $${contractValue.toFixed(2)}.` }, { status: 400 })
    }

    const { data: existing } = await adminSupabase.from('subcontract_sov_lines').select('id').eq('subcontract_id', contract.id).limit(1)
    if (existing?.length) return Response.json({ error: 'A schedule of values already exists for this contract (a teammate may have just created it). Reload the project.' }, { status: 409 })

    const { error } = await adminSupabase.from('subcontract_sov_lines').insert(valid.map((l, idx) => ({
      subcontract_id: contract.id,
      description: l.description.trim(),
      scheduled_value: parseFloat(l.amount),
      sort_order: idx + 1,
    })))
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
