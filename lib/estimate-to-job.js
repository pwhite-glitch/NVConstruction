// Estimate -> job budget: line mapping, duplicate detection and request
// validation. Shared by app/api/estimates/to-job/route.js and the workspace UI.
// The database work itself happens in one transaction in the Postgres
// functions from migrations/039_estimate_to_job.sql.

import {
  DEFAULT_TAX_RATE, estimateBreakdown, formatTaxRate, lineCost as sharedLineCost, linePrice as sharedLinePrice,
} from './calc-total'

// Roles allowed to convert / link. 'dev' is not in the profiles role
// constraint today (see 006/012); it is listed because it was asked for.

export const JOB_LINK_ROLES = new Set(['principal', 'pm', 'apm', 'dev'])

// Default rate as a fraction, kept for backward compatibility only. The
// actual per-estimate rate (estimates.tax_rate, percentage points) is applied
// by lib/calc-total.js estimateBreakdown().
export const SALES_TAX_RATE = DEFAULT_TAX_RATE / 100

// Friendly names for budget_line_references() rows.
export const REFERENCE_LABELS = {
  subcontracts:             'Subcontracts / commitments',
  subcontract_sov_lines:    'Subcontract SOV lines',
  purchase_orders:          'Purchase orders',
  aia_application_lines:    'Pay application (billing) lines',
  direct_costs:             'Direct costs',
  general_conditions:       'General conditions entries',
  employee_job_allocations: 'Employee labor allocations',
  prime_change_orders:      'Prime change orders',
}

const isBlank = v => v === null || v === undefined || v === ''
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// Same math as the estimate everywhere (lib/calc-total.js is the single
// source): a per-line markup_pct overrides the estimate's global %, a
// per-line markup_flat is added on top.
export const lineCost = sharedLineCost
export const linePrice = sharedLinePrice

// Estimate grand total: line prices + global flat markup + tax on raw cost
// at the estimate's actual tax_rate (default 8.25), tax not marked up.
export function estimateTotal(estimate, lines) {
  return round2(estimateBreakdown(estimate, lines || []).total)
}

// Description used for the sales-tax budget line created on conversion/link.
export function taxLineDescription(estimate) {
  const b = estimateBreakdown(estimate, [])
  return `Sales tax (${formatTaxRate(b.taxRate)}% on raw cost)`
}

// One budget line per estimate line that has a description (the estimate
// save already drops lines without one). budget_amount = cost,
// owner_amount = price with markup. sort_order follows the estimate order.
//
// Sales tax: when the estimate is taxable and the tax is non-zero, ONE extra
// budget line is appended carrying the actual tax amount as both cost
// (budget_amount — NV pays the tax) and owner price (owner_amount — passed
// through at cost, not marked up). This keeps the job budget reconcilable
// with the contract total (which already includes tax): no dropped and no
// duplicated tax. The estimate's global flat markup stays in the contract
// total only, exactly as before.
export function mapEstimateLinesToBudget(estimate, lines) {
  const globalPct = Number(estimate?.markup_pct || 0)
  const mapped = [...(lines || [])]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .filter(l => String(l.description || '').trim() !== '')
    .map((l, i) => ({
      description:   String(l.description).trim(),
      cost_code:     isBlank(l.cost_code) ? null : String(l.cost_code).trim() || null,
      budget_amount: round2(lineCost(l)),
      owner_amount:  round2(linePrice(l, globalPct)),
      sort_order:    i,
    }))
  const tax = round2(estimateBreakdown(estimate, lines || []).tax)
  if (tax !== 0) {
    mapped.push({
      description:   taxLineDescription(estimate),
      cost_code:     null,
      budget_amount: tax,
      owner_amount:  tax,
      sort_order:    mapped.length,
    })
  }
  return mapped
}

// ── Duplicates (link to existing job, "add" mode) ────────────────────────────
const normDesc = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const normCode = s => String(s || '').trim().toLowerCase()

// For each new line, the existing line it collides with (description match
// wins over cost-code match; lowest sort_order wins among several).
export function findDuplicates(existingLines, newLines) {
  const existing = [...(existingLines || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const out = []
  for (const n of newLines || []) {
    const byDesc = existing.find(e => normDesc(e.description) !== '' && normDesc(e.description) === normDesc(n.description))
    const byCode = !byDesc && normCode(n.cost_code) !== ''
      ? existing.find(e => normCode(e.cost_code) === normCode(n.cost_code))
      : null
    const hit = byDesc || byCode
    if (hit) out.push({ sort_order: n.sort_order, existing_id: hit.id, match: byDesc ? 'description' : 'cost_code', new_line: n, existing_line: hit })
  }
  return out
}

// Snapshot of a job's budget lines as the user saw them. The Postgres
// function refuses to act if the job's lines no longer match it.
export function budgetSnapshot(lines) {
  return [...(lines || [])]
    .map(l => ({
      id:            l.id,
      description:   l.description ?? null,
      cost_code:     l.cost_code ?? null,
      budget_amount: l.budget_amount == null ? null : Number(l.budget_amount),
      owner_amount:  l.owner_amount == null ? null : Number(l.owner_amount),
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

const contractEmpty = v => v === null || v === undefined || Number(v) === 0

// Validates the user's choices for a link and builds what the Postgres
// function needs. Returns { error } or { plan }.
//   opts.mode:              'add' | 'replace' (required if the job has lines)
//   opts.duplicate_actions: { [new sort_order]: 'merge' | 'keep_both' }
//   opts.contract_action:   'set' | 'keep' (empty contract), 'keep' | 'replace' (set)
export function planLink({ estimate, estimateLines, job, jobLines, opts }) {
  const newLines = mapEstimateLinesToBudget(estimate, estimateLines)
  const total = estimateTotal(estimate, estimateLines)
  const hasLines = (jobLines || []).length > 0

  let mode = opts?.mode ?? null
  if (hasLines && !['add', 'replace'].includes(mode)) {
    return { error: 'This job already has budget lines. Choose Add to existing or Replace.', code: 'mode_required' }
  }
  if (!hasLines) mode = 'add'

  const duplicates = mode === 'add' ? findDuplicates(jobLines, newLines) : []
  const actions = opts?.duplicate_actions || {}
  const unresolved = duplicates.filter(d => !['merge', 'keep_both'].includes(actions[d.sort_order]))
  if (unresolved.length) {
    return {
      error: `Choose Merge or Keep both for: ${unresolved.map(d => d.new_line.description).join(', ')}`,
      code: 'duplicates_unresolved',
    }
  }

  const empty = contractEmpty(job?.contract_value)
  const ca = opts?.contract_action
  const allowed = empty ? ['set', 'keep'] : ['keep', 'replace']
  if (!allowed.includes(ca)) {
    return { error: empty ? 'Choose whether to set the contract value to the estimate total.' : 'Choose whether to keep or replace the contract value.', code: 'contract_choice_required' }
  }
  const setContract = ca === 'set' || ca === 'replace'

  const lines = newLines.map(l => {
    const d = duplicates.find(x => x.sort_order === l.sort_order)
    return { ...l, merge_into: d && actions[l.sort_order] === 'merge' ? d.existing_id : null }
  })

  return {
    plan: {
      mode,
      lines,
      duplicates,
      contract_value: setContract ? total : null,
      set_contract: setContract,
      estimate_total: total,
    },
  }
}
