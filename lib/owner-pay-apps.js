// Owner portal Pay Applications: the job's prime AIA sequence (nv_subcontract_id
// null), drafts left out, each with its G702 CURRENT PAYMENT DUE computed from the
// G703 lines the same way the job page PDF and the Owner cash outlook do
// (aiaCurrentPaymentDue). Pure; the route loads the rows with the service role.
import { aiaCurrentPaymentDue, r2 } from './cash-outlook'

// Statuses an owner sees. Blank/null status is a draft (new apps are inserted without one).
export const OWNER_PAY_APP_STATUSES = ['submitted', 'certified', 'approved', 'paid']
export const isOwnerVisiblePayApp = a => !a?.nv_subcontract_id && OWNER_PAY_APP_STATUSES.includes(String(a?.status || '').toLowerCase())

const appNo = a => { const n = parseFloat(a?.app_number); return Number.isFinite(n) ? n : null }
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

// apps: every aia_applications row on the job (drafts included: earlier lines still
// feed "previous" amounts). Returns { apps: [...], billed_to_date, has_aia }.
export function ownerPayApps({ apps = [], linesByApp = {}, budgetItems = [] }) {
  const prime = apps.filter(a => !a.nv_subcontract_id)
  const visible = prime.filter(isOwnerVisiblePayApp)
    .sort((a, b) => (appNo(a) ?? Infinity) - (appNo(b) ?? Infinity))
  const rows = visible.map(app => {
    const r = aiaCurrentPaymentDue({ app, apps: prime, linesByApp, budgetItems })
    return {
      id: app.id,
      app_number: app.app_number ?? null,
      period_from: app.period_from || null,
      period_to: app.period_to || null,
      status: String(app.status).toLowerCase(),
      submitted_at: app.submitted_at || app.created_at || null,
      current_payment_due: r.due,
      total_completed: r.totalCompleted,
      retainage: r.retainage,
      amount_received: num(app.amount_received),
    }
  })
  const billed = r2(rows.reduce((s, a) => s + (Number(a.current_payment_due) || 0), 0))
  // has_aia: the job bills through AIA pay apps (any prime app, even a $0 or draft one),
  // so the page never falls back to internal draw totals.
  return { apps: rows, billed_to_date: billed, has_aia: prime.length > 0 }
}
