// Client side of the canonical job-document flow (/api/job-docs), shared by the
// commercial job page and the field app (residential uses the same endpoints).
//   upload: POST upload-url → PUT file to the signed URL → POST insert-document
//   open:   POST signed-url (wrap in openFile() from the click for iOS)
//   delete: DELETE ?id=<job_documents id> (server resolves the job, refuses supers)
// Nothing here writes job_documents or the job-documents bucket directly.
// fetchFn must attach the session (authFetch); putFn is the plain fetch used
// for the signed storage upload.
import { safeFileName } from './storage-path'

async function readJson(res) {
  try { return await res.json() } catch { return {} }
}

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
    const urlData = await readJson(urlRes)
    if (!urlRes.ok || !urlData?.signedUrl) return { uploaded: false, error: 'Upload error: ' + (urlData?.error || 'could not get an upload URL') }

    const up = await putFn(urlData.signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
    if (!up.ok) {
      const b = await readJson(up)
      return { uploaded: false, error: 'Upload error: ' + (b?.message || b?.error || `upload failed (${up.status})`) }
    }
    stored = true

    const insRes = await fetchFn('/api/job-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'insert-document', job_id: jobId, storage_path: path, file_name: file.name, category: category || 'other' }),
    })
    const ins = await readJson(insRes)
    if (!insRes.ok || !ins?.ok) {
      return { uploaded: true, error: NOT_SAVED + (ins?.error || `server returned ${insRes.status}`) }
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
    const data = await readJson(res)
    if (!res.ok || !data?.url) return { error: data?.error || `server returned ${res.status}` }
    return { url: data.url }
  } catch (e) {
    return { error: e?.message || 'network error' }
  }
}

// Returns { ok, warning } or { error }.
export async function deleteJobDocument({ fetchFn, id }) {
  if (!id) return { error: 'missing document id' }
  try {
    const res = await fetchFn(`/api/job-docs?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const data = await readJson(res)
    if (!res.ok || !data?.ok) return { error: data?.error || `server returned ${res.status}` }
    return { ok: true, warning: data.warning || null }
  } catch (e) {
    return { error: e?.message || 'network error' }
  }
}
