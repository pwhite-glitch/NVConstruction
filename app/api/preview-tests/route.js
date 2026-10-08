import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { PREVIEW_ADMIN_ROLES } from '../../../lib/preview-auth'

// Must match migrations/019_preview_seed.sql
const COMPANY_A  = '11111111-1111-4111-8111-111111111111'  // Acme Framing
const COMPANY_B  = '22222222-2222-4222-8222-222222222222'  // Precision Electric
const JOB_A      = '33333333-3333-4333-8333-333333333301'  // A only
const JOB_AB     = '33333333-3333-4333-8333-333333333302'  // A + B
const JOB_B      = '33333333-3333-4333-8333-333333333303'  // B only

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!PREVIEW_ADMIN_ROLES.has(auth.role)) {
    return Response.json({ error: 'PM or Admin required.' }, { status: 403 })
  }

  const results = []
  const pass = (name, detail)         => results.push({ name, pass: true,  detail })
  const fail = (name, detail, reason) => results.push({ name, pass: false, detail, reason })
  const info = (name, detail, note)   => results.push({ name, pass: null,  detail, note })

  // ── Verify staging companies ──────────────────────────────────────────────
  const { data: companies } = await adminSupabase
    .from('companies').select('id, name')
    .in('id', [COMPANY_A, COMPANY_B])

  const companyIds = new Set((companies || []).map(c => c.id))
  if (companyIds.has(COMPANY_A) && companyIds.has(COMPANY_B)) {
    pass('staging_companies', 'Both preview companies found in DB')
  } else {
    fail('staging_companies', 'One or both preview companies missing',
      'Run migration 019_preview_seed.sql at the Supabase dashboard')
  }

  // ── Verify staging jobs ───────────────────────────────────────────────────
  const { data: jobs } = await adminSupabase
    .from('jobs').select('id, job_number, is_preview_data')
    .in('id', [JOB_A, JOB_AB, JOB_B])

  const jobMap = Object.fromEntries((jobs || []).map(j => [j.id, j]))
  const jobsOk = [JOB_A, JOB_AB, JOB_B].every(id => jobMap[id]?.is_preview_data === true)
  if (jobsOk) {
    pass('staging_jobs', 'All 3 preview jobs exist and carry is_preview_data = true')
  } else {
    fail('staging_jobs', 'Preview jobs missing or not flagged',
      'Run migration 019_preview_seed.sql')
  }

  // ── Verify company-job assignments ────────────────────────────────────────
  const { data: assignments } = await adminSupabase
    .from('job_assignments').select('job_id, company_id')
    .in('job_id', [JOB_A, JOB_AB, JOB_B])

  const asgMap = {}
  ;(assignments || []).forEach(a => {
    if (!asgMap[a.job_id]) asgMap[a.job_id] = new Set()
    asgMap[a.job_id].add(a.company_id)
  })

  const checkAsg = (jobId, expectedCompanies, label) => {
    const actual = asgMap[jobId] || new Set()
    if (expectedCompanies.every(id => actual.has(id))) {
      pass(`assignment_${label}`, `${label}: company assignment correct`)
    } else {
      fail(`assignment_${label}`, `${label}: assignment missing`,
        `Expected company IDs: ${expectedCompanies.join(', ')}`)
    }
  }
  checkAsg(JOB_A,  [COMPANY_A],            'Job1_A_only')
  checkAsg(JOB_AB, [COMPANY_A, COMPANY_B], 'Job2_A_and_B')
  checkAsg(JOB_B,  [COMPANY_B],            'Job3_B_only')

  // ── Verify company isolation ──────────────────────────────────────────────
  if (!(asgMap[JOB_A] || new Set()).has(COMPANY_B)) {
    pass('isolation_B_blocked_from_Job1',
      'Company B is NOT assigned to Job 1 (Company A exclusive) — boundary holds')
  } else {
    fail('isolation_B_blocked_from_Job1',
      'Company B incorrectly has access to Job 1',
      'Remove the extra job_assignments row')
  }
  if (!(asgMap[JOB_B] || new Set()).has(COMPANY_A)) {
    pass('isolation_A_blocked_from_Job3',
      'Company A is NOT assigned to Job 3 (Company B exclusive) — boundary holds')
  } else {
    fail('isolation_A_blocked_from_Job3',
      'Company A incorrectly has access to Job 3',
      'Remove the extra job_assignments row')
  }

  // ── Verify preview_sessions table ─────────────────────────────────────────
  const { data: sessions, error: tblErr } = await adminSupabase
    .from('preview_sessions').select('id').limit(1)
  if (!tblErr) {
    pass('preview_sessions_table', 'preview_sessions table exists and is queryable')
  } else {
    fail('preview_sessions_table', 'Cannot query preview_sessions',
      'Run migration 018_preview_sessions.sql')
  }

  // ── Active session log ────────────────────────────────────────────────────
  const { data: activeSessions } = await adminSupabase
    .from('preview_sessions').select('id, preview_role, started_at')
    .is('ended_at', null)
    .gte('started_at', new Date(Date.now() - 8 * 3600000).toISOString())

  info('active_sessions',
    `${(activeSessions || []).length} active preview session(s) in the last 8 hours`,
    (activeSessions || []).map(s =>
      `${s.preview_role} since ${new Date(s.started_at).toLocaleString()}`
    ).join(' | ') || 'none'
  )

  // ── Tests that require a real sub-role JWT ────────────────────────────────
  info('requires_real_auth',
    'These checks cannot run without an actual sub-role JWT (not the service key)',
    [
      'GET /api/billing-entry as sub-A: should return billing for Jobs 1+2, not Job 3',
      'GET /api/billing-entry as sub-B: should NOT return any Company A billing',
      'Direct fetch of Job 1 row as a sub-B profile: should be blocked by RLS',
      'POST /api/billing-entry while preview cookie is set: middleware returns 403',
      'GET /submit listing as sub-A: should show only jobs 1 and 2',
    ].join(' | ')
  )

  const total  = results.filter(r => r.pass !== null).length
  const passed = results.filter(r => r.pass === true).length
  const failed = results.filter(r => r.pass === false).length

  return Response.json({
    summary: { total, passed, failed, info: results.filter(r => r.pass === null).length },
    staging: {
      companies: { A: COMPANY_A, B: COMPANY_B },
      jobs:      { A_only: JOB_A, A_and_B: JOB_AB, B_only: JOB_B },
    },
    results,
  })
}
