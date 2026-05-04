import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request) {
  // Verify cron secret so only Vercel can call this
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nvconstruction.vercel.app'

  // Reminder date = 3 days from now
  const reminderDate = new Date()
  reminderDate.setDate(reminderDate.getDate() + 3)
  const reminderDay = reminderDate.getDate()
  const reminderMonth = reminderDate.getMonth()
  const reminderYear = reminderDate.getFullYear()

  // Get all active jobs with a billing_due_day set
  const { data: jobs, error: jobsErr } = await adminSupabase
    .from('jobs')
    .select('id, job_number, project_name')
    .eq('status', 'active')
    .not('billing_due_day', 'is', null)

  if (jobsErr) return Response.json({ error: jobsErr.message }, { status: 500 })

  // Filter: billing due date for the reminder month matches the reminder date
  const targetJobs = (jobs || []).filter(job => {
    const dueDay = parseInt(job.billing_due_day)
    if (!dueDay) return false
    const lastDayOfMonth = new Date(reminderYear, reminderMonth + 1, 0).getDate()
    return Math.min(dueDay, lastDayOfMonth) === reminderDay
  })

  if (targetJobs.length === 0) {
    return Response.json({ ok: true, sent: 0, message: 'No billing due in 3 days.' })
  }

  let totalSent = 0
  const errors = []

  for (const job of targetJobs) {
    const dueDate = reminderDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    // Get all vendors assigned to this job
    const { data: assignments } = await adminSupabase
      .from('job_assignments')
      .select('sub_email, profiles(company_name, full_name)')
      .eq('job_id', job.id)
      .not('sub_email', 'is', null)

    for (const asgn of assignments || []) {
      if (!asgn.sub_email) continue
      const companyName = asgn.profiles?.company_name || asgn.sub_email
      const firstName = asgn.profiles?.full_name?.split(' ')[0] || 'there'

      const { error: emailErr } = await resend.emails.send({
        from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
        to: asgn.sub_email,
        subject: `Billing due ${dueDate} — #${job.job_number} ${job.project_name}`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141414;border:1px solid #222;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:#141414;border-bottom:1px solid #222;padding:28px 40px;text-align:center;">
            <img src="${siteUrl}/logo.png" alt="NV Construction" width="60" height="60" style="object-fit:contain;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:4px;color:#555;text-transform:uppercase;">NV Construction</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">Billing reminder, ${firstName}</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">
              Your billing submission for <strong style="color:#f1f1f1;">#${job.job_number} — ${job.project_name}</strong> is due in <strong style="color:#e8590c;">3 days</strong> on <strong style="color:#f1f1f1;">${dueDate}</strong>.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#e8590c;border-radius:8px;">
                  <a href="${siteUrl}/submit" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Submit billing now</a>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Job</p>
                  <p style="margin:0;font-size:14px;color:#f1f1f1;">#${job.job_number} — ${job.project_name}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">You're receiving this because you're assigned to this job. Log in at <a href="${siteUrl}" style="color:#666;">${siteUrl}</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      })

      if (emailErr) errors.push({ email: asgn.sub_email, error: emailErr.message })
      else totalSent++
    }
  }

  return Response.json({ ok: true, sent: totalSent, jobs: targetJobs.length, errors })
}
