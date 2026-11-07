import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf, ilikeExact } from '../../../lib/roles'
import { jobIdFromPath } from '../../../lib/storage-path'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

async function uploadSubmittalDoc(file, jobId) {
  const ext = file.name.split('.').pop()
  const path = `${jobId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await adminSupabase.storage
    .from('submittal-docs')
    .upload(path, buffer, { contentType: file.type })
  if (error) throw new Error('File upload failed: ' + error.message)
  return { path, name: file.name }
}

// file_url is stored as JSON array: [{path, name}, ...] or legacy string
function parseFileUrls(raw) {
  if (!raw) return []
  if (raw.startsWith('[')) {
    try { return JSON.parse(raw) } catch { return [] }
  }
  // legacy single string
  return [{ path: raw, name: raw.split('/').pop() }]
}

// Signing a submittal file: the path must be on a submittal row (for the job in
// the path, when the path starts with a job id) and the caller must pass the
// job check for that submittal's job. Returns a Response to send back, or null.
async function denySubmittalPath(auth, path) {
  const parts = typeof path === 'string' ? path.split('/') : []
  if (!parts.length || parts.some(p => p === '' || p === '.' || p === '..')) {
    return Response.json({ error: 'Invalid file path.' }, { status: 400 })
  }
  const pathJobId = jobIdFromPath(path)
  let q = adminSupabase.from('submittals').select('id, job_id, file_url').like('file_url', `%${ilikeExact(path)}%`)
  if (pathJobId) q = q.eq('job_id', pathJobId)
  const { data, error } = await q.limit(50)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const row = (data || []).find(r =>
    parseFileUrls(r.file_url).some(f => f?.path === path) &&
    (!pathJobId || String(r.job_id).toLowerCase() === pathJobId))
  if (!row) return Response.json({ error: 'That file is not on a submittal you can open.' }, { status: 403 })
  return denyJob(adminSupabase, auth, row.job_id)
}

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const file_path = searchParams.get('file_path')

  if (file_path) {
    const denied = await denySubmittalPath(auth, file_path)
    if (denied) return denied
    const { data, error } = await adminSupabase.storage
      .from('submittal-docs')
      .createSignedUrl(file_path, 300)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ url: data.signedUrl })
  }

  if (!job_id) return Response.json({ submittals: [] })
  const denied = await denyJob(adminSupabase, auth, job_id)
  if (denied) return denied
  const { data, error } = await adminSupabase
    .from('submittals')
    .select('*')
    .eq('job_id', job_id)
    .order('number', { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ submittals: data || [] })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const contentType = request.headers.get('content-type') || ''
    let fields = {}
    let newFiles = []

    let files = []

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      files = formData.getAll('file')
      fields = JSON.parse(formData.get('data') || '{}')
    } else {
      fields = await request.json()
    }

    const denied = await denyJob(adminSupabase, auth, fields.job_id)
    if (denied) return denied
    for (const file of files) {
      if (file && file.size > 0) newFiles.push(await uploadSubmittalDoc(file, fields.job_id))
    }

    const { job_id, title, type, spec_section, submitted_by_sub_id, submitted_by_company, notes } = fields
    if (!job_id || !title) return Response.json({ error: 'job_id and title required' }, { status: 400 })

    const file_url = newFiles.length > 0 ? JSON.stringify(newFiles) : null

    // Auto-number
    const { data: existing } = await adminSupabase.from('submittals').select('number').eq('job_id', job_id).order('number', { ascending: false }).limit(1)
    const nextNum = ((existing?.[0]?.number) || 0) + 1

    const { data: submittal, error } = await adminSupabase
      .from('submittals')
      .insert({ job_id, number: nextNum, title, type: type || 'shop_drawing', spec_section: spec_section || null, submitted_by_sub_id: submitted_by_sub_id || null, submitted_by_company: submitted_by_company || null, notes: notes || null, file_url })
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Notify PM
    const pmEmail = process.env.PM_EMAIL || 'management@nvim.co'
    const { data: jobRow } = await adminSupabase.from('jobs').select('job_number, project_name').eq('id', job_id).single()
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to: pmEmail,
      subject: `New submittal — ${submitted_by_company || 'Sub'} · #${jobRow?.job_number}`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
        <p style="color:#60a5fa;font-size:16px;font-weight:700;margin:0 0 8px">New submittal #${nextNum}</p>
        <p style="color:#aaa;margin:0 0 8px"><strong style="color:#f1f1f1">${submitted_by_company || 'Subcontractor'}</strong> submitted <strong style="color:#f1f1f1">${title}</strong> on job <strong style="color:#f1f1f1">#${jobRow?.job_number} — ${jobRow?.project_name}</strong>.</p>
        <p style="color:#555;font-size:13px">Type: ${type || 'Shop Drawing'}${spec_section ? ` · Section ${spec_section}` : ''}${newFiles.length > 0 ? ` · ${newFiles.length} file(s) attached` : ''}</p>
      </div>`,
    }).catch(() => {})

    return Response.json({ submittal })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const contentType = request.headers.get('content-type') || ''
    let fields = {}
    let newFiles = []

    let files = []

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      files = formData.getAll('file')
      fields = JSON.parse(formData.get('data') || '{}')
    } else {
      fields = await request.json()
    }

    if (fields.id) {
      const denied = await denyJobOf(adminSupabase, auth, 'submittals', fields.id)
      if (denied) return denied
    }
    if (fields.job_id) {
      const deniedJob = await denyJob(adminSupabase, auth, fields.job_id)
      if (deniedJob) return deniedJob
    }
    for (const file of files) {
      if (file && file.size > 0) newFiles.push(await uploadSubmittalDoc(file, fields.job_id))
    }

    const { id, status, notes, reviewer_id, title, spec_section, job_id, remove_file_path } = fields
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const updates = {}
    if (status !== undefined) { updates.status = status; if (reviewer_id) { updates.reviewed_at = new Date().toISOString(); updates.reviewer_id = reviewer_id } }
    if (notes !== undefined) updates.notes = notes
    if (title !== undefined) updates.title = title
    if (spec_section !== undefined) updates.spec_section = spec_section

    if (newFiles.length > 0 || remove_file_path !== undefined) {
      // Merge with existing files
      const { data: current } = await adminSupabase.from('submittals').select('file_url').eq('id', id).single()
      let existing = parseFileUrls(current?.file_url)
      if (remove_file_path) existing = existing.filter(f => f.path !== remove_file_path)
      const merged = [...existing, ...newFiles]
      updates.file_url = merged.length > 0 ? JSON.stringify(merged) : null
    }

    const { error } = await adminSupabase.from('submittals').update(updates).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Notify sub if status changed
    if (status && (status === 'approved' || status === 'rejected' || status === 'resubmit')) {
      const { data: sub_data } = await adminSupabase.from('submittals').select('submitted_by_sub_id, title, job_id, number').eq('id', id).single()
      if (sub_data?.submitted_by_sub_id) {
        const { data: profile } = await adminSupabase.from('profiles').select('email').eq('id', sub_data.submitted_by_sub_id).single()
        const { data: jobRow } = await adminSupabase.from('jobs').select('job_number, project_name').eq('id', sub_data.job_id).single()
        if (profile?.email) {
          const color = status === 'approved' ? '#4ade80' : status === 'rejected' ? '#ff6b6b' : '#facc15'
          await resend.emails.send({
            from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
            to: profile.email,
            subject: `Submittal ${status} — #${sub_data.number} ${sub_data.title}`,
            html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
              <p style="color:${color};font-size:16px;font-weight:700;margin:0 0 8px">Submittal ${status}</p>
              <p style="color:#aaa;margin:0 0 8px">Submittal #${sub_data.number} <strong style="color:#f1f1f1">${sub_data.title}</strong> on job <strong style="color:#f1f1f1">#${jobRow?.job_number} — ${jobRow?.project_name}</strong> has been marked <strong style="color:${color}">${status}</strong>.</p>
              ${notes ? `<p style="color:#888;font-size:13px;margin:8px 0 0">Notes: ${notes}</p>` : ''}
            </div>`,
          }).catch(() => {})
        }
      }
    }
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const denied = await denyJobOf(adminSupabase, auth, 'submittals', id)
  if (denied) return denied
  const { error } = await adminSupabase.from('submittals').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
