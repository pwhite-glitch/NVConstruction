// Who hears about "Ready to pay" (prompt 104): the admin team (accounts payable).
// Server-only helpers; the pure pieces (parseApEmails, poInvoiceReadyEmail,
// READY_TO_PAY_LINK_PATH, fmtDateUS) import nothing that needs Supabase or Resend.
//
// Recipients:
//   - userIds (bell): every role='admin' profile that is not a Portal Bot. Always from
//     profiles, even when AP_EMAILS is set, because the bell needs profile ids.
//   - emails: AP_EMAILS (comma / semicolon / space list) when it has at least one valid
//     address; otherwise the admin profiles' login emails (auth.users), falling back to
//     profiles.invite_email. No address is hardcoded.
import { escapeHtml, emailWrap } from './email'
import { siteUrl } from './site-url'
import { isBotEmail } from './bot-rules'
import { defaultDueDate } from './po-invoices'

export const NO_AP_EMAIL_MESSAGE = 'No admin email on file for Ready to pay notices.'
export const READY_TO_PAY_LINK_PATH = '/admin?tab=orders&view=ready_to_pay'
export const adminReadyToPayUrl = () => siteUrl(READY_TO_PAY_LINK_PATH)

const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/

// 'A@x.com; b@y.com  junk, a@x.com' → ['a@x.com', 'b@y.com']
export function parseApEmails(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const out = []
  for (const part of raw.split(/[\s,;]+/)) {
    const e = part.trim().toLowerCase()
    if (e && EMAIL_RE.test(e) && !out.includes(e)) out.push(e)
  }
  return out
}

// Never throws. { emails, userIds, source: 'env' | 'admins', error }
export async function apRecipients(db, { env = process.env } = {}) {
  const envEmails = parseApEmails(env?.AP_EMAILS)
  const source = envEmails.length ? 'env' : 'admins'
  try {
    const { data: admins, error } = await db.from('profiles').select('*').eq('role', 'admin')
    if (error) return { emails: [], userIds: [], source, error: `Could not look up the admin team for Ready to pay notices: ${error.message || 'unknown error'}` }

    const people = await Promise.all((admins || []).filter(p => p?.id && !p.is_bot).map(async p => {
      try {
        const { data, error: authErr } = await db.auth.admin.getUserById(p.id)
        if (authErr) return { p, failed: true }
        return { p, authEmail: data?.user?.email || null }
      } catch {
        return { p, failed: true }
      }
    }))

    const userIds = []
    const adminEmails = []
    for (const { p, authEmail, failed } of people) {
      const invite = typeof p.invite_email === 'string' ? p.invite_email.trim() : ''
      if (isBotEmail(authEmail) || isBotEmail(invite)) continue
      userIds.push(p.id)
      if (failed) continue // could not read this person's login: no email for them, others still go
      const email = String(authEmail || invite || '').trim().toLowerCase()
      if (email && EMAIL_RE.test(email) && !adminEmails.includes(email)) adminEmails.push(email)
    }

    const emails = source === 'env' ? envEmails : adminEmails
    return { emails, userIds, source, error: emails.length ? null : NO_AP_EMAIL_MESSAGE }
  } catch (e) {
    return { emails: [], userIds: [], source, error: e?.message || 'Could not look up the admin team for Ready to pay notices.' }
  }
}

// One email to every address. Error text or null; never throws.
export async function sendApEmail(resend, { to, subject, html }) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!list.length) return NO_AP_EMAIL_MESSAGE
  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to: list,
      subject,
      html,
    })
    return error ? (error.message || 'Email failed') : null
  } catch (e) {
    return e?.message || 'Email failed'
  }
}

// '2026-12-01' → '12/01/2026'; anything else → ''
export function fmtDateUS(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''))
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}

export const fmtMoneyUS = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const poInvoiceDueDate = inv => inv?.due_date || defaultDueDate(inv?.invoice_date) || null

// Email to the admin team when a PO invoice is approved → Ready to pay. Pure.
export function poInvoiceReadyEmail({ po, job, inv, approverName }) {
  const vendor = po?.vendor_name || 'Vendor'
  const jobNo = job?.job_number || ''
  const due = fmtDateUS(poInvoiceDueDate(inv)) || '—'
  const row = (label, value, valueStyle = 'color:#f1f1f1') =>
    `<tr><td style="color:#888;padding:4px 12px 4px 0;white-space:nowrap">${label}</td><td style="${valueStyle}">${value}</td></tr>`
  const html = emailWrap(`
    <h2 style="color:#4ade80;margin:0 0 12px;font-size:18px">✓ PO invoice ready to pay</h2>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px">
      ${row('Vendor', `<strong>${escapeHtml(vendor)}</strong>`)}
      ${row('Job', `#${escapeHtml(jobNo)} ${escapeHtml(job?.project_name || '')}`)}
      ${row('PO #', escapeHtml(po?.po_number || '—'))}
      ${row('Invoice #', escapeHtml(inv?.invoice_number || '—'))}
      ${row('Amount', escapeHtml(fmtMoneyUS(inv?.amount)), 'color:#4ade80;font-weight:800;font-family:monospace')}
      ${row('Due date', escapeHtml(due))}
      ${approverName ? row('Approved by', escapeHtml(approverName)) : ''}
    </table>
    <a href="${escapeHtml(adminReadyToPayUrl())}" style="display:inline-block;background:#e8590c;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Open Ready to pay →</a>
  `)
  return { subject: `PO invoice ready to pay — ${vendor} · #${jobNo}`, html }
}
