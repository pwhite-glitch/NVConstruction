// Job Details save: which fields may be written and how they are checked.
// Used by POST /api/jobs/details (server) and the job pages (client hints).
// residentialDetailsUpdate = the residential Details form; commercialDetailsUpdate
// = that plus the extra commercial Details controls (markup, who pays subs,
// prime billing schedule, NV role, billing type, GC rollup, architect/engineer).
// Only real jobs columns (all written by the commercial page before this route
// existed): no end_date / sqft (not in the schema).
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

// ── Commercial ──────────────────────────────────────────────────────────────
export const PAYMENT_TYPES = ['nv_pays', 'owner_pays_direct']
export const NV_ROLES = ['gc', 'sub']
export const BILLING_TYPES = ['aia', 'draw_request']
const COMMERCIAL_TEXT_FIELDS = ['architect_name', 'architect_company', 'engineer_name', 'engineer_company']
const COMMERCIAL_EMAIL_FIELDS = ['architect_email', 'engineer_email']
export const COMMERCIAL_DETAIL_FIELDS = [...DETAIL_FIELDS, ...COMMERCIAL_TEXT_FIELDS, ...COMMERCIAL_EMAIL_FIELDS,
  'markup_pct', 'payment_type', 'billing_frequency', 'billing_due_day', 'billing_anchor_date',
  'nv_role', 'billing_type', 'rollup_general_conditions']

const pickEnum = (f, form, k, allowed, label) => {
  if (form[k] === undefined) return null
  if (form[k] === '' || form[k] === null) { f[k] = null; return null }
  if (!allowed.includes(form[k])) return `${label} is not a valid choice.`
  f[k] = form[k]
  return null
}

// Commercial Details: everything the residential form checks, plus the
// commercial-only controls. Same archive/status rule. Unknown keys (archived,
// job_type, id, ...) are dropped. Returns { fields } or { error }.
export function commercialDetailsUpdate(form = {}, job = {}, opts = {}) {
  const base = residentialDetailsUpdate(form, job, opts)
  if (base.error) return base
  const f = base.fields
  for (const k of COMMERCIAL_TEXT_FIELDS) {
    if (form[k] === undefined) continue
    const v = form[k] === null ? '' : String(form[k]).trim()
    f[k] = v === '' ? null : v.slice(0, 300)
  }
  for (const k of COMMERCIAL_EMAIL_FIELDS) {
    if (form[k] === undefined) continue
    const v = form[k] === null ? '' : String(form[k]).trim()
    if (v && !EMAIL_RE.test(v)) return { error: `${k.startsWith('architect') ? 'Architect' : 'Engineer'} email is not a valid email address.` }
    f[k] = v || null
  }
  if (form.markup_pct !== undefined) {
    if (form.markup_pct === '' || form.markup_pct === null) f.markup_pct = null
    else {
      const n = Number(form.markup_pct)
      if (typeof form.markup_pct === 'boolean' || !Number.isFinite(n) || n < 0 || n > 999) return { error: 'Default markup % must be a number from 0 to 999.' }
      f.markup_pct = n
    }
  }
  for (const [k, allowed, label] of [['payment_type', PAYMENT_TYPES, 'Who pays subs'], ['billing_frequency', BILLING_FREQUENCIES, 'Billing frequency'], ['nv_role', NV_ROLES, 'NV role'], ['billing_type', BILLING_TYPES, 'Billing type']]) {
    const err = pickEnum(f, form, k, allowed, label)
    if (err) return { error: err }
  }
  if (form.billing_due_day !== undefined) {
    if (form.billing_due_day === '' || form.billing_due_day === null) f.billing_due_day = null
    else {
      const n = Number(form.billing_due_day)
      const freq = f.billing_frequency !== undefined ? f.billing_frequency : (job.billing_frequency || 'monthly')
      const [min, max] = freq === 'monthly' ? [1, 31] : [0, 6]
      if (typeof form.billing_due_day === 'boolean' || !Number.isInteger(n) || n < min || n > max) return { error: `Billing due day is out of range for ${freq} billing.` }
      f.billing_due_day = n
    }
  }
  if (form.billing_anchor_date !== undefined) {
    if (form.billing_anchor_date === '' || form.billing_anchor_date === null) f.billing_anchor_date = null
    else if (!isDate(form.billing_anchor_date)) return { error: 'Billing anchor date must be a date.' }
    else f.billing_anchor_date = form.billing_anchor_date
  }
  if (form.rollup_general_conditions !== undefined) {
    if (typeof form.rollup_general_conditions !== 'boolean') return { error: 'Roll up general conditions must be true or false.' }
    f.rollup_general_conditions = form.rollup_general_conditions
  }
  return { fields: f }
}

// Residential jobs keep the residential form; every other job (commercial,
// legacy NULL type) uses the commercial set, like lib/job-links.js routing.
export const isResidentialJob = job => String(job?.job_type ?? '').trim().toLowerCase() === 'residential'
export function jobDetailsUpdate(form, job, opts) {
  return isResidentialJob(job) ? residentialDetailsUpdate(form, job, opts) : commercialDetailsUpdate(form, job, opts)
}
