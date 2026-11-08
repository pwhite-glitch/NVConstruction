// Sub portal Submit Billing draft (localStorage). Pure helpers.
//  • One key per login (nvc_billing_draft:<userId>), so a shared computer never
//    loads someone else's draft. The old unkeyed key is discarded, not restored.
//  • The draft keeps the form AND the per-line "% this period" (by sov_line_id),
//    re-applied after the job's SOV loads.

export const LEGACY_BILLING_DRAFT_KEY = 'nvc_billing_draft'
export const billingDraftKey = userId => (userId ? `${LEGACY_BILLING_DRAFT_KEY}:${userId}` : null)

const FORM_FIELDS = ['job_id', 'amount_billed', 'pct_complete', 'work_description', 'billing_period', 'draw_request_id', 'invoice_number', 'invoice_date']

const pctNum = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

// { [sov_line_id]: '12.5' } for lines with a non-zero % this period.
export function sovPctMap(sovForm = []) {
  const out = {}
  for (const l of sovForm) if (l?.sov_line_id && pctNum(l.pct_this) > 0) out[l.sov_line_id] = String(l.pct_this)
  return out
}

export function draftHasContent(form = {}, sovForm = []) {
  return !!(form.job_id || form.amount_billed || form.work_description || form.invoice_number || Object.keys(sovPctMap(sovForm)).length)
}

export function buildBillingDraft(form = {}, sovForm = []) {
  const out = {}
  for (const k of FORM_FIELDS) if (form[k] !== undefined) out[k] = form[k]
  out.sov_pct = sovPctMap(sovForm)
  return out
}

// Parse + check a stored draft against the jobs this login can see.
// Returns { form, sovPct } or null when there is nothing worth restoring.
export function restoreBillingDraft(raw, jobs = []) {
  let draft
  try { draft = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  if (!draft || typeof draft !== 'object') return null
  const form = {}
  for (const k of FORM_FIELDS) if (typeof draft[k] === 'string') form[k] = draft[k]
  let sovPct = draft.sov_pct && typeof draft.sov_pct === 'object' ? draft.sov_pct : {}
  if (form.job_id && !jobs.some(j => j.id === form.job_id)) {
    // Not one of this login's jobs (any more): drop the job and everything tied to it.
    form.job_id = ''
    form.draw_request_id = ''
    sovPct = {}
  }
  if (!draftHasContent(form) && !Object.keys(sovPct).length) return null
  return { form, sovPct }
}

// Re-apply saved % this period onto freshly loaded SOV lines. Lines that no longer
// exist, are fully billed, or would go over 100% are left blank.
export function applyDraftPcts(sovForm = [], sovPct = {}) {
  return sovForm.map(l => {
    const saved = sovPct[l.sov_line_id]
    if (saved === undefined) return l
    const pct = pctNum(saved)
    const prev = pctNum(l.pct_prev)
    if (pct <= 0 || prev >= 100 || prev + pct > 100 + 1e-9) return l
    const amt = Math.round(Number(l.scheduled_value || 0) * pct / 100 * 100) / 100
    return { ...l, pct_this: String(saved), amount_this: amt }
  })
}

// Keep the draft's draw only if it is still one of the job's open draws.
export const keepOpenDraw = (drawId, openDraws = []) => (drawId && openDraws.some(d => d.id === drawId) ? drawId : '')

// Decode a /api/draw-requests response. { ok: true, openDraws } only for an OK
// response whose body parses and carries a `draws` array. A missing response, a
// non-OK status, a body that fails to parse, or a missing / non-array `draws` is
// a failed load ({ ok: false }) — never "no open draws".
export async function readOpenDraws(res) {
  if (!res || !res.ok) return { ok: false }
  let body
  try { body = await res.json() } catch { return { ok: false } }
  if (!body || typeof body !== 'object' || !Array.isArray(body.draws)) return { ok: false }
  return { ok: true, openDraws: body.draws.filter(d => d && d.status === 'open') }
}

// Fetch + decode a job's open draws. Never throws.
export async function loadOpenDraws(fetchImpl, jobId) {
  const res = await Promise.resolve().then(() => fetchImpl(`/api/draw-requests?job_id=${jobId}`)).catch(() => null)
  return readOpenDraws(res)
}

// The draft's draw after a draw load: a failed load keeps it untouched (the
// restore failed; the stored draft is preserved); a good load keeps it only if
// it is still one of the job's open draws.
export const drawAfterLoad = (drawId, drawLoad) => (drawLoad && drawLoad.ok ? keepOpenDraw(drawId, drawLoad.openDraws) : drawId)

// What the persist effect should write for the current screen, or null to leave
// the stored draft alone.
//  • hydrating: a restore is still loading the job's draws / SOV. The screen's
//    sovForm is not the draft's yet, so writing now would replace the saved
//    sov_pct with {} — write nothing.
//  • held = { jobId, sovPct }: percentages restored from storage that could not
//    be applied (the SOV/draw load failed). While the form is still on that job
//    they are kept in the written draft, so a later save never empties them.
export function draftToPersist({ form = {}, sovForm = [], hydrating = false, held = null } = {}) {
  if (hydrating) return null
  const keep = held && held.jobId && held.jobId === form.job_id && held.sovPct && typeof held.sovPct === 'object' ? held.sovPct : null
  if (!draftHasContent(form, sovForm) && !(keep && Object.keys(keep).length)) return null
  const draft = buildBillingDraft(form, sovForm)
  if (keep) draft.sov_pct = { ...keep, ...draft.sov_pct }
  return draft
}
