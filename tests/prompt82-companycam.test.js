/**
 * Prompt 82 — CompanyCam photos auto-upload into portal job Photos (+ Addendum A: date range,
 * resumable batched import).
 *   1. Pure: signature check, normalize, project-id parse, URL guard, range / cap helpers.
 *   2. Webhook route: env / signature / JSON / id gates, linked import, duplicates, unmatched,
 *      CompanyCam errors, pre-074, SSRF.
 *   3. importCcPhotoToJob: pre-070/074 internal_only column → no visible row.
 *   4. Link, import, unmatched, register-webhook routes; job-save strip.
 *   5. Source checks: migration 074, numbering.
 * All DB access is the in-memory mock and all CompanyCam calls are a stubbed fetch. Nothing live.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { mockState, resetMockState } = require('./helpers/mock-db')

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
  }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const jreq = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body) => {
  const res = await handler(jreq(url, method, body))
  return { status: res.status, body: await res.json() }
}

const cc = require('../lib/companycam')
const ccImport = require('../lib/companycam-import')
const webhook = require('../app/api/companycam/webhook/route')
const linkRoute = require('../app/api/companycam/link/route')
const importRoute = require('../app/api/companycam/import/route')
const unmatchedRoute = require('../app/api/companycam/unmatched/route')
const registerRoute = require('../app/api/companycam/register-webhook/route')
const jobSave = require('../app/api/job-save/route')

const HOOK_TOKEN = 'test-webhook-token'
const API_TOKEN = 'test-api-token'
const BUCKET = 'daily-report-photos'

// ── CompanyCam stand-in ──────────────────────────────────────────────────────
const json = (data, status = 200, meta) => new Response(JSON.stringify(status < 400 ? { data, errors: null, meta: meta || {} } : { errors: [{ title: 'err' }] }), { status, headers: { 'content-type': 'application/json' } })
const img = name => new Response(Buffer.from(`IMG:${name}`), { status: 200, headers: { 'content-type': 'image/jpeg' } })
const ccPhoto = (id, projectId = '900', extra = {}) => ({
  id: Number(id),
  project_id: Number(projectId),
  creator_name: 'Sam Field',
  captured_at: 1762000000, // 2025-11-01
  uris: [{ type: 'original', uri: `https://img.companycam.com/${id}/o.jpg` }, { type: 'thumbnail', uri: `https://img.companycam.com/${id}/t.jpg` }],
  description: { plain_text_content: ' Footings poured ', html_content: '<p>Footings poured</p>' },
  tags: [{ display_value: 'Concrete', value: 'concrete' }, { display_value: 'Footing', value: 'footing' }],
  ...extra,
})

function ccWorld({ photos = {}, projects = {}, photoStatus = {}, pages = null, webhooks = [], deleteStatus = {}, postStatus = null } = {}) {
  return jest.fn(async (url, opts = {}) => {
    const u = new URL(String(url))
    if (u.hostname !== 'api.companycam.com') return img(u.pathname)
    const p = u.pathname.replace('/public_api/v1', '')
    const method = opts.method || 'GET'
    let m
    if ((m = p.match(/^\/photos\/(\d+)\/tags$/))) return json([])
    if ((m = p.match(/^\/photos\/(\d+)$/))) {
      if (photoStatus[m[1]]) return json(null, photoStatus[m[1]])
      return photos[m[1]] ? json(photos[m[1]]) : json(null, 404)
    }
    if ((m = p.match(/^\/projects\/(\d+)\/photos$/))) return pages(u)
    if ((m = p.match(/^\/projects\/(\d+)$/))) return projects[m[1]] ? json(projects[m[1]]) : json(null, 404)
    if (p === '/webhooks' && method === 'GET') return json(webhooks)
    if (p === '/webhooks' && method === 'POST') return postStatus ? json(null, postStatus) : json({ id: 501, enabled: true, ...JSON.parse(opts.body).webhook }, 201)
    if ((m = p.match(/^\/webhooks\/(\d+)$/)) && method === 'DELETE') return deleteStatus[m[1]] ? json(null, deleteStatus[m[1]]) : new Response(null, { status: 204 })
    if ((m = p.match(/^\/webhooks\/(\d+)$/)) && method === 'PATCH') return json({ id: Number(m[1]), url: webhooks.find(w => String(w.id) === m[1])?.url, ...JSON.parse(opts.body).webhook })
    return new Response('unexpected', { status: 599 })
  })
}

const sign = (raw, token = HOOK_TOKEN) => crypto.createHmac('sha1', token).update(raw).digest('base64')
const hookReq = (raw, sig) => new Request('http://x/api/companycam/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-companycam-signature': sig } : {}) }, body: raw })
const deliver = async body => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const res = await webhook.POST(hookReq(raw, sign(raw)))
  return { status: res.status, body: await res.json() }
}
const created = (id, nested = true) => ({ event_type: 'photo.created', created_at: 1762000000, payload: nested ? { photo: { id: String(id) } } : { id: String(id) }, webhook_id: '42' })

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
  process.env.COMPANYCAM_WEBHOOK_TOKEN = HOOK_TOKEN
  process.env.COMPANYCAM_API_TOKEN = API_TOKEN
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  info = jest.spyOn(console, 'info').mockImplementation(() => {})
  err = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  global.fetch = realFetch
  delete process.env.COMPANYCAM_WEBHOOK_TOKEN
  delete process.env.COMPANYCAM_API_TOKEN
  warn.mockRestore(); info.mockRestore(); err.mockRestore()
})

const fetchedUrls = () => (global.fetch.mock ? global.fetch.mock.calls.map(c => String(c[0])) : [])

// ─────────────────────────────────────────────────────────────────────────────
describe('1) pure helpers', () => {
  const body = Buffer.from('{"event_type":"photo.created","payload":{"id":"1"}}')
  test('verifyCompanyCamSignature: base64 HMAC-SHA1 over the raw bytes only', () => {
    const good = crypto.createHmac('sha1', HOOK_TOKEN).update(body).digest('base64')
    expect(cc.verifyCompanyCamSignature(body, good, HOOK_TOKEN)).toBe(true)
    expect(cc.verifyCompanyCamSignature(body, ` ${good} `, HOOK_TOKEN)).toBe(true)
    expect(cc.verifyCompanyCamSignature(body, good, 'wrong-token')).toBe(false)
    expect(cc.verifyCompanyCamSignature(Buffer.from(body.toString() + ' '), good, HOOK_TOKEN)).toBe(false)
    const hex = crypto.createHmac('sha1', HOOK_TOKEN).update(body).digest('hex')
    expect(cc.verifyCompanyCamSignature(body, hex, HOOK_TOKEN)).toBe(false)
    expect(cc.verifyCompanyCamSignature(body, null, HOOK_TOKEN)).toBe(false)
    expect(cc.verifyCompanyCamSignature(body, '', HOOK_TOKEN)).toBe(false)
    expect(cc.verifyCompanyCamSignature(body, good, '')).toBe(false)
    expect(cc.verifyCompanyCamSignature(body, good, undefined)).toBe(false)
    expect(() => cc.verifyCompanyCamSignature(body, 'x', HOOK_TOKEN)).not.toThrow()
    expect(cc.verifyCompanyCamSignature(body, 'x', HOOK_TOKEN)).toBe(false)
  })

  test('normalizeCcPhoto: epoch seconds vs ISO, description object vs string, tags, URI fallback', () => {
    const a = cc.normalizeCcPhoto(ccPhoto(5))
    expect(a).toMatchObject({ id: '5', projectId: '900', creatorName: 'Sam Field', capturedAt: new Date(1762000000 * 1000).toISOString(), caption: 'Footings poured', tags: ['Concrete', 'Footing'], originalUrl: 'https://img.companycam.com/5/o.jpg', thumbUrl: 'https://img.companycam.com/5/t.jpg' })
    expect(cc.normalizeCcPhoto({ id: 6, captured_at: '1762000000' }).capturedAt).toBe(new Date(1762000000 * 1000).toISOString())
    expect(cc.normalizeCcPhoto({ id: 6, captured_at: '2025-11-01T15:00:00Z' }).capturedAt).toBe('2025-11-01T15:00:00.000Z')
    expect(cc.normalizeCcPhoto({ id: 6, created_at: 1762000000 }).capturedAt).toBe(new Date(1762000000 * 1000).toISOString())
    expect(cc.normalizeCcPhoto({ id: 6, description: '  legacy text ' }).caption).toBe('legacy text')
    expect(cc.normalizeCcPhoto({ id: 6, description: { plain_text_content: '   ' } }).caption).toBe(null)
    expect(cc.normalizeCcPhoto({ id: 6, description: null }).caption).toBe(null)
    expect(cc.normalizeCcPhoto({ id: 6, tags: [{ value: 'raw' }, {}, { display_value: 'x'.repeat(80) }] }).tags).toEqual(['raw', 'x'.repeat(60)])
    expect(cc.normalizeCcPhoto({ id: 6, uris: [{ type: 'thumbnail', uri: 'https://a.companycam.com/t' }, { type: 'web', url: 'https://a.companycam.com/w' }] })).toMatchObject({ originalUrl: 'https://a.companycam.com/w', thumbUrl: 'https://a.companycam.com/t' })
    expect(cc.normalizeCcPhoto({ id: 6, uris: [{ type: 'weird', uri: 'https://a.companycam.com/1' }] }).originalUrl).toBe('https://a.companycam.com/1')
  })

  test('parseCcProjectId: id, URL, junk', () => {
    expect(cc.parseCcProjectId('12345')).toBe('12345')
    expect(cc.parseCcProjectId(' 12345 ')).toBe('12345')
    expect(cc.parseCcProjectId('https://app.companycam.com/projects/12345')).toBe('12345')
    expect(cc.parseCcProjectId('https://app.companycam.com/projects/12345/photos')).toBe('12345')
    for (const bad of ['', null, 'abc', '12a', 'https://evil.com/projects/123', 'https://app.companycam.com/users/1', '1'.repeat(21)]) expect(cc.parseCcProjectId(bad)).toBe(null)
  })

  test('isAllowedCcImageUrl: https CompanyCam hosts only', () => {
    expect(cc.isAllowedCcImageUrl('https://img.companycam.com/a.jpg')).toBe(true)
    expect(cc.isAllowedCcImageUrl('https://companycam.com/a.jpg')).toBe(true)
    for (const bad of ['http://img.companycam.com/a.jpg', 'https://evilcompanycam.com/a', 'https://companycam.com.evil.io/a', 'https://169.254.169.254/latest', 'file:///etc/passwd', 'nonsense']) expect(cc.isAllowedCcImageUrl(bad)).toBe(false)
  })

  test('ccFetch: no token → 503 without calling fetch', async () => {
    delete process.env.COMPANYCAM_API_TOKEN
    global.fetch = jest.fn()
    const r = await cc.ccFetch('/projects/1')
    expect(r).toMatchObject({ ok: false, status: 503, error: 'COMPANYCAM_API_TOKEN is not set' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('Addendum A: range validation, Central bounds, local filter, running / resume, 200 cap', () => {
    const now = new Date('2026-11-16T18:00:00Z')
    expect(ccImport.validateImportRange({ start_date: '2026-11-01', end_date: '2026-11-10' }, now)).toMatchObject({ ok: true, start: '2026-11-01', end: '2026-11-10' })
    expect(ccImport.validateImportRange({}, now)).toMatchObject({ ok: true, startEpoch: null, endEpoch: null })
    for (const bad of [{ start_date: '2026-02-30' }, { start_date: '11/01/2026' }, { end_date: 'x' }, { start_date: '2026-11-17' }, { end_date: '2026-12-01' }, { start_date: '2026-11-10', end_date: '2026-11-01' }]) {
      expect(ccImport.validateImportRange(bad, now).ok).toBe(false)
    }
    // Central midnight: Nov 1 2026 is CDT (UTC-5) → 05:00Z; Nov 10 is CST → day ends 06:00Z next day - 1 s.
    const r = ccImport.validateImportRange({ start_date: '2026-11-01', end_date: '2026-11-10' }, now)
    expect(r.startEpoch).toBe(Date.parse('2026-11-01T05:00:00Z') / 1000)
    expect(r.endEpoch).toBe(Date.parse('2026-11-11T06:00:00Z') / 1000 - 1)
    expect(ccImport.inImportRange('2026-11-01T05:00:00Z', r)).toBe(true)
    expect(ccImport.inImportRange('2026-11-01T04:59:59Z', r)).toBe(false)
    expect(ccImport.inImportRange('2026-11-11T05:59:59Z', r)).toBe(true)
    expect(ccImport.inImportRange('2026-11-11T06:00:00Z', r)).toBe(false)

    const t = Date.parse('2026-11-16T18:00:00Z')
    expect(ccImport.isImportRunning({ status: 'running', updated_at: new Date(t - 30000).toISOString() }, t)).toBe(true)
    expect(ccImport.isImportRunning({ status: 'running', updated_at: new Date(t - 91000).toISOString() }, t)).toBe(false)
    expect(ccImport.canResumeImport({ status: 'running', updated_at: new Date(t - 91000).toISOString() }, t)).toBe(true)
    expect(ccImport.canResumeImport({ status: 'paused' }, t)).toBe(true)
    expect(ccImport.canResumeImport({ status: 'done' }, t)).toBe(false)
    expect(ccImport.canResumeImport(null, t)).toBe(false)

    // prompt 84: the per-click cap is gone (background import); stopped runs resume too.
    expect(ccImport.IMPORT_SESSION_CAP).toBeUndefined()
    expect(ccImport.nextImportStep).toBeUndefined()
    expect(ccImport.canResumeImport({ status: 'stopped' }, t)).toBe(true)
    expect(ccImport.defaultImportSince(now)).toBe('2026-10-17')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2) webhook route', () => {
  test('503 when COMPANYCAM_WEBHOOK_TOKEN is missing; nothing processed', async () => {
    delete process.env.COMPANYCAM_WEBHOOK_TOKEN
    global.fetch = jest.fn()
    const raw = JSON.stringify(created(555))
    const res = await webhook.POST(hookReq(raw, sign(raw)))
    expect(res.status).toBe(503)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.calls).toEqual([])
  })

  test('401 for unsigned / wrong / hex / re-serialized signatures — no fetch, no DB', async () => {
    global.fetch = jest.fn()
    const obj = created(555)
    const raw = JSON.stringify(obj)
    const pretty = JSON.stringify(obj, null, 2)
    const hex = crypto.createHmac('sha1', HOOK_TOKEN).update(raw).digest('hex')
    for (const [body, sig] of [[raw, null], [raw, 'garbage'], [raw, sign(raw, 'other-token')], [raw, hex], [pretty, sign(raw)]]) {
      const res = await webhook.POST(hookReq(body, sig))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Invalid signature' })
    }
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.calls).toEqual([])
  })

  test('413 over 1 MB', async () => {
    const raw = 'x'.repeat(1024 * 1024 + 1)
    const res = await webhook.POST(hookReq(raw, sign(raw)))
    expect(res.status).toBe(413)
  })

  test('400 bad JSON / bad id; 200 ignored for other events; GET 405', async () => {
    global.fetch = jest.fn()
    expect((await deliver('{not json')).status).toBe(400)
    expect((await deliver({ event_type: 'photo.created', payload: { id: 'abc' } })).status).toBe(400)
    expect((await deliver({ event_type: 'photo.created', payload: {} })).status).toBe(400)
    const ign = await deliver({ event_type: 'project.created', payload: { id: '1' } })
    expect(ign).toEqual({ status: 200, body: { ignored: 'project.created' } })
    expect(global.fetch).not.toHaveBeenCalled()
    expect((await webhook.GET()).status).toBe(405)
  })

  test('linked project → one internal job_photos row with CompanyCam fields + storage at the cc path', async () => {
    global.fetch = ccWorld({ photos: { 555: ccPhoto(555) } })
    const r = await deliver(created(555))
    expect(r).toEqual({ status: 200, body: { ok: true, status: 'imported' } })
    expect(mockState.db.job_photos).toHaveLength(1)
    expect(mockState.db.job_photos[0]).toMatchObject({
      job_id: 'J1', super_id: null, storage_path: 'J1/gallery/cc-555.jpg', file_name: 'companycam-555.jpg',
      taken_at: new Date(1762000000 * 1000).toISOString(), companycam_photo_id: '555', companycam_creator_name: 'Sam Field',
      companycam_tags: ['Concrete', 'Footing'], caption: 'Footings poured', internal_only: true,
    })
    expect(Object.keys(mockState.files).sort()).toEqual([`${BUCKET}/J1/gallery/cc-555.jpg`, `${BUCKET}/J1/gallery/cc-555_thumb.jpg`])
    expect(mockState.files[`${BUCKET}/J1/gallery/cc-555.jpg`].toString()).toBe('IMG:/555/o.jpg')
    // The API was re-read with the bearer token; the token never appears in a URL.
    const apiCall = global.fetch.mock.calls.find(c => String(c[0]).includes('/photos/555'))
    expect(apiCall[1].headers.Authorization).toBe(`Bearer ${API_TOKEN}`)
    expect(fetchedUrls().some(u => u.includes(API_TOKEN))).toBe(false)
    // Owner portal list never shows it.
    const { ownerPhotoList } = require('../lib/owner-photos')
    expect(ownerPhotoList({ jobId: 'J1', jobPhotos: mockState.db.job_photos, reports: [] })).toEqual([])
  })

  test('flat payload (payload = photo) works too', async () => {
    global.fetch = ccWorld({ photos: { 556: ccPhoto(556) } })
    expect((await deliver(created(556, false))).body.status).toBe('imported')
    expect(mockState.db.job_photos.map(p => p.companycam_photo_id)).toEqual(['556'])
  })

  test('same delivery twice → 200 duplicate, still one row', async () => {
    global.fetch = ccWorld({ photos: { 555: ccPhoto(555) } })
    await deliver(created(555))
    const again = await deliver(created(555))
    expect(again).toEqual({ status: 200, body: { ok: true, status: 'duplicate' } })
    expect(mockState.db.job_photos).toHaveLength(1)
  })

  test('parallel delivery wins the insert (23505) → 200 duplicate, storage object kept', async () => {
    global.fetch = ccWorld({ photos: { 555: ccPhoto(555) } })
    mockState.beforeWrite = (table, op) => {
      if (table === 'job_photos' && op === 'insert' && !mockState.db.job_photos.length) mockState.db.job_photos.push({ id: 'winner', job_id: 'J1', storage_path: 'J1/gallery/cc-555.jpg', companycam_photo_id: '555', internal_only: true })
    }
    const r = await deliver(created(555))
    expect(r).toEqual({ status: 200, body: { ok: true, status: 'duplicate' } })
    expect(mockState.db.job_photos).toHaveLength(1)
    expect(mockState.calls.some(c => c.op === 'remove')).toBe(false)
    expect(mockState.files[`${BUCKET}/J1/gallery/cc-555.jpg`]).toBeTruthy()
  })

  test('unlinked project → one unmatched inbox row with project name, 200', async () => {
    global.fetch = ccWorld({ photos: { 700: ccPhoto(700, '901') }, projects: { 901: { id: 901, name: 'Conway Clinic' } } })
    const r = await deliver(created(700))
    expect(r).toEqual({ status: 200, body: { ok: true, status: 'unmatched' } })
    expect(mockState.db.companycam_photo_inbox).toHaveLength(1)
    expect(mockState.db.companycam_photo_inbox[0]).toMatchObject({ companycam_photo_id: '700', companycam_project_id: '901', project_name: 'Conway Clinic', status: 'unmatched', creator_name: 'Sam Field', thumbnail_url: 'https://img.companycam.com/700/t.jpg', attempts: 1 })
    expect(mockState.db.job_photos).toEqual([])
    // Redelivery doesn't duplicate the inbox row.
    await deliver(created(700))
    expect(mockState.db.companycam_photo_inbox).toHaveLength(1)
    expect(mockState.db.companycam_photo_inbox[0].attempts).toBe(2)
  })

  test('CompanyCam 500 → 503 + inbox failed attempts 1; 404 → 200 + inbox failed', async () => {
    global.fetch = ccWorld({ photoStatus: { 801: 500, 802: 404 } })
    const a = await deliver(created(801))
    expect(a.status).toBe(503)
    expect(mockState.db.companycam_photo_inbox.find(r => r.companycam_photo_id === '801')).toMatchObject({ status: 'failed', attempts: 1 })
    const b = await deliver(created(802))
    expect(b.status).toBe(200)
    expect(mockState.db.companycam_photo_inbox.find(r => r.companycam_photo_id === '802')).toMatchObject({ status: 'failed', last_error: 'deleted in CompanyCam' })
  })

  test('missing API token → 503 (retry), inbox failed', async () => {
    delete process.env.COMPANYCAM_API_TOKEN
    global.fetch = jest.fn()
    const r = await deliver(created(555))
    expect(r.status).toBe(503)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.db.companycam_photo_inbox[0]).toMatchObject({ status: 'failed', last_error: 'COMPANYCAM_API_TOKEN is not set' })
  })

  test('M2: inbox insert fails (not 23505) → 503 so CompanyCam retries; nothing claimed as handled', async () => {
    global.fetch = ccWorld({ photos: { 700: ccPhoto(700, '901'), 801: ccPhoto(801) }, projects: { 901: { id: 901, name: 'Conway Clinic' } }, photoStatus: { 802: 500, 803: 404 } })
    mockState.failWrite.companycam_photo_inbox = { insert: { message: 'connection reset', code: '08006' } }
    expect(await deliver(created(700))).toEqual({ status: 503, body: { ok: false, status: 'failed' } }) // unmatched
    expect((await deliver(created(802))).status).toBe(503) // API error path
    expect((await deliver(created(803))).status).toBe(503) // deleted-in-CompanyCam path
    expect(mockState.db.companycam_photo_inbox).toEqual([])
  })

  test('M2: inbox update after a 23505 fails → 503; the 23505 duplicate itself and pre-074 stay 200', async () => {
    global.fetch = ccWorld({ photos: { 700: ccPhoto(700, '901') } })
    mockState.db.companycam_photo_inbox.push({ id: 'ib7', companycam_photo_id: '700', status: 'unmatched', attempts: 1 })
    expect((await deliver(created(700))).status).toBe(200) // 23505 → update path
    mockState.failWrite.companycam_photo_inbox = { update: 'deadlock detected' }
    expect((await deliver(created(700))).status).toBe(503)
    mockState.failWrite.companycam_photo_inbox = { insert: 'relation "public.companycam_photo_inbox" does not exist' }
    mockState.db.companycam_photo_inbox = []
    expect(await deliver(created(700))).toEqual({ status: 200, body: { ok: true, status: 'unmatched' } }) // pre-074 skip
  })

  test('M2: import failure whose inbox write also fails → 503 (even a non-retryable failure)', async () => {
    global.fetch = ccWorld({ photos: { 555: ccPhoto(555, '900', { uris: [{ type: 'original', uri: 'https://169.254.169.254/x' }] }) } })
    mockState.failWrite.companycam_photo_inbox = { insert: 'boom' }
    expect((await deliver(created(555))).status).toBe(503)
  })

  test('pre-074 (jobs.companycam_project_id missing) → 200 skipped, no writes', async () => {
    mockState.missingSelectCols.jobs = ['companycam_project_id']
    global.fetch = ccWorld({ photos: { 555: ccPhoto(555) } })
    const r = await deliver(created(555))
    expect(r).toEqual({ status: 200, body: { ok: true, status: 'skipped' } })
    expect(mockState.calls).toEqual([])
  })

  test('pre-074 (job_photos.companycam_photo_id missing) → 200 skipped, no CompanyCam call', async () => {
    mockState.missingSelectCols.job_photos = ['companycam_photo_id']
    global.fetch = jest.fn()
    const r = await deliver(created(555))
    expect(r.body.status).toBe('skipped')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.calls).toEqual([])
  })

  test('non-CompanyCam image host → failed, never downloaded, 200 (retry cannot help)', async () => {
    global.fetch = ccWorld({ photos: { 555: ccPhoto(555, '900', { uris: [{ type: 'original', uri: 'https://169.254.169.254/latest/meta-data' }] }) } })
    const r = await deliver(created(555))
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('failed')
    expect(fetchedUrls().some(u => u.includes('169.254'))).toBe(false)
    expect(mockState.db.job_photos).toEqual([])
    expect(mockState.db.companycam_photo_inbox[0]).toMatchObject({ status: 'failed' })
    expect(mockState.db.companycam_photo_inbox[0].last_error).toMatch(/not a CompanyCam https URL/)
  })

  test('download that is not an image → failed, nothing stored', async () => {
    global.fetch = jest.fn(async url => (String(url).includes('api.companycam.com') ? json(ccPhoto(555)) : new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })))
    const r = await deliver(created(555))
    expect(r.body.status).toBe('failed')
    expect(mockState.files).toEqual({})
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3) importCcPhotoToJob — never an owner-visible row', () => {
  test('missing internal_only column → no row, objects removed, migration message', async () => {
    global.fetch = ccWorld()
    mockState.missingCols.job_photos = ['internal_only']
    const r = await cc.importCcPhotoToJob(require('@supabase/supabase-js').createClient(), { job: { id: 'J1' }, photo: cc.normalizeCcPhoto(ccPhoto(555)) })
    expect(r).toMatchObject({ status: 'failed', retryable: false, migrationRequired: '074', error: cc.MIGRATION_074_MESSAGE })
    expect(mockState.db.job_photos).toEqual([])
    expect(mockState.calls.find(c => c.op === 'remove').payload.sort()).toEqual(['J1/gallery/cc-555.jpg', 'J1/gallery/cc-555_thumb.jpg'])
    expect(mockState.files).toEqual({})
  })

  test('missing companycam_tags column on insert → failed 074, objects removed', async () => {
    global.fetch = ccWorld()
    mockState.missingCols.job_photos = ['companycam_tags']
    const r = await cc.importCcPhotoToJob(require('@supabase/supabase-js').createClient(), { job: { id: 'J1' }, photo: cc.normalizeCcPhoto(ccPhoto(555)) })
    expect(r).toMatchObject({ status: 'failed', migrationRequired: '074', retryable: false })
    expect(mockState.db.job_photos).toEqual([])
    expect(mockState.files).toEqual({})
  })

  test('no thumbnail URI → only the original stored', async () => {
    global.fetch = ccWorld()
    const r = await cc.importCcPhotoToJob(require('@supabase/supabase-js').createClient(), { job: { id: 'J1' }, photo: cc.normalizeCcPhoto(ccPhoto(9, '900', { uris: [{ type: 'original', uri: 'https://img.companycam.com/9/o.jpg' }] })) })
    expect(r.status).toBe('imported')
    expect(Object.keys(mockState.files)).toEqual([`${BUCKET}/J1/gallery/cc-9.jpg`])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3b) downloadImage: manual redirects, allowlist per hop, 15 s timeouts', () => {
  const redirect = loc => new Response(null, { status: 302, headers: { location: loc } })
  const routes = map => jest.fn(async url => (map[String(url)] ? map[String(url)]() : new Response('nope', { status: 404 })))

  test('follows up to 3 on-CompanyCam hops itself (redirect:manual, one 15 s AbortSignal)', async () => {
    global.fetch = routes({
      'https://img.companycam.com/a': () => redirect('https://cdn.companycam.com/b'),
      'https://cdn.companycam.com/b': () => redirect('/c'),
      'https://cdn.companycam.com/c': () => redirect('https://companycam.com/d'),
      'https://companycam.com/d': () => img('d'),
    })
    const buf = await cc.downloadImage('https://img.companycam.com/a')
    expect(buf.toString()).toBe('IMG:d')
    expect(fetchedUrls()).toEqual(['https://img.companycam.com/a', 'https://cdn.companycam.com/b', 'https://cdn.companycam.com/c', 'https://companycam.com/d'])
    for (const c of global.fetch.mock.calls) {
      expect(c[1].redirect).toBe('manual')
      expect(c[1].signal).toBeInstanceOf(AbortSignal)
    }
  })

  test('a 4th hop is refused (not requested)', async () => {
    global.fetch = routes({
      'https://img.companycam.com/1': () => redirect('https://img.companycam.com/2'),
      'https://img.companycam.com/2': () => redirect('https://img.companycam.com/3'),
      'https://img.companycam.com/3': () => redirect('https://img.companycam.com/4'),
      'https://img.companycam.com/4': () => redirect('https://img.companycam.com/5'),
      'https://img.companycam.com/5': () => img('5'),
    })
    await expect(cc.downloadImage('https://img.companycam.com/1')).rejects.toMatchObject({ message: 'Image URL redirected too many times', retryable: false })
    expect(fetchedUrls()).not.toContain('https://img.companycam.com/5')
  })

  test('an off-host, http, or userinfo hop is never requested', async () => {
    for (const bad of ['https://169.254.169.254/latest/meta-data', 'http://img.companycam.com/x', 'https://evil.com/x.jpg', 'https://user:pw@img.companycam.com/x']) {
      global.fetch = routes({ 'https://img.companycam.com/a': () => redirect('https://img.companycam.com/b'), 'https://img.companycam.com/b': () => redirect(bad) })
      await expect(cc.downloadImage('https://img.companycam.com/a')).rejects.toMatchObject({ message: 'Image URL redirected off CompanyCam', retryable: false })
      expect(fetchedUrls()).toEqual(['https://img.companycam.com/a', 'https://img.companycam.com/b'])
    }
  })

  test('redirect without Location → failed, not retryable', async () => {
    global.fetch = jest.fn(async () => new Response(null, { status: 302 }))
    await expect(cc.downloadImage('https://img.companycam.com/a')).rejects.toMatchObject({ retryable: false })
  })

  test('timeout during download → retryable "timed out"; ccFetch carries an AbortSignal too', async () => {
    global.fetch = jest.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) })
    await expect(cc.downloadImage('https://img.companycam.com/a')).rejects.toMatchObject({ message: 'Image download timed out', retryable: true })
    global.fetch = jest.fn(async () => json({ id: 1 }))
    await cc.ccFetch('/projects/1')
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    const lib = read('lib/companycam.js')
    expect(lib).toMatch(/AbortSignal\.timeout\(15000\)/)
    expect(lib).toMatch(/AbortSignal\.timeout\(DOWNLOAD_TIMEOUT_MS\)/)
    expect(lib).not.toMatch(/25000/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4a) link route', () => {
  const link = (job_id, companycam_project_id) => call(linkRoute.POST, '/api/companycam/link', 'POST', { job_id, companycam_project_id })

  test('principal links any job (URL input) with one change_log row; unlink logs too', async () => {
    as('principal')
    global.fetch = ccWorld({ projects: { 901: { id: 901, name: 'Conway Clinic', address: { city: 'Conway' } } } })
    mockState.db.companycam_photo_inbox.push({ id: 'ib1', companycam_photo_id: '1', companycam_project_id: '901', status: 'unmatched' })
    const r = await link('J2', 'https://app.companycam.com/projects/901')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, companycam_project_id: '901', project: { id: '901', name: 'Conway Clinic' }, unmatched_waiting: 1 })
    expect(mockState.db.jobs.find(j => j.id === 'J2').companycam_project_id).toBe('901')
    expect(mockState.db.change_log).toHaveLength(1)
    expect(mockState.db.change_log[0]).toMatchObject({ job_id: 'J2', entity_type: 'job', entity_id: 'J2', field_name: 'companycam_project_id', old_value: null, new_value: '901 (Conway Clinic)', changed_by: 'principal1', changed_by_name: 'Pat Owner', note: 'CompanyCam project linked' })
    // same again → no-op, no log
    expect((await link('J2', '901')).status).toBe(200)
    expect(mockState.db.change_log).toHaveLength(1)
    const u = await link('J2', '')
    expect(u.body).toMatchObject({ ok: true, companycam_project_id: null })
    expect(mockState.db.jobs.find(j => j.id === 'J2').companycam_project_id).toBe(null)
    expect(mockState.db.change_log[1]).toMatchObject({ field_name: 'companycam_project_id', old_value: '901', new_value: null, note: 'CompanyCam project unlinked' })
  })

  test('relinking resets the saved import state', async () => {
    as('principal')
    global.fetch = ccWorld({ projects: { 902: { id: 902, name: 'Other' } } })
    mockState.db.jobs[0].companycam_import_state = { status: 'paused', cursor: 'c9', imported: 40 }
    expect((await link('J1', '902')).status).toBe(200)
    expect(mockState.db.jobs[0]).toMatchObject({ companycam_project_id: '902', companycam_import_state: null })
  })

  test('M1: 409 while an import is running (< 90 s) for link, relink and unlink; allowed once stale', async () => {
    as('principal')
    global.fetch = ccWorld({ projects: { 902: { id: 902, name: 'Other' } } })
    const running = { status: 'running', cursor: 'c2', updated_at: new Date(Date.now() - 20000).toISOString() }
    mockState.db.jobs[0].companycam_import_state = { ...running }
    const relink = await link('J1', '902')
    expect(relink.status).toBe(409)
    expect(relink.body.error).toMatch(/import is running/)
    expect((await link('J1', '')).status).toBe(409)
    expect(mockState.db.jobs[0]).toMatchObject({ companycam_project_id: '900', companycam_import_state: running })
    expect(mockState.db.change_log).toEqual([])
    // paused is not running
    mockState.db.jobs[0].companycam_import_state = { ...running, status: 'paused' }
    expect((await link('J1', '902')).status).toBe(200)
    // stale running (> 90 s) is not running either
    mockState.db.jobs[0].companycam_import_state = { ...running, updated_at: new Date(Date.now() - 120000).toISOString() }
    expect((await link('J1', '')).status).toBe(200)
    expect(mockState.db.jobs[0]).toMatchObject({ companycam_project_id: null, companycam_import_state: null })
  })

  test('assigned pm ok; unassigned pm, apm, admin, super, client owner, sub → 403', async () => {
    global.fetch = ccWorld({ projects: { 903: { id: 903, name: 'X' } } })
    as('pm')
    expect((await link('J1', '903')).status).toBe(200)
    expect((await link('J2', '903')).status).toBe(403)
    for (const role of ['apm', 'admin', 'super', 'owner', 'subcontractor']) {
      as(role)
      expect((await link('J1', null)).status).toBe(403)
    }
  })

  test('409 when another job has the project; 400 for CompanyCam 404 / junk', async () => {
    as('principal')
    global.fetch = ccWorld({ projects: { 900: { id: 900, name: 'Russellville' } } })
    const dup = await link('J2', '900')
    expect(dup.status).toBe(409)
    expect(dup.body.error).toMatch(/Russellville #2401/)
    expect((await link('J2', '12345')).status).toBe(400)
    expect((await link('J2', 'nope')).status).toBe(400)
    expect(mockState.db.change_log).toEqual([])
  })

  test('503 migration 074 when the jobs row has no companycam_project_id; nothing written', async () => {
    as('principal')
    global.fetch = jest.fn()
    mockState.db.jobs = [{ id: 'J9', project_name: 'Old' }]
    const r = await link('J9', '900')
    expect(r.status).toBe(503)
    expect(r.body.migration_required).toBe('074')
    expect(mockState.calls).toEqual([])
  })

  test('job-save strips companycam_project_id and companycam_import_state', async () => {
    as('principal')
    const r = await call(jobSave.POST, '/api/job-save', 'POST', { id: 'J2', fields: { project_name: 'Conway 2', companycam_project_id: '999', companycam_import_state: { status: 'done' } } })
    expect(r.status).toBe(200)
    const upd = mockState.calls.find(c => c.table === 'jobs' && c.op === 'update')
    expect(upd.payload).toEqual({ project_name: 'Conway 2' })
    expect(mockState.db.jobs[1]).toMatchObject({ companycam_project_id: null, companycam_import_state: null })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4b) import route (Addendum A: range + resumable batches)', () => {
  const imp = body => call(importRoute.POST, '/api/companycam/import', 'POST', { job_id: 'J1', ...body })
  const IN = 1762000000 // 2025-11-01
  const OUT = 1700000000 // 2023-11-14
  const page1 = [ccPhoto(1, '900'), ccPhoto(2, '900'), ccPhoto(3, '900', { captured_at: OUT })]
  const page2 = [ccPhoto(4, '900'), ccPhoto(5, '900', { captured_at: IN + 60 })]
  const twoPages = () => jest.fn(u => (u.searchParams.get('after') === 'c2' ? json(page2, 200, { has_next: false, next_cursor: null }) : json(page1, 200, { has_next: true, next_cursor: 'c2' })))

  test('dates are NOT sent to CompanyCam (prompt 84: 422), local filter drops out-of-range, cursor resumes to done', async () => {
    as('principal')
    const pages = twoPages()
    global.fetch = ccWorld({ pages })
    mockState.db.job_photos.push({ id: 'old', job_id: 'J1', storage_path: 'J1/gallery/cc-2.jpg', companycam_photo_id: '2' })
    const a = await imp({ start_date: '2025-01-01', end_date: '2025-12-31' })
    expect(a.status).toBe(200)
    expect(a.body).toMatchObject({ imported: 1, skipped: 1, out_of_range: 1, failed: [], next_cursor: 'c2', done: false })
    const q1 = pages.mock.calls[0][0].searchParams
    expect(q1.get('limit')).toBe('20')
    expect(q1.get('start_date')).toBe(null)
    expect(q1.get('end_date')).toBe(null)
    expect(q1.get('after')).toBe(null)
    expect(mockState.db.jobs[0].companycam_import_state).toMatchObject({ start_date: '2025-01-01', end_date: '2025-12-31', cursor: 'c2', imported: 1, skipped: 1, failed: 0, status: 'paused', updated_by: 'principal1' })

    const b = await imp({ resume: true })
    expect(b.body).toMatchObject({ imported: 2, skipped: 0, next_cursor: null, done: true })
    expect(pages.mock.calls[1][0].searchParams.get('after')).toBe('c2')
    expect(pages.mock.calls[1][0].searchParams.get('start_date')).toBe(null)
    expect(mockState.db.jobs[0].companycam_import_state).toMatchObject({ status: 'done', imported: 3, cursor: null })
    expect(mockState.db.job_photos.map(p => p.companycam_photo_id).sort()).toEqual(['1', '2', '4', '5'])
    for (const p of mockState.db.job_photos.filter(p => p.id !== 'old')) expect(p.internal_only).toBe(true)
    expect(mockState.db.change_log).toEqual([])
  })

  test('a new range resets saved state (cursor dropped, counts zeroed)', async () => {
    as('principal')
    const pages = twoPages()
    global.fetch = ccWorld({ pages })
    mockState.db.jobs[0].companycam_import_state = { start_date: '2024-01-01', end_date: null, cursor: 'c2', imported: 99, skipped: 5, failed: 1, status: 'paused', updated_at: new Date(Date.now() - 5000).toISOString() }
    const r = await imp({ start_date: '2025-06-01' })
    expect(r.status).toBe(200)
    expect(pages.mock.calls[0][0].searchParams.get('after')).toBe(null)
    expect(pages.mock.calls[0][0].searchParams.get('end_date')).toBe(null)
    expect(mockState.db.jobs[0].companycam_import_state).toMatchObject({ start_date: '2025-06-01', end_date: null, imported: 2, skipped: 0, failed: 0, cursor: 'c2' })
  })

  test('bad dates → 400, nothing called', async () => {
    as('principal')
    global.fetch = jest.fn()
    for (const body of [{ start_date: '2025-02-30' }, { start_date: '2025-12-01', end_date: '2025-01-01' }, { end_date: '2999-01-01' }, { start_date: 'yesterday' }]) {
      expect((await imp(body)).status).toBe(400)
    }
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.calls).toEqual([])
  })

  test('409 while another run is fresh; a stale running state (>90 s) resumes', async () => {
    as('principal')
    const pages = twoPages()
    global.fetch = ccWorld({ pages })
    mockState.db.jobs[0].companycam_import_state = { start_date: '2025-01-01', end_date: null, cursor: 'c2', imported: 3, skipped: 0, failed: 0, status: 'running', updated_at: new Date(Date.now() - 10000).toISOString() }
    expect((await imp({ resume: true })).status).toBe(409)
    expect((await imp({ start_date: '2025-01-01' })).status).toBe(409)
    expect(pages).not.toHaveBeenCalled()
    mockState.db.jobs[0].companycam_import_state.updated_at = new Date(Date.now() - 120000).toISOString()
    const r = await imp({ resume: true })
    expect(r.status).toBe(200)
    expect(pages.mock.calls[0][0].searchParams.get('after')).toBe('c2')
    expect(r.body.done).toBe(true)
    expect(mockState.db.jobs[0].companycam_import_state).toMatchObject({ status: 'done', imported: 5 })
  })

  test('claim lost to a concurrent request (state changed after read) → 409', async () => {
    as('principal')
    global.fetch = ccWorld({ pages: twoPages() })
    mockState.beforeWrite = (table, op) => {
      if (table === 'jobs' && op === 'update' && !mockState.raced) { mockState.raced = true; mockState.db.jobs[0].companycam_import_state = { status: 'running', updated_at: new Date().toISOString() } }
    }
    const r = await imp({ start_date: '2025-01-01' })
    expect(r.status).toBe(409)
    delete mockState.raced
  })

  test('M1: relink mid-batch → final save dropped (CAS on project id), 409 project changed', async () => {
    as('principal')
    const pages = jest.fn(() => {
      // The Owner relinks J1 to project 902 while this batch is reading project 900.
      Object.assign(mockState.db.jobs[0], { companycam_project_id: '902', companycam_import_state: null })
      return json(page1.slice(0, 2), 200, { has_next: true, next_cursor: 'c2' })
    })
    global.fetch = ccWorld({ pages })
    const r = await imp({ start_date: '2025-01-01' })
    expect(r).toEqual({ status: 409, body: expect.objectContaining({ error: 'project changed' }) })
    // Project 900's cursor / range never lands on the job now linked to 902.
    expect(mockState.db.jobs[0]).toMatchObject({ companycam_project_id: '902', companycam_import_state: null })
    const saves = mockState.calls.filter(c => c.table === 'jobs' && c.op === 'update')
    expect(saves).toHaveLength(2) // claim (hit) + final save (matched nothing)
    expect(saves[1].ids).toEqual([])
  })

  test('M1: unlink mid-batch, then a CompanyCam error → paused save dropped, 409 project changed', async () => {
    as('principal')
    global.fetch = ccWorld({ pages: jest.fn(() => { Object.assign(mockState.db.jobs[0], { companycam_project_id: null, companycam_import_state: null }); return json(null, 500) }) })
    const r = await imp({ start_date: '2025-01-01' })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('project changed')
    expect(mockState.db.jobs[0]).toMatchObject({ companycam_project_id: null, companycam_import_state: null })
  })

  test('M1: claim is conditional on the link too (relinked between read and claim → no claim)', async () => {
    as('principal')
    global.fetch = ccWorld({ pages: twoPages() })
    mockState.beforeWrite = (table, op) => { if (table === 'jobs' && op === 'update' && !mockState.raced) { mockState.raced = true; mockState.db.jobs[0].companycam_project_id = '902' } }
    const r = await imp({ start_date: '2025-01-01' })
    expect(r.status).toBe(409)
    expect(mockState.db.jobs[0].companycam_import_state).toBe(null)
    expect(global.fetch).not.toHaveBeenCalled()
    delete mockState.raced
  })

  test('M3: a photo that fails in the import → inbox row failed with error + project, listed and retryable by the Owner', async () => {
    as('principal')
    const base = global.fetch
    const world = ccWorld({ photos: { 1: ccPhoto(1, '900') }, pages: jest.fn(() => json([ccPhoto(1, '900'), ccPhoto(2, '900')], 200, { has_next: false })) })
    let imageDown = true
    global.fetch = jest.fn(async (url, opts) => (imageDown && String(url).includes('img.companycam.com/1/') ? new Response('err', { status: 502 }) : world(url, opts)))
    const r = await imp({ start_date: '2025-01-01' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ imported: 1, done: true })
    expect(r.body.failed).toEqual([{ id: '1', error: 'Image download returned 502', inbox: true }])
    expect(mockState.db.jobs[0].companycam_import_state).toMatchObject({ status: 'done', failed: 1, imported: 1 })
    const row = mockState.db.companycam_photo_inbox.find(x => x.companycam_photo_id === '1')
    expect(row).toMatchObject({ status: 'failed', last_error: 'Image download returned 502', companycam_project_id: '900', creator_name: 'Sam Field', attempts: 1 })
    // Shows on the Owner's Unmatched / failed list …
    const list = await call(unmatchedRoute.GET, '/api/companycam/unmatched', 'GET')
    expect(list.body.rows.map(x => x.companycam_photo_id)).toEqual(['1'])
    // … and Assign retries it.
    imageDown = false
    const retry = await call(unmatchedRoute.POST, '/api/companycam/unmatched', 'POST', { inbox_id: row.id, action: 'assign', job_id: 'J1' })
    expect(retry.status).toBe(200)
    expect(retry.body.status).toBe('imported')
    expect(mockState.db.companycam_photo_inbox.find(x => x.id === row.id)).toMatchObject({ status: 'imported', job_id: 'J1' })
    expect(mockState.db.job_photos.map(p => p.companycam_photo_id).sort()).toEqual(['1', '2'])
    global.fetch = base
  })

  test('(b) import time box: 35 s budget, no new photo starts after it, thumbnail skipped past the deadline', async () => {
    expect(cc.DOWNLOAD_BUDGET_MS).toBe(35000)
    expect(cc.DOWNLOAD_TIMEOUT_MS).toBe(15000)
    // prompt 84: the batch moved to lib/companycam-import-batch.js (shared with the cron).
    expect(read('app/api/companycam/import/route.js')).toMatch(/const TIME_BUDGET_MS = DOWNLOAD_BUDGET_MS/)
    const src = read('lib/companycam-import-batch.js')
    expect(src).toMatch(/const deadline = startedAt \+ budgetMs/)
    expect(src).toMatch(/downloadDeadline: deadline/)
    global.fetch = ccWorld()
    const r = await cc.importCcPhotoToJob(require('@supabase/supabase-js').createClient(), { job: { id: 'J1' }, photo: cc.normalizeCcPhoto(ccPhoto(555)), downloadDeadline: Date.now() - 1 })
    expect(r.status).toBe('imported')
    expect(Object.keys(mockState.files)).toEqual([`${BUCKET}/J1/gallery/cc-555.jpg`])
    expect(fetchedUrls().filter(u => u.includes('img.companycam.com'))).toEqual(['https://img.companycam.com/555/o.jpg'])
  })

  test('resume with nothing saved → 400; unlinked job → 400; unassigned pm → 403; pre-074 → 409', async () => {
    as('principal')
    global.fetch = jest.fn()
    expect((await imp({ resume: true })).status).toBe(400)
    const unl = await call(importRoute.POST, '/api/companycam/import', 'POST', { job_id: 'J2' })
    expect(unl).toMatchObject({ status: 400, body: { error: 'Link a CompanyCam project first' } })
    as('pm')
    expect((await call(importRoute.POST, '/api/companycam/import', 'POST', { job_id: 'J2' })).status).toBe(403)
    as('principal')
    mockState.db.jobs[0] = { id: 'J1', project_name: 'Old', companycam_project_id: '900' } // 074 half-missing
    const pre = await imp({})
    expect(pre).toMatchObject({ status: 409, body: { error: 'Apply migration 074 first', migration_required: '074' } })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4c) unmatched route', () => {
  const seedInbox = () => mockState.db.companycam_photo_inbox.push(
    { id: 'ib1', companycam_photo_id: '701', companycam_project_id: '901', project_name: 'Conway Clinic', status: 'unmatched', created_at: '2026-11-16T10:00:00Z' },
    { id: 'ib2', companycam_photo_id: '702', companycam_project_id: '901', status: 'failed', created_at: '2026-11-16T11:00:00Z' },
    { id: 'ib3', companycam_photo_id: '703', companycam_project_id: '901', status: 'imported', created_at: '2026-11-16T12:00:00Z' },
    { id: 'ib4', companycam_photo_id: '704', companycam_project_id: '905', status: 'dismissed', created_at: '2026-11-16T12:00:00Z' },
  )

  test('principal only (pm / admin / others 403)', async () => {
    for (const role of ['pm', 'admin', 'apm', 'super', 'owner']) {
      as(role)
      expect((await call(unmatchedRoute.GET, '/api/companycam/unmatched', 'GET')).status).toBe(403)
      expect((await call(unmatchedRoute.POST, '/api/companycam/unmatched', 'POST', { inbox_id: 'ib1', action: 'dismiss' })).status).toBe(403)
    }
  })

  test('GET lists unmatched + failed only', async () => {
    as('principal'); seedInbox()
    const r = await call(unmatchedRoute.GET, '/api/companycam/unmatched', 'GET')
    expect(r.status).toBe(200)
    expect(r.body.rows.map(x => x.id).sort()).toEqual(['ib1', 'ib2'])
  })

  test('GET before 074 → empty + migration_required', async () => {
    as('principal')
    mockState.failSelect.companycam_photo_inbox = 'relation "public.companycam_photo_inbox" does not exist'
    const r = await call(unmatchedRoute.GET, '/api/companycam/unmatched', 'GET')
    expect(r).toEqual({ status: 200, body: { rows: [], migration_required: '074' } })
  })

  test('assign + link_project: imports, marks imported (resolved_by), links with change_log, sweeps the project', async () => {
    as('principal'); seedInbox()
    global.fetch = ccWorld({ photos: { 701: ccPhoto(701, '901'), 702: ccPhoto(702, '901') }, projects: { 901: { id: 901, name: 'Conway Clinic' } } })
    const r = await call(unmatchedRoute.POST, '/api/companycam/unmatched', 'POST', { inbox_id: 'ib1', action: 'assign', job_id: 'J2', link_project: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, status: 'imported', linked: true, also_imported: 1, remaining_for_project: 0 })
    expect(mockState.db.jobs.find(j => j.id === 'J2').companycam_project_id).toBe('901')
    expect(mockState.db.change_log).toHaveLength(1)
    expect(mockState.db.change_log[0]).toMatchObject({ job_id: 'J2', field_name: 'companycam_project_id', new_value: '901 (Conway Clinic)', changed_by: 'principal1' })
    expect(mockState.db.job_photos.map(p => [p.job_id, p.companycam_photo_id, p.internal_only]).sort()).toEqual([['J2', '701', true], ['J2', '702', true]])
    const ib1 = mockState.db.companycam_photo_inbox.find(x => x.id === 'ib1')
    expect(ib1).toMatchObject({ status: 'imported', job_id: 'J2', resolved_by: 'principal1' })
    expect(ib1.job_photo_id).toBe(mockState.db.job_photos.find(p => p.companycam_photo_id === '701').id)
  })

  test('assign to a job linked to a different project: imports, does not relink', async () => {
    as('principal'); seedInbox()
    global.fetch = ccWorld({ photos: { 701: ccPhoto(701, '901') } })
    const r = await call(unmatchedRoute.POST, '/api/companycam/unmatched', 'POST', { inbox_id: 'ib1', action: 'assign', job_id: 'J1', link_project: true })
    expect(r.body).toMatchObject({ ok: true, linked: false })
    expect(mockState.db.jobs[0].companycam_project_id).toBe('900')
    expect(mockState.db.change_log).toEqual([])
    expect(mockState.db.job_photos[0]).toMatchObject({ job_id: 'J1', companycam_photo_id: '701' })
  })

  test('dismiss sets dismissed + resolved_by; resolved rows refuse further actions', async () => {
    as('principal'); seedInbox()
    const r = await call(unmatchedRoute.POST, '/api/companycam/unmatched', 'POST', { inbox_id: 'ib1', action: 'dismiss' })
    expect(r).toEqual({ status: 200, body: { ok: true, status: 'dismissed' } })
    expect(mockState.db.companycam_photo_inbox[0]).toMatchObject({ status: 'dismissed', resolved_by: 'principal1' })
    expect((await call(unmatchedRoute.POST, '/api/companycam/unmatched', 'POST', { inbox_id: 'ib3', action: 'dismiss' })).status).toBe(409)
  })

  test('recordInbox never moves an imported / dismissed row back', async () => {
    seedInbox()
    const db = require('@supabase/supabase-js').createClient()
    expect(await cc.recordInbox(db, { id: '703' }, { status: 'failed', error: 'x' })).toEqual({ ok: true, unchanged: 'imported' })
    expect(await cc.recordInbox(db, { id: '704' }, { status: 'unmatched' })).toEqual({ ok: true, unchanged: 'dismissed' })
    expect(mockState.db.companycam_photo_inbox.find(r => r.id === 'ib3').status).toBe('imported')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4d) register-webhook route', () => {
  const reg = () => call(registerRoute.POST, '/api/companycam/register-webhook', 'POST', {})
  const URL_ = 'https://portal.nv.construction/api/companycam/webhook'

  test('non-principal 403', async () => {
    for (const role of ['pm', 'admin', 'apm', 'owner']) { as(role); expect((await reg()).status).toBe(403) }
  })

  test('missing env → 503 naming the variables, never their values', async () => {
    as('principal')
    delete process.env.COMPANYCAM_WEBHOOK_TOKEN
    global.fetch = jest.fn()
    const r = await reg()
    expect(r.status).toBe(503)
    expect(r.body.error).toContain('COMPANYCAM_WEBHOOK_TOKEN')
    expect(r.body.error).not.toContain('COMPANYCAM_API_TOKEN')
    expect(JSON.stringify(r.body)).not.toContain(API_TOKEN)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('none registered → POST with our URL, token and photo.* (prompt 83); response has no token', async () => {
    as('principal')
    global.fetch = ccWorld({ webhooks: [{ id: 3, url: 'https://elsewhere.example/hook', scopes: ['photo.created'] }] })
    const r = await reg()
    expect(r.status).toBe(200)
    const post = global.fetch.mock.calls.find(c => c[1]?.method === 'POST')
    expect(JSON.parse(post[1].body)).toEqual({ webhook: { url: URL_, scopes: ['photo.*'], token: HOOK_TOKEN } }) // prompt 83: photo.*
    expect(r.body).toMatchObject({ ok: true, action: 'created', webhook_id: '501', url: URL_, scopes: ['photo.*'], enabled: true, deleted: [] })
    expect(global.fetch.mock.calls.some(c => c[1]?.method === 'DELETE' || c[1]?.method === 'PATCH')).toBe(false)
    expect(r.body).not.toHaveProperty('token')
    expect(JSON.stringify(r.body)).not.toContain(HOOK_TOKEN)
    expect(JSON.stringify(info.mock.calls)).not.toContain(HOOK_TOKEN)
  })

  const methods = () => global.fetch.mock.calls.map(c => `${c[1]?.method || 'GET'} ${String(c[0]).replace('https://api.companycam.com/public_api/v1', '')}`)

  test('existing for our URL → DELETE each, then POST with the token; never PATCH; action recreated', async () => {
    as('principal')
    global.fetch = ccWorld({ webhooks: [{ id: 77, url: URL_, scopes: ['photo.created'], enabled: false, token: null }, { id: 78, url: URL_ }, { id: 3, url: 'https://elsewhere.example/hook' }] })
    const r = await reg()
    expect(r.status).toBe(200)
    expect(methods()).toEqual(['GET /webhooks?limit=100', 'DELETE /webhooks/77', 'DELETE /webhooks/78', 'POST /webhooks'])
    expect(global.fetch.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(false)
    const post = global.fetch.mock.calls.find(c => c[1]?.method === 'POST')
    expect(JSON.parse(post[1].body)).toEqual({ webhook: { url: URL_, scopes: ['photo.*'], token: HOOK_TOKEN } }) // prompt 83: photo.*
    expect(r.body).toMatchObject({ ok: true, action: 'recreated', webhook_id: '501', url: URL_, scopes: ['photo.*'], enabled: true, deleted: ['77', '78'] })
    expect(r.body).not.toHaveProperty('token')
    expect(JSON.stringify(r.body)).not.toContain(HOOK_TOKEN)
    expect(JSON.stringify(info.mock.calls)).not.toContain(HOOK_TOKEN)
    expect(mockState.calls).toEqual([])
  })

  test('a failed DELETE → 502, no POST, no success claimed, no token', async () => {
    as('principal')
    global.fetch = ccWorld({ webhooks: [{ id: 77, url: URL_ }, { id: 78, url: URL_ }], deleteStatus: { 78: 500 } })
    const r = await reg()
    expect(r.status).toBe(502)
    expect(r.body.ok).toBeUndefined()
    expect(r.body.action).toBeUndefined()
    expect(r.body.error).toMatch(/Could not delete existing CompanyCam webhook 78/)
    expect(methods()).toEqual(['GET /webhooks?limit=100', 'DELETE /webhooks/77', 'DELETE /webhooks/78'])
    expect(global.fetch.mock.calls.some(c => c[1]?.method === 'POST' || c[1]?.method === 'PATCH')).toBe(false)
    expect(JSON.stringify(r.body)).not.toContain(HOOK_TOKEN)
  })

  test('POST refused after the deletes → 502 telling the Owner to run it again', async () => {
    as('principal')
    global.fetch = ccWorld({ webhooks: [{ id: 77, url: URL_ }], postStatus: 422 })
    const r = await reg()
    expect(r.status).toBe(502)
    expect(r.body.ok).toBeUndefined()
    expect(r.body.error).toMatch(/already deleted — run Register again/)
    expect(JSON.stringify(r.body)).not.toContain(HOOK_TOKEN)
  })

  test('route source never PATCHes a webhook', () => {
    expect(read('app/api/companycam/register-webhook/route.js')).not.toMatch(/method: 'PATCH'/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('5) source checks', () => {
  const sql = read('migrations/074_companycam.sql')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

  test('migration 074: columns, partial unique indexes, inbox table, RLS, no policies, guards, rollback', () => {
    expect(sql).toMatch(/PROPOSED — written, NOT applied/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS companycam_project_id text NULL/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS companycam_import_state jsonb NULL/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS companycam_photo_id\s+text/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS companycam_creator_name\s+text/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS companycam_tags\s+text\[\]/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS internal_only boolean NOT NULL DEFAULT false/)
    expect(code).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS jobs_companycam_project_id_key\s+ON public\.jobs \(companycam_project_id\)\s+WHERE companycam_project_id IS NOT NULL/)
    expect(code).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS job_photos_companycam_photo_id_key\s+ON public\.job_photos \(companycam_photo_id\)\s+WHERE companycam_photo_id IS NOT NULL/)
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.companycam_photo_inbox/)
    expect(code).toMatch(/ALTER TABLE public\.companycam_photo_inbox ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/REVOKE ALL ON public\.companycam_photo_inbox FROM anon, authenticated/)
    expect(code).not.toMatch(/CREATE POLICY/i)
    expect(code).toMatch(/NEW\.companycam_import_state IS DISTINCT FROM OLD\.companycam_import_state/)
    expect(code).toMatch(/current_user IN \('service_role', 'postgres', 'supabase_admin'\)/)
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.guard_jobs_companycam_project\(\) FROM PUBLIC, anon, authenticated/)
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.guard_job_photos_companycam\(\) FROM PUBLIC, anon, authenticated/)
    expect(code).toMatch(/DROP TRIGGER IF EXISTS jobs_companycam_project_guard/)
    expect(sql).toMatch(/-- ROLLBACK/)
    expect(sql).toMatch(/--\s+DROP TABLE IF EXISTS public\.companycam_photo_inbox/)
  })

  test('no 072 / 073 files; 070 unchanged in place', () => {
    const files = fs.readdirSync(path.join(root, 'migrations'))
    expect(files.filter(f => /^07[23]_/.test(f))).toEqual([])
    expect(files.filter(f => /^074_/.test(f))).toEqual(['074_companycam.sql'])
    expect(files).toContain('070_job_photos_internal.sql')
  })

  test('lib/companycam.js is server-only and cites the CompanyCam sources; no new deps', () => {
    const lib = read('lib/companycam.js')
    expect(lib).toContain('https://developers.companycam.com/openapi/public_api_v1.yaml')
    expect(lib).toContain('https://companycam.readme.io/docs/webhooks-1')
    expect(lib).toMatch(/createHmac\('sha1', token\)/)
    expect(lib).toMatch(/digest\('base64'\)/)
    for (const page of ['app/jobdetail/page.js', 'app/residentialjobdetail/page.js', 'app/components/CompanyCamLinkBar.js', 'app/companycam/page.js']) {
      expect(read(page)).not.toMatch(/lib\/companycam'/)
    }
    const pkg = JSON.parse(read('package.json'))
    expect(Object.keys(pkg.dependencies)).not.toContain('@vercel/functions')
  })

  test('job pages render the bar and the CompanyCam label', () => {
    const jd = read('app/jobdetail/page.js')
    expect(jd).toContain('<CompanyCamLinkBar jobId={id} job={job} userRole={userRole} onImported={loadFieldPhotos} />')
    expect(jd).toContain('companycam: !!p.companycam_photo_id, by: p.companycam_creator_name || null, ccTags: p.companycam_tags || []')
    const rd = read('app/residentialjobdetail/page.js')
    expect(rd).toContain('<CompanyCamLinkBar jobId={id} job={job} userRole={userRole} onImported={loadPhotos} />')
    expect(rd).toContain('companycam: !!p.companycam_photo_id, by: p.companycam_creator_name || null, ccTags: p.companycam_tags || []')
    const bar = read('app/components/CompanyCamLinkBar.js')
    expect(bar).toContain('Needs database migration 074')
    expect(bar).toContain('Start background import')
  })
})
