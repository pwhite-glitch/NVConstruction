import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { notify } from '../../../lib/notify'
import { todayCentral } from '../../../lib/central-date'
import { buildAttributionRows } from '../../../lib/sales-attribution'
import { fetchAll } from '../../../lib/budget-line-refs'
import { Resend } from 'resend'
import { isMb, MB, canWorkMbOrder, checkMbUpdate, checkMbCreate, isOffice, mbStageNeeds, validDepositAmount } from '../../../lib/mb-orders'
import { mbRequestsForOrder, actorName, SCHEMA_HINT, lockErrorMessage, preflightWorkflow, supplierTurnIn } from '../../../lib/mb-server'
import { handleMbAction, syncMbPayment, carryLeadReceipt, mbDetailProjection, commissionReport, settingsView, mbSupplierList } from '../../../lib/mb-actions'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const PAYMENT_TYPES = new Set(['deposit', 'progress', 'final', 'refund', 'other'])
// Never taken from a client on supplier-order rows (reparenting / actor spoofing).
const SUPPLIER_ORDER_FIXED = ['id', 'order_id', 'created_by', 'created_by_name', 'created_at']
const stripFixed = fields => {
  const out = { ...(fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {}) }
  for (const k of SUPPLIER_ORDER_FIXED) delete out[k]
  return out
}

// MB order access for generic actions: office, or a metal_rep on the order.
async function mbGuard(order, auth) {
  const { data: attribution, error } = await adminSupabase.from('sales_attribution').select('salesperson_id').eq('order_id', order.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!canWorkMbOrder(auth, order, attribution || [])) return Response.json({ error: 'You are not on this order.' }, { status: 403 })
  return null
}

const SALES_ROLES   = new Set(['principal','pm','apm','admin','metal_rep','roofing_rep'])
const FINANCE_ROLES = new Set(['principal','pm','apm','admin'])
const ADMIN_ROLES   = new Set(['principal','pm','apm','admin'])

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
// Returns { blockers, hard }: blockers may be overridden by office with a reason;
// hard blockers (the metal-building signing / supplier turn-in sequence) never can.

