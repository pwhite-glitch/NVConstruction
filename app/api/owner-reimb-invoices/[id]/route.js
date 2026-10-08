import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM } from '../../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// PUT /api/owner-reimb-invoices/[id]
// Updates invoice status or metadata.
// To void: { action: 'void', void_reason? }
// To issue: { action: 'issue' }
// To update draft metadata: { bill_to_name?, bill_to_address?, due_date?, notes? }
export async function PUT(request, { params }) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Fetch current invoice
  const { data: inv, error: fetchErr } = await adminSupabase
    .from('owner_reimb_invoices')
    .select('id, status, job_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !inv) return Response.json({ error: 'Invoice not found' }, { status: 404 })

  if (body.action === 'void') {
    if (inv.status === 'voided') return Response.json({ error: 'Already voided' }, { status: 409 })
    if (inv.status === 'paid') return Response.json({ error: 'Cannot void a fully paid invoice — record a correction payment first' }, { status: 422 })

    // Release billing_route on linked direct costs
    const { data: lines } = await adminSupabase
      .from('owner_reimb_invoice_lines')
      .select('direct_cost_id')
      .eq('invoice_id', id)

    const dcIds = (lines || []).map(l => l.direct_cost_id).filter(Boolean)
    if (dcIds.length > 0) {
      await adminSupabase
        .from('direct_costs')
        .update({ billing_route: null })
        .in('id', dcIds)
    }

    const { error: voidErr } = await adminSupabase
      .from('owner_reimb_invoices')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by: auth.userId,
        void_reason: body.void_reason?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (voidErr) return Response.json({ error: voidErr.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (body.action === 'issue') {
    if (inv.status !== 'draft') return Response.json({ error: 'Only draft invoices can be issued' }, { status: 422 })
    const { error: issueErr } = await adminSupabase
      .from('owner_reimb_invoices')
      .update({ status: 'issued', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (issueErr) return Response.json({ error: issueErr.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  // Metadata update (draft only)
  if (inv.status !== 'draft') {
    return Response.json({ error: 'Only draft invoices can be edited. To void an issued invoice, use action: "void".' }, { status: 422 })
  }

  const allowed = ['bill_to_name', 'bill_to_address', 'due_date', 'notes', 'invoice_number']
  const updates = {}
  for (const k of allowed) {
    if (body[k] !== undefined) updates[k] = body[k] || null
  }
  updates.updated_at = new Date().toISOString()

  const { error: updateErr } = await adminSupabase
    .from('owner_reimb_invoices')
    .update(updates)
    .eq('id', id)

  if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })
  return Response.json({ ok: true })
}
