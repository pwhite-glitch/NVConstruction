import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { denyJob } from '../../../../lib/roles'
import { isUuid } from '../../../../lib/generated-contract'
import { objectPathError } from '../../../../lib/file-upload-server'
import { logChange } from '../../../../lib/change-log'
import { isSubcontractSigned } from '../../../../lib/signing'
import { exhibitFileTypeError, fileBaseName, PROPOSAL_BUCKET, JOB_DOCS_BUCKET, BILLING_SCHEDULE_CATEGORY } from '../../../../lib/subcontract-exhibits'
import { MAX_EXHIBITS_SOURCE_BYTES } from '../../../../lib/subcontract-exhibits-server'
import {
  ATTACH_SOURCES, attachedProposalPath, cleanSourceName, contentTypeFor, isInProposalFolder, proposalFolder, vendorMatches,
} from '../../../../lib/bid-proposal-attach'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BID_DOCS_BUCKET = 'bid-docs'
const SOURCE_LABEL = {
  bid_submission: "the sub's bid",
  job_document: 'job documents',
  proposal_file: "the job's proposal files",
  subcontract: 'another subcontract',
}
const SC_COLS = 'id, job_id, vendor_name, sub_id, company_id, status, signed_at, signed_contract_url, bid_proposal_url'

const fail = (error, status, extra = {}) => Response.json({ error, ...extra }, { status })
const blank = v => !String(v ?? '').trim()
const sameJob = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase()
const insideJobFolder = (path, jobId) => String(path || '').toLowerCase().startsWith(String(jobId).toLowerCase() + '/')
const alreadyExists = e => /already exists|duplicate/i.test(e?.message || '') || String(e?.statusCode || '') === '409'
const notFound = e => /not found|does not exist|no such/i.test(e?.message || '') || String(e?.statusCode || '') === '404'

// Whether a completed e-sign request exists (errors count as signed, same as /api/subcontracts).
async function hasSignedRequest(subcontractId) {
  const { data, error } = await adminSupabase.from('signing_requests').select('id').eq('subcontract_id', subcontractId).eq('status', 'signed').limit(1)
  return !!error || !!data?.length
}

// requirePM → subcontract → job guard. Returns { auth, sc } or { res }.
async function loadSubcontract(request, id) {
  const auth = await requirePM(request)
  if (auth.error) return { res: auth.error }
  if (!isUuid(id)) return { res: fail('subcontract_id required', 400) }
  const { data: sc, error } = await adminSupabase.from('subcontracts').select(SC_COLS).eq('id', id).maybeSingle()
  if (error) return { res: fail(error.message, 500) }
  if (!sc) return { res: fail('Subcontract not found.', 404) }
  if (sc.job_id == null || sc.job_id === '') return { res: fail('Put this subcontract on a job first.', 400) }
  const denied = await denyJob(adminSupabase, auth, sc.job_id)
  if (denied) return { res: denied }
  return { auth, sc }
}

