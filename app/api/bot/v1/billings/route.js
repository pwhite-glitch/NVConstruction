import { withBot, refusedMethods, badRequest, notFound, dbError, requireJobId, pageParams, paged, logBotChange, fmtAmt } from '../../../../../lib/bot-api'
import { validateBilling } from '../../../../../lib/bot-rules'
import { withoutNew032 } from '../../../../../lib/billing-fields'
import { findDuplicateInvoice, duplicateSummary, normalizeInvoiceNumber, duplicateDate } from '../../../../../lib/billing-duplicates'

// GET ?job_id= &limit= &offset=
export const GET = withBot(async ({ supabase, request }) => {
  const { searchParams } = new URL(request.url)
  const jobId = requireJobId(searchParams)
  if (!jobId) return badRequest('job_id required')
  const page = pageParams(searchParams)
  const { data, error } = await supabase.from('billing_submissions').select('*').eq('job_id', jobId)
    .order('submitted_at', { ascending: false }).range(page.from, page.to)
  if (error) return dbError(error)
  return Response.json(paged(data, page))
})

// Retainage held that doesn't match retainage_pct × amount_billed (more than $1 off): a
// warning only — the billing is still saved as sent.
function retainageWarnings(row) {
  if (row.retainage_pct == null || row.retainage_held == null) return []
  const pct = Number(row.retainage_pct)
  const held = Number(row.retainage_held)
  const expected = Math.round(Number(row.amount_billed) * pct) / 100
  if (Math.abs(held - expected) <= 1) return []
  return [`retainage_held ${fmtAmt(held)} does not match retainage_pct ${pct}% × amount_billed ${fmtAmt(row.amount_billed)} = ${fmtAmt(expected)}`]
}

// Create a pending billing. Never assigned to a draw, never approved, no notifications.
// Same duplicate-invoice guard as /api/billing-entry: an invoice # this company already has
// (not rejected) on the job → 409 unless confirm_duplicate === true (then logged).
export const POST = withBot(async ({ bot, supabase, request }) => {
  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }
  // confirm_duplicate is a request flag, not a column: never validated or inserted.
  let confirmDuplicate = false
  if (body && typeof body === 'object' && !Array.isArray(body) && 'confirm_duplicate' in body) {
    const { confirm_duplicate, ...rest } = body
    confirmDuplicate = confirm_duplicate === true
    body = rest
  }
  const { row, error: invalid } = validateBilling(body)
  if (invalid) return badRequest(invalid)

  const { data: job } = await supabase.from('jobs').select('id').eq('id', row.job_id).maybeSingle()
  if (!job) return notFound('Job not found')
  if (row.sub_id) {
    const { data: sub } = await supabase.from('profiles').select('id').eq('id', row.sub_id).maybeSingle()
    if (!sub) return badRequest('sub_id is not a portal user')
  }

  let savedDespite = null
  if (normalizeInvoiceNumber(row.invoice_number)) {
    const found = await findDuplicateInvoice(supabase, { jobId: row.job_id, invoiceNumber: row.invoice_number, subId: row.sub_id, companyName: row.company_name })
    if (found.error) return Response.json({ error: found.error }, { status: 500 })
    if (found.dup) {
      if (!confirmDuplicate) {
        const dup = found.dup
        return Response.json({
          error: `Invoice #${dup.invoice_number} was already entered for this company on this project (${duplicateDate(dup.submitted_at)}, ${dup.status || 'pending'}). Send confirm_duplicate: true only if this is a different invoice.`,
          needs_confirm: true,
          duplicate: duplicateSummary(dup),
          duplicates: found.dups.map(duplicateSummary),
        }, { status: 409 })
      }
      savedDespite = found.dup
    }
  }

  const warnings = retainageWarnings(row)

  const insertRow = { ...row, submitted_at: new Date().toISOString() }
  let { data, error } = await supabase.from('billing_submissions').insert(insertRow).select('id').single()
  if (error?.message?.includes('schema cache')) {
    ({ data, error } = await supabase.from('billing_submissions').insert(withoutNew032(insertRow)).select('id').single())
  }
  if (error) return dbError(error)

  await logBotChange(bot, supabase, {
    job_id: row.job_id, entity_type: 'billing', entity_id: data.id, field_name: 'created',
    new_value: fmtAmt(row.amount_billed),
    note: `Billing created (pending) — ${row.company_name || ''}${warnings.length ? ` — Warning: ${warnings.join('; ')}` : ''}`,
  })
  if (savedDespite) {
    await logBotChange(bot, supabase, {
      job_id: row.job_id, entity_type: 'billing', entity_id: data.id, field_name: 'invoice_number',
      old_value: null, new_value: row.invoice_number,
      note: `Saved despite possible duplicate of Invoice #${savedDespite.invoice_number} (${savedDespite.id})`,
    })
  }
  return Response.json({ ok: true, id: data.id, ...(warnings.length ? { warnings } : {}) }, { status: 201 })
})

export const { PUT, PATCH, DELETE } = refusedMethods
