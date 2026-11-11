import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { saveSignedContract, fillSubcontractSignatureLines } from '../../../../lib/generated-contract'
import { escapeHtml } from '../../../../lib/email'
import { canSign, signatureMatchesName } from '../../../../lib/signing'
import { getSiteUrl } from '../../../../lib/site-url'
import { mbRequestByToken, loadPinnedPdf, completeMbSigning, preflightWorkflow, getPaymentInstructions } from '../../../../lib/mb-server'
import { isMb } from '../../../../lib/mb-orders'
import { streamedJsonResponse } from '../../../../lib/stream-response'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const logoSrc = () => `${getSiteUrl()}/logo.png`

export async function GET(request, { params }) {
  const { token } = params
  const { searchParams } = new URL(request.url)
  const includeHtml = searchParams.get('html') === '1'

  const selectFields = includeHtml
    ? 'id, token, job_id, subcontract_id, signer_email, signer_name, document_title, document_html, status, signed_at, signer_ip, created_at'
    : 'id, token, job_id, subcontract_id, signer_email, signer_name, document_title, status, signed_at, signer_ip, created_at'

  const { data, error } = await adminSupabase
    .from('signing_requests')
    .select(selectFields)
    .eq('token', token)
    .single()

  if (error || !data) return Response.json({ error: 'Not found' }, { status: 404 })

  // Metal-building client order form: the signer sees the pinned PDF itself
  // (served by /document for this token). Nothing about the order beyond the title.
  const mbr = await mbRequestByToken(adminSupabase, token)
  if (mbr.error) return Response.json({ error: 'Could not load this signing request.' }, { status: 500 })
  if (mbr.mb) {
    const m = mbr.mb
    return Response.json({ data: {
      id: m.id, token: m.token, signer_email: m.signer_email, signer_name: m.signer_name,
      document_title: m.document_title, status: m.status, signed_at: m.signed_at, created_at: m.created_at,
      document_kind: 'pdf', document_file_name: m.document_file_name, document_sha256: m.document_sha256,
      document_url: `/api/signing-requests/${encodeURIComponent(token)}/document`,
    } })
  }
  // Subcontract: show the signer which company they sign for ("Signing on behalf of").
  const company_name = await subcontractCompany(data.subcontract_id)
  const out = { data: company_name ? { ...data, company_name } : data }
  // ?html=1 carries the whole document: stream it (same JSON shape, no Content-Length) so a
  // large generated contract is not capped as a buffered response.
  if (includeHtml) return streamedJsonResponse(out)
  return Response.json(out)
}

// The subcontract's company (vendor_name). Best effort: null when unknown or the read fails.
async function subcontractCompany(subcontractId) {
  if (!subcontractId) return null
  try {
    const { data, error } = await adminSupabase.from('subcontracts').select('vendor_name').eq('id', subcontractId).maybeSingle()
    if (error) return null
    return String(data?.vendor_name || '').trim() || null
  } catch {
    return null
  }
}

