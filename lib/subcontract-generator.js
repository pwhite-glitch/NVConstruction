// Subcontract generator (prompt 96): what the "Generate Subcontract" form starts with,
// and what of it is remembered per subcontract (subcontracts.generator_fields, migration 079).
// Pure: no Supabase here. The job page loads the rows and passes them in.
//
// Precedence for each field: this subcontract's saved generator_fields → job-level
// values → fallbacks (latest saved on the same job / same sub, then fixed defaults).
// Contract amount, the subcontract number and the job number are never saved: they
// always come from the contract / job, exactly as before prompt 96.

export const DEFAULT_ENTITY_TYPE = 'sole proprietorship'
export const DEFAULT_PM_NAME = 'Peyton White'
export const DEFAULT_SUPERINTENDENT = 'Landon Moore'
export const DEFAULT_PAY_PCT = '100'
export const DEFAULT_COVER_LETTER = 'Please carefully review paragraphs # 5 and #23 of the enclosed contract. All change orders must have written authorization (defined as a formal NV Construction change order or an email approval defining scope and cost) from the Project Manager before work is commenced in order to ensure you will be paid for the work. All payment requests including claims for additional work must include a formal signed NV Construction Change Order in order for your draw to be processed and paid.\n\nWhile I understand that in the heat of battle, a NV Construction employee may ask you to perform work with a verbal authorization; you must get that authorization in writing before proceeding. Any work done with only a verbal agreement will result in not being paid. Also, please note in paragraph #23 that the NV superintendent is not authorized to approve change orders for additional work. That approval must come from the Project Manager.\n\nI highlight these paragraphs to protect you as a subcontractor and to ensure that at the end of the job there are no surprises for any of us, including our client.\n\nWe appreciate your cooperation in this matter and look forward to working with you on this project. Please acknowledge your agreement and understanding of this requirement by signing this letter in the space provided below, and then return the signed copy with your contract.'
export const DEFAULT_CONTRACT_DOCUMENTS = 'Subcontractor Proposal\nLink to Current Plan Sheets\nExhibit A Attached\nExhibit B Attached\nSchedule'
export const DEFAULT_SCOPE_NOTES = '* Change Orders: You must receive written authorization from the Project Manager before you begin the work.\n* Daily broom swept clean-up of all trash & debris\n* Comply with all OSHA regulations. *PPE will be required at all times for this job\n* Time is of the essence for this project. Complete work per schedule provided below.'

// The form before any subcontract is picked (the page's initial state).
export const EMPTY_GENERATOR_FORM = {
  contract_id: '', date: '', sub_name: '', sub_address: '', entity_type: DEFAULT_ENTITY_TYPE, trade: '',
  project_name: '', project_address: '', owner_name: '', owner_address: '', contract_amount: '', pay_pct: DEFAULT_PAY_PCT,
  scope_of_work: '', job_number: '', subcontract_number: '', pm_name: DEFAULT_PM_NAME, superintendent: DEFAULT_SUPERINTENDENT,
  cover_letter_body: DEFAULT_COVER_LETTER, contract_documents: DEFAULT_CONTRACT_DOCUMENTS, scope_notes: DEFAULT_SCOPE_NOTES,
}

// Saved per subcontract. NOT saved: contract_id, sub_name, contract_amount (contract value),
// job_number / subcontract_number (numbering); status and signing fields are not in the form.
export const GENERATOR_FIELD_KEYS = [
  'date', 'owner_name', 'owner_address', 'project_name', 'project_address', 'sub_address', 'entity_type',
  'trade', 'pay_pct', 'scope_of_work', 'pm_name', 'superintendent',
  'cover_letter_body', 'contract_documents', 'scope_notes',
]
// Job-level fields that carry over to the next subcontract on the same job.
export const JOB_LEVEL_KEYS = ['owner_name', 'owner_address', 'pm_name', 'superintendent']
// Sub-level fields that carry over to the same sub's subcontracts on any job.
export const SUB_LEVEL_KEYS = ['sub_address', 'entity_type']

const MAX_FIELD_LEN = 20000
const str = v => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' ? String(v) : '')
const filled = v => str(v).trim() !== ''
const norm = v => str(v).trim().toLowerCase()

