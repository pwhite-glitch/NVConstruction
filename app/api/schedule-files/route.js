import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { jobIdFromPath, jobUploadPathError } from '../../../lib/storage-path'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKET = 'schedule-files'
const bad = (msg, status = 400) => Response.json({ error: msg }, { status })

// Schedule tab files (MS Project / XML / PDF / Excel). Every path is
// "<job_id>/..." and every action runs the job check (PM/APM limited to their
// jobs). The browser never talks to the schedule-files bucket or the
// job_schedule_files table directly.

// GET ?job_id= — list the job's schedule files.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const jobId = new URL(request.url).searchParams.get('job_id')
  if (!jobId) return bad('job_id required')
  const denied = await denyJob(adminSupabase, auth, jobId)
  if (denied) return denied
  const { data, error } = await adminSupabase
    .from('job_schedule_files').select('*').eq('job_id', jobId).order('uploaded_at', { ascending: false })
  if (error) return bad(error.message, 500)
  return Response.json({ files: data || [] })
}

// POST { action: 'upload-url' | 'record' | 'signed-url' | 'delete', ... }
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return bad('Invalid JSON') }
  const { action } = body || {}

  try {
    if (action === 'upload-url') {
      const path = body.path
      if (!path) return bad('path required')
      const pathErr = jobUploadPathError(path)
      if (pathErr) return bad(pathErr, 403)
      const denied = await denyJob(adminSupabase, auth, jobIdFromPath(path))
      if (denied) return denied
      const { data, error } = await adminSupabase.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error) return bad('Could not get an upload link: ' + error.message, 500)
      return Response.json({ signedUrl: data.signedUrl, path })
    }

    if (action === 'record') {
      const { job_id, storage_path, file_name, revision, notes } = body
      if (!job_id || !storage_path || !file_name) return bad('job_id, storage_path and file_name are required')
      const pathErr = jobUploadPathError(storage_path, job_id)
      if (pathErr) return bad(pathErr, 403)
      const denied = await denyJob(adminSupabase, auth, job_id)
      if (denied) return denied
      const { data, error } = await adminSupabase.from('job_schedule_files').insert({
        job_id,
        file_name: String(file_name),
        storage_path,
        file_type: String(file_name).split('.').pop().toLowerCase(),
        revision: revision || null,
        notes: notes || null,
      }).select('id').single()
      if (error) return bad('File uploaded, but it could not be saved to the list: ' + error.message, 500)
      return Response.json({ ok: true, id: data?.id })
    }

    if (action === 'signed-url') {
      const path = body.path
      if (!path) return bad('path required')
      const jobId = jobIdFromPath(path)
      if (!jobId) return bad('Path must start with the job id.', 403)
      const { data: rows, error: rowErr } = await adminSupabase
        .from('job_schedule_files').select('id, job_id').eq('storage_path', path).limit(5)
      if (rowErr) return bad(rowErr.message, 500)
      const row = (rows || []).find(r => String(r.job_id).toLowerCase() === jobId)
      if (!row) return bad('Schedule file not found.', 404)
      const denied = await denyJob(adminSupabase, auth, row.job_id)
      if (denied) return denied
      const { data, error } = await adminSupabase.storage.from(BUCKET).createSignedUrl(path, 3600)
      if (error) return bad('Could not open the file: ' + error.message, 500)
      return Response.json({ url: data.signedUrl })
    }

    if (action === 'delete') {
      const { file_id } = body
      if (!file_id) return bad('file_id required')
      const { data: row, error: rowErr } = await adminSupabase
        .from('job_schedule_files').select('id, job_id, storage_path').eq('id', file_id).maybeSingle()
      if (rowErr) return bad(rowErr.message, 500)
      if (!row) return bad('Schedule file not found.', 404)
      const denied = await denyJob(adminSupabase, auth, row.job_id)
      if (denied) return denied

      // Row first: if this fails, nothing is lost.
      const { error: delErr } = await adminSupabase.from('job_schedule_files').delete().eq('id', row.id)
      if (delErr) return bad('Could not delete the file: ' + delErr.message, 500)

      // Storage last, only when the path is in this job's folder and no other row uses it.
      if (row.storage_path && jobIdFromPath(row.storage_path) === String(row.job_id).toLowerCase()) {
        const { data: others, error: othersErr } = await adminSupabase
          .from('job_schedule_files').select('id').eq('storage_path', row.storage_path).limit(1)
        if (othersErr) return Response.json({ ok: true, warning: 'File removed from the list, but the stored copy could not be checked: ' + othersErr.message })
        if (!others?.length) {
          const { error: rmErr } = await adminSupabase.storage.from(BUCKET).remove([row.storage_path])
          if (rmErr) return Response.json({ ok: true, warning: 'File removed from the list, but the stored copy could not be deleted: ' + rmErr.message })
        }
      }
      return Response.json({ ok: true })
    }

    return bad('unknown action')
  } catch (e) {
    return bad(e.message, 500)
  }
}
