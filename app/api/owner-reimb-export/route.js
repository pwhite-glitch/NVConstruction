import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM } from '../../../lib/server-auth'
import { buildZip } from '../../../lib/zip-builder'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST /api/owner-reimb-export
// Body: { invoiceId, invoiceHtml }
// Returns a ZIP containing the invoice HTML and any linked receipts.
// Fails with 422 if any receipt cannot be retrieved — never produces a silent incomplete package.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { invoiceId, invoiceHtml } = body
  if (!invoiceId) return Response.json({ error: 'invoiceId required' }, { status: 400 })

  // Fetch invoice with lines and direct cost receipt paths
  const { data: inv, error: invErr } = await adminSupabase
    .from('owner_reimb_invoices')
    .select(`
      id, invoice_number, job_id, status,
      owner_reimb_invoice_lines(
        id, description, direct_cost_id,
        direct_costs(id, receipt_url, description)
      )
    `)
    .eq('id', invoiceId)
    .maybeSingle()

  if (invErr || !inv) return Response.json({ error: 'Invoice not found' }, { status: 404 })

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

  // Download receipts from linked direct costs
  const lines = inv.owner_reimb_invoice_lines || []
  for (const line of lines) {
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
    const ext = dc.receipt_url.split('.').pop()?.toLowerCase() || 'pdf'
    const baseName = (dc.description || line.description || 'receipt').slice(0, 40).replace(/[^\w\s]/g, '_')
    const fileName = uniqueName(`${baseName}.${ext}`)
    zipFiles.push({ name: `Receipts/${fileName}`, data: Buffer.from(arrayBuf) })
  }

  // Fail clearly if any receipt could not be retrieved
  if (failures.length > 0) {
    return Response.json({
      error: `Could not retrieve ${failures.length} receipt file${failures.length > 1 ? 's' : ''}: ${failures.join(', ')}. Export aborted.`
    }, { status: 422 })
  }

  // Invoice HTML
  if (invoiceHtml) {
    zipFiles.unshift({ name: 'Invoice.html', data: Buffer.from(invoiceHtml, 'utf8') })
  }

  // README
  const readmeLines = [
    `OWNER REIMBURSEMENT INVOICE`,
    `Invoice: ${inv.invoice_number}`,
    '='.repeat(58),
    '',
    'Contents:',
    '  Invoice.html   — Open in any browser, then File > Print to save as PDF',
    `  Receipts/      — ${zipFiles.filter(f => f.name.startsWith('Receipts/')).length} receipt file(s)`,
    '',
    'CONFIDENTIAL — NV Construction internal document. Do not distribute.',
    '',
    `Generated: ${new Date().toUTCString()}`,
  ]
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
