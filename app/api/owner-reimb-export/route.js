import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM } from '../../../lib/server-auth'
import { buildZip } from '../../../lib/zip-builder'
import { denyJob } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST /api/owner-reimb-export
// Body: { invoiceId, invoiceHtml }
// Returns a ZIP for the owner: Invoice.html, INDEX.txt (every invoice line, numbered, with its
// receipt file or NO RECEIPT), README.txt, and Receipts/ named by line/date/vendor/amount.
// Fails with 422 if a linked receipt cannot be retrieved. Lines that never had a receipt are
// listed as NO RECEIPT in INDEX.txt — never silently dropped.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { invoiceId, invoiceHtml } = body || {}
  if (!invoiceId) return Response.json({ error: 'invoiceId required' }, { status: 400 })
  if (typeof invoiceHtml !== 'string' || !invoiceHtml.trim()) {
    return Response.json({ error: 'invoiceHtml required' }, { status: 400 })
  }

  // Fetch invoice with lines and direct cost receipt paths
  const { data: inv, error: invErr } = await adminSupabase
    .from('owner_reimb_invoices')
    .select(`
      id, invoice_number, job_id, status,
      owner_reimb_invoice_lines(
        id, description, direct_cost_id, expense_date, vendor, billed_amount, sort_order,
        direct_costs(id, receipt_url, description)
      )
    `)
    .eq('id', invoiceId)
    .maybeSingle()

  if (invErr || !inv) return Response.json({ error: 'Invoice not found' }, { status: 404 })
  const denied = await denyJob(adminSupabase, auth, inv.job_id)
  if (denied) return denied

  const zipFiles = []
  const failures = []
  const usedNames = new Set()

  function uniqueName(raw) {
    let safe = raw.replace(/[^\w\s.\-()]/g, '_')
    if (!usedNames.has(safe)) { usedNames.add(safe); return safe }
    const ext = safe.match(/(\.[^.]+)$/) ? safe.match(/(\.[^.]+)$/)[1] : ''
    const base = safe.slice(0, safe.length - ext.length)
    let n = 2
    while (usedNames.has(`${base}_${n}${ext}`)) n++
    const final = `${base}_${n}${ext}`
    usedNames.add(final)
    return final
  }

  const slugPart = (v, fallback) => {
    const s = String(v || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
    return s || fallback
  }
  const dateOf = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null)
  const amt = n => Number(n || 0).toFixed(2)

  // Stable invoice order: sort_order ascending, then id.
  const lines = [...(inv.owner_reimb_invoice_lines || [])].sort((a, b) => {
    const sa = a.sort_order == null ? Infinity : Number(a.sort_order)
    const sb = b.sort_order == null ? Infinity : Number(b.sort_order)
    if (sa !== sb) return sa < sb ? -1 : 1
    return String(a.id).localeCompare(String(b.id))
  })
  const pad = Math.max(2, String(lines.length).length)

  // Walk every line; download linked receipts, record NO RECEIPT for the rest.
  const indexRows = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const num = String(i + 1).padStart(pad, '0')
    const date = dateOf(line.expense_date)
    const row = {
      num,
      date: date || '—',
      vendor: line.vendor || '—',
      amount: amt(line.billed_amount),
      description: line.description || '',
      receipt: 'NO RECEIPT',
    }
    indexRows.push(row)

    const dc = line.direct_costs
    if (!dc?.receipt_url) continue

    const { data: blob, error: dlErr } = await adminSupabase.storage
      .from('receipts')
      .download(dc.receipt_url)

    if (dlErr || !blob) {
      failures.push(dc.receipt_url)
      continue
    }

    const arrayBuf = await blob.arrayBuffer()
    const rawExt = dc.receipt_url.includes('.') ? dc.receipt_url.split('.').pop().toLowerCase() : ''
    const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'pdf'
    const baseName = `${num}_${date || 'nodate'}_${slugPart(line.vendor, 'novendor')}_${amt(line.billed_amount)}`
    const fileName = uniqueName(`${baseName}.${ext}`)
    const path = `Receipts/${fileName}`
    row.receipt = path
    zipFiles.push({ name: path, data: Buffer.from(arrayBuf) })
  }

  // Fail clearly if any receipt could not be retrieved
  if (failures.length > 0) {
    return Response.json({
      error: `Could not retrieve ${failures.length} receipt file${failures.length > 1 ? 's' : ''}: ${failures.join(', ')}. Export aborted.`
    }, { status: 422 })
  }

  const receiptCount = zipFiles.filter(f => f.name.startsWith('Receipts/')).length
  const noReceiptCount = indexRows.filter(r => r.receipt === 'NO RECEIPT').length

  // INDEX.txt — one row per invoice line, in invoice order
  const cols = [
    ['#', r => r.num],
    ['Date', r => r.date],
    ['Vendor', r => r.vendor],
    ['Billed', r => r.amount],
    ['Receipt', r => r.receipt],
    ['Description', r => r.description],
  ]
  const widths = cols.map(([h, f], ci) => ci === cols.length - 1 ? 0 : Math.max(h.length, ...indexRows.map(r => String(f(r)).length)))
  const fmtRow = vals => vals.map((v, ci) => ci === cols.length - 1 ? v : String(v).padEnd(widths[ci])).join('  ').trimEnd()
  const indexLines = [
    `RECEIPT INDEX — Invoice ${inv.invoice_number}`,
    'Line numbers follow the line order on Invoice.html. Amount is the Billed amount.',
    '',
    fmtRow(cols.map(([h]) => h)),
    fmtRow(cols.map((_, ci) => '-'.repeat(Math.max(widths[ci], cols[ci][0].length)))),
    ...indexRows.map(r => fmtRow(cols.map(([, f]) => String(f(r))))),
    '',
    `${indexRows.length} line(s): ${receiptCount} with receipt, ${noReceiptCount} NO RECEIPT`,
  ]

  // README
  const readmeLines = [
    `OWNER REIMBURSEMENT INVOICE`,
    `Invoice: ${inv.invoice_number}`,
    '='.repeat(58),
    '',
    'Contents:',
    '  Invoice.html   — Open in any browser, then File > Print to save as PDF',
    '  INDEX.txt      — Numbered list of invoice lines with date, vendor, billed amount, and receipt file',
    `  Receipts/      — ${receiptCount} receipt file(s)`,
    '',
    'Lines without receipt backup are marked NO RECEIPT in INDEX.txt.',
    '',
    `Generated: ${new Date().toUTCString()}`,
  ]

  zipFiles.unshift({ name: 'INDEX.txt', data: Buffer.from(indexLines.join('\n'), 'utf8') })
  zipFiles.unshift({ name: 'Invoice.html', data: Buffer.from(invoiceHtml, 'utf8') })
  zipFiles.unshift({ name: 'README.txt', data: Buffer.from(readmeLines.join('\n'), 'utf8') })

  const zip = buildZip(zipFiles)
  const slug = inv.invoice_number.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40)

  return new Response(zip, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Reimb_${slug}.zip"`,
      'Content-Length': String(zip.length),
    },
  })
}
