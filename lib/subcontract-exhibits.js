// Subcontract exhibits (prompt 97). Shared by the job page, /api/subcontract-exhibits,
// /api/signing-requests (+ [token]) and /api/sub-initiate-sign.
//
//   Exhibit A – Subcontractor Proposal   subcontracts.bid_proposal_url ('prime-contracts' bucket)
//   Exhibit B – Billing Schedule         the job's newest job_documents row with category
//                                        'billing_schedule' ('job-documents' bucket)
//
// The contract itself is HTML (print window / e-sign page); the app has no HTML→PDF engine.
// So the exhibits are merged into ONE PDF (cover A + proposal pages, cover B + schedule
// pages), stored at documents/subcontracts/<id>/exhibits-<time>.pdf, and the contract HTML
// gets exhibit cover pages appended that name the files and carry that PDF's path
// (data-nv-exhibits). The signer sees and opens the exhibits PDF on the signing page; the
// signed copy keeps the same appendix (it is built from the same HTML), and the PDF file is
// never overwritten (unique name, upsert: false).
//
// Missing exhibits are skipped (no empty cover page). Images (PNG/JPEG) become PDF pages;
// anything else (HEIC, Word, a damaged PDF …) gets its cover page plus a note that the file
// is attached separately, with its name.
//
// Prompt 103: extra exhibits C, D, … are job_documents rows of the subcontract's job, saved
// in order in subcontracts.generator_fields.exhibits as [{ job_document_id, title, source }].
// Letters are never stored: they are assigned by position at build time over the extras
// actually included (first = C), so a removed / missing file never leaves a gap.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { winAnsiSafe, wrapLines } from './pdf-text'

export const EXHIBITS_BUCKET = 'documents'
export const PROPOSAL_BUCKET = 'prime-contracts'
export const JOB_DOCS_BUCKET = 'job-documents'
export const BILLING_SCHEDULE_CATEGORY = 'billing_schedule'

export const EXHIBIT_A = { key: 'proposal', letter: 'A', title: 'Subcontractor Proposal' }
export const EXHIBIT_B = { key: 'billing', letter: 'B', title: 'Billing Schedule' }
export const exhibitHeading = e => `Exhibit ${e.letter} – ${e.title}`

export const MISSING_PROPOSAL_MESSAGE = 'Exhibit A proposal not uploaded'
export const MISSING_BILLING_MESSAGE = 'Exhibit B billing schedule not set for this job'
export const PROPOSAL_TYPE_MESSAGE = 'Exhibit A proposal is not a PDF or image (re-upload it as PDF)'

// Prompt 103: extra exhibits (C, D, …)
export const EXTRA_EXHIBIT_CATEGORY = 'subcontract_exhibit'
export const MAX_EXTRA_EXHIBITS = 10 // C–L
export const MAX_EXHIBIT_TITLE = 120
export const EXHIBIT_FILE_EXTS = ['pdf', 'png', 'jpg', 'jpeg']
export const EXHIBIT_FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'
export const EXHIBIT_FILE_TYPE_MESSAGE = 'Exhibits must be a PDF or a JPG/PNG image. Save Word, Excel, HEIC or drawing files as PDF first.'
const EXHIBIT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg']
const GENERIC_MIME_TYPES = ['', 'application/octet-stream', 'binary/octet-stream']
const EXTRA_SOURCES = ['upload', 'job_document']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Lower-case extension of a file name or storage path ('' when none).
export function fileExtension(name) {
  const base = String(name || '').split('/').pop() || ''
  const i = base.lastIndexOf('.')
  return i > 0 && i < base.length - 1 ? base.slice(i + 1).toLowerCase() : ''
}

/**
 * null when the file can be an exhibit (PDF / PNG / JPG by extension), else the message.
 * The MIME type is only a second check: a known non-PDF/image type is refused, an empty or
 * generic one is ignored.
 */
export function exhibitFileTypeError(fileName, mimeType) {
  if (!EXHIBIT_FILE_EXTS.includes(fileExtension(fileName))) return EXHIBIT_FILE_TYPE_MESSAGE
  const mime = String(mimeType || '').trim().toLowerCase()
  if (mimeType != null && !GENERIC_MIME_TYPES.includes(mime) && !EXHIBIT_MIME_TYPES.includes(mime)) return EXHIBIT_FILE_TYPE_MESSAGE
  return null
}

