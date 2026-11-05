// Budget CSV import: parse + validate, no I/O. Used by the Budget tab's
// "Import CSV" preview.
//
// Format: cost_code, description, budget_amount[, owner_amount]. Header row optional.
// Bad or missing amounts are errors (never silently 0). Cost codes that already
// exist on the job (or repeat within the file) are warnings.

export function splitCsvRow(line) {
  const result = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) {
      result.push(cur.trim()); cur = ''
    } else { cur += ch }
  }
  result.push(cur.trim())
  return result
}

// "$1,234.50" -> 1234.5, "(500)" -> -500, "" -> null, "abc" -> NaN
export function parseAmount(str) {
  if (str === null || str === undefined) return null
  let s = String(str).trim()
  if (!s) return null
  let neg = false
  const paren = /^\((.*)\)$/.exec(s)
  if (paren) { neg = true; s = paren[1] }
  s = s.replace(/[$,\s]/g, '')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN
  const n = Number(s)
  if (!Number.isFinite(n)) return NaN
  return Math.round((neg ? -n : n) * 100) / 100
}

const HEADER_CELL = /^(cost[\s_-]*code|code|description|desc|item|amount|budget|budget[\s_-]*amount|owner|owner[\s_-]*amount)$/i

export function isHeaderRow(cols) {
  return cols.some(c => HEADER_CELL.test(c || ''))
}

const normCode = c => String(c || '').trim().toLowerCase()

/**
 * @param text           CSV file text
 * @param existingItems  the job's current budget_items ({ cost_code, sort_order })
 * @returns {
 *   rows:   [{ line, cost_code, description, budget_amount, owner_amount, errors: [], warnings: [] }],
 *   valid:  rows with no errors,
 *   invalid: rows with errors,
 *   duplicates: rows with a duplicate cost code,
 *   headerSkipped: boolean,
 * }
 * `line` is the 1-based line number in the file.
 */
export function parseBudgetCsv(text, existingItems = []) {
  const rawLines = String(text || '').replace(/^﻿/, '').split(/\r?\n/)
  const existing = new Set(existingItems.map(b => normCode(b.cost_code)).filter(Boolean))
  const seen = new Map()
  const rows = []
  let headerSkipped = false
  let firstContent = true

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim()
    if (!line) continue
    const cols = splitCsvRow(line)
    if (cols.every(c => !c)) continue
    if (firstContent) {
      firstContent = false
      if (isHeaderRow(cols)) { headerSkipped = true; continue }
    }
    const unq = v => (v ?? '').replace(/^"|"$/g, '').trim()
    const cost_code = unq(cols[0]) || null
    const description = unq(cols[1])
    const errors = []
    const warnings = []
    if (!description) errors.push('Description is missing')

    const budget = parseAmount(cols[2])
    if (budget === null) errors.push('Budget amount is missing')
    else if (Number.isNaN(budget)) errors.push(`Budget amount "${cols[2]}" is not a number`)

    const owner = parseAmount(cols[3])
    if (Number.isNaN(owner)) errors.push(`Owner amount "${cols[3]}" is not a number`)

    const code = normCode(cost_code)
    if (code) {
      if (existing.has(code)) warnings.push(`Cost code ${cost_code} already exists on this job`)
      if (seen.has(code)) warnings.push(`Cost code ${cost_code} also appears on line ${seen.get(code)}`)
      else seen.set(code, i + 1)
    }

    rows.push({
      line: i + 1,
      cost_code,
      description,
      budget_amount: Number.isNaN(budget) ? null : budget,
      owner_amount: Number.isNaN(owner) ? null : owner,
      raw_budget: cols[2] ?? '',
      raw_owner: cols[3] ?? '',
      errors,
      warnings,
    })
  }

  return {
    rows,
    valid: rows.filter(r => !r.errors.length),
    invalid: rows.filter(r => r.errors.length),
    duplicates: rows.filter(r => r.warnings.length),
    headerSkipped,
  }
}

// Rows for POST /api/budget-items, appended after the job's existing lines.
export function toInsertRows(validRows, jobId, existingItems = []) {
  const maxSort = existingItems.reduce((m, b) => Math.max(m, Number.isFinite(Number(b.sort_order)) && b.sort_order !== null ? Number(b.sort_order) : -1), -1)
  return validRows.map((r, i) => ({
    job_id: jobId,
    cost_code: r.cost_code,
    description: r.description,
    budget_amount: r.budget_amount,
    owner_amount: r.owner_amount,
    sort_order: maxSort + 1 + i,
  }))
}
