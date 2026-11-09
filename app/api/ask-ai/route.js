import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../lib/roles'
import { sanitizeChatMessages } from '../../../lib/ai-messages'
import { buildSystemPrompt } from '../../../lib/ask-ai-context'
import { isResidentialJob } from '../../../lib/job-links'
import { isMissingRelation } from '../../../lib/budget-line-refs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// A money read failed (after any schema-column fallback). Stop before the model request:
// a missing or partial list must never reach Gemini as a complete total.
const contextLoadFailed = () => Response.json(
  { error: "Could not load this job's numbers (costs, owner billing or change orders). Please try again." },
  { status: 500 }
)

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { job_id } = body
  if (!job_id || !Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: 'job_id and messages required' }, { status: 400 })
  }
  // Office roles only (job budget, costs, sub contract values). Principal/admin:
  // any job. PM/APM/super: only a job they are on. Subs, client owners, sales: 403.
  const denied = await denyUnlessOnJob(adminSupabase, auth, job_id)
  if (denied) return denied
  // Only user/assistant turns from the browser, capped in count and size.
  const { messages, error: msgErr } = sanitizeChatMessages(body.messages)
  if (msgErr) return Response.json({ error: msgErr }, { status: 400 })

  // Fetch all job context in parallel
  const [
    { data: job },
    { data: budgetItems },
    { data: changeOrders },
    { data: billings },
  ] = await Promise.all([
    adminSupabase.from('jobs').select('project_name, job_number, address, contract_value, approved_change_orders, status, job_type').eq('id', job_id).maybeSingle(),
    adminSupabase.from('budget_items').select('id, cost_code, description, budget_amount, owner_amount').eq('job_id', job_id).order('sort_order', { ascending: true }),
    adminSupabase.from('change_orders').select('description, amount, status, direction').eq('job_id', job_id),
    adminSupabase.from('billing_submissions').select('id, amount_billed, retainage_held, status, sub_id, company_name, submitted_at').eq('job_id', job_id),
  ])

  // Every direct cost on the job (newest first), paged — totals must not stop at a cap.
  const costs = []
  for (let from = 0; ; from += 1000) {
    const { data: page, error: costErr } = await adminSupabase
      .from('direct_costs')
      .select('id, description, amount, status, category, cost_date, vendor, budget_item_id, is_credit')
      .eq('job_id', job_id)
      .order('cost_date', { ascending: false })
      .order('id')
      .range(from, from + 999)
    if (costErr) { console.error('ask-ai direct_costs:', costErr.message); return contextLoadFailed() }
    costs.push(...(page || []))
    if (!page || page.length < 1000) break
  }

  // Owner / prime change orders (prime_change_orders). nv_cost is not read (058 not applied).
  let { data: primeChangeOrders, error: pcoErr } = await adminSupabase
    .from('prime_change_orders').select('id, co_number, description, amount, status').eq('job_id', job_id)
  if (pcoErr && isMissingRelation(pcoErr)) {
    ({ data: primeChangeOrders, error: pcoErr } = await adminSupabase
      .from('prime_change_orders').select('id, description, amount, status').eq('job_id', job_id))
  }
  if (pcoErr) { console.error('ask-ai prime_change_orders:', pcoErr.message); return contextLoadFailed() }

  // Owner billing: residential → res_owner_draws only; commercial / unknown → prime AIA apps only.
  let primeApps = []
  const primeLinesByApp = {}
  let resDraws = []
  if (job && isResidentialJob(job)) {
    const DRAW_COLS = 'id, job_id, draw_number, title, period_start, period_end, amount_requested, status, submitted_date, funded_date'
    let { data, error } = await adminSupabase.from('res_owner_draws').select(`${DRAW_COLS}, amount_funded`).eq('job_id', job_id).order('draw_number')
    if (error && isMissingRelation(error)) {
      // 046 not applied: no funded amounts exist, so a funded draw's received cash is unknown.
      ({ data, error } = await adminSupabase.from('res_owner_draws').select(DRAW_COLS).eq('job_id', job_id).order('draw_number'))
    }
    if (error) { console.error('ask-ai res_owner_draws:', error.message); return contextLoadFailed() }
    resDraws = data || []
  } else if (job) {
    const { data: apps, error: appErr } = await adminSupabase.from('aia_applications').select('*').eq('job_id', job_id).is('nv_subcontract_id', null)
    if (appErr) { console.error('ask-ai aia_applications:', appErr.message); return contextLoadFailed() }
    primeApps = apps || []
    if (primeApps.length) {
      const { data: lines, error: lErr } = await adminSupabase.from('aia_application_lines').select('*').in('application_id', primeApps.map(a => a.id))
      if (lErr) { console.error('ask-ai aia_application_lines:', lErr.message); return contextLoadFailed() }
      for (const l of lines || []) (primeLinesByApp[l.application_id] ||= []).push(l)
    }
  }

  // Line breakdown with each SOV line's contract — this is what ties a billing to a contract
  const billingLines = []
  for (let from = 0; ; from += 1000) {
    const { data: page, error: linesErr } = await adminSupabase
      .from('billing_sov_lines')
      .select('billing_submission_id, sov_line_id, amount, subcontract_sov_lines(subcontract_id), billing_submissions!inner(job_id)')
      .eq('billing_submissions.job_id', job_id)
      .order('billing_submission_id')
      .order('sov_line_id')
      .range(from, from + 999)
    if (linesErr) { console.error('ask-ai billing_sov_lines:', linesErr.message); break }
    billingLines.push(...(page || []))
    if (!page || page.length < 1000) break
  }

  // Fetch subcontracts separately (view may differ by environment)
  const { data: contractsRaw } = await adminSupabase
    .from('subcontracts')
    .select('id, vendor_name, sub_id, description, contract_value, budget_item_id, budget_allocations')
    .eq('job_id', job_id)

  // Try to get adjusted values from the summary view
  const { data: contractsSummary } = await adminSupabase
    .from('subcontracts_summary')
    .select('id, adjusted_contract_value, approved_change_orders')
    .eq('job_id', job_id)

  const contracts = (contractsRaw || []).map(c => {
    const summary = (contractsSummary || []).find(s => s.id === c.id)
    return { ...c, adjusted_contract_value: summary?.adjusted_contract_value ?? c.contract_value }
  })

  if (!job) return Response.json({ error: 'Job not found' }, { status: 404 })

  const systemPrompt = buildSystemPrompt({
    job,
    budgetItems: budgetItems || [],
    costs,
    contracts,
    changeOrders: changeOrders || [],
    primeChangeOrders: primeChangeOrders || [],
    billings: billings || [],
    billingLines,
    primeApps,
    primeLinesByApp,
    resDraws,
  })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return Response.json({ error: 'AI not configured' }, { status: 503 })

  const geminiRes = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 1024,
    }),
  })

  if (!geminiRes.ok) {
    const errText = await geminiRes.text()
    console.error('Gemini error:', errText)
    return Response.json({ error: 'AI request failed' }, { status: 502 })
  }

  const geminiData = await geminiRes.json()
  const reply = geminiData.choices?.[0]?.message?.content
  if (!reply) return Response.json({ error: 'No response from AI' }, { status: 502 })

  return Response.json({ reply })
}
