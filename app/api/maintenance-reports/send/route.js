import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { requireAuth } from '../../../../lib/server-auth'
import { escapeHtml } from '../../../../lib/email'
import { winAnsiSafe, wrapLines } from '../../../../lib/pdf-text'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>'
const REPORT_RECIPIENTS = ['vivek@nvim.co', 'pwhite@nvim.co']

const PAGE_W = 612, PAGE_H = 792, MARGIN = 40
const CONTENT_W = PAGE_W - MARGIN * 2

const C_BLACK  = rgb(0.07, 0.07, 0.07)
const C_GRAY   = rgb(0.53, 0.53, 0.53)
const C_LGRAY  = rgb(0.87, 0.87, 0.87)
const C_FOOTER = rgb(0.67, 0.67, 0.67)

const fmtDate = d =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '—'
const fmtNum = n => n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—'

// photoData: one entry per photo on the report; null when it could not be downloaded.
async function buildPdf(report, photoData) {
  const doc = await PDFDocument.create()
  const font     = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)

  // curY = distance from TOP of page (we convert to pdf-lib coords as PAGE_H - curY)
  let page, curY

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H])
    curY = MARGIN
  }
  function ensureSpace(needed) {
    if (curY + needed > PAGE_H - MARGIN) newPage()
  }

  // pdf-lib y origin is bottom-left; we store curY as distance from top
  const py = () => PAGE_H - curY   // current baseline y in pdf-lib coords

  function drawText(text, x, opts = {}) {
    const { size = 10, bold = false, color = C_BLACK, rightX } = opts
    const f = bold ? boldFont : font
    const s = winAnsiSafe(text).replace(/\n/g, ' ')
    const drawX = rightX != null ? rightX - f.widthOfTextAtSize(s, size) : x
    page.drawText(s, { x: drawX, y: py() - size, size, font: f, color })
  }

  function hline(thickness = 0.5, color = C_LGRAY) {
    const lineY = py() - 1
    page.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: PAGE_W - MARGIN, y: lineY }, thickness, color })
  }

  function sectionLabel(title) {
    ensureSpace(28)
    drawText(title, MARGIN, { size: 8, bold: true, color: C_GRAY })
    curY += 13
    hline(0.5, C_LGRAY)
    curY += 9
  }

  newPage()

  // ── Letterhead ──────────────────────────────────────────────────
  drawText('JaxEm Fabrication LLC', MARGIN, { size: 18, bold: true })
  drawText('Maintenance Report', MARGIN, { size: 14, bold: true, rightX: PAGE_W - MARGIN })
  curY += 22
  drawText('Equipment Maintenance Services', MARGIN, { size: 10, color: C_GRAY })
  drawText(`Date: ${fmtDate(report.report_date)}`, MARGIN, { size: 9, color: C_GRAY, rightX: PAGE_W - MARGIN })
  curY += 16
  hline(2, C_BLACK)
  curY += 18

  // ── Equipment Details ────────────────────────────────────────────
  sectionLabel('EQUIPMENT DETAILS')
  drawText('Equipment', MARGIN, { size: 8, bold: true, color: C_GRAY })
  drawText('Hours at Service', MARGIN + CONTENT_W / 2, { size: 8, bold: true, color: C_GRAY })
  curY += 11
  drawText(report.equipment_name || '—', MARGIN, { size: 13, bold: true })
  drawText(`${fmtNum(report.current_hours)} hrs`, MARGIN + CONTENT_W / 2, { size: 13, bold: true })
  curY += 28

  // ── Work Performed ───────────────────────────────────────────────
  sectionLabel('WORK PERFORMED')
  const descLines = wrapLines(report.description || '', font, 10, CONTENT_W)
  for (const line of descLines) {
    ensureSpace(15)
    if (line) drawText(line, MARGIN, { size: 10 })
    curY += 15
  }
  curY += 8

  // ── Photos ───────────────────────────────────────────────────────
  // Embed first so the label counts only photos that are really in the PDF.
  const images = []
  for (const pd of photoData) {
    if (!pd) continue
    try {
      images.push(pd.isPng ? await doc.embedPng(pd.buffer) : await doc.embedJpg(pd.buffer))
    } catch (_) {
      // Not a JPEG/PNG pdf-lib can read (e.g. HEIC/WebP): counted as skipped below.
    }
  }
  const skipped = photoData.length - images.length
  if (photoData.length) {
    sectionLabel(`PHOTOS (${images.length})`)
    if (skipped) {
      drawText(`${skipped} photo${skipped === 1 ? '' : 's'} could not be embedded (unsupported format or download failed).`, MARGIN, { size: 9, color: C_GRAY })
      curY += 15
    }
    const COLS = 3, GAP = 8
    const IMG_W = Math.floor((CONTENT_W - GAP * (COLS - 1)) / COLS)
    const IMG_H = Math.floor(IMG_W * 0.75)

    for (let i = 0; i < images.length; i += COLS) {
      ensureSpace(IMG_H + GAP)
      for (let col = 0; col < COLS; col++) {
        const img = images[i + col]
        if (!img) break
        page.drawImage(img, {
          x: MARGIN + col * (IMG_W + GAP),
          y: PAGE_H - curY - IMG_H,
          width: IMG_W,
          height: IMG_H,
        })
      }
      curY += IMG_H + GAP
    }
    curY += 8
  }

  // ── Signatures ───────────────────────────────────────────────────
  ensureSpace(70)
  sectionLabel('SIGNATURES')
  curY += 20
  const sigW = 220, sigY = py()
  page.drawLine({ start: { x: MARGIN, y: sigY }, end: { x: MARGIN + sigW, y: sigY }, thickness: 1, color: C_BLACK })
  page.drawLine({ start: { x: PAGE_W - MARGIN - sigW, y: sigY }, end: { x: PAGE_W - MARGIN, y: sigY }, thickness: 1, color: C_BLACK })
  curY += 8
  drawText('Technician: Landon Moore', MARGIN, { size: 9, color: C_GRAY })
  drawText('Authorized By', PAGE_W - MARGIN - sigW, { size: 9, color: C_GRAY })

  // ── Footer on every page ─────────────────────────────────────────
  const total = doc.getPageCount()
  for (let i = 0; i < total; i++) {
    const p = doc.getPage(i)
    const fy = 22
    p.drawText('JaxEm Fabrication LLC · Equipment Maintenance Report', {
      x: MARGIN, y: fy, size: 8, font, color: C_FOOTER,
    })
    const label = `Page ${i + 1} of ${total}`
    p.drawText(label, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(label, 8), y: fy, size: 8, font, color: C_FOOTER,
    })
  }

  return { buffer: Buffer.from(await doc.save()), embedded: images.length, skipped }
}

