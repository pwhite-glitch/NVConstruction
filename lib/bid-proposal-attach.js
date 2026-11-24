// Prompt 105: the sub's bid PDF becomes Exhibit A.
// Pure helpers (no Supabase) for /api/subcontracts/attach-bid. Exhibit A is
// subcontracts.bid_proposal_url, a path in the 'prime-contracts' bucket under
// bid-proposals/<job_id>/. A bid PDF (bucket 'bid-docs') or a job document (bucket
// 'job-documents') is COPIED there under a deterministic name, so a retry never makes a
// second copy and two sources never collide. Files already in the job's proposal folder
// (an unlinked upload, or another subcontract's proposal) are linked in place.

import { objectPathError } from './file-upload-server'
import { fileExtension, fileBaseName } from './subcontract-exhibits'

export const PROPOSAL_PREFIX = 'bid-proposals'
export const ATTACH_SOURCES = ['bid_submission', 'job_document', 'proposal_file', 'subcontract']
export const MAX_PROPOSAL_NAME = 100

const SOURCE_TAG = { bid_submission: 'bid', job_document: 'doc' }

export const proposalFolder = jobId => `${PROPOSAL_PREFIX}/${jobId}/`

const UUID_MS_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+-/i
const MANUAL_PREFIX = /^manual-\d+-/i
const DIGITS_PREFIX = /^\d+-/

/**
 * The original file name of a stored object: base name without the upload prefixes
 * "<sub uuid>-<ms>-" (sub portal bid), "manual-<ms>-" (office manual bid) or, when neither
 * is there, a leading "<digits>-". Keeps the extension. Never returns '' for a non-empty name.
 */
export function cleanSourceName(name) {
  const base = fileBaseName(name)
  let out = base
  if (UUID_MS_PREFIX.test(out)) out = out.replace(UUID_MS_PREFIX, '')
  else if (MANUAL_PREFIX.test(out)) out = out.replace(MANUAL_PREFIX, '')
  else out = out.replace(DIGITS_PREFIX, '')
  return out && !out.startsWith('.') ? out : base
}

/**
 * Storage-safe file name: [A-Za-z0-9._-] only, no repeated '-', no '-'/'.' at the ends,
 * lower-case extension, at most MAX_PROPOSAL_NAME chars; an empty stem becomes 'proposal'.
 */
export function safeProposalFileName(name) {
  const clean = cleanSourceName(name).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const ext = fileExtension(clean).replace(/[^a-z0-9]/g, '')
  const rawStem = ext ? clean.slice(0, clean.lastIndexOf('.')) : clean
  const tidy = s => s.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-{2,}/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '')
  const suffix = ext ? `.${ext}` : ''
  let stem = tidy(rawStem).slice(0, MAX_PROPOSAL_NAME - suffix.length)
  stem = stem.replace(/[-.]+$/g, '')
  return `${stem || 'proposal'}${suffix}`
}

/**
 * Deterministic Exhibit A destination for a copied source:
 *   bid_submission → bid-proposals/<job_id>/bid-<sourceId>-<safe name>
 *   job_document   → bid-proposals/<job_id>/doc-<sourceId>-<safe name>
 * Throws for other sources (those are linked in place, not copied).
 */
export function attachedProposalPath({ jobId, source, sourceId, name }) {
  const tag = SOURCE_TAG[source]
  if (!tag) throw new Error(`no copy destination for source "${source}"`)
  if (jobId == null || String(jobId) === '' || !sourceId) throw new Error('jobId and sourceId are required')
  return `${proposalFolder(jobId)}${tag}-${String(sourceId).toLowerCase()}-${safeProposalFileName(name)}`
}

/** True only for a file directly inside bid-proposals/<jobId>/ (job id case-insensitive). */
export function isInProposalFolder(path, jobId) {
  if (objectPathError(path) || jobId == null || String(jobId) === '') return false
  const segs = path.split('/')
  return segs.length === 3 && segs[0] === PROPOSAL_PREFIX && segs[1].toLowerCase() === String(jobId).toLowerCase() && !!segs[2]
}

const CONTENT_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
export const contentTypeFor = name => CONTENT_TYPES[fileExtension(name)] || 'application/octet-stream'

const normName = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Whether a bid_submissions row is from the subcontract's sub (sub_id, else company name). */
export function vendorMatches(submission, sc) {
  if (!submission || !sc) return false
  if (sc.sub_id && submission.sub_id && submission.sub_id === sc.sub_id) return true
  const a = normName(submission.company_name)
  return !!a && a === normName(sc.vendor_name)
}
