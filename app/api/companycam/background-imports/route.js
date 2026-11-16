import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { isPrincipal } from '../../../../lib/roles'
import { isMissingColumnError } from '../../../../lib/missing-column-retry'
import { importStateOf } from '../../../../lib/companycam-import-batch'
import { isImportParkedAfterErrors } from '../../../../lib/companycam-import'

// Owner-only, read-only (prompt 84): linked jobs with an active or recent background
// CompanyCam import, for the "Background imports" section of /companycam.
// Active = queued / running / paused; recent = stopped / done in the last 7 days. A run parked
// after repeated errors (background false, paused_reason 'repeated_errors') is listed too.
// Filtered in the query (JSON paths, like the cron's) and capped at MAX_ROWS, newest first;
// the same rules are re-checked below.
export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const RECENT_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVE = ['queued', 'running', 'paused']
const MAX_ROWS = 200
const ST = 'companycam_import_state->>'

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return Response.json({ error: 'Owners only' }, { status: 403 })

  const now = Date.now()
  const since = new Date(now - RECENT_MS).toISOString()
  const { data, error } = await adminSupabase.from('jobs')
    .select('id, project_name, job_number, job_type, companycam_project_id, companycam_import_state')
    .not('companycam_project_id', 'is', null)
    .not('companycam_import_state', 'is', null)
    .or([
      `and(${ST}background.eq.true,${ST}status.in.(${ACTIVE.join(',')}))`,
      `and(${ST}background.eq.true,${ST}updated_at.gte."${since}")`,
      `${ST}paused_reason.eq.repeated_errors`,
    ].join(','))
    .order(`${ST}updated_at`, { ascending: false })
    .limit(MAX_ROWS)
  if (error) {
    if (isMissingColumnError(error)) return Response.json({ rows: [], migration_required: '074' })
    return Response.json({ error: error.message }, { status: 500 })
  }
  const rows = (data || [])
    .map(j => ({ job: j, st: importStateOf(j) }))
    .filter(({ st }) => {
      if (!st) return false
      if (isImportParkedAfterErrors(st)) return true
      if (st.background !== true) return false
      if (ACTIVE.includes(st.status)) return true
      const t = new Date(st.updated_at).getTime()
      return Number.isFinite(t) && now - t < RECENT_MS
    })
    .map(({ job, st }) => ({
      job_id: job.id,
      project_name: job.project_name || null,
      job_number: job.job_number || null,
      job_type: job.job_type || null,
      companycam_project_id: job.companycam_project_id,
      status: st.status,
      parked: isImportParkedAfterErrors(st) || undefined,
      active: ACTIVE.includes(st.status),
      start_date: st.start_date || null,
      end_date: st.end_date || null,
      imported: Number(st.imported) || 0,
      skipped: Number(st.skipped) || 0,
      failed: Number(st.failed) || 0,
      last_error: st.last_error || null,
      updated_at: st.updated_at || null,
    }))
    .sort((a, b) => (a.active === b.active ? String(b.updated_at || '').localeCompare(String(a.updated_at || '')) : a.active ? -1 : 1))
  return Response.json({ rows })
}
