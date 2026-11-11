import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { privateJson } from '../../../lib/file-upload-server'
import { sortInvoiceLines, ownerRows, ownerZipName, MANIFEST_PAGE_SIZE } from '../../../lib/export-manifest'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const SIGNED_URL_SECONDS = 3600

// POST /api/owner-reimb-export — owner reimbursement ZIP MANIFEST (prompt 78).
// Body: { invoiceId, offset? }
// → { invoice_number, zip_name, total, receipt_count, offset, next_offset,
//     rows: [{ num, date, vendor, amount, description, receipt, url? }] }
// One row per invoice line in stable invoice order (sort_order nulls last, then id), numbered
// across the whole invoice; receipt is the archive name (Receipts/…) or NO RECEIPT for a line
// that genuinely has none. Lines that share a receipt each keep their own entry. A receipt is
// only signed when the line's direct cost is the stored direct_cost_id AND on the invoice's job.
// The browser builds Invoice.html (locally), INDEX.txt and README.txt and fetches the receipts
// with the 1-hour signed links; it aborts the whole export if any fetch fails.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { invoiceId } = body || {}
  if ('invoiceHtml' in (body || {})) return Response.json({ error: 'Invoice.html is added in the browser; do not send it.' }, { status: 400 })
  if (!invoiceId || typeof invoiceId !== 'string') return Response.json({ error: 'invoiceId required' }, { status: 400 })
  const offset = body.offset === undefined ? 0 : body.offset
  if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: 'Invalid offset.' }, { status: 400 })

  const { data: inv, error: invErr } = await adminSupabase
    .from('owner_reimb_invoices')
    .select(`
      id, invoice_number, job_id, status,
      owner_reimb_invoice_lines(
        id, description, direct_cost_id, expense_date, vendor, billed_amount, sort_order,
        direct_costs(id, receipt_url, description, job_id)
      )
    `)
    .eq('id', invoiceId)
    .maybeSingle()

  if (invErr || !inv) return Response.json({ error: 'Invoice not found' }, { status: 404 })
  const denied = await denyJob(adminSupabase, auth, inv.job_id)
  if (denied) return denied

  const lines = sortInvoiceLines(inv.owner_reimb_invoice_lines)
  // A receipt is exported only from the line's own stored direct cost on this invoice's job.
  const foreign = lines.filter(l => l.direct_costs && (String(l.direct_costs.id) !== String(l.direct_cost_id) || l.direct_costs.job_id !== inv.job_id))
  if (foreign.length) {
    return Response.json({ error: `${foreign.length} invoice line${foreign.length > 1 ? 's point' : ' points'} at a direct cost that is not on this invoice's job. Export aborted.` }, { status: 422 })
  }
  const rows = ownerRows(lines, l => l.direct_costs?.receipt_url || null)

  const page = rows.slice(offset, offset + MANIFEST_PAGE_SIZE)
  const withReceipt = page.filter(r => r.receiptPath)
  let urls = new Map()
  if (withReceipt.length) {
    const { data: signed, error: signErr } = await adminSupabase.storage.from('receipts').createSignedUrls(withReceipt.map(r => r.receiptPath), SIGNED_URL_SECONDS)
    const failed = signErr ? withReceipt : withReceipt.filter((r, i) => !signed?.[i]?.signedUrl || signed[i].error)
    if (failed.length) {
      // A receipt that cannot be prepared is an error, never NO RECEIPT.
      return Response.json({ error: `Could not retrieve ${failed.length} receipt file${failed.length > 1 ? 's' : ''} (line${failed.length > 1 ? 's' : ''} ${failed.map(r => r.num).join(', ')}). Export aborted.` }, { status: 422 })
    }
    urls = new Map(withReceipt.map((r, i) => [r.line_id, signed[i].signedUrl]))
  }

  return privateJson({
    invoice_number: inv.invoice_number,
    zip_name: ownerZipName(inv.invoice_number),
    total: rows.length,
    receipt_count: rows.filter(r => r.receiptPath).length,
    offset,
    next_offset: offset + MANIFEST_PAGE_SIZE < rows.length ? offset + MANIFEST_PAGE_SIZE : null,
    rows: page.map(({ receiptPath, line_id, ...r }) => (receiptPath ? { ...r, url: urls.get(line_id) } : r)),
  })
}
