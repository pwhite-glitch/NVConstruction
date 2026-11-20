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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// ── Warnings (before generating / sending) ───────────────────────────────────
// [{ key, message }] for each missing exhibit, A first.
export function exhibitWarnings({ proposalPath, billingDoc } = {}) {
  const out = []
  if (!String(proposalPath || '').trim()) out.push({ key: 'proposal', message: MISSING_PROPOSAL_MESSAGE })
  if (!billingDoc || !String(billingDoc.storage_path || '').trim()) out.push({ key: 'billing', message: MISSING_BILLING_MESSAGE })
  return out
}

/**
 * Ask before going on without an exhibit. confirmFn is window.confirm (OK = Continue anyway,
 * Cancel = Cancel). Never blocks silently: with nothing missing it does not ask.
 * Returns { proceed, include: { proposal, billing } } — a missing exhibit is never included.
 */
export function confirmExhibits(status, confirmFn, action = 'continue') {
  const warnings = exhibitWarnings(status)
  const include = { proposal: !warnings.some(w => w.key === 'proposal'), billing: !warnings.some(w => w.key === 'billing') }
  if (!warnings.length) return { proceed: true, include, warnings }
  const msg = `${warnings.map(w => '• ' + w.message).join('\n')}\n\nThe missing exhibit${warnings.length > 1 ? 's' : ''} will be left out of the contract.\n\nOK = Continue anyway (${action})\nCancel = Cancel`
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
 * Exhibit cover pages appended to the contract HTML, in order A then B, only for the
 * exhibits included. exhibits: { proposal?: { name }, billing?: { name } }.
 * exhibitsPath: the stored merged PDF (signing page link + marker). '' when nothing included.
 */
export function exhibitAppendixHtml({ proposal = null, billing = null, exhibitsPath = null } = {}) {
  const list = [[EXHIBIT_A, proposal], [EXHIBIT_B, billing]].filter(([, f]) => f)
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
 * One PDF with the exhibits in order (A, then B). Each item: { exhibit: EXHIBIT_A|EXHIBIT_B,
 * file: { name, bytes } | null }. Items without a file are skipped (no cover page).
 * Returns { bytes, included: ['proposal'|'billing'], notes: [{ key, name, reason }] };
 * bytes is null when nothing was included.
 */
export async function buildExhibitsPdf(items = [], { subtitle = '' } = {}) {
  const ordered = [EXHIBIT_A, EXHIBIT_B]
    .map(e => (items || []).find(i => i && i.exhibit && i.exhibit.key === e.key && i.file && i.file.bytes))
    .filter(Boolean)
  if (!ordered.length) return { bytes: null, included: [], notes: [] }
  const doc = await PDFDocument.create()
  doc.setTitle('Subcontract Exhibits')
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
  const included = [], notes = []
  for (const { exhibit, file } of ordered) {
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes)
    const name = String(file.name || 'file')
    const kind = fileKind(bytes)
    const separate = reason => { notes.push({ key: exhibit.key, name, reason }); return `This file could not be added to this PDF (${reason}). It is attached separately: ${name}` }
    included.push(exhibit.key)
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
  return { bytes: await doc.save(), included, notes }
}
