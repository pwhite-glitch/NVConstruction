import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth, isPM, isSub } from '../../../lib/server-auth'
import { emailWrap, escapeHtml } from '../../../lib/email'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>'
const PM_EMAIL = process.env.PM_EMAIL || 'pwhite@nvim.co'
const MAX_RECIPIENTS = 20
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

// POST — signed-in users only.
// Office staff (pm/apm/super/admin): { to, subject, html } — composed emails to subs and bidders.
// Sub users: { type: 'bid_submitted', bid_package_id } only. The server finds the
//   caller's own bid and writes the email to the office; subs can't set
//   recipients, subject or HTML. (Billing-submitted is sent by /api/sub-portal/billing.)
// Everyone else is refused.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()

    if (body.type === 'bid_submitted') {
      if (!isSub(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      return await sendBidSubmitted(auth, body.bid_package_id)
    }

    if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { to, subject, html } = body
    if (!to || !subject || !html) {
      return Response.json({ error: 'Missing fields' }, { status: 400 })
    }
    const recipients = (Array.isArray(to) ? to : [to]).map(e => String(e).trim()).filter(Boolean)
    if (!recipients.length || recipients.length > MAX_RECIPIENTS || !recipients.every(e => EMAIL_RE.test(e))) {
      return Response.json({ error: `to must be 1–${MAX_RECIPIENTS} valid email addresses` }, { status: 400 })
    }
    await resend.emails.send({ from: FROM, to: recipients, subject: String(subject).slice(0, 300), html })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

async function sendBidSubmitted(auth, bidPackageId) {
  if (!bidPackageId) return Response.json({ error: 'bid_package_id required' }, { status: 400 })
  const [{ data: bid }, { data: pkg }] = await Promise.all([
    adminSupabase.from('bid_submissions').select('company_name, sub_email, amount, notes, doc_url')
      .eq('bid_package_id', bidPackageId).eq('sub_id', auth.userId).maybeSingle(),
    adminSupabase.from('bid_packages').select('title').eq('id', bidPackageId).maybeSingle(),
  ])
  if (!bid) return Response.json({ error: 'No bid from you on this package' }, { status: 404 })

  const who = escapeHtml(bid.company_name || bid.sub_email || auth.email)
  const amount = parseFloat(bid.amount || 0).toLocaleString()
  await resend.emails.send({
    from: FROM,
    to: PM_EMAIL,
    subject: `Bid received — ${bid.company_name || bid.sub_email || auth.email}`,
    html: emailWrap(`
      <h2 style="color:#f1f1f1;margin:0 0 1rem">New bid submitted</h2>
      <p style="color:#aaa;margin:0 0 6px"><strong style="color:#f1f1f1">${who}</strong> submitted a bid for <strong style="color:#f1f1f1">${escapeHtml(pkg?.title || 'Bid Package')}</strong>.</p>
      <p style="font-size:28px;font-weight:800;color:#e8590c;margin:1rem 0">$${amount}</p>
      ${bid.notes ? `<p style="color:#888;font-size:13px">${escapeHtml(bid.notes)}</p>` : ''}
      ${bid.doc_url ? `<p style="color:#888;font-size:13px">📎 Estimate attached</p>` : ''}
    `),
  })
  return Response.json({ ok: true })
}
