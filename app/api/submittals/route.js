import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf, ilikeExact } from '../../../lib/roles'
import { jobIdFromPath } from '../../../lib/storage-path'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

// New files arrive as attachments: [{ path, uploadReceipt }, …] uploaded directly to Storage
// (POST /api/file-upload, target submittal-doc). Each is verified for this job (and, on PATCH,
// this submittal) and stored in the same { path, name } shape as before; no proof is saved.
const MAX_ATTACHMENTS = 50
async function verifySubmittalFiles(auth, attachments, ctx) {
  if (attachments === undefined || attachments === null) return { files: [] }
  if (!Array.isArray(attachments)) return { error: Response.json({ error: 'attachments must be a list.' }, { status: 400 }) }
  if (attachments.length > MAX_ATTACHMENTS) return { error: Response.json({ error: `Attach at most ${MAX_ATTACHMENTS} files at a time.` }, { status: 400 }) }
  const files = []
  for (const att of attachments) {
    const v = await verifyAttachment(adminSupabase, att, { target: 'submittal-doc', subject: auth.userId, ctx })
    if (!v.ok) return { error: attachmentErrorResponse(v) }
    if (files.some(f => f.path === v.path)) return { error: Response.json({ error: 'The same file was attached twice.' }, { status: 400 }) }
    files.push({ path: v.path, name: v.fileName })
  }
  return { files }
}

async function readBody(request) {
  const multipart = rejectMultipart(request)
  if (multipart) return { error: multipart }
  let fields
  try { fields = await request.json() } catch { return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) } }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const inline = inlineFileContentError(fields)
  if (inline) return { error: Response.json({ error: inline }, { status: 400 }) }
  return { fields }
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
    const parsed = await readBody(request)
    if (parsed.error) return parsed.error
    const { attachments, ...fields } = parsed.fields

    const denied = await denyJob(adminSupabase, auth, fields.job_id)
    if (denied) return denied
    if (!fields.job_id || !fields.title) return Response.json({ error: 'job_id and title required' }, { status: 400 })
    const verified = await verifySubmittalFiles(auth, attachments, { job: fields.job_id })
    if (verified.error) return verified.error
    const newFiles = verified.files

    const { job_id, title, type, spec_section, submitted_by_sub_id, submitted_by_company, notes } = fields

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
    const parsed = await readBody(request)
    if (parsed.error) return parsed.error
    const { attachments, ...fields } = parsed.fields
    const { id, status, notes, reviewer_id, title, spec_section, remove_file_path } = fields
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    // The stored row's job is authoritative; a different job_id in the body is refused even
    // when the caller can see both jobs.
    const { data: current, error: curErr } = await adminSupabase.from('submittals').select('id, job_id, file_url').eq('id', id).maybeSingle()
    if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
    if (!current) return Response.json({ error: 'Not found.' }, { status: 404 })
    const denied = await denyJob(adminSupabase, auth, current.job_id)
    if (denied) return denied
    if (fields.job_id !== undefined && fields.job_id !== null && fields.job_id !== current.job_id) {
      return Response.json({ error: 'That submittal is on a different job.' }, { status: 400 })
    }
    const verified = await verifySubmittalFiles(auth, attachments, { job: current.job_id, rec: current.id })
    if (verified.error) return verified.error
    const newFiles = verified.files

    const updates = {}
    if (status !== undefined) { updates.status = status; if (reviewer_id) { updates.reviewed_at = new Date().toISOString(); updates.reviewer_id = reviewer_id } }
    if (notes !== undefined) updates.notes = notes
    if (title !== undefined) updates.title = title
    if (spec_section !== undefined) updates.spec_section = spec_section

    if (newFiles.length > 0 || remove_file_path !== undefined) {
      // Merge with existing files
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
