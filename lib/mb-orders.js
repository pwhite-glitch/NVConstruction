// Metal-building (division 'metal_buildings') sales-order rules shared by the API
// routes, the order page and tests. Pure: no I/O.
//
// Roles: 'principal' is the Owner. Office = principal/pm/apm/admin (the existing
// sales FINANCE/ADMIN convention). Lowercase 'owner' is a CLIENT and never gets
// any of this. Office roles do NOT get Owner-only things (commission split,
// concrete amounts, payment-instruction text).

import { toCents } from './mb-commission'
import { isValidEmail } from './customer-portal'

export const MB = 'metal_buildings'
export const isMb = order => order?.division === MB

export const OFFICE_ROLES = new Set(['principal', 'pm', 'apm', 'admin'])
export const isOffice = role => OFFICE_ROLES.has(role)
export const isOwner = role => role === 'principal'

export const OLD_DOC_CATEGORIES = ['contract', 'quote', 'photo', 'permit', 'completion', 'other', 'general']
export const MB_FORM_CATEGORIES = ['supplier_order_form', 'client_order_form']
export const ALL_DOC_CATEGORIES = [...OLD_DOC_CATEGORIES, ...MB_FORM_CATEGORIES]

export const CLIENT_FORM_EXTS = new Set(['pdf'])
export const SUPPLIER_FORM_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'heic', 'webp', 'doc', 'docx', 'xls', 'xlsx'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuidLike = v => typeof v === 'string' && UUID_RE.test(v)

// Is this user the assigned salesperson or an attribution rep on the order?
export function isRepOnOrder(userId, order, attribution) {
  if (!userId || !order) return false
  if (order.salesperson_id === userId) return true
  return (attribution || []).some(a => a?.salesperson_id === userId)
}

// May this user work the MB flow on this order (supplier, forms, send for signature)?
// Office roles: yes. metal_rep: only when on the order. Everyone else (roofing_rep,
// super, client owner, subs): no.
export function canWorkMbOrder(auth, order, attribution) {
  if (!auth || !isMb(order)) return false
  if (isOffice(auth.role)) return true
  return auth.role === 'metal_rep' && isRepOnOrder(auth.userId, order, attribution)
}

// Strict body: reject unknown keys and non-scalar values where scalars are expected.
// `allowed` maps key -> 'string' | 'number' | 'boolean' | 'nullable-number' | 'any'.
export function strictBody(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be an object.'
  for (const [k, v] of Object.entries(body)) {
    const t = allowed[k]
    if (!t) return `Unexpected field: ${k}`
    if (t === 'any') continue
    if (v === undefined) continue
    if (t === 'string' && typeof v !== 'string') return `${k} must be text.`
    if (t === 'boolean' && typeof v !== 'boolean') return `${k} must be true or false.`
    if (t === 'nullable-money' && !(v === null || typeof v === 'number' || typeof v === 'string')) return `${k} must be an amount.`
  }
  return null
}

// Nonnegative currency input. null/'' -> { value: null }. Returns { value } (number, 2dp) or { error }.
export function parseMoneyInput(v, label = 'Amount', { allowNull = true, positive = false } = {}) {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    return allowNull ? { value: null } : { error: `${label} is required.` }
  }
  if (typeof v !== 'number' && typeof v !== 'string') return { error: `${label} must be a number.` }
  const c = toCents(v)
  if (!Number.isInteger(c)) return { error: `${label} must be a valid dollar amount.` }
  if (typeof v === 'string' && /\.\d{3,}$/.test(v.trim())) return { error: `${label} can have at most 2 decimal places.` }
  if (typeof v === 'number' && Math.abs(Math.round(v * 100) - v * 100) > 1e-6) return { error: `${label} can have at most 2 decimal places.` }
  if (c < 0) return { error: `${label} cannot be negative.` }
  if (positive && c <= 0) return { error: `${label} must be more than $0.` }
  return { value: c / 100 }
}

export const validDepositAmount = v => { const c = toCents(v); return Number.isInteger(c) && c > 0 }

