import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { atLeastPM, accessibleJobIds } from '../../../lib/roles'
import { todayCentral } from '../../../lib/central-date'
import { equipmentInUse } from '../../../lib/equipment-usage'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    // ?include_retired=1 also returns retired rows (active=false) so old
    // lookahead activities can still show their names. Pickers use active only.
    const includeRetired = new URL(request.url).searchParams.get('include_retired') === '1'
    let query = adminSupabase
      .from('company_equipment')
      .select('*')
    if (!includeRetired) query = query.eq('active', true)
    const { data, error } = await query
      .order('category', { ascending: true, nullsFirst: true })
      .order('name', { ascending: true })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { name, category } = await request.json()
    if (!name) return Response.json({ error: 'name required' }, { status: 400 })
    const { data, error } = await adminSupabase
      .from('company_equipment')
      .insert({ name, category: category || null })
      .select('*')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Retire (never physically delete) a piece of equipment. Owner/PM only.
// Refused while any open (not done) lookahead activity today or later, or
// still in progress, uses it; the response says how many and on which of
// the caller's jobs. The row stays so history keeps its name.
export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!atLeastPM(auth.role)) return Response.json({ error: 'Only an Owner or PM can retire company equipment.' }, { status: 403 })
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { data: eq, error: eqErr } = await adminSupabase.from('company_equipment').select('id, name, active').eq('id', id).maybeSingle()
    if (eqErr) return Response.json({ error: eqErr.message }, { status: 500 })
    if (!eq) return Response.json({ error: 'Equipment not found.' }, { status: 404 })
    if (eq.active === false) return Response.json({ ok: true, already_retired: true })

    const usage = await equipmentInUse(adminSupabase, id, todayCentral())
    if (usage.error) return Response.json({ error: 'Could not check whether this equipment is scheduled, so it was not retired: ' + usage.error }, { status: 500 })
    if (usage.count > 0) {
      const { ids: visible, error: visErr } = await accessibleJobIds(adminSupabase, auth)
      if (visErr) return Response.json({ error: visErr.message }, { status: 500 })
      const visibleJobIds = usage.jobIds.filter(j => !visible || visible.has(j))
      let jobs = []
      if (visibleJobIds.length) {
        const { data: jobRows, error: jErr } = await adminSupabase.from('jobs').select('id, job_number, project_name').in('id', visibleJobIds)
        if (jErr) return Response.json({ error: jErr.message }, { status: 500 })
        jobs = (jobRows || []).map(j => ({ id: j.id, job_number: j.job_number, project_name: j.project_name }))
      }
      const otherJobs = usage.jobIds.length - visibleJobIds.length
      const where = jobs.length ? ` on ${jobs.map(j => j.job_number || j.project_name).join(', ')}` : ''
      const more = otherJobs > 0 ? `${jobs.length ? ' and' : ' on'} ${otherJobs} other job${otherJobs === 1 ? '' : 's'}` : ''
      return Response.json({
        error: `${eq.name} is on ${usage.count} open lookahead activit${usage.count === 1 ? 'y' : 'ies'}${where}${more}. Remove it from those activities (or mark them done) before retiring it.`,
        in_use: usage.count, jobs, other_jobs: otherJobs,
      }, { status: 409 })
    }

    const { error } = await adminSupabase
      .from('company_equipment')
      .update({ active: false })
      .eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
