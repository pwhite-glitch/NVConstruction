// Export manifests (prompt 78): the names, README and INDEX text of the ITB and owner
// reimbursement ZIPs. Pure functions shared by the server manifest routes (which assign the
// trusted entry names) and the browser (which builds the text files and the ZIP). No imports.

export const MANIFEST_PAGE_SIZE = 100
export const MAX_SELECTED_IDS = 1000

// Same character rule the server ZIP routes always used.
const safeChars = s => String(s || '').replace(/[^\w\s.\-()]/g, '_')

// Stable unique names: a repeat gets _2, _3 … before the extension (order decides who keeps
// the plain name, so callers pass a stable absolute order).
export function uniqueName(raw, used) {
  const safe = safeChars(raw) || 'file'
  if (!used.has(safe)) { used.add(safe); return safe }
  const ext = safe.match(/(\.[^.]+)$/) ? safe.match(/(\.[^.]+)$/)[1] : ''
  const base = safe.slice(0, safe.length - ext.length)
  let n = 2
  while (used.has(`${base}_${n}${ext}`)) n++
  const final = `${base}_${n}${ext}`
  used.add(final)
  return final
}
export function uniqueNames(rawNames) {
  const used = new Set()
  return rawNames.map(raw => uniqueName(raw, used))
}

// ── ITB ───────────────────────────────────────────────────────────────────────
export const ITB_HTML_NAME = 'ITB_Invitation_to_Bid.html'

// Plans in a stable order (file name, then id) → Documents/<unique safe name>.
export function itbEntries(plans) {
  const ordered = [...plans].sort((a, b) => String(a.file_name || '').localeCompare(String(b.file_name || '')) || String(a.id).localeCompare(String(b.id)))
  const names = uniqueNames(ordered.map(p => p.file_name))
  return ordered.map((p, i) => ({ id: p.id, storage_path: p.storage_path, name: `Documents/${names[i]}` }))
}

export const itbSlug = (projectName, title) => String(projectName || title || 'project').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40)
export const itbZipName = slug => `ITB_${slug}.zip`

export function itbReadme({ projectName, docCount, generatedAt = new Date() }) {
  return [
    `INVITATION TO BID`,
    `Project: ${projectName}`,
    '='.repeat(58),
    '',
    'Contents:',
    `  ${ITB_HTML_NAME}  — Open in any browser, then File > Print > Save as PDF`,
    `  Documents/                  — ${docCount} project file(s)`,
    '',
    'Instructions:',
    `  1. Open ${ITB_HTML_NAME} in your browser to review the invitation.`,
    '  2. Print or Save as PDF for your records.',
    '  3. Documents/ contains original drawings and specifications.',
    '',
    'CONFIDENTIAL — For invited subcontractors only. Do not forward without authorization.',
    '',
    `Generated: ${new Date(generatedAt).toUTCString()}`,
  ].join('\n')
}

// ── Owner reimbursement ───────────────────────────────────────────────────────
export const INVOICE_HTML_NAME = 'Invoice.html'

const slugPart = (v, fallback) => {
  const s = String(v || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
  return s || fallback
}
const dateOf = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null)
const amt = n => Number(n || 0).toFixed(2)

// Stable invoice order: sort_order ascending (nulls last), then id.
export function sortInvoiceLines(lines) {
  return [...(lines || [])].sort((a, b) => {
    const sa = a.sort_order == null ? Infinity : Number(a.sort_order)
    const sb = b.sort_order == null ? Infinity : Number(b.sort_order)
    if (sa !== sb) return sa < sb ? -1 : 1
    return String(a.id).localeCompare(String(b.id))
  })
}

// One row per invoice line (already sorted), numbered across the WHOLE invoice. receiptPath is
// the stored receipt (null = genuinely no receipt); receipt is the archive name or NO RECEIPT.
// Each line keeps its own receipt entry, even when lines share the same receipt file.
export function ownerRows(sortedLines, receiptPathOf) {
  const pad = Math.max(2, String(sortedLines.length).length)
  const used = new Set()
  return sortedLines.map((line, i) => {
    const num = String(i + 1).padStart(pad, '0')
    const date = dateOf(line.expense_date)
    const receiptPath = receiptPathOf(line) || null
    let receipt = 'NO RECEIPT'
    if (receiptPath) {
      const rawExt = receiptPath.includes('.') ? receiptPath.split('.').pop().toLowerCase() : ''
      const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'pdf'
      const fileName = uniqueName(`${num}_${date || 'nodate'}_${slugPart(line.vendor, 'novendor')}_${amt(line.billed_amount)}.${ext}`, used)
      receipt = `Receipts/${fileName}`
    }
    return { line_id: line.id, num, date: date || '—', vendor: line.vendor || '—', amount: amt(line.billed_amount), description: line.description || '', receipt, receiptPath }
  })
}

export function ownerIndexText(invoiceNumber, rows) {
  const receiptCount = rows.filter(r => r.receipt !== 'NO RECEIPT').length
  const noReceiptCount = rows.length - receiptCount
  const cols = [
    ['#', r => r.num],
    ['Date', r => r.date],
    ['Vendor', r => r.vendor],
    ['Billed', r => r.amount],
    ['Receipt', r => r.receipt],
    ['Description', r => r.description],
  ]
  const widths = cols.map(([h, f], ci) => ci === cols.length - 1 ? 0 : Math.max(h.length, ...rows.map(r => String(f(r)).length)))
  const fmtRow = vals => vals.map((v, ci) => ci === cols.length - 1 ? v : String(v).padEnd(widths[ci])).join('  ').trimEnd()
  return [
    `RECEIPT INDEX — Invoice ${invoiceNumber}`,
    'Line numbers follow the line order on Invoice.html. Amount is the Billed amount.',
    '',
    fmtRow(cols.map(([h]) => h)),
    fmtRow(cols.map((_, ci) => '-'.repeat(Math.max(widths[ci], cols[ci][0].length)))),
    ...rows.map(r => fmtRow(cols.map(([, f]) => String(f(r))))),
    '',
    `${rows.length} line(s): ${receiptCount} with receipt, ${noReceiptCount} NO RECEIPT`,
  ].join('\n')
}

export function ownerReadme({ invoiceNumber, receiptCount, generatedAt = new Date() }) {
  return [
    `OWNER REIMBURSEMENT INVOICE`,
    `Invoice: ${invoiceNumber}`,
    '='.repeat(58),
    '',
    'Contents:',
    '  Invoice.html   — Open in any browser, then File > Print to save as PDF',
    '  INDEX.txt      — Numbered list of invoice lines with date, vendor, billed amount, and receipt file',
    `  Receipts/      — ${receiptCount} receipt file(s)`,
    '',
    'Lines without receipt backup are marked NO RECEIPT in INDEX.txt.',
    '',
    `Generated: ${new Date(generatedAt).toUTCString()}`,
  ].join('\n')
}

export const ownerZipName = invoiceNumber => `Reimb_${String(invoiceNumber || 'invoice').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40)}.zip`
