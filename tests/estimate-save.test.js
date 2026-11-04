/**
 * Estimate auto-save loop + stale-write guard.
 *
 * Incident: an open estimate tab re-saved itself every ~30s forever (a refetch
 * after save re-marked the form dirty), overwriting other users' edits because
 * /api/estimates 'update' had no stale-write check.
 */

let db
let writes
let mockRole = 'principal'

function mockQuery(table) {
  const filters = []
  let op = null
  let payload = null
  let selectAfter = false
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (op === 'update') {
      const hit = rows()
      writes.push({ table, op, payload, matched: hit.length })
      hit.forEach(r => Object.assign(r, payload))
      return { data: selectAfter ? hit.map(r => ({ updated_at: r.updated_at })) : null, error: null }
    }
    if (op === 'delete') {
      writes.push({ table, op })
      db[table] = (db[table] || []).filter(r => !filters.every(f => f(r)))
      return { data: null, error: null }
    }
    if (op === 'insert') {
      writes.push({ table, op, payload })
      db[table].push(...(Array.isArray(payload) ? payload : [payload]))
      return { data: null, error: null }
    }
    return { data: rows(), error: null }
  }
  const q = {
    select: () => { if (op) selectAfter = true; return q },
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    insert: p => { op = 'insert'; payload = p; return q },
    update: p => { op = 'update'; payload = p; return q },
    delete: () => { op = 'delete'; return q },
    maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: r.data?.[0] ?? null })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: table => mockQuery(table) }),
}))
jest.mock('../lib/server-auth', () => ({
  requireAuth: async () => ({ userId: 'u1', role: mockRole }),
  isPM: role => ['principal', 'pm', 'apm', 'super', 'admin'].includes(role),
}))

const route = require('../app/api/estimates/route')
const {
  sameUpdatedAt, shouldOfferDraft, initialSaveState, saveStateReducer, shouldAutoSave, estimateSavePayload,
} = require('../lib/estimate-save')

const ID = 'f4da8a35'
const LOADED = '2026-11-04T15:00:00.123456+00:00'

function seed() {
  writes = []
  db = {
    estimates: [{ id: ID, project_name: "Braum's Tyler", status: 'estimating', created_by: 'u1', allowed_users: [], updated_at: LOADED }],
    estimate_line_items: [{ estimate_id: ID, description: 'Site work', amount: 1000, sort_order: 0 }],
  }
}

const post = body => route.POST(new Request('http://x/api/estimates', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}))

const updateBody = extra => ({
  action: 'update',
  id: ID,
  fields: { project_name: 'Overwritten', status: 'estimating' },
  line_items: [{ estimate_id: ID, description: 'New line', amount: 5, sort_order: 0 }],
  ...extra,
})

function expectNothingWritten() {
  expect(writes).toEqual([])
  expect(db.estimates[0].project_name).toBe("Braum's Tyler")
  expect(db.estimates[0].updated_at).toBe(LOADED)
  expect(db.estimate_line_items).toEqual([{ estimate_id: ID, description: 'Site work', amount: 1000, sort_order: 0 }])
}

describe('/api/estimates: editing is Owner (principal) only', () => {
  beforeEach(seed)
  afterEach(() => { mockRole = 'principal' })

  test.each(['pm', 'apm', 'admin', 'super'])('%s cannot create, update or delete -> 403, nothing written', async role => {
    mockRole = role
    for (const body of [updateBody({ expected_updated_at: LOADED }), { action: 'create', fields: { project_name: 'X' } }, { action: 'delete', id: ID }]) {
      const res = await post(body)
      expect(res.status).toBe(403)
    }
    expectNothingWritten()
  })

  test('principal can update', async () => {
    const res = await post(updateBody({ expected_updated_at: LOADED }))
    expect(res.status).toBe(200)
  })
})

