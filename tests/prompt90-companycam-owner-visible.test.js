/**
 * Prompt 90 — CompanyCam photos visible to the owner by default + owner photo list 1,000-row cap
 * + bulk Show / Hide on the job Photos tab.
 *   A. Every CompanyCam import path (webhook photo.created, manual import, background cron,
 *      Owner Unmatched → Assign) inserts job_photos with internal_only false; a row that already
 *      exists keeps its internal_only (re-import, duplicate delivery, 23505 race, tag sync).
 *   B. Owner photos (and the job / field Photos lists) page job_photos DB-side past 1,000 rows;
 *      daily-report-referenced photos are looked up by exact path; still fail closed.
 *   C. /api/photo-visibility bulk { job_id, paths, internal_only }: cap 200, job-scoped,
 *      role-checked, one update, one change_log entry; the single-path shape is unchanged.
 * All DB access is the in-memory mock (mockState.maxRows stands in for PostgREST's 1,000-row
 * cap) and all CompanyCam calls are a stubbed fetch. Nothing live.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { mockState, resetMockState, supabaseModule } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const forbid = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : forbid()),
    isPM: r => PM.has(r),
    isSub: () => false,
    PM_ROLES: PM,
    verifyCronSecret: jest.requireActual('../lib/server-auth').verifyCronSecret,
  }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const jreq = (url, method, body, headers = {}) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body, headers) => {
  const res = await handler(jreq(url, method, body, headers))
  return { status: res.status, body: await res.json() }
}

const cc = require('../lib/companycam')
const paged = require('../lib/job-photo-pages')
const bulk = require('../lib/photo-bulk-select')
const webhook = require('../app/api/companycam/webhook/route')
const importRoute = require('../app/api/companycam/import/route')
const cronRoute = require('../app/api/companycam/import-cron/route')
const unmatchedRoute = require('../app/api/companycam/unmatched/route')
const ownerPhotos = require('../app/api/owner-photos/route')
const vis = require('../app/api/photo-visibility/route')

const HOOK_TOKEN = 'test-webhook-token'
const CRON_SECRET = 'test-cron-secret'

// ── CompanyCam stand-in ──────────────────────────────────────────────────────
const json = (data, status = 200, meta) => new Response(JSON.stringify(status < 400 ? { data, errors: null, meta: meta || {} } : { errors: [{ title: 'err' }] }), { status, headers: { 'content-type': 'application/json' } })
const img = name => new Response(Buffer.from(`IMG:${name}`), { status: 200, headers: { 'content-type': 'image/jpeg' } })
const ccPhoto = (id, projectId = '900', extra = {}) => ({
  id: Number(id),
  project_id: Number(projectId),
  creator_name: 'Sam Field',
  captured_at: 1762000000,
  uris: [{ type: 'original', uri: `https://img.companycam.com/${id}/o.jpg` }, { type: 'thumbnail', uri: `https://img.companycam.com/${id}/t.jpg` }],
  ...extra,
})
function ccWorld({ photos = {}, projects = {}, pages = null, tags = {} } = {}) {
  return jest.fn(async url => {
    const u = new URL(String(url))
    if (u.hostname !== 'api.companycam.com') return img(u.pathname)
    const p = u.pathname.replace('/public_api/v1', '')
    let m
    if ((m = p.match(/^\/photos\/(\d+)\/tags$/))) return json(tags[m[1]] || [])
    if ((m = p.match(/^\/photos\/(\d+)$/))) return photos[m[1]] ? json(photos[m[1]]) : json(null, 404)
    if ((m = p.match(/^\/projects\/(\d+)\/photos$/))) return pages(u)
    if ((m = p.match(/^\/projects\/(\d+)$/))) return projects[m[1]] ? json(projects[m[1]]) : json(null, 404)
    return new Response('unexpected', { status: 599 })
  })
}
const sign = raw => crypto.createHmac('sha1', HOOK_TOKEN).update(raw).digest('base64')
const deliver = async body => {
  const raw = JSON.stringify(body)
  const res = await webhook.POST(new Request('http://x/api/companycam/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-companycam-signature': sign(raw) }, body: raw }))
  return { status: res.status, body: await res.json() }
}
const event = (type, id) => ({ event_type: type, created_at: 1762000000, payload: { photo: { id: String(id) } }, webhook_id: '42' })
const imp = body => call(importRoute.POST, '/api/companycam/import', 'POST', { job_id: 'J1', ...body })
const cron = () => call(cronRoute.GET, '/api/companycam/import-cron', 'GET', undefined, { authorization: `Bearer ${CRON_SECRET}` })
const ccRow = id => mockState.db.job_photos.find(p => p.companycam_photo_id === String(id))
const existingCc = (id, extra = {}) => ({ id: `old-${id}`, job_id: 'J1', storage_path: `J1/gallery/cc-${id}.jpg`, companycam_photo_id: String(id), companycam_tags: ['Old'], internal_only: true, ...extra })

const realFetch = global.fetch
let spies = []
const seedCc = (extra = {}) => {
  resetMockState({
    jobs: [
      { id: 'J1', project_name: 'Russellville', job_number: '2401', job_type: 'commercial', companycam_project_id: '900', companycam_import_state: null, owner_email: 'client@x.test' },
      { id: 'J2', project_name: 'Conway', job_number: '2402', job_type: 'residential', companycam_project_id: null, companycam_import_state: null },
    ],
    job_photos: [],
    companycam_photo_inbox: [],
    change_log: [],
    daily_reports: [],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'super1' }],
    profiles: [{ id: 'principal1', full_name: 'Pat Owner', role: 'principal' }, { id: 'pm1', full_name: 'Pam PM', role: 'pm' }],
    ...extra,
  })
  mockState.unique = { job_photos: [r => r.companycam_photo_id || null], companycam_photo_inbox: [r => r.companycam_photo_id || null] }
}
beforeEach(() => {
  seedCc()
  process.env.COMPANYCAM_WEBHOOK_TOKEN = HOOK_TOKEN
  process.env.COMPANYCAM_API_TOKEN = 'test-api-token'
  process.env.CRON_SECRET = CRON_SECRET
  spies = ['warn', 'info', 'error'].map(k => jest.spyOn(console, k).mockImplementation(() => {}))
})
afterEach(() => {
  global.fetch = realFetch
  delete process.env.COMPANYCAM_WEBHOOK_TOKEN
  delete process.env.COMPANYCAM_API_TOKEN
  delete process.env.CRON_SECRET
  spies.forEach(s => s.mockRestore())
  jest.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('A) CompanyCam imports are owner-visible by default', () => {
  test('one shared default: CC_IMPORT_INTERNAL_ONLY is false and the insert uses it', () => {
    expect(cc.CC_IMPORT_INTERNAL_ONLY).toBe(false)
    const src = read('lib/companycam.js')
    expect(src).not.toMatch(/internal_only:\s*true/)
    expect(src.match(/internal_only: CC_IMPORT_INTERNAL_ONLY/g)).toHaveLength(2) // row + insertJobPhotoWithFallbacks extra
    // Every path goes through importCcPhotoToJob — nobody inserts CompanyCam rows on their own.
    for (const f of ['lib/companycam-import-batch.js', 'app/api/companycam/unmatched/route.js', 'app/api/companycam/import/route.js', 'app/api/companycam/import-cron/route.js', 'app/api/companycam/webhook/route.js']) {
      expect([f, /from\('job_photos'\)\.insert/.test(read(f))]).toEqual([f, false])
    }
  })

  test('webhook photo.created → internal_only false; the owner portal lists it', async () => {
    global.fetch = ccWorld({ photos: { 555: ccPhoto(555) } })
    expect((await deliver(event('photo.created', 555))).body.status).toBe('imported')
    expect(ccRow(555).internal_only).toBe(false)
    expect(mockState.calls.find(c => c.table === 'job_photos' && c.op === 'insert').payload.internal_only).toBe(false)
    as('owner', 'owner1', 'client@x.test')
    const r = await call(ownerPhotos.GET, '/api/owner-photos?job_id=J1', 'GET')
    expect(r.body.photos.map(p => p.path)).toEqual(['J1/gallery/cc-555.jpg'])
  })

  test('manual import button (POST /api/companycam/import) → internal_only false', async () => {
    as('principal')
    global.fetch = ccWorld({ pages: () => json([ccPhoto(1), ccPhoto(2)], 200, { has_next: false }) })
    const r = await imp({})
    expect(r.status).toBe(200)
    expect(mockState.db.job_photos.map(p => [p.companycam_photo_id, p.internal_only]).sort()).toEqual([['1', false], ['2', false]])
  })

  test('background cron (/api/companycam/import-cron) → internal_only false', async () => {
    as('pm')
    global.fetch = ccWorld({ pages: u => (u.searchParams.get('after') === 'c2' ? json([ccPhoto(3)], 200, { has_next: false }) : json([ccPhoto(1), ccPhoto(2)], 200, { has_next: true, next_cursor: 'c2' })) })
    expect((await imp({ background: true })).status).toBe(200)
    expect(ccRow(3)).toBeUndefined()
    const c = await cron()
    expect(c.status).toBe(200)
    expect(ccRow(3)).toBeTruthy() // imported by the cron batch
    expect(mockState.db.job_photos.map(p => [p.companycam_photo_id, p.internal_only]).sort()).toEqual([['1', false], ['2', false], ['3', false]])
  })

  test('Owner Unmatched → Assign → internal_only false', async () => {
    as('principal')
    mockState.db.companycam_photo_inbox.push({ id: 'ib1', companycam_photo_id: '701', companycam_project_id: '901', status: 'unmatched', created_at: '2026-11-16T10:00:00Z' })
    global.fetch = ccWorld({ photos: { 701: ccPhoto(701, '901') } })
    const r = await call(unmatchedRoute.POST, '/api/companycam/unmatched', 'POST', { inbox_id: 'ib1', action: 'assign', job_id: 'J2' })
    expect(r.status).toBe(200)
    expect(ccRow(701)).toMatchObject({ job_id: 'J2', internal_only: false })
  })
})

describe('A2) an existing row keeps its internal_only (an office hide sticks)', () => {
  test('webhook photo.created again for a hidden photo → duplicate, still hidden, no write', async () => {
    seedCc({ job_photos: [existingCc(555)] })
    global.fetch = ccWorld({ photos: { 555: ccPhoto(555) } })
    expect((await deliver(event('photo.created', 555))).body.status).toBe('duplicate')
    expect(ccRow(555).internal_only).toBe(true)
    expect(mockState.calls.filter(c => c.table === 'job_photos')).toEqual([])
  })

  test('photo.updated / tag sync → tags change, internal_only does not', async () => {
    seedCc({ job_photos: [existingCc(555)] })
    global.fetch = ccWorld({ photos: { 555: ccPhoto(555) }, tags: { 555: [{ display_value: 'Framing', value: 'framing' }] } })
    await deliver(event('photo.updated', 555))
    expect(ccRow(555)).toMatchObject({ internal_only: true, companycam_tags: ['Framing'] })
    for (const c of mockState.calls.filter(c => c.table === 'job_photos' && c.op === 'update')) expect('internal_only' in c.payload).toBe(false)
  })

  test('manual re-import of a project → hidden rows stay hidden, new ones are visible', async () => {
    seedCc({ job_photos: [existingCc(1)] })
    as('principal')
    global.fetch = ccWorld({ pages: () => json([ccPhoto(1), ccPhoto(2)], 200, { has_next: false }) })
    expect((await imp({})).status).toBe(200)
    expect(ccRow(1).internal_only).toBe(true)
    expect(ccRow(2).internal_only).toBe(false)
  })

  test('Assign of a photo that is already in a job → duplicate, flag untouched', async () => {
    seedCc({ job_photos: [existingCc(701)] })
    as('principal')
    mockState.db.companycam_photo_inbox.push({ id: 'ib1', companycam_photo_id: '701', companycam_project_id: '901', status: 'failed', created_at: '2026-11-16T10:00:00Z' })
    global.fetch = ccWorld({ photos: { 701: ccPhoto(701, '901') } })
    await call(unmatchedRoute.POST, '/api/companycam/unmatched', 'POST', { inbox_id: 'ib1', action: 'assign', job_id: 'J1' })
    expect(mockState.db.job_photos).toHaveLength(1)
    expect(ccRow(701).internal_only).toBe(true)
  })

  test('23505 race: the winning (hidden) row is kept as is', async () => {
    global.fetch = ccWorld()
    mockState.beforeWrite = (table, op) => {
      if (table === 'job_photos' && op === 'insert' && !mockState.db.job_photos.length) mockState.db.job_photos.push(existingCc(555, { id: 'winner' }))
    }
    const r = await cc.importCcPhotoToJob(supabaseModule.createClient(), { job: { id: 'J1' }, photo: cc.normalizeCcPhoto(ccPhoto(555)) })
    expect(r).toMatchObject({ status: 'duplicate', jobPhotoId: 'winner' })
    expect(mockState.db.job_photos).toHaveLength(1)
    expect(ccRow(555).internal_only).toBe(true)
  })

  test('no backfill: nothing in the change flips existing rows', () => {
    const files = fs.readdirSync(path.join(root, 'migrations'))
    expect(files.filter(f => /^0(7[7-9]|[89]\d)_/.test(f))).toEqual([]) // no new migration
    expect(read('lib/companycam.js')).not.toMatch(/update\(\{\s*internal_only/)
  })

  test('UI copy no longer says assigned photos are internal only', () => {
    const page = read('app/companycam/page.js')
    expect(page).not.toMatch(/as internal only/)
    expect(page).toMatch(/the owner can see them/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('B) owner photo list pages past 1,000 rows', () => {
  const N = 2500
  const many = () => Array.from({ length: N }, (_, i) => ({ id: `p${String(i).padStart(5, '0')}`, job_id: 'J1', storage_path: `J1/g/${String(i).padStart(5, '0')}.jpg`, internal_only: false, taken_at: '2026-11-01T15:00:00Z' }))
  const ownerGet = async () => { as('owner', 'owner1', 'client@x.test'); return call(ownerPhotos.GET, '/api/owner-photos?job_id=J1&limit=100&offset=0', 'GET') }

  test('2,500 visible photos with a 1,000-row cap → total 2,500; internal rows excluded in the query', async () => {
    seedCc({ job_photos: [...many(), { id: 'hid', job_id: 'J1', storage_path: 'J1/g/hidden.jpg', internal_only: true }, { id: 'other', job_id: 'J2', storage_path: 'J2/g/x.jpg', internal_only: false }] })
    mockState.maxRows = { job_photos: 1000 }
    const r = await ownerGet()
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ total: N, limit: 100, offset: 0, has_more: true })
    expect(r.body.photos).toHaveLength(100)
  })

  test('a daily-report photo whose gallery row sits on page 2+ is shown; hidden / missing rows stay hidden', async () => {
    const rows = many()
    rows[1700].taken_at = '2026-11-21T15:00:00Z' // newest, so it leads page 1 of the owner list
    rows[2100].internal_only = true // office hid it
    seedCc({
      job_photos: rows,
      daily_reports: [{
        id: 'f1', job_id: 'J1', report_date: '2026-11-20', status: 'final', photos: [
          { path: rows[1700].storage_path, job_photo_id: rows[1700].id, source: 'job_photos' },
          { path: rows[2100].storage_path, job_photo_id: rows[2100].id, source: 'job_photos' },
          { path: 'J1/g/gone.jpg', job_photo_id: 'nope', source: 'job_photos' }, // row deleted → fail closed
        ],
      }],
    })
    mockState.maxRows = { job_photos: 1000 }
    const r = await ownerGet()
    expect(r.status).toBe(200)
    const paths = r.body.photos.map(p => p.path)
    expect(paths[0]).toBe(rows[1700].storage_path) // row 1,701 of the job: past the first 1,000
    expect(paths).not.toContain(rows[2100].storage_path)
    expect(paths).not.toContain('J1/g/gone.jpg')
    expect(r.body.total).toBe(N - 1)
  })

  test('referenced paths are looked up by exact path even when the paged read misses them', async () => {
    // A row the visible-only paged read does not return (hidden) still decides the report element.
    seedCc({
      job_photos: [{ id: 'h1', job_id: 'J1', storage_path: 'J1/g/h1.jpg', internal_only: true }],
      daily_reports: [{ id: 'f1', job_id: 'J1', report_date: '2026-11-20', status: 'final', photos: [{ path: 'J1/g/h1.jpg', internal_only: false }] }],
    })
    const r = await ownerGet()
    expect(r.body.photos).toEqual([]) // marked internal in the gallery → hidden everywhere
    expect(read('app/api/owner-photos/route.js')).toMatch(/fetchJobPhotosByPaths\(adminSupabase, jobId, refPaths\)/)
  })

  test('fetchAllJobPhotos: ordered, ranged pages of 1,000 until a short page; de-duplicates', async () => {
    seedCc({ job_photos: many() })
    mockState.maxRows = { job_photos: 1000 }
    const r = await paged.fetchAllJobPhotos(supabaseModule.createClient(), 'J1')
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(N)
    expect(new Set(r.data.map(p => p.id)).size).toBe(N)
    const src = read('lib/job-photo-pages.js')
    expect(src).toMatch(/\.order\('taken_at', \{ ascending: false, nullsFirst: false \}\)\s*\.order\('id'/)
    expect(src).toMatch(/\.range\(from, from \+ pageSize - 1\)/)
    expect(src).toMatch(/q\.not\('internal_only', 'is', true\)/)
    // exactly 1,000 rows → one extra (empty) page, then stop
    seedCc({ job_photos: many().slice(0, 1000) })
    const db = supabaseModule.createClient()
    const spy = jest.spyOn(db, 'from')
    expect((await paged.fetchAllJobPhotos(db, 'J1')).data).toHaveLength(1000)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  test('fetchAllJobPhotos returns the error (never a partial list); fetchJobPhotosByPaths chunks by 200', async () => {
    seedCc({ job_photos: many() })
    mockState.failSelect = { job_photos: 'boom' }
    expect(await paged.fetchAllJobPhotos(supabaseModule.createClient(), 'J1')).toEqual({ data: null, error: { message: 'boom' } })
    mockState.failSelect = {}
    const db = supabaseModule.createClient()
    const spy = jest.spyOn(db, 'from')
    const want = many().slice(0, 450).map(p => p.storage_path)
    const r = await paged.fetchJobPhotosByPaths(db, 'J1', [...want, ...want])
    expect(r.data).toHaveLength(450)
    expect(spy).toHaveBeenCalledTimes(3)
  })

  test('owner route: a job_photos read error is a 500, never an empty gallery', async () => {
    mockState.failSelect = { job_photos: 'db down' }
    const r = await ownerGet()
    expect(r.status).toBe(500)
  })

  test('job Photos tab (commercial), field app and residential Photos read every row', () => {
    for (const f of ['app/jobdetail/page.js', 'app/field/page.js', 'app/residentialjobdetail/page.js']) {
      const src = read(f)
      expect([f, /fetchAllJobPhotos\(supabase, (id|selectedJobId)\)/.test(src)]).toEqual([f, true])
      expect([f, /from\('job_photos'\)\.select\('\*'\)\.eq\('job_id', (id|selectedJobId)\)\.order\('taken_at'/.test(src)]).toEqual([f, false])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('C) /api/photo-visibility bulk', () => {
  const gallery = n => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, job_id: 'J1', storage_path: `J1/g/${i}.jpg`, internal_only: false }))
  const post = body => call(vis.POST, '/api/photo-visibility', 'POST', body)

  test('hides the selected rows on this job with ONE update and ONE change_log entry', async () => {
    seedCc({ job_photos: [...gallery(5), { id: 'x', job_id: 'J2', storage_path: 'J1/g/0.jpg', internal_only: false }] })
    as('pm', 'pm1')
    const r = await post({ job_id: 'J1', paths: ['J1/g/0.jpg', 'J1/g/1.jpg', 'J1/g/2.jpg', 'J1/g/2.jpg', 'J1/g/nope.jpg'], internal_only: true })
    expect(r).toEqual({ status: 200, body: { ok: true, internal_only: true, updated: 3, requested: 4 } })
    expect(mockState.db.job_photos.filter(p => p.internal_only).map(p => p.id).sort()).toEqual(['g0', 'g1', 'g2'])
    expect(mockState.db.job_photos.find(p => p.id === 'x').internal_only).toBe(false) // other job untouched
    const updates = mockState.calls.filter(c => c.table === 'job_photos' && c.op === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].payload).toEqual({ internal_only: true })
    expect(mockState.db.change_log).toHaveLength(1)
    expect(mockState.db.change_log[0]).toMatchObject({ job_id: 'J1', entity_type: 'job', field_name: 'photo_visibility', new_value: 'hidden from owner', changed_by: 'pm1' })
    expect(mockState.db.change_log[0].note).toMatch(/^3 photos hidden from the owner \(bulk, 4 selected\)$/)
    const src = read('app/api/photo-visibility/route.js')
    expect(src).toMatch(/\.eq\('job_id', jobId\)\s*\.in\('storage_path', paths\)/)
  })

  test('show to owner works the same way', async () => {
    seedCc({ job_photos: gallery(3).map(p => ({ ...p, internal_only: true })) })
    as('principal')
    const r = await post({ job_id: 'J1', paths: ['J1/g/0.jpg', 'J1/g/1.jpg', 'J1/g/2.jpg'], internal_only: false })
    expect(r.body).toMatchObject({ ok: true, updated: 3 })
    expect(mockState.db.job_photos.every(p => p.internal_only === false)).toBe(true)
    expect(mockState.db.change_log[0].note).toBe('3 photos shown to the owner (bulk)')
  })

  test('cap 200: 200 is fine, 201 → 400 and nothing changes', async () => {
    seedCc({ job_photos: gallery(201) })
    as('pm', 'pm1')
    const paths = gallery(201).map(p => p.storage_path)
    const over = await post({ job_id: 'J1', paths, internal_only: true })
    expect(over.status).toBe(400)
    expect(over.body.error).toMatch(/200/)
    expect(mockState.db.job_photos.some(p => p.internal_only)).toBe(false)
    expect(mockState.calls).toEqual([])
    const ok = await post({ job_id: 'J1', paths: paths.slice(0, 200), internal_only: true })
    expect(ok.body).toMatchObject({ ok: true, updated: 200 })
    expect(vis.BULK_VISIBILITY_MAX).toBe(200)
    expect(bulk.BULK_VISIBILITY_MAX).toBe(vis.BULK_VISIBILITY_MAX)
  })

  test('bad bodies → 400', async () => {
    as('pm', 'pm1')
    expect((await post({ paths: ['J1/g/0.jpg'], internal_only: true })).status).toBe(400)
    expect((await post({ job_id: 'J1', paths: ['J1/g/0.jpg'], internal_only: 'yes' })).status).toBe(400)
    expect((await post({ job_id: 'J1', paths: [], internal_only: true })).status).toBe(400)
    expect((await post({ job_id: 'J1', paths: ['J1/g/0.jpg', 7], internal_only: true })).status).toBe(400)
  })

  test('same role check as single: owner / apm / unassigned super / PM off the job → 403; assigned super OK', async () => {
    seedCc({ job_photos: gallery(2), pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'super1' }, { id: 'a3', job_id: 'J2', user_id: 'pm2' }] })
    const body = { job_id: 'J1', paths: ['J1/g/0.jpg'], internal_only: true }
    for (const [role, uid] of [['owner', 'owner1'], ['apm', 'apm1'], ['super', 'super9'], ['pm', 'pm2']]) {
      as(role, uid)
      expect([role, uid, (await post(body)).status]).toEqual([role, uid, 403])
    }
    expect(mockState.db.job_photos.some(p => p.internal_only)).toBe(false)
    as('super', 'super1')
    expect((await post(body)).status).toBe(200)
    expect(mockState.db.job_photos.find(p => p.id === 'g0').internal_only).toBe(true)
  })

  test('single-path shape unchanged: same response, no change_log, still 404 off-job', async () => {
    seedCc({ job_photos: gallery(2) })
    as('pm', 'pm1')
    const r = await post({ jobId: 'J1', path: 'J1/g/1.jpg', internal_only: true })
    expect(r).toEqual({ status: 200, body: { ok: true, internal_only: true } })
    expect(mockState.db.job_photos.find(p => p.id === 'g1').internal_only).toBe(true)
    expect(mockState.db.change_log).toEqual([])
    expect((await post({ jobId: 'J1', path: 'J1/g/none.jpg', internal_only: true })).status).toBe(404)
    expect((await post({ jobId: 'J1', internal_only: true })).body).toEqual({ error: 'path and jobId required' })
    expect((await post({ jobId: 'J1', path: 'J1/g/1.jpg', internal_only: 1 })).body).toEqual({ error: 'internal_only must be true or false' })
  })
})

describe('C2) Select mode on the commercial job Photos tab', () => {
  test('helpers: only gallery photos are selectable; day toggle; chunks of 200', () => {
    const day = [{ path: 'a' }, { path: 'b', fromReport: true }, { path: 'c' }, { path: 'a' }]
    expect(bulk.selectablePaths(day)).toEqual(['a', 'c'])
    let s = bulk.toggleDay(new Set(), day)
    expect([...s]).toEqual(['a', 'c'])
    s = bulk.toggleDay(s, day)
    expect([...s]).toEqual([])
    expect([...bulk.toggleInSet(new Set(['a']), 'a')]).toEqual([])
    expect(bulk.chunkPaths(Array.from({ length: 450 }, (_, i) => `p${i}`)).map(c => c.length)).toEqual([200, 200, 50])
    expect(bulk.shortDayLabel('2026-11-09')).toBe('Nov 9')
  })

  test('UI: Select button, Select all from <day>, Show / Hide / Cancel, 44px targets', () => {
    const src = read('app/jobdetail/page.js')
    expect(src).toMatch(/\{fpSelectMode \? 'Done' : 'Select'\}/)
    expect(src).toMatch(/`Select all from \$\{shortDayLabel\(date\)\}`/)
    expect(src).toMatch(/bulkSetFieldPhotoVisibility\(false\)[\s\S]{0,400}Show to owner/)
    expect(src).toMatch(/bulkSetFieldPhotoVisibility\(true\)[\s\S]{0,400}Hide from owner/)
    expect(src).toMatch(/onClick=\{exitFieldPhotoSelect\}[\s\S]{0,400}Cancel/)
    expect(src).toMatch(/JSON\.stringify\(\{ job_id: id, paths: chunk, internal_only: internalOnly \}\)/)
    const bar = src.slice(src.indexOf('{fpSelectMode && (\n                    <div style={{ position: \'sticky\''))
    expect(bar.slice(0, 2500).match(/minHeight: '44px'/g).length).toBeGreaterThanOrEqual(3)
    expect(bar.slice(0, 600)).toMatch(/env\(safe-area-inset-bottom/)
  })
})
