/**
 * Prompt 84 — CompanyCam background import.
 *   1. No start_date / end_date sent to CompanyCam (422); local date filter still applies.
 *   2. Honest "skipped": page_done_ids after an out-of-time batch; 23505 still counts.
 *   3. Image allowlist: CompanyCam S3 upload buckets (still-processing photos), lookalikes refused.
 *   4. Cron /api/companycam/import-cron: secret, selection, round-robin, time budget, errors.
 *   5. POST background start / stop / resume, auth; GET state; Owner background list.
 *   6. vercel.json cron.
 * All DB access is the in-memory mock and all CompanyCam calls are a stubbed fetch. Nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const actual = jest.requireActual('../lib/server-auth')
  const { mockState } = require('./helpers/mock-db')
  return { ...actual, requireAuth: async () => mockState.auth }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const as = (role, userId = `${role}1`) => { mockState.auth = { userId, role, email: `${userId}@x.com`, error: null } }
const jreq = (url, method, body, headers = {}) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body, headers) => {
  const res = await handler(jreq(url, method, body, headers))
  return { status: res.status, body: await res.json() }
}

const cc = require('../lib/companycam')
const ccImport = require('../lib/companycam-import')
const batchLib = require('../lib/companycam-import-batch')
const importRoute = require('../app/api/companycam/import/route')
const cronRoute = require('../app/api/companycam/import-cron/route')
const bgRoute = require('../app/api/companycam/background-imports/route')

const CRON_SECRET = 'test-cron-secret'
const json = (data, status = 200, meta) => new Response(JSON.stringify(status < 400 ? { data, errors: null, meta: meta || {} } : { errors: [{ title: 'err' }] }), { status, headers: { 'content-type': 'application/json' } })
const img = name => new Response(Buffer.from(`IMG:${name}`), { status: 200, headers: { 'content-type': 'image/jpeg' } })
const IN = 1762000000 // 2025-11-01
const OUT = 1700000000 // 2023-11-14
const ccPhoto = (id, projectId = '900', extra = {}) => ({
  id: Number(id),
  project_id: Number(projectId),
  creator_name: 'Sam Field',
  captured_at: IN,
  uris: [{ type: 'original', uri: `https://img.companycam.com/${id}/o.jpg` }, { type: 'thumbnail', uri: `https://img.companycam.com/${id}/t.jpg` }],
  ...extra,
})

// pages(url, projectId) → Response for GET /projects/:id/photos; onImage(url) before an image.
function ccWorld({ pages, onImage } = {}) {
  return jest.fn(async (url, opts = {}) => {
    const u = new URL(String(url))
    if (u.hostname !== 'api.companycam.com') { if (onImage) await onImage(u); return img(u.pathname) }
    const p = u.pathname.replace('/public_api/v1', '')
    let m
    if ((m = p.match(/^\/photos\/(\d+)\/tags$/))) return json([])
    if ((m = p.match(/^\/projects\/(\d+)\/photos$/))) return pages(u, m[1])
    return new Response('unexpected', { status: 599 })
  })
}
const listCalls = () => global.fetch.mock.calls.map(c => new URL(String(c[0]))).filter(u => /\/projects\/\d+\/photos$/.test(u.pathname))
const listedProjects = () => listCalls().map(u => u.pathname.match(/projects\/(\d+)/)[1])

const imp = body => call(importRoute.POST, '/api/companycam/import', 'POST', { job_id: 'J1', ...body })
const cron = (secret = CRON_SECRET) => call(cronRoute.GET, '/api/companycam/import-cron', 'GET', undefined, secret ? { authorization: `Bearer ${secret}` } : {})
const job1 = () => mockState.db.jobs.find(j => j.id === 'J1')
const ago = ms => new Date(Date.now() - ms).toISOString()

const realFetch = global.fetch
let warn, info, err
beforeEach(() => {
  resetMockState({
    jobs: [
      { id: 'J1', project_name: 'Russellville', job_number: '2401', job_type: 'commercial', companycam_project_id: '900', companycam_import_state: null },
      { id: 'J2', project_name: 'Conway', job_number: '2402', job_type: 'residential', companycam_project_id: null, companycam_import_state: null },
    ],
    job_photos: [],
    companycam_photo_inbox: [],
    change_log: [],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }],
    profiles: [{ id: 'principal1', full_name: 'Pat Owner', role: 'principal' }],
  })
  mockState.unique = { job_photos: [r => r.companycam_photo_id || null], companycam_photo_inbox: [r => r.companycam_photo_id || null] }
  process.env.COMPANYCAM_API_TOKEN = 'test-api-token'
  process.env.CRON_SECRET = CRON_SECRET
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  info = jest.spyOn(console, 'info').mockImplementation(() => {})
  err = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  global.fetch = realFetch
  delete process.env.COMPANYCAM_API_TOKEN
  delete process.env.CRON_SECRET
  warn.mockRestore(); info.mockRestore(); err.mockRestore()
  jest.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('1) date range is filtered locally, never sent to CompanyCam', () => {
  test('list call has no start_date / end_date; out-of-range photos are not imported or counted', async () => {
    as('principal')
    const pages = jest.fn(u => (u.searchParams.get('after') === 'c2'
      ? json([ccPhoto(4, '900', { captured_at: OUT })], 200, { has_next: false })
      : json([ccPhoto(1), ccPhoto(2, '900', { captured_at: OUT }), ccPhoto(3)], 200, { has_next: true, next_cursor: 'c2' })))
    global.fetch = ccWorld({ pages })
    const r = await imp({ start_date: '2025-01-01', end_date: '2025-12-31', background: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ imported: 2, skipped: 0, out_of_range: 1, done: false })
    expect(job1().companycam_import_state).toMatchObject({ start_date: '2025-01-01', end_date: '2025-12-31', cursor: 'c2', status: 'queued', background: true })
    const c = await cron()
    expect(c.status).toBe(200)
    expect(job1().companycam_import_state).toMatchObject({ status: 'done', imported: 2, skipped: 0, failed: 0, cursor: null })
    for (const u of listCalls()) {
      expect(u.searchParams.has('start_date')).toBe(false)
      expect(u.searchParams.has('end_date')).toBe(false)
    }
    expect(listCalls()).toHaveLength(2) // paged through to the end (no early stop on dates)
    expect(mockState.db.job_photos.map(p => p.companycam_photo_id).sort()).toEqual(['1', '3'])
    expect(read('lib/companycam-import-batch.js')).not.toMatch(/q\.set\('(start|end)_date'/)
    expect(read('app/api/companycam/import/route.js')).not.toMatch(/startEpoch|endEpoch/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2) honest skipped count', () => {
  test('out-of-time batch then re-read: photos handled by the first batch are not counted as skipped', async () => {
    as('principal')
    let clock = Date.now()
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    mockState.db.job_photos.push({ id: 'pre', job_id: 'J1', storage_path: 'J1/gallery/cc-1.jpg', companycam_photo_id: '1' }) // webhook got it earlier
    const page = [ccPhoto(1), ccPhoto(2), ccPhoto(3), ccPhoto(4)]
    const pages = jest.fn(() => json(page, 200, { has_next: false }))
    global.fetch = ccWorld({ pages, onImage: u => { if (u.pathname.endsWith('/o.jpg')) clock += 20000 } })

    const a = await imp({ background: true })
    expect(a.status).toBe(200)
    // 1 was already there (skipped), 2 at +0 s, 3 at +20 s, 4 would start at +40 s > 35 s budget.
    expect(a.body).toMatchObject({ imported: 2, skipped: 1, done: false })
    expect(job1().companycam_import_state).toMatchObject({ cursor: null, status: 'queued', imported: 2, skipped: 1, page_done_ids: ['1', '2', '3'] })

    const c = await cron()
    expect(c.body.jobs).toEqual([expect.objectContaining({ job_id: 'J1', imported: 1, skipped: 0, failed: 0, status: 'done' })])
    expect(listCalls().map(u => u.searchParams.get('after'))).toEqual([null, null]) // same page re-read
    expect(job1().companycam_import_state).toMatchObject({ status: 'done', imported: 3, skipped: 1, failed: 0, page_done_ids: [] })
    expect(mockState.db.job_photos.map(p => p.companycam_photo_id).sort()).toEqual(['1', '2', '3', '4'])
  })

  test('page_done_ids is cleared when the cursor advances', async () => {
    as('principal')
    mockState.db.jobs[0].companycam_import_state = { start_date: null, end_date: null, cursor: 'c1', imported: 2, skipped: 0, failed: 0, page_done_ids: ['1', '2'], background: true, status: 'queued', updated_at: ago(70000) }
    global.fetch = ccWorld({ pages: u => (u.searchParams.get('after') === 'c1' ? json([ccPhoto(1), ccPhoto(2), ccPhoto(3)], 200, { has_next: true, next_cursor: 'c2' }) : json([], 200, { has_next: false })) })
    mockState.db.job_photos.push({ id: 'a', companycam_photo_id: '1' }, { id: 'b', companycam_photo_id: '2' })
    await cron()
    // One more page: c2 (empty, done). 1 and 2 were passed over silently, 3 imported.
    expect(job1().companycam_import_state).toMatchObject({ imported: 3, skipped: 0, page_done_ids: [], status: 'done' })
  })

  test('a 23505 duplicate (another writer won the race) still counts as skipped', async () => {
    as('principal')
    global.fetch = ccWorld({ pages: () => json([ccPhoto(5)], 200, { has_next: false }) })
    mockState.beforeWrite = (table, op) => {
      if (table === 'job_photos' && op === 'insert' && !mockState.raced) { mockState.raced = true; mockState.db.job_photos.push({ id: 'webhook', companycam_photo_id: '5' }) }
    }
    const r = await imp({ background: true })
    expect(r.body).toMatchObject({ imported: 0, skipped: 1, done: true })
    expect(job1().companycam_import_state).toMatchObject({ status: 'done', skipped: 1, imported: 0 })
    delete mockState.raced
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3) image allowlist: CompanyCam S3 upload buckets', () => {
  const GOOD = ['https://companycam-pending.s3.amazonaws.com/x.jpg', 'https://companycam-pending.s3.us-east-1.amazonaws.com/x.jpg', 'https://companycam-uploads-2.s3.amazonaws.com/a/b.jpg', 'https://static.companycam.com/a.jpg']
  const BAD = [
    'https://companycam-pending.s3.amazonaws.com.evil.com/x.jpg',
    'https://evil-companycam-x.s3.amazonaws.com/x.jpg',
    'https://companycampending.s3.amazonaws.com/x.jpg',
    'http://companycam-pending.s3.amazonaws.com/x.jpg',
    'https://user:pw@companycam-pending.s3.amazonaws.com/x.jpg',
    'https://companycam-pending.s3.amazonaws.co/x.jpg',
    'https://companycam-.s3.amazonaws.com.attacker.net/x',
    'https://other-bucket.s3.amazonaws.com/x.jpg',
    'https://s3.amazonaws.com/companycam-pending/x.jpg',
    'https://companycam-pending.s3-website.evil.amazonaws.com.evil/x',
  ]

  test('isAllowedCcImageUrl positives and lookalike negatives', () => {
    for (const u of GOOD) expect([u, cc.isAllowedCcImageUrl(u)]).toEqual([u, true])
    for (const u of BAD) expect([u, cc.isAllowedCcImageUrl(u)]).toEqual([u, false])
  })

  test('downloadImage: allowed as the initial URL and on a redirect hop; lookalikes never requested', async () => {
    const redirect = loc => new Response(null, { status: 302, headers: { location: loc } })
    global.fetch = jest.fn(async () => img('s3'))
    expect((await cc.downloadImage('https://companycam-pending.s3.amazonaws.com/p.jpg')).toString()).toBe('IMG:s3')

    global.fetch = jest.fn(async url => (String(url).startsWith('https://static.companycam.com') ? redirect('https://companycam-pending.s3.us-east-1.amazonaws.com/p.jpg?X-Amz=1') : img('pending')))
    expect((await cc.downloadImage('https://static.companycam.com/p.jpg')).toString()).toBe('IMG:pending')
    expect(global.fetch.mock.calls.map(c => String(c[0]))).toEqual(['https://static.companycam.com/p.jpg', 'https://companycam-pending.s3.us-east-1.amazonaws.com/p.jpg?X-Amz=1'])

    for (const bad of BAD) {
      global.fetch = jest.fn(async () => redirect(bad))
      await expect(cc.downloadImage('https://static.companycam.com/p.jpg')).rejects.toMatchObject({ message: 'Image URL redirected off CompanyCam', retryable: false })
      expect(global.fetch).toHaveBeenCalledTimes(1)
      global.fetch = jest.fn(async () => img('x'))
      await expect(cc.downloadImage(bad)).rejects.toMatchObject({ retryable: false })
      expect(global.fetch).not.toHaveBeenCalled()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4) cron /api/companycam/import-cron', () => {
  const bgState = (status, updatedAgoMs, extra = {}) => ({ start_date: null, end_date: null, cursor: null, imported: 0, skipped: 0, failed: 0, page_done_ids: [], background: true, status, updated_at: ago(updatedAgoMs), ...extra })
  const seed = rows => { mockState.db.jobs = rows.map(([id, pid, st]) => ({ id, project_name: `Job ${id}`, job_number: id, job_type: 'commercial', companycam_project_id: pid, companycam_import_state: st })) }
  const onePhotoEach = () => jest.fn((u, pid) => json([ccPhoto(Number(pid) * 10, pid)], 200, { has_next: false }))

  test('401 without or with a wrong secret (nothing read or fetched)', async () => {
    global.fetch = jest.fn()
    expect((await cron(null)).status).toBe(401)
    expect((await cron('wrong')).status).toBe(401)
    expect((await call(cronRoute.GET, '/api/companycam/import-cron', 'GET', undefined, { 'x-cron-secret': 'wrong' })).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await cron(CRON_SECRET)).status).toBe(401) // fails closed when unset
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('processes queued / paused / stale-running background jobs; skips stopped, done, legacy, fresh-running; oldest first', async () => {
    seed([
      ['A', '901', bgState('queued', 30000)],
      ['B', '902', bgState('paused', 300000, { last_error: 'Could not read CompanyCam photos: CompanyCam API returned 503' })],
      ['C', '903', bgState('running', 120000)], // stale: a batch died
      ['D', '904', bgState('running', 10000)], // fresh: mid-flight elsewhere
      ['E', '905', bgState('stopped', 400000)],
      ['F', '906', bgState('done', 500000)],
      ['G', '907', { ...bgState('paused', 600000), background: undefined }], // legacy paused
      ['H', '908', { ...bgState('queued', 700000), background: false }],
      ['I', null, bgState('queued', 800000)], // unlinked
    ])
    global.fetch = ccWorld({ pages: onePhotoEach() })
    const r = await cron()
    expect(r.status).toBe(200)
    expect(listedProjects()).toEqual(['902', '903', '901']) // updated_at ascending
    expect(r.body.jobs.map(j => j.job_id)).toEqual(['B', 'C', 'A'])
    for (const j of r.body.jobs) expect(j).toMatchObject({ imported: 1, skipped: 0, failed: 0, status: 'done' })
    const byId = id => mockState.db.jobs.find(j => j.id === id).companycam_import_state
    expect(byId('B')).toMatchObject({ status: 'done', last_error: null, updated_by: null })
    expect(byId('D').status).toBe('running')
    expect(byId('E').status).toBe('stopped')
    expect(byId('G').status).toBe('paused')
    expect(byId('H').status).toBe('queued')
  })

  test('stops starting batches once < 5 s of download budget is left (≤ 20 s); download budget capped by the cron clock', async () => {
    let clock = Date.now()
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    seed([['A', '901', bgState('queued', 40000)], ['B', '902', bgState('queued', 30000)], ['C', '903', bgState('queued', 20000)], ['D', '904', bgState('queued', 10000)]])
    global.fetch = ccWorld({ pages: jest.fn((u, pid) => { clock += 15000; return json([], 200, { has_next: true, next_cursor: `n${pid}` }) }) })
    const r = await cron()
    expect(listedProjects()).toEqual(['901', '902']) // started at 0 s and 15 s; not at 30 s
    // A made progress with time left, so it went back in the queue behind D: C, D and A wait.
    expect(r.body).toMatchObject({ time_up: true, waiting: 3 })
    for (const id of ['C', 'D']) expect(mockState.db.jobs.find(j => j.id === id).companycam_import_state).toEqual(bgState('queued', 0, { updated_at: expect.any(String) }))
    const src = read('app/api/companycam/import-cron/route.js')
    expect(src).toMatch(/batchStart - t0 >= CRON_START_CUTOFF_MS \|\| budgetMs < CRON_MIN_BATCH_BUDGET_MS/)
    expect(src).toMatch(/Math\.min\(DOWNLOAD_BUDGET_MS, t0 \+ CRON_DOWNLOAD_CUTOFF_MS - batchStart\)/)
    expect(src).toMatch(/uploadTimeoutMs: CRON_UPLOAD_TIMEOUT_MS/)
    expect(src).toMatch(/export const maxDuration = 60/)
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/)
  })

  test('a late batch gets no photo-download budget (cursor kept); a job that got no batch keeps its place and goes first next tick', async () => {
    let clock = Date.now()
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    seed([['A', '901', bgState('queued', 40000)], ['B', '902', bgState('queued', 30000)]])
    const bBefore = { ...mockState.db.jobs[1].companycam_import_state }
    global.fetch = ccWorld({ pages: jest.fn((u, pid) => { if (pid === '901') clock += 26000; return json([ccPhoto(Number(pid) * 10, pid)], 200, { has_next: false }) }) })
    const r = await cron()
    // A's list took 26 s → past the 25 s download cutoff: nothing downloaded, page kept.
    expect(r.body.jobs).toEqual([expect.objectContaining({ job_id: 'A', imported: 0, status: 'queued' })])
    expect(r.body).toMatchObject({ time_up: true, waiting: 1 })
    expect(mockState.db.job_photos).toEqual([])
    expect(mockState.db.jobs[0].companycam_import_state).toMatchObject({ cursor: null, page_done_ids: [], status: 'queued' })
    // B was not touched at all: no CompanyCam call, same state (same updated_at).
    expect(listedProjects()).toEqual(['901'])
    expect(mockState.db.jobs[1].companycam_import_state).toEqual(bBefore)
    // Next tick: B (never processed) goes before A (processed last tick).
    clock += 60000
    global.fetch = ccWorld({ pages: jest.fn((u, pid) => json([ccPhoto(Number(pid) * 10, pid)], 200, { has_next: false })) })
    const r2 = await cron()
    expect(listedProjects()).toEqual(['902', '901'])
    expect(r2.body.jobs.map(j => [j.job_id, j.status])).toEqual([['B', 'done'], ['A', 'done']])
  })

  test('re-runs a job in the same tick while time is left and it made progress', async () => {
    seed([['A', '901', bgState('queued', 40000)]])
    global.fetch = ccWorld({ pages: jest.fn(u => (u.searchParams.get('after') === 'p2' ? json([ccPhoto(2, '901')], 200, { has_next: false }) : json([ccPhoto(1, '901')], 200, { has_next: true, next_cursor: 'p2' }))) })
    const r = await cron()
    expect(r.body.jobs).toEqual([expect.objectContaining({ job_id: 'A', imported: 2, batches: 2, status: 'done' })])
  })

  test('CompanyCam error on one job → that job paused with last_error, the others still processed', async () => {
    seed([['A', '901', bgState('queued', 40000)], ['B', '902', bgState('queued', 30000)]])
    global.fetch = ccWorld({ pages: jest.fn((u, pid) => (pid === '901' ? json(null, 500) : json([ccPhoto(20, '902')], 200, { has_next: false }))) })
    const r = await cron()
    expect(r.status).toBe(200)
    expect(r.body.jobs).toEqual([
      expect.objectContaining({ job_id: 'A', status: 'paused', error: 'Could not read CompanyCam photos: CompanyCam API returned 500' }),
      expect.objectContaining({ job_id: 'B', imported: 1, status: 'done' }),
    ])
    expect(mockState.db.jobs[0].companycam_import_state).toMatchObject({ status: 'paused', background: true, last_error: 'Could not read CompanyCam photos: CompanyCam API returned 500', updated_by: null })
    // Paused background runs are retried on the next tick.
    expect(mockState.db.jobs[0].companycam_import_state).toMatchObject({ error_count: 1, permanent_error_count: 0, last_error_retryable: true })
    global.fetch = ccWorld({ pages: () => json([ccPhoto(10, '901')], 200, { has_next: false }) })
    mockState.db.jobs[0].companycam_import_state.updated_at = ago(60000)
    mockState.db.jobs[0].companycam_import_state.last_failed_at = ago(60000)
    await cron()
    expect(mockState.db.jobs[0].companycam_import_state).toMatchObject({ status: 'done', imported: 1, last_error: null, error_count: 0, last_failed_at: null })
  })

  test('pre-074 → 200 skipped; missing COMPANYCAM_API_TOKEN → 200 with a reason, nothing done; token never logged', async () => {
    global.fetch = jest.fn()
    mockState.missingSelectCols = { jobs: ['companycam_import_state'] }
    expect(await cron()).toEqual({ status: 200, body: expect.objectContaining({ skipped: 'migration_074' }) })
    mockState.missingSelectCols = {}
    seed([['A', '901', bgState('queued', 40000)]])
    delete process.env.COMPANYCAM_API_TOKEN
    const r = await cron()
    expect(r).toEqual({ status: 200, body: expect.objectContaining({ skipped: 'not_configured', reason: 'COMPANYCAM_API_TOKEN is not set', jobs: [] }) })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.calls).toEqual([])
    const logged = JSON.stringify([...info.mock.calls, ...err.mock.calls, ...warn.mock.calls])
    expect(logged).not.toContain('test-api-token')
    expect(logged).not.toContain(CRON_SECRET)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('5) POST background start / stop / resume; GET state; Owner list', () => {
  const twoPages = () => jest.fn(u => (u.searchParams.get('after') === 'c2' ? json([ccPhoto(3)], 200, { has_next: false }) : json([ccPhoto(1), ccPhoto(2)], 200, { has_next: true, next_cursor: 'c2' })))

  test('background start runs one batch now and saves background:true + who started it', async () => {
    as('pm')
    global.fetch = ccWorld({ pages: twoPages() })
    const r = await imp({ background: true })
    expect(r.status).toBe(200)
    expect(listCalls()).toHaveLength(1)
    expect(r.body).toMatchObject({ imported: 2, done: false, state: { background: true, status: 'queued', cursor: 'c2' } })
    expect(job1().companycam_import_state).toMatchObject({ background: true, status: 'queued', started_by: 'pm1', updated_by: 'pm1', start_date: null, end_date: null, imported: 2, page_done_ids: [] })
    expect(typeof job1().companycam_import_state.started_at).toBe('string')
    for (const p of mockState.db.job_photos) expect(p.internal_only).toBe(true)
    // 409 while fresh 'running'
    job1().companycam_import_state = { ...job1().companycam_import_state, status: 'running', updated_at: new Date().toISOString() }
    expect((await imp({ background: true })).status).toBe(409)
  })

  test('Stop wins over an in-flight batch: its final save keeps "stopped" (progress merged), cron skips it', async () => {
    as('principal')
    let stopResult
    const pages = jest.fn(async () => {
      stopResult = await imp({ stop: true }) // user presses Stop while this batch is reading
      return json([ccPhoto(1), ccPhoto(2)], 200, { has_next: true, next_cursor: 'c2' })
    })
    global.fetch = ccWorld({ pages })
    const r = await imp({ background: true })
    expect(stopResult).toMatchObject({ status: 200, body: { stopped: true, state: { status: 'stopped', stopped_by: 'principal1' } } })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ imported: 2, stopped: true, state: { status: 'stopped' } })
    expect(job1().companycam_import_state).toMatchObject({ status: 'stopped', imported: 2, cursor: 'c2', background: true, stopped_by: 'principal1' })

    global.fetch = ccWorld({ pages: twoPages() })
    job1().companycam_import_state.updated_at = ago(120000)
    await cron()
    expect(listCalls()).toHaveLength(0)
    expect(job1().companycam_import_state.status).toBe('stopped')
  })

  test('Stop on a queued run; stop again is idempotent; nothing to stop → 400', async () => {
    as('principal')
    global.fetch = jest.fn()
    expect((await imp({ stop: true })).status).toBe(400)
    job1().companycam_import_state = { start_date: null, end_date: null, cursor: 'c2', imported: 5, skipped: 0, failed: 0, background: true, status: 'queued', updated_at: ago(5000) }
    const a = await imp({ stop: true })
    expect(a).toMatchObject({ status: 200, body: { stopped: true, state: { status: 'stopped', imported: 5, cursor: 'c2' } } })
    expect((await imp({ stop: true })).status).toBe(200)
    job1().companycam_import_state = { status: 'done', background: true }
    expect((await imp({ stop: true })).status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('resume re-queues a stopped (or legacy paused) run as background and runs one batch from its cursor', async () => {
    as('principal')
    const pages = twoPages()
    global.fetch = ccWorld({ pages })
    job1().companycam_import_state = { start_date: '2025-01-01', end_date: null, cursor: 'c2', imported: 2, skipped: 0, failed: 0, background: true, status: 'stopped', updated_at: ago(5000) }
    const r = await imp({ resume: true })
    expect(r.status).toBe(200)
    expect(pages.mock.calls[0][0].searchParams.get('after')).toBe('c2')
    expect(job1().companycam_import_state).toMatchObject({ status: 'done', background: true, imported: 3, start_date: '2025-01-01' })

    job1().companycam_import_state = { start_date: null, end_date: null, cursor: null, imported: 0, skipped: 0, failed: 0, status: 'paused', updated_at: ago(5000) } // legacy, no flag
    const r2 = await imp({ resume: true })
    expect(r2.body.state).toMatchObject({ background: true, status: 'queued', cursor: 'c2' })
  })

  test('old non-background shape still runs one batch and ends paused (cron ignores it)', async () => {
    as('principal')
    global.fetch = ccWorld({ pages: twoPages() })
    const r = await imp({})
    expect(r.body).toMatchObject({ imported: 2, done: false, state: { status: 'paused', cursor: 'c2' } })
    expect(job1().companycam_import_state.background).toBeUndefined()
    await cron()
    expect(listCalls()).toHaveLength(1)
  })

  test('auth unchanged: non-PM 403, PM not on the job 403, GET state same gate', async () => {
    global.fetch = jest.fn()
    for (const role of ['super', 'apm', 'admin', 'subcontractor']) {
      as(role)
      expect((await imp({ background: true })).status).toBe(403)
      expect((await imp({ stop: true })).status).toBe(403)
      expect((await call(importRoute.GET, '/api/companycam/import?job_id=J1', 'GET')).status).toBe(403)
    }
    as('pm')
    mockState.db.jobs[1].companycam_project_id = '902'
    expect((await call(importRoute.POST, '/api/companycam/import', 'POST', { job_id: 'J2', background: true })).status).toBe(403)
    expect((await call(importRoute.POST, '/api/companycam/import', 'POST', { job_id: 'J2', stop: true })).status).toBe(403)
    expect((await call(importRoute.GET, '/api/companycam/import?job_id=J2', 'GET')).status).toBe(403)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.calls).toEqual([])
    job1().companycam_import_state = { status: 'queued', background: true, imported: 4 }
    const g = await call(importRoute.GET, '/api/companycam/import?job_id=J1', 'GET')
    expect(g).toEqual({ status: 200, body: { companycam_project_id: '900', state: { status: 'queued', background: true, imported: 4 } } })
  })

  test('Owner background list: Owner only, active + recent background runs, read-only', async () => {
    mockState.db.jobs.push(
      { id: 'J3', project_name: 'Searcy', job_number: '2403', companycam_project_id: '903', companycam_import_state: { background: true, status: 'done', imported: 9, skipped: 1, failed: 0, updated_at: ago(60000) } },
      { id: 'J4', project_name: 'Old', job_number: '2404', companycam_project_id: '904', companycam_import_state: { background: true, status: 'done', updated_at: ago(30 * 86400000) } },
      { id: 'J5', project_name: 'Legacy', job_number: '2405', companycam_project_id: '905', companycam_import_state: { status: 'paused', updated_at: ago(1000) } },
    )
    job1().companycam_import_state = { background: true, status: 'queued', imported: 2, skipped: 0, failed: 1, updated_at: ago(120000) }
    as('pm')
    expect((await call(bgRoute.GET, '/api/companycam/background-imports', 'GET')).status).toBe(403)
    as('principal')
    const r = await call(bgRoute.GET, '/api/companycam/background-imports', 'GET')
    expect(r.status).toBe(200)
    expect(r.body.rows.map(x => x.job_id)).toEqual(['J1', 'J3'])
    expect(r.body.rows[0]).toMatchObject({ project_name: 'Russellville', job_number: '2401', status: 'queued', active: true, imported: 2, failed: 1 })
    expect(mockState.calls).toEqual([])
    mockState.missingSelectCols = { jobs: ['companycam_import_state'] }
    expect((await call(bgRoute.GET, '/api/companycam/background-imports', 'GET')).body).toEqual({ rows: [], migration_required: '074' })
  })

  test('pure helpers: background runnable / active / labels', () => {
    const t = Date.parse('2026-11-16T18:00:00Z')
    const iso = ms => new Date(t - ms).toISOString()
    expect(ccImport.isBackgroundRunnable({ background: true, status: 'queued' }, t)).toBe(true)
    expect(ccImport.isBackgroundRunnable({ background: true, status: 'paused' }, t)).toBe(true)
    expect(ccImport.isBackgroundRunnable({ background: true, status: 'running', updated_at: iso(91000) }, t)).toBe(true)
    expect(ccImport.isBackgroundRunnable({ background: true, status: 'running', updated_at: iso(5000) }, t)).toBe(false)
    expect(ccImport.isBackgroundRunnable({ background: true, status: 'stopped' }, t)).toBe(false)
    expect(ccImport.isBackgroundRunnable({ status: 'paused' }, t)).toBe(false)
    expect(ccImport.isBackgroundActive({ background: true, status: 'paused' })).toBe(true)
    expect(ccImport.isBackgroundActive({ background: true, status: 'stopped' })).toBe(false)
    expect(ccImport.importStatusLabel({ status: 'done' })).toBe('Import finished')
    expect(ccImport.centralDateTimeLabel('2026-11-16T20:05:00Z')).toBe('Nov 16, 2:05 PM')
  })

  test('UI: background start, plain help text, Stop / Resume, ~20 s refresh; no browser loop or cap', () => {
    const bar = read('app/components/CompanyCamLinkBar.js')
    expect(bar).toContain('Start background import')
    expect(bar).toContain('Runs on its own about every minute until done. You can close this page.')
    expect(bar).toContain('Resume in background')
    expect(bar).toContain('Already in portal')
    expect(bar).toMatch(/POLL_MS = 20000/)
    expect(bar).toMatch(/background: true/)
    expect(bar).toMatch(/window\.confirm\('Stop the background/)
    expect(bar).not.toMatch(/IMPORT_SESSION_CAP|nextImportStep|for \(let guard/)
    expect(bar).toMatch(/useState\(''\) \/\/ blank = the whole project/)
    const page = read('app/companycam/page.js')
    expect(page).toContain('Background imports')
    expect(page).toContain('/api/companycam/background-imports')
    expect(page).not.toMatch(/lib\/companycam'/)
    expect(page).not.toMatch(/companycam-import-batch/)
    expect(bar).not.toMatch(/companycam-import-batch/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('7) review follow-ups (M1, L1-L8)', () => {
  const bgState = (status, updatedAgoMs, extra = {}) => ({ start_date: null, end_date: null, cursor: null, imported: 0, skipped: 0, failed: 0, page_done_ids: [], background: true, status, started_at: '2026-11-01T00:00:00.000Z', updated_at: ago(updatedAgoMs), ...extra })
  const seed = rows => { mockState.db.jobs = rows.map(([id, pid, st]) => ({ id, project_name: `Job ${id}`, job_number: id, job_type: 'commercial', companycam_project_id: pid, companycam_import_state: st })) }
  const stateOf = id => mockState.db.jobs.find(j => j.id === id).companycam_import_state

  test('M1: 3 queued jobs, each tick used up by one job → strict rotation, every job gets batches, all finish', async () => {
    // Fake clock for Date.now() AND new Date() (state timestamps); real timers for everything else.
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick', 'performance', 'hrtime'] })
    try {
      jest.setSystemTime(Date.parse('2026-11-16T18:00:00Z'))
      seed([['A', '901', bgState('queued', 30000)], ['B', '902', bgState('queued', 20000)], ['C', '903', bgState('queued', 10000)]])
      // 5 photos per job, one page. Each original download takes 12 s: a batch fits 3 photos
      // (starts at 0, 12, 24 s; the 4th would start at 36 s > 25 s), which uses up the tick.
      global.fetch = ccWorld({
        pages: (u, pid) => json([1, 2, 3, 4, 5].map(i => ccPhoto(Number(pid) * 10 + i, pid)), 200, { has_next: false }),
        onImage: u => { if (u.pathname.endsWith('/o.jpg')) jest.setSystemTime(Date.now() + 12000) },
      })
      const ran = []
      for (let tick = 0; tick < 6; tick++) {
        const r = await cron()
        expect(r.status).toBe(200)
        ran.push(r.body.jobs.map(j => `${j.job_id}:${j.imported}`).join(','))
        jest.setSystemTime(Date.now() + 60000)
      }
      expect(ran).toEqual(['A:3', 'B:3', 'C:3', 'A:2', 'B:2', 'C:2'])
      for (const id of ['A', 'B', 'C']) expect(stateOf(id)).toMatchObject({ status: 'done', imported: 5, skipped: 0, failed: 0 })
      expect(mockState.db.job_photos).toHaveLength(15)
    } finally {
      jest.useRealTimers()
    }
  })

  test('M1: a batch with no download budget never claims, lists or saves', async () => {
    seed([['A', '901', bgState('queued', 30000)]])
    const before = { ...stateOf('A') }
    global.fetch = jest.fn()
    const r = await batchLib.runCcImportBatch(require('@supabase/supabase-js').createClient(), mockState.db.jobs[0], { budgetMs: 0 })
    expect(r).toEqual({ kind: 'no_budget' })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(stateOf('A')).toEqual(before)
    expect(mockState.calls).toEqual([])
  })

  test('L1: background start whose queued run is claimed by a cron tick first → 200 with the current state, not 409', async () => {
    as('pm')
    global.fetch = ccWorld({ pages: () => json([ccPhoto(1)], 200, { has_next: false }) })
    let raced = false
    mockState.pauseWrite = (table, op, payload) => {
      if (raced || table !== 'jobs' || op !== 'update' || payload?.companycam_import_state?.status !== 'running') return
      raced = true // the cron claims the freshly queued run just before this request's batch does
      job1().companycam_import_state = { ...job1().companycam_import_state, status: 'running', claim_id: 'cron', updated_at: new Date().toISOString() }
    }
    const r = await imp({ background: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ queued: true, state: { status: 'running', claim_id: 'cron', background: true, started_by: 'pm1' } })
    expect(listCalls()).toHaveLength(0)
    // Same for resume.
    raced = false
    job1().companycam_import_state = { ...bgState('stopped', 5000), cursor: 'c2' }
    const r2 = await imp({ resume: true })
    expect(r2).toMatchObject({ status: 200, body: { queued: true, state: { status: 'running', claim_id: 'cron', cursor: 'c2' } } })
  })

  test('L2: Stop then a quick Resume while a batch is in flight: its counts are merged in, nothing imported twice', async () => {
    as('principal')
    global.fetch = ccWorld({ pages: () => json([ccPhoto(1), ccPhoto(2)], 200, { has_next: true, next_cursor: 'c2' }) })
    let busy = false
    let stop = null
    let resume = null
    mockState.pauseWrite = async (table, op, payload) => {
      const st = payload?.companycam_import_state
      if (busy || stop || table !== 'jobs' || op !== 'update' || st?.status !== 'queued' || st.imported !== 2) return
      // Batch A imported 1 and 2 and is about to save; the user presses Stop, then Resume, and
      // the resumed batch B runs to completion first (same page: 1 and 2 already in the portal).
      busy = true
      stop = await imp({ stop: true })
      resume = await imp({ resume: true })
      busy = false
    }
    const a = await imp({ background: true })
    expect(stop).toMatchObject({ status: 200, body: { stopped: true } })
    expect(resume).toMatchObject({ status: 200, body: { imported: 0, skipped: 2, state: { status: 'queued', cursor: 'c2', imported: 0 } } })
    expect(a.status).toBe(200)
    expect(a.body.imported).toBe(2)
    // A's 2 imported are kept; B's cursor / status are kept.
    expect(job1().companycam_import_state).toMatchObject({ status: 'queued', cursor: 'c2', imported: 2, skipped: 2, background: true })
    expect(mockState.db.job_photos.map(p => p.companycam_photo_id).sort()).toEqual(['1', '2'])
  })

  test('L2: in-flight batch finishing while another batch of the same run is running adds only its counts; that batch then saves its own progress', async () => {
    as('principal')
    global.fetch = ccWorld({ pages: () => json([ccPhoto(1), ccPhoto(2)], 200, { has_next: true, next_cursor: 'c2' }) })
    let done = false
    mockState.pauseWrite = (table, op, payload) => {
      const st = payload?.companycam_import_state
      if (done || table !== 'jobs' || op !== 'update' || st?.status !== 'queued' || st.imported !== 2) return
      done = true // batch B of the same run has claimed it meanwhile (Stop + Resume elsewhere)
      job1().companycam_import_state = { ...job1().companycam_import_state, status: 'running', claim_id: 'B', imported: 0, updated_at: new Date().toISOString() }
    }
    const a = await imp({ background: true })
    expect(a.status).toBe(200)
    expect(job1().companycam_import_state).toMatchObject({ status: 'running', claim_id: 'B', imported: 2, cursor: null })
    expect(mockState.db.job_photos).toHaveLength(2)

    // Then B's own final save (CAS on its exact claim) misses because A added counts: it
    // re-reads, sees its own claim, and saves its cursor / status with A's counts kept.
    let merged = false
    mockState.pauseWrite = (table, op, payload) => {
      const st = payload?.companycam_import_state
      if (merged || table !== 'jobs' || op !== 'update' || !st?.claim_id || st.status === 'running') return
      merged = true // another in-flight batch of this run hands over +2 imported, +1 skipped
      const cur = job1().companycam_import_state
      job1().companycam_import_state = { ...cur, imported: cur.imported + 2, skipped: cur.skipped + 1 }
    }
    job1().companycam_import_state = { ...job1().companycam_import_state, status: 'queued', imported: 5, skipped: 0, cursor: null, updated_at: ago(5000) }
    global.fetch = ccWorld({ pages: () => json([ccPhoto(3)], 200, { has_next: true, next_cursor: 'c9' }) })
    const r = await batchLib.runCcImportBatch(require('@supabase/supabase-js').createClient(), { ...job1() })
    expect(merged).toBe(true)
    expect(r).toMatchObject({ kind: 'ok', imported: 1, state: { status: 'queued', cursor: 'c9', imported: 8, skipped: 1 } })
    expect(job1().companycam_import_state).toMatchObject({ status: 'queued', cursor: 'c9', imported: 8, skipped: 1 })
  })

  test('L3: a DB error on the final save → POST 500 with the error (no state), cron reports an error; both logged', async () => {
    as('principal')
    global.fetch = ccWorld({ pages: () => json([ccPhoto(1)], 200, { has_next: false }) })
    mockState.failWrite = { jobs: (op, payload) => (op === 'update' && payload?.companycam_import_state?.claim_id && payload.companycam_import_state.status !== 'running' ? 'connection reset' : null) }
    const r = await imp({ background: true })
    expect(r.status).toBe(500)
    expect(r.body).toEqual({ error: 'Could not save the import progress: connection reset' })
    expect(err.mock.calls.flat().join(' ')).toMatch(/state save failed for job J1 connection reset/)

    seed([['A', '901', bgState('queued', 30000)]])
    err.mockClear()
    const c = await cron()
    expect(c.status).toBe(200)
    expect(c.body).toMatchObject({ ok: false, errors: 1, jobs: [expect.objectContaining({ job_id: 'A', status: 'error', error: 'Could not save the import progress: connection reset' })] })
    expect(err).toHaveBeenCalled()
  })

  test('L4: cron worst case fits in 60 s; a Storage upload past its cap fails (retryable) instead of hanging', async () => {
    const { CRON_START_CUTOFF_MS, CRON_DOWNLOAD_CUTOFF_MS, CRON_MIN_BATCH_BUDGET_MS, CRON_LIST_DEADLINE_MS, CRON_UPLOAD_TIMEOUT_MS } = batchLib
    expect(CRON_START_CUTOFF_MS).toBe(CRON_DOWNLOAD_CUTOFF_MS - CRON_MIN_BATCH_BUDGET_MS)
    expect(CRON_START_CUTOFF_MS).toBeLessThanOrEqual(20000)
    expect(CRON_START_CUTOFF_MS + 15000).toBeLessThanOrEqual(CRON_LIST_DEADLINE_MS)
    // last download starts ≤ 25 s, ends ≤ 40 s; original upload ≤ 8 s → 48 s; ≥ 10 s left for DB saves.
    expect(CRON_DOWNLOAD_CUTOFF_MS + cc.DOWNLOAD_TIMEOUT_MS + CRON_UPLOAD_TIMEOUT_MS).toBeLessThanOrEqual(50000)

    const base = require('@supabase/supabase-js').createClient()
    const hanging = { from: t => base.from(t), storage: { from: () => ({ upload: () => new Promise(() => {}), remove: async () => ({ data: [], error: null }) }) } }
    global.fetch = ccWorld({})
    const photo = cc.normalizeCcPhoto(ccPhoto(7))
    const t = Date.now()
    const r = await cc.importCcPhotoToJob(hanging, { job: { id: 'J1' }, photo, uploadTimeoutMs: 50 })
    expect(r).toEqual({ status: 'failed', error: 'Storage upload timed out', retryable: true })
    expect(Date.now() - t).toBeLessThan(2000)
    expect(mockState.db.job_photos).toEqual([])
  })

  test('L5 / L6: the bar polls only for Owner / PM; a legacy fresh running import shows "Import running…" and no Start form', () => {
    const bar = read('app/components/CompanyCamLinkBar.js')
    expect(bar).toMatch(/const canEdit = atLeastPM\(userRole\)/)
    expect(bar).toMatch(/const poll = canEdit && \(active \|\| runningNow\)/)
    expect(bar).toMatch(/if \(!poll \|\| !jobId\) return undefined/)
    expect(bar).toMatch(/const runningNow = !!current && !active && isImportRunning\(state\)/)
    expect(bar).toContain('Import running…')
    expect(bar).toMatch(/canEdit && current && !active && !runningNow && \(showStart/)
  })

  test('L7: Owner list filters in the query and is capped at 200 rows', async () => {
    const src = read('app/api/companycam/background-imports/route.js')
    expect(src).toMatch(/const MAX_ROWS = 200/)
    expect(src).toMatch(/\.limit\(MAX_ROWS\)/)
    expect(src).toMatch(/\.or\(\[/)
    expect(src).toMatch(/background\.eq\.true/)
    expect(src).toMatch(/\.order\(`\$\{ST\}updated_at`, \{ ascending: false \}\)/)
  })

  test('L8: 10 permanent failures in a row park the run (paused, background false); cron stops; Owner list shows it; Resume restarts it', async () => {
    seed([['A', '901', bgState('paused', 120000, { last_error: 'x', error_count: 9, permanent_error_count: 9, last_error_retryable: false, last_failed_at: ago(120000) })]])
    global.fetch = ccWorld({ pages: () => json(null, 404) })
    const c = await cron()
    expect(c.body.jobs[0]).toMatchObject({ job_id: 'A', status: 'paused' })
    expect(stateOf('A')).toMatchObject({ status: 'paused', background: false, paused_reason: 'repeated_errors', permanent_error_count: 10, error_count: 10, last_error: 'Could not read CompanyCam photos: CompanyCam API returned 404' })
    expect(ccImport.importStatusLabel(stateOf('A'))).toBe('Paused after repeated errors — Resume to try again')
    expect(ccImport.canResumeImport(stateOf('A'))).toBe(true)
    expect(ccImport.isBackgroundActive(stateOf('A'))).toBe(false)

    stateOf('A').updated_at = ago(3600000); stateOf('A').last_failed_at = ago(3600000)
    global.fetch = ccWorld({ pages: () => json([ccPhoto(1, '901')], 200, { has_next: false }) })
    await cron()
    expect(listCalls()).toHaveLength(0) // never picked up again by the cron

    as('principal')
    const list = await call(bgRoute.GET, '/api/companycam/background-imports', 'GET')
    expect(list.body.rows).toEqual([expect.objectContaining({ job_id: 'A', status: 'paused', parked: true })])

    mockState.db.pm_job_assignments = []
    const r = await call(importRoute.POST, '/api/companycam/import', 'POST', { job_id: 'A', resume: true })
    expect(r.status).toBe(200)
    expect(stateOf('A')).toMatchObject({ status: 'done', background: true, imported: 1, error_count: 0, permanent_error_count: 0, paused_reason: null, last_error: null })
  })

  test('L8: a permanent failure counts up but keeps running; retryable failures back off (2^(n-1) min, max 15)', async () => {
    seed([['A', '901', bgState('queued', 30000)], ['B', '902', bgState('queued', 20000)]])
    global.fetch = ccWorld({ pages: (u, pid) => json(null, pid === '901' ? 404 : 503) })
    await cron()
    expect(stateOf('A')).toMatchObject({ status: 'paused', background: true, error_count: 1, permanent_error_count: 1, last_error_retryable: false })
    expect(stateOf('B')).toMatchObject({ status: 'paused', background: true, error_count: 1, permanent_error_count: 0, last_error_retryable: true })

    const now = Date.now()
    expect(ccImport.importRetryDelayMs({ error_count: 1, last_error_retryable: true })).toBe(60000)
    expect(ccImport.importRetryDelayMs({ error_count: 3, last_error_retryable: true })).toBe(240000)
    expect(ccImport.importRetryDelayMs({ error_count: 12, last_error_retryable: true })).toBe(15 * 60000)
    expect(ccImport.importRetryDelayMs({ error_count: 5, last_error_retryable: false })).toBe(0)

    // B failed 3 times in a row (retryable): waits 4 minutes after the last failure.
    Object.assign(stateOf('B'), { error_count: 3, last_failed_at: new Date(now - 60000).toISOString() })
    Object.assign(stateOf('A'), { last_failed_at: new Date(now - 60000).toISOString() })
    global.fetch = ccWorld({ pages: (u, pid) => json([ccPhoto(Number(pid) * 10, pid)], 200, { has_next: false }) })
    await cron()
    expect(listedProjects()).toEqual(['901']) // A (permanent, < 10) retried every minute; B backing off
    expect(stateOf('A')).toMatchObject({ status: 'done', error_count: 0, permanent_error_count: 0 })
    expect(stateOf('B').status).toBe('paused')

    stateOf('B').last_failed_at = new Date(now - 4 * 60000).toISOString()
    global.fetch = ccWorld({ pages: (u, pid) => json([ccPhoto(Number(pid) * 10, pid)], 200, { has_next: false }) })
    await cron()
    expect(listedProjects()).toEqual(['902'])
    expect(stateOf('B')).toMatchObject({ status: 'done', error_count: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('6) vercel.json', () => {
  test('new per-minute cron added; the original four unchanged', () => {
    const v = JSON.parse(read('vercel.json'))
    expect(v.crons).toEqual([
      { path: '/api/billing-reminders', schedule: '0 14 * * *' },
      { path: '/api/coi-reminder', schedule: '0 15 * * *' },
      { path: '/api/notify-deliveries', schedule: '0 13 * * *' },
      { path: '/api/mileage-reminder', schedule: '0 21 * * 5' },
      { path: '/api/companycam/import-cron', schedule: '* * * * *' },
    ])
  })
})