/**
 * The saved extra-exhibit list (generator_fields.exhibits). null for a non-array.
 * Keeps { job_document_id (uuid, lower case), title (trimmed, capped), source } only; no
 * letters, paths, URLs or buckets are ever kept. Duplicates dropped, at most MAX_EXTRA_EXHIBITS.
 */
export function sanitizeExhibitList(input) {
  if (!Array.isArray(input)) return null
  const out = []
  const seen = new Set()
  for (const e of input) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue
    const id = typeof e.job_document_id === 'string' ? e.job_document_id.trim().toLowerCase() : ''
    if (!UUID_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    const title = typeof e.title === 'string' ? e.title.replace(/\s+/g, ' ').trim().slice(0, MAX_EXHIBIT_TITLE).trim() : ''
    const source = EXTRA_SOURCES.includes(e.source) ? e.source : 'job_document'
    out.push({ job_document_id: id, title, source })
    if (out.length >= MAX_EXTRA_EXHIBITS) break
  }
  return out
}

// Letter of the i-th INCLUDED extra exhibit: 0 → 'C'.
export const extraExhibitLetter = i => String.fromCharCode(67 + i)

/**
 * The exhibit list printed in the contract body: [{ letter, title }].
 * A / B only when included; extras (already filtered to the included ones) lettered C, D, …
 */
export function exhibitListForContract({ proposal = false, billing = false, extras = [] } = {}) {
  const out = []
  if (proposal) out.push({ letter: EXHIBIT_A.letter, title: EXHIBIT_A.title })
  if (billing) out.push({ letter: EXHIBIT_B.letter, title: EXHIBIT_B.title })
  ;(extras || []).forEach((e, i) => out.push({ letter: extraExhibitLetter(i), title: String(e?.title || '').trim() || 'Exhibit' }))
  return out
}

// "EXHIBITS:" block for the CONTRACT DOCUMENTS section ('' when none). Titles are escaped.
export function exhibitListHtml(list) {
  const rows = (Array.isArray(list) ? list : []).filter(e => e && e.letter)
  if (!rows.length) return ''
  return `<p><strong>EXHIBITS:</strong><br>${rows.map(e => esc(exhibitHeading({ letter: e.letter, title: e.title || 'Exhibit' }))).join('<br>')}</p>`
}

// "A", "A and B", "A, B and C" — for "Exhibits … attached." messages.
export function exhibitLettersText(letters) {
  const l = (letters || []).filter(Boolean)
  return l.length <= 1 ? (l[0] || '') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`
}

// ── Warnings (before generating / sending) ───────────────────────────────────
// [{ key, message, leftOut }] for each missing exhibit, A first, then extras in order.
// extras: [{ title, missing, typeError? }] — a missing one (or a wrong type) is left out.
// A proposal that is not a PDF / image only warns: it is still attached (cover page + note).
export function exhibitWarnings({ proposalPath, billingDoc, extras = [] } = {}) {
  const out = []
  const proposal = String(proposalPath || '').trim()
  if (!proposal) out.push({ key: 'proposal', message: MISSING_PROPOSAL_MESSAGE })
  else if (!EXHIBIT_FILE_EXTS.includes(fileExtension(proposal))) out.push({ key: 'proposal_type', message: PROPOSAL_TYPE_MESSAGE, leftOut: false })
  if (!billingDoc || !String(billingDoc.storage_path || '').trim()) out.push({ key: 'billing', message: MISSING_BILLING_MESSAGE })
  ;(extras || []).forEach((e, i) => {
    if (!e) return
    const title = String(e.title || '').trim() || 'Exhibit'
    if (e.missing) out.push({ key: `extra:${i}`, message: `Exhibit "${title}" is no longer in this job's documents` })
    else if (e.typeError) out.push({ key: `extra:${i}`, message: `Exhibit "${title}": ${e.typeError}` })
  })
  return out
}

/**
 * Ask before going on without an exhibit. confirmFn is window.confirm (OK = Continue anyway,
 * Cancel = Cancel). Never blocks silently: with nothing missing it does not ask.
 * Returns { proceed, include: { proposal, billing, extras }, warnings } — a missing exhibit is
 * never included (missing extras are always skipped; extras: true keeps the rest).
 */
