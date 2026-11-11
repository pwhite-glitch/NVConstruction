// Test helper (prompt 78): mint a real direct-upload receipt for a target, and (optionally)
// declare the uploaded object in the mock storage, exactly as the browser flow would leave it:
// POST /api/file-upload → PUT to Storage → { path, uploadReceipt } on the business route.
// Uses the real lib/file-upload-server issueUpload with a fake signing client; nothing live.
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { issueUpload, validateIssueRequest } = require('../../lib/file-upload-server')

const signer = { storage: { from: () => ({ createSignedUploadUrl: async p => ({ data: { signedUrl: `https://upload/${p}`, token: 't' }, error: null }) }) } }

let seq = 0
const fakeUuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

// Returns { attachment: { path, uploadReceipt }, path, bucket }.
// store: mockState to seed fileMeta in (null = leave the object missing).
async function mintUpload({ target, subject, keyId = null, ctx = {}, name = 'file.pdf', contentType = 'application/pdf', size = 1234, now = Date.now(), store = null, storedSize = size, storedType = contentType }) {
  const v = validateIssueRequest({ target, file_name: name, content_type: contentType, size })
  if (v.error) throw new Error(v.error)
  const out = await issueUpload(signer, { meta: v.meta, subject, keyId, ctx, now, uuid: fakeUuid })
  if (out.status !== 200) throw new Error(out.body.error)
  if (store) store.fileMeta[`${out.body.bucket}/${out.body.path}`] = { size: storedSize, contentType: storedType }
  return { attachment: { path: out.body.path, uploadReceipt: out.body.uploadReceipt }, path: out.body.path, bucket: out.body.bucket }
}

module.exports = { mintUpload }
