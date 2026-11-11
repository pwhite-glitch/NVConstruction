import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth, isSub } from '../../../lib/server-auth'
import { getSubAccess } from '../../../lib/sub-access'
import { escapeHtml } from '../../../lib/email'
import { todayCentral } from '../../../lib/central-date'
import { isMissingColumnError, signatureDataUrlError } from '../../../lib/lien-waiver-terms'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const centsOf = v => Math.round(Number(v || 0) * 100)
const periodOf = v => (v ? String(v).slice(0, 10) : null)
const same = (q, col, v) => (v === null || v === undefined ? q.is(col, null) : q.eq(col, v))
const CHANGED_ERROR = 'This billing was changed after the waiver was sent. Reload and review the new amount before signing.'

// Sub portal: sign the conditional lien waiver on a billing submission made by
// the caller, or by a teammate on a job the caller sees. Only an approved billing has a
// waiver; the signature is stored with the amount / through date it covers (migration 062)
// in one compare-and-set write, so an edit or a second tab in between can't slip past it.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isSub(auth.role)) return Response.json({ error: 'Sub portal only' }, { status: 403 })
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { submission_id, signer_name, signature } = body || {}
  if (!submission_id || !signer_name)
    return Response.json({ error: 'submission_id and signer_name required' }, { status: 400 })
  const sigErr = signatureDataUrlError(signature)
  if (sigErr) return Response.json({ error: sigErr.error }, { status: sigErr.status })

  const { data: target, error: readErr } = await adminSupabase.from('billing_submissions')
    .select('sub_id, job_id, status, amount_billed, billing_period, lien_waiver_signed_at').eq('id', submission_id).maybeSingle()
  if (readErr) return Response.json({ error: readErr.message }, { status: 500 })
  if (!target) return Response.json({ error: 'Not found' }, { status: 404 })
  if (target.sub_id !== auth.userId) {
    const { members, jobs } = await getSubAccess(auth.userId, auth.email)
    const teammate = members.some(m => m.id === target.sub_id)
    if (!teammate || !jobs.some(j => j.id === target.job_id)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (target.lien_waiver_signed_at) return Response.json({ error: 'Already signed' }, { status: 400 })
  if (target.status !== 'approved') return Response.json({ error: 'This billing is not approved, so there is no waiver to sign.' }, { status: 422 })

  // The client says what it showed the sub; a different stored amount / period means the
  // billing changed after the waiver went out.
  const hasExpAmt = body.expected_amount !== undefined && body.expected_amount !== null && body.expected_amount !== ''
  if (hasExpAmt && centsOf(body.expected_amount) !== centsOf(target.amount_billed)) return Response.json({ error: CHANGED_ERROR }, { status: 409 })
  if ('expected_period' in body && periodOf(body.expected_period) !== periodOf(target.billing_period)) return Response.json({ error: CHANGED_ERROR }, { status: 409 })

  const signedAt = new Date().toISOString()
  const terms = {
    lien_waiver_amount: target.amount_billed ?? 0,
    // No billing period: the waiver shows the signing date, so that is what was signed.
    lien_waiver_through: periodOf(target.billing_period) || todayCentral(),
  }
  const sig = {
    lien_waiver_signed_at: signedAt,
    lien_waiver_signer_name: signer_name,
    lien_waiver_signature: signature || null,
  }
  const write = patch => same(same(
    adminSupabase.from('billing_submissions').update(patch).eq('id', submission_id)
      .is('lien_waiver_signed_at', null).eq('status', 'approved'),
    'amount_billed', target.amount_billed), 'billing_period', target.billing_period).select('id')

  let { data: rows, error } = await write({ ...sig, ...terms })
  // Migration 062 not applied yet: the signature still saves (legacy, no signed terms).
  if (error && isMissingColumnError(error)) ({ data: rows, error } = await write(sig))
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!rows?.length) return Response.json({ error: 'Already signed or changed — reload.' }, { status: 409 })

  // Notify PM
  const { data: sub } = await adminSupabase
    .from('billing_submissions')
    .select('*, jobs(job_number, project_name)')
    .eq('id', submission_id)
    .single()

  if (sub) {
    const pmEmail = process.env.PM_EMAIL || 'management@nvim.co'
    const amt = parseFloat(target.amount_billed || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to: pmEmail,
      subject: `Lien waiver signed — ${sub.company_name} · #${sub.jobs?.job_number}`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
        <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0 0 8px">✓ Lien waiver signed</p>
        <p style="color:#aaa;margin:0 0 4px"><strong style="color:#f1f1f1">${escapeHtml(sub.company_name)}</strong> has signed their conditional lien waiver for <strong style="color:#f1f1f1">#${escapeHtml(sub.jobs?.job_number)} — ${escapeHtml(sub.jobs?.project_name)}</strong>.</p>
        <p style="font-size:24px;font-weight:800;color:#e8590c;margin:16px 0">${escapeHtml(amt)}</p>
        <p style="color:#666;font-size:13px">Signed by: ${escapeHtml(signer_name)}<br/>Date: ${new Date().toLocaleDateString()}</p>
      </div>`,
    }).catch(() => {})
  }

  return Response.json({ ok: true })
}