export function confirmExhibits(status, confirmFn, action = 'continue') {
  const warnings = exhibitWarnings(status)
  const include = { proposal: !warnings.some(w => w.key === 'proposal'), billing: !warnings.some(w => w.key === 'billing'), extras: true }
  if (!warnings.length) return { proceed: true, include, warnings }
  const leftOut = warnings.filter(w => w.leftOut !== false).length
  const tail = leftOut ? `The missing exhibit${leftOut > 1 ? 's' : ''} will be left out of the contract.` : 'It will still be attached, with a note that the file is attached separately.'
  const msg = `${warnings.map(w => '• ' + w.message).join('\n')}\n\n${tail}\n\nOK = Continue anyway (${action})\nCancel = Cancel`
  const ok = typeof confirmFn === 'function' ? !!confirmFn(msg) : false
  return { proceed: ok, include, warnings }
}

// ── Paths ────────────────────────────────────────────────────────────────────
const stamp = at => new Date(at).toISOString().replace(/[:.]/g, '-')

export function exhibitsPdfPath(subcontractId, at = new Date()) {
  if (!UUID_RE.test(String(subcontractId || ''))) throw new Error('invalid subcontract id')
  return `subcontracts/${String(subcontractId).toLowerCase()}/exhibits-${stamp(at)}.pdf`
}

const EXHIBITS_PATH_RE = /^subcontracts\/([0-9a-f-]{36})\/exhibits-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.pdf$/i

// True only for an exhibits PDF of THIS subcontract.
export function isExhibitsPathFor(path, subcontractId) {
  const m = EXHIBITS_PATH_RE.exec(String(path || ''))
  return !!m && !!subcontractId && m[1].toLowerCase() === String(subcontractId).toLowerCase()
}

// The exhibits PDF path a contract's HTML points to, only when it belongs to subcontractId.
export function exhibitsPathFromHtml(html, subcontractId) {
  const m = /data-nv-exhibits="([^"]{1,200})"/.exec(String(html || ''))
  return m && isExhibitsPathFor(m[1], subcontractId) ? m[1] : null
}

export const fileBaseName = p => String(p || '').split('/').pop() || ''

// ── Contract HTML appendix ───────────────────────────────────────────────────
/**
 * Exhibit cover pages appended to the contract HTML, in order A, B, then the extras as given,
 * only for the exhibits included. proposal / billing: { name } | null;
 * extras: [{ letter, title, name }] (already lettered C, D, …).
 * exhibitsPath: the stored merged PDF (signing page link + marker). '' when nothing included.
 */
export function exhibitAppendixHtml({ proposal = null, billing = null, extras = [], exhibitsPath = null } = {}) {
  const list = [[EXHIBIT_A, proposal], [EXHIBIT_B, billing]].filter(([, f]) => f)
  for (const x of extras || []) if (x && x.letter) list.push([{ letter: x.letter, title: String(x.title || '').trim() || 'Exhibit' }, { name: x.name }])
  if (!list.length) return ''
  const pages = list.map(([e, f]) => `<div class="nv-exhibit" style="page-break-before:always;font-family:Arial,sans-serif;padding:60px 40px;text-align:center">
<h1 style="font-size:22pt;margin:0 0 18px">${esc(exhibitHeading(e))}</h1>
<p style="font-size:11pt;margin:0 0 8px">Attached: ${esc(f.name || 'file')}</p>
<p style="font-size:10pt;color:#555;margin:0">The full exhibit follows in the attached exhibits PDF and is part of this Subcontract.</p>
</div>`).join('\n')
  const marker = exhibitsPath ? ` data-nv-exhibits="${esc(exhibitsPath)}"` : ''
  return `<div class="nv-exhibits"${marker}>\n${pages}\n</div>`
}

// Insert the appendix before </body> (or append). Replaces an earlier appendix.
export function withExhibitAppendix(html, appendix) {
  let out = String(html ?? '').replace(/<div class="nv-exhibits"[\s\S]*?<\/div>\n<\/div>/, '')
  if (!appendix) return out
  const i = out.lastIndexOf('</body>')
  return i === -1 ? `${out}\n${appendix}` : `${out.slice(0, i)}${appendix}\n${out.slice(i)}`
}

// ── File kinds ───────────────────────────────────────────────────────────────
export const isPdfBytes = b => !!b && b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 // %PDF
export const isPngBytes = b => !!b && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
export const isJpegBytes = b => !!b && b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

export function fileKind(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : null
  if (isPdfBytes(b)) return 'pdf'
  if (isPngBytes(b)) return 'png'
  if (isJpegBytes(b)) return 'jpg'
  return 'other'
}

// ── Merge ────────────────────────────────────────────────────────────────────
const PAGE_W = 612, PAGE_H = 792, M = 54
const INK = rgb(0.11, 0.11, 0.13)
const MUTED = rgb(0.45, 0.46, 0.5)

