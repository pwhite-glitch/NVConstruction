import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Roles that can create/edit sales orders
const SALES_ROLES = new Set(['pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'])
// Roles that can see internal financials
const FINANCE_ROLES = new Set(['pm', 'apm', 'admin'])

// Generate next sequential order number for a division/year atomically
async function nextOrderNumber(division) {
  const prefix = division === 'metal_buildings' ? 'MB' : 'RF'
  const year = new Date().getFullYear()

  // Upsert sequence row and increment atomically via UPDATE ... RETURNING
  const { data, error } = await adminSupabase.rpc('increment_sales_order_seq', {
    p_division: division,
    p_year: year,
  })

  if (error || !data) {
    // Fallback: use timestamp-based suffix if RPC not yet available
    const seq = Date.now().toString().slice(-4)
    return `${prefix}-${year}-${seq}`
  }
  return `${prefix}-${year}-${String(data).padStart(3, '0')}`
}

// Strip financial fields for non-finance roles
function sanitizeForRole(order, role) {
  if (FINANCE_ROLES.has(role)) return order
  const { internal_cost, estimated_profit, ...safe } = order
  return safe
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role) && auth.role !== 'super') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (id) {
      // Single order with related data
      const { data: order, error } = await adminSupabase
        .from('sales_orders')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) return Response.json({ error: error.message }, { status: 500 })
      if (!order) return Response.json({ error: 'Not found' }, { status: 404 })

      const [{ data: docs }, { data: tasks }, { data: updates }, { data: history }, { data: sigRequests }] = await Promise.all([
        adminSupabase.from('sales_order_docs').select('*').eq('order_id', id).order('created_at', { ascending: false }),
        adminSupabase.from('sales_order_tasks').select('*').eq('order_id', id).order('due_date', { ascending: true, nullsFirst: false }),
        adminSupabase.from('sales_order_updates').select('*').eq('order_id', id).order('created_at', { ascending: false }),
        adminSupabase.from('sales_order_history').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
        adminSupabase.from('sales_signature_requests').select('*').eq('order_id', id).order('created_at', { ascending: false }),
      ])

      return Response.json({
        data: {
          ...sanitizeForRole(order, auth.role),
          docs: docs || [],
          tasks: tasks || [],
          updates: updates || [],
          history: history || [],
          signature_requests: sigRequests || [],
        }
      })
    }

    // List orders with filters
    const division = searchParams.get('division')
    const stage    = searchParams.get('stage')
    const salesId  = searchParams.get('salesperson_id')
    const search   = searchParams.get('search')

    let q = adminSupabase
      .from('sales_orders')
      .select('id,order_number,division,stage,customer_name,customer_company,site_address,city,state,salesperson_name,ops_owner_name,quoted_amount,contract_value,expected_delivery_date,confirmed_delivery_date,expected_install_date,confirmed_install_date,created_at,updated_at,won_at,contract_signed_at,deposit_received,is_preview_data')
      .eq('is_preview_data', false)
      .order('updated_at', { ascending: false })

    if (division) q = q.eq('division', division)
    if (stage)    q = q.eq('stage', stage)
    if (salesId)  q = q.eq('salesperson_id', salesId)
    if (search)   q = q.or(`customer_name.ilike.%${search}%,customer_company.ilike.%${search}%,order_number.ilike.%${search}%,site_address.ilike.%${search}%`)

    const { data, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })

    const orders = (data || []).map(o => sanitizeForRole(o, auth.role))
    return Response.json({ data: orders })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { action } = body

    // ── Create ───────────────────────────────────────────────────────────────
    if (action === 'create') {
      if (!SALES_ROLES.has(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { fields } = body
      if (!fields?.division) return Response.json({ error: 'division required' }, { status: 400 })

      const order_number = await nextOrderNumber(fields.division)

      const { data, error } = await adminSupabase
        .from('sales_orders')
        .insert({
          ...fields,
          order_number,
          salesperson_id:   fields.salesperson_id   || auth.userId,
          salesperson_name: fields.salesperson_name || null,
          stage:            fields.stage            || 'lead',
        })
        .select('id, order_number')
        .single()

      if (error) return Response.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('sales_order_history').insert({
        order_id:   data.id,
        actor_id:   auth.userId,
        actor_name: fields.salesperson_name || 'System',
        action:     'created',
        details:    { order_number: data.order_number, division: fields.division },
      })

      return Response.json({ ok: true, id: data.id, order_number: data.order_number })
    }

    // ── Update fields ─────────────────────────────────────────────────────────
    if (action === 'update') {
      if (!SALES_ROLES.has(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { id, fields, actor_name } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })

      // Non-finance roles cannot update financial fields
      if (!FINANCE_ROLES.has(auth.role)) {
        delete fields.internal_cost
        delete fields.estimated_profit
      }

      const { error } = await adminSupabase
        .from('sales_orders')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) return Response.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('sales_order_history').insert({
        order_id:   id,
        actor_id:   auth.userId,
        actor_name: actor_name || 'Staff',
        action:     'updated',
        details:    { fields: Object.keys(fields) },
      })

      return Response.json({ ok: true })
    }

    // ── Stage change ──────────────────────────────────────────────────────────
    if (action === 'set_stage') {
      if (!SALES_ROLES.has(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { id, stage, actor_name } = body
      if (!id || !stage) return Response.json({ error: 'id and stage required' }, { status: 400 })

      const VALID_STAGES = ['lead','quoted','contract_signed','order_placed','scheduled','installed','completed','cancelled','on_hold']
      if (!VALID_STAGES.includes(stage)) return Response.json({ error: 'Invalid stage' }, { status: 400 })

      // Fetch current order for comparison
      const { data: current } = await adminSupabase.from('sales_orders').select('stage,order_number,salesperson_name').eq('id', id).maybeSingle()
      if (!current) return Response.json({ error: 'Not found' }, { status: 404 })

      // Auto-set timestamps on stage transitions
      const extra = {}
      if (stage === 'contract_signed' && !body.skip_timestamps) {
        extra.contract_signed_at = extra.contract_signed_at || new Date().toISOString()
        extra.won_at = extra.won_at || new Date().toISOString()
      }
      if (stage === 'completed') extra.completed_at = new Date().toISOString()
      if (stage === 'cancelled') extra.cancelled_at = new Date().toISOString()

      const { error } = await adminSupabase
        .from('sales_orders')
        .update({ stage, ...extra, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Log stage change to history
      await adminSupabase.from('sales_order_history').insert({
        order_id:   id,
        actor_id:   auth.userId,
        actor_name: actor_name || 'Staff',
        action:     'stage_change',
        details:    { from: current.stage, to: stage },
      })

      // Post an internal update recording the stage change
      await adminSupabase.from('sales_order_updates').insert({
        order_id:           id,
        author_id:          auth.userId,
        author_name:        actor_name || 'Staff',
        body:               `Stage changed: ${current.stage} → ${stage}`,
        visible_to_customer: false,
        update_type:        'status_change',
      })

      return Response.json({ ok: true })
    }

    // ── Convert lead to order (from metal_building_leads or roofing_leads) ────
    if (action === 'convert_lead') {
      if (!SALES_ROLES.has(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { lead_id, division, actor_name } = body
      if (!lead_id || !division) return Response.json({ error: 'lead_id and division required' }, { status: 400 })

      const table = division === 'metal_buildings' ? 'metal_building_leads' : 'roofing_leads'
      const { data: lead } = await adminSupabase.from(table).select('*').eq('id', lead_id).maybeSingle()
      if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

      const order_number = await nextOrderNumber(division)

      const orderFields = {
        order_number,
        division,
        stage:             'contract_signed',
        customer_name:     lead.contact_name,
        customer_company:  lead.company_name,
        customer_email:    lead.contact_email,
        customer_phone:    lead.contact_phone,
        site_address:      lead.address,
        salesperson_id:    auth.userId,
        salesperson_name:  actor_name || lead.assigned_to,
        quoted_amount:     lead.estimate_value,
        deposit_amount:    lead.deposit_amount,
        deposit_received:  lead.deposit_received,
        source_lead_id:    lead_id,
        won_at:            lead.won_date || new Date().toISOString(),
        contract_signed_at: new Date().toISOString(),
        // Metal building specific
        ...(division === 'metal_buildings' ? {
          width_ft:      lead.width_ft,
          length_ft:     lead.length_ft,
          height_ft:     lead.height_ft,
          building_use:  lead.building_use,
          supplier_id:   lead.supplier_id,
        } : {}),
        // Roofing specific
        ...(division === 'commercial_roofing' ? {
          roof_type:        lead.roof_type,
          roof_size_sqft:   lead.roof_size_sqft,
          building_type:    lead.building_type,
        } : {}),
      }

      const { data, error } = await adminSupabase
        .from('sales_orders')
        .insert(orderFields)
        .select('id, order_number')
        .single()

      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Mark the lead as won
      await adminSupabase.from(table).update({ stage: 'won', won_date: new Date().toISOString().split('T')[0] }).eq('id', lead_id)

      await adminSupabase.from('sales_order_history').insert({
        order_id:   data.id,
        actor_id:   auth.userId,
        actor_name: actor_name || 'Staff',
        action:     'created',
        details:    { source: 'converted_from_lead', lead_id, order_number: data.order_number },
      })

      return Response.json({ ok: true, id: data.id, order_number: data.order_number })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