// Only the known keys, as strings, capped. Anything else (contract_value, status, ids,
// nested objects) is dropped. Returns null for a non-object.
export function sanitizeGeneratorFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const out = {}
  for (const k of GENERATOR_FIELD_KEYS) {
    if (!(k in input)) continue
    const v = input[k]
    if (typeof v !== 'string' && typeof v !== 'number') continue
    out[k] = String(v).slice(0, MAX_FIELD_LEN)
  }
  if (typeof input.saved_at === 'string' && !Number.isNaN(Date.parse(input.saved_at))) out.saved_at = input.saved_at
  return out
}

// What the page sends when the contract is generated / the form is saved or closed.
export function serializeGeneratorFields(form, now = new Date()) {
  const out = sanitizeGeneratorFields(form || {}) || {}
  out.saved_at = now.toISOString()
  return out
}

// Same sub: both have a sub_id → it must match; otherwise a case-insensitive, trimmed
// vendor_name match.
export function isSameSub(a, b) {
  if (!a || !b) return false
  if (a.sub_id && b.sub_id) return a.sub_id === b.sub_id
  return filled(a.vendor_name) && norm(a.vendor_name) === norm(b.vendor_name)
}

// The sub's Directory row: by id (subcontract.sub_id is a profiles.id; it is matched
// against sub_directory.profile_id when that column exists, or the row id), then by the
// login email of the person the sub_id belongs to (that is how the Directory links to
// people in this app), then by a case-insensitive trimmed company_name match against
// the vendor name (or the sub's profile company name).
export function matchDirectoryEntry(directory, { subId = null, email = null, names = [] } = {}) {
  const rows = Array.isArray(directory) ? directory : []
  if (subId) {
    const byId = rows.find(d => d && (d.profile_id === subId || d.id === subId))
    if (byId) return byId
  }
  if (filled(email)) {
    const byEmail = rows.find(d => d && norm(d.email) === norm(email))
    if (byEmail) return byEmail
  }
  for (const n of names) {
    if (!filled(n)) continue
    const byName = rows.find(d => d && norm(d.company_name) === norm(n))
    if (byName) return byName
  }
  return null
}

const ROLE_ALIASES = {
  pm: new Set(['pm', 'project manager', 'project_manager', 'project-manager']),
  superintendent: new Set(['superintendent', 'super', 'site superintendent']),
}
// First job contact (in the order given) with that role and a name.
export function contactNameForRole(contacts, role) {
  const aliases = ROLE_ALIASES[role] || new Set([role])
  const c = (Array.isArray(contacts) ? contacts : []).find(x => x && aliases.has(norm(x.role)) && filled(x.name))
  return c ? str(c.name).trim() : ''
}

const savedAtMs = row => {
  const t = Date.parse(row?.generator_fields?.saved_at || '')
  return Number.isNaN(t) ? 0 : t
}
// Latest non-empty value per key across subcontract rows ({ id, generator_fields, ... }),
// newest saved_at first. excludeId leaves out the subcontract being opened; `match`
// narrows the rows (e.g. same sub).
export function latestSavedFields(rows, keys, { excludeId = null, match = null } = {}) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter(r => r && r.generator_fields && typeof r.generator_fields === 'object' && r.id !== excludeId && (!match || match(r)))
    .sort((a, b) => savedAtMs(b) - savedAtMs(a))
  const out = {}
  for (const k of keys) {
    const hit = list.find(r => filled(r.generator_fields[k]))
    if (hit) out[k] = str(hit.generator_fields[k])
  }
  return out
}

const first = (...vals) => {
  for (const v of vals) if (filled(v)) return str(v)
  return ''
}

// The two contract addresses (prompt 102), shared by the Gen Contract form and the
// sub-initiated signing route: this subcontract's saved value → the Directory row /
// job → latest saved on the same sub / job.
export function resolveContractAddresses({ saved = null, sub = null, job = null, latestJobFields = {}, latestSubFields = {} } = {}) {
  const sv = sanitizeGeneratorFields(saved) || {}
  const lj = latestJobFields || {}
  const ls = latestSubFields || {}
  return {
    sub_address: first(sv.sub_address, sub?.address, ls.sub_address),
    owner_address: first(sv.owner_address, job?.owner_address, lj.owner_address),
  }
}

