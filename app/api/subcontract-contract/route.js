import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { CONTRACT_BUCKET, isUuid, saveGeneratedContract, latestGeneratedContractPath } from '../../../lib/generated-contract'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Save a copy of a contract generated from the job page ("Edit & Print Contract")
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { subcontract_id, html } = await request.json()
    if (!isUuid(subcontract_id) || !html) return Response.json({ error: 'subcontract_id and html required' }, { status: 400 })
    const { data: sc } = await adminSupabase.from('subcontracts').select('id').eq('id', subcontract_id).maybeSingle()
    if (!sc) return Response.json({ error: 'Subcontract not found' }, { status: 404 })
    const saved = await saveGeneratedContract(adminSupabase, { subcontractId: subcontract_id, html, userId: auth.userId })
    return Response.json({ data: saved })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Return a stored contract's HTML so the page can show it (Supabase may serve .html as plain text).
// kind=generated: last generated copy. kind=signed: the e-signed copy in signed_contract_url.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const subcontract_id = searchParams.get('subcontract_id')
  const kind = searchParams.get('kind') || 'generated'
  if (!isUuid(subcontract_id)) return Response.json({ error: 'subcontract_id required' }, { status: 400 })

  let path = null
  if (kind === 'signed') {
    const { data } = await adminSupabase.from('subcontracts').select('signed_contract_url').eq('id', subcontract_id).maybeSingle()
    path = data?.signed_contract_url || null
    if (path && !path.toLowerCase().endsWith('.html')) return Response.json({ error: 'Signed contract is not an HTML document' }, { status: 400 })
  } else {
    // Errors if migration 031 isn't applied yet; fall back to the newest file in storage
    const { data, error } = await adminSupabase.from('subcontracts').select('generated_contract_path').eq('id', subcontract_id).maybeSingle()
    path = (!error && data?.generated_contract_path) || await latestGeneratedContractPath(adminSupabase, subcontract_id)
  }
  if (!path) return Response.json({ error: 'No stored contract found' }, { status: 404 })

  const { data: file, error: dlErr } = await adminSupabase.storage.from(CONTRACT_BUCKET).download(path)
  if (dlErr || !file) return Response.json({ error: 'Could not load the stored contract' }, { status: 500 })
  return Response.json({ html: await file.text(), path })
}
