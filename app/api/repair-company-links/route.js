import { createClient } from '@supabase/supabase-js'
import { requireRole } from '../../../lib/server-auth'
import { sameCompany } from '../../../lib/company-name'
import { linkReview, linkSelected, createCompanyForDirectory } from '../../../lib/company-identity'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Fix Company Links (Directory → Portal Access), Owner (principal) / PM only.
// GET ?directory_id=  read-only review list: unlinked sub users with an approved
//   Directory application for this company (by login email), plus who was left
//   out and why. Creates and links nothing.
// POST { company_id, directory_id, profile_ids }  links only the selected people,
//   each re-checked now and written only while still unlinked.
// POST { action: 'create-company', directory_id }  creates the company record for
//   an approved Directory entry when no company with that name exists.
// Subcontracts are never relinked here (no name-based contract cascade).
const ROLES = ['principal', 'pm']
const fail = (status, error) => Response.json({ error }, { status })

export async function GET(request) {
  const auth = await requireRole(request, ROLES)
  if (auth.error) return auth.error
  const directoryId = new URL(request.url).searchParams.get('directory_id')
  if (!directoryId) return fail(400, 'directory_id required')
  try {
    const r = await linkReview(adminSupabase, directoryId)
    if (r.error) return fail(r.status, r.error)
    return Response.json(r.review)
  } catch (e) {
    return fail(500, e.message)
  }
}

export async function POST(request) {
  const auth = await requireRole(request, ROLES)
  if (auth.error) return auth.error
  let body
  try { body = await request.json() } catch { return fail(400, 'Invalid JSON') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Invalid body')
  try {
    if (body.action === 'create-company') {
      if (!body.directory_id) return fail(400, 'directory_id required')
      const r = await createCompanyForDirectory(adminSupabase, body.directory_id, sameCompany)
      if (r.error) return fail(r.status, r.error)
      return Response.json({ ok: true, company: r.company })
    }
    if (body.action) return fail(400, 'Unknown action')
    if ('company_name' in body && !body.company_id) return fail(400, 'Review the people list and submit company_id with the selected profile_ids.')
    const r = await linkSelected(adminSupabase, body)
    if (r.error) return fail(r.status, r.error)
    return Response.json(r.result, { status: r.result.ok ? 200 : 207 })
  } catch (e) {
    return fail(500, e.message)
  }
}
