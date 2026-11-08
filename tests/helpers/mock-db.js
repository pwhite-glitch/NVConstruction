// In-memory stand-in for the Supabase client used by API routes in tests.
// Never touches a real database. State lives on `mockState` so each test file can seed it:
//   mockState.db = { table: [rows] }
//   mockState.missingCols = { table: ['col'] }   → writes naming that column fail like PostgREST
//   mockState.failSelect = { table: 'message' }  → reads of that table fail
//   mockState.missingSelectCols = { table: ['col'] } → reads naming that column fail (42703)
//   mockState.authUsers = [{ id, email }]        → auth.admin.listUsers()
//   mockState.rpc = { fnName: (args, db) => ({ data, error }) }
//   mockState.beforeWrite = (table, op) => {}    → simulate a concurrent change between read and write
//   mockState.triggers = { table: ({ op, payload, rows }) => error | null } → DB trigger stand-in,
//       run after beforeWrite (rows = matched rows for update, new rows for insert)
//   mockState.calls = [{ table, op, payload }]   → what was written
//   mockState.pauseWrite = async (table, op, payload) => {} → awaited before a write runs, so a
//       test can pause one request mid-flight and run another request to completion

const mockState = { db: {}, missingCols: {}, failSelect: {}, missingSelectCols: {}, authUsers: [], rpc: {}, beforeWrite: null, pauseWrite: null, triggers: {}, calls: [], files: {}, failUpload: {}, failWrite: {}, strictUpload: false, defaults: {}, unique: {} }

const get = (r, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), r)

function embed(table, row, cols) {
  const out = { ...row }
  if (typeof cols !== 'string') return out
  if (cols.includes('jobs(') && row.job_id !== undefined) out.jobs = (mockState.db.jobs || []).find(j => j.id === row.job_id) || null
  if (cols.includes('lookahead_activities(')) out.lookahead_activities = (mockState.db.lookahead_activities || []).filter(a => a.lookahead_id === row.id)
  return out
}

function likeRegex(pattern) {
  let out = ''
  const s = String(pattern)
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length) { out += s[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue }
    if (ch === '%') out += '[\\s\\S]*'
    else if (ch === '_') out += '[\\s\\S]'
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`, 'i')
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
  let rng = null
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
    if (op === 'select' && typeof cols === 'string') {
      const col = (mockState.missingSelectCols?.[table] || []).find(c => new RegExp(`\\b${c}\\b`).test(cols))
      if (col) return { data: null, error: { message: `column ${table}.${col} does not exist`, code: '42703' } }
    }
    const fw = mockState.failWrite?.[table]
    if (op !== 'select' && fw) {
      const m = typeof fw === 'function' ? fw(op, payload) : fw[op]
      if (m) return { data: null, error: typeof m === 'object' ? m : { message: m } }
    }
    if (op === 'insert') {
      const err = missing(payload)
      if (err) return { data: null, error: err }
      mockState.beforeWrite?.(table, op)
      const rows = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: r.id || `new-${idSeq++}`, created_at: new Date().toISOString(), ...(mockState.defaults?.[table]?.(r) || {}), ...r }))
      const tErr = mockState.triggers?.[table]?.({ op, payload, rows })
      if (tErr) return { data: null, error: tErr }
      // Optional unique checks: mockState.unique = { table: [row => key | null] }
      for (const keyOf of mockState.unique?.[table] || []) {
        const existing = new Set((mockState.db[table] || []).map(keyOf).filter(k => k != null))
        for (const r of rows) {
          const k = keyOf(r)
          if (k != null && existing.has(k)) return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
          if (k != null) existing.add(k)
        }
      }
      mockState.db[table] = [...(mockState.db[table] || []), ...rows]
      mockState.calls.push({ table, op, payload })
      return { data: rows.map(r => embed(table, r, cols)), error: null }
    }
    if (op === 'update') {
      const err = missing(payload)
      if (err) return { data: null, error: err }
      mockState.beforeWrite?.(table, op)
      const hit = match()
      const tErr = mockState.triggers?.[table]?.({ op, payload, rows: hit })
      if (tErr) return { data: null, error: tErr }
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
    if (rng) out = out.slice(rng[0], rng[1] + 1)
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
  const exec = () => (op !== 'select' && mockState.pauseWrite
    ? Promise.resolve(mockState.pauseWrite(table, op, payload)).then(finish)
    : Promise.resolve(finish()))
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
    gt: (c, v) => { filters.push(r => get(r, c) != null && Number(get(r, c)) > v); return q },
    gte: (c, v) => { filters.push(r => get(r, c) >= v); return q },
    lte: (c, v) => { filters.push(r => get(r, c) <= v); return q },
    // Real LIKE semantics (case-insensitive): % and _ are wildcards unless escaped with \.
    ilike: (c, v) => { const re = likeRegex(v); filters.push(r => get(r, c) != null && re.test(String(get(r, c)))); return q },
    or: () => q,
    order: () => q,
    limit: n => { lim = n; return q },
    range: (a, b) => { rng = [a, b]; return q },
    single: () => { single = true; return exec() },
    maybeSingle: () => { maybe = true; return exec() },
    then: (res, rej) => exec().then(res, rej),
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
  storage: { from: bucket => ({
    // Files are kept in mockState.files['<bucket>/<path>'] (Buffer) when a test seeds/reads them.
    upload: async (p, body, opts = {}) => {
      if (mockState.failUpload?.[bucket]) return { data: null, error: { message: mockState.failUpload[bucket] } }
      const key = `${bucket}/${p}`
      if (mockState.files[key] && !opts.upsert && mockState.strictUpload) return { data: null, error: { message: 'The resource already exists' } }
      mockState.files[key] = Buffer.isBuffer(body) ? body : Buffer.from(body && body.arrayBuffer ? await body.arrayBuffer() : String(body ?? ''))
      mockState.calls.push({ table: `storage:${bucket}`, op: 'upload', payload: p })
      return { data: { path: p }, error: null }
    },
    download: async p => {
      const buf = mockState.files[`${bucket}/${p}`]
      if (!buf) return { data: null, error: { message: 'Object not found' } }
      return { data: { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, error: null }
    },
    createSignedUrl: async p => ({ data: { signedUrl: `https://signed/${p}` }, error: null }),
    createSignedUploadUrl: async p => ({ data: { signedUrl: `https://upload/${p}` }, error: null }),
    remove: async paths => { for (const p of paths) delete mockState.files[`${bucket}/${p}`]; mockState.calls.push({ table: `storage:${bucket}`, op: 'remove', payload: paths }); return { data: paths, error: null } },
  }) },
  auth: { admin: {
    getUserById: async id => ({ data: { user: { id, email: `${id}@x.com` } } }),
    listUsers: async () => ({ data: { users: mockState.authUsers || [] }, error: null }),
  } },
}

module.exports = {
  mockState,
  supabaseModule: { createClient: () => client },
  resetMockState(db = {}) {
    mockState.db = db
    mockState.missingCols = {}
    mockState.failSelect = {}
    mockState.missingSelectCols = {}
    mockState.authUsers = []
    mockState.rpc = {}
    mockState.beforeWrite = null
    mockState.triggers = {}
    mockState.calls = []
    mockState.pauseWrite = null
    mockState.files = {}
    mockState.failUpload = {}
    mockState.failWrite = {}
    mockState.strictUpload = false
    mockState.defaults = {}
    mockState.unique = {}
  },
}
