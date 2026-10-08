import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET /api/owner-reimb-invoices?job_id=uuid
// Returns invoices with lines and payment totals for the job.
// Requires PM/APM/admin/super role.
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })

  const { data: invoices, error: invErr } = await adminSupabase
    .from('owner_reimb_invoices')
    .select(`
      *,
      owner_reimb_invoice_lines(*),
      owner_reimb_payments(*)
    `)
    .eq('job_id', job_id)
    .order('issue_date', { ascending: false })

  if (invErr) return Response.json({ error: invErr.message }, { status: 500 })

  // Compute derived fields for each invoice
  const enriched = (invoices || []).map(inv => {
    const lines = inv.owner_reimb_invoice_lines || []
    const payments = (inv.owner_reimb_payments || []).filter(p => !p.voided)
    const totalBilled = lines.reduce((a, l) => a + Number(l.billed_amount || 0), 0)
    const totalExpense = lines.reduce((a, l) => a + Number(l.expense_amount || 0), 0)
    const totalPaid = payments.reduce((a, p) => a + Number(p.amount || 0), 0)
    const outstanding = totalBilled - totalPaid
    const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && outstanding > 0.005 && inv.status !== 'voided' && inv.status !== 'paid'
    return { ...inv, totalBilled, totalExpense, totalPaid, outstanding, isOverdue }
  })

  return Response.json({ invoices: enriched })
}

// POST /api/owner-reimb-invoices
// Creates a new reimbursement invoice with its lines.
// Body: { job_id, invoice_number, bill_to_name, bill_to_address?, issue_date, due_date?, notes?, markup_pct?, lines }
// lines: [{ direct_cost_id?, description, expense_date?, vendor?, expense_amount, markup_pct?, billed_amount }]
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { job_id, invoice_number, bill_to_name, bill_to_address, issue_date, due_date, notes, markup_pct, lines } = body

  if (!job_id || !invoice_number?.trim() || !bill_to_name?.trim() || !issue_date) {
    return Response.json({ error: 'job_id, invoice_number, bill_to_name, and issue_date are required' }, { status: 400 })
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return Response.json({ error: 'At least one line item is required' }, { status: 400 })
  }

  // Validate direct_cost_id references: must belong to the job, be bill_to_owner, not already routed elsewhere
  const dcIds = lines.map(l => l.direct_cost_id).filter(Boolean)
  if (dcIds.length > 0) {
    const { data: costs, error: dcErr } = await adminSupabase
      .from('direct_costs')
      .select('id, job_id, bill_to_owner, billing_route')
      .in('id', dcIds)

    if (dcErr) return Response.json({ error: 'Failed to validate expense records' }, { status: 500 })

    for (const dc of (costs || [])) {
      if (dc.job_id !== job_id) {
        return Response.json({ error: `Expense ${dc.id} does not belong to this job` }, { status: 422 })
      }
      if (!dc.bill_to_owner) {
        return Response.json({ error: `Expense ${dc.id} is not flagged as bill-to-owner` }, { status: 422 })
      }
      if (dc.billing_route && dc.billing_route !== 'reimbursement') {
        return Response.json({ error: `Expense ${dc.id} is already being billed via ${dc.billing_route}` }, { status: 422 })
      }
    }

    // Check those already on a non-draft/non-voided invoice
    const { data: existingLines, error: elErr } = await adminSupabase
      .from('owner_reimb_invoice_lines')
      .select('direct_cost_id, invoice_id, owner_reimb_invoices!inner(status)')
      .in('direct_cost_id', dcIds)
      .not('owner_reimb_invoices.status', 'in', '("draft","voided")')

    if (elErr) return Response.json({ error: 'Failed to check existing invoices' }, { status: 500 })
    if (existingLines && existingLines.length > 0) {
      return Response.json({
        error: `One or more expenses are already on an issued invoice (${existingLines.map(l => l.direct_cost_id).join(', ')})`
      }, { status: 422 })
    }
  }

  // Insert invoice
  const { data: inv, error: invErr } = await adminSupabase
    .from('owner_reimb_invoices')
    .insert({
      job_id,
      invoice_number: invoice_number.trim(),
      bill_to_name: bill_to_name.trim(),
      bill_to_address: bill_to_address?.trim() || null,
      issue_date,
      due_date: due_date || null,
      notes: notes?.trim() || null,
      markup_pct: parseFloat(markup_pct) || 0,
      created_by: auth.userId,
    })
    .select('id')
    .single()

  if (invErr) {
    if (invErr.code === '23505') {
      return Response.json({ error: `Invoice number "${invoice_number}" already exists for this job` }, { status: 409 })
    }
    return Response.json({ error: invErr.message }, { status: 500 })
  }

  // Insert lines
  const lineRows = lines.map((l, i) => ({
    invoice_id: inv.id,
    direct_cost_id: l.direct_cost_id || null,
    description: l.description,
    expense_date: l.expense_date || null,
    vendor: l.vendor?.trim() || null,
    expense_amount: parseFloat(l.expense_amount) || 0,
    markup_pct: parseFloat(l.markup_pct) || 0,
    billed_amount: parseFloat(l.billed_amount) || 0,
    sort_order: i,
  }))

  const { error: linesErr } = await adminSupabase
    .from('owner_reimb_invoice_lines')
    .insert(lineRows)

  if (linesErr) {
    // Roll back invoice
    await adminSupabase.from('owner_reimb_invoices').delete().eq('id', inv.id)
    return Response.json({ error: linesErr.message }, { status: 500 })
  }

  // Mark linked direct costs as routed to reimbursement
  if (dcIds.length > 0) {
    await adminSupabase
      .from('direct_costs')
      .update({ billing_route: 'reimbursement' })
      .in('id', dcIds)
  }

  return Response.json({ id: inv.id }, { status: 201 })
}
