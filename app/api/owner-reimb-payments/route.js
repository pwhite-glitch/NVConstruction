import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function computeInvoiceStatus(totalBilled, totalPaid, dueDate) {
  if (totalPaid <= 0) {
    if (dueDate && new Date(dueDate) < new Date()) return 'overdue'
    return 'issued'
  }
  if (totalPaid >= totalBilled - 0.005) return 'paid'
  return 'partially_paid'
}

// GET /api/owner-reimb-payments?invoice_id=uuid
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const invoice_id = searchParams.get('invoice_id')
  if (!invoice_id) return Response.json({ error: 'invoice_id required' }, { status: 400 })

  const { data, error } = await adminSupabase
    .from('owner_reimb_payments')
    .select('*')
    .eq('invoice_id', invoice_id)
    .order('received_date', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ payments: data || [] })
}

// POST /api/owner-reimb-payments
// Records a payment against an invoice, then recomputes invoice status.
// Body: { invoice_id, received_date, amount, payment_method?, reference?, notes? }
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { invoice_id, received_date, amount, payment_method, reference, notes } = body
  if (!invoice_id || !received_date || !amount) {
    return Response.json({ error: 'invoice_id, received_date, and amount are required' }, { status: 400 })
  }
  const parsedAmount = parseFloat(amount)
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return Response.json({ error: 'Amount must be a positive number' }, { status: 400 })
  }

  // Fetch invoice to validate status and get total billed
  const { data: inv, error: invErr } = await adminSupabase
    .from('owner_reimb_invoices')
    .select('id, status, due_date, owner_reimb_invoice_lines(billed_amount), owner_reimb_payments(amount, voided)')
    .eq('id', invoice_id)
    .maybeSingle()

  if (invErr || !inv) return Response.json({ error: 'Invoice not found' }, { status: 404 })
  if (inv.status === 'voided') return Response.json({ error: 'Cannot record payment on a voided invoice' }, { status: 422 })
  if (inv.status === 'draft') return Response.json({ error: 'Issue the invoice before recording payments' }, { status: 422 })

  const totalBilled = (inv.owner_reimb_invoice_lines || []).reduce((a, l) => a + Number(l.billed_amount || 0), 0)
  const existingPaid = (inv.owner_reimb_payments || []).filter(p => !p.voided).reduce((a, p) => a + Number(p.amount || 0), 0)

  // Insert payment
  const { error: payErr } = await adminSupabase
    .from('owner_reimb_payments')
    .insert({
      invoice_id,
      received_date,
      amount: parsedAmount,
      payment_method: payment_method?.trim() || null,
      reference: reference?.trim() || null,
      notes: notes?.trim() || null,
      recorded_by: auth.userId,
    })

  if (payErr) return Response.json({ error: payErr.message }, { status: 500 })

  // Recompute and update invoice status
  const newTotalPaid = existingPaid + parsedAmount
  const newStatus = computeInvoiceStatus(totalBilled, newTotalPaid, inv.due_date)

  await adminSupabase
    .from('owner_reimb_invoices')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', invoice_id)

  return Response.json({ ok: true, newStatus }, { status: 201 })
}

// DELETE /api/owner-reimb-payments
// Voids (soft-deletes) a payment and recomputes invoice status.
// Body: { payment_id, void_reason? }
export async function DELETE(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { payment_id, void_reason } = body
  if (!payment_id) return Response.json({ error: 'payment_id required' }, { status: 400 })

  // Get payment and invoice
  const { data: payment, error: pErr } = await adminSupabase
    .from('owner_reimb_payments')
    .select('id, invoice_id, voided')
    .eq('id', payment_id)
    .maybeSingle()

  if (pErr || !payment) return Response.json({ error: 'Payment not found' }, { status: 404 })
  if (payment.voided) return Response.json({ error: 'Payment already voided' }, { status: 409 })

  await adminSupabase
    .from('owner_reimb_payments')
    .update({ voided: true, voided_at: new Date().toISOString(), void_reason: void_reason || null })
    .eq('id', payment_id)

  // Recompute invoice status
  const { data: inv } = await adminSupabase
    .from('owner_reimb_invoices')
    .select('status, due_date, owner_reimb_invoice_lines(billed_amount), owner_reimb_payments(amount, voided)')
    .eq('id', payment.invoice_id)
    .maybeSingle()

  if (inv && inv.status !== 'voided') {
    const totalBilled = (inv.owner_reimb_invoice_lines || []).reduce((a, l) => a + Number(l.billed_amount || 0), 0)
    const totalPaid = (inv.owner_reimb_payments || []).filter(p => !p.voided).reduce((a, p) => a + Number(p.amount || 0), 0)
    const newStatus = computeInvoiceStatus(totalBilled, totalPaid, inv.due_date)
    await adminSupabase
      .from('owner_reimb_invoices')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', payment.invoice_id)
  }

  return Response.json({ ok: true })
}
