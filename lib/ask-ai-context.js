// System prompt for Ask AI on the job pages. Pure: /api/ask-ai loads the rows with the
// service role and passes them in, so tests can check the numbers without calling Gemini.
//
// Money sources (reused helpers, no math of our own):
//  - Owner billing, commercial / unknown job_type: prime AIA pay apps (nv_subcontract_id
//    null) through ownerPayApps — billed_to_date = G702 current payment due on visible apps.
//  - Owner billing, residential: res_owner_draws through ownerResDraws / ownerDrawFunding.
//    A funded draw with no amount_funded is UNKNOWN received cash, never its requested amount.
//  - Contract value: revisedContract(job, primeCOs) = base + approved prime (owner) COs.
//  - billing_submissions are SUB billing (allocated per subcontract), never owner billing.
import { allocateJobBillings } from './contract-billing'
import { isResidentialJob } from './job-links'
import { ownerPayApps } from './owner-pay-apps'
import { ownerResDraws, ownerResBilling } from './owner-res-draws'
import { ownerDrawFunding } from './owner-draws'
import { revisedContract, approvedCOTotal, approvedDcTotal, signedDcAmount } from './residential-money'

export const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

// How many direct costs are listed as a "recent" sample. Totals always use every row.
export const RECENT_COST_SAMPLE = 30

// A subcontract's revised value (after approved sub COs, from subcontracts_summary).
export const contractRevised = c => Number(c.adjusted_contract_value || c.contract_value || 0)

// The part of a contract's revised value committed on one budget line. Same share rule as
// contractCommittedForItem: with budget_allocations, allocation amount / sum of allocation
// amounts; otherwise all of it goes to budget_item_id. Splits the revised value (summary
// adjusted_contract_value already includes approved sub COs), so the per-line amounts of a
// fully allocated contract add up to its revised value counted once in the header.
export function contractRevisedOnLine(c, budgetItemId) {
  const allocs = c.budget_allocations
  if (allocs && allocs.length > 0) {
    const totalAlloc = allocs.reduce((s, a) => s + Number(a.amount || 0), 0)
    if (!(totalAlloc > 0)) return 0
    const lineAlloc = allocs
      .filter(a => a.budget_item_id === budgetItemId)
      .reduce((s, a) => s + Number(a.amount || 0), 0)
    return contractRevised(c) * lineAlloc / totalAlloc
  }
  return c.budget_item_id === budgetItemId ? contractRevised(c) : 0
}

// Sub CO direction label. Unknown directions are shown raw, never "(from owner)".
export function subCoDirectionLabel(direction) {
  if (direction === 'pm_to_sub') return 'PM → Sub (to sub)'
  if (direction === 'sub_to_pm') return 'Sub → PM (from sub)'
  return direction ? `direction: ${direction}` : 'direction: unknown'
}

const primeCoLabel = co => (co.co_number !== null && co.co_number !== undefined && co.co_number !== '')
  ? `PCO-${String(co.co_number).padStart(3, '0')} ` : ''

function ownerBillingSection({ job, residential, primeApps, primeLinesByApp, budgetItems, resDraws, revised }) {
  if (residential) {
    const { draws, totals } = ownerResDraws(resDraws)
    const billing = ownerResBilling(totals, revised)
    const drafts = ownerDrawFunding(resDraws).drafts
    const draftCount = (resDraws || []).filter(d => d.status === 'draft').length
    const received = billing.unknown_received_count > 0
      ? `received ${fmt(billing.received_known)} known, plus ${billing.unknown_received_count} funded draw${billing.unknown_received_count === 1 ? '' : 's'} with the funded amount NOT recorded (received total unknown — do not assume the requested amount was received)`
      : `received ${fmt(billing.received_known)}`
    const lines = draws.map(d => {
      const rec = d.status !== 'funded' ? 'not funded yet'
        : d.received_unknown ? 'received UNKNOWN (funded, amount not recorded)'
        : `received ${fmt(d.amount_received)}`
      return `  • Draw ${d.draw_number ?? '—'}${d.title ? ' (' + d.title + ')' : ''} [${d.status}]: requested ${fmt(d.amount_requested)}, ${rec}`
    }).join('\n')
    const draftLine = draftCount
      ? `\n  • ${draftCount} draft draw${draftCount === 1 ? '' : 's'} (${fmt(drafts)}) not yet submitted — not counted in requested or received`
      : ''
    return `OWNER BILLING (owner/lender draws) — requested ${fmt(billing.requested)} to date, ${received}:
${lines || '  No submitted owner draws'}${draftLine}`
  }

  const pay = ownerPayApps({ apps: primeApps || [], linesByApp: primeLinesByApp || {}, budgetItems })
  const knownReceived = pay.apps.filter(a => a.amount_received !== null)
  const receivedTotal = knownReceived.reduce((a, r) => a + r.amount_received, 0)
  const lines = pay.apps.map(a =>
    `  • Pay App #${a.app_number ?? '—'} [${a.status}]${a.period_to ? ' period to ' + a.period_to : ''}: current payment due ${fmt(a.current_payment_due)}${a.amount_received !== null ? ', received ' + fmt(a.amount_received) : ''}`
  ).join('\n')
  const receivedLine = pay.apps.length
    ? `\n  Received from owner (recorded on pay apps): ${fmt(receivedTotal)}${knownReceived.length < pay.apps.length ? ` (${pay.apps.length - knownReceived.length} app${pay.apps.length - knownReceived.length === 1 ? '' : 's'} with no payment recorded)` : ''}`
    : ''
  return `OWNER BILLING (prime AIA pay apps) — billed ${fmt(pay.billed_to_date)} to date (sum of current payment due on submitted / certified / approved / paid apps):
${lines || '  No submitted prime pay applications'}${receivedLine}`
}

