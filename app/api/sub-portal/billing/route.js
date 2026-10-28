import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth } from '../../../../lib/server-auth'
import { billingContext } from '../../../../lib/sub-access'
import { contractsWithBaseSov } from '../../../../lib/sov-lines'
import { emailWrap, escapeHtml } from '../../../../lib/email'
import { withoutNew032 } from '../../../../lib/billing-fields'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

// "Billing submitted" email to the job's PM. Sent from here rather than the
// client so a sub can't choose the recipient or the content.
async function emailPmBillingSubmitted(job, submission) {
  const company = submission.company_name || submission.sub_email
  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: job.pm_email || process.env.PM_EMAIL || 'pwhite@nvim.co',
    subject: `Billing submitted — ${company}`,
    html: emailWrap(`
      <h2 style="color:#f1f1f1;margin:0 0 1rem">New billing submission</h2>
      <p style="color:#aaa;margin:0 0 6px"><strong style="color:#f1f1f1">${escapeHtml(company)}</strong> submitted billing for <strong style="color:#f1f1f1">#${escapeHtml(job.job_number)} — ${escapeHtml(job.project_name)}</strong>.</p>
      <p style="font-size:28px;font-weight:800;color:#e8590c;margin:1rem 0">$${Number(submission.amount_billed || 0).toLocaleString()}</p>
      ${submission.pct_complete ? `<p style="color:#888;font-size:13px">${submission.pct_complete}% complete on scope</p>` : ''}
      <p style="color:#888;font-size:13px;line-height:1.6">${escapeHtml(submission.work_description)}</p>
      <p style="color:#888;font-size:13px">📎 Invoice PDF attached</p>
      <p style="margin-top:1.5rem"><a href="https://portal.nvim.co/dashboard" style="background:#e8590c;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Review in Portal →</a></p>
    `),
  }).catch(() => {})
}

// POST → submit billing from the sub portal. Any user at the company who can see
// the job may submit, as long as billing is on for the company and their
// profile.can_bill isn't false. The invoice PDF is uploaded by the client first
// (billing-docs/<user id>/...) and passed as doc_url.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const ctx = await billingContext(auth, body.job_id)
    if (ctx.error) return ctx.error
    if (!ctx.job.can_bill) {
      const msg = ctx.job.billing_lock_reason === 'person_cannot_bill'
        ? 'Your login is not set up to submit billing. Ask NV Construction to allow it, or have a teammate submit.'
        : 'Billing is not enabled for your company on this project yet.'
      return Response.json({ error: msg }, { status: 403 })
    }
    if (ctx.contracts.length === 0) return Response.json({ error: 'No subcontract on file for this project.' }, { status: 400 })
    if (!body.invoice_number?.trim()) return Response.json({ error: 'Invoice number is required.' }, { status: 400 })
    if (!body.doc_url || !String(body.doc_url).startsWith(`${auth.userId}/`)) return Response.json({ error: 'Invoice PDF is required.' }, { status: 400 })

    // SOV lines must belong to this job's contracts and not push any line past 100%
    const sovIn = (body.sov_lines || []).filter(l => Number(l.amount) > 0)
    let retainageHeld = 0
    if (sovIn.length) {
      const { data: lines } = await adminSupabase
        .from('subcontract_sov_lines')
        .select('id, subcontract_id, description')
        .in('id', sovIn.map(l => l.sov_line_id))
      const lineMap = Object.fromEntries((lines || []).map(l => [l.id, l]))
      const contractMap = Object.fromEntries(ctx.contracts.map(c => [c.id, c]))
      if (sovIn.some(l => !lineMap[l.sov_line_id] || !contractMap[lineMap[l.sov_line_id].subcontract_id])) {
        return Response.json({ error: 'One or more schedule-of-values lines do not belong to your subcontract.' }, { status: 400 })
      }
      // A contract's CO lines can't be billed until the sub has set up its base schedule
      const billedContractIds = [...new Set(sovIn.map(l => lineMap[l.sov_line_id].subcontract_id))]
      const { data: contractLines } = await adminSupabase.from('subcontract_sov_lines').select('*').in('subcontract_id', billedContractIds)
      const withBase = contractsWithBaseSov(contractLines)
      if (billedContractIds.some(id => !withBase.has(id))) {
        return Response.json({ error: 'Set up your schedule of values for the base contract before billing.' }, { status: 400 })
      }
      const { data: prev } = await adminSupabase
        .from('billing_sov_lines')
        .select('sov_line_id, pct_this_period, billing_submissions(status)')
        .in('sov_line_id', sovIn.map(l => l.sov_line_id))
      const prevPct = {}
      for (const pl of prev || []) {
        if (pl.billing_submissions?.status !== 'rejected') prevPct[pl.sov_line_id] = (prevPct[pl.sov_line_id] || 0) + (parseFloat(pl.pct_this_period) || 0)
      }
      const over = sovIn.filter(l => (prevPct[l.sov_line_id] || 0) + (parseFloat(l.pct_this_period) || 0) > 100.0001)
      if (over.length) return Response.json({ error: `Over-billing on: ${over.map(l => lineMap[l.sov_line_id].description).join(', ')}. Cumulative % would exceed 100%.` }, { status: 400 })
      retainageHeld = Math.round(sovIn.reduce((a, l) => a + Number(l.amount) * (parseFloat(contractMap[lineMap[l.sov_line_id].subcontract_id].retainage_pct) || 0) / 100, 0) * 100) / 100
    }

    const amountBilled = parseFloat(body.amount_billed) || 0
    const invoiceDate = /^\d{4}-\d{2}-\d{2}$/.test(body.invoice_date || '') ? body.invoice_date : null
    const row = {
      sub_id: auth.userId,
      job_id: body.job_id,
      sub_email: (auth.email || ctx.profile.invite_email || '').toLowerCase(),
      company_name: ctx.profile.company_name || 'Unknown',
      contact_name: ctx.profile.full_name,
      contact_info: ctx.profile.phone,
      amount_billed: amountBilled,
      retainage_pct: amountBilled > 0 && retainageHeld > 0 ? Math.round(retainageHeld / amountBilled * 100 * 100) / 100 : 0,
      retainage_held: retainageHeld,
      pct_complete: parseInt(body.pct_complete) || null,
      work_description: body.work_description || null,
      invoice_number: body.invoice_number.trim(),
      ...(invoiceDate ? { invoice_date: invoiceDate } : {}),
      billing_period: body.billing_period ? body.billing_period + '-01' : null,
      draw_request_id: body.draw_request_id || null,
      doc_url: body.doc_url,
    }
    let { data: newSub, error } = await adminSupabase.from('billing_submissions').insert(row).select().single()
    if (error?.message?.includes('schema cache')) {
      ({ data: newSub, error } = await adminSupabase.from('billing_submissions').insert(withoutNew032(row)).select().single())
    }
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await emailPmBillingSubmitted(ctx.job, newSub)

    if (sovIn.length) {
      const { error: lineErr } = await adminSupabase.from('billing_sov_lines').insert(sovIn.map(l => ({
        billing_submission_id: newSub.id,
        sov_line_id: l.sov_line_id,
        amount: Number(l.amount),
        pct_this_period: parseFloat(l.pct_this_period) || 0,
      })))
      if (lineErr) return Response.json({ ok: true, submission: newSub, warning: 'Billing saved, but the line-item breakdown failed to save: ' + lineErr.message })
    }
    return Response.json({ ok: true, submission: newSub })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
