import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { isPrincipal } from '../../../../lib/roles'
import { isMissingColumnError } from '../../../../lib/missing-column-retry'
import {
  ccFetch, fetchCcPhoto, importCcPhotoToJob, recordInbox, isMissingTableError,
  migration074Response, hasCcColumn, setJobCcProject,
} from '../../../../lib/companycam'

// Owner-only inbox of CompanyCam photos that did not land in a job gallery (project not
// linked, or the import failed). GET lists; POST assigns a photo to a job (optionally
// linking the project) or dismisses it. Nothing is ever deleted in CompanyCam.
// An assigned photo lands owner-visible (CC_IMPORT_INTERNAL_ONLY via importCcPhotoToJob, prompt 90).
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const OPEN = ['unmatched', 'failed']
const MORE_PER_LINK = 10

async function ownerOnly(request) {
  const auth = await requireAuth(request)
  if (auth.error) return { response: auth.error }
  if (!isPrincipal(auth.role)) return { response: Response.json({ error: 'Owners only' }, { status: 403 }) }
  return { auth }
}

export async function GET(request) {
  const { auth, response } = await ownerOnly(request)
  if (response) return response
  const { data, error } = await adminSupabase.from('companycam_photo_inbox').select('*').in('status', OPEN).order('created_at', { ascending: false }).limit(200)
  if (error) {
    if (isMissingTableError(error) || isMissingColumnError(error)) return Response.json({ rows: [], migration_required: '074' })
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ rows: data || [] })
}

// Import one inbox row's photo into job. → { ok, status, error? }
async function importInboxRow(row, job, userId) {
  const got = await fetchCcPhoto(row.companycam_photo_id)
  if (!got.ok) {
    const error = got.status === 404 ? 'deleted in CompanyCam' : got.error
    await recordInbox(adminSupabase, { id: row.companycam_photo_id }, { status: 'failed', error })
    return { ok: false, status: got.status === 404 ? 404 : 503, error }
  }
  const r = await importCcPhotoToJob(adminSupabase, { job, photo: got.photo, resolvedBy: userId })
  if (r.status === 'imported' || r.status === 'duplicate') return { ok: true, status: r.status }
  if (r.migrationRequired) return { ok: false, status: 503, error: r.error, migrationRequired: r.migrationRequired }
  await recordInbox(adminSupabase, got.photo, { status: 'failed', error: r.error })
  return { ok: false, status: 502, error: r.error }
}

export async function POST(request) {
  const { auth, response } = await ownerOnly(request)
  if (response) return response

  const body = await request.json().catch(() => null)
  const inboxId = body?.inbox_id
  const action = body?.action
  if (!inboxId || typeof inboxId !== 'string') return Response.json({ error: 'inbox_id required' }, { status: 400 })
  if (action !== 'assign' && action !== 'dismiss') return Response.json({ error: "action must be 'assign' or 'dismiss'" }, { status: 400 })

  const { data: row, error: rowErr } = await adminSupabase.from('companycam_photo_inbox').select('*').eq('id', inboxId).maybeSingle()
  if (rowErr) return isMissingTableError(rowErr) ? migration074Response() : Response.json({ error: rowErr.message }, { status: 500 })
  if (!row) return Response.json({ error: 'Not found.' }, { status: 404 })
  if (!OPEN.includes(row.status)) return Response.json({ error: `This photo is already ${row.status}.` }, { status: 409 })

  const now = new Date().toISOString()
  if (action === 'dismiss') {
    const { error } = await adminSupabase.from('companycam_photo_inbox')
      .update({ status: 'dismissed', resolved_by: auth.userId, resolved_at: now, updated_at: now })
      .eq('id', inboxId).in('status', OPEN)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, status: 'dismissed' })
  }

  const jobId = body?.job_id
  if (!jobId || typeof jobId !== 'string') return Response.json({ error: 'job_id required' }, { status: 400 })
  const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('*').eq('id', jobId).maybeSingle()
  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })
  if (!hasCcColumn(job)) return migration074Response()

  // Optional link: only when this job has no project and no other job has this one.
  const pid = row.companycam_project_id || null
  let linked = false
  let linkNote = null
  if (body?.link_project === true && pid) {
    if (job.companycam_project_id && job.companycam_project_id !== pid) {
      linkNote = 'This job is linked to a different CompanyCam project — photo assigned, link unchanged.'
    } else if (!job.companycam_project_id) {
      const { data: other, error: otherErr } = await adminSupabase.from('jobs').select('id').eq('companycam_project_id', pid).limit(1).maybeSingle()
      if (otherErr) return isMissingColumnError(otherErr) ? migration074Response() : Response.json({ error: otherErr.message }, { status: 500 })
      if (other) {
        linkNote = 'That CompanyCam project is already linked to another job — photo assigned, link unchanged.'
      } else {
        const p = await ccFetch(`/projects/${pid}`)
        const project = { id: pid, name: (p.ok && p.data?.name) || row.project_name || null }
        const r = await setJobCcProject(adminSupabase, { job, pid, project, userId: auth.userId })
        if (r.response) {
          if (r.response.status === 503) return r.response
          linkNote = 'Could not link the project — photo assigned only.'
        } else {
          linked = true
          job.companycam_project_id = pid
        }
      }
    }
  }

  const r = await importInboxRow(row, job, auth.userId)
  if (!r.ok) {
    if (r.migrationRequired) return migration074Response()
    return Response.json({ error: r.error || 'Import failed', linked }, { status: r.status })
  }

  const out = { ok: true, status: 'imported', linked, note: linkNote }
  if (linked) {
    const { data: more } = await adminSupabase.from('companycam_photo_inbox').select('*').eq('companycam_project_id', pid).in('status', OPEN).order('created_at', { ascending: true }).limit(MORE_PER_LINK + 1)
    let alsoImported = 0
    for (const m of (more || []).filter(m => m.id !== row.id).slice(0, MORE_PER_LINK)) {
      const x = await importInboxRow(m, job, auth.userId)
      if (x.ok) alsoImported++
      else if (x.migrationRequired) break
    }
    const { count } = await adminSupabase.from('companycam_photo_inbox').select('id', { count: 'exact', head: true }).eq('companycam_project_id', pid).in('status', OPEN)
    out.also_imported = alsoImported
    out.remaining_for_project = count || 0
  }
  return Response.json(out)
}