// The form for one subcontract.
//   job            jobs row (owner_company, owner_name, owner_address, location, ...)
//   subcontract    the contract row (id, contract_value, description, ...)
//   subName        the name shown for the sub (vendor_name or profile company), as before
//   sub            the matched sub_directory row (or null)
//   contacts       job_contacts rows for the job
//   latestJobFields  latestSavedFields(...) over the job's other subcontracts (JOB_LEVEL_KEYS)
//   latestSubFields  latestSavedFields(...) over the same sub's other subcontracts (SUB_LEVEL_KEYS)
//   saved          this subcontract's generator_fields (or null)
//   position       1-based position of the contract in the job's list (the "-001" part)
//   now            Date (date + year prefix)
export function buildGeneratorDefaults({
  job = null, subcontract = {}, subName = '', sub = null, contacts = [],
  latestJobFields = {}, latestSubFields = {}, saved = null, position = 1, now = new Date(),
} = {}) {
  const sv = sanitizeGeneratorFields(saved) || {}
  const lj = latestJobFields || {}
  const ls = latestSubFields || {}
  const yr = now.getFullYear().toString().slice(2)
  const jobNum = job?.job_number || ''
  const subNo = String(position).padStart(3, '0')
  const addr = resolveContractAddresses({ saved: sv, sub, job, latestJobFields: lj, latestSubFields: ls })
  return {
    contract_id: subcontract?.id || '',
    date: first(sv.date, now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })),
    sub_name: subName || '',
    sub_address: addr.sub_address,
    entity_type: first(sv.entity_type, ls.entity_type, DEFAULT_ENTITY_TYPE),
    trade: first(sv.trade, subcontract?.description),
    project_name: first(sv.project_name, job?.project_name),
    project_address: first(sv.project_address, job?.location),
    owner_name: first(sv.owner_name, job?.owner_company, job?.owner_name, lj.owner_name),
    owner_address: addr.owner_address,
    contract_amount: String(subcontract?.contract_value || ''),
    pay_pct: first(sv.pay_pct, DEFAULT_PAY_PCT),
    scope_of_work: first(sv.scope_of_work),
    job_number: jobNum,
    subcontract_number: `${yr}-${jobNum}-${subNo}`,
    pm_name: first(sv.pm_name, contactNameForRole(contacts, 'pm'), lj.pm_name, DEFAULT_PM_NAME),
    superintendent: first(sv.superintendent, contactNameForRole(contacts, 'superintendent'), lj.superintendent, DEFAULT_SUPERINTENDENT),
    cover_letter_body: first(sv.cover_letter_body, DEFAULT_COVER_LETTER),
    contract_documents: first(sv.contract_documents, DEFAULT_CONTRACT_DOCUMENTS),
    scope_notes: first(sv.scope_notes, DEFAULT_SCOPE_NOTES),
  }
}

// ── Before migration 079 ─────────────────────────────────────────────────────
// PostgREST 42703 / PGRST204 / "column ... does not exist" naming the column.
export function isMissingColumn(error, col) {
  if (!error) return false
  const msg = String(error.message || '')
  const missing = error.code === '42703' || error.code === 'PGRST204' || /schema cache/i.test(msg) || /column .+ does not exist/i.test(msg)
  return missing && (!col || msg.includes(col))
}

export const GENERATOR_HISTORY_COLS = 'id, job_id, sub_id, vendor_name, generator_fields'
export const GENERATOR_HISTORY_COLS_PRE_079 = 'id, job_id, sub_id, vendor_name'

// Read subcontract rows with their saved generator_fields. `run(cols)` → { data, error }.
// generator_fields missing (079 not applied) → read again without it, so the rows still
// come back (no saved values). Returns { rows, missing, error }.
export async function readGeneratorRows(run) {
  let res = await run(GENERATOR_HISTORY_COLS)
  if (res?.error && isMissingColumn(res.error, 'generator_fields')) {
    const retry = await run(GENERATOR_HISTORY_COLS_PRE_079)
    return { rows: retry?.data || [], missing: true, error: retry?.error || null }
  }
  return { rows: res?.data || [], missing: false, error: res?.error || null }
}
