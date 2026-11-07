/**
 * Prompt 49, items 4 and 6.
 *
 * Item 4: office SOV edits go through /api/subcontract-sov. A line referenced by ANY billing
 * line (pending / approved / rejected, even $0) can't be deleted or have its value /
 * description / budget line changed; the job comes from line → contract → job.
 *
 * Item 6: Draw / Undo of a direct cost on an owner pay app is one server action
 * (/api/aia-draw → public.aia_dc_draw_apply, migration 045). Signed cents with the same
 * markup both ways; Undo reverses exactly what was applied (after the line bounds); locked
 * apps need an Owner who typed the app number; without 045 it refuses (503).
 * The RPC is simulated below with the same rules as the SQL function.
 */
import { signedDrawCents, applyDrawDelta, undoDrawDelta, shiftScreenLine, pctOf, toCents } from '../lib/aia-draw'
import { sovEditError, sovDeleteError, sovFrozenChanges } from '../lib/sov-guards'

const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: () => false,
  }
})

const sovRoute = require('../app/api/subcontract-sov/route')
const aiaRoute = require('../app/api/aia-draw/route')
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const row = (t, id) => mockState.db[t].find(r => r.id === id)

// ── Item 6: pure money math ───────────────────────────────────────────────────
describe('signed draw cents', () => {
  test('$100 expense @10% → +$110; $100 credit @10% → −$110', () => {
    expect(signedDrawCents({ amount: 100 }, 10)).toBe(11000)
    expect(signedDrawCents({ amount: 100, is_credit: true }, 10)).toBe(-11000)
    expect(signedDrawCents({ amount: -100 }, 10)).toBe(-11000)
  })
  test('same rounding both directions', () => {
    expect(signedDrawCents({ amount: 33.33 }, 7.5)).toBe(3583)
    expect(signedDrawCents({ amount: 33.33, is_credit: true }, 7.5)).toBe(-3583)
    expect(signedDrawCents({ amount: 10 }, null)).toBe(1000)
  })
})

describe('apply / undo on a line', () => {
  const line = { thisCents: 50000, prevCents: 0, scheduledCents: 1000000 }
  test('expense then undo returns the original', () => {
    const a = applyDrawDelta({ ...line, deltaCents: 11000 })
    expect(a).toEqual({ appliedCents: 11000, newThisCents: 61000 })
    expect(undoDrawDelta({ thisCents: a.newThisCents, appliedCents: a.appliedCents }).newThisCents).toBe(50000)
  })
  test('credit then inverse', () => {
    const a = applyDrawDelta({ ...line, deltaCents: -11000 })
    expect(a).toEqual({ appliedCents: -11000, newThisCents: 39000 })
    expect(undoDrawDelta({ thisCents: a.newThisCents, appliedCents: a.appliedCents }).newThisCents).toBe(50000)
  })
  test('cap: only what fits is applied, and Undo reverses that (not the nominal amount)', () => {
    const a = applyDrawDelta({ thisCents: 95000, prevCents: 0, scheduledCents: 100000, deltaCents: 11000 })
    expect(a).toEqual({ appliedCents: 5000, newThisCents: 100000 })
    expect(undoDrawDelta({ thisCents: 100000, appliedCents: a.appliedCents }).newThisCents).toBe(95000)
  })
  test('cap counts previous apps (total to date ≤ scheduled)', () => {
    expect(applyDrawDelta({ thisCents: 0, prevCents: 90000, scheduledCents: 100000, deltaCents: 50000 })).toEqual({ appliedCents: 10000, newThisCents: 10000 })
  })
  test('floor: a credit can take total to date down to 0, no further', () => {
    const a = applyDrawDelta({ thisCents: 2000, prevCents: 3000, scheduledCents: 100000, deltaCents: -11000 })
    expect(a).toEqual({ appliedCents: -5000, newThisCents: -3000 })
    expect(undoDrawDelta({ thisCents: -3000, appliedCents: -5000 }).newThisCents).toBe(2000)
  })
  test('manual amount already over the cap is kept, not pulled back; refused with a reason', () => {
    expect(applyDrawDelta({ thisCents: 120000, prevCents: 0, scheduledCents: 100000, deltaCents: 1000 }).error).toMatch(/full scheduled value/)
  })
  test('zero budget and $0 cost are refused', () => {
    expect(applyDrawDelta({ thisCents: 0, prevCents: 0, scheduledCents: 0, deltaCents: 1000 }).error).toMatch(/\$0 scheduled/)
    expect(applyDrawDelta({ ...line, deltaCents: 0 }).error).toMatch(/\$0/)
  })
  test('screen line keeps dollar_this and pct_this aligned', () => {
    const l = shiftScreenLine({ budget_item_id: 'L1', budget_amount: 10000, dollar_this: 500, pct_this: '5' }, 11000)
    expect(l.dollar_this).toBe(610)
    expect(Number(l.pct_this)).toBeCloseTo(6.1)
    expect(pctOf(61000, 1000000)).toBeCloseTo(6.1)
    const back = shiftScreenLine(l, -11000)
    expect(back.dollar_this).toBe(500)
  })
})

