import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf, denyJobs } from '../../../lib/roles'
import { findBudgetLineReferences, buildReferencedConflict } from '../../../lib/budget-line-refs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST: insert one row or an array of rows
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const rows = Array.isArray(body) ? body : [body]
    const denied = await denyJobs(adminSupabase, auth, rows.map(r => r?.job_id))
    if (denied) return denied
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {}
      for (const f of ['budget_amount', 'owner_amount']) {
        const v = r[f]
        if (v === undefined || v === null) {
          if (f === 'budget_amount') return Response.json({ error: `Row ${i + 1}: budget amount is required` }, { status: 400 })
          continue
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          return Response.json({ error: `Row ${i + 1}: ${f.replace('_', ' ')} must be a number` }, { status: 400 })
        }
      }
    }
    const { data, error } = await adminSupabase.from('budget_items').insert(rows).select('id')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, inserted: data?.length ?? 0 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PUT: update a single row by id, or increment fields ({ id, increment: { field: delta } })
export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { id, fields } = await request.json()
    if (!id || !fields) return Response.json({ error: 'id and fields required' }, { status: 400 })
    const denied = await denyJobOf(adminSupabase, auth, 'budget_items', id)
      || (fields.job_id ? await denyJob(adminSupabase, auth, fields.job_id) : null)
    if (denied) return denied
    const { error } = await adminSupabase.from('budget_items').update(fields).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Lines referenced by direct costs, POs, sub SOV lines, pay app lines, general
// conditions, etc. are never deleted: 409 with what's attached. "Delete all"
// ({ job_id }) is all or nothing: blocked if any line is referenced.
// (Check-then-delete is not one transaction; FK constraints still guard the
// FK-backed tables at delete time.)
export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    if (body.job_id) {
      const denied = await denyJob(adminSupabase, auth, body.job_id)
      if (denied) return denied
      const { data: lines, error: lErr } = await fetchAllLines(() =>
        adminSupabase.from('budget_items').select('id, job_id, cost_code, description').eq('job_id', body.job_id).order('id', { ascending: true }))
      if (lErr) return Response.json({ error: lErr.message }, { status: 500 })
      if (!lines.length) return Response.json({ ok: true, deleted: 0 })

      const { refs, error: rErr } = await findBudgetLineReferences(adminSupabase, body.job_id, lines.map(l => l.id))
      if (rErr) return Response.json({ error: rErr }, { status: 500 })

      // Backstop: the job-level SQL check (migration 039) also sees every FK
      // to budget_items and rows on other jobs. Anything it finds that the
      // per-line check didn't is reported at table level.
      let jobLevel = []
      const { data: jl, error: jErr } = await adminSupabase.rpc('budget_line_references', { p_job_id: body.job_id })
      if (jErr) {
        const missing = jErr.code === 'PGRST202' || /could not find the function/i.test(jErr.message || '')
        if (!missing) return Response.json({ error: 'Could not check budget line references: ' + jErr.message }, { status: 500 })
      } else {
        const found = new Set()
        for (const list of Object.values(refs)) for (const a of list) found.add(`${a.source_table}.${a.source_column}`)
        jobLevel = (jl || []).filter(r => Number(r.ref_count) > 0 && !found.has(`${r.source_table}.${r.source_column}`))
      }

      if (Object.keys(refs).length || jobLevel.length) {
        return Response.json(buildReferencedConflict(lines, refs, jobLevel), { status: 409 })
      }
      const { error } = await adminSupabase.from('budget_items').delete().eq('job_id', body.job_id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true, deleted: lines.length })
    }
    if (!body.id) return Response.json({ error: 'id or job_id required' }, { status: 400 })
    const denied = await denyJobOf(adminSupabase, auth, 'budget_items', body.id)
    if (denied) return denied
    const { data: line, error: gErr } = await adminSupabase.from('budget_items')
      .select('id, job_id, cost_code, description').eq('id', body.id).maybeSingle()
    if (gErr) return Response.json({ error: gErr.message }, { status: 500 })
    if (!line) return Response.json({ error: 'Budget line not found.' }, { status: 404 })

    const { refs, error: rErr } = await findBudgetLineReferences(adminSupabase, line.job_id, [line.id])
    if (rErr) return Response.json({ error: rErr }, { status: 500 })
    if (Object.keys(refs).length) {
      return Response.json(buildReferencedConflict([line], refs), { status: 409 })
    }
    const { error } = await adminSupabase.from('budget_items').delete().eq('id', body.id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, deleted: 1 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

async function fetchAllLines(build, pageSize = 1000) {
  const out = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) return { data: null, error }
    out.push(...(data || []))
    if (!data || data.length < pageSize) return { data: out, error: null }
  }
}
