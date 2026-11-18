// Daily report PDF (prompt 92) — pure builder, no I/O: the export route loads the reports,
// checks access, filters / downloads photos and passes bytes in. NO branding: no logo and no
// company name anywhere; the only names printed are the project, its address and the author.
//
// buildDailyReportPdf(reports, photoDataByReport, opts?) → Promise<Uint8Array>
//   reports: daily_reports rows (FINAL only — the caller refuses drafts) each with
//     `job` ({ project_name, job_number, location }) and `author_name` attached.
//   photoDataByReport: { [reportId]: { images: [{ bytes, caption?, time? }],
//     notes?: { unsupported, tooLarge, overLimit, failed } } } — images already exclude
//     internal_only photos; notes count photos that are NOT in the PDF, by reason.
//   opts.range: { from, to } → a cover / summary page first (also when >1 report).
// Layout: US Letter, generous margins, small-caps section headings over a thin rule,
// two-column key facts, light-ruled tables, 2-column photo grid with captions, every report on
// a new page, footer "<project> · <date>" + "Page X of Y" drawn in a second pass.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { winAnsiSafe, wrapLines } from './pdf-text'
import { longDate, mediumDate, shortDate, datesLabel, jobTitle } from './daily-report-export'

const PAGE_W = 612, PAGE_H = 792
const MARGIN_X = 54, MARGIN_TOP = 54, MARGIN_BOTTOM = 64
const CONTENT_W = PAGE_W - MARGIN_X * 2
const FOOTER_Y = 32

const INK = rgb(0.11, 0.11, 0.13)
const BODY = rgb(0.2, 0.2, 0.23)
const MUTED = rgb(0.45, 0.46, 0.5)
const RULE = rgb(0.82, 0.83, 0.86)
const ROW_RULE = rgb(0.9, 0.9, 0.92)
const ACCENT = rgb(0.72, 0.18, 0.12) // weather delay flag only
const FRAME = rgb(0.93, 0.93, 0.95)

const rows = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [])
const txt = v => (v == null ? '' : typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? '' : String(v).trim())
const has = v => txt(v) !== ''
const join = (...parts) => parts.filter(p => has(p)).map(txt).join(' · ')

const centralStamp = iso => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : ''
}
const tempLabel = t => (/^-?\d+(\.\d+)?$/.test(txt(t)) ? `${txt(t)}°F` : txt(t))

export const isJpeg = b => !!b && b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
export const isPng = b => !!b && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

const byDate = (a, b) => String(a.report_date || '').localeCompare(String(b.report_date || '')) ||
  String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id || '').localeCompare(String(b.id || ''))

