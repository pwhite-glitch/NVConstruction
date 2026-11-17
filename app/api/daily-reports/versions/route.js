import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../../lib/roles'
import { canViewReportVersions } from '../../../../lib/daily-report-payload'
import { loadReport } from '../../../../lib/daily-report-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const VERSIONS_ROLE_MESSAGE = 'Only an Owner, admin or PM can view earlier versions of a report.'
const VERSION_COLS = 'id, daily_report_id, rev_number, snapshot, finalized_at, finalized_by, reopened_at, reopened_by, created_at'

// limit default 20, clamped 1..50; offset default 0, never negative.
function parseVersionPaging(params) {
  const rawLimit = parseInt(params?.get?.('limit'), 10)
  const rawOffset = parseInt(params?.get?.('offset'), 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 20
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0
  return { limit, offset }
}

const isMissingTable = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''))
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
// The shared helpers' 401/403/404 responses: copy with no-store added (local to this route;
// the helpers and their other callers are unchanged).
const noStore = res => {
  const headers = new Headers(res.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// GET ?report_id=&limit=&offset= — earlier (final) versions of a daily report, saved by
// migration 076's trigger each time the report was reopened (prompt 86). Newest revision first.
// Who: Owner (principal) / admin any job; PM on the job. Supers / APMs → 403; owner-portal
// clients and subs fail requirePM. Snapshot photos are returned as stored (paths / captions,
// no signed URLs). Before 076 → 200 { versions: [], migration_required: '076' }.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return noStore(auth.error)
  if (!canViewReportVersions(auth.role)) return json({ error: VERSIONS_ROLE_MESSAGE }, 403)

  const params = new URL(request.url).searchParams
  const { report, response } = await loadReport(adminSupabase, params.get('report_id'))
  if (response) return noStore(response)
  const denied = await denyUnlessOnJob(adminSupabase, auth, report.job_id)
  if (denied) return noStore(denied)

  const { limit, offset } = parseVersionPaging(params)
  const { data, count, error } = await adminSupabase.from('daily_report_versions')
    .select(VERSION_COLS, { count: 'exact' })
    .eq('daily_report_id', report.id)
    .order('rev_number', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error && isMissingTable(error)) return json({ versions: [], total: 0, limit, offset, has_more: false, migration_required: '076' })
  if (error) return json({ error: `Could not load earlier versions: ${error.message}` }, 500)

  const versions = data || []
  const total = typeof count === 'number' ? count : offset + versions.length
  return json({ versions, total, limit, offset, has_more: offset + versions.length < total })
}
