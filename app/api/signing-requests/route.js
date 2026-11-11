import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { getSubContracts } from '../../../lib/sub-access'
import { isUuid, saveGeneratedContract, CONTRACT_BUCKET } from '../../../lib/generated-contract'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { escapeHtml } from '../../../lib/email'
import { isSubcontractSigned } from '../../../lib/signing'
import { getSiteUrl } from '../../../lib/site-url'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const logoSrc = () => `${getSiteUrl()}/logo.png`

// Small inline document_html is still accepted for compatibility, bounded well below the
// platform request cap. The job page stages the HTML with a direct upload instead
// (POST /api/file-upload, target signing-html → documents/signing-drafts/<job>/<user>/<uuid>.html)
// and sends document_attachment: { path, uploadReceipt }; only that exact, verified object is read.
const MAX_INLINE_SIGNING_HTML = 512 * 1024
const SIGNING_ROW_COLS = 'id, token, job_id, subcontract_id, signer_email, signer_name, document_title, status, created_at'

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const multipart = rejectMultipart(request)
  if (multipart) return multipart

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { job_id, subcontract_id, signer_email, signer_name, document_html: inlineHtml, document_title, document_attachment } = body || {}
  const inline = inlineFileContentError(body || {}, { except: ['document_html'] })
  if (inline) return Response.json({ error: inline }, { status: 400 })
  // signer_name is the person who will sign (not the company); never filled in for them.
  const signerName = typeof signer_name === 'string' ? signer_name.trim() : ''
  const hasAttachment = document_attachment !== undefined && document_attachment !== null
  if (!job_id || !signer_email || !(inlineHtml || hasAttachment) || !signerName) {
    return Response.json({ error: 'job_id, signer_email, signer_name, and document_html are required' }, { status: 400 })
  }
  if (inlineHtml && hasAttachment) return Response.json({ error: 'Send document_html or document_attachment, not both.' }, { status: 400 })
  if (inlineHtml && (typeof inlineHtml !== 'string' || inlineHtml.length > MAX_INLINE_SIGNING_HTML)) {
    return Response.json({ error: 'This document is too large to send inline. Upload it with document_attachment.', code: 'direct_upload_required' }, { status: 413 })
  }
  const denied = await denyJob(adminSupabase, auth, job_id) ||
    (subcontract_id ? await denyJobOf(adminSupabase, auth, 'subcontracts', subcontract_id) : null)
  if (denied) return denied
  if (subcontract_id) {
    const { data: sc, error: scErr } = await adminSupabase.from('subcontracts').select('id, job_id, status, signed_at, signed_contract_url').eq('id', subcontract_id).maybeSingle()
    if (scErr) return Response.json({ error: scErr.message }, { status: 500 })
    if (!sc) return Response.json({ error: 'Subcontract not found.' }, { status: 404 })
    if (sc.job_id !== job_id) return Response.json({ error: 'That subcontract is on a different job.' }, { status: 400 })
    if (isSubcontractSigned(sc)) return Response.json({ error: 'This subcontract is already signed.' }, { status: 409 })
  }

  let document_html = inlineHtml
  if (hasAttachment) {
    const v = await verifyAttachment(adminSupabase, document_attachment, { target: 'signing-html', subject: auth.userId, ctx: { job: job_id, rec: subcontract_id || null, user: auth.userId } })
    if (!v.ok) return attachmentErrorResponse(v)
    const { data: file, error: dlErr } = await adminSupabase.storage.from(CONTRACT_BUCKET).download(v.path)
    if (dlErr || !file) return Response.json({ error: 'Could not read the staged document. Try again.' }, { status: 502 })
    document_html = new TextDecoder().decode(await file.arrayBuffer())
    if (!document_html) return Response.json({ error: 'The staged document is empty.' }, { status: 400 })
  }

  const { data: row, error: insertErr } = await adminSupabase
    .from('signing_requests')
    .insert({
      job_id,
      subcontract_id: subcontract_id || null,
      signer_email: signer_email.trim().toLowerCase(),
      signer_name: signerName,
      document_html,
      document_title: document_title || null,
      created_by: auth.userId,  // always from verified session
    })
    // Small metadata only: the document itself is not echoed back.
    .select(SIGNING_ROW_COLS)
    .single()

  if (insertErr) return Response.json({ error: insertErr.message }, { status: 500 })
  // Echo only the small metadata columns (never the document body).
  const rowMeta = Object.fromEntries(SIGNING_ROW_COLS.split(', ').map(k => [k, row[k] ?? null]))

  // Keep a copy of exactly what was sent. A failure here must not block sending.
  let saved_contract = null
  if (isUuid(subcontract_id)) {
    try {
      saved_contract = await saveGeneratedContract(adminSupabase, { subcontractId: subcontract_id, html: document_html, userId: auth.userId })
    } catch (e) {
      console.error('signing-requests: could not save contract copy:', e.message)
    }
  }

  const siteUrl = getSiteUrl()
  const signingLink = `${siteUrl}/sign?token=${row.token}`
  const logo = logoSrc()
  const firstName = escapeHtml(signerName.split(' ')[0] || 'there')
  const title = escapeHtml(document_title || 'Subcontract Agreement')

  let emailError = null
  try {
  const { error: sendErr } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: signer_email,
    subject: `Action Required: Please sign — ${document_title || 'Subcontract Agreement'}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#141414;border:1px solid #222;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:#141414;border-bottom:1px solid #222;padding:28px 40px;text-align:center;">
            ${logo ? `<img src="${logo}" alt="NV Construction" width="60" height="60" style="object-fit:contain;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />` : ''}
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:4px;color:#555;text-transform:uppercase;">NV Construction</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">Signature Requested, ${firstName}</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">NV Construction has sent you a document to review and sign electronically.</p>
            <div style="background:#0f0f0f;border:1px solid #2a2a2a;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Document</p>
              <p style="margin:0;font-size:16px;font-weight:700;color:#f1f1f1;">${title}</p>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr><td align="center">
                <a href="${signingLink}" style="display:inline-block;background:#e8590c;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.5px;">Review &amp; Sign Document</a>
              </td></tr>
            </table>
            <p style="margin:0 0 8px;font-size:12px;color:#444;line-height:1.6;">Or copy and paste this link into your browser:</p>
            <p style="margin:0;font-size:12px;color:#e8590c;word-break:break-all;">${signingLink}</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">NV Construction &middot; Questions? Reply to this email or contact your project manager.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
    if (sendErr) emailError = sendErr.message || 'Email failed'
  } catch (e) {
    emailError = e.message || 'Email failed'
  }

  if (emailError) {
    // The link never went out: void this request so it can't be used, keep any older one as is.
    await adminSupabase.from('signing_requests').update({ status: 'voided' }).eq('id', row.id).eq('status', 'pending')
    return Response.json({ error: `The signing email was not sent (${emailError}). Nothing was sent to the signer; try again.` }, { status: 502 })
  }

  // Resend: the new link replaces any older pending one for this subcontract.
  let voided = 0
  if (subcontract_id) {
    const { data: old, error: voidErr } = await adminSupabase.from('signing_requests')
      .update({ status: 'voided' }).eq('subcontract_id', subcontract_id).eq('status', 'pending').neq('id', row.id).select('id')
    if (voidErr) return Response.json({ data: rowMeta, saved_contract, warning: 'Sent, but older signing links could not be cancelled: ' + voidErr.message })
    voided = old?.length || 0
  }

  return Response.json({ data: rowMeta, saved_contract, voided })
}