// Resolve the chosen source to { copy: { bucket, key } | null, dest, name } or { res }.
async function resolveSource(sc, source, body) {
  if (source === 'bid_submission') {
    if (!isUuid(body.id)) return { res: fail('id required', 400) }
    const { data: bid, error } = await adminSupabase.from('bid_submissions')
      .select('id, bid_package_id, sub_id, company_name, doc_url').eq('id', body.id).maybeSingle()
    if (error) return { res: fail(error.message, 500) }
    if (!bid) return { res: fail('That bid was not found.', 404) }
    if (blank(bid.doc_url)) return { res: fail('That bid has no file attached.', 400) }
    const { data: pkg, error: pErr } = bid.bid_package_id
      ? await adminSupabase.from('bid_packages').select('id, job_id').eq('id', bid.bid_package_id).maybeSingle()
      : { data: null, error: null }
    if (pErr) return { res: fail(pErr.message, 500) }
    if (!pkg || !sameJob(pkg.job_id, sc.job_id)) return { res: fail("That bid is not on this job's bid packages.", 400) }
    if (!vendorMatches(bid, sc)) return { res: fail('That bid is from a different sub.', 400) }
    if (objectPathError(bid.doc_url)) return { res: fail('That bid file has an invalid path.', 400) }
    const name = cleanSourceName(fileBaseName(bid.doc_url))
    return { copy: { bucket: BID_DOCS_BUCKET, key: bid.doc_url }, name, dest: attachedProposalPath({ jobId: sc.job_id, source, sourceId: bid.id, name }) }
  }
  if (source === 'job_document') {
    if (!isUuid(body.id)) return { res: fail('id required', 400) }
    const { data: doc, error } = await adminSupabase.from('job_documents')
      .select('id, job_id, category, storage_path, file_name').eq('id', body.id).maybeSingle()
    if (error) return { res: fail(error.message, 500) }
    if (!doc) return { res: fail('That document was not found.', 404) }
    if (!sameJob(doc.job_id, sc.job_id) || !insideJobFolder(doc.storage_path, sc.job_id) || objectPathError(doc.storage_path)) {
      return { res: fail('That document is not on this job.', 400) }
    }
    if (doc.category === BILLING_SCHEDULE_CATEGORY) return { res: fail('That is the billing schedule, which is already Exhibit B.', 400) }
    const name = doc.file_name || fileBaseName(doc.storage_path)
    return { copy: { bucket: JOB_DOCS_BUCKET, key: doc.storage_path }, name, dest: attachedProposalPath({ jobId: sc.job_id, source, sourceId: doc.id, name }) }
  }
  if (source === 'proposal_file') {
    const path = body.path
    if (typeof path !== 'string' || !isInProposalFolder(path, sc.job_id)) return { res: fail("That file is not in this job's proposal folder.", 400) }
    if (path !== sc.bid_proposal_url) {
      const { data: users, error } = await adminSupabase.from('subcontracts').select('id, vendor_name').eq('bid_proposal_url', path).neq('id', sc.id).limit(1)
      if (error) return { res: fail(error.message, 500) }
      if (users?.length) return { res: fail(`That file is already Exhibit A for ${users[0].vendor_name || 'another subcontract'}.`, 400, { code: 'in_use' }) }
    }
    return { copy: null, name: fileBaseName(path), dest: path }
  }
  // source === 'subcontract'
  if (!isUuid(body.id)) return { res: fail('id required', 400) }
  if (String(body.id).toLowerCase() === String(sc.id).toLowerCase()) return { res: fail('Pick a different subcontract.', 400) }
  const { data: other, error } = await adminSupabase.from('subcontracts').select('id, job_id, vendor_name, bid_proposal_url').eq('id', body.id).maybeSingle()
  if (error) return { res: fail(error.message, 500) }
  if (!other) return { res: fail('That subcontract was not found.', 404) }
  if (!sameJob(other.job_id, sc.job_id)) return { res: fail('That subcontract is on a different job.', 400) }
  if (!isInProposalFolder(other.bid_proposal_url, sc.job_id)) return { res: fail("That subcontract has no Exhibit A file in this job's proposal folder.", 400) }
  return { copy: null, name: fileBaseName(other.bid_proposal_url), dest: other.bid_proposal_url }
}

// Copy the source into prime-contracts at dest. Server-side copy first; any copy error other
// than "already exists" falls back to download + upload. Returns { copied } or { res }.
async function copyToProposals(src, dest, name) {
  const target = adminSupabase.storage.from(PROPOSAL_BUCKET)
  try {
    const { data: there } = await target.info(dest)
    if (there) return { copied: false } // an earlier attempt copied it but didn't save
    const { error: copyErr } = await adminSupabase.storage.from(src.bucket).copy(src.key, dest, { destinationBucket: PROPOSAL_BUCKET })
    if (!copyErr) return { copied: true }
    if (alreadyExists(copyErr)) return { copied: false }
    console.error('[attach-bid] copy failed, falling back to download + upload', copyErr.message)

    const source = adminSupabase.storage.from(src.bucket)
    const { data: meta, error: infoErr } = await source.info(src.key)
    if (infoErr && notFound(infoErr)) return { res: fail('The bid file is no longer in storage.', 422) }
    const size = Number(meta?.size)
    if (Number.isFinite(size) && size > MAX_EXHIBITS_SOURCE_BYTES) {
      return { res: fail(`The file is too large to attach (over ${Math.round(MAX_EXHIBITS_SOURCE_BYTES / 1024 / 1024)} MB).`, 413) }
    }
    const { data: blob, error: dlErr } = await source.download(src.key)
    if (dlErr || !blob) {
      if (!dlErr || notFound(dlErr)) return { res: fail('The bid file is no longer in storage.', 422) }
      return { res: fail('Could not read the bid file: ' + dlErr.message, 502) }
    }
    const bytes = Buffer.from(await blob.arrayBuffer())
    if (bytes.length > MAX_EXHIBITS_SOURCE_BYTES) {
      return { res: fail(`The file is too large to attach (over ${Math.round(MAX_EXHIBITS_SOURCE_BYTES / 1024 / 1024)} MB).`, 413) }
    }
    const { error: upErr } = await target.upload(dest, bytes, { contentType: contentTypeFor(name), upsert: false })
    if (!upErr) return { copied: true }
    if (alreadyExists(upErr)) return { copied: false }
    return { res: fail('Could not store the file as Exhibit A: ' + upErr.message, 502) }
  } catch (e) {
    return { res: fail('Storage error: ' + (e?.message || String(e)), 502) }
  }
}

