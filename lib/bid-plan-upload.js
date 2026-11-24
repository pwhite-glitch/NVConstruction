// Bid package plan files from the browser (prompt 106). The bid-plans bucket and the
// bid_plans table have no browser write policies, so everything goes through the
// service-role route /api/bid-plan:
//   upload: upload-url → PUT to the signed URL (plain fetch) → insert
//   open:   signed-url → { url }
//   delete: delete
// fetchFn is our authenticated fetch (authFetch); putFn is plain fetch (Storage URL).
// Every function resolves to { ok, ... } with a short `error` message on failure.
import { fetchJson, jsonInit } from './fetch-json'
import { putToSignedUrl } from './file-upload-client'
import { safeFileName } from './storage-path'

export const BID_PLAN_ENDPOINT = '/api/bid-plan'

// "<bid package id>/<timestamp>_<safe file name>"
export function bidPlanPath(bidId, fileName, now = Date.now()) {
  return `${bidId}/${now}_${safeFileName(fileName)}`
}

const uploadError = msg => (/^Upload (failed|cancelled)/i.test(String(msg || '')) ? msg : `Upload failed: ${msg || 'unknown error'}`)

export async function uploadBidPlan(fetchFn, putFn, bidId, file, now = Date.now) {
  if (!file) return { ok: false, stage: 'file', error: 'Upload failed: no file selected.' }
  const path = bidPlanPath(bidId, file.name, now())
  const urlRes = await fetchJson(fetchFn, BID_PLAN_ENDPOINT, jsonInit('POST', { action: 'upload-url', path }))
  if (!urlRes.ok || !urlRes.data?.signedUrl) {
    return { ok: false, stage: 'url', error: uploadError(urlRes.ok ? 'no upload link returned.' : urlRes.error) }
  }
  const put = await putToSignedUrl(putFn, urlRes.data.signedUrl, file)
  if (!put.ok) return { ok: false, stage: 'put', error: uploadError(put.error) }
  const insertRes = await fetchJson(fetchFn, BID_PLAN_ENDPOINT, jsonInit('POST', {
    action: 'insert', bid_package_id: bidId, file_name: file.name, storage_path: path,
  }))
  if (!insertRes.ok) return { ok: false, stage: 'insert', error: uploadError(insertRes.error) }
  return { ok: true, path }
}

export async function bidPlanSignedUrl(fetchFn, path) {
  const r = await fetchJson(fetchFn, BID_PLAN_ENDPOINT, jsonInit('POST', { action: 'signed-url', path }))
  if (!r.ok) return { ok: false, error: r.error }
  if (!r.data?.url) return { ok: false, error: 'No file link was returned.' }
  return { ok: true, url: r.data.url }
}

export async function deleteBidPlan(fetchFn, path) {
  const r = await fetchJson(fetchFn, BID_PLAN_ENDPOINT, jsonInit('POST', { action: 'delete', path }))
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
