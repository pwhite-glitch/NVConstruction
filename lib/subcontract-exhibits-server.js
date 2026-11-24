// Server side of subcontract exhibits (prompt 97, extras prompt 103). SERVER ONLY (service-role
// client passed in). Callers run their own role / job checks first; this only reads the files
// that belong to THIS subcontract (its bid_proposal_url), ITS job (newest 'billing_schedule' job
// document) and the extra exhibits saved on it (generator_fields.exhibits → job_documents rows
// of the same job, path resolved from the DB row, never from a client), builds the merged
// exhibits PDF and stores it under documents/subcontracts/<id>/.
// No storage access is widened: nothing here returns a file to a caller.

import {
  EXHIBIT_A, EXHIBIT_B, EXHIBITS_BUCKET, PROPOSAL_BUCKET, JOB_DOCS_BUCKET, BILLING_SCHEDULE_CATEGORY,
  buildExhibitsPdf, exhibitsPdfPath, exhibitAppendixHtml, fileBaseName,
  sanitizeExhibitList, exhibitFileTypeError, extraExhibitLetter,
} from './subcontract-exhibits'
import { docCategoryLabel } from './job-docs'

// Downloaded source files per merge (the function's memory, not an upload cap).
export const MAX_EXHIBITS_SOURCE_BYTES = 100 * 1024 * 1024
export const EXHIBITS_TOO_LARGE_MESSAGE = 'The exhibits are too large to merge into one PDF (over 100 MB). Remove or shrink an exhibit.'

const inJobFolder = (path, jobId) => !!jobId && String(path || '').toLowerCase().startsWith(String(jobId).toLowerCase() + '/')

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
  if (doc && !inJobFolder(doc.storage_path, jobId)) return { doc: null }
  return { doc }
}

/**
 * The saved extra exhibits of a subcontract, in saved order:
 * [{ id, title, path, name, missing, typeError }]. A row counts only when it is a job document
 * of the subcontract's own job, inside "<job_id>/", and a PDF / image by name.
 */
export async function extraExhibitStatus(admin, sc) {
  const saved = sanitizeExhibitList(sc?.generator_fields?.exhibits) || []
  if (!saved.length) return { extras: [] }
  const ids = saved.map(e => e.job_document_id)
  const { data, error } = await admin.from('job_documents')
    .select('id, job_id, category, storage_path, file_name')
    .in('id', ids).eq('job_id', sc.job_id)
  if (error) return { extras: [], error: 'Could not load the extra exhibits: ' + error.message }
  const byId = new Map((data || []).map(r => [String(r.id).toLowerCase(), r]))
  const extras = saved.map(e => {
    const row = byId.get(e.job_document_id)
    const ok = !!row && row.job_id === sc.job_id && inJobFolder(row.storage_path, sc.job_id)
    const name = ok ? (row.file_name || fileBaseName(row.storage_path)) : ''
    return {
      id: e.job_document_id,
      title: e.title || (row ? docCategoryLabel(row.category) : '') || 'Exhibit',
      path: ok ? row.storage_path : null,
      name,
      missing: !ok,
      typeError: ok ? exhibitFileTypeError(name) : null,
    }
  })
  return { extras }
}