// ── Generic update / create allowlists for MB orders ──────────────────────────
// Fields a normal save may change on an MB order.
const MB_EDITABLE = new Set([
  'customer_name', 'customer_company', 'customer_email', 'customer_phone',
  'site_address', 'city', 'state', 'zip',
  'scope_description', 'exclusions', 'products', 'options',
  'width_ft', 'length_ft', 'height_ft', 'building_use', 'supplier_ref',
  'quoted_amount', 'contract_value', 'internal_cost', 'estimated_profit', 'deposit_amount',
  'expected_delivery_date', 'confirmed_delivery_date', 'delivery_notes',
  'expected_install_date', 'confirmed_install_date', 'install_notes', 'install_crew',
  'supplier_order_confirmation', 'internal_notes',
  'salesperson_id', 'salesperson_name', 'ops_owner_id', 'ops_owner_name',
])
// Office-only among the editable fields.
const MB_OFFICE_ONLY = new Set(['salesperson_id', 'salesperson_name', 'ops_owner_id', 'ops_owner_name', 'contract_value', 'internal_cost', 'estimated_profit'])
// Locked while a client-order-form signing request is pending or signed.
export const MB_SIGNING_LOCKED = ['deposit_amount', 'customer_email', 'customer_name']
// Known columns whose changes must go through dedicated actions / stage gates.
const MB_PROTECTED = new Set([
  'id', 'division', 'order_number', 'created_at', 'updated_at', 'stage', 'payment_status',
  'delivery_status', 'installation_status', 'deposit_received', 'deposit_received_date',
  'signed_salesperson_id', 'signed_salesperson_name', 'signed_contract_value',
  'contract_signed_at', 'contract_signed_by', 'won_at', 'completed_at', 'cancelled_at',
  'cancelled_reason', 'prev_stage', 'hold_reason', 'override_stage_reason',
  'supplier_id', 'supplier_order_placed_at', 'source_lead_id', 'linked_job_id', 'is_preview_data',
  'concrete_charge', 'concrete_cost', 'concrete_net',
  'roof_type', 'roof_size_sqft', 'building_type',
])

const same = (a, b) => {
  if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const na = Number(a), nb = Number(b)
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb) && typeof a !== 'boolean' && typeof b !== 'boolean') return na === nb
  return String(a) === String(b)
}

/**
 * Check a generic 'update' on an MB order.
 *   before: current order row; locked: a pending/signed client-form request exists.
 * Returns { fields } (only real changes; unchanged protected values are dropped) or { status, error }.
 */
export function checkMbUpdate(auth, before, fields, { locked = false } = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { status: 400, error: 'fields must be an object.' }
  const out = {}
  for (const [k, v] of Object.entries(fields)) {
    const known = MB_EDITABLE.has(k) || MB_PROTECTED.has(k)
    if (!known) return { status: 400, error: `Unexpected field for a metal-building order: ${k}` }
    if (same(before?.[k], v)) continue
    if (MB_PROTECTED.has(k)) return { status: 403, error: `${k} cannot be changed here. Use the order's workflow actions.` }
    if (MB_OFFICE_ONLY.has(k) && !isOffice(auth.role)) {
      if (k === 'salesperson_name' || k === 'ops_owner_name') continue // display names follow the id; ignored for reps
      return { status: 403, error: `Only office staff can change ${k.replace(/_/g, ' ')}.` }
    }
    if (locked && MB_SIGNING_LOCKED.includes(k)) {
      return { status: 409, error: `${k.replace(/_/g, ' ')} is locked while the client order form is out for signature or signed. Cancel the pending signature request first.` }
    }
    // Once the deposit is recorded received, its amount is fixed for everyone (rep or
    // office): commission is based on the amount actually received.
    if (k === 'deposit_amount' && before?.deposit_received === true) {
      return { status: 409, error: 'The deposit amount cannot change after the deposit is recorded received. Un-mark the deposit first if it was recorded by mistake.' }
    }
    if (v !== null && typeof v === 'object' && !['products', 'options'].includes(k)) return { status: 400, error: `${k} must be a single value.` }
    if (k === 'deposit_amount') {
      const p = parseMoneyInput(v, 'Deposit amount')
      if (p.error) return { status: 400, error: p.error }
      out[k] = p.value
      continue
    }
    if (k === 'customer_email' && v !== null && String(v).trim() !== '' && !isValidEmail(String(v))) {
      return { status: 400, error: 'Enter a valid customer email.' }
    }
    out[k] = v
  }
  return { fields: out }
}