// POST /api/subcontracts/attach-bid — make a file this subcontract's Exhibit A (prompt 105).
//   { subcontract_id, source: 'bid_submission'|'job_document'|'proposal_file'|'subcontract', id?, path?, replace? }
// Only fills an EMPTY Exhibit A unless replace: true (409 has_proposal). A signed subcontract
// that already has one can't change it (409 signed). Copies go to a deterministic path, so a
// retry is a no-op (already_linked). Never deletes a storage object.
export async function POST(request) {
  let body
  try { body = await request.json() } catch { body = null }
  const loaded = await loadSubcontract(request, body?.subcontract_id)
  if (loaded.res) return loaded.res
  const { auth, sc } = loaded
  if (!body || typeof body !== 'object') return fail('Invalid JSON body', 400)
  const source = body.source
  if (!ATTACH_SOURCES.includes(source)) return fail('Unknown source.', 400)

  const r = await resolveSource(sc, source, body)
  if (r.res) return r.res
  const typeErr = exhibitFileTypeError(r.name)
  if (typeErr) return fail(typeErr, 400)
  const dest = r.dest
  const old = blank(sc.bid_proposal_url) ? null : sc.bid_proposal_url

  if (old === dest) return Response.json({ ok: true, already_linked: true, path: dest, name: fileBaseName(dest) })
  if (old) {
    if (isSubcontractSigned(sc) || await hasSignedRequest(sc.id)) {
      return fail("This subcontract is signed; Exhibit A can't be changed.", 409, { code: 'signed' })
    }
    if (body.replace !== true) {
      return fail(`This subcontract already has an Exhibit A (${fileBaseName(old)}). Confirm to replace it.`, 409, { code: 'has_proposal', current: fileBaseName(old) })
    }
  }

  let copied = false
  if (r.copy) {
    const c = await copyToProposals(r.copy, dest, r.name)
    if (c.res) return c.res
    copied = c.copied
  } else {
    // Linked in place: the file must really be there.
    try {
      const { data: there, error: infoErr } = await adminSupabase.storage.from(PROPOSAL_BUCKET).info(dest)
      if (!there) {
        if (!infoErr || notFound(infoErr)) return fail('That file is no longer in storage.', 422)
        return fail('Could not check the file: ' + infoErr.message, 502)
      }
    } catch (e) {
      return fail('Storage error: ' + (e?.message || String(e)), 502)
    }
  }

  if (old) {
    const { error } = await adminSupabase.from('subcontracts').update({ bid_proposal_url: dest }).eq('id', sc.id)
    if (error) return fail(error.message, 500)
  } else {
    // Only if still empty: someone may have set one meanwhile (the copied file is left; harmless).
    const { data: rows, error } = await adminSupabase.from('subcontracts').update({ bid_proposal_url: dest })
      .eq('id', sc.id).or('bid_proposal_url.is.null,bid_proposal_url.eq.').select('id')
    if (error) return fail(error.message, 500)
    if (!rows?.length) {
      return fail('This subcontract already has an Exhibit A (set by someone else just now). Reload and confirm to replace it.', 409, { code: 'has_proposal' })
    }
  }

  logChange({
    job_id: sc.job_id, entity_type: 'subcontract', entity_id: sc.id, field_name: 'bid_proposal_url',
    old_value: old, new_value: dest, changed_by: auth.userId,
    note: `Exhibit A ${old ? 'replaced' : 'attached'} from ${SOURCE_LABEL[source]} — ${sc.vendor_name || ''}`,
  })

  return Response.json({ ok: true, path: dest, name: fileBaseName(dest), replaced: !!old, copied })
}