// rows: { job, budgetItems, costs (ALL direct costs, newest first), contracts, changeOrders
// (sub COs), primeChangeOrders, billings (sub billing_submissions), billingLines, primeApps,
// primeLinesByApp, resDraws }. today: optional Date for tests.
export function buildSystemPrompt({
  job, budgetItems = [], costs = [], contracts = [], changeOrders = [], primeChangeOrders = [],
  billings = [], billingLines = [], primeApps = [], primeLinesByApp = {}, resDraws = [], today = new Date(),
}) {
  const residential = isResidentialJob(job)
  const totalBudget = budgetItems.reduce((a, b) => a + Number(b.budget_amount || 0), 0)
  // Revised values (after sub COs) — the same figure the per-line committed splits.
  const totalCommitted = contracts.reduce((a, c) => a + contractRevised(c), 0)
  const pendingCosts = costs.filter(c => c.status === 'pending')
  const totalApprovedCosts = approvedDcTotal(costs)
  const approvedSubBilling = billings.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.amount_billed || 0), 0)
  const revised = revisedContract(job, primeChangeOrders)
  const approvedPrimeCOs = approvedCOTotal(primeChangeOrders)

  const budgetLines = budgetItems.map(b => {
    const lineCommitted = contracts.reduce((a, c) => a + contractRevisedOnLine(c, b.id), 0)
    const lineCosts = approvedDcTotal(costs, b.id)
    return `  • ${b.cost_code ? b.cost_code + ' ' : ''}${b.description}: budget ${fmt(b.budget_amount)}, committed ${fmt(lineCommitted)}, direct costs ${fmt(lineCosts)}`
  }).join('\n')

  // Billings credited per contract through billing_sov_lines -> subcontract_sov_lines
  const alloc = allocateJobBillings({ contracts, submissions: billings, billingLines })
  const subLines = contracts.map(c =>
    `  • ${c.vendor_name || 'Unknown'}${c.description ? ' (' + String(c.description).split('\n')[0].slice(0, 60) + ')' : ''}: contract ${fmt(c.contract_value)}, revised ${fmt(contractRevised(c))}, billed ${fmt(alloc.byContract[c.id]?.billedApproved || 0)}`
  ).join('\n')
  const unassignedApproved = alloc.unassigned.filter(b => b.status === 'approved')
  const unassignedLine = unassignedApproved.length
    ? `\n  • Unassigned approved sub billings (no line items, sub has several contracts): ${fmt(unassignedApproved.reduce((a, b) => a + Number(b.amount_billed || 0), 0))}`
    : ''

  const recentCosts = costs.slice(0, RECENT_COST_SAMPLE).map(c =>
    `  • ${c.cost_date} ${c.description} ${fmt(signedDcAmount(c))} [${c.status}] ${c.category}${c.vendor ? ' — ' + c.vendor : ''}`
  ).join('\n')
  const recentLabel = costs.length > RECENT_COST_SAMPLE
    ? `Most recent ${RECENT_COST_SAMPLE} of ${costs.length} (totals above include all of them):`
    : 'All direct costs:'

  const primeCoLines = primeChangeOrders.map(co =>
    `  • ${primeCoLabel(co)}${co.description || 'Change order'}: ${fmt(co.amount)} [${co.status}]`
  ).join('\n') || '  None'

  const subCoLines = changeOrders.map(co =>
    `  • ${co.description || 'Change order'}: ${fmt(co.amount)} [${co.status}] ${subCoDirectionLabel(co.direction)}`
  ).join('\n') || '  None'

  const ownerBilling = ownerBillingSection({ job, residential, primeApps, primeLinesByApp, budgetItems, resDraws, revised })

  return `You are an AI assistant for NV Construction's project management portal. You have live data for the job below and can answer questions about budget, costs, subcontractors, billing, and profitability. Be concise and use the actual dollar figures. If you don't know something, say so.

JOB: ${job.project_name || job.name || 'Unnamed'} ${job.job_number ? '#' + job.job_number : ''}
Type: ${residential ? 'residential' : 'commercial'}
Address: ${job.address || '—'}
Contract Value: ${fmt(revised)} (base ${fmt(job.contract_value)} + approved owner COs ${fmt(approvedPrimeCOs)})
Status: ${job.status || 'active'}

BUDGET (${budgetItems.length} lines, total ${fmt(totalBudget)}):
${budgetLines || '  No budget items'}

SUBCONTRACTS (${contracts.length}, total committed ${fmt(totalCommitted)} revised):
${subLines || '  None'}${unassignedLine}

OWNER / PRIME CHANGE ORDERS (change the contract with the owner):
${primeCoLines}

SUB CHANGE ORDERS (between NV and subcontractors — not owner COs):
${subCoLines}

DIRECT COSTS — approved total ${fmt(totalApprovedCosts)} (${costs.length} costs on the job), ${pendingCosts.length} pending:
${recentCosts ? recentLabel + '\n' + recentCosts : '  None'}

${ownerBilling}

SUB BILLING (subcontractor invoices to NV — not owner billing) — approved ${fmt(approvedSubBilling)}

Today's date: ${today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
}
