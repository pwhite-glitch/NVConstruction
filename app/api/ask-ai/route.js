import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

function buildSystemPrompt(job, budgetItems, costs, contracts, changeOrders, billings) {
  const totalBudget = budgetItems.reduce((a, b) => a + Number(b.budget_amount || 0), 0)
  const totalCommitted = contracts.reduce((a, c) => a + Number(c.contract_value || 0), 0)
  const approvedCosts = costs.filter(c => c.status === 'approved')
  const pendingCosts = costs.filter(c => c.status === 'pending')
  const totalApprovedCosts = approvedCosts.reduce((a, c) => a + (c.is_credit ? -1 : 1) * Number(c.amount || 0), 0)
  const approvedBilling = billings.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.amount_billed || 0), 0)

  const budgetLines = budgetItems.map(b => {
    const lineContracts = contracts.filter(c =>
      c.budget_item_id === b.id ||
      (c.budget_allocations || []).some(a => a.budget_item_id === b.id)
    )
    const lineCommitted = lineContracts.reduce((a, c) => a + Number(c.adjusted_contract_value || c.contract_value || 0), 0)
    const lineCosts = approvedCosts.filter(c => c.budget_item_id === b.id)
      .reduce((a, c) => a + (c.is_credit ? -1 : 1) * Number(c.amount || 0), 0)
    return `  • ${b.cost_code ? b.cost_code + ' ' : ''}${b.description}: budget ${fmt(b.budget_amount)}, committed ${fmt(lineCommitted)}, direct costs ${fmt(lineCosts)}`
  }).join('\n')

  const subLines = contracts.map(c =>
    `  • ${c.vendor_name || 'Unknown'}: contract ${fmt(c.contract_value)}, revised ${fmt(c.adjusted_contract_value || c.contract_value)}, billed ${fmt(billings.filter(b => b.status === 'approved' && (b.sub_id === c.sub_id || (b.company_name || '').toLowerCase() === (c.vendor_name || '').toLowerCase())).reduce((a, b) => a + Number(b.amount_billed || 0), 0))}`
  ).join('\n')

  const recentCosts = costs.slice(0, 30).map(c =>
    `  • ${c.cost_date} ${c.description} ${fmt(c.amount)} [${c.status}] ${c.category}${c.vendor ? ' — ' + c.vendor : ''}`
  ).join('\n')

  const coLines = changeOrders.map(co =>
    `  • ${co.description || 'Change order'}: ${fmt(co.amount)} [${co.status}] ${co.direction === 'pm_to_sub' ? '(to sub)' : '(from owner)'}`
  ).join('\n') || '  None'

  return `You are an AI assistant for NV Construction's project management portal. You have live data for the job below and can answer questions about budget, costs, subcontractors, billing, and profitability. Be concise and use the actual dollar figures. If you don't know something, say so.

JOB: ${job.project_name || job.name || 'Unnamed'} ${job.job_number ? '#' + job.job_number : ''}
Address: ${job.address || '—'}
Contract Value: ${fmt(job.contract_value)}${job.approved_change_orders ? ' + COs ' + fmt(job.approved_change_orders) : ''}
Status: ${job.status || 'active'}

BUDGET (${budgetItems.length} lines, total ${fmt(totalBudget)}):
${budgetLines || '  No budget items'}

SUBCONTRACTS (${contracts.length}, total committed ${fmt(totalCommitted)}):
${subLines || '  None'}

CHANGE ORDERS:
${coLines}

DIRECT COSTS — approved total ${fmt(totalApprovedCosts)}, ${pendingCosts.length} pending:
${recentCosts || '  None'}

OWNER BILLING — approved ${fmt(approvedBilling)} billed to date

Today's date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { job_id, messages } = body
  if (!job_id || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'job_id and messages required' }, { status: 400 })
  }

  // Fetch all job context in parallel
  const [
    { data: job },
    { data: budgetItems },
    { data: costs },
    { data: changeOrders },
    { data: billings },
  ] = await Promise.all([
    adminSupabase.from('jobs').select('project_name, job_number, address, contract_value, approved_change_orders, status').eq('id', job_id).maybeSingle(),
    adminSupabase.from('budget_items').select('id, cost_code, description, budget_amount, owner_amount').eq('job_id', job_id).order('sort_order', { ascending: true }),
    adminSupabase.from('direct_costs').select('id, description, amount, status, category, cost_date, vendor, budget_item_id, is_credit').eq('job_id', job_id).order('cost_date', { ascending: false }).limit(100),
    adminSupabase.from('change_orders').select('description, amount, status, direction').eq('job_id', job_id),
    adminSupabase.from('billing_submissions').select('amount_billed, status, sub_id, company_name').eq('job_id', job_id),
  ])

  // Fetch subcontracts separately (view may differ by environment)
  const { data: contractsRaw } = await adminSupabase
    .from('subcontracts')
    .select('id, vendor_name, sub_id, contract_value, budget_item_id, budget_allocations')
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

  const systemPrompt = buildSystemPrompt(
    job,
    budgetItems || [],
    costs || [],
    contracts,
    changeOrders || [],
    billings || []
  )

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
