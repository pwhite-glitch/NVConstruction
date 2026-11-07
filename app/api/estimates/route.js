import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM } from '../../../lib/server-auth'
import { sameUpdatedAt } from '../../../lib/estimate-save'
import { validateTaxRate, isMissingTaxRateColumn, DEFAULT_TAX_RATE, TAX_RATE_MIGRATION_MSG } from '../../../lib/calc-total'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Editing in the Estimator is Owner (principal) only. PM/APM can still view estimates.
const EDIT_ROLES = new Set(['principal'])

// Validates fields.tax_rate (percentage points) when supplied. Returns
// { fields } with the normalized number, or { res } with a 400.
function checkTaxRate(fields) {
  if (!fields || !Object.prototype.hasOwnProperty.call(fields, 'tax_rate')) return { fields }
  const r = validateTaxRate(fields.tax_rate)
  if (r.error) return { res: Response.json({ error: r.error, code: 'invalid_tax_rate' }, { status: 400 }) }
  return { fields: { ...fields, tax_rate: r.value } }
}

// Before migration 048 the column does not exist: drop a DEFAULT rate and
// retry (nothing lost), but refuse a non-default rate with a clear message.
// Returns the fields to retry with, or null if the caller must fail.
function withoutDefaultTaxRate(fields) {
  if (!fields || !Object.prototype.hasOwnProperty.call(fields, 'tax_rate')) return null
  if (Number(fields.tax_rate) !== DEFAULT_TAX_RATE) return null
  const { tax_rate: _t, ...rest } = fields
  return rest
}

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
      const tr = checkTaxRate(body.fields)
      if (tr.res) return tr.res
      const fields = tr.fields || {}

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

      const insertEst = f => adminSupabase
        .from('estimates')
        .insert({ ...f, estimate_number, created_by: auth.userId, status: f.status || 'lead' })
        .select('id, estimate_number')
        .single()
      let { data, error } = await insertEst(fields)
      if (error && isMissingTaxRateColumn(error)) {
        const retry = withoutDefaultTaxRate(fields)
        if (!retry) return Response.json({ error: TAX_RATE_MIGRATION_MSG, code: 'migration_missing' }, { status: 422 })
        ;({ data, error } = await insertEst(retry))
      }

      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true, id: data.id, estimate_number: data.estimate_number })
    }

    // ── Update ───────────────────────────────────────────────────────────────
    if (body.action === 'update') {
      const { id, line_items } = body
      const tr = checkTaxRate(body.fields)
      if (tr.res) return tr.res
      const fields = tr.fields

      const { data: est } = await adminSupabase
        .from('estimates').select('created_by, allowed_users, updated_at').eq('id', id).maybeSingle()
      if (!est) return Response.json({ error: 'Not found' }, { status: 404 })

      // Verify ownership or PM role before allowing update
      if (!isPM(auth.role)) {
        const allowed = est.created_by === auth.userId || (est.allowed_users || []).includes(auth.userId)
        if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Stale-write guard: the caller must send the updated_at it loaded, and it
      // must still be current. Otherwise reject and change nothing.
      const stale = () => Response.json({ error: 'stale', current_updated_at: est.updated_at ?? null }, { status: 409 })
      const hasExpected = Object.prototype.hasOwnProperty.call(body, 'expected_updated_at')
      if (!hasExpected || !sameUpdatedAt(body.expected_updated_at, est.updated_at)) return stale()

      // The server owns updated_at; ignore any client-supplied value.
      const { updated_at: _clientUpdatedAt, ...cleanFields } = fields || {}
      const newUpdatedAt = new Date().toISOString()

      // Compare-and-swap on updated_at so a write that lands between our read
      // and this update is also caught.
      const casUpdate = f => {
        let q = adminSupabase.from('estimates').update({ ...f, updated_at: newUpdatedAt }).eq('id', id)
        q = est.updated_at == null ? q.is('updated_at', null) : q.eq('updated_at', est.updated_at)
        return q.select('updated_at')
      }

      let { data: updatedRows, error: updateErr } = await casUpdate(cleanFields)

      if (updateErr && isMissingTaxRateColumn(updateErr)) {
        const retry = withoutDefaultTaxRate(cleanFields)
        if (!retry) return Response.json({ error: TAX_RATE_MIGRATION_MSG, code: 'migration_missing' }, { status: 422 })
        ;({ data: updatedRows, error: updateErr } = await casUpdate(retry))
      }

      if (updateErr?.message?.includes('markup_flat')) {
        const { markup_flat, ...fieldsWithout } = cleanFields
        ;({ data: updatedRows, error: updateErr } = await casUpdate(fieldsWithout))
      }

      if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })

      if (!updatedRows || updatedRows.length === 0) {
        const { data: now } = await adminSupabase.from('estimates').select('updated_at').eq('id', id).maybeSingle()
        return Response.json({ error: 'stale', current_updated_at: now?.updated_at ?? null }, { status: 409 })
      }
      const savedUpdatedAt = updatedRows[0].updated_at ?? newUpdatedAt

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

      return Response.json({ ok: true, updated_at: savedUpdatedAt })
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
