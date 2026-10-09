import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LEADERBOARD_ROLES = new Set(['pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'])
const FINANCE_ROLES     = new Set(['pm', 'apm', 'admin'])

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!LEADERBOARD_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { searchParams } = new URL(request.url)
    const from     = searchParams.get('from')     // ISO date string
    const to       = searchParams.get('to')
    const division = searchParams.get('division')

    // Qualifying orders: stage not lead/quoted/cancelled, won_at is set
    let q = adminSupabase
      .from('sales_orders')
      .select('salesperson_id,salesperson_name,division,contract_value,internal_cost,estimated_profit,won_at,stage')
      .not('stage', 'in', '(lead,quoted,cancelled)')
      .not('won_at', 'is', null)
      .eq('is_preview_data', false)

    if (from)     q = q.gte('won_at', from)
    if (to)       q = q.lte('won_at', to)
    if (division) q = q.eq('division', division)

    const { data, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Aggregate by salesperson
    const agg = {}
    for (const row of data || []) {
      const key = row.salesperson_id || row.salesperson_name || 'unknown'
      if (!agg[key]) {
        agg[key] = {
          salesperson_id:   row.salesperson_id,
          salesperson_name: row.salesperson_name || 'Unknown',
          signed_count:     0,
          signed_value:     0,
          gross_profit:     0,
          by_division:      {},
        }
      }
      agg[key].signed_count  += 1
      agg[key].signed_value  += Number(row.contract_value || 0)
      agg[key].gross_profit  += Number(row.estimated_profit || 0)
      if (!agg[key].by_division[row.division]) agg[key].by_division[row.division] = { count: 0, value: 0 }
      agg[key].by_division[row.division].count += 1
      agg[key].by_division[row.division].value += Number(row.contract_value || 0)
    }

    const showFinancials = FINANCE_ROLES.has(auth.role)

    const rows = Object.values(agg)
      .sort((a, b) => b.signed_value - a.signed_value)
      .map(r => ({
        salesperson_id:   r.salesperson_id,
        salesperson_name: r.salesperson_name,
        signed_count:     r.signed_count,
        signed_value:     r.signed_value,
        by_division:      r.by_division,
        // Financials only returned to pm/apm/admin
        ...(showFinancials ? { gross_profit: r.gross_profit } : {}),
      }))

    return Response.json({ rows, show_financials: showFinancials })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
