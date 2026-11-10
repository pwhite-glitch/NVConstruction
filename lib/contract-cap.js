// Lump-sum cap for owner pay apps (G702/G703). Individual lines may run over
// their scheduled value, but total completed & stored to date (all lines,
// previous + this period) must not exceed the G702 "Contract Sum to Date".

import { g703Row, screenStored } from './aia-g703'

const r2 = n => Math.round(n * 100) / 100

const approvedTotal = cos => (cos || []).filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)

// Same rules the G702 uses (line 3, Contract Sum to Date):
//   NV-subcontract app → sum of that app's own SOV lines
//   job where NV is the sub → GC subcontracts + their approved COs (job value if none)
//   otherwise → original contract + approved owner change orders
//   prime app whose schedule was frozen at submit (migration 063) → the saved
//     original_contract_sum + net_change_orders, not today's job / change orders.
//     On a job where NV is the sub, the saved original_contract_sum already IS the
//     live line 3 at submit (the sub rule above), so it is returned alone — adding
//     the saved prime COs would count them on top of the sub rule.
export function contractSumToDate({ job, app, primeCOs, nvSubcontracts, lines }) {
  const baseContract = Number(job?.contract_value || 0)
  if (app?.schedule_frozen_at && !app?.nv_subcontract_id && app?.original_contract_sum != null) {
    if (job?.nv_role === 'sub') return r2(Number(app.original_contract_sum || 0))
    return r2(Number(app.original_contract_sum || 0) + Number(app.net_change_orders || 0))
  }
  if (app?.nv_subcontract_id) return r2((lines || []).reduce((a, l) => a + Number(l.budget_amount || 0), 0))
  if (job?.nv_role === 'sub') {
    const subTotal = (nvSubcontracts || []).reduce((a, s) => a + Number(s.contract_value || 0) + approvedTotal(s.change_orders), 0)
    return r2(subTotal > 0 ? subTotal : baseContract)
  }
  return r2(baseContract + approvedTotal(primeCOs))
}

// Total completed & stored to date (G702 line 4 = Column G of the G703 = D + E + F)
// across pay app screen lines, computed the way the G702/G703 PDF does (dollars when
// stored, otherwise % × scheduled; F = materials presently stored, lib/aia-g703.js).
// Lines without stored-material fields count F = 0 (unchanged to the cent).
export function totalCompletedToDate(lines) {
  return r2((lines || []).reduce((a, line) => {
    const scheduled = r2(Number(line.budget_amount || 0))
    const prevAmt = line.dollar_prev != null ? r2(Number(line.dollar_prev)) : r2(scheduled * Math.max(0, parseFloat(line.pct_prev) || 0) / 100)
    const thisAmt = line.dollar_this !== undefined
      ? r2(Number(line.dollar_this) || 0)
      : r2(scheduled * Math.max(0, parseFloat(line.pct_this) || 0) / 100)
    return a + g703Row({ scheduled, prevCompleted: prevAmt, thisCompleted: thisAmt, ...screenStored(line) }).G
  }, 0))
}

// enforced is false when no contract sum is set (contract value blank / $0) —
// there's nothing to cap against, and blocking would stop every save.
export function contractCap(contractSum, totalCompleted) {
  const remaining = r2(contractSum - totalCompleted)
  const enforced = contractSum > 0
  return { contractSum, totalCompleted, remaining, enforced, isOver: enforced && remaining < -0.005 }
}

export function contractCapMessage({ contractSum, totalCompleted, remaining }) {
  const fmt = n => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `Not saved — this pay app would bill more than the contract.\n\n` +
    `Contract sum to date: ${fmt(contractSum)}\n` +
    `Total completed & stored to date: ${fmt(totalCompleted)}\n` +
    `Over by: ${fmt(remaining)}\n\n` +
    `Reduce this period's amounts, or add an approved owner change order.`
}
