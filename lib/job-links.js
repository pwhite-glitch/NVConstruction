// Which job page a job opens on, and which tab. One place for every link to a job.
// No imports: dashboard, job pages, API routes and tests all use it.
//
// jobs.job_type is 'commercial' or 'residential'. Anything else (NULL, blank,
// odd case/spaces) is read tolerantly for display only; no data is changed.

// 'residential' | 'commercial' | '' (unknown)
export function normJobType(job) {
  const t = String(job?.job_type ?? '').trim().toLowerCase()
  return t === 'residential' || t === 'commercial' ? t : ''
}
export const isResidentialJob = job => normJobType(job) === 'residential'

// Tab keys each page actually renders.
export const RESIDENTIAL_TABS = [
  'overview', 'details', 'contacts', 'documents', 'photos', 'schedule',
  'budget', 'costs', 'subs', 'changeorders', 'billing', 'ownerdraw', 'lienWaivers',
  'inspections', 'punchlist', 'field',
]
export const COMMERCIAL_TABS = [
  'overview', 'details', 'contacts', 'meetings', 'documents', 'schedule', 'closeout', 'warranty', 'history',
  'budget', 'changeorders', 'billing', 'costs', 'po', 'gc', 'prime', 'cashflow', 'retainage', 'prelim', 'reimb',
  'field', 'drawings', 'submittals', 'punch', 'inspections', 'photos', 'orders', 'lookahead',
  'subs', 'contracts', 'labor',
]
const RES_SET = new Set(RESIDENTIAL_TABS)
const COM_SET = new Set(COMMERCIAL_TABS)

// Same idea under a different key on the other page.
const TO_RESIDENTIAL = {
  punch: 'punchlist', contracts: 'subs', prime: 'ownerdraw', cashflow: 'ownerdraw',
  retainage: 'billing', prelim: 'lienWaivers', lookahead: 'field',
}
const TO_COMMERCIAL = {
  punchlist: 'punch', ownerdraw: 'prime', lienWaivers: 'billing',
}

// Tab key for that kind of page. Unknown/unsupported → 'overview' (both pages have it),
// so a forwarded link never opens a blank pane. Empty → null (page default).
export function mapJobTab(tab, residential) {
  if (tab === null || tab === undefined || tab === '') return null
  const t = String(tab)
  if (residential) {
    if (RES_SET.has(t)) return t
    return TO_RESIDENTIAL[t] || 'overview'
  }
  if (COM_SET.has(t)) return t
  return TO_COMMERCIAL[t] || 'overview'
}

// Validate a tab already on its own page (e.g. ?tab= on load). Unknown → fallback.
export function safePageTab(tab, residential, fallback = 'overview') {
  if (!tab) return fallback
  const set = residential ? RES_SET : COM_SET
  return set.has(String(tab)) ? String(tab) : fallback
}

// Link to a job on the right page. job: { id, job_type }. Unknown type opens the
// commercial page (the jobs default), whose type guard forwards residential jobs.
// extra: more query params (e.g. { week: '2026-11-02' }), encoded.
export function jobHref(job, tab = null, extra = null) {
  const id = job?.id
  if (!id) return '/dashboard'
  const residential = isResidentialJob(job)
  const params = new URLSearchParams()
  params.set('id', String(id))
  const t = mapJobTab(tab, residential)
  if (t) params.set('tab', t)
  if (extra) for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== '') params.set(k, String(v))
  return `${residential ? '/residentialjobdetail' : '/jobdetail'}?${params.toString()}`
}

// Job page type guard: after the job loads, where to send it if it is on the
// wrong page, else null. page: 'residential' | 'commercial'. Only a job whose
// type is known to be the other kind moves, so the two pages can never bounce
// a job back and forth (unknown type stays where it is).
export function wrongPageHref(job, page, tab = null) {
  if (!job?.id) return null
  const type = normJobType(job)
  if (page === 'residential' && type === 'commercial') return jobHref(job, tab)
  if (page === 'commercial' && type === 'residential') return jobHref(job, tab)
  return null
}

// Link for a row that only carries job_id: look the job up in a list that has
// job_type (e.g. the dashboard's jobs). Not found → commercial page (its guard
// forwards residential jobs, and server auth still decides access).
export function jobHrefById(jobId, jobs, tab = null, extra = null) {
  if (!jobId) return '/dashboard'
  const job = (jobs || []).find(j => j.id === jobId) || { id: jobId }
  return jobHref(job, tab, extra)
}
