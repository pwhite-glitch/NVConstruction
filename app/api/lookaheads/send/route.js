import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requirePM } from '../../../../lib/server-auth'
import { notify } from '../../../../lib/notify'
import { escapeHtml, emailWrap } from '../../../../lib/email'
import { writeWithFallback, lookaheadStage } from '../../../../lib/lookahead-fields'
import { lookaheadDays, activitiesInDays, rangeLabel } from '../../../../lib/lookahead-dates'
import { lookaheadSubRecipients } from '../../../../lib/lookahead-recipients'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const OFFICE_ROLES = new Set(['pm', 'apm', 'admin'])

// The PM's manual "Send to subs". Nothing here runs on its own: GET only shows who
// would receive it; POST sends, and is only called after the PM confirms that list.

async function load(id) {
  const { data, error } = await adminSupabase
    .from('lookaheads')
    .select('*, jobs(id, job_number, project_name), lookahead_activities(*)')
    .eq('id', id)
    .single()
  if (error || !data) return { error: error?.message || 'Lookahead not found' }
  // Only work inside this lookahead's two weeks
  const acts = activitiesInDays(data.lookahead_activities || [], lookaheadDays(data.week_start_date))
  return { la: data, subs: await lookaheadSubRecipients(acts) }
}

const preview = subs => subs.map(s => ({
  contract_id: s.contract_id,
  vendor_name: s.vendor_name,
  activity_count: s.activities.length,
  people: s.people.map(p => ({ name: p.name, email: p.email, portal: p.portal })),
}))

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { la, subs, error } = await load(id)
  if (error) return Response.json({ error }, { status: 404 })
  return Response.json({ stage: lookaheadStage(la), recipients: preview(subs) })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!OFFICE_ROLES.has(auth.role)) return Response.json({ error: 'Only the PM can send the lookahead to subs.' }, { status: 403 })
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { la, subs, error } = await load(id)
    if (error) return Response.json({ error }, { status: 404 })
    if (la.status !== 'approved') return Response.json({ error: 'Mark the lookahead Reviewed / Approved before sending it to subs.' }, { status: 400 })
    if (!subs.length) return Response.json({ error: 'No subcontractors are tagged on this lookahead\'s activities.' }, { status: 400 })

    const job = la.jobs || {}
    const weekStr = new Date(la.week_start_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nv-construction-doym.vercel.app'
    const resend = new Resend(process.env.RESEND_API_KEY)
    const sentAt = new Date().toISOString()
    const results = []

    for (const sub of subs) {
      const acts = [...sub.activities].sort((a, b) => a.planned_date.localeCompare(b.planned_date))
      const rows = acts.map(a => {
        const when = rangeLabel(a) || new Date(a.planned_date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
        return `<tr><td style="padding:6px 10px;color:#aaa;white-space:nowrap;vertical-align:top">${when}</td><td style="padding:6px 10px;color:#f1f1f1">${escapeHtml(a.description)}${a.location ? `<div style="color:#888;font-size:12px">${escapeHtml(a.location)}</div>` : ''}${a.manpower ? `<div style="color:#888;font-size:12px">${a.manpower} people</div>` : ''}</td></tr>`
      }).join('')
      const html = emailWrap(`
        <h2 style="color:#f1f1f1;margin:0 0 8px;font-size:18px">2-Week Lookahead — ${escapeHtml(job.project_name)}</h2>
        <p style="color:#aaa;margin:0 0 16px;font-size:14px">${escapeHtml(sub.vendor_name)} is scheduled for the work below starting the week of <strong style="color:#f1f1f1">${weekStr}</strong>. Please confirm with your superintendent if anything changes.</p>
        <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #222;border-radius:8px;font-size:13px">${rows}</table>
        <p style="margin:20px 0 0"><a href="${siteUrl}/submit" style="display:inline-block;padding:12px 28px;background:#e8590c;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px">View Upcoming Work</a></p>`)
      const people = []
      for (const p of sub.people) {
        let emailed = false
        if (p.email) {
          try {
            const { error: mailErr } = await resend.emails.send({
              from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
              to: p.email,
              subject: `2-Week Lookahead: ${job.project_name} — week of ${weekStr}`,
              html,
            })
            emailed = !mailErr
          } catch {}
        }
        if (p.portal && p.id) {
          await notify({
            recipient_id: p.id,
            type: 'lookahead_sent',
            title: `2-week lookahead: ${job.project_name}`,
            body: `${acts.length} activit${acts.length === 1 ? 'y' : 'ies'} scheduled for ${sub.vendor_name} starting the week of ${weekStr}.`,
            link: 'upcoming',
            job_id: la.job_id,
            entity_type: 'lookahead',
            entity_id: la.id,
            dedup_key: `lookahead:sent:${la.id}:${sentAt}`,
          })
        }
        people.push({ name: p.name, email: p.email, emailed, portal: !!(p.portal && p.id) })
      }
      results.push({ vendor_name: sub.vendor_name, activity_count: acts.length, people })
    }

    const { data: prof } = await adminSupabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle()
    const { data, error: upErr, dropped } = await writeWithFallback(row => adminSupabase
      .from('lookaheads').update(row).eq('id', la.id).select('*').single(), {
      sent_to_subs_at: sentAt, sent_to_subs_by: auth.userId, sent_to_subs_by_name: prof?.full_name || null, sent_to_subs_recipients: results,
    })
    const warning = dropped.length ? 'Sent, but the send was not recorded on the lookahead (migration 035 not applied yet).'
      : upErr ? `Sent, but the send was not recorded: ${upErr.message}` : undefined
    return Response.json({ data, results, warning })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
