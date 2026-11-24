import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { isUuid } from '../../../lib/generated-contract'
import { privateJson } from '../../../lib/file-upload-server'
import { EXHIBITS_BUCKET, exhibitsPathFromHtml } from '../../../lib/subcontract-exhibits'
import { exhibitStatus, buildAndStoreExhibits, latestExhibitsPath } from '../../../lib/subcontract-exhibits-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'
// Merging reads every exhibit from Storage server-side (prompt 103: up to 10 extras).
export const maxDuration = 60

// Subcontract exhibits (prompt 97): Exhibit A = the sub's bid proposal, Exhibit B = the job's
// billing schedule document, C, D, … = extra exhibits saved on the subcontract (prompt 103).
// Same guard as /api/subcontract-contract (PM roles + job access).
//   GET  ?subcontract_id=&kind=status   what is on file (for the "missing exhibit" warning)
//   GET  ?subcontract_id=&kind=latest   short signed link to the newest exhibits PDF
//   GET  ?subcontract_id=&kind=signed   short signed link to the exhibits PDF of the signed e-sign copy
//   POST { subcontract_id, include: { proposal, billing, extras } }
//        builds + stores the merged exhibits PDF; returns { path, url, included, included_exhibits, notes, appendix }
// Only files that belong to this subcontract / its job are ever read or signed.

async function loadSubcontract(auth, id) {
  if (!isUuid(id)) return { error: privateJson({ error: 'subcontract_id required' }, 400) }
  const { data: sc, error } = await adminSupabase.from('subcontracts').select('id, job_id, vendor_name, bid_proposal_url, generator_fields').eq('id', id).maybeSingle()
  if (error) return { error: privateJson({ error: error.message }, 500) }
  if (!sc) return { error: privateJson({ error: 'Subcontract not found.' }, 404) }
  const denied = await denyJob(adminSupabase, auth, sc.job_id)
  if (denied) return { error: denied }
  return { sc }
}

async function signedLink(path) {
  const { data, error } = await adminSupabase.storage.from(EXHIBITS_BUCKET).createSignedUrl(path, 300)
  return error || !data?.signedUrl ? null : data.signedUrl
}

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const r = await loadSubcontract(auth, searchParams.get('subcontract_id'))
  if (r.error) return r.error
  const kind = searchParams.get('kind') || 'status'

  if (kind === 'status') {
    const st = await exhibitStatus(adminSupabase, r.sc)
    return privateJson({
      proposal: st.proposal ? { name: st.proposal.name } : null,
      billing: st.billing ? { name: st.billing.name } : null,
      extras: (st.extras || []).map(e => ({ title: e.title, name: e.name, missing: !!e.missing })),
      warning: st.error || st.extrasError || null,
    })
  }

  let path = null
  if (kind === 'latest') {
    path = await latestExhibitsPath(adminSupabase, r.sc.id)
  } else if (kind === 'signed') {
    const { data, error } = await adminSupabase.from('signing_requests').select('document_html')
      .eq('subcontract_id', r.sc.id).eq('status', 'signed').order('signed_at', { ascending: false }).limit(1)
    if (error) return privateJson({ error: error.message }, 500)
    path = exhibitsPathFromHtml(data?.[0]?.document_html, r.sc.id)
  } else {
    return privateJson({ error: 'kind must be status, latest or signed' }, 400)
  }
  if (!path) return privateJson({ error: 'No exhibits PDF on file for this subcontract.' }, 404)
  const url = await signedLink(path)
  if (!url) return privateJson({ error: 'Could not load the exhibits PDF.' }, 500)
  return privateJson({ url, path })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  let body
  try { body = await request.json() } catch { return privateJson({ error: 'Invalid JSON body' }, 400) }
  const r = await loadSubcontract(auth, body?.subcontract_id)
  if (r.error) return r.error
  const include = { proposal: body?.include?.proposal !== false, billing: body?.include?.billing !== false, extras: body?.include?.extras !== false }
  const subtitle = String(body?.subtitle || r.sc.vendor_name || '').slice(0, 200)
  const out = await buildAndStoreExhibits(adminSupabase, r.sc, { include, subtitle })
  if (out.error && !out.path) return privateJson({ error: out.error, ...(out.code ? { code: out.code } : {}) }, out.code === 'too_large' ? 413 : 500)
  const url = out.path ? await signedLink(out.path) : null
  return privateJson({ path: out.path, url, included: out.included, included_exhibits: out.included_exhibits || [], notes: out.notes, unreadable: out.unreadable, appendix: out.appendix })
}
