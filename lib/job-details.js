// Residential job Details save: which fields may be written and how they are
// checked. Used by POST /api/jobs/details (server) and the page (client hints).
// Only real jobs columns: no end_date / sqft (not in the schema).
import { statusSaveClearsArchived } from './job-lifecycle'

export const JOB_STATUSES = ['active', 'complete', 'on_hold']
export const BILLING_FREQUENCIES = ['weekly', 'biweekly', 'monthly']
const TEXT_FIELDS = ['project_name', 'job_number', 'location', 'owner_name', 'owner_email', 'owner_phone', 'owner_company', 'scope_notes', 'permit_number']
const DATE_FIELDS = ['start_date', 'permit_date', 'sub_billing_start', 'sub_billing_anchor', 'owner_billing_start', 'owner_billing_anchor']
export const DETAIL_FIELDS = [...TEXT_FIELDS, ...DATE_FIELDS, 'contract_value', 'status', 'pm_email',
  'sub_billing_frequency', 'sub_billing_due', 'owner_billing_frequency', 'owner_billing_due']

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z'))
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Legacy spelling written by the old residential page.
export const normStatus = s => (s === 'on-hold' ? 'on_hold' : s)

// Build the jobs update from a submitted form. Unknown keys are dropped.
// Returns { fields } or { error }. `job` is the current row, `isOwner` = principal.
export function residentialDetailsUpdate(form = {}, job = {}, { isOwner = false } = {}) {
  const f = {}
  for (const k of TEXT_FIELDS) {
    if (form[k] === undefined) continue
    const v = form[k] === null ? '' : String(form[k]).trim()
    f[k] = v === '' ? null : v.slice(0, k === 'scope_notes' ? 5000 : 300)
  }
  if ('project_name' in f && !f.project_name) return { error: 'Project name is required.' }
  if ('job_number' in f && !f.job_number) return { error: 'Job number is required.' }
  if (f.owner_email && !EMAIL_RE.test(f.owner_email)) return { error: 'Owner email is not a valid email address.' }
  for (const k of DATE_FIELDS) {
    if (form[k] === undefined) continue
    if (form[k] === '' || form[k] === null) { f[k] = null; continue }
    if (!isDate(form[k])) return { error: `${k.replace(/_/g, ' ')} must be a date.` }
    f[k] = form[k]
  }
  if (form.contract_value !== undefined) {
    if (form.contract_value === '' || form.contract_value === null) f.contract_value = null
    else {
      const n = Number(form.contract_value)
      if (!Number.isFinite(n) || n < 0) return { error: 'Contract value must be a number of 0 or more.' }
      f.contract_value = n
    }
  }
  if (form.pm_email !== undefined) {
    const e = String(form.pm_email || '').trim().toLowerCase()
    if (e && !EMAIL_RE.test(e)) return { error: 'PM email is not valid.' }
    f.pm_email = e || null
  }
  for (const side of ['sub', 'owner']) {
    const fk = `${side}_billing_frequency`, dk = `${side}_billing_due`
    if (form[fk] !== undefined) {
      if (form[fk] === '' || form[fk] === null) f[fk] = null
      else if (!BILLING_FREQUENCIES.includes(form[fk])) return { error: `${side === 'sub' ? 'Sub' : 'Owner'} billing frequency must be weekly, biweekly or monthly.` }
      else f[fk] = form[fk]
    }
    if (form[dk] !== undefined) {
      if (form[dk] === '' || form[dk] === null) f[dk] = null
      else {
        const n = Number(form[dk])
        const freq = f[fk] !== undefined ? f[fk] : job[fk]
        const max = freq === 'monthly' ? 31 : 6
        const min = freq === 'monthly' ? 1 : 0
        if (!Number.isInteger(n) || n < min || n > max) return { error: `${side === 'sub' ? 'Sub' : 'Owner'} billing due day is out of range for ${freq || 'that'} billing.` }
        f[dk] = n
      }
    }
  }
  if (form.status !== undefined) {
    const s = normStatus(form.status)
    if (!JOB_STATUSES.includes(s)) return { error: 'Status must be Active, Complete or On hold.' }
    const current = normStatus(job.status)
    if (s !== current) {
      // Archive is Owner-only (/api/jobs/archive). A non-Owner can't move an
      // archived job's status (that would be a way around the archive).
      if (job.archived && !isOwner) return { error: 'This job is archived. Only an Owner can change its status (set it Active to unarchive).' }
      f.status = s
      // Owner deliberately setting Active un-archives (same rule as the commercial page).
      if (isOwner && statusSaveClearsArchived(job, s)) f.archived = false
    } else if (form.status !== job.status) {
      f.status = s // repair the legacy 'on-hold' spelling on save
    }
  }
  return { fields: f }
}
