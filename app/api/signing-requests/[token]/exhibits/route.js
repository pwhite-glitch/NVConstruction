import { createClient } from '@supabase/supabase-js'
import { streamedBytesResponse } from '../../../../../lib/stream-response'
import { EXHIBITS_BUCKET, exhibitsPathFromHtml } from '../../../../../lib/subcontract-exhibits'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'

// The subcontract exhibits PDF (Exhibit A proposal + Exhibit B billing schedule, prompt 97)
// that THIS signing link's contract points to, and nothing else. Same token trust as the
// contract HTML itself (GET /api/signing-requests/<token>?html=1):
//   pending / signed -> the exhibits PDF named in the request's own document_html,
//                       only if it is subcontracts/<this request's subcontract>/exhibits-….pdf
//   voided           -> gone
// The storage path always comes from the stored request, never from the caller.
export async function GET(request, { params }) {
  const { token } = params
  if (!token || typeof token !== 'string') return Response.json({ error: 'Not found' }, { status: 404 })
  const { data, error } = await adminSupabase.from('signing_requests')
    .select('id, subcontract_id, status, document_html').eq('token', token).maybeSingle()
  if (error) return Response.json({ error: 'Could not load the exhibits.' }, { status: 500 })
  if (!data || !data.subcontract_id) return Response.json({ error: 'Not found' }, { status: 404 })
  if (data.status !== 'pending' && data.status !== 'signed') return Response.json({ error: 'This signing link is no longer valid.' }, { status: 410 })
  const path = exhibitsPathFromHtml(data.document_html, data.subcontract_id)
  if (!path) return Response.json({ error: 'No exhibits are attached to this contract.' }, { status: 404 })
  const { data: file, error: dlErr } = await adminSupabase.storage.from(EXHIBITS_BUCKET).download(path)
  if (dlErr || !file) return Response.json({ error: 'Could not load the exhibits.' }, { status: 502 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  return streamedBytesResponse(bytes, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="Subcontract-Exhibits.pdf"',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  })
}
