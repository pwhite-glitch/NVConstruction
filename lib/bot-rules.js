// What the Bot API (/api/bot/v1) lets a bot write. Pure functions, no DB, so
// the refused-action rules are unit tested (tests/bot-rules.test.js).
//
// Refused everywhere: deletes, approvals, status changes to approved/executed,
// draw assignment, and anything that emails, notifies or starts e-signature.
// Each validator returns { row } on success or { error } (a message for a 400).

export const BOT_EMAIL_DOMAIN = 'bots.nv.construction'
export const isBotEmail = (email) => typeof email === 'string' && email.toLowerCase().endsWith('@' + BOT_EMAIL_DOMAIN)

const isId = (v) => typeof v === 'string' && v.trim().length > 0
const toNumber = (v) => (v === '' || v == null ? NaN : Number(v))

function unknownFields(body, allowed) {
  return Object.keys(body).filter(k => !allowed.has(k))
}

function requireObject(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
}

// ── Subcontracts ────────────────────────────────────────────────────────────
export const BOT_SUBCONTRACT_STATUSES = ['draft', 'active']

// Same columns /api/subcontracts accepts, minus the ones a bot must not set
// (signed_contract_url, bid_proposal_url, created_by come from elsewhere).
export const BOT_SUBCONTRACT_FIELDS = new Set([
  'job_id', 'sub_id', 'company_id', 'vendor_name', 'description', 'contract_value',
  'budget_item_id', 'budget_allocations', 'retainage_pct', 'status', 'onedrive_url',
  'start_date', 'special_terms',
])

export function validateSubcontract(body) {
  if (!requireObject(body)) return { error: 'JSON object body required' }
  const extra = unknownFields(body, BOT_SUBCONTRACT_FIELDS)
  if (extra.length) return { error: `Fields not allowed: ${extra.join(', ')}` }

  const status = body.status ?? 'draft'
  if (!BOT_SUBCONTRACT_STATUSES.includes(status)) {
    return { error: `status must be 'draft' or 'active' (got '${status}'). Approving or executing contracts is not available through the Bot API.` }
  }
  if (!isId(body.job_id)) return { error: 'job_id required' }
  if (!isId(body.company_id) && !(typeof body.vendor_name === 'string' && body.vendor_name.trim())) {
    return { error: 'company_id or vendor_name required' }
  }
  const contractValue = toNumber(body.contract_value)
  if (!Number.isFinite(contractValue) || contractValue < 0) return { error: 'contract_value must be a number >= 0' }
  const retainage = body.retainage_pct == null ? 10 : toNumber(body.retainage_pct)
  if (!Number.isFinite(retainage) || retainage < 0 || retainage > 100) return { error: 'retainage_pct must be between 0 and 100' }

  // Budget line links: either one budget_item_id, or allocations [{ budget_item_id, amount }].
  // Same shape the job page saves: a single allocation also sets budget_item_id.
  let allocations = null
  if (body.budget_allocations != null) {
    if (!Array.isArray(body.budget_allocations)) return { error: 'budget_allocations must be an array' }
    allocations = []
    for (const a of body.budget_allocations) {
      const amount = toNumber(a?.amount)
      if (!isId(a?.budget_item_id) || !Number.isFinite(amount) || amount <= 0) {
        return { error: 'each budget_allocations entry needs budget_item_id and amount > 0' }
      }
      allocations.push({ budget_item_id: a.budget_item_id, amount })
    }
    if (!allocations.length) allocations = null
  }
  if (body.budget_item_id != null && !isId(body.budget_item_id)) return { error: 'budget_item_id must be an id' }
  const budgetItemId = allocations?.length === 1 ? allocations[0].budget_item_id : (body.budget_item_id || null)

  const row = {
    job_id: body.job_id,
    sub_id: isId(body.sub_id) ? body.sub_id : null,
    company_id: isId(body.company_id) ? body.company_id : null,
    vendor_name: typeof body.vendor_name === 'string' ? body.vendor_name.trim() : null,
    description: body.description || null,
    contract_value: contractValue,
    budget_item_id: budgetItemId,
    budget_allocations: allocations,
    retainage_pct: retainage,
    status,
    onedrive_url: body.onedrive_url || null,
    start_date: body.start_date || null,
    special_terms: body.special_terms || null,
  }
  return { row }
}

