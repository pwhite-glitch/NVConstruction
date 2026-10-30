import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import PdfPrinter from 'pdfmake/src/printer'
import { requireAuth } from '../../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>'
const REPORT_RECIPIENTS = ['vivek@nvim.co', 'pwhite@nvim.co']

const FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
}

const fmtDate = d =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '—'
const fmtNum = n => (n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—')

function sectionLabel(title) {
  return [
    { text: title, fontSize: 8, bold: true, color: '#888888', characterSpacing: 1.5, margin: [0, 0, 0, 4] },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#dddddd' }], margin: [0, 0, 0, 8] },
  ]
}

function buildDocDef(report, photoDataUris) {
  const photoPaths = (report.photos || []).map(p => p.path || p).filter(Boolean)
  const photoImages = photoPaths.map(p => photoDataUris[p]).filter(Boolean)

  // Pair photos into rows of 2
  const photoRows = []
  for (let i = 0; i < photoImages.length; i += 2) {
    const cols = [{ image: photoImages[i], width: 240, margin: [0, 0, 0, 6] }]
    if (photoImages[i + 1]) cols.push({ image: photoImages[i + 1], width: 240, margin: [0, 0, 0, 6] })
    photoRows.push({ columns: cols, columnGap: 10, margin: [0, 0, 0, 0] })
  }

  return {
    pageSize: 'LETTER',
    pageMargins: [40, 40, 40, 52],
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    content: [
      // Letterhead
      {
        columns: [
          {
            stack: [
              { text: 'JaxEm Fabrication LLC', fontSize: 18, bold: true },
              { text: 'Equipment Maintenance Services', fontSize: 10, color: '#555555', margin: [0, 3, 0, 0] },
            ],
          },
          {
            stack: [
              { text: 'Maintenance Report', fontSize: 14, bold: true, alignment: 'right' },
              { text: `Date: ${fmtDate(report.report_date)}`, fontSize: 9, color: '#888888', alignment: 'right', margin: [0, 3, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 10],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2 }], margin: [0, 0, 0, 18] },

      // Equipment details
      ...sectionLabel('EQUIPMENT DETAILS'),
      {
        columns: [
          {
            stack: [
              { text: 'Equipment', fontSize: 8, bold: true, color: '#888888' },
              { text: report.equipment_name || '—', fontSize: 13, bold: true, margin: [0, 2, 0, 0] },
            ],
          },
          {
            stack: [
              { text: 'Hours at Service', fontSize: 8, bold: true, color: '#888888' },
              { text: `${fmtNum(report.current_hours)} hrs`, fontSize: 13, bold: true, margin: [0, 2, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 18],
      },

      // Work performed
      ...sectionLabel('WORK PERFORMED'),
      { text: report.description || '', fontSize: 10, lineHeight: 1.6, margin: [0, 0, 0, 18] },

      // Photos
      ...(photoRows.length
        ? [
            ...sectionLabel(`PHOTOS (${photoImages.length})`),
            ...photoRows,
            { text: '', margin: [0, 0, 0, 10] },
          ]
        : []),

      // Signatures
      ...sectionLabel('SIGNATURES'),
      { text: '', margin: [0, 0, 0, 22] },
      {
        columns: [
          {
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 222, y2: 0, lineWidth: 1 }] },
              { text: 'Technician: Landon Moore', fontSize: 9, color: '#555555', margin: [0, 4, 0, 0] },
            ],
          },
          {
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 222, y2: 0, lineWidth: 1 }] },
              { text: 'Authorized By', fontSize: 9, color: '#555555', margin: [0, 4, 0, 0] },
            ],
          },
        ],
        columnGap: 40,
      },
    ],
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: 'JaxEm Fabrication LLC · Equipment Maintenance Report', fontSize: 8, color: '#aaaaaa' },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#aaaaaa', alignment: 'right' },
      ],
      margin: [40, 12, 40, 0],
    }),
  }
}

function renderPdf(docDef) {
  const printer = new PdfPrinter(FONTS)
  const doc = printer.createPdfKitDocument(docDef)
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
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

    // Signed URLs for photos (1 hr)
    const paths = (report.photos || []).map(p => p.path || p).filter(Boolean)
    const signedUrls = {}
    if (paths.length) {
      const { data } = await adminSupabase.storage
        .from('daily-report-photos')
        .createSignedUrls(paths, 3600)
      if (data) paths.forEach((path, i) => { if (data[i]?.signedUrl) signedUrls[path] = data[i].signedUrl })
    }

    // Fetch photos as base64 data URIs so they're embedded in the PDF
    const photoDataUris = {}
    await Promise.all(
      paths.map(async path => {
        const url = signedUrls[path]
        if (!url) return
        try {
          const res = await fetch(url)
          const buf = Buffer.from(await res.arrayBuffer())
          const mime = res.headers.get('content-type') || 'image/jpeg'
          photoDataUris[path] = `data:${mime};base64,${buf.toString('base64')}`
        } catch (_) {}
      })
    )

    const pdfBuffer = await renderPdf(buildDocDef(report, photoDataUris))

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
