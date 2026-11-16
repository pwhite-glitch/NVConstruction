import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { atLeastPM, denyUnlessOnJob } from '../../../../lib/roles'
import { isMissingColumnError } from '../../../../lib/missing-column-retry'
import { ccFetch, parseCcProjectId, migration074Response, hasCcColumn, jobLabel, setJobCcProject } from '../../../../lib/companycam'
import { isImportRunning } from '../../../../lib/companycam-import'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const projectOut = p => (p ? { id: String(p.id), name: p.name || null, address: p.address || null } : null)

async function unmatchedWaiting(pid) {
  if (!pid) return 0
  try {
    const { count, error } = await adminSupabase.from('companycam_photo_inbox').select('id', { count: 'exact', head: true }).eq('status', 'unmatched').eq('companycam_project_id', pid)
    return error ? 0 : count || 0
  } catch { return 0 }
}

// POST { job_id, companycam_project_id }  (null / '' = unlink)
// Owner (principal) or a PM on the job. Writes jobs.companycam_project_id with the service
// role (DB guard in 074 refuses browser writes) and one Change History row.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!atLeastPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const jobId = body?.job_id
  if (!jobId || typeof jobId !== 'string') return Response.json({ error: 'job_id required' }, { status: 400 })
  const denied = await denyUnlessOnJob(adminSupabase, auth, jobId)
  if (denied) return denied

  const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('*').eq('id', jobId).maybeSingle()
  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })
  if (!hasCcColumn(job)) return migration074Response()

  const input = body?.companycam_project_id
  const unlink = input === null || input === undefined || String(input).trim() === ''
  const old = job.companycam_project_id || null
  // A batch still in flight would keep importing the old project (its state saves are
  // compare-and-set and would be dropped). Refuse to change the link until it finishes or goes stale.
  const importBusy = () => Response.json({ error: 'A CompanyCam import is running for this job. Try again in a minute.' }, { status: 409 })

  if (unlink) {
    if (!old) return Response.json({ ok: true, companycam_project_id: null, project: null, unmatched_waiting: 0 })
    if (isImportRunning(job.companycam_import_state)) return importBusy()
    const r = await setJobCcProject(adminSupabase, { job, pid: null, project: null, userId: auth.userId })
    if (r.response) return r.response
    return Response.json({ ok: true, companycam_project_id: null, project: null, unmatched_waiting: 0 })
  }

  const pid = parseCcProjectId(input)
  if (!pid) return Response.json({ error: 'Enter a CompanyCam project id or project link.' }, { status: 400 })

  const p = await ccFetch(`/projects/${pid}`)
  if (!p.ok) {
    if (p.status === 404) return Response.json({ error: 'No CompanyCam project with that id' }, { status: 400 })
    return Response.json({ error: `Could not reach CompanyCam: ${p.error}` }, { status: 503 })
  }
  const project = projectOut({ ...p.data, id: p.data?.id ?? pid })

  if (old === pid) return Response.json({ ok: true, companycam_project_id: pid, project, unmatched_waiting: await unmatchedWaiting(pid) })

  const { data: other, error: otherErr } = await adminSupabase.from('jobs').select('*').eq('companycam_project_id', pid).neq('id', jobId).limit(1).maybeSingle()
  if (otherErr) return isMissingColumnError(otherErr) ? migration074Response() : Response.json({ error: otherErr.message }, { status: 500 })
  if (other) return Response.json({ error: `That CompanyCam project is already linked to ${jobLabel(other)}.` }, { status: 409 })
  if (isImportRunning(job.companycam_import_state)) return importBusy()

  const r = await setJobCcProject(adminSupabase, { job, pid, project, userId: auth.userId })
  if (r.response) return r.response
  return Response.json({ ok: true, companycam_project_id: pid, project, unmatched_waiting: await unmatchedWaiting(pid) })
}
