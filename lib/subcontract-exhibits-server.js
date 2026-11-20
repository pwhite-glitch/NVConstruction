// Server side of subcontract exhibits (prompt 97). SERVER ONLY (service-role client passed in).
// Callers run their own role / job checks first; this only reads the two files that belong to
// THIS subcontract (its bid_proposal_url) and ITS job (newest 'billing_schedule' job document),
// builds the merged exhibits PDF and stores it under documents/subcontracts/<id>/.
// No storage access is widened: nothing here returns a file to a caller.

import {
  EXHIBIT_A, EXHIBIT_B, EXHIBITS_BUCKET, PROPOSAL_BUCKET, JOB_DOCS_BUCKET, BILLING_SCHEDULE_CATEGORY,
  buildExhibitsPdf, exhibitsPdfPath, exhibitAppendixHtml, fileBaseName,
} from './subcontract-exhibits'

// Newest billing schedule job document for a job, or null. { doc, error }.
export async function latestBillingScheduleDoc(admin, jobId) {
  if (!jobId) return { doc: null }
  const { data, error } = await admin.from('job_documents')
    .select('id, job_id, storage_path, file_name, uploaded_at')
    .eq('job_id', jobId).eq('category', BILLING_SCHEDULE_CATEGORY)
    .order('uploaded_at', { ascending: false }).limit(1)
  if (error) return { doc: null, error: error.message }
  const doc = data?.[0] || null
  // Only a file inside this job's folder counts.
  if (doc && !String(doc.storage_path || '').toLowerCase().startsWith(String(jobId).toLowerCase() + '/')) return { doc: null }
  return { doc }
}

// What is on file: { proposal: { path, name } | null, billing: { path, name, id } | null }.
export async function exhibitStatus(admin, sc) {
  const proposalPath = String(sc?.bid_proposal_url || '').trim()
  const b = await latestBillingScheduleDoc(admin, sc?.job_id)
  return {
    proposal: proposalPath ? { path: proposalPath, name: fileBaseName(proposalPath) } : null,
    billing: b.doc ? { path: b.doc.storage_path, name: b.doc.file_name || fileBaseName(b.doc.storage_path), id: b.doc.id } : null,
    error: b.error || null,
  }
}

async function download(admin, bucket, path) {
  try {
    const { data, error } = await admin.storage.from(bucket).download(path)
    if (error || !data) return null
    return new Uint8Array(await data.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Build and store the exhibits PDF for a subcontract.
 *   sc: { id, job_id, bid_proposal_url, vendor_name }
 *   include: { proposal, billing } — false leaves that exhibit out (the user chose "Continue anyway").
 *   subtitle: printed under each cover heading (project / sub).
 * Returns { path, included, notes, files, appendix, error }. path null when nothing was included
 * (missing files are skipped, never an empty cover page). A storage failure returns error and
 * no path; the caller decides whether to go on without exhibits.
 */
export async function buildAndStoreExhibits(admin, sc, { include = { proposal: true, billing: true }, subtitle = '', at = new Date() } = {}) {
  const status = await exhibitStatus(admin, sc)
  const items = []
  const files = { proposal: null, billing: null }
  const unreadable = []
  if (include?.proposal !== false && status.proposal) {
    const bytes = await download(admin, PROPOSAL_BUCKET, status.proposal.path)
    if (bytes?.length) { items.push({ exhibit: EXHIBIT_A, file: { name: status.proposal.name, bytes } }); files.proposal = { name: status.proposal.name } }
    else unreadable.push({ key: 'proposal', name: status.proposal.name })
  }
  if (include?.billing !== false && status.billing) {
    const bytes = await download(admin, JOB_DOCS_BUCKET, status.billing.path)
    if (bytes?.length) { items.push({ exhibit: EXHIBIT_B, file: { name: status.billing.name, bytes } }); files.billing = { name: status.billing.name } }
    else unreadable.push({ key: 'billing', name: status.billing.name })
  }
  const built = await buildExhibitsPdf(items, { subtitle })
  if (!built.bytes) return { path: null, included: [], notes: [], unreadable, files, appendix: '', error: status.error }
  const path = exhibitsPdfPath(sc.id, at)
  const { error } = await admin.storage.from(EXHIBITS_BUCKET).upload(path, Buffer.from(built.bytes), { contentType: 'application/pdf', upsert: false })
  if (error) return { path: null, included: [], notes: [], unreadable, files, appendix: '', error: 'Could not store the exhibits PDF: ' + error.message }
  const appendix = exhibitAppendixHtml({ proposal: files.proposal, billing: files.billing, exhibitsPath: path })
  return { path, included: built.included, notes: built.notes, unreadable, files, appendix, error: null }
}

// Newest stored exhibits PDF for a subcontract (by name; names sort by time), or null.
export async function latestExhibitsPath(admin, subcontractId) {
  const folder = `subcontracts/${String(subcontractId).toLowerCase()}`
  const { data } = await admin.storage.from(EXHIBITS_BUCKET).list(folder, { limit: 1, sortBy: { column: 'name', order: 'desc' }, search: 'exhibits-' })
  return data?.[0]?.name ? `${folder}/${data[0].name}` : null
}