// Metal-building client order form signature: native token checks, then the
// server-side completion (signed copy + deposit request). No signer receipt,
// no staff email: the only automatic email is the customer's deposit request.
async function signMbRequest(request, token, existing, mb, signature_text, signer_ip) {
  if (existing.status === 'signed') return Response.json({ error: 'Already signed' }, { status: 400 })
  if (!canSign(existing.status)) return Response.json({ error: 'This signing link is no longer valid. Ask NV Construction for a new one.' }, { status: 410 })
  if (!signatureMatchesName(signature_text, existing.signer_name)) {
    return Response.json({ error: `Type your full name exactly as shown (${existing.signer_name}) to sign.` }, { status: 400 })
  }
  const { data: order, error: oErr } = await adminSupabase.from('sales_orders').select('*').eq('id', mb.sales_order_id).maybeSingle()
  if (oErr) return Response.json({ error: 'Could not load the order. Please try again.' }, { status: 500 })
  if (!order || !isMb(order)) return Response.json({ error: 'This signing link is no longer valid. Ask NV Construction for a new one.' }, { status: 410 })
  // The exact pinned file must still be there, unchanged, before anything is signed.
  const pin = await loadPinnedPdf(adminSupabase, mb)
  if (pin.error) return Response.json({ error: pin.error }, { status: 409 })
  // Completion needs the workflow + settings tables: fail before the signature is
  // claimed (nothing changes) if migration 050 is only partly present.
  const pf = await preflightWorkflow(adminSupabase, order.id)
  if (pf.error) return Response.json({ error: pf.status === 503 ? 'Signing is temporarily unavailable. Please try again later or contact NV Construction.' : 'Could not load the order. Please try again.' }, { status: pf.status })
  const settings = await getPaymentInstructions(adminSupabase)
  if (settings.missingSchema) return Response.json({ error: 'Signing is temporarily unavailable. Please try again later or contact NV Construction.' }, { status: 503 })

  const signedAt = new Date().toISOString()
  const signerIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || signer_ip || null
  const { data: claimed, error: updateErr } = await adminSupabase
    .from('signing_requests')
    .update({ status: 'signed', signature_text: signature_text.trim(), signed_at: signedAt, signer_ip: signerIp })
    .eq('token', token)
    .eq('status', 'pending')
    .select('id')
  if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })
  if (!claimed?.length) return Response.json({ error: 'Already signed' }, { status: 409 })

  const signedRequest = { ...mb, status: 'signed', signature_text: signature_text.trim(), signed_at: signedAt, signer_ip: signerIp }
  const result = await completeMbSigning(adminSupabase, resend, { order, request: signedRequest })
  if (result.queued?.error || result.email?.error || result.signed_copy?.error) {
    console.error('signing-requests: MB completion follow-up incomplete:', JSON.stringify({ order: order.id, queued: result.queued?.error || null, email: result.email?.error || null, copy: result.signed_copy?.error || null }))
  }
  // The signature is recorded either way; office staff see and can retry any failed follow-up.
  return Response.json({ ok: true })
}

