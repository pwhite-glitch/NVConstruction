// What points at a job's budget lines, per line.
//
// Mirrors the "known" list in budget_line_references() (migration 039), but
// per budget line instead of per job, so one unreferenced line can be deleted
// even when other lines on the job are in use. Used by DELETE
// /api/budget-items to refuse deleting lines that have costs, POs, SOV lines,
// pay app lines, etc. attached.
//
// Fails closed: any query error other than "table/column doesn't exist"
// is returned as an error and the caller must not delete.

export const REFERENCE_SOURCES = [
  { table: 'direct_costs',             column: 'budget_item_id',     kind: 'id',   label: 'Direct costs' },
  { table: 'purchase_orders',          column: 'budget_item_id',     kind: 'id',   label: 'Purchase orders' },
  { table: 'subcontracts',             column: 'budget_item_id',     kind: 'id',   label: 'Subcontracts' },
  { table: 'subcontracts',             column: 'budget_allocations', kind: 'json', label: 'Subcontract budget allocations' },
  { table: 'subcontract_sov_lines',    column: 'budget_item_id',     kind: 'id',   label: 'Subcontract SOV lines' },
  { table: 'aia_application_lines',    column: 'budget_item_id',     kind: 'id',   label: 'Pay application lines' },
  { table: 'general_conditions',       column: 'budget_item_id',     kind: 'id',   label: 'General conditions entries' },
  { table: 'employee_job_allocations', column: 'budget_item_id',     kind: 'id',   label: 'Employee labor allocations' },
  { table: 'prime_change_orders',      column: 'budget_item_id',     kind: 'id',   label: 'Prime change orders' },
  { table: 'prime_change_orders',      column: 'sov',                kind: 'json', label: 'Prime change order SOV lines' },
]

const LABEL_BY_TABLE = Object.fromEntries(REFERENCE_SOURCES.map(s => [s.table, s.label]))

// Undefined table / column (Postgres or PostgREST schema cache). The source
// isn't in this database, so it can't reference anything.
const MISSING_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST200'])
export function isMissingRelation(error) {
  if (!error) return false
  if (MISSING_CODES.has(error.code)) return true
  return /does not exist|could not find the .*(table|column)/i.test(error.message || '')
}

const CHUNK = 200
const PAGE = 1000
const MAX_IDENTIFIERS = 5

export async function fetchAll(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    out.push(...(data || []))
    if (!data || data.length < PAGE) return { data: out, error: null }
  }
}

function parseJsonArray(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] }
  }
  return []
}

// A short human identifier for a referencing row, from whatever columns it has.
export function rowIdentifier(row) {
  if (!row) return ''
  const pick = ['po_number', 'co_number', 'number', 'invoice_number', 'item_number', 'line_number', 'vendor_name', 'vendor', 'description', 'name']
  for (const k of pick) {
    const v = row[k]
    if (v !== null && v !== undefined && String(v).trim()) {
      const s = String(v).trim()
      return s.length > 60 ? s.slice(0, 57) + '...' : s
    }
  }
  return row.id ? `id ${String(row.id).slice(0, 8)}` : ''
}

/**
 * Find what references the given budget lines.
 * @param db       supabase client (service role)
 * @param jobId    job the lines belong to (used to scan JSON allocation columns)
 * @param lineIds  budget_items ids to check
 * @returns { refs: { [budget_item_id]: [{ source_table, source_column, label, count, identifiers }] }, error }
 */
export async function findBudgetLineReferences(db, jobId, lineIds) {
  const ids = [...new Set((lineIds || []).filter(Boolean).map(String))]
  const refs = {}
  if (!ids.length) return { refs, error: null }
  const idSet = new Set(ids)

  // hits[lineId][table|column] = { source, rows: [] }
  const add = (lineId, source, row) => {
    const byLine = refs[lineId] || (refs[lineId] = {})
    const key = `${source.table}.${source.column}`
    const h = byLine[key] || (byLine[key] = { source, rows: new Map() })
    h.rows.set(row.id ?? `${h.rows.size}`, row)
  }

  for (const source of REFERENCE_SOURCES) {
    if (source.kind === 'id') {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const { data, error } = await fetchAll(() =>
          db.from(source.table).select('*').in(source.column, chunk).order('id', { ascending: true }))
        if (error) {
          if (isMissingRelation(error)) break
          return { refs: null, error: `Could not check ${source.label.toLowerCase()}: ${error.message}` }
        }
        for (const row of data) {
          const lineId = row[source.column] == null ? null : String(row[source.column])
          if (lineId && idSet.has(lineId)) add(lineId, source, row)
        }
      }
    } else {
      // JSON arrays of { budget_item_id, ... } on rows of the same job.
      const { data, error } = await fetchAll(() =>
        db.from(source.table).select('*').eq('job_id', jobId).order('id', { ascending: true }))
      if (error) {
        if (isMissingRelation(error)) continue
        return { refs: null, error: `Could not check ${source.label.toLowerCase()}: ${error.message}` }
      }
      for (const row of data) {
        for (const el of parseJsonArray(row[source.column])) {
          const lineId = el && typeof el === 'object' && el.budget_item_id != null ? String(el.budget_item_id) : null
          if (lineId && idSet.has(lineId)) add(lineId, source, row)
        }
      }
    }
  }

  const out = {}
  for (const [lineId, byKey] of Object.entries(refs)) {
    out[lineId] = Object.values(byKey).map(({ source, rows }) => {
      const list = [...rows.values()]
      return {
        source_table: source.table,
        source_column: source.column,
        label: source.label,
        count: list.length,
        identifiers: list.slice(0, MAX_IDENTIFIERS).map(rowIdentifier).filter(Boolean),
      }
    })
  }
  return { refs: out, error: null }
}

const lineName = l => [l.cost_code, l.description].filter(Boolean).join(' — ') || `line ${String(l.id).slice(0, 8)}`

function attachmentText(a) {
  const ids = a.identifiers?.length ? ` (${a.identifiers.join(', ')}${a.count > a.identifiers.length ? ', …' : ''})` : ''
  return `${a.count} ${a.label.toLowerCase()}${ids}`
}

/**
 * Build the 409 body. `lines` are budget_items rows ({ id, cost_code, description });
 * `refs` is the map from findBudgetLineReferences. `jobLevel` is optional extra
 * table-level rows from budget_line_references() that the per-line check missed.
 */
export function buildReferencedConflict(lines, refs, jobLevel = []) {
  const referenced = lines
    .filter(l => refs[String(l.id)]?.length)
    .map(l => ({ budget_item_id: l.id, cost_code: l.cost_code ?? null, description: l.description ?? null, attachments: refs[String(l.id)] }))
  const parts = referenced.map(r => `${lineName(r)}: ${r.attachments.map(attachmentText).join('; ')}`)
  for (const j of jobLevel) parts.push(`${LABEL_BY_TABLE[j.source_table] || j.source_table} (${j.source_column}): ${j.ref_count} row(s)`)
  const single = lines.length === 1
  const head = single
    ? 'This budget line can\'t be deleted because other records are attached to it. Move or remove them first.'
    : `${referenced.length || 'Some'} budget line${referenced.length === 1 ? ' has' : 's have'} records attached, so nothing was deleted. Move or remove them first.`
  return {
    error: `${head}\n${parts.map(p => '• ' + p).join('\n')}`,
    code: 'budget_line_referenced',
    references: referenced,
    job_level_references: jobLevel,
  }
}
