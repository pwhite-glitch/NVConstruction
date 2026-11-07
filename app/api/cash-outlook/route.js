import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { isPrincipal } from '../../../lib/roles'
import { fetchAll, isMissingRelation } from '../../../lib/budget-line-refs'
import { todayCentral } from '../../../lib/central-date'
import { inActiveJobList } from '../../../lib/job-lifecycle'
import { aiaItems, lenderDrawItems, billingItems, poItems, payrollItems, DEFAULT_WEEKS } from '../../../lib/cash-outlook'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'

// Company-wide cash outlook. Owner (principal) only: every job, including
// completed and archived ones that still owe or are owed money. Jobs flagged
// is_preview_data (role-preview seed, migration 018/019) are left out — that is
// the existing trusted convention; no name guessing.
// Salary rows never leave the server: only weekly payroll totals are returned.
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE })

const CHUNK = 200

// Does `table` have `column`? { ok } | { missing } | { error }
async function hasColumn(table, column) {
  const { error } = await adminSupabase.from(table).select(`id, ${column}`).limit(1)
  if (!error) return { ok: true }
  if (isMissingRelation(error)) return { missing: true }
  return { error }
}

async function inChunks(ids, build) {
  const out = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await fetchAll(() => build(chunk))
    if (error) return { data: null, error }
    out.push(...data)
  }
  return { data: out, error: null }
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  // Owner-only BEFORE any financial query. requirePM would let PM/APM/super/admin in.
  if (!isPrincipal(auth.role)) return json({ error: 'Only Owners can see the company cash outlook.' }, 403)

  const fail = (what, error) => json({ error: `Could not read ${what}: ${error?.message || 'unknown error'}. The outlook is incomplete, so nothing is shown.` }, 500)

  // PROPOSED columns (migration 047 / 046, written, NOT applied): probe, never assume.
  const [aiaDate, billDate, drawDate, drawFunded] = await Promise.all([
    hasColumn('aia_applications', 'expected_payment_date'),
    hasColumn('billing_submissions', 'expected_payment_date'),
    hasColumn('res_owner_draws', 'expected_payment_date'),
    hasColumn('res_owner_draws', 'amount_funded'),
  ])
  for (const [what, r] of [['pay apps', aiaDate], ['sub billings', billDate], ['owner draws', drawDate], ['owner draws', drawFunded]]) {
    if (r.error) return fail(what, r.error)
  }
  const datesMigrated = !!(aiaDate.ok && billDate.ok && drawDate.ok)

  const jobsRes = await fetchAll(() => adminSupabase.from('jobs').select('*').order('id'))
  if (jobsRes.error) return fail('jobs', jobsRes.error)
  const previewJobs = jobsRes.data.filter(j => j.is_preview_data === true)
  const jobs = jobsRes.data.filter(j => j.is_preview_data !== true)
  const jobsById = Object.fromEntries(jobs.map(j => [j.id, j]))
  const jobIds = jobs.map(j => j.id)

  const [appsRes, drawsRes, billsRes, posRes, empRes] = await Promise.all([
    fetchAll(() => adminSupabase.from('aia_applications').select('*').order('id')),
    fetchAll(() => adminSupabase.from('res_owner_draws').select('*').order('id')),
    fetchAll(() => adminSupabase.from('billing_submissions').select('*').eq('status', 'approved').is('paid_at', null).order('id')),
    fetchAll(() => adminSupabase.from('purchase_orders').select('id, job_id, po_number, vendor_name, amount, status, issued_date, draw_request_id, payment_type').in('status', ['issued', 'received']).order('id')),
    fetchAll(() => adminSupabase.from('employees').select('id, active, weekly_salary, weekly_truck, weekly_healthcare, weekly_taxes').order('id')),
  ])
  if (appsRes.error) return fail('pay apps', appsRes.error)
  if (drawsRes.error) return fail('owner draws', drawsRes.error)
  if (billsRes.error) return fail('sub billings', billsRes.error)
  if (posRes.error) return fail('purchase orders', posRes.error)
  if (empRes.error) return fail('payroll data', empRes.error)

  const apps = appsRes.data.filter(a => jobsById[a.job_id])
  // Lines + budget lines for every job with a draft or sent app (sequence math needs prior apps).
  const appJobIds = [...new Set(apps.filter(a => ['draft', 'submitted', 'certified'].includes(a.status)).map(a => a.job_id))]
  const appIds = apps.filter(a => appJobIds.includes(a.job_id)).map(a => a.id)
  const linesRes = await inChunks(appIds, chunk => adminSupabase.from('aia_application_lines').select('*').in('application_id', chunk).order('id'))
  if (linesRes.error) return fail('pay app lines', linesRes.error)
  const budgetRes = await inChunks(appJobIds, chunk => adminSupabase.from('budget_items').select('id, job_id, budget_amount, owner_amount').in('job_id', chunk).order('id'))
  if (budgetRes.error) return fail('budget lines', budgetRes.error)

  const linesByApp = {}
  for (const l of linesRes.data) (linesByApp[l.application_id] = linesByApp[l.application_id] || []).push(l)
  const budgetByJob = {}
  for (const b of budgetRes.data) (budgetByJob[b.job_id] = budgetByJob[b.job_id] || []).push(b)

  const today = todayCentral()
  const aia = aiaItems({ jobsById, apps, linesByApp, budgetByJob, datesMigrated })
  const draws = lenderDrawItems({ jobsById, draws: drawsRes.data, fundedMigrated: !!drawFunded.ok, datesMigrated })
  const bills = billingItems({ jobsById, billings: billsRes.data, datesMigrated })
  const pos = poItems({ jobsById, pos: posRes.data })
  const payroll = payrollItems({ employees: empRes.data, today, weeks: DEFAULT_WEEKS })

  // Active jobs with no draft pay app / lender draw: their unbilled work is not quantified (not $0).
  const hasDraft = new Set([...aia.items, ...draws.items].filter(i => i.category === 'unbilled').map(i => i.job?.id))
  const unquantified = jobs.filter(j => inActiveJobList(j) && !hasDraft.has(j.id)).length

  return json({
    as_of: today,
    generated_at: new Date().toISOString(),
    items: [...aia.items, ...draws.items, ...bills.items, ...pos.items, ...payroll.items],
    payroll: payroll.summary,
    disclosures: [...aia.disclosures, ...draws.disclosures],
    owner_paid_billings: bills.ownerPaid,
    owner_check_pos: pos.ownerCheck,
    sub_retainage_held: bills.retainageHeld,
    unquantified_unbilled_jobs: unquantified,
    jobs_count: jobIds.length,
    preview_jobs_excluded: previewJobs.length,
    migration: {
      expected_payment_dates: datesMigrated, // 047
      amount_funded: !!drawFunded.ok,        // 046
    },
  })
}