/**
 * Check a generic 'create' of an MB order. Reps create orders for themselves only;
 * workflow/status/receipt fields cannot be set at creation.
 */
export function checkMbCreate(auth, fields) {
  if (auth.role === 'roofing_rep') return { status: 403, error: 'Roofing reps cannot create metal-building orders.' }
  const out = { division: MB }
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === 'division') continue
    if (k === 'stage') {
      if (v && !['lead', 'quoted'].includes(v)) return { status: 403, error: 'New metal-building orders start as a lead or quote.' }
      if (v) out.stage = v
      continue
    }
    if (!MB_EDITABLE.has(k)) {
      if (MB_PROTECTED.has(k)) return { status: 403, error: `${k} cannot be set when creating an order.` }
      return { status: 400, error: `Unexpected field for a metal-building order: ${k}` }
    }
    if (v !== null && typeof v === 'object' && !['products', 'options'].includes(k)) return { status: 400, error: `${k} must be a single value.` }
    out[k] = v
  }
  if (!isOffice(auth.role)) {
    if (out.salesperson_id && out.salesperson_id !== auth.userId) return { status: 403, error: 'Reps can only create orders assigned to themselves.' }
    out.salesperson_id = auth.userId
    delete out.salesperson_name
    delete out.ops_owner_id
    delete out.ops_owner_name
    delete out.internal_cost
    delete out.estimated_profit
    delete out.contract_value
  }
  if ('deposit_amount' in out) {
    const p = parseMoneyInput(out.deposit_amount, 'Deposit amount')
    if (p.error) return { status: 400, error: p.error }
    out.deposit_amount = p.value
  }
  if (out.customer_email && !isValidEmail(String(out.customer_email))) return { status: 400, error: 'Enter a valid customer email.' }
  return { fields: out }
}

// ── Send-for-signature prerequisites ──────────────────────────────────────────
// Inputs are already-loaded facts; the route re-checks storage/PDF before sending.
export function sendPrerequisites({ order, supplier, supplierForm, clientForm, paymentInstructionsConfigured, signedRequest }) {
  const items = [
    { key: 'supplier', ok: !!(order?.supplier_id && supplier), label: 'Supplier chosen', fix: 'Pick the supplier for this building and save it.' },
    { key: 'supplier_form', ok: !!supplierForm, label: "Supplier's order form uploaded", fix: "Upload the supplier's order form." },
    { key: 'client_form', ok: !!clientForm && /\.pdf$/i.test(clientForm.file_name || ''), label: 'Nv client order form uploaded (PDF)', fix: 'Upload the Nv client order form as a PDF.' },
    { key: 'customer_name', ok: !!String(order?.customer_name || '').trim(), label: 'Customer name saved', fix: 'Enter and save the customer name (they type it to sign).' },
    { key: 'customer_email', ok: isValidEmail(String(order?.customer_email || '')), label: 'Valid customer email saved', fix: 'Enter and save a valid customer email (the deposit request goes there).' },
    { key: 'deposit_amount', ok: validDepositAmount(order?.deposit_amount), label: 'Deposit amount saved (more than $0)', fix: 'Enter and save the deposit amount.' },
    { key: 'payment_instructions', ok: !!paymentInstructionsConfigured, label: 'Payment instructions set up', fix: 'Ask the Owner to set the payment instructions (Sales → Metal Buildings → Payment settings).' },
    { key: 'not_signed', ok: !signedRequest, label: 'Not already signed', fix: 'This client order form is already signed.' },
    { key: 'not_cancelled', ok: order?.stage !== 'cancelled', label: 'Order is not cancelled', fix: 'Reopen the order first.' },
  ]
  return { ok: items.every(i => i.ok), items }
}

