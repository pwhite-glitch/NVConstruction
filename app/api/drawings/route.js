import { createClient } from '@supabase/supabase-js'
import { requireAuth, isSub } from '../../../lib/server-auth'
import { denyJob, seesAllJobs, isOnJob, NOT_ASSIGNED_MESSAGE } from '../../../lib/roles'
import { subCanSeeJob } from '../../../lib/sub-access'
import { jobIdFromPath } from '../../../lib/storage-path'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const UPLOAD_ROLES = ['principal', 'pm', 'apm', 'super']
const VIEW_OFFICE_ROLES = new Set(['principal', 'pm', 'apm', 'super', 'admin'])

const forbidden = (msg = 'Forbidden') => Response.json({ error: msg }, { status: 403 })

// Office roles: denyJob (PM/APM limited to their jobs). Supers on write
// actions must also be on the job. Subs: only jobs they can see.
async function denyDrawingJob(auth, jobId, { write = false } = {}) {
  if (!jobId) return Response.json({ error: 'Drawing not found.' }, { status: 404 })
  if (isSub(auth.role)) {
    if (write) return forbidden()
    return (await subCanSeeJob(auth, jobId)) ? null : forbidden(NOT_ASSIGNED_MESSAGE)
  }
  if (!VIEW_OFFICE_ROLES.has(auth.role)) return forbidden()
  const denied = await denyJob(adminSupabase, auth, jobId)
  if (denied) return denied
  if (write && !seesAllJobs(auth.role) && auth.role === 'super') {
    const r = await isOnJob(adminSupabase, auth, jobId)
    if (r.error) return Response.json({ error: r.error.message }, { status: 500 })
    if (!r.ok) return forbidden(NOT_ASSIGNED_MESSAGE)
  }
  return null
}

// The job a stored drawing path belongs to: the drawings row when there is one,
// else the leading "<job_id>/" folder of the path.
async function jobForPath(filePath) {
  const { data: row, error } = await adminSupabase
    .from('drawings').select('job_id').eq('storage_path', filePath).limit(1).maybeSingle()
  if (error) return { error }
  return { jobId: row?.job_id || jobIdFromPath(filePath) }
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { action, path: filePath } = body

    if (action === 'upload-url') {
      if (!UPLOAD_ROLES.includes(auth.role)) return forbidden()
      if (!filePath) return Response.json({ error: 'path required' }, { status: 400 })
      const jobId = jobIdFromPath(filePath)
      if (!jobId) return Response.json({ error: 'Path must start with the job id.' }, { status: 400 })
      const denied = await denyDrawingJob(auth, jobId, { write: true })
      if (denied) return denied
      const { data, error } = await adminSupabase.storage.from('drawings').createSignedUploadUrl(filePath)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl })
    }

    // Save the drawings row for an uploaded file and mark older current
    // revisions of the same sheet as superseded. Done here (service role) so it
    // does not depend on a drawings UPDATE policy.
    if (action === 'record') {
      if (!UPLOAD_ROLES.includes(auth.role)) return forbidden()
      const { job_id, storage_path, file_name, sheet_number, sheet_name, discipline, revision, notes } = body
      if (!job_id || !storage_path || !file_name) {
        return Response.json({ error: 'job_id, storage_path and file_name are required' }, { status: 400 })
      }
      if (jobIdFromPath(storage_path) !== String(job_id).toLowerCase()) {
        return Response.json({ error: 'File path does not match the job.' }, { status: 400 })
      }
      const denied = await denyDrawingJob(auth, job_id, { write: true })
      if (denied) return denied
      const { data: newRow, error: insErr } = await adminSupabase.from('drawings').insert({
        job_id,
        file_name,
        storage_path,
        sheet_number: sheet_number || null,
        sheet_name: sheet_name || null,
        discipline: discipline || 'Architectural',
        revision: revision || '0',
        notes: notes || null,
        uploaded_by: auth.userId,
        is_current: true,
      }).select('id').single()
      if (insErr) return Response.json({ error: 'Could not save the drawing: ' + insErr.message }, { status: 500 })
      if (sheet_number) {
        const { error: supErr } = await adminSupabase.from('drawings')
          .update({ is_current: false, superseded_by: newRow.id })
          .eq('job_id', job_id).eq('sheet_number', sheet_number).eq('is_current', true).neq('id', newRow.id)
        if (supErr) {
          return Response.json({
            error: 'Drawing saved, but older revisions of this sheet could not be marked superseded: ' + supErr.message,
            id: newRow.id,
          }, { status: 500 })
        }
      }
      return Response.json({ ok: true, id: newRow.id })
    }

    if (action === 'signed-url') {
      if (!filePath) return Response.json({ error: 'path required' }, { status: 400 })
      const { jobId, error: lookErr } = await jobForPath(filePath)
      if (lookErr) return Response.json({ error: lookErr.message }, { status: 500 })
      const denied = await denyDrawingJob(auth, jobId)
      if (denied) return denied
      const { data, error } = await adminSupabase.storage.from('drawings').createSignedUrl(filePath, 3600)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    if (action === 'delete') {
      if (!UPLOAD_ROLES.includes(auth.role)) return forbidden()
      const { drawing_id } = body
      if (!drawing_id) return Response.json({ error: 'drawing_id required' }, { status: 400 })
      const { data: row, error: rowErr } = await adminSupabase
        .from('drawings').select('id, job_id, storage_path, sheet_number, is_current').eq('id', drawing_id).maybeSingle()
      if (rowErr) return Response.json({ error: rowErr.message }, { status: 500 })
      if (!row) return Response.json({ error: 'Drawing not found.' }, { status: 404 })
      if (body.storage_path && body.storage_path !== row.storage_path) return forbidden()
      const denied = await denyDrawingJob(auth, row.job_id, { write: true })
      if (denied) return denied

      // Row first: if this fails nothing is lost.
      const { error: delErr } = await adminSupabase.from('drawings').delete().eq('id', row.id)
      if (delErr) return Response.json({ error: 'Could not delete the drawing: ' + delErr.message }, { status: 500 })

      const warnings = []
      // Deleted the current revision: bring back the newest remaining one for that sheet.
      if (row.is_current && row.sheet_number) {
        const { data: prev, error: prevErr } = await adminSupabase.from('drawings')
          .select('id').eq('job_id', row.job_id).eq('sheet_number', row.sheet_number)
          .order('created_at', { ascending: false }).limit(1)
        if (prevErr) warnings.push('Could not look up the previous revision: ' + prevErr.message)
        else if (prev?.length) {
          const { error: restoreErr } = await adminSupabase.from('drawings')
            .update({ is_current: true, superseded_by: null }).eq('id', prev[0].id)
          if (restoreErr) warnings.push('Could not restore the previous revision: ' + restoreErr.message)
        }
      }

      // Storage last; the file is only removed if no other row still points at it.
      if (row.storage_path) {
        const { data: others, error: othersErr } = await adminSupabase
          .from('drawings').select('id').eq('storage_path', row.storage_path).limit(1)
        if (othersErr) warnings.push('Could not check the stored file: ' + othersErr.message)
        else if (!others?.length) {
          const { error: rmErr } = await adminSupabase.storage.from('drawings').remove([row.storage_path])
          if (rmErr) warnings.push('Drawing removed, but the stored file could not be deleted: ' + rmErr.message)
        }
      }
      if (warnings.length) return Response.json({ ok: true, warning: warnings.join(' ') })
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
