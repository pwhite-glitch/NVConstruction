import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { verifyCronSecret } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request) {
  // Must be called with a valid CRON_SECRET header — protects against public triggering
  if (!verifyCronSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data: vehicles, error: vErr } = await adminSupabase
      .from('vehicles')
      .select('id, name, year, make, model, assigned_to, profiles:assigned_to(full_name, role)')
      .not('assigned_to', 'is', null)

    if (vErr) return Response.json({ error: vErr.message }, { status: 500 })
    if (!vehicles?.length) return Response.json({ ok: true, sent: 0 })

    // Get emails from auth (authoritative) rather than profiles.email
    const assignedUserIds = [...new Set(vehicles.map(v => v.assigned_to).filter(Boolean))]
    const userEmails = {}
    for (const uid of assignedUserIds) {
      const { data: authUser } = await adminSupabase.auth.admin.getUserById(uid)
      if (authUser?.user?.email) userEmails[uid] = authUser.user.email
    }

    const today = new Date()
    const day = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
    const weekStart = monday.toISOString().split('T')[0]

    let sent = 0
    for (const v of vehicles) {
      const profile = v.profiles
      const email = userEmails[v.assigned_to]
      if (!email) continue

      const { data: logs } = await adminSupabase
        .from('vehicle_logs')
        .select('id')
        .eq('vehicle_id', v.id)
        .eq('log_type', 'Weekly Miles')
        .gte('log_date', weekStart)
        .limit(1)

      if (logs?.length > 0) continue

      const vehicleName = [v.year, v.make, v.model].filter(Boolean).join(' ') || v.name || 'your vehicle'
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nvim.co'
      const portalPath = profile?.role === 'apm' ? '/dashboard' : '/field'
      const portalLabel = profile?.role === 'apm' ? 'My Vehicle tab in the dashboard' : 'Vehicles → Weekly Miles in the field portal'

      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
        to: email,
        subject: `Weekly mileage log due — ${vehicleName}`,
        html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
          <p style="color:#e8590c;font-size:16px;font-weight:800;margin:0 0 12px">Mileage Log Due</p>
          <p style="color:#aaa;font-size:14px;line-height:1.6;margin:0 0 16px">
            Hi ${profile?.full_name || 'there'},<br/><br/>
            You haven't submitted your weekly odometer reading for <strong style="color:#f1f1f1">${vehicleName}</strong> yet this week.
          </p>
          <table cellpadding="0" cellspacing="0"><tr><td style="background:#e8590c;border-radius:8px">
            <a href="${baseUrl}${portalPath}" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:#fff;text-decoration:none;">Log Mileage Now</a>
          </td></tr></table>
          <p style="color:#555;font-size:12px;margin:20px 0 0">Go to ${portalLabel}.</p>
        </div>`,
      }).catch(() => {})

      sent++
    }

    return Response.json({ ok: true, sent, checked: vehicles.length })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
