import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const body = await request.json()

    if (body.action === 'update') {
      const { id, fields, line_items } = body

      // Try with markup_flat; fall back if column doesn't exist yet
      let updateErr
      const { error: e1 } = await adminSupabase.from('estimates').update(fields).eq('id', id)
      updateErr = e1

      if (updateErr && updateErr.message?.includes('markup_flat')) {
        const { markup_flat, ...fieldsWithout } = fields
        const { error: e2 } = await adminSupabase.from('estimates').update(fieldsWithout).eq('id', id)
        updateErr = e2
      }

      if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })

      // Replace line items
      await adminSupabase.from('estimate_line_items').delete().eq('estimate_id', id)
      if (line_items && line_items.length > 0) {
        const { error: liErr } = await adminSupabase.from('estimate_line_items').insert(line_items)
        if (liErr) return Response.json({ error: liErr.message }, { status: 500 })
      }

      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
