// Submittal saves from the job page (prompt 78). Files upload straight to Storage
// (target submittal-doc); /api/submittals gets attachments: [{ path, uploadReceipt }].
// Nothing here resets or closes a form unless the server confirmed the save.
import { fetchJson, jsonInit } from './fetch-json'
import { uploadAll, forgetUpload, isUploadReceiptError } from './file-upload-client'

const asList = files => (files ? Array.from(files).filter(Boolean) : [])

// New submittal with optional files. Returns a fetch-json result + stage ('upload' | 'save').
export async function createSubmittal({ fetchFn, putFn, jobId, files, payload }) {
  const list = asList(files)
  const up = await uploadAll({ fetchFn, putFn, files: list, target: 'submittal-doc', context: { job_id: jobId } })
  if (!up.ok) return { ok: false, stage: 'upload', status: 0, data: null, error: up.error }
  const r = await fetchJson(fetchFn, '/api/submittals', jsonInit('POST', up.attachments.length ? { ...payload, attachments: up.attachments } : payload))
  if (!r.ok && isUploadReceiptError(r)) list.forEach(forgetUpload)
  return { ...r, stage: 'save' }
}

// Add files to an existing submittal (PATCH). The receipt is bound to that submittal's stored job.
export async function addSubmittalFiles({ fetchFn, putFn, jobId, submittalId, files }) {
  const list = asList(files)
  if (!list.length) return { ok: false, stage: 'upload', status: 0, data: null, error: 'Choose at least one file.' }
  const up = await uploadAll({ fetchFn, putFn, files: list, target: 'submittal-doc', context: { job_id: jobId, record_id: submittalId } })
  if (!up.ok) return { ok: false, stage: 'upload', status: 0, data: null, error: up.error }
  const r = await fetchJson(fetchFn, '/api/submittals', jsonInit('PATCH', { id: submittalId, attachments: up.attachments }))
  if (!r.ok && isUploadReceiptError(r)) list.forEach(forgetUpload)
  return { ...r, stage: 'save' }
}

// Form flow for "Add submittal": busy on, save, and ONLY on a confirmed save reset + close +
// reload. A failure shows the error and leaves the entered fields and files untouched.
// Repeated clicks while busy are ignored. Busy always clears.
export async function runSubmittalSave({ busy, setBusy, setError, save, onSaved, reload }) {
  if (busy) return { ok: false, skipped: true }
  setBusy(true)
  setError('')
  try {
    const r = await save()
    if (!r.ok) {
      setError((r.stage === 'upload' ? 'File upload failed: ' : 'Submittal not saved: ') + r.error)
      return r
    }
    onSaved()
    if (reload) await reload()
    return r
  } catch (e) {
    setError('Submittal not saved: ' + (e?.message || 'unexpected error'))
    return { ok: false, error: e?.message }
  } finally {
    setBusy(false)
  }
}
