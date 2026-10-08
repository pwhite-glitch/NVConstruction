import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const EDIT_ROLES = new Set(['pm', 'apm'])

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  if (!EDIT_ROLES.has(auth.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()

    // ── Create ──────────────────────────────────────────────────────────────
    if (body.action === 'create') {
      const { fields } = body

      // Generate next estimate number server-side to prevent duplicates
      const year = new Date().getFullYear()
      const prefix = `EST-${year}-`
      const { data: last } = await adminSupabase
        .from('estimates')
        .select('estimate_number')
        .like('estimate_number', `${prefix}%`)
        .order('estimate_number', { ascending: false })
        .limit(1)
        .maybeSingle()

      let nextNum = 1
      if (last?.estimate_number) {
        const parsed = parseInt(last.estimate_number.replace(prefix, ''), 10)
        if (!isNaN(parsed)) nextNum = parsed + 1
      }
      const estimate_number = `${prefix}${String(nextNum).padStart(3, '0')}`

      const { data, error } = await adminSupabase
        .from('estimates')
        .insert({ ...fields, estimate_number, created_by: auth.userId, status: fields.status || 'lead' })
        .select('id, estimate_number')
        .single()

      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true, id: data.id, estimate_number: data.estimate_number })
    }

    // ── Update ───────────────────────────────────────────────────────────────
    if (body.action === 'update') {
      const { id, fields, line_items } = body

      // Verify ownership or PM role before allowing update
      if (!isPM(auth.role)) {
        const { data: est } = await adminSupabase.from('estimates').select('created_by, allowed_users').eq('id', id).maybeSingle()
        if (!est) return Response.json({ error: 'Not found' }, { status: 404 })
        const allowed = est.created_by === auth.userId || (est.allowed_users || []).includes(auth.userId)
        if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 })
      }

      let updateErr
      const { error: e1 } = await adminSupabase.from('estimates').update(fields).eq('id', id)
      updateErr = e1

      if (updateErr?.message?.includes('markup_flat')) {
        const { markup_flat, ...fieldsWithout } = fields
        const { error: e2 } = await adminSupabase.from('estimates').update(fieldsWithout).eq('id', id)
        updateErr = e2
      }

      if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })

      // Only replace line items when the caller sends at least one. An empty
      // array most likely means the client loaded before items were fetched —
      // skipping the delete prevents accidental wipeout.
      if (line_items?.length > 0) {
        await adminSupabase.from('estimate_line_items').delete().eq('estimate_id', id)
        const { error: liErr } = await adminSupabase.from('estimate_line_items').insert(line_items)
        if (liErr) {
          if (liErr.message?.includes('apply_markup')) {
            const stripped = line_items.map(({ apply_markup, ...rest }) => rest)
            const { error: liErr2 } = await adminSupabase.from('estimate_line_items').insert(stripped)
            if (liErr2) return Response.json({ error: liErr2.message }, { status: 500 })
          } else {
            return Response.json({ error: liErr.message }, { status: 500 })
          }
        }
      }

      return Response.json({ ok: true })
    }

    // ── Delete ───────────────────────────────────────────────────────────────
    if (body.action === 'delete') {
      if (!isPM(auth.role)) return Response.json({ error: 'Forbidden — PM only' }, { status: 403 })

      const { id } = body
      await adminSupabase.from('estimate_line_items').delete().eq('estimate_id', id)
      const { error } = await adminSupabase.from('estimates').delete().eq('id', id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