async function coverPage(doc, fonts, e, { name, subtitle, note }) {
  const page = doc.addPage([PAGE_W, PAGE_H])
  const center = (t, y, size, font, color) => {
    const s = winAnsiSafe(t)
    const w = font.widthOfTextAtSize(s, size)
    page.drawText(s, { x: Math.max(M, (PAGE_W - w) / 2), y, size, font, color })
  }
  center(exhibitHeading(e), PAGE_H / 2 + 60, 24, fonts.bold, INK)
  let y = PAGE_H / 2 + 26
  for (const line of wrapLines(subtitle || '', fonts.regular, 11, PAGE_W - 2 * M)) { center(line, y, 11, fonts.regular, MUTED); y -= 16 }
  if (name) { for (const line of wrapLines(`File: ${name}`, fonts.regular, 10, PAGE_W - 2 * M)) { center(line, y, 10, fonts.regular, MUTED); y -= 14 } }
  if (note) {
    y -= 18
    for (const line of wrapLines(note, fonts.bold, 11, PAGE_W - 2 * M)) { center(line, y, 11, fonts.bold, INK); y -= 16 }
  }
}

function addImagePage(doc, img) {
  const page = doc.addPage([PAGE_W, PAGE_H])
  const maxW = PAGE_W - 2 * M, maxH = PAGE_H - 2 * M
  const scale = Math.min(maxW / img.width, maxH / img.height, 1)
  const w = img.width * scale, h = img.height * scale
  page.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h })
}

/**
 * One PDF with the exhibits in order: A, B, then the extras in the order given. Each item:
 * { exhibit: { key, letter, title } (EXHIBIT_A / EXHIBIT_B / an extra 'extra:<job_document_id>'),
 * file: { name, bytes } | null }. Items without a file are skipped (no cover page).
 * Returns { bytes, included: ['proposal'|'billing'|'extra:<id>'], included_exhibits: [{ key, letter, title }],
 * notes: [{ key, name, reason }] }; bytes is null (and nothing else returned) when nothing was included.
 */
export async function buildExhibitsPdf(items = [], { subtitle = '' } = {}) {
  const usable = (items || []).filter(i => i && i.exhibit && i.exhibit.key && i.file && i.file.bytes)
  const ordered = [
    ...[EXHIBIT_A, EXHIBIT_B].map(e => usable.find(i => i.exhibit.key === e.key)).filter(Boolean),
    ...usable.filter(i => i.exhibit.key !== EXHIBIT_A.key && i.exhibit.key !== EXHIBIT_B.key),
  ]
  if (!ordered.length) return { bytes: null, included: [], notes: [] }
  const doc = await PDFDocument.create()
  doc.setTitle('Subcontract Exhibits')
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
  const included = [], notes = [], included_exhibits = []
  for (const { exhibit, file } of ordered) {
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes)
    const name = String(file.name || 'file')
    const kind = fileKind(bytes)
    const separate = reason => { notes.push({ key: exhibit.key, name, reason }); return `This file could not be added to this PDF (${reason}). It is attached separately: ${name}` }
    included.push(exhibit.key)
    included_exhibits.push({ key: exhibit.key, letter: exhibit.letter, title: exhibit.title })
    if (kind === 'pdf') {
      let src = null
      let count = 0
      // A damaged PDF can load and still throw when its pages are read.
      try { src = await PDFDocument.load(bytes, { ignoreEncryption: true }); count = src.getPageCount() } catch { src = null }
      if (!src || !count) { await coverPage(doc, fonts, exhibit, { name, subtitle, note: separate('the PDF could not be read') }); continue }
      await coverPage(doc, fonts, exhibit, { name, subtitle })
      try {
        const pages = await doc.copyPages(src, src.getPageIndices())
        for (const p of pages) doc.addPage(p)
      } catch {
        await coverPage(doc, fonts, exhibit, { name, subtitle, note: separate('the PDF pages could not be copied') })
      }
    } else if (kind === 'png' || kind === 'jpg') {
      let img = null
      try { img = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes) } catch { img = null }
      if (!img) { await coverPage(doc, fonts, exhibit, { name, subtitle, note: separate('the image could not be read') }); continue }
      await coverPage(doc, fonts, exhibit, { name, subtitle })
      addImagePage(doc, img)
    } else {
      await coverPage(doc, fonts, exhibit, { name, subtitle, note: separate('file type not supported here') })
    }
  }
  return { bytes: await doc.save(), included, included_exhibits, notes }
}