async function checkStageRequirements(order, toStage, docs) {
  const blockers = []
  const hard = []
  const mb = isMb(order)

  // Metal buildings: contract_signed needs a SIGNED native client-order-form request and
  // order_placed needs the recorded supplier-form turn-in (also when jumping past them).
  if (mb) {
    const need = mbStageNeeds(order, toStage)
    if (need.signed) {
      const reqs = await mbRequestsForOrder(adminSupabase, order.id)
      if (reqs.error) hard.push(reqs.missingSchema ? SCHEMA_HINT : `Could not check the client order form signature: ${reqs.error.message}`)
      else if (!reqs.signed) hard.push('The client order form must be signed by the customer (Send for signature) first. An uploaded contract document is not enough for metal-building orders.')
    }
    if (need.turnedIn) {
      const t = await supplierTurnIn(adminSupabase, order.id)
      if (t.error) hard.push(t.error)
      else if (!t.turnedIn) hard.push("The supplier's order form must be turned in (Turn in supplier order form) first. A supplier order row or confirmation number is not enough for metal-building orders.")
    }
  }

  if (toStage === 'contract_signed') {
    if (!order.contract_value || Number(order.contract_value) <= 0) {
      blockers.push('Contract value must be recorded before marking as contract signed')
    }
    // Roofing: require a contract doc (MB uses the native signature above instead)
    const hasContractDoc = (docs || []).some(d => d.category === 'contract')
    if (!mb && !hasContractDoc) {
      blockers.push('Upload a signed contract document (category: contract) before advancing')
    }
  }

  if (toStage === 'order_placed' && !mb) {
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

  return { blockers, hard }
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
    .in('role', ['principal','pm','apm','admin','metal_rep','roofing_rep'])
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

    // Metal-building reads
    if (searchParams.get('list') === 'mb_suppliers') return mbSupplierList(adminSupabase)
    if (searchParams.get('mb') === 'settings') return settingsView(adminSupabase, auth)
    if (searchParams.get('mb') === 'commission_report') return commissionReport(adminSupabase, auth, searchParams)
    if (searchParams.get('mb')) return Response.json({ error: 'Unknown request' }, { status: 400 })

    const id = searchParams.get('id')

    if (id) {
      const { data: order, error } = await adminSupabase
        .from('sales_orders')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) return Response.json({ error: error.message }, { status: 500 })
      if (!order) return Response.json({ error: 'Not found' }, { status: 404 })
      // Roofing reps are scoped to roofing (as in the list).
      if (isMb(order) && auth.role === 'roofing_rep') return Response.json({ error: 'Forbidden' }, { status: 403 })

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
        { data: portalAccess },
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
        adminSupabase.from('customer_portal_access').select('id,email,name,invited_at,last_accessed_at,revoked_at,invited_by_name').eq('order_id', id).order('invited_at', { ascending: false }),
      ])

      const mb = isMb(order) ? await mbDetailProjection(adminSupabase, auth, order, docs || [], attribution || []) : undefined

      return Response.json({
        data: {
          ...sanitizeForRole(order, auth.role),
          ...(mb ? { mb } : {}),
          docs:             docs            || [],
          tasks:            tasks           || [],
          updates:          updates         || [],
          history:          history         || [],
          signature_requests: sigRequests   || [],
          payments:         FINANCE_ROLES.has(auth.role) ? (payments || []) : [],
          supplier_orders:  supplierOrders  || [],
          readiness_checks: readinessChecks || [],
          attribution:      attribution     || [],
          portal_access:    portalAccess    || [],
        }
      })
    }

    // List orders with filters
    const stage     = searchParams.get('stage')
    const salesId   = searchParams.get('salesperson_id')
    const search    = searchParams.get('search')

    // Division reps are scoped to their own division regardless of query param
    const roleDivision = auth.role === 'metal_rep' ? 'metal_buildings' : auth.role === 'roofing_rep' ? 'commercial_roofing' : null
    const division = roleDivision || searchParams.get('division')

    // Paged until exhausted (1000 per request) so lists over PostgREST's row cap are complete.
    const listQuery = () => {
      let q = adminSupabase
        .from('sales_orders')
        .select('id,order_number,division,stage,payment_status,delivery_status,installation_status,customer_name,customer_company,site_address,city,state,salesperson_id,salesperson_name,ops_owner_name,quoted_amount,contract_value,expected_delivery_date,confirmed_delivery_date,expected_install_date,confirmed_install_date,created_at,updated_at,won_at,contract_signed_at,deposit_received,is_preview_data')
        .eq('is_preview_data', false)
        .order('updated_at', { ascending: false })
        .order('id')

      if (division) q = q.eq('division', division)
      if (stage)    q = q.eq('stage', stage)
      if (salesId)  q = q.eq('salesperson_id', salesId)
      if (search)   q = q.or(`customer_name.ilike.%${search}%,customer_company.ilike.%${search}%,order_number.ilike.%${search}%,site_address.ilike.%${search}%`)
      return q
    }

    const { data, error } = await fetchAll(listQuery)
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request' }, { status: 400 })
    const { action } = body

    // ── Metal-building workflow actions (dedicated, allow-listed) ─────────────
    if (typeof action === 'string' && action.startsWith('mb_')) {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      return handleMbAction(adminSupabase, resend, auth, body)
    }

    // ── Create ────────────────────────────────────────────────────────────────
    if (action === 'create') {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      let { fields } = body
      if (!fields?.division) return Response.json({ error: 'division required' }, { status: 400 })
      if (fields.division === MB) {
        const chk = checkMbCreate(auth, fields)
        if (chk.error) return Response.json({ error: chk.error }, { status: chk.status })
        fields = chk.fields
      }

      // Normalize optional UUID fields — empty string is invalid for uuid columns
      if (fields.ops_owner_id === '') fields.ops_owner_id = null
      if (fields.salesperson_id === '') fields.salesperson_id = null

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
      let { id, fields, actor_name } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return Response.json({ error: 'fields required' }, { status: 400 })

      // Resolve the real order first; metal-building orders use an allow-list.
      const { data: current, error: curErr } = await adminSupabase.from('sales_orders').select('*').eq('id', id).maybeSingle()
      if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
      if (!current) return Response.json({ error: 'Not found' }, { status: 404 })
      // A non-MB order can never be turned into a metal-building order by a generic save
      // (that would skip the MB allow-list, receipt and signing rules). Nothing is written.
      if (!isMb(current) && 'division' in fields && String(fields.division ?? '').trim().toLowerCase() === MB) {
        return Response.json({ error: 'An order cannot be moved into Metal Buildings. Create a new metal-building order instead.' }, { status: 403 })
      }
      if (isMb(current)) {
        const denied = await mbGuard(current, auth)
        if (denied) return denied
        const reqs = await mbRequestsForOrder(adminSupabase, id)
        if (reqs.error && !reqs.missingSchema) return Response.json({ error: reqs.error.message }, { status: 500 })
        const chk = checkMbUpdate(auth, current, fields, { locked: !!(reqs.pending || reqs.signed) })
        if (chk.error) return Response.json({ error: chk.error }, { status: chk.status })
        fields = chk.fields
        actor_name = await actorName(adminSupabase, auth.userId)
        if (!Object.keys(fields).length) return Response.json({ ok: true, unchanged: true })
      }

      if (!FINANCE_ROLES.has(auth.role)) {
        delete fields.internal_cost
        delete fields.estimated_profit
      }

      // Convert empty-string date fields to null — Postgres rejects "" for date columns
      const DATE_FIELDS = ['expected_delivery_date','confirmed_delivery_date','deposit_received_date','expected_install_date','confirmed_install_date']
      for (const f of DATE_FIELDS) {
        if (f in fields && (fields[f] === '' || fields[f] === undefined)) fields[f] = null
      }

      // Convert empty-string UUID fields to null — Postgres rejects "" for uuid columns
      const UUID_FIELDS = ['salesperson_id', 'ops_owner_id']
      for (const f of UUID_FIELDS) {
        if (f in fields && (fields[f] === '' || fields[f] === undefined)) fields[f] = null
      }

      // If salesperson_id changed, look up the name
      if (fields.salesperson_id && !fields.salesperson_name) {
        const { data: prof } = await adminSupabase.from('profiles').select('full_name').eq('id', fields.salesperson_id).maybeSingle()
        if (prof?.full_name) fields.salesperson_name = prof.full_name
      }

      // Fetch current values to compute before/after diff for history
      const before = current

      // On MB orders the DB itself refuses (migration 050 trigger, under the order row
      // lock) a change to deposit amount / customer name / email / supplier while a
      // pending or signed client-form request exists, or to the deposit amount once the
      // deposit is received — so a request created after the check above still wins.
      const { error } = await adminSupabase
        .from('sales_orders')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) {
        const locked = isMb(current) ? lockErrorMessage(error) : null
        if (locked) return Response.json({ error: locked }, { status: 409 })
        return Response.json({ error: error.message }, { status: 500 })
      }

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

      const { data: order, error: orderErr } = await adminSupabase
        .from('sales_orders')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (orderErr) return Response.json({ error: orderErr.message }, { status: 500 })
      if (!order) return Response.json({ error: 'Not found' }, { status: 404 })
      if (isMb(order)) {
        const denied = await mbGuard(order, auth)
        if (denied) return denied
      }

      const { data: docs } = await adminSupabase
        .from('sales_order_docs')
        .select('id, category')
        .eq('order_id', id)

      // Check gate requirements
      const { blockers, hard } = await checkStageRequirements(order, stage, docs || [])

      // Metal-building sequence gates: no override for anyone.
      if (hard.length > 0) {
        await adminSupabase.from('sales_stage_gate_log').insert({
          order_id:   id,
          actor_id:   auth.userId,
          actor_name: actor_name || 'Staff',
          from_stage: order.stage,
          to_stage:   stage,
          outcome:    'blocked',
          blockers:   [...hard, ...blockers],
        })
        return Response.json({ blocked: true, blockers: [...hard, ...blockers], override_allowed: false }, { status: 422 })
      }

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

      // Metal buildings: only office staff carry a lead's "deposit received" over (it
      // makes the commission deposit leg eligible); reps record it via the order. A carried
      // receipt needs the workflow schema (received-amount snapshot): check it before any
      // insert, and never create a received MB order without its snapshot.
      const mbCarryReceipt = division === MB && isOffice(auth.role) && lead.deposit_received === true
      let mbReceiptWarning = null
      if (mbCarryReceipt) {
        const pf = await preflightWorkflow(adminSupabase, null)
        if (pf.error) return Response.json({ error: pf.error }, { status: pf.status })
        if (!validDepositAmount(lead.deposit_amount)) mbReceiptWarning = 'The lead is marked deposit received but has no deposit amount, so the receipt was not carried over. Save the deposit amount on the order, then record the deposit.'
      }

      const order_number = await nextOrderNumber(division)

      // Convert "won" lead → contract_signed stage only if won_date is explicitly set
      // Otherwise create as "quoted" (no automatic contract assumption).
      // Metal buildings always start as "quoted": a lead's won date is not a signature;
      // the native client-order-form signing records the real one.
      const initialStage = division !== MB && lead.stage === 'won' && lead.won_date ? 'contract_signed' : 'quoted'

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
        // Metal buildings are always inserted NOT received; a carried receipt is recorded
        // just below together with its snapshot.
        deposit_received:  division === MB ? false : (lead.deposit_received || false),
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
        .select('id, order_number, deposit_received, deposit_received_date, payment_status')
        .single()

      if (error) return Response.json({ error: error.message }, { status: 500 })

      if (mbCarryReceipt && !mbReceiptWarning) {
        const carried = await carryLeadReceipt(adminSupabase, auth, data)
        if (carried.error) {
          // Do not leave the new order behind (and never a received one without its snapshot).
          const { error: delErr } = await adminSupabase.from('sales_orders').delete().eq('id', data.id)
          if (delErr) {
            return Response.json({ error: carried.rollbackFailed
              ? `The lead's deposit receipt could not be recorded (${carried.error}) and order ${data.order_number} could not be removed. It shows "received" without its received amount; the Owner must review it.`
              : `Order ${data.order_number} was created NOT received: the lead's deposit receipt could not be recorded (${carried.error}). Record the deposit on the order.` }, { status: 500 })
          }
          return Response.json({ error: `The lead was not converted: its deposit receipt could not be recorded (${carried.error}).` }, { status: carried.status || 500 })
        }
      }

      // Mark lead won (only if genuinely won)
      if (lead.stage === 'won') {
        await adminSupabase.from(table)
          .update({ stage: 'won', won_date: lead.won_date || todayCentral() })
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

      return Response.json({ ok: true, id: data.id, order_number: data.order_number, stage: initialStage, ...(mbReceiptWarning ? { warning: mbReceiptWarning } : {}) })
    }

    // ── Record payment ─────────────────────────────────────────────────────────
    if (action === 'record_payment') {
      if (!FINANCE_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { id, payment_type, amount, payment_date, reference, notes } = body
      if (!id || amount === undefined || amount === null || amount === '') return Response.json({ error: 'id and amount required' }, { status: 400 })
      const amt = typeof amount === 'number' ? amount : (typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : NaN)
      if (!Number.isFinite(amt) || amt <= 0) return Response.json({ error: 'Amount must be a positive number (record refunds as type "refund").' }, { status: 400 })
      if (payment_type !== undefined && payment_type !== null && !PAYMENT_TYPES.has(payment_type)) return Response.json({ error: 'Invalid payment type' }, { status: 400 })
      if (payment_date !== undefined && payment_date !== null && payment_date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(payment_date))) return Response.json({ error: 'payment_date must be YYYY-MM-DD' }, { status: 400 })

      const { data: payOrder, error: payOrderErr } = await adminSupabase.from('sales_orders').select('*').eq('id', id).maybeSingle()
      if (payOrderErr) return Response.json({ error: payOrderErr.message }, { status: 500 })
      if (!payOrder) return Response.json({ error: 'Not found' }, { status: 404 })
      // Metal buildings: receipt state lives partly in mb_order_workflow; fail before any write if it is missing.
      if (isMb(payOrder)) {
        const pf = await preflightWorkflow(adminSupabase, id)
        if (pf.error) return Response.json({ error: pf.error }, { status: pf.status })
      }

      const { error } = await adminSupabase.from('sales_order_payments').insert({
        order_id:        id,
        payment_type:    payment_type || 'deposit',
        amount:          amt,
        payment_date:    payment_date || todayCentral(),
        reference,
        notes,
        recorded_by:     auth.userId,
        recorded_by_name: body.actor_name || 'Staff',
      })
      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Metal buildings: a full deposit (deposit payments minus refunds >= deposit due)
      // marks the deposit received; a partial one does not.
      if (isMb(payOrder)) {
        const synced = await syncMbPayment(adminSupabase, id)
        await adminSupabase.from('sales_order_history').insert({
          order_id: id, actor_id: auth.userId, actor_name: await actorName(adminSupabase, auth.userId),
          action: 'payment_recorded', details: { payment_type: payment_type || 'deposit', amount: amt, reference },
        })
        if (synced.error) return Response.json({ error: `Payment saved, but the order's payment status was not updated: ${synced.error}` }, { status: synced.status || 500 })
        if (synced.receipt_cleared) {
          await adminSupabase.from('sales_order_history').insert({
            order_id: id, actor_id: auth.userId, actor_name: await actorName(adminSupabase, auth.userId),
            action: 'deposit_receipt_cleared', details: { reason: 'net deposit payments no longer cover the deposit', net_deposit_cents: synced.deposit?.net_deposit_cents ?? null },
          })
        }
        return Response.json({ ok: true, new_payment_status: synced.payment_status, deposit_received: synced.deposit_received })
      }

      // Update payment_status based on totals
      const { data: payments, error: payListErr } = await adminSupabase
        .from('sales_order_payments')
        .select('payment_type, amount')
        .eq('order_id', id)
      if (payListErr) return Response.json({ error: `Payment saved, but totals could not be read: ${payListErr.message}` }, { status: 500 })
      const order = payOrder

      const total = (payments || []).reduce((s, p) => s + (p.payment_type === 'refund' ? -Number(p.amount) : Number(p.amount)), 0)
      const contractVal = Number(order?.contract_value || 0)
      let newStatus = 'deposit_received'
      if (total <= 0) newStatus = 'none'
      else if (contractVal > 0 && total >= contractVal * 0.99) newStatus = 'paid'
      else if (total > 0 && (payments || []).some(p => p.payment_type === 'deposit')) newStatus = 'deposit_received'
      else if (total > 0) newStatus = 'partial'

      const { error: stErr } = await adminSupabase.from('sales_orders').update({ payment_status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
      await adminSupabase.from('sales_order_history').insert({
        order_id:   id, actor_id: auth.userId, actor_name: body.actor_name || 'Staff',
        action:     'payment_recorded',
        details:    { payment_type, amount: amt, reference },
      })
      if (stErr) return Response.json({ error: `Payment saved, but the order's payment status was not updated: ${stErr.message}` }, { status: 500 })

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
      const { id, splits } = body  // splits: [{salesperson_id, share_pct}] — share_pct is a percent (0–100]
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      const { data: order, error: oErr } = await adminSupabase.from('sales_orders').select('id').eq('id', id).maybeSingle()
      if (oErr) return Response.json({ error: oErr.message }, { status: 500 })
      if (!order) return Response.json({ error: 'Not found' }, { status: 404 })

      const built = buildAttributionRows(id, splits, await getSalesStaff(), auth.userId)
      if (built.error) return Response.json({ error: built.error }, { status: 400 })

      // Replace safely: insert the new set first; only then delete the old rows by id.
      // A failed insert leaves the current attribution untouched.
      const { data: oldRows, error: oldErr } = await adminSupabase.from('sales_attribution').select('id').eq('order_id', id)
      if (oldErr) return Response.json({ error: oldErr.message }, { status: 500 })
      const { data: inserted, error: insErr } = await adminSupabase.from('sales_attribution').insert(built.rows).select('id')
      if (insErr) return Response.json({ error: 'Could not save splits: ' + insErr.message }, { status: 500 })
      const oldIds = (oldRows || []).map(r => r.id)
      if (oldIds.length) {
        const { error: delErr } = await adminSupabase.from('sales_attribution').delete().in('id', oldIds)
        if (delErr) {
          // Put things back as they were: remove the new rows, keep the old ones.
          const newIds = (inserted || []).map(r => r.id)
          if (newIds.length) await adminSupabase.from('sales_attribution').delete().in('id', newIds)
          return Response.json({ error: 'Could not replace old splits: ' + delErr.message }, { status: 500 })
        }
      }
      await adminSupabase.from('sales_order_history').insert({
        order_id: id, actor_id: auth.userId, actor_name: body.actor_name || 'Staff',
        action:   'attribution_set',
        details:  { splits: built.rows.map(r => ({ salesperson_id: r.salesperson_id, salesperson_name: r.salesperson_name, share_pct: r.share_pct })) },
      })
      return Response.json({ ok: true })
    }

    // ── Supplier order actions ─────────────────────────────────────────────────
    if (action === 'create_supplier_order') {
      if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { id } = body
      const fields = stripFixed(body.fields)
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      const { data: parent, error: parentErr } = await adminSupabase.from('sales_orders').select('id, division, salesperson_id').eq('id', id).maybeSingle()
      if (parentErr) return Response.json({ error: parentErr.message }, { status: 500 })
      if (!parent) return Response.json({ error: 'Not found' }, { status: 404 })
      if (isMb(parent)) {
        const denied = await mbGuard(parent, auth)
        if (denied) return denied
        // MB purchasing starts with the recorded supplier-form turn-in (which creates the
        // submitted purchasing row). No hand-built purchasing state before that.
        const t = await supplierTurnIn(adminSupabase, id)
        if (t.error) return Response.json({ error: t.error }, { status: t.status })
        if (!t.turnedIn) return Response.json({ error: "Turn in the supplier's order form first (it creates the purchasing record)." }, { status: 409 })
      }
      const { data: so, error } = await adminSupabase.from('sales_supplier_orders').insert({
        ...fields, order_id: id,
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
      const { supplier_order_id } = body
      const fields = stripFixed(body.fields)
      if (!supplier_order_id) return Response.json({ error: 'supplier_order_id required' }, { status: 400 })
      const { data: soParentRow, error: soPErr } = await adminSupabase.from('sales_supplier_orders').select('*').eq('id', supplier_order_id).maybeSingle()
      if (soPErr) return Response.json({ error: soPErr.message }, { status: 500 })
      if (!soParentRow) return Response.json({ error: 'Not found' }, { status: 404 })
      const { data: soParent, error: soOErr } = await adminSupabase.from('sales_orders').select('id, division, salesperson_id').eq('id', soParentRow.order_id).maybeSingle()
      if (soOErr) return Response.json({ error: soOErr.message }, { status: 500 })
      if (soParent && isMb(soParent)) {
        const denied = await mbGuard(soParent, auth)
        if (denied) return denied
        const t = await supplierTurnIn(adminSupabase, soParent.id)
        if (t.error) return Response.json({ error: t.error }, { status: t.status })
        if (!t.turnedIn) return Response.json({ error: "Turn in the supplier's order form first; purchasing updates follow the turn-in." }, { status: 409 })
        // The row the turn-in created keeps its audit fields (supplier, when it was turned in).
        if (t.row?.supplier_order_row_id === supplier_order_id) {
          for (const k of ['supplier_id', 'supplier_name', 'ordered_at']) {
            if (k in fields && String(fields[k] ?? '') !== String(soParentRow[k] ?? '')) {
              return Response.json({ error: `${k.replace(/_/g, ' ')} on the turned-in purchasing record cannot be changed.` }, { status: 409 })
            }
            delete fields[k]
          }
        }
      }
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