export async function buildDailyReportPdf(reports, photoDataByReport = {}, opts = {}) {
  const list = (Array.isArray(reports) ? reports : []).filter(Boolean).slice().sort(byDate)
  if (!list.length) throw new Error('No reports to export.')

  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)

  const job = list[0].job || {}
  const project = jobTitle(job)
  const dates = list.map(r => r.report_date)
  const combined = !!opts.range || list.length > 1
  doc.setTitle(winAnsiSafe(`Daily Report — ${project} — ${datesLabel(dates, opts.range || {})}`))
  doc.setAuthor('')
  doc.setCreator('Daily Report export')
  doc.setProducer('Daily Report export')

  let page = null
  let y = 0 // distance from the TOP of the page
  const footerLabels = [] // per page: '<project> · <date>'
  let currentFooter = ''

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H])
    y = MARGIN_TOP
    footerLabels.push(currentFooter)
  }
  const room = () => PAGE_H - MARGIN_BOTTOM - y
  const ensureSpace = need => { if (need > room()) newPage() }

  const draw = (s, x, { size = 10, font = regular, color = BODY, maxW } = {}) => {
    let t = winAnsiSafe(s).replace(/\n/g, ' ')
    if (maxW) while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + '…'
    page.drawText(t, { x, y: PAGE_H - y - size * 0.82, size, font, color })
  }
  const rule = (thickness = 0.5, color = RULE, x1 = MARGIN_X, x2 = PAGE_W - MARGIN_X) => {
    page.drawLine({ start: { x: x1, y: PAGE_H - y }, end: { x: x2, y: PAGE_H - y }, thickness, color })
  }

  // Small-caps heading: first letter of each word larger, the rest smaller capitals.
  const smallCaps = (title, x, { big = 10, small = 7.8, color = INK } = {}) => {
    let cx = x
    const words = winAnsiSafe(title).toUpperCase().split(' ')
    words.forEach((w, i) => {
      if (!w) return
      const head = w[0], tail = w.slice(1)
      page.drawText(head, { x: cx, y: PAGE_H - y - big * 0.82, size: big, font: bold, color })
      cx += bold.widthOfTextAtSize(head, big) + 0.4
      for (const ch of tail) {
        page.drawText(ch, { x: cx, y: PAGE_H - y - big * 0.82, size: small, font: bold, color })
        cx += bold.widthOfTextAtSize(ch, small) + 0.6
      }
      if (i < words.length - 1) cx += bold.widthOfTextAtSize(' ', big) + 1
    })
  }
  const HEADING_H = 26
  // A heading never sits alone at the bottom of a page: reserve room for what follows.
  const heading = (title, follow = 30) => {
    ensureSpace(HEADING_H + follow)
    y += 6
    smallCaps(title, MARGIN_X)
    y += 13
    rule(0.6, RULE)
    y += 7
  }

  const LINE_H = 14
  const paragraph = (text, { size = 10, font = regular, color = BODY, indent = 0 } = {}) => {
    const lines = wrapLines(text, font, size, CONTENT_W - indent)
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) {
      ensureSpace(LINE_H)
      if (line) draw(line, MARGIN_X + indent, { size, font, color })
      y += line ? LINE_H : LINE_H * 0.6
    }
    y += 6
  }
  const textSection = (title, value) => {
    if (!has(value)) return
    heading(title, LINE_H * 2)
    paragraph(txt(value))
  }

  // Two-column key facts: [{ label, value, color? }]
  const facts = items => {
    const shown = items.filter(i => has(i.value))
    const GAP = 24
    const colW = (CONTENT_W - GAP) / 2
    for (let i = 0; i < shown.length; i += 2) {
      const pair = shown.slice(i, i + 2)
      const wrapped = pair.map(f => wrapLines(txt(f.value), f.bold ? bold : regular, 10.5, colW))
      const h = 12 + Math.max(...wrapped.map(w => w.length)) * 14 + 8
      ensureSpace(h)
      pair.forEach((f, k) => {
        const x = MARGIN_X + k * (colW + GAP)
        draw(String(f.label).toUpperCase(), x, { size: 7.2, font: bold, color: MUTED })
        let ly = y + 12
        for (const line of wrapped[k]) {
          page.drawText(line, { x, y: PAGE_H - ly - 10.5 * 0.82, size: 10.5, font: f.bold ? bold : regular, color: f.color || INK })
          ly += 14
        }
      })
      y += h
    }
  }

  // Simple table: cols [{ label, key | get, w (fraction), size? }]
  const table = (title, items, cols) => {
    if (!items.length) return
    const SIZE = 9, PAD = 5, CELL_LH = 11.5, GAP = 8
    const widths = cols.map(c => c.w * CONTENT_W)
    const cellLines = item => cols.map((c, k) => {
      const v = c.get ? c.get(item) : item[c.key]
      return has(v) ? wrapLines(txt(v), regular, SIZE, widths[k] - GAP) : ['—']
    })
    const header = () => {
      let x = MARGIN_X
      cols.forEach((c, k) => { draw(c.label.toUpperCase(), x, { size: 7.2, font: bold, color: MUTED, maxW: widths[k] - GAP }); x += widths[k] })
      y += 12
      rule(0.6, RULE)
      y += 2
    }
    const first = cellLines(items[0])
    heading(title, 16 + Math.max(...first.map(l => l.length)) * CELL_LH + PAD * 2)
    header()
    const fullPage = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - 16
    items.forEach((item, idx) => {
      const lines = idx === 0 ? first : cellLines(item)
      const n = Math.max(...lines.map(l => l.length))
      const h = n * CELL_LH + PAD * 2
      // Move a row that fits on one page to the next page whole; a taller row is split.
      if (h > room() && h <= fullPage) { newPage(); header() }
      let off = 0
      while (off < n) {
        let fit = Math.floor((room() - PAD * 2) / CELL_LH)
        if (fit < 1) { newPage(); header(); fit = Math.floor((room() - PAD * 2) / CELL_LH) }
        const take = Math.min(n - off, fit)
        let x = MARGIN_X
        lines.forEach((cell, k) => {
          cell.slice(off, off + take).forEach((line, j) => {
            page.drawText(line, { x, y: PAGE_H - (y + PAD + j * CELL_LH) - SIZE * 0.82, size: SIZE, font: regular, color: line === '—' ? MUTED : BODY })
          })
          x += widths[k]
        })
        y += take * CELL_LH + PAD * 2
        off += take
        if (off < n) { newPage(); header() }
      }
      rule(0.4, ROW_RULE)
    })
    y += 12
  }

  const photoNotes = notes => {
    const n = notes || {}
    const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`
    return [
      n.unsupported > 0 && `${plural(n.unsupported, 'photo', 'photos')} not embedded (unsupported format)`,
      n.tooLarge > 0 && `${plural(n.tooLarge, 'photo', 'photos')} not embedded (over 8 MB)`,
      n.overLimit > 0 && `${plural(n.overLimit, 'photo', 'photos')} left out (photo limit for one PDF reached)`,
      n.failed > 0 && `${plural(n.failed, 'photo', 'photos')} could not be loaded`,
    ].filter(Boolean)
  }

  const photoGrid = async (data) => {
    const notes = { ...(data?.notes || {}) }
    const embedded = []
    for (const p of Array.isArray(data?.images) ? data.images : []) {
      // pdf-lib reads the view's whole underlying ArrayBuffer, so a view into a larger buffer
      // (a pooled Node Buffer, a subarray) is copied to its own buffer first.
      const raw = p?.bytes
      const bytes = raw instanceof Uint8Array && (raw.byteOffset !== 0 || raw.byteLength !== raw.buffer.byteLength) ? new Uint8Array(raw) : raw
      try {
        if (isJpeg(bytes)) embedded.push({ img: await doc.embedJpg(bytes), p })
        else if (isPng(bytes)) embedded.push({ img: await doc.embedPng(bytes), p })
        else notes.unsupported = (notes.unsupported || 0) + 1
      } catch {
        notes.unsupported = (notes.unsupported || 0) + 1
      }
    }
    const noteLines = photoNotes(notes)
    if (!embedded.length && !noteLines.length) return

    const GAP = 14
    const cellW = (CONTENT_W - GAP) / 2
    const imgH = Math.round(cellW * 0.72)
    const CAP = 8.5, CAP_LH = 10.5
    const captionOf = e => wrapLines(txt(e.p.caption), regular, CAP, cellW).slice(0, 3)
    const cellH = e => imgH + 6 + (e ? captionOf(e).length * CAP_LH + (has(e.p.time) ? CAP_LH : 0) : 0)

    const firstRowH = embedded.length ? Math.max(cellH(embedded[0]), cellH(embedded[1])) : LINE_H * noteLines.length
    heading(`Photos${embedded.length ? ` (${embedded.length})` : ''}`, firstRowH + 4)
    for (const line of noteLines) {
      ensureSpace(LINE_H)
      draw(line, MARGIN_X, { size: 9, font: italic, color: MUTED })
      y += LINE_H
    }
    if (noteLines.length) y += 4

    for (let i = 0; i < embedded.length; i += 2) {
      const pair = embedded.slice(i, i + 2)
      const h = Math.max(...pair.map(cellH)) + 14
      ensureSpace(h)
      pair.forEach((e, k) => {
        const x = MARGIN_X + k * (cellW + GAP)
        const top = PAGE_H - y
        page.drawRectangle({ x, y: top - imgH, width: cellW, height: imgH, color: FRAME })
        const scale = Math.min(cellW / e.img.width, imgH / e.img.height)
        const w = e.img.width * scale, hh = e.img.height * scale
        page.drawImage(e.img, { x: x + (cellW - w) / 2, y: top - imgH + (imgH - hh) / 2, width: w, height: hh })
        let cy = y + imgH + 6
        for (const line of captionOf(e)) {
          page.drawText(line, { x, y: PAGE_H - cy - CAP * 0.82, size: CAP, font: regular, color: BODY })
          cy += CAP_LH
        }
        if (has(e.p.time)) page.drawText(winAnsiSafe(txt(e.p.time)), { x, y: PAGE_H - cy - 7.5 * 0.82, size: 7.5, font: regular, color: MUTED })
      })
      y += h
    }
  }

  // ── Cover / summary page (range or several reports) ─────────────────────────
  if (combined) {
    currentFooter = `${project} · ${datesLabel(dates, opts.range || {})}`
    newPage()
    draw('Daily Reports', MARGIN_X, { size: 22, font: bold, color: INK })
    y += 30
    draw(project, MARGIN_X, { size: 13, font: regular, color: BODY, maxW: CONTENT_W })
    y += 22
    rule(1.2, INK)
    y += 16
    const from = opts.range?.from || dates[0], to = opts.range?.to || dates[dates.length - 1]
    facts([
      { label: 'Job number', value: job.job_number },
      { label: 'Address', value: job.location },
      { label: 'Dates', value: from === to ? longDate(from) : `${longDate(from)} – ${longDate(to)}` },
      { label: 'Reports included', value: String(list.length) },
    ])
    y += 6
    table('Reports included', list, [
      { label: 'Date', w: 0.22, get: r => shortDate(r.report_date) },
      { label: 'Weather', w: 0.28, get: r => join(r.weather, has(r.weather_temp) ? tempLabel(r.weather_temp) : '', r.weather_delay === true ? 'Weather delay' : '') },
      { label: 'Crew', w: 0.1, get: r => r.crew_count },
      { label: 'Prepared by', w: 0.28, get: r => r.author_name },
      { label: 'Photos', w: 0.12, get: r => String(rows(photoDataByReport?.[r.id]?.images).length) },
    ])
  }

  // ── One report per page run ─────────────────────────────────────────────────
  for (const r of list) {
    const rjob = r.job || job
    currentFooter = `${jobTitle(rjob)} · ${mediumDate(r.report_date)}`
    newPage()

    draw('Daily Report', MARGIN_X, { size: 22, font: bold, color: INK })
    y += 30
    draw(jobTitle(rjob), MARGIN_X, { size: 13, color: BODY, maxW: CONTENT_W })
    y += 22
    rule(1.2, INK)
    y += 16

    const revised = Number(r.revision_count) > 0
    facts([
      { label: 'Date', value: longDate(r.report_date), bold: true },
      { label: 'Job number', value: rjob.job_number },
      { label: 'Address', value: rjob.location },
      { label: 'Prepared by', value: r.author_name },
      { label: 'Weather', value: r.weather },
      { label: 'Temperature', value: has(r.weather_temp) ? tempLabel(r.weather_temp) : '' },
      { label: 'Weather delay', value: r.weather_delay === true ? 'Yes — weather delay day' : 'No', color: r.weather_delay === true ? ACCENT : undefined },
      { label: 'Crew on site', value: r.crew_count != null && r.crew_count !== '' ? String(r.crew_count) : '' },
      { label: 'Finalized', value: centralStamp(r.finalized_at) },
      { label: 'Revision', value: revised ? `Revised (rev ${Number(r.revision_count)})${has(r.revised_by_name) ? ` by ${txt(r.revised_by_name)}` : ''}` : '' },
    ])
    y += 4

    textSection('Work Performed', r.work_performed)
    table('Crew Log', rows(r.crew_log), [
      { label: 'Name', key: 'name', w: 0.32 },
      { label: 'Company', key: 'company', w: 0.3 },
      { label: 'Trade', key: 'trade', w: 0.24 },
      { label: 'Hours', key: 'hours', w: 0.14 },
    ])
    table('Subcontractor Activity', rows(r.subcontractor_activity), [
      { label: 'Company', key: 'company', w: 0.24 },
      { label: 'Trade', key: 'trade', w: 0.16 },
      { label: 'Crew', key: 'crew_count', w: 0.1 },
      { label: 'Work performed', key: 'work_performed', w: 0.5 },
    ])
    table('Equipment', rows(r.equipment_log), [
      { label: 'Equipment', key: 'name', w: 0.6 },
      { label: 'Quantity', key: 'quantity', w: 0.2 },
      { label: 'Hours', key: 'hours', w: 0.2 },
    ])
    table('Materials Delivered', rows(r.materials_delivered), [
      { label: 'Material', key: 'description', w: 0.5 },
      { label: 'Quantity', key: 'quantity', w: 0.2 },
      { label: 'Supplier', key: 'supplier', w: 0.3 },
    ])
    table('Visitors', rows(r.visitors), [
      { label: 'Name', key: 'name', w: 0.3 },
      { label: 'Company', key: 'company', w: 0.3 },
      { label: 'Purpose', key: 'purpose', w: 0.4 },
    ])
    textSection('Issues / Delays', r.issues)
    textSection('Safety Observations', r.safety_observations)
    textSection('Toolbox Talk', r.toolbox_talk)
    await photoGrid(photoDataByReport?.[r.id])
  }

  // ── Footer, second pass: "Page X of Y" + project / date on every page ───────
  const total = doc.getPageCount()
  for (let i = 0; i < total; i++) {
    const p = doc.getPage(i)
    p.drawLine({ start: { x: MARGIN_X, y: FOOTER_Y + 13 }, end: { x: PAGE_W - MARGIN_X, y: FOOTER_Y + 13 }, thickness: 0.4, color: RULE })
    const right = `Page ${i + 1} of ${total}`
    const rightW = regular.widthOfTextAtSize(right, 8)
    let left = winAnsiSafe(footerLabels[i] || '')
    while (left.length > 1 && regular.widthOfTextAtSize(left, 8) > CONTENT_W - rightW - 20) left = left.slice(0, -2) + '…'
    p.drawText(left, { x: MARGIN_X, y: FOOTER_Y, size: 8, font: regular, color: MUTED })
    p.drawText(right, { x: PAGE_W - MARGIN_X - rightW, y: FOOTER_Y, size: 8, font: regular, color: MUTED })
  }

  return doc.save()
}
