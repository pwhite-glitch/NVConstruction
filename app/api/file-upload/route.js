import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { validateIssueRequest, issueUpload, privateJson, rejectMultipart } from '../../../lib/file-upload-server'
import { ISSUE_GUARDS } from '../../../lib/upload-guards'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST /api/file-upload — issue a signed direct-upload URL (prompt 78).
// Body (JSON, small): { target, job_id?, record_id?, vehicle_id?, order_id?, category?,
//                       file_name, content_type, size }
// → { bucket, path, signedUrl, uploadReceipt, expires_at }
// The target decides the bucket and the server builds the path. The target's own guard
// (lib/upload-guards.js) runs first, against stored rows; nothing is signed when it fails.
// The browser then PUTs the file to signedUrl and sends { path, uploadReceipt } to the
// business route, which checks everything again before recording it.
const ALLOWED_KEYS = new Set(['target', 'job_id', 'record_id', 'vehicle_id', 'order_id', 'category', 'file_name', 'content_type', 'size'])
const ID_KEYS = ['job_id', 'record_id', 'vehicle_id', 'order_id', 'category']

export async function POST(request) {
  const tooBig = rejectMultipart(request)
  if (tooBig) return tooBig
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return privateJson({ error: 'Invalid JSON body' }, 400) }
  const v = validateIssueRequest(body, { allowedTargets: Object.keys(ISSUE_GUARDS) })
  if (v.error) return privateJson({ error: v.error }, 400)
  const extra = Object.keys(body).find(k => !ALLOWED_KEYS.has(k))
  if (extra) return privateJson({ error: `Unexpected field "${extra}".` }, 400)
  for (const k of ID_KEYS) {
    if (body[k] !== undefined && body[k] !== null && (typeof body[k] !== 'string' || body[k].length > 64)) {
      return privateJson({ error: `${k} must be a short string.` }, 400)
    }
  }

  try {
    const guard = await ISSUE_GUARDS[v.meta.target](adminSupabase, auth, body, v.meta)
    if (guard.error) return guard.error
    const out = await issueUpload(adminSupabase, { meta: v.meta, subject: auth.userId, ctx: guard.ctx })
    return privateJson(out.body, out.status)
  } catch (e) {
    return privateJson({ error: e?.message || 'Could not start the upload.' }, 500)
  }
}
