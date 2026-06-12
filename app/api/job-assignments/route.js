import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const body = await request.json()
    const { job_id, sub_email, sub_id, invited_at } = body
    if (!job_id || !sub_email) return Response.json({ error: 'job_id and sub_email required' }, { status: 400 })

    const row = { job_id, sub_email: sub_email.toLowerCase().trim() }
    if (sub_id) row.sub_id = sub_id
    if (invited_at) row.invited_at = invited_at

    const { error } = await adminSupabase.from('job_assignments').insert(row)
    if (error) {
      if (error.code === '23505') return Response.json({ error: 'Already assigned to this job.' }, { status: 409 })
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { id, job_id } = await request.json()
    if (id) {
      await adminSupabase.from('job_assignments').delete().eq('id', id)
    } else if (job_id) {
      await adminSupabase.from('job_assignments').delete().eq('job_id', job_id)
    }
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