// Every budget line a subcontract links to (for checking they're on its job)
export function linkedBudgetItemIds(row) {
  const ids = new Set((row.budget_allocations || []).map(a => a.budget_item_id))
  if (row.budget_item_id) ids.add(row.budget_item_id)
  return [...ids]
}

// ── Billings ────────────────────────────────────────────────────────────────
// A subset of the PM create fields (lib/billing-fields.js PM_INSERT_FIELDS):
// no draw, no review / lien-waiver stamps, no attachment path.
export const BOT_BILLING_FIELDS = new Set([
  'job_id', 'sub_id', 'company_name', 'contact_name', 'contact_info',
  'amount_billed', 'retainage_pct', 'retainage_held', 'pct_complete',
  'work_description', 'invoice_number', 'invoice_date', 'notes', 'billing_period', 'status',
])

export function validateBilling(body) {
  if (!requireObject(body)) return { error: 'JSON object body required' }
  // Any draw field is refused outright (draw_request_id, draw_id, draw_request, draw, ...)
  const drawFields = Object.keys(body).filter(k => /draw/i.test(k))
  if (drawFields.length) {
    return { error: `Billings can't be added to a draw through the Bot API (remove: ${drawFields.join(', ')})` }
  }
  const extra = unknownFields(body, BOT_BILLING_FIELDS)
  if (extra.length) return { error: `Fields not allowed: ${extra.join(', ')}` }
  if (body.status != null && body.status !== 'pending') {
    return { error: `status must be 'pending' (got '${body.status}'). Approving billings is not available through the Bot API.` }
  }
  if (!isId(body.job_id)) return { error: 'job_id required' }
  const amount = toNumber(body.amount_billed)
  if (!Number.isFinite(amount)) return { error: 'amount_billed must be a number' }
  for (const k of ['retainage_pct', 'retainage_held', 'pct_complete']) {
    if (body[k] != null && !Number.isFinite(toNumber(body[k]))) return { error: `${k} must be a number` }
  }

  const row = {}
  for (const k of BOT_BILLING_FIELDS) if (k in body) row[k] = body[k]
  row.amount_billed = amount
  row.status = 'pending'
  return { row }
}

// ── Job companies ───────────────────────────────────────────────────────────
export function validateJobCompany(body) {
  if (!requireObject(body)) return { error: 'JSON object body required' }
  const extra = unknownFields(body, new Set(['job_id', 'company_id']))
  if (extra.length) return { error: `Fields not allowed: ${extra.join(', ')}` }
  if (!isId(body.job_id) || !isId(body.company_id)) return { error: 'job_id and company_id required' }
  return { row: { job_id: body.job_id, company_id: body.company_id } }
}

// ── Attachments ─────────────────────────────────────────────────────────────
// Same categories as the job page's Documents section.
export const ATTACHMENT_CATEGORIES = ['plans', 'geotech', 'permits', 'specs', 'other']
// Vercel caps a function request body at 4.5 MB, so stay under it.
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

export function validateAttachment({ job_id, category, fileName, size }) {
  if (!isId(job_id)) return { error: 'job_id required' }
  const cat = category || 'other'
  if (!ATTACHMENT_CATEGORIES.includes(cat)) return { error: `category must be one of: ${ATTACHMENT_CATEGORIES.join(', ')}` }
  if (!fileName || !size) return { error: 'file required (multipart field "file")' }
  if (size > MAX_ATTACHMENT_BYTES) return { error: `File too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`, status: 413 }
  return { row: { job_id, category: cat, file_name: safeFileName(fileName) } }
}

export function safeFileName(name) {
  const cleaned = String(name).replace(/[/\\]/g, '_').replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '.').trim()
  return (cleaned || 'file').slice(-120)
}
