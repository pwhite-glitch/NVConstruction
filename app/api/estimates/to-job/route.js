import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM } from '../../../../lib/server-auth'
import { sameUpdatedAt } from '../../../../lib/estimate-save'
import {
  JOB_LINK_ROLES, mapEstimateLinesToBudget, estimateTotal, findDuplicates, planLink, budgetSnapshot,
} from '../../../../lib/estimate-to-job'
import { denyJob, accessibleJobIds, isJobLimited } from '../../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST /api/estimates/to-job
//   { action: 'list_jobs' }                       jobs an estimate can be linked to
//   { action: 'preview_link', id, job_id }        what a link would do
//   { action: 'convert', id, expected_updated_at, job_number, start_date }
//   { action: 'link', id, job_id, expected_updated_at, expected_job_lines,
//     expected_contract_value, mode, duplicate_actions, contract_action }
// convert / link run in one transaction via the Postgres functions in
// migrations/039_estimate_to_job.sql.

const json = (body, status = 200) => Response.json(body, { status })

const RPC_STATUS = {
  NV_STALE: 409, NV_JOB_CHANGED: 409, NV_ALREADY_LINKED: 409, NV_JOB_LINKED: 409,
  NV_JOB_NOT_ELIGIBLE: 409, NV_REFERENCED: 409, NV_NOT_FOUND: 404,
  NV_MODE_REQUIRED: 400, NV_INVALID: 400,
}

function rpcErrorResponse(error) {
  const msg = error?.message || 'Database error'
  const m = /^(NV_[A-Z_]+):\s*([\s\S]*)$/.exec(msg)
  if (m) {
    const code = m[1] === 'NV_STALE' ? 'stale' : m[1].slice(3).toLowerCase()
    return json({ error: m[2], code }, RPC_STATUS[m[1]] || 400)
  }
  if (error?.code === 'PGRST202' || /could not find the function/i.test(msg)) {
    return json({ error: 'Database migration 039_estimate_to_job.sql has not been applied yet.', code: 'migration_missing' }, 500)
  }
  return json({ error: msg }, 500)
}

const stale = est => json({ error: 'Someone else saved this estimate. Reload to see the latest.', code: 'stale', current_updated_at: est?.updated_at ?? null }, 409)

// Loads the estimate + its lines and applies the same access rule as
// /api/estimates 'update': office PM roles, or the estimate's creator /
// allowed users.
async function loadEstimate(id, auth) {
  if (!id) return { res: json({ error: 'Estimate id is required' }, 400) }
  const { data: est, error } = await adminSupabase
    .from('estimates').select('*, estimate_line_items(*)').eq('id', id).maybeSingle()
  if (error) return { res: json({ error: error.message }, 500) }
  if (!est) return { res: json({ error: 'Estimate not found' }, 404) }
  if (!isPM(auth.role)) {
    const allowed = est.created_by === auth.userId || (est.allowed_users || []).includes(auth.userId)
    if (!allowed) return { res: json({ error: 'Forbidden' }, 403) }
  }
  return { est, lines: est.estimate_line_items || [] }
}

function checkFresh(body, est) {
  const hasExpected = Object.prototype.hasOwnProperty.call(body, 'expected_updated_at')
  if (!hasExpected || !sameUpdatedAt(body.expected_updated_at, est.updated_at)) return stale(est)
  if (est.job_id) return json({ error: 'This estimate is already linked to a job.', code: 'already_linked' }, 409)
  return null
}

function jobIneligible(job) {
  if (!job) return 'Job not found.'
  if (job.source_estimate_id) return `Job ${job.job_number} is already linked to another estimate.`
  if (job.status !== 'active' || job.is_preview_data || job.archived) return `Job ${job.job_number} is not an active, non-archived, non-preview job.`
  return null
}

const JOB_COLS = 'id, job_number, project_name, contract_value, status, is_preview_data, archived, source_estimate_id'
const LINE_COLS = 'id, job_id, cost_code, description, budget_amount, owner_amount, sort_order'

// PostgREST caps responses (1000 rows by default); page through.
async function fetchAll(build, pageSize = 1000) {
  const out = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) return { error }
    out.push(...(data || []))
    if (!data || data.length < pageSize) return { data: out }
  }
}