// PATCH { id, action: 'void' } — cancel a pending signing request (the link stops working).
export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { id, action } = await request.json().catch(() => ({}))
  if (!id || action !== 'void') return Response.json({ error: 'id and action: "void" required' }, { status: 400 })
  // Metal-building sales-order requests are cancelled from the sales order page.
  const { data: mbRow, error: mbErr } = await adminSupabase.from('signing_requests').select('sales_order_id').eq('id', id).maybeSingle()
  if (mbErr && !/sales_order_id|does not exist|schema cache/i.test(mbErr.message || '')) return Response.json({ error: mbErr.message }, { status: 500 })
  if (mbRow?.sales_order_id) return Response.json({ error: 'Cancel this request from its sales order.' }, { status: 409 })
  const denied = await denyJobOf(adminSupabase, auth, 'signing_requests', id)
  if (denied) return denied
  const { data, error } = await adminSupabase.from('signing_requests')
    .update({ status: 'voided' }).eq('id', id).eq('status', 'pending').select('id')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data?.length) return Response.json({ error: 'Only a pending request can be cancelled (it may already be signed).' }, { status: 409 })
  return Response.json({ ok: true })
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const sub_id = searchParams.get('sub_id')

  // Sub sees only their own signing requests — always derive from session, never from query param
  if (isSub(auth.role) || sub_id) {
    // Contracts the session user can access (theirs and their company's), never the supplied sub_id param
    const subIds = isSub(auth.role) ? (await getSubContracts(auth)).map(s => s.id) : []
    if (subIds.length === 0) return Response.json({ data: [] })
    const { data, error } = await adminSupabase
      .from('signing_requests')
      // Token excluded from sub listing — subs use sub-initiate-sign to get their own token
      .select('id, job_id, subcontract_id, signer_email, signer_name, document_title, status, signed_at, created_at')
      .in('subcontract_id', subIds)
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data: data || [] })
  }

  // PM sees all for a given job — token included for PM management
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
  const denied = await denyJob(adminSupabase, auth, job_id)
  if (denied) return denied

  const { data, error } = await adminSupabase
    .from('signing_requests')
    .select('id, token, job_id, subcontract_id, signer_email, signer_name, document_title, status, signed_at, signer_ip, created_at, created_by')
    .eq('job_id', job_id)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data: data || [] })
}
