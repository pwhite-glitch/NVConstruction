import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, atLeastPM } from '../../../lib/roles'
import { notifyRfiAnswered, rfiSubmitterLabel } from '../../../lib/rfi-notify'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Office RFI actions for the job page (Field → RFIs).
// Staff roles only (requirePM); PM/APM limited to their jobs (denyJob).
// Closing is PM-level only (atLeastPM: principal, pm).

// GET ?job_id=xxx → the job's RFIs, newest first, each with submitter_label
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const job_id = new URL(request.url).searchParams.get('job_id')
  if (!job_id) return Response.json({ error: 'job_id is required' }, { status: 400 })
  const denied = await denyJob(adminSupabase, auth, job_id)
  if (denied) return denied

  const { data: rfis, error } = await adminSupabase
    .from('rfis').select('*').eq('job_id', job_id).order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const userIds = [...new Set((rfis || []).flatMap(r => [r.sub_id, r.super_id]).filter(Boolean))]
  let profilesById = {}
  let companiesById = {}
  if (userIds.length) {
    const { data: profs } = await adminSupabase
      .from('profiles').select('id, full_name, company_id, company_name').in('id', userIds)
    profilesById = Object.fromEntries((profs || []).map(p => [p.id, p]))
    const companyIds = [...new Set((profs || []).map(p => p.company_id).filter(Boolean))]
    if (companyIds.length) {
      const { data: cos } = await adminSupabase.from('companies').select('id, name').in('id', companyIds)
      companiesById = Object.fromEntries((cos || []).map(c => [c.id, c.name]))
    }
  }

  return Response.json({
    data: (rfis || []).map(r => ({ ...r, submitter_label: rfiSubmitterLabel(r, profilesById, companiesById) })),
  })
}

// POST { rfi_id, action: 'respond', response } → saves the answer, notifies the submitter
// POST { rfi_id, action: 'close' }               → status 'closed' (PM-level only)
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const rfi_id = typeof body?.rfi_id === 'string' ? body.rfi_id : ''
  const action = body?.action
  if (!rfi_id) return Response.json({ error: 'rfi_id is required' }, { status: 400 })
  if (action !== 'respond' && action !== 'close') return Response.json({ error: 'Unknown action' }, { status: 400 })

  const { data: rfi, error: loadErr } = await adminSupabase.from('rfis').select('*').eq('id', rfi_id).maybeSingle()
  if (loadErr) return Response.json({ error: loadErr.message }, { status: 500 })
  if (!rfi) return Response.json({ error: 'RFI not found.' }, { status: 404 })
  const denied = await denyJob(adminSupabase, auth, rfi.job_id)
  if (denied) return denied

  if (action === 'close') {
    if (!atLeastPM(auth.role)) return Response.json({ error: 'Only a PM can close an RFI.' }, { status: 403 })
    if (rfi.status === 'closed') return Response.json({ ok: true, rfi })
    const { data: updated, error } = await adminSupabase
      .from('rfis').update({ status: 'closed' }).eq('id', rfi_id).select().maybeSingle()
    if (error) return Response.json({ error: `Could not close RFI: ${error.message}` }, { status: 500 })
    return Response.json({ ok: true, rfi: updated || { ...rfi, status: 'closed' } })
  }

  const response = typeof body?.response === 'string' ? body.response.trim() : ''
  if (!response) return Response.json({ error: 'A response is required.' }, { status: 400 })
  const patch = { response, status: 'answered', responded_at: new Date().toISOString(), responded_by: auth.userId }
  const { data: updated, error } = await adminSupabase
    .from('rfis').update(patch).eq('id', rfi_id).select().maybeSingle()
  if (error) return Response.json({ error: `Could not save response: ${error.message}` }, { status: 500 })

  const notified = await notifyRfiAnswered({ ...rfi, ...patch }, response)
  return Response.json({ ok: true, rfi: updated || { ...rfi, ...patch }, notified })
}
