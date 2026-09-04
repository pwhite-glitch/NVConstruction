import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST { subcontract_ids: string[] }
// Finds approved COs for those contracts that don't have a subcontract_sov_lines row yet,
// creates the missing rows, and returns them so the caller can merge into the SOV form.
export async function POST(request) {
  try {
    const { subcontract_ids } = await request.json()
    if (!subcontract_ids?.length) return Response.json({ lines: [] })

    const [{ data: approvedCOs }, { data: existingLines }] = await Promise.all([
      adminSupabase
        .from('change_orders')
        .select('id, subcontract_id, description, amount')
        .in('subcontract_id', subcontract_ids)
        .eq('status', 'approved'),
      adminSupabase
        .from('subcontract_sov_lines')
        .select('id, subcontract_id, description, scheduled_value, sort_order, subcontracts(description, retainage_pct)')
        .in('subcontract_id', subcontract_ids)
        .order('sort_order')
        .order('created_at'),
    ])

    const existingCoDescs = new Set(
      (existingLines || []).map(l => l.description).filter(d => d?.startsWith('CO:'))
    )

    const toCreate = (approvedCOs || []).filter(
      co => co.amount && !existingCoDescs.has(`CO: ${co.description}`)
    )

    if (!toCreate.length) return Response.json({ lines: [] })

    const newLines = []
    for (const co of toCreate) {
      const maxSort = (existingLines || [])
        .filter(l => l.subcontract_id === co.subcontract_id)
        .reduce((m, l) => Math.max(m, l.sort_order || 0), 0)

      const { data: newLine, error } = await adminSupabase
        .from('subcontract_sov_lines')
        .insert({
          subcontract_id: co.subcontract_id,
          description: `CO: ${co.description}`,
          scheduled_value: parseFloat(co.amount),
          sort_order: maxSort + 1,
        })
        .select('*, subcontracts(description, retainage_pct)')
        .single()

      if (!error && newLine) {
        newLines.push(newLine)
        existingCoDescs.add(`CO: ${co.description}`)
      }
    }

    return Response.json({ lines: newLines })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
