// Client side of the canonical job-document flow (/api/job-docs), shared by the
// commercial job page and the field app (residential uses the same endpoints).
//   upload: POST upload-url → PUT file to the signed URL → POST insert-document
//   open:   POST signed-url (wrap in openFile() from the click for iOS)
//   delete: DELETE ?id=<job_documents id> (server resolves the job, refuses supers)
// Nothing here writes job_documents or the job-documents bucket directly.
// fetchFn must attach the session (authFetch); putFn is the plain fetch used
// for the signed storage upload.
// Responses go through lib/fetch-json.js (status + Content-Type first; a non-JSON or
// malformed reply is an error, never {} success). The storage PUT is the shared signed PUT.
import { safeFileName } from './storage-path'
import { readJsonResponse } from './fetch-json'
import { putToSignedUrl } from './file-upload-client'

export function jobDocPath(jobId, category, fileName, now = Date.now()) {
  return `${jobId}/${category || 'other'}/${now}-${safeFileName(fileName)}`
}

// Returns { uploaded, document, error }. `uploaded` is true once the file is in
// storage, so the caller can refresh even when the record failed.
export async function uploadJobDocument({ fetchFn, putFn, jobId, category, file, now }) {
  if (!jobId || !file) return { uploaded: false, error: 'Upload error: no job or file selected.' }
  const path = jobDocPath(jobId, category, file.name, now)
  const NOT_SAVED = 'File uploaded but the document record was not saved: '
  let stored = false // true once the storage PUT succeeded
  try {
    const urlRes = await fetchFn('/api/job-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upload-url', path }),
    })
    const urlRead = await readJsonResponse(urlRes)
    const urlData = urlRead.data
    if (!urlRead.ok || !urlData?.signedUrl) return { uploaded: false, error: 'Upload error: ' + (urlRead.ok ? 'could not get an upload URL' : urlRead.error) }

    const up = await putToSignedUrl(putFn, urlData.signedUrl, file, file.type || 'application/octet-stream')
    if (!up.ok) return { uploaded: false, error: 'Upload error: ' + up.error }
    stored = true

    const insRes = await fetchFn('/api/job-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'insert-document', job_id: jobId, storage_path: path, file_name: file.name, category: category || 'other' }),
    })
    const insRead = await readJsonResponse(insRes)
    const ins = insRead.data
    if (!insRead.ok || !ins?.ok) {
      return { uploaded: true, error: NOT_SAVED + (insRead.ok ? `server returned ${insRes.status}` : insRead.error) }
    }
    return { uploaded: true, document: ins.document || null }
  } catch (e) {
    // Once the file is in storage, say so — the caller refreshes and shows that only
    // the record save failed (not a generic upload failure).
    if (stored) return { uploaded: true, error: NOT_SAVED + (e?.message || 'network error') }
    return { uploaded: false, error: 'Upload error: ' + (e?.message || 'network error') }
  }
}

// Returns { url } or { error }.
export async function signedJobDocUrl({ fetchFn, path }) {
  if (!path) return { error: 'missing file path' }
  try {
    const res = await fetchFn('/api/job-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signed-url', path }),
    })
    const r = await readJsonResponse(res)
    if (!r.ok || !r.data?.url) return { error: r.ok ? `server returned ${res.status}` : r.error }
    return { url: r.data.url }
  } catch (e) {
    return { error: e?.message || 'network error' }
  }
}

// Returns { ok, warning } or { error }.
export async function deleteJobDocument({ fetchFn, id }) {
  if (!id) return { error: 'missing document id' }
  try {
    const res = await fetchFn(`/api/job-docs?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const r = await readJsonResponse(res)
    if (!r.ok || !r.data?.ok) return { error: r.ok ? `server returned ${res.status}` : r.error }
    return { ok: true, warning: r.data.warning || null }
  } catch (e) {
    return { error: e?.message || 'network error' }
  }
}
