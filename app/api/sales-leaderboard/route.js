import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LEADERBOARD_ROLES = new Set(['pm','apm','admin','metal_rep','roofing_rep'])
const FINANCE_ROLES     = new Set(['pm','apm','admin'])

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!LEADERBOARD_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { searchParams } = new URL(request.url)
    const from     = searchParams.get('from')
    const to       = searchParams.get('to')
    const division = searchParams.get('division')
    const showFinancials = FINANCE_ROLES.has(auth.role)

    // ── Primary: use sales_attribution records (stored at signing) ───────────
    // These are the authoritative split-credit records. One order may have
    // multiple attribution rows totaling 100%. A rep's share_pct portion of
    // the order's signed_contract_value counts toward their total.

    let attrQ = adminSupabase
      .from('sales_attribution')
      .select(`
        salesperson_id,
        salesperson_name,
        share_pct,
        order_id,
        sales_orders!inner (
          id, division, contract_value, internal_cost, estimated_profit,
          won_at, stage, is_preview_data, signed_contract_value
        )
      `)
      .not('sales_orders.stage', 'in', '(lead,quoted,cancelled)')
      .not('sales_orders.won_at', 'is', null)
      .eq('sales_orders.is_preview_data', false)

    if (from)     attrQ = attrQ.gte('sales_orders.won_at', from)
    if (to)       attrQ = attrQ.lte('sales_orders.won_at', to)
    if (division) attrQ = attrQ.eq('sales_orders.division', division)

    const { data: attrRows, error: attrErr } = await attrQ
    if (attrErr) return Response.json({ error: attrErr.message }, { status: 500 })

    // ── Fallback: orders without any attribution records ──────────────────────
    // Legacy orders (before migration 024) won't have attribution rows.
    // For those, use signed_salesperson_id (locked at signing) falling back to salesperson_id.

    const coveredOrderIds = new Set((attrRows || []).map(r => r.order_id))

    let legacyQ = adminSupabase
      .from('sales_orders')
      .select('id,division,salesperson_id,salesperson_name,signed_salesperson_id,signed_salesperson_name,contract_value,signed_contract_value,internal_cost,estimated_profit,won_at,stage')
      .not('stage', 'in', '(lead,quoted,cancelled)')
      .not('won_at', 'is', null)
      .eq('is_preview_data', false)

    if (from)     legacyQ = legacyQ.gte('won_at', from)
    if (to)       legacyQ = legacyQ.lte('won_at', to)
    if (division) legacyQ = legacyQ.eq('division', division)

    const { data: allOrders } = await legacyQ

    const legacyOrders = (allOrders || []).filter(o => !coveredOrderIds.has(o.id))

    // ── Aggregate ─────────────────────────────────────────────────────────────

    const agg = {}  // keyed by salesperson_id (or name for legacy)

    // Attribution rows — split-aware
    for (const r of attrRows || []) {
      const order  = r.sales_orders
      const key    = r.salesperson_id || r.salesperson_name || 'unknown'
      const value  = Number(order.signed_contract_value || order.contract_value || 0)
      const profit = Number(order.estimated_profit || 0)
      const share  = Number(r.share_pct || 100) / 100

      if (!agg[key]) {
        agg[key] = {
          salesperson_id:   r.salesperson_id,
          salesperson_name: r.salesperson_name || 'Unknown',
          signed_count:     0,
          signed_value:     0,
          gross_profit:     0,
          by_division:      {},
          order_ids:        new Set(),
        }
      }
      // Count the order once per rep (even with splits)
      if (!agg[key].order_ids.has(order.id)) {
        agg[key].signed_count += 1
        agg[key].order_ids.add(order.id)
      }
      agg[key].signed_value += value * share
      agg[key].gross_profit += profit * share

      const div = order.division
      if (!agg[key].by_division[div]) agg[key].by_division[div] = { count: 0, value: 0 }
      agg[key].by_division[div].count += 1  // order count is not split (full order per rep)
      agg[key].by_division[div].value += value * share
    }

    // Legacy orders — no attribution record, use signed_salesperson (or salesperson)
    for (const o of legacyOrders) {
      const repId   = o.signed_salesperson_id   || o.salesperson_id
      const repName = o.signed_salesperson_name  || o.salesperson_name || 'Unknown'
      const key     = repId || repName
      const value   = Number(o.signed_contract_value || o.contract_value || 0)
      const profit  = Number(o.estimated_profit || 0)

      if (!agg[key]) {
        agg[key] = { salesperson_id: repId, salesperson_name: repName, signed_count: 0, signed_value: 0, gross_profit: 0, by_division: {}, order_ids: new Set() }
      }
      agg[key].signed_count += 1
      agg[key].signed_value += value
      agg[key].gross_profit += profit
      agg[key].order_ids.add(o.id)

      const div = o.division
      if (!agg[key].by_division[div]) agg[key].by_division[div] = { count: 0, value: 0 }
      agg[key].by_division[div].count += 1
      agg[key].by_division[div].value += value
    }

    const rows = Object.values(agg)
      .sort((a, b) => b.signed_value - a.signed_value)
      .map(r => ({
        salesperson_id:   r.salesperson_id,
        salesperson_name: r.salesperson_name,
        signed_count:     r.signed_count,
        signed_value:     Math.round(r.signed_value),
        by_division:      r.by_division,
        has_splits:       (attrRows || []).filter(a => a.salesperson_id === r.salesperson_id).some(a => Number(a.share_pct) < 100),
        ...(showFinancials ? { gross_profit: Math.round(r.gross_profit) } : {}),
      }))

    return Response.json({ rows, show_financials: showFinancials })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
