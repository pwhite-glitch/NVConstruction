// Exhibit B – Billing Schedule (prompt 97): a one-page, unbranded PDF built from the job's
// subcontractor billing settings. Pure builder (pdf-lib, no I/O): the job page builds it in the
// browser, previews it, and saves it as the job's 'billing_schedule' job document; that saved
// file is what gets attached behind every subcontract as Exhibit B.
//
// buildExhibitBPdf({ job, notes, now, count }) → Promise<Uint8Array>
//   job: { project_name, job_number, location, sub_billing_start, sub_billing_frequency,
//          sub_billing_due, sub_billing_anchor }
//   notes: free text printed in the Notes box (the page's editable notes field).
// No logo and no company name: only the project, the schedule and the notes.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { winAnsiSafe, wrapLines } from './pdf-text'
import { subBillingSettings, nextSubBillingDueDates, cadenceLabel, formatDueDate, FREQUENCY_LABELS } from './sub-billing-dates'

const PAGE_W = 612, PAGE_H = 792
const MX = 60, TOP = 64
const CONTENT_W = PAGE_W - MX * 2
const INK = rgb(0.11, 0.11, 0.13)
const BODY = rgb(0.2, 0.2, 0.23)
const MUTED = rgb(0.45, 0.46, 0.5)
const RULE = rgb(0.82, 0.83, 0.86)

export const EXHIBIT_B_TITLE = 'Exhibit B – Billing Schedule'
export const DEFAULT_PAYMENT_TERMS = 'Applications for payment are due on the dates listed below. Approved applications are processed and paid within 7 days of the due date. Applications received after a due date are processed with the next due date.'

export function exhibitBFileName(job = {}) {
  const num = String(job.job_number || '').replace(/[^\w-]+/g, '') || 'job'
  return `Exhibit-B-Billing-Schedule-${num}.pdf`
}

// What the page will say, without drawing it (used by the preview and tests).
export function exhibitBContent({ job = {}, notes = '', now = new Date(), count = 12 } = {}) {
  const s = subBillingSettings(job)
  const dates = nextSubBillingDueDates(job, { count, now })
  return {
    title: EXHIBIT_B_TITLE,
    project: [job.project_name, job.job_number ? `Job #${job.job_number}` : ''].filter(Boolean).join(' — '),
    location: String(job.location || '').trim(),
    facts: [
      ['Billing frequency', FREQUENCY_LABELS[s.frequency] || ''],
      ['First billing due date', s.start ? formatDueDate(s.start) : 'Not set'],
      ['Due', cadenceLabel(s) || 'Not set'],
    ],
    paymentTerms: DEFAULT_PAYMENT_TERMS,
    dates,
    notes: String(notes || '').trim(),
  }
}

export async function buildExhibitBPdf(opts = {}) {
  const c = exhibitBContent(opts)
  const doc = await PDFDocument.create()
  doc.setTitle(winAnsiSafe(`${c.title}${c.project ? ' — ' + c.project : ''}`))
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - TOP

  const text = (t, { x = MX, size = 10, font = regular, color = BODY } = {}) => {
    page.drawText(winAnsiSafe(t), { x, y, size, font, color })
  }
  const para = (t, { size = 10, font = regular, color = BODY, gap = 4, maxW = CONTENT_W, x = MX } = {}) => {
    for (const line of wrapLines(t, font, size, maxW)) { y -= size + gap; page.drawText(line, { x, y, size, font, color }) }
  }
  const rule = () => { y -= 10; page.drawLine({ start: { x: MX, y }, end: { x: PAGE_W - MX, y }, thickness: 0.6, color: RULE }) }

  y -= 6
  text(c.title, { size: 18, font: bold, color: INK })
  if (c.project) para(c.project, { size: 11, font: bold, color: INK, gap: 8 })
  if (c.location) para(c.location, { size: 9.5, color: MUTED })
  rule()

  y -= 6
  for (const [k, v] of c.facts) {
    y -= 15
    page.drawText(winAnsiSafe(k), { x: MX, y, size: 9.5, font: bold, color: MUTED })
    page.drawText(winAnsiSafe(v), { x: MX + 150, y, size: 10, font: regular, color: INK })
  }
  y -= 8
  para('Payment timing', { size: 9.5, font: bold, color: MUTED, gap: 10 })
  para(c.paymentTerms, { size: 10 })
  rule()

  y -= 8
  para('Pay application submission due dates', { size: 11, font: bold, color: INK, gap: 8 })
  if (!c.dates.length) {
    para('No dates: set the subcontractor billing frequency and first billing due date in Job Details.', { size: 10, color: MUTED })
  } else {
    // Two columns of six.
    const half = Math.ceil(c.dates.length / 2)
    const top = y - 6
    c.dates.forEach((d, i) => {
      const col = i < half ? 0 : 1
      const row = col ? i - half : i
      const yy = top - (row + 1) * 18
      const x = MX + col * (CONTENT_W / 2)
      page.drawText(`${i + 1}.`, { x, y: yy, size: 10, font: bold, color: MUTED })
      page.drawText(winAnsiSafe(formatDueDate(d)), { x: x + 24, y: yy, size: 10.5, font: regular, color: INK })
    })
    y = top - half * 18 - 4
  }
  rule()

  // Notes box: always drawn so the page keeps its shape; the notes typed on the job page go in it.
  y -= 8
  para('Notes', { size: 9.5, font: bold, color: MUTED, gap: 10 })
  const boxTop = y - 6
  const boxH = Math.max(90, Math.min(boxTop - 70, 220))
  page.drawRectangle({ x: MX, y: boxTop - boxH, width: CONTENT_W, height: boxH, borderColor: RULE, borderWidth: 0.8 })
  if (c.notes) {
    let ny = boxTop - 4
    for (const line of wrapLines(c.notes, regular, 10, CONTENT_W - 20)) {
      ny -= 14
      if (ny < boxTop - boxH + 8) break
      page.drawText(line, { x: MX + 10, y: ny, size: 10, font: regular, color: BODY })
    }
  }
  page.drawText(winAnsiSafe('Dates are calendar dates in Central Time. A later revision of this exhibit replaces this one.'), { x: MX, y: 40, size: 8, font: regular, color: MUTED })
  return doc.save()
}
