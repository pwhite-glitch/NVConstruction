import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth, isPM, isSub } from '../../../lib/server-auth'
import { subCanSeeJob } from '../../../lib/sub-access'
import { escapeHtml } from '../../../lib/email'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

// Threads are per job + sub user. Office staff read/write any thread; a sub
// only their own thread (sub_id is always the session user) on a job they see.
async function resolveThread(auth, job_id, sub_id) {
  if (isPM(auth.role)) return { sub_id, sender_role: 'pm' }
  if (!isSub(auth.role)) return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  if (!(await subCanSeeJob(auth, job_id))) return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  return { sub_id: auth.userId, sender_role: 'sub' }
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id || !searchParams.get('sub_id')) return Response.json({ messages: [] })
  const thread = await resolveThread(auth, job_id, searchParams.get('sub_id'))
  if (thread.error) return thread.error
  const { sub_id } = thread
  const { data, error } = await adminSupabase
    .from('job_messages')
    .select('*')
    .eq('job_id', job_id)
    .eq('sub_id', sub_id)
    .order('created_at')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ messages: data || [] })
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const body = await request.json()
  const { job_id, sender_name, message } = body
  if (!job_id || !body.sub_id || !message) return Response.json({ error: 'job_id, sub_id, message required' }, { status: 400 })
  const thread = await resolveThread(auth, job_id, body.sub_id)
  if (thread.error) return thread.error
  const { sub_id, sender_role } = thread
  const sender_id = auth.userId
  const { data: msg, error } = await adminSupabase
    .from('job_messages')
    .insert({ job_id, sub_id, sender_id, sender_name: sender_name || null, sender_role, message })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Notify the other party
  const { data: jobRow } = await adminSupabase.from('jobs').select('job_number, project_name').eq('id', job_id).single()
  if (sender_role === 'pm') {
    // PM sent — notify sub
    const { data: profile } = await adminSupabase.from('profiles').select('email').eq('id', sub_id).single()
    if (profile?.email) {
      const portalUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://nv-construction-doym.vercel.app') + '/submit'
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
        to: profile.email,
        subject: `Message from NV Construction — #${jobRow?.job_number} ${jobRow?.project_name}`,
        html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
          <p style="color:#60a5fa;font-size:16px;font-weight:700;margin:0 0 8px">New message</p>
          <p style="color:#aaa;margin:0 0 16px">You have a new message on <strong style="color:#f1f1f1">#${jobRow?.job_number} — ${jobRow?.project_name}</strong>.</p>
          <div style="background:#111;border:1px solid #222;border-radius:8px;padding:14px 16px;margin:0 0 20px">
            <p style="color:#f1f1f1;margin:0;font-size:14px;line-height:1.6">${escapeHtml(message)}</p>
          </div>
          <table cellpadding="0" cellspacing="0"><tr><td style="background:#e8590c;border-radius:8px">
            <a href="${portalUrl}" style="display:inline-block;padding:12px 28px;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase">Reply in Portal</a>
          </td></tr></table>
        </div>`,
      }).catch(() => {})
    }
  } else {
    // Sub sent — notify all PMs/APMs
    const { data: pmProfiles } = await adminSupabase
      .from('profiles')
      .select('email')
      .in('role', ['pm', 'apm'])
    const pmEmails = (pmProfiles || []).map(p => p.email).filter(Boolean)
    if (pmEmails.length === 0) pmEmails.push(process.env.PM_EMAIL || 'management@nvim.co')
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to: pmEmails,
      subject: `Message from ${sender_name || 'Subcontractor'} — #${jobRow?.job_number} ${jobRow?.project_name}`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
        <p style="color:#60a5fa;font-size:16px;font-weight:700;margin:0 0 8px">New message from ${escapeHtml(sender_name || 'sub')}</p>
        <p style="color:#aaa;margin:0 0 16px">Re: <strong style="color:#f1f1f1">#${jobRow?.job_number} — ${jobRow?.project_name}</strong></p>
        <div style="background:#111;border:1px solid #222;border-radius:8px;padding:14px 16px;margin:0 0 20px">
          <p style="color:#f1f1f1;margin:0;font-size:14px;line-height:1.6">${escapeHtml(message)}</p>
        </div>
      </div>`,
    }).catch(() => {})
  }

  return Response.json({ message: msg })
}
