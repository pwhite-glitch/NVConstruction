// Homeowner (owner portal) view of a residential job's owner/lender draws.
// Pure: the /api/owner-res-draws route loads the rows; the owner page only displays.
// Received cash comes from drawFundedAmount: a funded draw with no recorded amount is
// UNKNOWN (null), never its requested amount.
import { drawFundedAmount, ownerDrawFunding, pctFunded, round2 } from './owner-draws'

// Statuses an owner sees (drafts are Nv's working copies; void draws were withdrawn).
export const OWNER_RES_DRAW_STATUSES = ['submitted', 'approved', 'funded']
export const isOwnerVisibleResDraw = d => OWNER_RES_DRAW_STATUSES.includes(d?.status)

// rows: res_owner_draws rows for one job. Returns explicit fields only.
export function ownerResDraws(rows = []) {
  const visible = (rows || []).filter(isOwnerVisibleResDraw)
    .sort((a, b) => (Number(a.draw_number) || 0) - (Number(b.draw_number) || 0))
  const draws = visible.map(d => {
    const funded = d.status === 'funded'
    const received = funded ? drawFundedAmount(d) : null
    return {
      id: d.id,
      draw_number: d.draw_number ?? null,
      title: d.title || null,
      period_start: d.period_start || null,
      period_end: d.period_end || null,
      amount_requested: round2(Number(d.amount_requested || 0)),
      status: d.status,
      submitted_date: d.submitted_date || null,
      funded_date: funded ? (d.funded_date || null) : null,
      // number when known; null when not funded yet OR funded with the amount not recorded
      amount_received: received,
      received_unknown: funded && received === null,
    }
  })
  const f = ownerDrawFunding(visible)
  return {
    draws,
    totals: {
      requested: f.requested,
      received_known: f.fundedKnown,
      unknown_received_count: f.unknownFunded,
    },
  }
}

// Owner page figures: requested to date, received (or unknown) and % of the revised
// contract. pct_received is null when any funded draw's amount is unknown.
export function ownerResBilling(totals, revised) {
  const requested = Number(totals?.requested || 0)
  const unknown = Number(totals?.unknown_received_count || 0)
  const receivedKnown = Number(totals?.received_known || 0)
  const rev = Number(revised || 0)
  return {
    requested,
    received: unknown > 0 ? null : receivedKnown,
    received_known: receivedKnown,
    unknown_received_count: unknown,
    pct_requested: rev > 0 ? Math.min(100, Math.round(requested / rev * 100)) : null,
    pct_received: (() => { const p = pctFunded({ fundedKnown: receivedKnown, unknownFunded: unknown }, rev); return p === null ? null : Math.min(100, Math.round(p)) })(),
  }
}
