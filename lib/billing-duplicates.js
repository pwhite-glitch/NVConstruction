// Possible duplicate sub invoices (prompt 67B #2). Pure — safe on client and server.
// Used by the sub portal billing POST and /api/billing-entry (block / confirm), and by the
// job page Billing tab and the dashboard billing review list ("Possible duplicate" badge).
import { sameCompany } from './company-name'

// '#INV 001' → 'inv001'. Blank → null.
export function normalizeInvoiceNumber(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '')
  return s || null
}

const hasId = (set, id) => !!set && (typeof set.has === 'function' ? set.has(id) : Array.isArray(set) && set.includes(id))

// Company names that identify nobody: blank, or the generic 'Unknown' the sub portal
// falls back to. Two such rows are never "the same company" by name.
const isGenericCompanyName = n => { const t = String(n ?? '').trim().toLowerCase(); return !t || t === 'unknown' }

// Name match for duplicate checks: sameCompany, but never on a blank / 'Unknown' name.
export function sameBillingCompanyName(a, b) {
  if (isGenericCompanyName(a) || isGenericCompanyName(b)) return false
  return sameCompany(a, b)
}

// Same sub company: same person, two people of the same company (memberIdsBySubId maps a
// sub_id to the ids of everyone at that person's company), or a matching company name
// (punctuation / "LLC" ignored; a blank or 'Unknown' name never matches).
export function sameBillingCompany(a, b, { memberIdsBySubId } = {}) {
  if (!a || !b) return false
  if (a.sub_id && a.sub_id === b.sub_id) return true
  if (a.sub_id && b.sub_id && memberIdsBySubId) {
    if (hasId(memberIdsBySubId[a.sub_id], b.sub_id) || hasId(memberIdsBySubId[b.sub_id], a.sub_id)) return true
  }
  return sameBillingCompanyName(a.company_name, b.company_name)
}

const cents = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100))
const periodKey = v => (v ? String(v).slice(0, 10) : null)
const live = r => r && r.status !== 'rejected'

// Why b looks like a duplicate of a ('invoice' | 'amount_period'), or null. Rejected rows
// never count (a sub resubmits a corrected invoice under the same number).
export function duplicateReason(a, b, opts = {}) {
  if (!live(a) || !live(b) || a.id === b.id) return null
  if (!a.job_id || a.job_id !== b.job_id) return null
  if (!sameBillingCompany(a, b, opts)) return null
  const na = normalizeInvoiceNumber(a.invoice_number)
  if (na && na === normalizeInvoiceNumber(b.invoice_number)) return 'invoice'
  const ca = cents(a.amount_billed)
  const pa = periodKey(a.billing_period)
  if (ca !== null && pa && ca === cents(b.amount_billed) && pa === periodKey(b.billing_period)) return 'amount_period'
  return null
}

// { [id]: [{ id, reason }] } for every non-rejected row that matches another one.
export function findDuplicateBillings(rows, opts = {}) {
  const list = (rows || []).filter(live)
  const out = {}
  const byJob = {}
  for (const r of list) (byJob[r.job_id] = byJob[r.job_id] || []).push(r)
  for (const group of Object.values(byJob)) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const reason = duplicateReason(group[i], group[j], opts)
        if (!reason) continue
        ;(out[group[i].id] = out[group[i].id] || []).push({ id: group[j].id, reason })
        ;(out[group[j].id] = out[group[j].id] || []).push({ id: group[i].id, reason })
      }
    }
  }
  return out
}

// The first existing billing with the same normalized invoice number as `target`
// (same job, same company, not rejected, not target itself), or null.
export function findInvoiceMatch(rows, target, opts = {}) {
  const n = normalizeInvoiceNumber(target?.invoice_number)
  if (!n) return null
  return (rows || []).find(r => duplicateReason({ ...target, status: 'pending' }, r, opts) === 'invoice') || null
}

const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : 'an earlier date')
const fmtMoney = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Tooltip text for a "Possible duplicate" badge.
export function duplicateTooltip(matches, rows) {
  return (matches || []).map(m => {
    const r = (rows || []).find(x => x.id === m.id)
    if (!r) return null
    const why = m.reason === 'invoice' ? 'same invoice #' : 'same amount and period'
    return `${r.invoice_number ? 'Invoice #' + r.invoice_number : 'No invoice #'} — ${fmtDate(r.submitted_at)} — $${fmtMoney(r.amount_billed)} (${r.status || 'pending'}; ${why})`
  }).filter(Boolean).join('\n')
}

export { fmtDate as duplicateDate, fmtMoney as duplicateMoney }