// Latest doc in a category (newest created_at, then highest version).
export function latestDoc(docs, category) {
  const list = (docs || []).filter(d => d.category === category)
  list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || (Number(b.version_number || 0) - Number(a.version_number || 0)))
  return list[0] || null
}

// ── Deposit receipt (MB) ──────────────────────────────────────────────────────
// Full receipt: net deposit receipts >= amount due, where
//   net deposit = sum(payments typed 'deposit') - sum(refunds).
// Progress/final/other payments never count toward the deposit. Refunds are taken
// off the deposit first (conservative). A partial deposit is NOT a received deposit.
export function depositReceiptState(order, payments) {
  const due = toCents(order?.deposit_amount)
  let dep = 0, ref = 0, latestDepositDate = null
  for (const p of payments || []) {
    const c = toCents(p?.amount)
    if (!Number.isInteger(c) || c <= 0) continue
    if (p.payment_type === 'deposit') {
      dep += c
      if (p.payment_date && (!latestDepositDate || p.payment_date > latestDepositDate)) latestDepositDate = p.payment_date
    } else if (p.payment_type === 'refund') ref += c
  }
  const net = dep - ref
  const full = Number.isInteger(due) && due > 0 && net >= due
  return { due_cents: Number.isInteger(due) ? due : null, net_deposit_cents: net, full, partial: net > 0 && !full, latest_deposit_date: latestDepositDate }
}

// The existing record_payment status rule (unchanged for roofing).
export function legacyPaymentStatus(payments, contractValue) {
  const total = (payments || []).reduce((s, p) => s + (p.payment_type === 'refund' ? -Number(p.amount) : Number(p.amount)), 0)
  const contractVal = Number(contractValue || 0)
  let st = 'deposit_received'
  if (total <= 0) st = 'none'
  else if (contractVal > 0 && total >= contractVal * 0.99) st = 'paid'
  else if (total > 0 && (payments || []).some(p => p.payment_type === 'deposit')) st = 'deposit_received'
  else if (total > 0) st = 'partial'
  return st
}

// MB payment_status: 'deposit_received' only for a FULL deposit (payments or the
// finance checkbox). Never moves a received/paid order back to pending.
export function mbPaymentStatus({ payments, contractValue, depositReceived, hasSignedRequest }) {
  const legacy = legacyPaymentStatus(payments, contractValue)
  if (legacy === 'paid') return 'paid'
  if (depositReceived) return 'deposit_received'
  const total = (payments || []).reduce((s, p) => s + (p.payment_type === 'refund' ? -Number(p.amount) : Number(p.amount)), 0)
  if (total > 0) return 'partial'
  return hasSignedRequest ? 'deposit_pending' : 'none'
}

export const SATISFIED_PAYMENT = new Set(['deposit_received', 'paid'])

// ── MB stage sequence ─────────────────────────────────────────────────────────
// Native signing and supplier turn-in are hard gates (no office override) when an MB
// order crosses into contract_signed / order_placed (or jumps past them).
const STAGE_RANK = { lead: 0, quoted: 1, contract_signed: 2, order_placed: 3, scheduled: 4, installed: 5, completed: 6 }
const rankOf = order => {
  const st = order?.stage === 'on_hold' ? order?.prev_stage : order?.stage
  return STAGE_RANK[st] ?? 0 // cancelled / unknown: treated as not yet signed
}
export function mbStageNeeds(order, toStage) {
  const to = STAGE_RANK[toStage]
  if (to === undefined) return { signed: false, turnedIn: false }
  const from = rankOf(order)
  return {
    signed: toStage === 'contract_signed' || (to >= STAGE_RANK.contract_signed && from < STAGE_RANK.contract_signed),
    turnedIn: toStage === 'order_placed' || (to >= STAGE_RANK.order_placed && from < STAGE_RANK.order_placed),
  }
}