// GET /api/subcontracts/attach-bid?subcontract_id=… — the "Choose Exhibit A" picker's candidates.
// Names and ids only (no file bytes, no signed URLs). A failed lookup is a 500, never a short list.
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const loaded = await loadSubcontract(request, searchParams.get('subcontract_id'))
  if (loaded.res) return loaded.res
  const { sc } = loaded
  const jobId = sc.job_id
  const newest = key => (a, b) => String(b[key] || '').localeCompare(String(a[key] || ''))

  // This sub's bids on this job's bid packages.
  const { data: pkgs, error: pkgErr } = await adminSupabase.from('bid_packages').select('id, title').eq('job_id', jobId)
  if (pkgErr) return fail('Could not load bid packages: ' + pkgErr.message, 500)
  let bids = []
  if (pkgs?.length) {
    const titles = new Map(pkgs.map(p => [p.id, p.title || '']))
    const { data: subs, error } = await adminSupabase.from('bid_submissions')
      .select('id, bid_package_id, sub_id, company_name, status, submitted_at, doc_url').in('bid_package_id', [...titles.keys()])
    if (error) return fail('Could not load bids: ' + error.message, 500)
    bids = (subs || []).filter(b => !blank(b.doc_url) && vendorMatches(b, sc)).sort(newest('submitted_at')).map(b => {
      const name = cleanSourceName(fileBaseName(b.doc_url))
      return { id: b.id, name, package_title: titles.get(b.bid_package_id) || '', company_name: b.company_name || '', status: b.status || null, submitted_at: b.submitted_at || null, type_ok: !exhibitFileTypeError(name) }
    })
  }

  // Files in bid-proposals/<job_id>/ that no subcontract on this job uses.
  const { data: used, error: usedErr } = await adminSupabase.from('subcontracts').select('id, bid_proposal_url').eq('job_id', jobId)
  if (usedErr) return fail('Could not load subcontracts: ' + usedErr.message, 500)
  const usedPaths = new Set((used || []).map(s => s.bid_proposal_url).filter(Boolean))
  if (sc.bid_proposal_url) usedPaths.add(sc.bid_proposal_url)
  let listed
  try {
    const { data, error } = await adminSupabase.storage.from(PROPOSAL_BUCKET).list(proposalFolder(jobId).slice(0, -1), { limit: 1000 })
    if (error) return fail('Could not list proposal files: ' + error.message, 500)
    listed = data || []
  } catch (e) {
    return fail('Could not list proposal files: ' + (e?.message || String(e)), 500)
  }
  const proposal_files = listed
    .filter(f => f && f.name && f.id !== null && !f.name.startsWith('.')) // folders have id null
    .map(f => ({ path: proposalFolder(jobId) + f.name, name: f.name, created_at: f.created_at || null }))
    .filter(f => isInProposalFolder(f.path, jobId) && !usedPaths.has(f.path))
    .sort(newest('created_at'))
    .map(f => ({ ...f, type_ok: !exhibitFileTypeError(f.name) }))

  // Job documents (not the billing schedule, which is Exhibit B).
  const { data: docs, error: docErr } = await adminSupabase.from('job_documents')
    .select('id, job_id, category, storage_path, file_name, uploaded_at').eq('job_id', jobId)
  if (docErr) return fail('Could not load job documents: ' + docErr.message, 500)
  const job_documents = (docs || [])
    .filter(d => insideJobFolder(d.storage_path, jobId) && d.category !== BILLING_SCHEDULE_CATEGORY)
    .sort(newest('uploaded_at'))
    .map(d => {
      const name = d.file_name || fileBaseName(d.storage_path)
      return { id: d.id, name, category: d.category || null, uploaded_at: d.uploaded_at || null, type_ok: !exhibitFileTypeError(name) }
    })

  return Response.json({
    current: blank(sc.bid_proposal_url) ? null : { path: sc.bid_proposal_url, name: fileBaseName(sc.bid_proposal_url) },
    bids, proposal_files, job_documents,
  })
}
