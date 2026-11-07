// In-memory stand-in for the Supabase client used by API routes in tests.
// Never touches a real database. State lives on `mockState` so each test file can seed it:
//   mockState.db = { table: [rows] }
//   mockState.missingCols = { table: ['col'] }   → writes naming that column fail like PostgREST
//   mockState.failSelect = { table: 'message' }  → reads of that table fail
//   mockState.rpc = { fnName: (args, db) => ({ data, error }) }
//   mockState.beforeWrite = (table, op) => {}    → simulate a concurrent change between read and write
//   mockState.calls = [{ table, op, payload }]   → what was written

const mockState = { db: {}, missingCols: {}, failSelect: {}, rpc: {}, beforeWrite: null, calls: [] }

const get = (r, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), r)

function embed(table, row, cols) {
  const out = { ...row }
  if (typeof cols !== 'string') return out
  if (cols.includes('jobs(') && row.job_id !== undefined) out.jobs = (mockState.db.jobs || []).find(j => j.id === row.job_id) || null
  if (cols.includes('lookahead_activities(')) out.lookahead_activities = (mockState.db.lookahead_activities || []).filter(a => a.lookahead_id === row.id)
  return out
}

let idSeq = 1000

function query(table) {
  const filters = []
  let op = 'select'
  let payload = null
  let cols = '*'
  let countMode = null
  let head = false
  let wantRows = false
  let lim = null
  let single = false
  let maybe = false

  const match = () => (mockState.db[table] || []).filter(r => filters.every(f => f(r)))
  const missing = row => {
    const miss = mockState.missingCols[table] || []
    const keys = Array.isArray(row) ? row.flatMap(Object.keys) : Object.keys(row || {})
    const col = keys.find(k => miss.includes(k))
    return col ? { message: `Could not find the '${col}' column of '${table}' in the schema cache`, code: 'PGRST204' } : null
  }
  const run = () => {
    if (op === 'select' && mockState.failSelect[table]) return { data: null, error: { message: mockState.failSelect[table] } }
    if (op === 'insert') {
      const err = missing(payload)
      if (err) return { data: null, error: err }
      mockState.beforeWrite?.(table, op)
      const rows = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: r.id || `new-${idSeq++}`, created_at: new Date().toISOString(), ...r }))
      mockState.db[table] = [...(mockState.db[table] || []), ...rows]
      mockState.calls.push({ table, op, payload })
      return { data: rows.map(r => embed(table, r, cols)), error: null }
    }
    if (op === 'update') {
      const err = missing(payload)
      if (err) return { data: null, error: err }
      mockState.beforeWrite?.(table, op)
      const hit = match()
      hit.forEach(r => Object.assign(r, payload))
      mockState.calls.push({ table, op, payload, ids: hit.map(r => r.id) })
      return { data: hit.map(r => embed(table, r, cols)), error: null }
    }
    if (op === 'delete') {
      mockState.beforeWrite?.(table, op)
      const hit = match()
      mockState.db[table] = (mockState.db[table] || []).filter(r => !hit.includes(r))
      mockState.calls.push({ table, op, ids: hit.map(r => r.id) })
      return { data: hit.map(r => ({ id: r.id })), error: null }
    }
    let out = match()
    const count = out.length
    if (lim != null) out = out.slice(0, lim)
    if (head) return { data: null, count, error: null }
    return { data: out.map(r => embed(table, r, cols)), count: countMode ? count : undefined, error: null }
  }
  const finish = () => {
    const r = run()
    if (r.error) return r
    if (single || maybe) {
      const rows = r.data || []
      if (single && rows.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
      return { data: rows[0] ?? null, error: null }
    }
    if ((op === 'update' || op === 'delete' || op === 'insert') && !wantRows) return { data: null, error: null }
    return r
  }
  const q = {
    select: (c = '*', opts = {}) => {
      if (op === 'select') { cols = c; countMode = opts.count || null; head = !!opts.head } else { wantRows = true; cols = c }
      return q
    },
    insert: p => { op = 'insert'; payload = p; return q },
    update: p => { op = 'update'; payload = p; return q },
    delete: () => { op = 'delete'; return q },
    eq: (c, v) => { filters.push(r => get(r, c) === v); return q },
    neq: (c, v) => { filters.push(r => { const x = get(r, c); return x != null && x !== v }); return q },
    is: (c, v) => { filters.push(r => (get(r, c) ?? null) === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(get(r, c))); return q },
    lt: (c, v) => { filters.push(r => get(r, c) < v); return q },
    gte: (c, v) => { filters.push(r => get(r, c) >= v); return q },
    lte: (c, v) => { filters.push(r => get(r, c) <= v); return q },
    ilike: (c, v) => { filters.push(r => String(get(r, c) ?? '').toLowerCase() === String(v).replace(/\\(.)/g, '$1').toLowerCase()); return q },
    or: () => q,
    order: () => q,
    limit: n => { lim = n; return q },
    single: () => { single = true; return Promise.resolve(finish()) },
    maybeSingle: () => { maybe = true; return Promise.resolve(finish()) },
    then: (res, rej) => Promise.resolve(finish()).then(res, rej),
  }
  return q
}

const client = {
  from: table => query(table),
  rpc: async (fn, args) => {
    const impl = mockState.rpc[fn]
    if (!impl) return { data: null, error: { message: `Could not find the function public.${fn} in the schema cache`, code: 'PGRST202' } }
    mockState.calls.push({ table: `rpc:${fn}`, op: 'rpc', payload: args })
    return impl(args, mockState.db)
  },
  storage: { from: () => ({ upload: async p => ({ data: { path: p }, error: null }), createSignedUrl: async p => ({ data: { signedUrl: `https://signed/${p}` }, error: null }) }) },
  auth: { admin: { getUserById: async id => ({ data: { user: { id, email: `${id}@x.com` } } }) } },
}

module.exports = {
  mockState,
  supabaseModule: { createClient: () => client },
  resetMockState(db = {}) {
    mockState.db = db
    mockState.missingCols = {}
    mockState.failSelect = {}
    mockState.rpc = {}
    mockState.beforeWrite = null
    mockState.calls = []
  },
}