// ── Item 6: route ─────────────────────────────────────────────────────────────
// Same rules as public.aia_dc_draw_apply in migration 045.
function rpcModel(a, db) {
  const fail = m => ({ data: null, error: { message: m } })
  const c = db.direct_costs.find(r => r.id === a.p_cost_id)
  const app = db.aia_applications.find(r => r.id === a.p_app_id)
  if (!app || app.job_id !== c.job_id) return fail('aia_app_mismatch')
  if (!a.p_override && (['submitted', 'certified'].includes(app.status) || app.payment_received)) return fail('aia_app_locked')
  if (a.p_mode === 'draw' && c.drawn_application_id) return fail('aia_dc_already_drawn')
  if (a.p_mode === 'undo' && (c.drawn_application_id !== a.p_app_id || c.drawn_aia_delta == null || Number(c.drawn_aia_delta) !== Number(a.p_applied))) return fail('aia_dc_not_drawn_here')
  if (a.p_mode === 'legacy_untag') {
    if (c.drawn_application_id !== a.p_app_id || c.drawn_aia_delta != null) return fail('aia_dc_not_drawn_here')
    Object.assign(c, { drawn_application_id: null, drawn_at: null })
    return { data: { ok: true }, error: null }
  }
  const l = db.aia_application_lines.find(x => x.application_id === a.p_app_id && x.budget_item_id === a.p_budget_item_id)
  if (l) {
    if (!a.p_has_line || (l.dollar_this_period ?? null) !== (a.p_expected_this ?? null)) return fail('aia_line_changed')
    Object.assign(l, { dollar_this_period: a.p_new_this, pct_this_period: a.p_new_pct })
  } else {
    if (a.p_has_line || a.p_mode !== 'draw') return fail('aia_line_changed')
    db.aia_application_lines.push({ id: 'new-line', application_id: a.p_app_id, budget_item_id: a.p_budget_item_id, dollar_this_period: a.p_new_this, pct_this_period: a.p_new_pct, dollar_prev: a.p_dollar_prev })
  }
  if (a.p_mode === 'draw') Object.assign(c, { drawn_application_id: a.p_app_id, drawn_at: 'now', drawn_aia_delta: a.p_applied })
  else Object.assign(c, { drawn_application_id: null, drawn_at: null, drawn_aia_delta: null })
  return { data: { ok: true }, error: null }
}

