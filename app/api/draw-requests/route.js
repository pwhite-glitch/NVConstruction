import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { subCanSeeJob } from '../../../lib/sub-access'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { drawPatchError, drawDeleteError, drawItemProblems, DRAWABLE } from '../../../lib/draw-guards'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?job_id — office: every draw. Sub: open draws on a job they see (picked
// when submitting billing), without the office-only fields.
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ draws: [] })
  if (isSub(auth.role)) {
    if (!(await subCanSeeJob(auth, job_id))) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { data, error } = await adminSupabase
      .from('draw_requests')
      .select('id, job_id, draw_number, title, status')
      .eq('job_id', job_id)
      .eq('status', 'open')
      .order('draw_number')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ draws: data || [] })
  }
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await denyJob(adminSupabase, auth, job_id)
  if (denied) return denied
  const { data, error } = await adminSupabase
    .from('draw_requests')
    .select('*')
    .eq('job_id', job_id)
    .order('draw_number')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ draws: data || [] })
}

// Item types a draw can carry: table, PATCH keys, columns read for the checks,
// and what tagging / untagging writes.
const ITEM_TYPES = [
  { key: 'dc', table: 'direct_costs', label: 'Direct cost', cols: 'id, job_id, draw_request_id, status, drawn_application_id', add: 'add_dc_ids', remove: 'remove_dc_ids', stamp: false },
  { key: 'po', table: 'purchase_orders', label: 'PO', cols: 'id, job_id, draw_request_id, status', add: 'add_po_ids', remove: 'remove_po_ids', stamp: true },
  { key: 'gc', table: 'general_conditions', label: 'General conditions entry', cols: 'id, job_id, draw_request_id', add: 'add_gc_ids', remove: 'remove_gc_ids', stamp: true },
  { key: 'billing', table: 'billing_submissions', label: 'Billing', cols: 'id, job_id, draw_request_id, status', add: 'add_billing_ids', remove: 'remove_billing_ids', stamp: false },
]

const list = v => (Array.isArray(v) ? v.filter(Boolean) : [])

// Read and check every add/remove list against the draw. Returns problems[].
async function checkDrawItems(draw, body) {
  const problems = []
  for (const t of ITEM_TYPES) {
    for (const mode of ['add', 'remove']) {
      const ids = list(body[t[mode]])
      if (!ids.length) continue
      const { data: rows, error } = await adminSupabase.from(t.table).select(t.cols).in('id', ids)
      if (error) { problems.push(`${t.label}s: ${error.message}`); continue }
      problems.push(...drawItemProblems({ ids, rows, draw, mode, label: t.label, okStatus: mode === 'add' ? DRAWABLE[t.key] : null }))
    }
  }
  return problems
}

// Tag / untag. Each write is limited to rows that are still free (add) or
// still on this draw (remove), so a stale tab can't pull an item off another draw.
async function applyDrawItems(draw, body) {
  const errors = []
  const now = new Date().toISOString()
  for (const t of ITEM_TYPES) {
    const add = list(body[t.add])
    if (add.length) {
      const { error } = await adminSupabase.from(t.table)
        .update({ draw_request_id: draw.id, ...(t.stamp ? { drawn_at: now } : {}) })
        .in('id', add).eq('job_id', draw.job_id).is('draw_request_id', null)
      if (error) errors.push(`${t.label}s: ${error.message}`)
    }
    const remove = list(body[t.remove])
    if (remove.length) {
      const { error } = await adminSupabase.from(t.table)
        .update({ draw_request_id: null, ...(t.stamp ? { drawn_at: null } : {}) })
        .in('id', remove).eq('draw_request_id', draw.id)
      if (error) errors.push(`${t.label}s: ${error.message}`)
    }
  }
  return errors
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { job_id, title, dc_ids, po_ids, gc_ids } = await request.json()
  if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
  const denied = await denyJob(adminSupabase, auth, job_id)
  if (denied) return denied

  // Check the items before creating anything
  const itemBody = { add_dc_ids: dc_ids, add_po_ids: po_ids, add_gc_ids: gc_ids }
  const problems = await checkDrawItems({ id: null, job_id }, itemBody)
  if (problems.length) return Response.json({ error: problems.join('; ') }, { status: 409 })

  // Auto-increment draw_number for this job (unique (job_id, draw_number) is live)
  const { data: existing, error: numErr } = await adminSupabase
    .from('draw_requests')
    .select('draw_number')
    .eq('job_id', job_id)
    .order('draw_number', { ascending: false })
    .limit(1)
  if (numErr) return Response.json({ error: numErr.message }, { status: 500 })
  const nextNum = ((existing?.[0]?.draw_number) || 0) + 1

  const { data: draw, error } = await adminSupabase
    .from('draw_requests')
    .insert({ job_id, draw_number: nextNum, title: title || `Draw Request ${nextNum}`, status: 'open' })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') return Response.json({ error: 'Another draw was just created on this job. Refresh and try again.' }, { status: 409 })
    return Response.json({ error: error.message }, { status: 500 })
  }

  const errors = await applyDrawItems(draw, itemBody)
  if (errors.length) return Response.json({ draw, error: 'Draw created, but some items were not tagged: ' + errors.join('; ') }, { status: 500 })
  return Response.json({ draw })
}

export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const body = await request.json()
  const { id, status, title } = body
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const denied = await denyJobOf(adminSupabase, auth, 'draw_requests', id)
  if (denied) return denied
  const { data: draw, error: drawErr } = await adminSupabase.from('draw_requests').select('id, job_id, draw_number, status').eq('id', id).maybeSingle()
  if (drawErr) return Response.json({ error: drawErr.message }, { status: 500 })
  const bad = drawPatchError(draw, body)
  if (bad) return Response.json({ error: bad.error }, { status: bad.status })

  const problems = await checkDrawItems(draw, body)
  if (problems.length) return Response.json({ error: problems.join('; ') }, { status: 409 })

  const updates = {}
  if (status !== undefined) updates.status = status
  if (title !== undefined) updates.title = title
  if (Object.keys(updates).length > 0) {
    // Guard on the status we read so a concurrent Close isn't overwritten silently
    const { data: rows, error } = await adminSupabase.from('draw_requests').update(updates).eq('id', id).eq('status', draw.status).select('id')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows?.length) return Response.json({ error: 'This draw was changed by someone else. Refresh and try again.' }, { status: 409 })
  }
  const errors = await applyDrawItems(draw, body)
  if (errors.length) return Response.json({ error: errors.join('; ') }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const denied = await denyJobOf(adminSupabase, auth, 'draw_requests', id)
  if (denied) return denied
  const { data: draw, error: drawErr } = await adminSupabase.from('draw_requests').select('id, job_id, draw_number, status').eq('id', id).maybeSingle()
  if (drawErr) return Response.json({ error: drawErr.message }, { status: 500 })
  const bad = drawDeleteError(draw)
  if (bad) return Response.json({ error: bad.error }, { status: bad.status })
  for (const t of ITEM_TYPES) {
    const { error } = await adminSupabase.from(t.table)
      .update({ draw_request_id: null, ...(t.stamp ? { drawn_at: null } : {}) }).eq('draw_request_id', id)
    if (error) return Response.json({ error: `Could not untag ${t.label}s: ${error.message}` }, { status: 500 })
  }
  const { error } = await adminSupabase.from('draw_requests').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
