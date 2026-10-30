import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { createRequire } from 'module'
import { requireAuth } from '../../../../lib/server-auth'

// pdfkit is a CJS module — use createRequire for reliable interop in Next.js ESM routes
const require = createRequire(import.meta.url)
const PDFDocument = require('pdfkit')

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>'
const REPORT_RECIPIENTS = ['vivek@nvim.co', 'pwhite@nvim.co']

const fmtDate = d =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '—'
const fmtNum = n => (n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—')

function sectionLabel(doc, y) {
  return y // caller positions manually; just a style helper
}

async function buildPdf(report, photoBuffers) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 52, left: 40, right: 40 }, autoFirstPage: true })
  const PAGE_W = 532 // 612 - 40*2
  const chunks = []
  doc.on('data', c => chunks.push(c))

  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  // ── Letterhead ──────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111111').text('JaxEm Fabrication LLC', 40, 40)
  doc.font('Helvetica').fontSize(10).fillColor('#555555').text('Equipment Maintenance Services', 40, 62)

  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111111')
    .text('Maintenance Report', 40, 40, { align: 'right', width: PAGE_W })
  doc.font('Helvetica').fontSize(9).fillColor('#888888')
    .text(`Date: ${fmtDate(report.report_date)}`, 40, 58, { align: 'right', width: PAGE_W })

  doc.moveTo(40, 86).lineTo(572, 86).lineWidth(2).strokeColor('#111111').stroke()

  // ── Equipment Details ────────────────────────────────────────────
  let y = 104
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888').text('EQUIPMENT DETAILS', 40, y)
  doc.moveTo(40, y + 12).lineTo(572, y + 12).lineWidth(0.5).strokeColor('#dddddd').stroke()
  y += 20

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888').text('Equipment', 40, y)
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888').text('Hours at Service', 306, y)
  y += 12
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text(report.equipment_name || '—', 40, y)
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text(`${fmtNum(report.current_hours)} hrs`, 306, y)
  y += 30

  // ── Work Performed ───────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888').text('WORK PERFORMED', 40, y)
  doc.moveTo(40, y + 12).lineTo(572, y + 12).lineWidth(0.5).strokeColor('#dddddd').stroke()
  y += 20

  doc.font('Helvetica').fontSize(10).fillColor('#111111').text(report.description || '', 40, y, { width: PAGE_W, lineGap: 4 })
  y = doc.y + 20

  // ── Photos ───────────────────────────────────────────────────────
  if (photoBuffers.length) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888').text(`PHOTOS (${photoBuffers.length})`, 40, y)
    doc.moveTo(40, y + 12).lineTo(572, y + 12).lineWidth(0.5).strokeColor('#dddddd').stroke()
    y += 20

    const COLS = 3
    const GAP = 8
    const IMG_W = Math.floor((PAGE_W - GAP * (COLS - 1)) / COLS) // ~172pt per photo

    for (let i = 0; i < photoBuffers.length; i += COLS) {
      const rowHeight = IMG_W * 0.75 // 4:3 aspect cap
      // Add a new page if this row won't fit
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage()
        y = 40
      }
      for (let col = 0; col < COLS; col++) {
        const buf = photoBuffers[i + col]
        if (!buf) break
        const x = 40 + col * (IMG_W + GAP)
        try {
          doc.image(buf, x, y, { width: IMG_W, height: rowHeight, cover: [IMG_W, rowHeight] })
        } catch (_) {}
      }
      y += rowHeight + GAP
    }
    y += 12
  }

  // ── Signatures ───────────────────────────────────────────────────
  if (y + 60 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = 40 }
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888').text('SIGNATURES', 40, y)
  doc.moveTo(40, y + 12).lineTo(572, y + 12).lineWidth(0.5).strokeColor('#dddddd').stroke()
  y += 34

  const sigW = 220
  doc.moveTo(40, y).lineTo(40 + sigW, y).lineWidth(1).strokeColor('#111111').stroke()
  doc.moveTo(572 - sigW, y).lineTo(572, y).lineWidth(1).strokeColor('#111111').stroke()
  y += 6
  doc.font('Helvetica').fontSize(9).fillColor('#555555').text('Technician: Landon Moore', 40, y)
  doc.font('Helvetica').fontSize(9).fillColor('#555555').text('Authorized By', 572 - sigW, y)

  // ── Footer (page numbers via range) ─────────────────────────────
  const totalPages = doc.bufferedPageRange ? doc.bufferedPageRange().count : 1
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i)
    const pageY = doc.page.height - 36
    doc.font('Helvetica').fontSize(8).fillColor('#aaaaaa')
      .text('JaxEm Fabrication LLC · Equipment Maintenance Report', 40, pageY, { width: PAGE_W / 2 })
      .text(`Page ${i + 1} of ${totalPages}`, 40 + PAGE_W / 2, pageY, { width: PAGE_W / 2, align: 'right' })
  }

  doc.end()
  return done
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
      .from('maintenance_reports')
      .select('*')
      .eq('id', report_id)
      .maybeSingle()

    if (fetchErr || !report) return Response.json({ error: 'Report not found' }, { status: 404 })

    if (report.performed_by !== auth.userId && !['pm', 'apm', 'admin'].includes(auth.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Signed URLs for photos
    const paths = (report.photos || []).map(p => p.path || p).filter(Boolean)
    const signedUrls = {}
    if (paths.length) {
      const { data } = await adminSupabase.storage
        .from('daily-report-photos')
        .createSignedUrls(paths, 3600)
      if (data) paths.forEach((path, i) => { if (data[i]?.signedUrl) signedUrls[path] = data[i].signedUrl })
    }

    // Fetch photo buffers in parallel
    const photoBuffers = (
      await Promise.all(
        paths.map(async path => {
          const url = signedUrls[path]
          if (!url) return null
          try {
            const res = await fetch(url)
            if (!res.ok) return null
            return Buffer.from(await res.arrayBuffer())
          } catch (_) { return null }
        })
      )
    ).filter(Boolean)

    const pdfBuffer = await buildPdf(report, photoBuffers)

    const dateStr = report.report_date
      ? new Date(report.report_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : ''
    const safeName = (report.equipment_name || 'equipment').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const filename = `maintenance-report-${safeName}-${report.report_date || 'unknown'}.pdf`

    await resend.emails.send({
      from: FROM,
      to: REPORT_RECIPIENTS,
      subject: `Maintenance Report — ${report.equipment_name}${dateStr ? ` — ${dateStr}` : ''}`,
      html: `<p style="font-family:sans-serif;color:#333;font-size:14px">Maintenance report for <strong>${report.equipment_name}</strong>${dateStr ? ` (${dateStr})` : ''} is attached.</p>`,
      attachments: [{ filename, content: pdfBuffer }],
    })

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
