import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM, requirePM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Office staff: any RFI. Owners (owner portal): RFIs on jobs whose owner_email
// is their login email, matching how /owner lists their jobs.
async function checkAccess(auth, { rfi_id, job_id }) {
  if (isPM(auth.role)) return null
  const forbidden = Response.json({ error: 'Forbidden' }, { status: 403 })
  if (auth.role !== 'owner' || !auth.email) return forbidden
  let jobId = job_id
  if (rfi_id) {
    const { data: rfi } = await adminSupabase.from('rfis').select('job_id').eq('id', rfi_id).maybeSingle()
    if (!rfi || (jobId && rfi.job_id !== jobId)) return forbidden
    jobId = rfi.job_id
  }
  if (!jobId) return forbidden
  const { data: job } = await adminSupabase.from('jobs').select('id').eq('id', jobId).ilike('owner_email', auth.email).maybeSingle()
  return job ? null : forbidden
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const rfi_id = searchParams.get('rfi_id')
  const job_id = searchParams.get('job_id')
  const denied = await checkAccess(auth, { rfi_id, job_id })
  if (denied) return denied
  let query = adminSupabase.from('rfi_comments').select('*').order('created_at', { ascending: true })
  if (rfi_id) query = query.eq('rfi_id', rfi_id)
  if (job_id) query = query.eq('job_id', job_id)
  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ comments: data || [] })
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  try {
    const { rfi_id, job_id, author_name, author_role, comment } = await request.json()
    if (!rfi_id || !comment?.trim()) return Response.json({ error: 'rfi_id and comment required' }, { status: 400 })
    const denied = await checkAccess(auth, { rfi_id, job_id })
    if (denied) return denied
    const { data, error } = await adminSupabase
      .from('rfi_comments')
      .insert({
        rfi_id,
        job_id: job_id || null,
        author_name: author_name || 'Unknown',
        // Owners always post as 'owner'; office staff may label their role
        author_role: auth.role === 'owner' ? 'owner' : (author_role || 'owner'),
        comment: comment.trim(),
      })
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ comment: data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await adminSupabase.from('rfi_comments').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
