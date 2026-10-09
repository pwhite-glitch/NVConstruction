import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { notify } from '../../../lib/notify'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SALES_ROLES   = new Set(['pm','apm','admin','metal_rep','roofing_rep'])
const FINANCE_ROLES = new Set(['pm','apm','admin'])
const ADMIN_ROLES   = new Set(['pm','apm','admin'])

const VALID_STAGES = [
  'lead','quoted','contract_signed','order_placed',
  'scheduled','installed','completed','cancelled','on_hold',
]

// ─── Sequence number ──────────────────────────────────────────────────────────

async function nextOrderNumber(division) {
  const prefix = division === 'metal_buildings' ? 'MB' : 'RF'
  const year = new Date().getFullYear()
  const { data, error } = await adminSupabase.rpc('increment_sales_order_seq', { p_division: division, p_year: year })
  if (error || !data) return `${prefix}-${year}-${Date.now().toString().slice(-4)}`
  return `${prefix}-${year}-${String(data).padStart(3, '0')}`
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

function sanitizeForRole(order, role) {
  if (FINANCE_ROLES.has(role)) return order
  const { internal_cost, estimated_profit, ...safe } = order
  return safe
}

// ─── Stage-gate requirements ──────────────────────────────────────────────────
// Returns array of blocker strings; empty = allowed.

async function checkStageRequirements(order, toStage, docs) {
  const blockers = []

  if (toStage === 'contract_signed') {
    if (!order.contract_value || Number(order.contract_value) <= 0) {
      blockers.push('Contract value must be recorded before marking as contract signed')
    }
    // Require either a contract doc or a signature request
    const hasContractDoc = (docs || []).some(d => d.category === 'contract')
    if (!hasContractDoc) {
      blockers.push('Upload a signed contract document (category: contract) before advancing')
    }
  }

  if (toStage === 'order_placed') {
    // Require at least one supplier order with a confirmation number
    const { data: supplierOrders } = await adminSupabase
      .from('sales_supplier_orders')
      .select('id, status, confirmation_number')
      .eq('order_id', order.id)
    const hasConfirmedOrder = (supplierOrders || []).some(so => so.confirmation_number || so.status === 'confirmed')
    if (!hasConfirmedOrder) {
      blockers.push('At least one supplier order with a confirmation number or confirmed status is required')
    }
  }

  if (toStage === 'scheduled') {
    if (!order.confirmed_install_date) {
      blockers.push('Confirmed installation date must be set')
    }
    if (!order.install_crew) {
      blockers.push('Installation team / responsible installer must be assigned')
    }
    // Readiness checks: all required ones must be complete
    const { data: checks } = await adminSupabase
      .from('sales_order_readiness_checks')
      .select('label, status, required_for_scheduling')
      .eq('order_id', order.id)
      .eq('required_for_scheduling', true)
    const incomplete = (checks || []).filter(c => !['complete','na'].includes(c.status))
    incomplete.forEach(c => blockers.push(`Readiness check incomplete: ${c.label}`))
  }

  if (toStage === 'installed') {
    const hasCompletionPhoto = (docs || []).some(d => d.category === 'completion' || d.category === 'photo')
    if (!hasCompletionPhoto) {
      blockers.push('At least one completion photo or document must be attached')
    }
  }

  if (toStage === 'completed') {
    const hasCompletionDoc = (docs || []).some(d => ['completion','contract'].includes(d.category))
    if (!hasCompletionDoc) {
      blockers.push('At least one completion document must be attached')
    }
  }

  return blockers
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function notifyAssignees(order, action, actorId, actorName) {
  const link = `/sales/${order.id}`
  const label = order.order_number || 'Sales order'
  const dedup = `${action}_${order.id}_${new Date().toDateString()}`

  const targets = []
  if (order.salesperson_id   && order.salesperson_id   !== actorId) targets.push({ id: order.salesperson_id,  name: order.salesperson_name  })
  if (order.ops_owner_id     && order.ops_owner_id     !== actorId) targets.push({ id: order.ops_owner_id,   name: order.ops_owner_name    })

  for (const t of targets) {
    await notify({
      recipient_id: t.id,
      type:         'sales_order',
      title:        `${label}: ${action}`,
      body:         `By ${actorName}`,
      link,
      entity_type:  'sales_order',
      entity_id:    order.id,
      dedup_key:    `${dedup}_${t.id}`,
    })
  }
}

// ─── Salesperson lookup for UI dropdowns ──────────────────────────────────────

async function getSalesStaff() {
  const { data } = await adminSupabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['pm','apm','admin','metal_rep','roofing_rep'])
    .order('full_name')
  return data || []
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role) && auth.role !== 'super') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)

    // Return staff list for dropdowns
    if (searchParams.get('list') === 'staff') {
      const staff = await getSalesStaff()
      return Response.json({ data: staff })
    }

    const id = searchParams.get('id')

    if (id) {
      const { data: order, error } = await adminSupabase
        .from('sales_orders')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) return Response.json({ error: error.message }, { status: 500 })
      if (!order) return Response.json({ error: 'Not found' }, { status: 404 })

      const [
        { data: docs },
        { data: tasks },
        { data: updates },
        { data: history },
        { data: sigRequests },
        { data: payments },
        { data: supplierOrders },
        { data: readinessChecks },
        { data: attribution },
      ] = await Promise.all([
        adminSupabase.from('sales_order_docs').select('*').eq('order_id', id).order('created_at', { ascending: false }),
        adminSupabase.from('sales_order_tasks').select('*').eq('order_id', id).order('due_date', { ascending: true, nullsFirst: false }),
        adminSupabase.from('sales_order_updates').select('*').eq('order_id', id).order('created_at', { ascending: false }),
        adminSupabase.from('sales_order_history').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
        adminSupabase.from('sales_signature_requests').select('*').eq('order_id', id).order('created_at', { ascending: false }),
        adminSupabase.from('sales_order_payments').select('*').eq('order_id', id).order('payment_date', { ascending: false }),
        adminSupabase.from('sales_supplier_orders').select('*').eq('order_id', id).order('created_at', { ascending: true }),
        adminSupabase.from('sales_order_readiness_checks').select('*').eq('order_id', id).order('created_at'),
        adminSupabase.from('sales_attribution').select('*').eq('order_id', id),
      ])

      return Response.json({
        data: {
          ...sanitizeForRole(order, auth.role),
          docs:             docs            || [],
          tasks:            tasks           || [],
          updates:          updates         || [],
          history:          history         || [],
          signature_requests: sigRequests   || [],
          payments:         FINANCE_ROLES.has(auth.role) ? (payments || []) : [],
          supplier_orders:  supplierOrders  || [],
          readiness_checks: readinessChecks || [],
          attribution:      attribution     || [],
        }
      })
    }

    // List orders with filters
    const division  = searchParams.get('division')
    const stage     = searchParams.get('stage')
    const salesId   = searchParams.get('salesperson_id')
    const search    = searchParams.get('search')

    let q = adminSupabase
      .from('sales_orders')
      .select('id,order_number,division,stage,payment_status,delivery_status,installation_status,customer_name,customer_company,site_address,city,state,salesperson_id,salesperson_name,ops_owner_name,quoted_amount,contract_value,expected_delivery_date,confirmed_delivery_date,expected_install_date,confirmed_install_date,created_at,updated_at,won_at,contract_signed_at,deposit_received,is_preview_data')
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

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { action } = body

    // ── Create ────────────────────────────────────────────────────────────────
    if (action === 'create') {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { fields } = body
      if (!fields?.division) return Response.json({ error: 'division required' }, { status: 400 })

      // Look up salesperson name from profiles if id given but no name
      let salesperson_name = fields.salesperson_name || null
      const salesperson_id = fields.salesperson_id || auth.userId
      if (!salesperson_name && salesperson_id) {
        const { data: prof } = await adminSupabase.from('profiles').select('full_name').eq('id', salesperson_id).maybeSingle()
        salesperson_name = prof?.full_name || null
      }

      const order_number = await nextOrderNumber(fields.division)
      const { data, error } = await adminSupabase
        .from('sales_orders')
        .insert({
          ...fields,
          order_number,
          salesperson_id,
          salesperson_name,
          stage: fields.stage || 'lead',
        })
        .select('id, order_number')
        .single()

      if (error) return Response.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('sales_order_history').insert({
        order_id:   data.id,
        actor_id:   auth.userId,
        actor_name: salesperson_name || 'Staff',
        action:     'created',
        details:    { order_number: data.order_number, division: fields.division },
      })

      // Notify salesperson if someone else created the order on their behalf
      if (salesperson_id && salesperson_id !== auth.userId) {
        await notify({
          recipient_id: salesperson_id,
          type:         'sales_order',
          title:        `New order assigned to you: ${data.order_number}`,
          link:         `/sales/${data.id}`,
          entity_type:  'sales_order',
          entity_id:    data.id,
          dedup_key:    `assigned_${data.id}`,
        })
      }

      // Seed readiness checks from template
      const { data: templates } = await adminSupabase
        .from('sales_readiness_templates')
        .select('*')
        .eq('division', fields.division)
        .order('sort_order')
      if (templates?.length) {
        await adminSupabase.from('sales_order_readiness_checks').insert(
          templates.map(t => ({
            order_id:                data.id,
            check_type:              t.check_type,
            label:                   t.label,
            required_for_scheduling: t.required_for_scheduling,
          }))
        )
      }

      return Response.json({ ok: true, id: data.id, order_number: data.order_number })
    }

    // ── Update fields ─────────────────────────────────────────────────────────
    if (action === 'update') {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { id, fields, actor_name } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })

      if (!FINANCE_ROLES.has(auth.role)) {
        delete fields.internal_cost
        delete fields.estimated_profit
      }

      // Convert empty-string date fields to null — Postgres rejects "" for date columns
      const DATE_FIELDS = ['expected_delivery_date','confirmed_delivery_date','deposit_received_date','expected_install_date','confirmed_install_date']
      for (const f of DATE_FIELDS) {
        if (f in fields && (fields[f] === '' || fields[f] === undefined)) fields[f] = null
      }

      // If salesperson_id changed, look up the name
      if (fields.salesperson_id && !fields.salesperson_name) {
        const { data: prof } = await adminSupabase.from('profiles').select('full_name').eq('id', fields.salesperson_id).maybeSingle()
        if (prof?.full_name) fields.salesperson_name = prof.full_name
      }

      // Fetch current values to compute before/after diff for history
      const { data: before } = await adminSupabase.from('sales_orders').select('*').eq('id', id).maybeSingle()

      const { error } = await adminSupabase
        .from('sales_orders')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Notify new salesperson on reassignment
      if (fields.salesperson_id && fields.salesperson_id !== auth.userId) {
        await notify({
          recipient_id: fields.salesperson_id,
          type:         'sales_order',
          title:        `Sales order assigned to you`,
          link:         `/sales/${id}`,
          entity_type:  'sales_order',
          entity_id:    id,
          dedup_key:    `reassigned_${id}_${fields.salesperson_id}`,
        })
      }
      if (fields.ops_owner_id && fields.ops_owner_id !== auth.userId) {
        await notify({
          recipient_id: fields.ops_owner_id,
          type:         'sales_order',
          title:        `You are now ops owner for a sales order`,
          link:         `/sales/${id}`,
          entity_type:  'sales_order',
          entity_id:    id,
          dedup_key:    `ops_owner_${id}_${fields.ops_owner_id}`,
        })
      }

      // Diff against before-state so history shows what actually changed
      const OMIT_FROM_HISTORY = new Set(['updated_at','salesperson_name','ops_owner_name'])
      const changed = {}
      for (const [key, val] of Object.entries(fields)) {
        if (OMIT_FROM_HISTORY.has(key)) continue
        if (!before || String(before[key]) !== String(val ?? '')) {
          changed[key] = { from: before?.[key] ?? null, to: val ?? null }
        }
      }

      if (Object.keys(changed).length > 0) {
        await adminSupabase.from('sales_order_history').insert({
          order_id:   id,
          actor_id:   auth.userId,
          actor_name: actor_name || 'Staff',
          action:     'updated',
          details:    { changed },
        })
      }

      return Response.json({ ok: true })
    }

    // ── Stage change (with gate enforcement) ──────────────────────────────────
    if (action === 'set_stage') {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { id, stage, actor_name, override_reason } = body
      if (!id || !stage) return Response.json({ error: 'id and stage required' }, { status: 400 })
      if (!VALID_STAGES.includes(stage)) return Response.json({ error: 'Invalid stage' }, { status: 400 })

      const { data: order } = await adminSupabase
        .from('sales_orders')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (!order) return Response.json({ error: 'Not found' }, { status: 404 })

      const { data: docs } = await adminSupabase
        .from('sales_order_docs')
        .select('id, category')
        .eq('order_id', id)

      // Check gate requirements
      const blockers = await checkStageRequirements(order, stage, docs || [])

      if (blockers.length > 0) {
        // Admins can override with a reason
        if (ADMIN_ROLES.has(auth.role) && override_reason) {
          // Log override
          await adminSupabase.from('sales_stage_gate_log').insert({
            order_id:       id,
            actor_id:       auth.userId,
            actor_name:     actor_name || 'Staff',
            from_stage:     order.stage,
            to_stage:       stage,
            outcome:        'override',
            blockers:       blockers,
            override_reason,
          })
          await adminSupabase.from('sales_orders').update({ override_stage_reason: override_reason }).eq('id', id)
        } else {
          // Not authorized or no reason given — return blockers
          await adminSupabase.from('sales_stage_gate_log').insert({
            order_id:   id,
            actor_id:   auth.userId,
            actor_name: actor_name || 'Staff',
            from_stage: order.stage,
            to_stage:   stage,
            outcome:    'blocked',
            blockers,
          })
          return Response.json({ blocked: true, blockers }, { status: 422 })
        }
      } else {
        await adminSupabase.from('sales_stage_gate_log').insert({
          order_id:   id,
          actor_id:   auth.userId,
          actor_name: actor_name || 'Staff',
          from_stage: order.stage,
          to_stage:   stage,
          outcome:    'allowed',
          blockers:   [],
        })
      }

      // Build extra timestamps
      const extra = {}
      const now   = new Date().toISOString()

      if (stage === 'on_hold') {
        extra.prev_stage  = order.stage
        extra.hold_reason = body.hold_reason || null
      }
      if (stage === 'contract_signed' && !order.contract_signed_at) {
        extra.contract_signed_at      = now
        extra.won_at                  = now
        extra.signed_salesperson_id   = order.salesperson_id
        extra.signed_salesperson_name = order.salesperson_name
        extra.signed_contract_value   = order.contract_value
        // Seed attribution record at signing if none exists
        const { count } = await adminSupabase
          .from('sales_attribution')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', id)
        if ((count || 0) === 0 && order.salesperson_id) {
          await adminSupabase.from('sales_attribution').insert({
            order_id:        id,
            salesperson_id:  order.salesperson_id,
            salesperson_name: order.salesperson_name || 'Unknown',
            share_pct:       100,
            recorded_by:     auth.userId,
          })
        }
      }
      if (stage === 'scheduled') {
        extra.installation_status = 'scheduled'
      }
      if (stage === 'installed') {
        extra.installation_status = 'installed'
      }
      if (stage === 'completed') {
        extra.completed_at = now
        extra.installation_status = 'installed'
      }
      if (stage === 'cancelled') {
        extra.cancelled_at     = now
        extra.cancelled_reason = body.cancelled_reason || null
      }
      if (override_reason) {
        extra.override_stage_reason = override_reason
      }

      const { error } = await adminSupabase
        .from('sales_orders')
        .update({ stage, ...extra, updated_at: now })
        .eq('id', id)

      if (error) return Response.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('sales_order_history').insert({
        order_id:   id,
        actor_id:   auth.userId,
        actor_name: actor_name || 'Staff',
        action:     'stage_change',
        details:    { from: order.stage, to: stage, override_reason: override_reason || null },
      })

      await adminSupabase.from('sales_order_updates').insert({
        order_id:            id,
        author_id:           auth.userId,
        author_name:         actor_name || 'Staff',
        body:                `Stage changed: ${order.stage} → ${stage}${override_reason ? ` (override: ${override_reason})` : ''}`,
        visible_to_customer: false,
        update_type:         'status_change',
      })

      // Notify assignees
      const updatedOrder = { ...order, stage, ...extra }
      await notifyAssignees(updatedOrder, `Stage → ${stage}`, auth.userId, actor_name || 'Staff')

      return Response.json({ ok: true })
    }

    // ── Convert lead → order ──────────────────────────────────────────────────
    if (action === 'convert_lead') {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { lead_id, division, actor_name } = body
      if (!lead_id || !division) return Response.json({ error: 'lead_id and division required' }, { status: 400 })

      // Check for existing conversion to prevent duplicates
      const { data: existing } = await adminSupabase
        .from('sales_orders')
        .select('id, order_number')
        .eq('source_lead_id', lead_id)
        .maybeSingle()
      if (existing) {
        return Response.json({ ok: true, id: existing.id, order_number: existing.order_number, already_converted: true })
      }

      const table = division === 'metal_buildings' ? 'metal_building_leads' : 'roofing_leads'
      const { data: lead } = await adminSupabase.from(table).select('*').eq('id', lead_id).maybeSingle()
      if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

      // Preserve original assigned_to from lead; look up their name
      const salesperson_id = lead.assigned_to || auth.userId
      let salesperson_name = null
      if (salesperson_id) {
        const { data: prof } = await adminSupabase.from('profiles').select('full_name').eq('id', salesperson_id).maybeSingle()
        salesperson_name = prof?.full_name || null
      }

      const order_number = await nextOrderNumber(division)

      // Convert "won" lead → contract_signed stage only if won_date is explicitly set
      // Otherwise create as "quoted" (no automatic contract assumption)
      const initialStage = lead.stage === 'won' && lead.won_date ? 'contract_signed' : 'quoted'

      const orderFields = {
        order_number,
        division,
        stage:             initialStage,
        customer_name:     lead.contact_name,
        customer_company:  lead.company_name,
        customer_email:    lead.contact_email,
        customer_phone:    lead.contact_phone,
        site_address:      lead.address,
        salesperson_id,
        salesperson_name,
        quoted_amount:     lead.estimate_value,
        deposit_amount:    lead.deposit_amount  || null,
        deposit_received:  lead.deposit_received || false,
        source_lead_id:    lead_id,
        internal_notes:    lead.notes || null,
        // Metal building specific
        ...(division === 'metal_buildings' ? {
          width_ft:     lead.width_ft,
          length_ft:    lead.length_ft,
          height_ft:    lead.height_ft,
          building_use: lead.building_use,
          supplier_id:  lead.supplier_id,
        } : {}),
        // Roofing specific
        ...(division === 'commercial_roofing' ? {
          roof_type:      lead.roof_type,
          roof_size_sqft: lead.roof_size_sqft,
          building_type:  lead.building_type,
        } : {}),
      }

      // Only set contract timestamps if genuinely won
      if (initialStage === 'contract_signed') {
        orderFields.won_at             = lead.won_date ? new Date(lead.won_date).toISOString() : new Date().toISOString()
        orderFields.contract_signed_at = orderFields.won_at
        orderFields.signed_salesperson_id   = salesperson_id
        orderFields.signed_salesperson_name = salesperson_name
        orderFields.signed_contract_value   = lead.estimate_value
      }

      const { data, error } = await adminSupabase
        .from('sales_orders')
        .insert(orderFields)
        .select('id, order_number')
        .single()

      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Mark lead won (only if genuinely won)
      if (lead.stage === 'won') {
        await adminSupabase.from(table)
          .update({ stage: 'won', won_date: lead.won_date || new Date().toISOString().split('T')[0] })
          .eq('id', lead_id)
      }

      await adminSupabase.from('sales_order_history').insert({
        order_id:   data.id,
        actor_id:   auth.userId,
        actor_name: actor_name || 'Staff',
        action:     'created',
        details:    { source: 'converted_from_lead', lead_id, order_number: data.order_number, original_salesperson_id: salesperson_id },
      })

      // Seed attribution record if contract_signed
      if (initialStage === 'contract_signed' && salesperson_id) {
        await adminSupabase.from('sales_attribution').insert({
          order_id:        data.id,
          salesperson_id,
          salesperson_name: salesperson_name || 'Unknown',
          share_pct:       100,
          recorded_by:     auth.userId,
        })
      }

      // Seed readiness checks
      const { data: templates } = await adminSupabase
        .from('sales_readiness_templates')
        .select('*')
        .eq('division', division)
        .order('sort_order')
      if (templates?.length) {
        await adminSupabase.from('sales_order_readiness_checks').insert(
          templates.map(t => ({
            order_id:                data.id,
            check_type:              t.check_type,
            label:                   t.label,
            required_for_scheduling: t.required_for_scheduling,
          }))
        )
      }

      // Notify salesperson if conversion was done by someone else
      if (salesperson_id && salesperson_id !== auth.userId) {
        await notify({
          recipient_id: salesperson_id,
          type:         'sales_order',
          title:        `Your lead was converted to ${data.order_number}`,
          link:         `/sales/${data.id}`,
          entity_type:  'sales_order',
          entity_id:    data.id,
          dedup_key:    `converted_${data.id}`,
        })
      }

      return Response.json({ ok: true, id: data.id, order_number: data.order_number, stage: initialStage })
    }

    // ── Record payment ─────────────────────────────────────────────────────────
    if (action === 'record_payment') {
      if (!FINANCE_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { id, payment_type, amount, payment_date, reference, notes } = body
      if (!id || !amount) return Response.json({ error: 'id and amount required' }, { status: 400 })

      const { error } = await adminSupabase.from('sales_order_payments').insert({
        order_id:        id,
        payment_type:    payment_type || 'deposit',
        amount,
        payment_date:    payment_date || new Date().toISOString().split('T')[0],
        reference,
        notes,
        recorded_by:     auth.userId,
        recorded_by_name: body.actor_name || 'Staff',
      })
      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Update payment_status based on totals
      const { data: payments } = await adminSupabase
        .from('sales_order_payments')
        .select('payment_type, amount')
        .eq('order_id', id)
      const { data: order } = await adminSupabase
        .from('sales_orders')
        .select('contract_value, payment_status')
        .eq('id', id)
        .maybeSingle()

      const total = (payments || []).reduce((s, p) => s + (p.payment_type === 'refund' ? -Number(p.amount) : Number(p.amount)), 0)
      const contractVal = Number(order?.contract_value || 0)
      let newStatus = 'deposit_received'
      if (total <= 0) newStatus = 'none'
      else if (contractVal > 0 && total >= contractVal * 0.99) newStatus = 'paid'
      else if (total > 0 && (payments || []).some(p => p.payment_type === 'deposit')) newStatus = 'deposit_received'
      else if (total > 0) newStatus = 'partial'

      await adminSupabase.from('sales_orders').update({ payment_status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
      await adminSupabase.from('sales_order_history').insert({
        order_id:   id, actor_id: auth.userId, actor_name: body.actor_name || 'Staff',
        action:     'payment_recorded',
        details:    { payment_type, amount, reference },
      })

      return Response.json({ ok: true, new_payment_status: newStatus })
    }

    // ── Update readiness check ─────────────────────────────────────────────────
    if (action === 'update_readiness') {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { check_id, status: checkStatus, notes, responsible_name } = body
      if (!check_id) return Response.json({ error: 'check_id required' }, { status: 400 })

      const extra = {}
      if (['complete','na'].includes(checkStatus)) {
        extra.completed_at      = new Date().toISOString()
        extra.completed_by      = auth.userId
        extra.completed_by_name = body.actor_name || 'Staff'
      }
      const { error } = await adminSupabase
        .from('sales_order_readiness_checks')
        .update({ status: checkStatus, notes, responsible_name, ...extra })
        .eq('id', check_id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    // ── Update attribution (split sale) ───────────────────────────────────────
    if (action === 'set_attribution') {
      if (!FINANCE_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { id, splits } = body  // splits: [{salesperson_id, salesperson_name, share_pct}]
      if (!id || !splits?.length) return Response.json({ error: 'id and splits required' }, { status: 400 })
      const total = splits.reduce((s, x) => s + Number(x.share_pct), 0)
      if (Math.abs(total - 100) > 0.01) return Response.json({ error: 'Splits must total 100%' }, { status: 400 })

      // Delete existing, reinsert
      await adminSupabase.from('sales_attribution').delete().eq('order_id', id)
      const { error } = await adminSupabase.from('sales_attribution').insert(
        splits.map(s => ({ order_id: id, ...s, recorded_by: auth.userId }))
      )
      if (error) return Response.json({ error: error.message }, { status: 500 })
      await adminSupabase.from('sales_order_history').insert({
        order_id: id, actor_id: auth.userId, actor_name: body.actor_name || 'Staff',
        action:   'attribution_set',
        details:  { splits },
      })
      return Response.json({ ok: true })
    }

    // ── Supplier order actions ─────────────────────────────────────────────────
    if (action === 'create_supplier_order') {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { id, fields } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      const { data: so, error } = await adminSupabase.from('sales_supplier_orders').insert({
        order_id: id, ...fields,
        created_by: auth.userId, created_by_name: body.actor_name || 'Staff',
      }).select('id').single()
      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Update delivery_status to 'ordered' if first supplier order
      const { data: existing } = await adminSupabase.from('sales_orders').select('delivery_status').eq('id', id).maybeSingle()
      if (existing?.delivery_status === 'not_ordered') {
        await adminSupabase.from('sales_orders').update({ delivery_status: 'ordered', updated_at: new Date().toISOString() }).eq('id', id)
      }
      return Response.json({ ok: true, id: so.id })
    }

    if (action === 'update_supplier_order') {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { supplier_order_id, fields } = body
      if (!supplier_order_id) return Response.json({ error: 'supplier_order_id required' }, { status: 400 })
      const { error } = await adminSupabase
        .from('sales_supplier_orders')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', supplier_order_id)
      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Sync delivery_status on the parent sales order
      if (fields.status) {
        const { data: soRow } = await adminSupabase
          .from('sales_supplier_orders')
          .select('order_id')
          .eq('id', supplier_order_id)
          .maybeSingle()
        if (soRow) {
          const { data: allSO } = await adminSupabase
            .from('sales_supplier_orders')
            .select('status')
            .eq('order_id', soRow.order_id)
          const statuses = (allSO || []).map(x => x.status)
          let deliveryStatus = 'ordered'
          if (statuses.every(s => s === 'delivered')) deliveryStatus = 'delivered'
          else if (statuses.some(s => s === 'partially_delivered')) deliveryStatus = 'partially_delivered'
          else if (statuses.some(s => s === 'exception')) deliveryStatus = 'exception'
          await adminSupabase.from('sales_orders').update({ delivery_status: deliveryStatus, updated_at: new Date().toISOString() }).eq('id', soRow.order_id)
        }
      }
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