// What is on file: { proposal: { path, name } | null, billing: { path, name, id } | null, extras: [...] }.
export async function exhibitStatus(admin, sc) {
  const proposalPath = String(sc?.bid_proposal_url || '').trim()
  const [b, x] = await Promise.all([latestBillingScheduleDoc(admin, sc?.job_id), extraExhibitStatus(admin, sc)])
  return {
    proposal: proposalPath ? { path: proposalPath, name: fileBaseName(proposalPath) } : null,
    billing: b.doc ? { path: b.doc.storage_path, name: b.doc.file_name || fileBaseName(b.doc.storage_path), id: b.doc.id } : null,
    extras: x.extras,
    error: b.error || null,
    extrasError: x.error || null,
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
 *   sc: { id, job_id, bid_proposal_url, vendor_name, generator_fields }
 *   include: { proposal, billing, extras } — false leaves that exhibit (or all extras) out (the
 *            user chose "Continue anyway"). Missing extras are always skipped.
 *   subtitle: printed under each cover heading (project / sub).
 * Returns { path, included, included_exhibits, notes, unreadable, files, appendix, bytes, error, code }.
 * path null when nothing was included (missing files are skipped, never an empty cover page).
 * A storage failure returns error and no path; the caller decides whether to go on without
 * exhibits. Extras are lettered C, D, … over the included ones; an unreadable one is reported
 * as { key: 'extra:<id>', letter, name }. Over MAX_EXHIBITS_SOURCE_BYTES nothing is stored
 * (error, code 'too_large').
 */
export async function buildAndStoreExhibits(admin, sc, { include = { proposal: true, billing: true, extras: true }, subtitle = '', at = new Date() } = {}) {
  const status = await exhibitStatus(admin, sc)
  const items = []
  const files = { proposal: null, billing: null, extras: [] }
  const unreadable = []
  const empty = extra => ({ path: null, included: [], included_exhibits: [], notes: [], unreadable, files, appendix: '', ...extra })
  if (include?.extras !== false && status.extrasError) return empty({ error: status.extrasError })
  let total = 0
  const tooBig = bytes => { total += bytes?.length || 0; return total > MAX_EXHIBITS_SOURCE_BYTES }

  if (include?.proposal !== false && status.proposal) {
    const bytes = await download(admin, PROPOSAL_BUCKET, status.proposal.path)
    if (tooBig(bytes)) return empty({ error: EXHIBITS_TOO_LARGE_MESSAGE, code: 'too_large' })
    if (bytes?.length) { items.push({ exhibit: EXHIBIT_A, file: { name: status.proposal.name, bytes } }); files.proposal = { name: status.proposal.name } }
    else unreadable.push({ key: 'proposal', letter: 'A', name: status.proposal.name })
  }
  if (include?.billing !== false && status.billing) {
    const bytes = await download(admin, JOB_DOCS_BUCKET, status.billing.path)
    if (tooBig(bytes)) return empty({ error: EXHIBITS_TOO_LARGE_MESSAGE, code: 'too_large' })
    if (bytes?.length) { items.push({ exhibit: EXHIBIT_B, file: { name: status.billing.name, bytes } }); files.billing = { name: status.billing.name } }
    else unreadable.push({ key: 'billing', letter: 'B', name: status.billing.name })
  }
  if (include?.extras !== false) {
    // Letters over the extras that are on file (what the job page shows); the merged PDF is
    // re-lettered over the ones actually read, so it never has a gap.
    const present = status.extras.filter(e => !e.missing && !e.typeError)
    const read = []
    for (let i = 0; i < present.length; i++) {
      const e = present[i]
      const bytes = await download(admin, JOB_DOCS_BUCKET, e.path)
      if (tooBig(bytes)) return empty({ error: EXHIBITS_TOO_LARGE_MESSAGE, code: 'too_large' })
      if (bytes?.length) read.push({ e, bytes })
      else unreadable.push({ key: `extra:${e.id}`, letter: extraExhibitLetter(i), name: e.name })
    }
    read.forEach(({ e, bytes }, i) => {
      const exhibit = { key: `extra:${e.id}`, letter: extraExhibitLetter(i), title: e.title }
      items.push({ exhibit, file: { name: e.name, bytes } })
      files.extras.push({ letter: exhibit.letter, title: exhibit.title, name: e.name })
    })
  }

  const built = await buildExhibitsPdf(items, { subtitle })
  if (!built.bytes) return empty({ error: status.error })
  const path = exhibitsPdfPath(sc.id, at)
  const { error } = await admin.storage.from(EXHIBITS_BUCKET).upload(path, Buffer.from(built.bytes), { contentType: 'application/pdf', upsert: false })
  if (error) return empty({ error: 'Could not store the exhibits PDF: ' + error.message })
  const appendix = exhibitAppendixHtml({ proposal: files.proposal, billing: files.billing, extras: files.extras, exhibitsPath: path })
  // bytes: the stored PDF itself (prompt 98 sends it to SignWell as the second file).
  return {
    path, included: built.included, included_exhibits: built.included_exhibits || [], notes: built.notes,
    unreadable, files, appendix, bytes: built.bytes, error: null,
  }
}

// Newest stored exhibits PDF for a subcontract (by name; names sort by time), or null.
export async function latestExhibitsPath(admin, subcontractId) {
  const folder = `subcontracts/${String(subcontractId).toLowerCase()}`
  const { data } = await admin.storage.from(EXHIBITS_BUCKET).list(folder, { limit: 1, sortBy: { column: 'name', order: 'desc' }, search: 'exhibits-' })
  return data?.[0]?.name ? `${folder}/${data[0].name}` : null
}