function seedAia() {
  resetMockState({
    jobs: [{ id: 'J1' }, { id: 'J2' }],
    pm_job_assignments: [{ id: 'a', job_id: 'J1', user_id: 'pm1' }],
    budget_items: [{ id: 'L1', job_id: 'J1', budget_amount: 10000, owner_amount: 10000 }, { id: 'L0', job_id: 'J1', budget_amount: 0, owner_amount: 0 }],
    aia_applications: [
      { id: 'A1', job_id: 'J1', app_number: 1, status: 'draft', payment_received: false, markup_pct: 10, nv_subcontract_id: null },
      { id: 'A_sub', job_id: 'J1', app_number: 1, status: 'draft', markup_pct: 0, nv_subcontract_id: 'NV1' },
      { id: 'A_locked', job_id: 'J1', app_number: 2, status: 'submitted', payment_received: false, markup_pct: 10, nv_subcontract_id: null },
      { id: 'A_other', job_id: 'J2', app_number: 1, status: 'draft', markup_pct: 10, nv_subcontract_id: null },
    ],
    aia_application_lines: [{ id: 'ln1', application_id: 'A1', budget_item_id: 'L1', dollar_this_period: 500, pct_this_period: 5, dollar_prev: 0 }],
    direct_costs: [
      { id: 'exp', job_id: 'J1', status: 'approved', amount: 100, is_credit: false, budget_item_id: 'L1', drawn_application_id: null, drawn_aia_delta: null },
      { id: 'cred', job_id: 'J1', status: 'approved', amount: 100, is_credit: true, budget_item_id: 'L1', drawn_application_id: null, drawn_aia_delta: null },
      { id: 'legacy', job_id: 'J1', status: 'approved', amount: 100, budget_item_id: 'L1', drawn_application_id: 'A1', drawn_aia_delta: null },
      { id: 'zero', job_id: 'J1', status: 'approved', amount: 100, budget_item_id: 'L0', drawn_application_id: null, drawn_aia_delta: null },
    ],
  })
  mockState.rpc.aia_dc_draw_apply = rpcModel
  mockState.auth = { userId: 'pm1', role: 'pm', error: null }
}

const aia = body => aiaRoute.POST(req('/api/aia-draw', 'POST', body))

