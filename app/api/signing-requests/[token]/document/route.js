import { createClient } from '@supabase/supabase-js'
import { mbRequestByToken, loadPinnedPdf, downloadBytes } from '../../../../../lib/mb-server'
import { streamedBytesResponse } from '../../../../../lib/stream-response'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// The PDF a metal-building signing link refers to, and nothing else:
//   pending -> the exact pinned client order form (SHA-256 checked)
//   signed  -> the signed copy (falls back to the pinned original)
//   voided  -> gone
// The storage path always comes from the request row, never from the caller.
export async function GET(request, { params }) {
  const { token } = params
  if (!token || typeof token !== 'string') return Response.json({ error: 'Not found' }, { status: 404 })
  const r = await mbRequestByToken(adminSupabase, token)
  if (r.error) return Response.json({ error: 'Could not load the document.' }, { status: 500 })
  const mb = r.mb
  if (!mb) return Response.json({ error: 'Not found' }, { status: 404 })
  if (mb.status !== 'pending' && mb.status !== 'signed') return Response.json({ error: 'This signing link is no longer valid.' }, { status: 410 })

  let bytes = null
  if (mb.status === 'signed' && mb.signed_document_path) {
    const s = await downloadBytes(adminSupabase, mb.signed_document_path)
    if (!s.error) bytes = s.bytes
  }
  if (!bytes) {
    const pin = await loadPinnedPdf(adminSupabase, mb)
    if (pin.error) return Response.json({ error: pin.error }, { status: 409 })
    bytes = pin.bytes
  }
  const name = String(mb.document_file_name || 'order-form.pdf').replace(/[^\w.\- ]+/g, '_')
  // Streamed in bounded chunks (no Content-Length) so a large checked PDF is not capped as a
  // buffered response. The bytes are exactly the ones checked above (pinned SHA-256 or the
  // signed copy); nothing is re-read from Storage after the check.
  return streamedBytesResponse(bytes, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${name}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  })
}