async function loadJob(jobId) {
  const { data: job, error } = await adminSupabase.from('jobs').select(JOB_COLS).eq('id', jobId).maybeSingle()
  if (error) return { res: json({ error: error.message }, 500) }
  const why = jobIneligible(job)
  if (why) return { res: json({ error: why, code: job ? 'job_not_eligible' : 'not_found' }, job ? 409 : 404) }
  const { data: lines, error: lErr } = await fetchAll(() =>
    adminSupabase.from('budget_items').select(LINE_COLS).eq('job_id', jobId).order('sort_order', { ascending: true }).order('id', { ascending: true }))
  if (lErr) return { res: json({ error: lErr.message }, 500) }
  return { job, lines }
}

async function userName(userId) {
  const { data } = await adminSupabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return data?.full_name || null
}

const sameContract = (a, b) => (a == null || a === '' ? null : Number(a)) === (b == null || b === '' ? null : Number(b))

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!JOB_LINK_ROLES.has(auth.role)) return json({ error: 'Forbidden' }, 403)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  try {
    // ── Jobs that can take an estimate ──────────────────────────────────────
    if (body.action === 'list_jobs') {
      const { data: jobs, error } = await fetchAll(() =>
        adminSupabase.from('jobs').select(JOB_COLS).eq('status', 'active').is('source_estimate_id', null).order('job_number', { ascending: true }))
      if (error) return json({ error: error.message }, 500)
      let eligible = jobs.filter(j => !j.is_preview_data && !j.archived)
      // PM/APM: only jobs they are on
      if (isJobLimited(auth.role)) {
        const { ids: mine, error: accErr } = await accessibleJobIds(adminSupabase, auth)
        if (accErr) return json({ error: accErr.message }, 500)
        eligible = eligible.filter(j => mine.has(j.id))
      }
      const ids = eligible.map(j => j.id)
      const totals = {}
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const { data: items, error: bErr } = await fetchAll(() =>
          adminSupabase.from('budget_items').select('id, job_id, budget_amount').in('job_id', chunk).order('id', { ascending: true }))
        if (bErr) return json({ error: bErr.message }, 500)
        for (const b of items) {
          const t = totals[b.job_id] || (totals[b.job_id] = { budget_total: 0, line_count: 0 })
          t.budget_total += Number(b.budget_amount || 0)
          t.line_count += 1
        }
      }
      return json({
        jobs: eligible.map(j => ({
          id: j.id, job_number: j.job_number, project_name: j.project_name, contract_value: j.contract_value,
          budget_total: Math.round((totals[j.id]?.budget_total || 0) * 100) / 100,
          line_count: totals[j.id]?.line_count || 0,
        })),
      })
    }

    // ── Preview a link ──────────────────────────────────────────────────────
    if (body.action === 'preview_link') {
      const e = await loadEstimate(body.id, auth)
      if (e.res) return e.res
      if (e.est.job_id) return json({ error: 'This estimate is already linked to a job.', code: 'already_linked' }, 409)
      if (!body.job_id) return json({ error: 'job_id is required' }, 400)
      const jl = await loadJob(body.job_id)
      if (jl.res) return jl.res
      const denied = await denyJob(adminSupabase, auth, jl.job.id)
      if (denied) return denied

      const newLines = mapEstimateLinesToBudget(e.est, e.lines)
      let references = []
      let referencesError = null
      if (jl.lines.length) {
        const { data, error } = await adminSupabase.rpc('budget_line_references', { p_job_id: body.job_id })
        // Shown to the user; the link function re-checks before any Replace.
        if (error) referencesError = (await rpcErrorResponse(error).json()).error
        else references = data || []
      }
      return json({
        estimate_updated_at: e.est.updated_at ?? null,
        estimate_total: estimateTotal(e.est, e.lines),
        new_lines: newLines,
        job: jl.job,
        job_lines: jl.lines,
        job_snapshot: budgetSnapshot(jl.lines),
        duplicates: findDuplicates(jl.lines, newLines).map(d => ({ sort_order: d.sort_order, existing_id: d.existing_id, match: d.match })),
        references,
        references_error: referencesError,
      })
    }

    // ── Convert to a new job ────────────────────────────────────────────────
    if (body.action === 'convert') {
      const jobNumber = String(body.job_number || '').trim()
      if (!jobNumber) return json({ error: 'Job number is required' }, 400)
      const startDate = body.start_date || null
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return json({ error: 'Start date must be YYYY-MM-DD' }, 400)

      const e = await loadEstimate(body.id, auth)
      if (e.res) return e.res
      const notFresh = checkFresh(body, e.est)
      if (notFresh) return notFresh

      const { data, error } = await adminSupabase.rpc('convert_estimate_to_job', {
        p_estimate_id: e.est.id,
        p_expected_updated_at: e.est.updated_at ?? null,
        p_job: { job_number: jobNumber, project_name: e.est.project_name || null, owner_name: e.est.owner_name || null, start_date: startDate },
        p_lines: mapEstimateLinesToBudget(e.est, e.lines),
        p_contract_value: estimateTotal(e.est, e.lines),
        p_user_id: auth.userId,
        p_user_role: auth.role,
        p_user_name: await userName(auth.userId),
      })
      if (error) return rpcErrorResponse(error)

      // A PM who creates a job must be on it. The SQL function assigns APMs
      // only, and does not set pm_email, so add the PM's assignment here.
      // The job already exists, so a failure is reported, not fatal.
      let assignment_error
      if (isJobLimited(auth.role) && auth.role !== 'apm' && data?.job_id) {
        try {
          const { error: aErr } = await adminSupabase.from('pm_job_assignments')
            .insert({ job_id: data.job_id, user_id: auth.userId, assigned_by: auth.userId })
          if (aErr && aErr.code !== '23505') assignment_error = aErr.message
        } catch (err) {
          assignment_error = err?.message || 'Could not assign you to the new job.'
        }
        if (assignment_error) console.error('estimates/to-job convert: could not assign PM to job:', assignment_error)
      }
      return json({ ok: true, ...data, ...(assignment_error ? { assignment_error } : {}) })
    }

    // ── Link to an existing job ─────────────────────────────────────────────
    if (body.action === 'link') {
      if (!body.job_id) return json({ error: 'job_id is required' }, 400)
      if (!Array.isArray(body.expected_job_lines)) return json({ error: 'expected_job_lines is required (open the link preview first)' }, 400)
      if (!Object.prototype.hasOwnProperty.call(body, 'expected_contract_value')) return json({ error: 'expected_contract_value is required (open the link preview first)' }, 400)

      const e = await loadEstimate(body.id, auth)
      if (e.res) return e.res
      const notFresh = checkFresh(body, e.est)
      if (notFresh) return notFresh

      const jl = await loadJob(body.job_id)
      if (jl.res) return jl.res
      const denied = await denyJob(adminSupabase, auth, jl.job.id)
      if (denied) return denied

      // Refuse if the job changed since the user previewed it. The Postgres
      // function repeats this check under a row lock.
      const expected = budgetSnapshot(body.expected_job_lines)
      if (JSON.stringify(budgetSnapshot(jl.lines)) !== JSON.stringify(expected) || !sameContract(jl.job.contract_value, body.expected_contract_value)) {
        return json({ error: `Job ${jl.job.job_number} changed since you opened it. Review it again.`, code: 'job_changed' }, 409)
      }

      const { plan, error: planErr, code } = planLink({
        estimate: e.est, estimateLines: e.lines, job: jl.job, jobLines: jl.lines,
        opts: { mode: body.mode, duplicate_actions: body.duplicate_actions, contract_action: body.contract_action },
      })
      if (planErr) return json({ error: planErr, code }, 400)

      const { data, error } = await adminSupabase.rpc('link_estimate_to_job', {
        p_estimate_id: e.est.id,
        p_expected_updated_at: e.est.updated_at ?? null,
        p_job_id: jl.job.id,
        p_expected_lines: expected,
        p_expected_contract_value: body.expected_contract_value == null || body.expected_contract_value === '' ? null : Number(body.expected_contract_value),
        p_mode: plan.mode,
        p_lines: plan.lines,
        p_set_contract: plan.set_contract,
        p_contract_value: plan.contract_value,
        p_user_id: auth.userId,
        p_user_name: await userName(auth.userId),
      })
      if (error) return rpcErrorResponse(error)
      return json({ ok: true, ...data })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    return json({ error: err?.message || 'Server error' }, 500)
  }
}
