// Credits sub billings to the right subcontract.
//
// billing_submissions has no subcontract_id. The real link is per line:
//   billing_sov_lines.sov_line_id -> subcontract_sov_lines.subcontract_id
// so a submission that bills lines on two contracts is split between them.
//
// Fallback for a submission with no billing_sov_lines: if its sub has exactly
// one contract on the job, the header amount_billed goes to that contract.
// Otherwise the submission is "unassigned" and is not added to any contract.
//
// Safe to import on client and server (no Supabase calls here).
import { sameCompany } from './company-name'

const num = v => Number(v || 0)
const round2 = n => Math.round(n * 100) / 100

// Header vs lines differ by more than half a cent.
export function linesMismatch(headerAmount, linesTotal) {
  return Math.abs(round2(num(headerAmount)) - round2(num(linesTotal))) >= 0.005
}

// Contracts on the job that belong to the submission's sub: by sub_id when
// both sides have one, else by loose company name ("A&B Dirt Movers" = "A&B Dirt Movers Inc").
export function contractsForSubmissionSub(submission, contracts) {
  return (contracts || []).filter(c => {
    if (c.sub_id && submission.sub_id) return c.sub_id === submission.sub_id
    return sameCompany(c.vendor_name, submission.company_name)
  })
}

/**
 * Allocate every submission on a job to contracts.
 *
 * @param {object} args
 * @param {Array} args.contracts      job subcontracts [{ id, sub_id, vendor_name }]
 * @param {Array} args.sovLines       subcontract_sov_lines [{ id, subcontract_id }]
 * @param {Array} args.submissions    billing_submissions for the job
 * @param {Array} args.billingLines   billing_sov_lines [{ billing_submission_id, sov_line_id, amount }]
 *                                    (a line may carry subcontract_sov_lines.subcontract_id from a join;
 *                                    used when its sov_line_id isn't in sovLines)
 * @returns {{
 *   byContract: Object<string, { billedApproved: number, retainageApproved: number,
 *     submissions: Array<{ submission, amount, retainage, viaFallback: boolean }> }>,
 *   bySubmission: Object<string, { hasLines: boolean, linesTotal: number, header: number,
 *     mismatch: boolean, contractAmounts: Object<string, number>, unassigned: boolean }>,
 *   unassigned: Array<object>,
 * }}
 */
export function allocateJobBillings({ contracts = [], sovLines = [], submissions = [], billingLines = [] } = {}) {
  const lineContract = {}
  for (const l of sovLines || []) lineContract[l.id] = l.subcontract_id

  const linesBySub = {}
  for (const bl of billingLines || []) {
    ;(linesBySub[bl.billing_submission_id] ||= []).push(bl)
  }

  const byContract = {}
  for (const c of contracts || []) byContract[c.id] = { billedApproved: 0, retainageApproved: 0, submissions: [] }
  const bySubmission = {}
  const unassigned = []

  for (const s of submissions || []) {
    const lines = linesBySub[s.id] || []
    const header = num(s.amount_billed)
    const linesTotal = round2(lines.reduce((a, l) => a + num(l.amount), 0))
    const contractAmounts = {}
    let viaFallback = false

    if (lines.length) {
      for (const l of lines) {
        const cid = lineContract[l.sov_line_id] ?? l.subcontract_sov_lines?.subcontract_id ?? null
        if (!cid) continue
        contractAmounts[cid] = round2((contractAmounts[cid] || 0) + num(l.amount))
      }
    } else {
      const own = contractsForSubmissionSub(s, contracts)
      if (own.length === 1) {
        contractAmounts[own[0].id] = header
        viaFallback = true
      }
    }

    const isUnassigned = Object.keys(contractAmounts).length === 0
    bySubmission[s.id] = {
      hasLines: lines.length > 0,
      linesTotal,
      header,
      mismatch: lines.length > 0 && linesMismatch(header, linesTotal),
      contractAmounts,
      unassigned: isUnassigned,
    }
    if (isUnassigned) { unassigned.push(s); continue }

    // Retainage is split in proportion to each contract's share of the submission.
    const base = lines.length ? linesTotal : header
    for (const [cid, amount] of Object.entries(contractAmounts)) {
      const retainage = base > 0 ? round2(num(s.retainage_held) * amount / base) : 0
      const bucket = (byContract[cid] ||= { billedApproved: 0, retainageApproved: 0, submissions: [] })
      bucket.submissions.push({ submission: s, amount, retainage, viaFallback })
      if (s.status === 'approved') {
        bucket.billedApproved = round2(bucket.billedApproved + amount)
        bucket.retainageApproved = round2(bucket.retainageApproved + retainage)
      }
    }
  }

  return { byContract, bySubmission, unassigned }
}

/**
 * Billing for one contract. `contracts` is every contract on the job (needed for
 * the one-contract fallback); defaults to just this one.
 */
export function billingForContract({ contract, contracts, sovLines, submissions, billingLines }) {
  const all = contracts && contracts.length ? contracts : [contract]
  const { byContract } = allocateJobBillings({ contracts: all, sovLines, submissions, billingLines })
  return byContract[contract.id] || { billedApproved: 0, retainageApproved: 0, submissions: [] }
}

/**
 * Cumulative amount billed on a contract up to and including `submissionId`
 * (ordered by submitted_at), counting statuses in `countStatus`.
 */
export function cumulativeOnContract(contractEntry, submissionId, countStatus = s => s.status !== 'rejected') {
  if (!contractEntry) return null
  const sorted = [...contractEntry.submissions].sort((a, z) => new Date(a.submission.submitted_at) - new Date(z.submission.submitted_at))
  let cum = 0
  for (const e of sorted) {
    if (e.submission.id === submissionId || countStatus(e.submission)) cum += e.amount
    if (e.submission.id === submissionId) return round2(cum)
  }
  return null
}
