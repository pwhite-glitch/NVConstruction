import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { getCompanyProfiles, getCompanyAssignmentRows, isCompanyLevelRow } from '../../../lib/sub-access'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// None of these actions send email. Notifying people is always a separate,
// explicit step (the "Email people" panel).
//
// POST { job_id, company_id, action, ... }
//   add_company                     → put the company on the job (billing off)
//   grant_person   { user_id }      → give one person access by name (for people set to "only assigned jobs")
//   revoke_person  { user_id }      → remove that person's own access row
//   billing        { enabled }      → turn billing on/off for the whole company on this job
//   remove_company                  → take the company (and all its people's rows) off the job
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { job_id, company_id, action, user_id, enabled } = await request.json()
    if (!job_id || !company_id || !action) return Response.json({ error: 'job_id, company_id and action required' }, { status: 400 })

    const members = await getCompanyProfiles(company_id)
    const rows = await getCompanyAssignmentRows(company_id, members, job_id)
    // Same rule the sub portal uses: with no assignment rows, an active subcontract alone
    // makes the company billable. Adding a row must not silently flip that off.
    let billingOn = rows.some(r => r.billing_enabled !== false)
    if (!rows.length && action !== 'add_company') {
      const { data: sc } = await adminSupabase.from('subcontracts').select('id').eq('job_id', job_id).eq('company_id', company_id).or('status.is.null,status.neq.draft').limit(1)
      billingOn = !!sc?.length
    }

    async function ensureCompanyRow(billing) {
      if (rows.some(isCompanyLevelRow)) return null
      const { error } = await adminSupabase.from('job_assignments').insert({
        job_id, company_id, invited_at: new Date().toISOString(),
        billing_enabled: billing,
        ...(billing ? { billing_enabled_at: new Date().toISOString(), billing_enabled_by: auth.userId } : {}),
      })
      return error && error.code !== '23505' ? error : null
    }

    if (action === 'add_company') {
      const err = await ensureCompanyRow(billingOn)
      if (err) return Response.json({ error: err.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    if (action === 'grant_person' || action === 'revoke_person') {
      const person = members.find(m => m.id === user_id)
      if (!person) return Response.json({ error: 'That user is not linked to this company.' }, { status: 400 })
      const email = person.invite_email?.toLowerCase().trim() || null
      const personRows = rows.filter(r => r.sub_id === person.id || (email && r.sub_email?.toLowerCase() === email))
      if (action === 'grant_person') {
        if (personRows.length) return Response.json({ ok: true })
        const err = await ensureCompanyRow(billingOn)
        if (err) return Response.json({ error: err.message }, { status: 500 })
        const { error } = await adminSupabase.from('job_assignments').insert({
          job_id, company_id, sub_id: person.id, sub_email: email, invited_at: new Date().toISOString(), billing_enabled: billingOn,
        })
        if (error && error.code !== '23505') return Response.json({ error: error.message }, { status: 500 })
        return Response.json({ ok: true })
      }
      // Keep the company on the job when removing the last person row
      const err = await ensureCompanyRow(billingOn)
      if (err) return Response.json({ error: err.message }, { status: 500 })
      if (personRows.length) {
        const { error } = await adminSupabase.from('job_assignments').delete().in('id', personRows.map(r => r.id))
        if (error) return Response.json({ error: error.message }, { status: 500 })
      }
      return Response.json({ ok: true })
    }

    if (action === 'billing') {
      if (typeof enabled !== 'boolean') return Response.json({ error: 'enabled must be true or false' }, { status: 400 })
      const err = await ensureCompanyRow(enabled)
      if (err) return Response.json({ error: err.message }, { status: 500 })
      if (rows.length) {
        const { error } = await adminSupabase.from('job_assignments').update({
          billing_enabled: enabled,
          billing_enabled_at: enabled ? new Date().toISOString() : null,
          billing_enabled_by: enabled ? auth.userId : null,
        }).in('id', rows.map(r => r.id))
        if (error) return Response.json({ error: error.message }, { status: 500 })
      }
      return Response.json({ ok: true })
    }

    if (action === 'remove_company') {
      if (rows.length) {
        const { error } = await adminSupabase.from('job_assignments').delete().in('id', rows.map(r => r.id))
        if (error) return Response.json({ error: error.message }, { status: 500 })
      }
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
