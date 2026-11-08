import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requirePM } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { loadWaiverSubmission, sendLienWaiver } from '../../../lib/lien-waiver'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

// POST { submission_id, resend? } — email the conditional lien waiver for an approved billing.
// Approving through /api/billing-entry already sends it, so without `resend: true` a billing
// whose waiver was already sent (or signed) is a no-op (no second email to the sub).
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const submission_id = body?.submission_id
  if (!submission_id) return Response.json({ error: 'submission_id required' }, { status: 400 })

  const { sub, error: subErr } = await loadWaiverSubmission(adminSupabase, submission_id)
  if (subErr || !sub) return Response.json({ error: 'Submission not found' }, { status: 404 })
  const denied = await denyJob(adminSupabase, auth, sub.job_id)
  if (denied) return denied

  const out = await sendLienWaiver({ db: adminSupabase, resend, submissionId: submission_id, sub, resendRequested: body.resend === true })
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status || 500 })
  return Response.json({ ok: true, ...(out.skipped ? { skipped: out.skipped } : {}), sent_at: out.sent_at || null, ...(out.warning ? { warning: out.warning } : {}) })
}