describe('/api/aia-draw', () => {
  beforeEach(seedAia)

  test('expense: +110 to the G703 line and the tag, together; Undo puts back exactly 500', async () => {
    const res = await aia({ action: 'draw', cost_id: 'exp', app_id: 'A1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ applied: 110, new_this: 610, budget_item_id: 'L1' })
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(610)
    expect(row('direct_costs', 'exp')).toMatchObject({ drawn_application_id: 'A1', drawn_aia_delta: 110 })
    const undo = await aia({ action: 'undo', cost_id: 'exp' })
    expect(undo.status).toBe(200)
    expect((await undo.json()).applied).toBe(-110)
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(500)
    expect(row('direct_costs', 'exp')).toMatchObject({ drawn_application_id: null, drawn_aia_delta: null })
  })

  test('credit: −110 then exact inverse', async () => {
    expect((await aia({ action: 'draw', cost_id: 'cred', app_id: 'A1' })).status).toBe(200)
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(390)
    expect(row('direct_costs', 'cred').drawn_aia_delta).toBe(-110)
    expect((await aia({ action: 'undo', cost_id: 'cred' })).status).toBe(200)
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(500)
  })

  test('cap: line near full applies only what fits; Undo reverses that', async () => {
    row('aia_application_lines', 'ln1').dollar_this_period = 9950
    await aia({ action: 'draw', cost_id: 'exp', app_id: 'A1' })
    expect(row('direct_costs', 'exp').drawn_aia_delta).toBe(50)
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(10000)
    await aia({ action: 'undo', cost_id: 'exp' })
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(9950)
  })

  test('double click / reload: second Draw is an explicit conflict and changes nothing', async () => {
    await aia({ action: 'draw', cost_id: 'exp', app_id: 'A1' })
    const again = await aia({ action: 'draw', cost_id: 'exp', app_id: 'A1' })
    expect(again.status).toBe(409)
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(610)
    await aia({ action: 'undo', cost_id: 'exp' })
    expect((await aia({ action: 'undo', cost_id: 'exp' })).status).toBe(409)
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(500)
  })

  test('G703 line changed by someone else between read and write → 409, nothing applied', async () => {
    mockState.rpc.aia_dc_draw_apply = (a, db) => { db.aia_application_lines[0].dollar_this_period = 777; return rpcModel(a, db) }
    const res = await aia({ action: 'draw', cost_id: 'exp', app_id: 'A1' })
    expect(res.status).toBe(409)
    expect(row('direct_costs', 'exp').drawn_application_id).toBeNull()
  })

  test('missing G703 row: Draw inserts it with the applied amount', async () => {
    mockState.db.aia_application_lines = []
    expect((await aia({ action: 'draw', cost_id: 'exp', app_id: 'A1' })).status).toBe(200)
    expect(mockState.db.aia_application_lines[0]).toMatchObject({ application_id: 'A1', budget_item_id: 'L1', dollar_this_period: 110 })
  })

  test('zero-budget line refused with a reason; the cost stays untagged', async () => {
    const res = await aia({ action: 'draw', cost_id: 'zero', app_id: 'A1' })
    expect(res.status).toBe(422)
    expect(row('direct_costs', 'zero').drawn_application_id).toBeNull()
  })

  test('foreign app and NV-sub app refused', async () => {
    expect((await aia({ action: 'draw', cost_id: 'exp', app_id: 'A_other' })).status).toBe(422)
    expect((await aia({ action: 'draw', cost_id: 'exp', app_id: 'A_sub' })).status).toBe(422)
  })

  test('unassigned PM refused', async () => {
    mockState.auth = { userId: 'pm9', role: 'pm', error: null }
    expect((await aia({ action: 'draw', cost_id: 'exp', app_id: 'A1' })).status).toBe(403)
  })

  test('locked app: PM cannot set OR clear; body boolean does nothing', async () => {
    expect((await aia({ action: 'draw', cost_id: 'exp', app_id: 'A_locked', override: true, p_override: true })).status).toBe(423)
    Object.assign(row('direct_costs', 'exp'), { drawn_application_id: 'A_locked', drawn_aia_delta: 110 })
    expect((await aia({ action: 'undo', cost_id: 'exp', override: true })).status).toBe(423)
  })

  test('locked app: Owner needs the typed app number', async () => {
    mockState.auth = { userId: 'own', role: 'principal', error: null }
    const noType = await aia({ action: 'draw', cost_id: 'exp', app_id: 'A_locked' })
    expect(noType.status).toBe(423)
    expect((await noType.json()).needs_override).toBe(true)
    expect((await aia({ action: 'draw', cost_id: 'exp', app_id: 'A_locked', override_app_number: '9' })).status).toBe(423)
    expect((await aia({ action: 'draw', cost_id: 'exp', app_id: 'A_locked', override_app_number: '#2' })).status).toBe(200)
  })

  test('legacy tag (no recorded delta): Undo refuses with an explanation; untag-only leaves the G703 alone', async () => {
    const res = await aia({ action: 'undo', cost_id: 'legacy' })
    expect(res.status).toBe(409)
    expect((await res.json()).legacy).toBe(true)
    expect((await aia({ action: 'legacy_untag', cost_id: 'legacy' })).status).toBe(200)
    expect(row('direct_costs', 'legacy').drawn_application_id).toBeNull()
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(500)
  })

  test('migration 045 not applied: column missing → 503, nothing changed', async () => {
    for (const c of mockState.db.direct_costs) delete c.drawn_aia_delta
    const res = await aia({ action: 'draw', cost_id: 'exp', app_id: 'A1' })
    expect(res.status).toBe(503)
    expect((await res.json()).migration_required).toBe('045')
    expect(row('aia_application_lines', 'ln1').dollar_this_period).toBe(500)
  })

  test('migration 045 not applied: function missing → 503', async () => {
    delete mockState.rpc.aia_dc_draw_apply
    const res = await aia({ action: 'draw', cost_id: 'exp', app_id: 'A1' })
    expect(res.status).toBe(503)
    expect(row('direct_costs', 'exp').drawn_application_id).toBeNull()
  })

  test('PUT /api/direct-costs can no longer set or clear the pay-app tag', async () => {
    const dc = require('../app/api/direct-costs/route')
    const res = await dc.PUT(req('/api/direct-costs', 'PUT', { id: 'legacy', drawn_application_id: null, drawn_at: null }))
    expect(res.status).toBe(400)
    expect(row('direct_costs', 'legacy').drawn_application_id).toBe('A1')
  })
})

// ── Item 4: SOV ───────────────────────────────────────────────────────────────
describe('SOV rules (pure)', () => {
  const line = { id: 's1', scheduled_value: 1000, description: 'Framing', budget_item_id: 'L1' }
  test('a billed line is frozen; unchanged values pass', () => {
    expect(sovEditError(line, { scheduled_value: 1200 }, 1).status).toBe(409)
    expect(sovEditError(line, { description: 'Other' }, 1).status).toBe(409)
    expect(sovEditError(line, { budget_item_id: 'L2' }, 1).status).toBe(409)
    expect(sovEditError(line, { scheduled_value: '1000.00', description: 'Framing ', budget_item_id: 'L1' }, 1)).toBeNull()
    expect(sovFrozenChanges(line, { scheduled_value: 1000 })).toEqual([])
  })
  test('unbilled line edits freely; bad values refused', () => {
    expect(sovEditError(line, { scheduled_value: 1, description: 'x' }, 0)).toBeNull()
    expect(sovEditError(line, { scheduled_value: 'abc' }, 0).status).toBe(400)
    expect(sovEditError(line, { description: '  ' }, 0).status).toBe(400)
  })
  test('delete blocked whenever referenced', () => {
    expect(sovDeleteError(line, 1).status).toBe(409)
    expect(sovDeleteError(line, 0)).toBeNull()
  })
})

describe('/api/subcontract-sov', () => {
  beforeEach(() => {
    resetMockState({
      jobs: [{ id: 'J1', pm_email: null }, { id: 'J2', pm_email: null }],
      pm_job_assignments: [{ id: 'a', job_id: 'J1', user_id: 'pm1' }],
      budget_items: [{ id: 'L1', job_id: 'J1' }, { id: 'X1', job_id: 'J2' }],
      subcontracts: [{ id: 'SC1', job_id: 'J1' }, { id: 'SC2', job_id: 'J2' }],
      subcontract_sov_lines: [
        { id: 's_pending', subcontract_id: 'SC1', description: 'Footings', scheduled_value: 1000, budget_item_id: 'L1', sort_order: 1 },
        { id: 's_rejected', subcontract_id: 'SC1', description: 'Walls', scheduled_value: 2000, budget_item_id: 'L1', sort_order: 2 },
        { id: 's_zero', subcontract_id: 'SC1', description: 'Roof', scheduled_value: 3000, budget_item_id: 'L1', sort_order: 3 },
        { id: 's_free', subcontract_id: 'SC1', description: 'Punch', scheduled_value: 400, budget_item_id: null, sort_order: 4 },
        { id: 's_foreign', subcontract_id: 'SC2', description: 'Other', scheduled_value: 10, budget_item_id: null, sort_order: 1 },
      ],
      billing_sov_lines: [
        { id: 'bl1', sov_line_id: 's_pending', amount: 100, billing_submission_id: 'B1' },
        { id: 'bl2', sov_line_id: 's_rejected', amount: 200, billing_submission_id: 'B2' },
        { id: 'bl3', sov_line_id: 's_zero', amount: 0, pct_this_period: 0, billing_submission_id: 'B3' },
      ],
    })
    mockState.auth = { userId: 'pm1', role: 'pm', email: 'pm1@x.com', error: null }
  })
  const call = (method, body) => sovRoute[method](req('/api/subcontract-sov', method, body))

  test.each(['s_pending', 's_rejected', 's_zero'])('referenced line %s cannot be deleted; billing detail stays', async id => {
    const res = await call('DELETE', { id })
    expect(res.status).toBe(409)
    expect(row('subcontract_sov_lines', id)).toBeTruthy()
    expect(mockState.db.billing_sov_lines).toHaveLength(3)
  })
  test('unreferenced line can be deleted', async () => {
    expect((await call('DELETE', { id: 's_free' })).status).toBe(200)
    expect(row('subcontract_sov_lines', 's_free')).toBeUndefined()
  })
  test('referenced line: amount / description / budget edits refused', async () => {
    expect((await call('PATCH', { id: 's_zero', scheduled_value: 3500 })).status).toBe(409)
    expect((await call('PATCH', { id: 's_pending', description: 'Renamed' })).status).toBe(409)
    expect(row('subcontract_sov_lines', 's_zero').scheduled_value).toBe(3000)
  })
  test('unreferenced line edit works; budget line must be on the same job', async () => {
    expect((await call('PATCH', { id: 's_free', scheduled_value: '450.555', budget_item_id: 'L1' })).status).toBe(200)
    expect(row('subcontract_sov_lines', 's_free')).toMatchObject({ scheduled_value: 450.56, budget_item_id: 'L1' })
    expect((await call('PATCH', { id: 's_free', budget_item_id: 'X1' })).status).toBe(422)
  })
  test('foreign job denied (job from the line, never the body)', async () => {
    expect((await call('PATCH', { id: 's_foreign', description: 'x', job_id: 'J1', subcontract_id: 'SC1' })).status).toBe(403)
    expect((await call('DELETE', { id: 's_foreign' })).status).toBe(403)
    expect((await call('POST', { subcontract_id: 'SC2', description: 'x', scheduled_value: 1, job_id: 'J1' })).status).toBe(403)
  })
  test('unassigned super denied; Owner allowed', async () => {
    mockState.auth = { userId: 'su', role: 'super', email: 'su@x.com', error: null }
    expect((await call('POST', { subcontract_id: 'SC1', description: 'x', scheduled_value: 1 })).status).toBe(403)
    mockState.auth = { userId: 'own', role: 'principal', error: null }
    const res = await call('POST', { subcontract_id: 'SC1', description: 'Clean up', scheduled_value: 100 })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ subcontract_id: 'SC1', sort_order: 5, scheduled_value: 100 })
  })
  test('billing lookup failure fails closed', async () => {
    mockState.failSelect.billing_sov_lines = 'down'
    expect((await call('DELETE', { id: 's_free' })).status).toBe(500)
    expect(row('subcontract_sov_lines', 's_free')).toBeTruthy()
  })
  test('database trigger refusal (045) is reported as a conflict', async () => {
    const orig = mockState.db.subcontract_sov_lines
    // simulate the trigger: delete raises
    const client = require('@supabase/supabase-js').createClient()
    const realFrom = client.from
    client.from = t => {
      const q = realFrom(t)
      if (t === 'subcontract_sov_lines') q.delete = () => ({ eq: async () => ({ error: { message: 'sov_line_billed: this SOV line has billing lines' } }) })
      return q
    }
    const res = await call('DELETE', { id: 's_free' })
    client.from = realFrom
    expect(res.status).toBe(409)
    expect(mockState.db.subcontract_sov_lines).toBe(orig)
  })
})