describe('/api/estimates update: stale-write guard', () => {
  beforeEach(seed)

  test('missing expected_updated_at (old client) -> 409, nothing written', async () => {
    const res = await post(updateBody({ fields: { project_name: 'Overwritten', updated_at: new Date().toISOString() } }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'stale', current_updated_at: LOADED })
    expectNothingWritten()
  })

  test('mismatched expected_updated_at -> 409, nothing written', async () => {
    const res = await post(updateBody({ expected_updated_at: '2026-11-04T14:59:30.000000+00:00' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'stale', current_updated_at: LOADED })
    expectNothingWritten()
  })

  test('null expected_updated_at against a row that has one -> 409', async () => {
    const res = await post(updateBody({ expected_updated_at: null }))
    expect(res.status).toBe(409)
    expectNothingWritten()
  })

  test('row changed between the read and the write (CAS) -> 409, no line items touched', async () => {
    // Simulate another save landing after our read: the first update matches nothing.
    const realFind = db.estimates
    let reads = 0
    Object.defineProperty(db, 'estimates', {
      configurable: true,
      get() { reads++; if (reads === 2) realFind[0].updated_at = '2026-11-04T15:00:05.000000+00:00'; return realFind },
    })
    const res = await post(updateBody({ expected_updated_at: LOADED }))
    expect(res.status).toBe(409)
    expect(writes.filter(w => w.table === 'estimate_line_items')).toEqual([])
    expect(realFind[0].project_name).toBe("Braum's Tyler")
  })

  test('matching expected_updated_at -> saves, server sets updated_at and returns it', async () => {
    const res = await post(updateBody({
      expected_updated_at: LOADED,
      fields: { project_name: 'Renamed', status: 'estimating', updated_at: '1999-01-01T00:00:00Z' },
    }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(db.estimates[0].project_name).toBe('Renamed')
    expect(db.estimates[0].updated_at).toBe(j.updated_at)
    expect(sameUpdatedAt(j.updated_at, LOADED)).toBe(false)
    expect(j.updated_at).not.toBe('1999-01-01T00:00:00Z') // client value ignored
    expect(db.estimate_line_items).toEqual([{ estimate_id: ID, description: 'New line', amount: 5, sort_order: 0 }])

    // The returned value is the new base: re-using the old one is now stale,
    // using the returned one works.
    expect((await post(updateBody({ expected_updated_at: LOADED }))).status).toBe(409)
    expect((await post(updateBody({ expected_updated_at: j.updated_at }))).status).toBe(200)
  })

  test('Won stage goes through the same guarded path', async () => {
    const res = await post(updateBody({ expected_updated_at: LOADED, fields: { project_name: "Braum's Tyler", status: 'won' } }))
    expect(res.status).toBe(200)
    expect(db.estimates[0].status).toBe('won')
  })

  test('matches across timestamp formats (micro vs milli, Z vs +00:00)', async () => {
    db.estimates[0].updated_at = '2026-11-04T15:00:00.123+00:00'
    const res = await post(updateBody({ expected_updated_at: '2026-11-04T15:00:00.123Z' }))
    expect(res.status).toBe(200)
  })
})

describe('sameUpdatedAt', () => {
  test('compares instants to the microsecond', () => {
    expect(sameUpdatedAt('2026-11-04T15:00:00.123+00:00', '2026-11-04T15:00:00.123000Z')).toBe(true)
    expect(sameUpdatedAt('2026-11-04T10:00:00.5-05:00', '2026-11-04T15:00:00.500Z')).toBe(true)
    expect(sameUpdatedAt('2026-11-04T15:00:00.123456+00:00', '2026-11-04T15:00:00.123457+00:00')).toBe(false)
    expect(sameUpdatedAt(null, undefined)).toBe(true)
    expect(sameUpdatedAt(null, LOADED)).toBe(false)
  })
})

describe('dirty tracking / auto-save', () => {
  const ctx = { canEdit: true, isArchived: false }

  test('initial load is not dirty and does not auto-save', () => {
    const s = initialSaveState(LOADED)
    expect(s.dirty).toBe(false)
    expect(shouldAutoSave(s, ctx)).toBe(false)
  })

  test('a real edit marks dirty and enables auto-save', () => {
    const s = saveStateReducer(initialSaveState(LOADED), { type: 'edit' })
    expect(s.dirty).toBe(true)
    expect(shouldAutoSave(s, ctx)).toBe(true)
  })

  test('after a successful save + refetch, dirty stays false (no loop)', () => {
    let s = saveStateReducer(initialSaveState(LOADED), { type: 'edit' })
    const seqAtStart = s.editSeq
    s = saveStateReducer(s, { type: 'saved', updated_at: 'T2', seqAtStart })
    // The refetch only calls setForm/setLines; it dispatches nothing.
    expect(s.dirty).toBe(false)
    expect(s.base).toBe('T2')
    expect(shouldAutoSave(s, ctx)).toBe(false)
  })

  test('edits made while the save was in flight stay dirty', () => {
    let s = saveStateReducer(initialSaveState(LOADED), { type: 'edit' })
    const seqAtStart = s.editSeq
    s = saveStateReducer(s, { type: 'edit' })
    s = saveStateReducer(s, { type: 'saved', updated_at: 'T2', seqAtStart })
    expect(s.dirty).toBe(true)
    expect(s.base).toBe('T2')
  })

  test('a conflict stops auto-save even with unsaved edits', () => {
    let s = saveStateReducer(initialSaveState(LOADED), { type: 'edit' })
    s = saveStateReducer(s, { type: 'conflict' })
    expect(shouldAutoSave(s, ctx)).toBe(false)
    s = saveStateReducer(s, { type: 'edit' })
    expect(shouldAutoSave(s, ctx)).toBe(false)
  })

  test('the workspace marks dirty only from edit handlers, never from a form/lines effect', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../app/components/estimating/EstimateWorkspace.js'), 'utf8')
    expect(src).not.toMatch(/setDirty/)
    expect(src).not.toMatch(/useEffect\(\(\) => \{[^}]*dispatchSave\(\{ type: 'edit' \}\)/)
    expect((src.match(/dispatchSave\(\{ type: 'edit' \}\)/g) || []).length).toBe(1) // only inside markEdited()
  })
})

describe('local drafts', () => {
  const estimate = {
    id: ID, project_name: "Braum's Tyler", status: 'estimating', updated_at: LOADED,
    estimate_line_items: [{ description: 'Site work', amount: 1000, sort_order: 0 }],
  }
  const lines = [{ description: 'Site work', amount: '1500' }]

  test('offered when made on the current version and it has real edits', () => {
    expect(shouldOfferDraft({ form: estimate, lines, base_updated_at: LOADED }, estimate)).toBe(true)
  })
  test('dropped when made on an older version', () => {
    expect(shouldOfferDraft({ form: estimate, lines, base_updated_at: '2026-11-04T14:00:00Z' }, estimate)).toBe(false)
  })
  test('dropped when it is a legacy draft without a base', () => {
    expect(shouldOfferDraft({ form: estimate, lines, savedAt: Date.now() + 1e9 }, estimate)).toBe(false)
  })
  test('dropped when it matches the DB (no real edits)', () => {
    expect(shouldOfferDraft({ form: estimate, lines: estimate.estimate_line_items, base_updated_at: LOADED }, estimate)).toBe(false)
  })
  test('garbage drafts are dropped', () => {
    expect(shouldOfferDraft(null, estimate)).toBe(false)
    expect(shouldOfferDraft({}, estimate)).toBe(false)
  })
})

describe('estimateSavePayload', () => {
  test('never sends a client updated_at', () => {
    const { fields } = estimateSavePayload({ project_name: 'x', updated_at: LOADED }, [], ID)
    expect(fields).not.toHaveProperty('updated_at')
  })
  test('statusOverride wins (Won path)', () => {
    expect(estimateSavePayload({ status: 'estimating' }, [], ID, 'won').fields.status).toBe('won')
  })
})