export async function POST(request, { params }) {
  const { token } = params
  const { signature_text, signer_ip, signer_title } = await request.json()

  if (typeof signature_text !== 'string' || !signature_text.trim()) {
    return Response.json({ error: 'signature_text is required' }, { status: 400 })
  }

  const { data: existing, error: fetchErr } = await adminSupabase
    .from('signing_requests')
    .select('id, signer_email, signer_name, document_title, document_html, job_id, subcontract_id, status')
    .eq('token', token)
    .single()

  if (fetchErr || !existing) return Response.json({ error: 'Not found' }, { status: 404 })
  const mbr = await mbRequestByToken(adminSupabase, token)
  if (mbr.error) return Response.json({ error: 'Could not load this signing request. Please try again.' }, { status: 500 })
  if (mbr.mb) return signMbRequest(request, token, existing, mbr.mb, signature_text, signer_ip)
  if (existing.status === 'signed') return Response.json({ error: 'Already signed' }, { status: 400 })
  if (!canSign(existing.status)) return Response.json({ error: 'This signing link is no longer valid. Ask NV Construction for a new one.' }, { status: 410 })
  // Subcontracts are signed by a person for the company: their title goes on the
  // contract's Title line and the signature record (not stored on signing_requests).
  const signerTitle = typeof signer_title === 'string' ? signer_title.trim() : ''
  if (!signerTitle) return Response.json({ error: 'Title is required' }, { status: 400 })
  if (!signatureMatchesName(signature_text, existing.signer_name)) {
    return Response.json({ error: `Type your full name exactly as shown (${existing.signer_name}) to sign.` }, { status: 400 })
  }

  const signedAt = new Date().toISOString()

  // Record the IP the request came from; the body value is only a fallback
  const signerIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || signer_ip || null
  // Claim: only a still-pending request is signed, so a double tap can't save / email twice.
  const { data: claimed, error: updateErr } = await adminSupabase
    .from('signing_requests')
    .update({
      status: 'signed',
      signature_text: signature_text.trim(),
      signed_at: signedAt,
      signer_ip: signerIp,
    })
    .eq('token', token)
    .eq('status', 'pending')
    .select('id')

  if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })
  if (!claimed?.length) return Response.json({ error: 'Already signed' }, { status: 409 })

  const typedName = signature_text.trim()
  const personName = String(existing.signer_name || '').trim() || typedName
  const companyName = await subcontractCompany(existing.subcontract_id)

  // Store the signed document and link it as the subcontract's signed contract.
  // The signature itself is already recorded above, so a failure here is only logged.
  if (existing.subcontract_id) {
    try {
      const html = fillSubcontractSignatureLines(existing.document_html || '', { signature_text: typedName, signer_title: signerTitle, signed_at: signedAt, company_name: companyName })
      await saveSignedContract(adminSupabase, {
        subcontractId: existing.subcontract_id,
        html,
        certificate: { signature_text: typedName, signer_name: personName, signer_title: signerTitle, company_name: companyName, signer_email: existing.signer_email, signed_at: signedAt, signer_ip: signerIp, request_id: existing.id },
        at: signedAt,
      })
    } catch (e) {
      console.error('signing-requests: could not store signed contract:', e.message)
    }
  }

  const siteUrl = getSiteUrl()
  const logo = logoSrc()
  // User-entered text going into email HTML is escaped
  const title = escapeHtml(existing.document_title || 'Subcontract Agreement')
  const signerDisplay = escapeHtml(personName + (signerTitle ? `, ${signerTitle}` : '') + (companyName ? ` on behalf of ${companyName}` : ''))
  const firstName = escapeHtml(personName.split(' ')[0] || 'there')
  const signedDate = new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
  const jobPortalLink = `${siteUrl}/jobdetail?id=${existing.job_id}&tab=contracts`

  // Email to signer
  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: existing.signer_email,
    subject: `Signed: ${existing.document_title || 'Subcontract Agreement'}`,
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
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;background:#0a2a0a;border:2px solid #1a4a1a;border-radius:50%;width:60px;height:60px;line-height:60px;font-size:28px;text-align:center;">&#10003;</div>
            </div>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;text-align:center;">Document Signed, ${firstName}</h1>
            <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;text-align:center;">You have successfully signed the document below.</p>
            <div style="background:#0f0f0f;border:1px solid #2a2a2a;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Document</p>
              <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#f1f1f1;">${title}</p>
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Signed By</p>
              <p style="margin:0 0 16px;font-size:14px;color:#f1f1f1;">${signerDisplay}</p>
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Signed At</p>
              <p style="margin:0;font-size:14px;color:#4ade80;">${signedDate}</p>
            </div>
            <p style="margin:0;font-size:12px;color:#444;">Please keep this email for your records. NV Construction has been notified.</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">NV Construction &middot; Questions? Reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })

  // Email to PM
  const pmEmail = process.env.PM_EMAIL || 'management@nvim.co'
  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: pmEmail,
    subject: `${existing.signer_name || existing.signer_email} signed: ${existing.document_title || 'Subcontract Agreement'}`,
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
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#4ade80;">Contract Signed</h1>
            <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;">
              <strong style="color:#f1f1f1;">${signerDisplay}</strong> has electronically signed a contract.
            </p>
            <div style="background:#0f0f0f;border:1px solid #2a2a2a;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Document</p>
              <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#f1f1f1;">${title}</p>
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Signed By</p>
              <p style="margin:0 0 16px;font-size:14px;color:#f1f1f1;">${signerDisplay}</p>
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Signed At</p>
              <p style="margin:0;font-size:14px;color:#4ade80;">${signedDate}</p>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td align="center">
                  <a href="${jobPortalLink}" style="display:inline-block;background:#e8590c;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">View Job Portal</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">NV Construction &middot; Internal notification</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })

  return Response.json({ ok: true })
}