describe('initial sub SOV and CO → SOV sync keep working after 045', () => {
  const fs = require('fs')
  const path = require('path')
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  test('they write with the service role (bypasses RLS), not the browser', () => {
    expect(read('app/api/sub-portal/sov/route.js')).toMatch(/adminSupabase\.from\('subcontract_sov_lines'\)\.insert/)
    expect(read('app/api/co-response/route.js')).toMatch(/addCoSovLine\(adminSupabase, co\)/)
    expect(read('app/api/sov-co-backfill/route.js')).toMatch(/insertCoLine\(adminSupabase/)
  })
  test('the job page no longer writes SOV lines from the browser', () => {
    const src = read('app/jobdetail/page.js')
    expect(src).not.toMatch(/supabase\.from\('subcontract_sov_lines'\)\.(insert|update|delete)/)
    expect(src).not.toMatch(/addCoSovLine\(supabase/)
    expect(src).toMatch(/\/api\/sov-co-backfill/)
  })
  test('the 045 trigger lets sort-order-only updates through (sub SOV re-order of CO lines)', () => {
    const sql = read('migrations/045_billing_integrity_co_numbers_lookahead.sql')
    expect(sql).toMatch(/RETURN NEW; -- sort_order \/ change_order_id only/)
  })
  test('toCents helper', () => expect(toCents('12.345')).toBe(1235))
})