export const maxDuration = 30

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { report_id } = body
  if (!report_id) return Response.json({ error: 'report_id required' }, { status: 400 })

  try {
    const { data: report, error: fetchErr } = await adminSupabase
      .from('maintenance_reports').select('*').eq('id', report_id).maybeSingle()
    if (fetchErr || !report) return Response.json({ error: 'Report not found' }, { status: 404 })
    if (report.performed_by !== auth.userId && !['principal', 'pm', 'apm', 'admin'].includes(auth.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const paths = (report.photos || []).map(p => p.path || p).filter(Boolean)
    const signedUrls = {}
    if (paths.length) {
      const { data } = await adminSupabase.storage.from('daily-report-photos').createSignedUrls(paths, 3600)
      if (data) paths.forEach((path, i) => { if (data[i]?.signedUrl) signedUrls[path] = data[i].signedUrl })
    }

    const photoData = await Promise.all(
      paths.map(async path => {
        const url = signedUrls[path]
        if (!url) return null
        try {
          const res = await fetch(url)
          if (!res.ok) return null
          const buffer = Buffer.from(await res.arrayBuffer())
          const ct = res.headers.get('content-type') || ''
          return { buffer, isPng: ct.includes('png') }
        } catch (_) { return null }
      })
    )

    const { buffer: pdfBuffer, embedded, skipped } = await buildPdf(report, photoData)

    const dateStr = report.report_date
      ? new Date(report.report_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : ''
    const safeName = (report.equipment_name || 'equipment').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const filename = `maintenance-report-${safeName}-${report.report_date || 'unknown'}.pdf`

    const { error: sendErr } = await resend.emails.send({
      from: FROM,
      to: REPORT_RECIPIENTS,
      subject: `Maintenance Report — ${String(report.equipment_name || '').replace(/[\r\n]+/g, ' ').slice(0, 150)}${dateStr ? ` — ${dateStr}` : ''}`,
      html: `<p style="font-family:sans-serif;color:#333;font-size:14px">Maintenance report for <strong>${escapeHtml(report.equipment_name || '')}</strong>${dateStr ? ` (${dateStr})` : ''} is attached.</p>`,
      attachments: [{ filename, content: pdfBuffer }],
    })
    if (sendErr) return Response.json({ error: 'Email not sent: ' + (sendErr.message || 'provider refused the message') }, { status: 502 })

    return Response.json({ ok: true, photos_embedded: embedded, photos_skipped: skipped })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
