/**
 * Prompt 83 — CompanyCam tag sync after import.
 *   1. register-webhook: photo.* scope, one fallback on 400/422, delete-then-post, no token out.
 *   2. webhook: photo.tag_* / photo.updated → syncCcPhotoTags (tags re-read from the API, only
 *      companycam_tags written), id fallbacks, ignored events, signature still enforced.
 *   3. syncCcPhotoTags error mapping: every API failure → 200 'failed' (best-effort, protects the
 *      shared webhook from CompanyCam's disable threshold), 404 → 200, DB error → 503, pre-074 → 200.
 * All DB access is the in-memory mock and all CompanyCam calls are a stubbed fetch. Nothing live.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  return { requireAuth: async () => mockState.auth }
})

const cc = require('../lib/companycam')
const webhook = require('../app/api/companycam/webhook/route')
const registerRoute = require('../app/api/companycam/register-webhook/route')

const HOOK_TOKEN = 'test-webhook-token'
const API_TOKEN = 'test-api-token'
const URL_ = 'https://portal.nv.construction/api/companycam/webhook'
const API = 'https://api.companycam.com/public_api/v1'

const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data, errors: null, meta: {} } : { errors: [{ title: 'err' }] }), { status, headers: { 'content-type': 'application/json' } })

// tags: { photoId: [tag objects] }; tagStatus: { photoId: http status }
// postScopes: what CompanyCam's POST response reports as registered (default: echoes the request)
function ccWorld({ tags = {}, tagStatus = {}, webhooks = [], postStatus = [], postScopes } = {}) {
  const posts = [...postStatus]
  return jest.fn(async (url, opts = {}) => {
    const u = new URL(String(url))
    const p = u.pathname.replace('/public_api/v1', '')
    const method = opts.method || 'GET'
    let m
    if ((m = p.match(/^\/photos\/(\d+)\/tags$/))) {
      if (tagStatus[m[1]]) return json(null, tagStatus[m[1]])
      return json(tags[m[1]] || [])
    }
    if (p === '/webhooks' && method === 'GET') return json(webhooks)
    if (p === '/webhooks' && method === 'POST') {
      const st = posts.shift()
      return st ? json(null, st) : json({ id: 501, enabled: true, ...JSON.parse(opts.body).webhook, ...(postScopes !== undefined ? { scopes: postScopes } : {}) }, 201)
    }
    if ((m = p.match(/^\/webhooks\/(\d+)$/)) && method === 'DELETE') return new Response(null, { status: 204 })
    return new Response('unexpected', { status: 599 })
  })
}

const sign = (raw, token = HOOK_TOKEN) => crypto.createHmac('sha1', token).update(raw).digest('base64')
const hookReq = (raw, sig) => new Request('http://x/api/companycam/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-companycam-signature': sig } : {}) }, body: raw })
const deliver = async (body, sig) => {
  const raw = JSON.stringify(body)
  const res = await webhook.POST(hookReq(raw, sig === undefined ? sign(raw) : sig))
  return { status: res.status, body: await res.json() }
}
const ev = (event_type, payload) => ({ event_type, created_at: 1762000000, payload, webhook_id: '42' })

const PHOTO_ROW = () => ({
  id: 'P1', job_id: 'J1', storage_path: 'J1/gallery/cc-555.jpg', caption: 'Footings poured', internal_only: true,
  visibility: 'internal', companycam_photo_id: '555', companycam_creator_name: 'Sam Field', companycam_tags: ['Concrete'],
})
const OTHER_ROW = () => ({ id: 'P2', job_id: 'J1', companycam_photo_id: '777', companycam_tags: ['Keep'], internal_only: true, caption: null })

const realFetch = global.fetch
let warn, info, err
beforeEach(() => {
  resetMockState({
    jobs: [{ id: 'J1', project_name: 'Russellville', job_number: '2401', companycam_project_id: '900' }],
    job_photos: [PHOTO_ROW(), OTHER_ROW()],
    companycam_photo_inbox: [],
  })
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

const row = id => mockState.db.job_photos.find(r => r.companycam_photo_id === id)
const fetched = () => global.fetch.mock.calls.map(c => `${c[1]?.method || 'GET'} ${String(c[0]).replace(API, '')}`)

// ─────────────────────────────────────────────────────────────────────────────
describe('1) register-webhook scopes', () => {
  const reg = async () => {
    const res = await registerRoute.POST(new Request('http://x/api/companycam/register-webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
    return { status: res.status, body: await res.json() }
  }
  const posted = () => global.fetch.mock.calls.filter(c => c[1]?.method === 'POST').map(c => JSON.parse(c[1].body))
  beforeEach(() => { mockState.auth = { userId: 'principal1', role: 'principal', email: 'p@x.com', error: null } })

  test("registers ['photo.*'], deletes our existing webhook first, never returns the token", async () => {
    global.fetch = ccWorld({ webhooks: [{ id: 77, url: URL_, scopes: ['photo.created'] }, { id: 3, url: 'https://elsewhere.example/hook' }] })
    const r = await reg()
    expect(r.status).toBe(200)
    expect(fetched()).toEqual(['GET /webhooks?limit=100', 'DELETE /webhooks/77', 'POST /webhooks'])
    expect(posted()).toEqual([{ webhook: { url: URL_, scopes: ['photo.*'], token: HOOK_TOKEN } }])
    expect(r.body).toMatchObject({ ok: true, action: 'recreated', webhook_id: '501', url: URL_, scopes: ['photo.*'], requested_scopes: ['photo.*'], scopes_fallback: false, deleted: ['77'] })
    expect(JSON.stringify(r.body)).not.toContain(HOOK_TOKEN)
    expect(JSON.stringify(info.mock.calls)).not.toContain(HOOK_TOKEN)
  })

  test.each([422, 400])('%s on photo.* → retries ONCE with the explicit list and reports it', async status => {
    global.fetch = ccWorld({ webhooks: [{ id: 77, url: URL_ }], postStatus: [status] })
    const r = await reg()
    expect(r.status).toBe(200)
    expect(fetched()).toEqual(['GET /webhooks?limit=100', 'DELETE /webhooks/77', 'POST /webhooks', 'POST /webhooks'])
    const FB = ['photo.created', 'photo.tag_added', 'photo.updated']
    expect(posted().map(b => b.webhook.scopes)).toEqual([['photo.*'], FB])
    expect(posted().every(b => b.webhook.token === HOOK_TOKEN && b.webhook.url === URL_)).toBe(true)
    expect(r.body).toMatchObject({ ok: true, scopes: FB, requested_scopes: FB, scopes_fallback: true })
    expect(JSON.stringify(r.body)).not.toContain(HOOK_TOKEN)
  })

  test('fallback refused too → 502, only two POSTs; a 500 is not retried with the fallback', async () => {
    global.fetch = ccWorld({ postStatus: [422, 422] })
    let r = await reg()
    expect(r.status).toBe(502)
    expect(posted()).toHaveLength(2)
    expect(JSON.stringify(r.body)).not.toContain(HOOK_TOKEN)

    global.fetch = ccWorld({ postStatus: [500] })
    r = await reg()
    expect(r.status).toBe(502)
    expect(posted()).toHaveLength(1)
  })

  test("response reports CompanyCam's registered scopes, not the request, when they differ", async () => {
    global.fetch = ccWorld({ postScopes: ['photo.tag_added'] })
    let r = await reg()
    expect(r.status).toBe(200)
    expect(posted()).toEqual([{ webhook: { url: URL_, scopes: ['photo.*'], token: HOOK_TOKEN } }])
    expect(r.body).toMatchObject({ ok: true, scopes: ['photo.tag_added'], requested_scopes: ['photo.*'], scopes_fallback: false })
    expect(JSON.stringify(info.mock.calls)).toContain('scopes=photo.tag_added')

    global.fetch = ccWorld({ postScopes: [] })
    r = await reg()
    expect(r.body).toMatchObject({ scopes: [], requested_scopes: ['photo.*'] })

    // No scopes array in the response → falls back to the list we sent.
    global.fetch = ccWorld({ postScopes: null })
    r = await reg()
    expect(r.body).toMatchObject({ scopes: ['photo.*'], requested_scopes: ['photo.*'] })
    expect(JSON.stringify(r.body)).not.toContain(HOOK_TOKEN)
  })

  test('Owner page shows registered scopes, warns when imports are not covered, spacing + help text', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app/companycam/page.js'), 'utf8')
    expect(src).toMatch(/registered scopes: \$\{registered\.join/)
    expect(src).toMatch(/d\.requested_scopes/)
    expect(src).toMatch(/d\.scopes_fallback/)
    expect(src).toMatch(/registered\.includes\('photo\.\*'\) \|\| registered\.includes\('photo\.created'\)/)
    expect(src).toMatch(/new photos will NOT be imported/)
    expect(src).toMatch(/hookMsg\?\.warn/)
    expect(src).toMatch(/ · \$\{d\.enabled \? 'enabled' : 'disabled'\}/)
    expect(src).not.toMatch(/·\$\{d\.enabled/)
    expect(src).toMatch(/while a photo is still being imported/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2) webhook tag events', () => {
  const API_TAGS = [{ display_value: 'Rebar', value: 'rebar' }, { display_value: 'Inspection', value: 'inspection' }]

  test('photo.tag_added → only companycam_tags changes, tags come from the API not the payload', async () => {
    global.fetch = ccWorld({ tags: { 555: API_TAGS } })
    const before = PHOTO_ROW()
    const r = await deliver(ev('photo.tag_added', { photo: { id: 555, tags: [{ display_value: 'PAYLOAD-TAG' }] }, tag: { value: 'payload-tag' } }))
    expect(r).toEqual({ status: 200, body: { ok: true, status: 'tags synced' } })
    expect(fetched()).toEqual(['GET /photos/555/tags'])
    expect(row('555')).toEqual({ ...before, companycam_tags: ['Rebar', 'Inspection'] })
    expect(row('777')).toEqual(OTHER_ROW())
    expect(mockState.calls).toEqual([{ table: 'job_photos', op: 'update', payload: { companycam_tags: ['Rebar', 'Inspection'] }, ids: ['P1'] }])
    expect(JSON.stringify(mockState.db)).not.toContain('PAYLOAD-TAG')
  })

  test.each(['photo.tag_removed', 'photo.updated', 'photo.tags_changed'])('%s takes the same path', async type => {
    global.fetch = ccWorld({ tags: { 555: [] } })
    const r = await deliver(ev(type, { id: '555' }))
    expect(r).toEqual({ status: 200, body: { ok: true, status: 'tags synced' } })
    expect(fetched()).toEqual(['GET /photos/555/tags'])
    expect(row('555').companycam_tags).toEqual([])
    expect(row('555').internal_only).toBe(true)
    expect(row('555').caption).toBe('Footings poured')
    expect(mockState.calls.map(c => Object.keys(c.payload))).toEqual([['companycam_tags']])
  })

  test('tag-object payload: id taken from photo_id (not the tag id); taggable_id also accepted', async () => {
    global.fetch = ccWorld({ tags: { 555: API_TAGS } })
    let r = await deliver(ev('photo.tag_added', { id: 9001, value: 'rebar', display_value: 'Rebar', photo_id: 555 }))
    expect(r.status).toBe(200)
    expect(fetched()).toEqual(['GET /photos/555/tags'])
    expect(row('555').companycam_tags).toEqual(['Rebar', 'Inspection'])

    global.fetch = ccWorld({ tags: { 555: [{ display_value: 'Final' }] } })
    r = await deliver(ev('photo.tag_removed', { id: 9001, display_value: 'Rebar', taggable_id: '555', taggable_type: 'Photo' }))
    expect(r.status).toBe(200)
    expect(fetched()).toEqual(['GET /photos/555/tags'])
    expect(row('555').companycam_tags).toEqual(['Final'])
  })

  test('tag object WITHOUT value/display_value but with photo_id → photo_id wins over the tag id', async () => {
    global.fetch = ccWorld({ tags: { 555: API_TAGS, 9001: [{ display_value: 'WRONG' }] } })
    const r = await deliver(ev('photo.tag_added', { id: 9001, name: 'Rebar', photo_id: 555 }))
    expect(r).toEqual({ status: 200, body: { ok: true, status: 'tags synced' } })
    expect(fetched()).toEqual(['GET /photos/555/tags'])
    expect(row('555').companycam_tags).toEqual(['Rebar', 'Inspection'])
  })

  test('photo.updated whose payload IS the photo resolves to its own id; payload.photo.id wins', async () => {
    global.fetch = ccWorld({ tags: { 777: [{ display_value: 'New' }] } })
    expect((await deliver(ev('photo.updated', { id: 777, uris: [], project_id: 900 }))).status).toBe(200)
    expect(fetched()).toEqual(['GET /photos/777/tags'])
    expect(row('777').companycam_tags).toEqual(['New'])

    global.fetch = ccWorld({ tags: { 555: [{ display_value: 'Nested' }] } })
    expect((await deliver(ev('photo.tag_added', { id: 9001, photo: { id: 555 }, photo_id: 777 }))).status).toBe(200)
    expect(fetched()).toEqual(['GET /photos/555/tags'])
    expect(row('555').companycam_tags).toEqual(['Nested'])
  })

  test('no usable photo id → 200 { ignored: "no photo id" }, nothing fetched or written', async () => {
    global.fetch = ccWorld()
    for (const payload of [{}, null, { id: 9001, value: 'rebar' }, { id: 'abc' }, { taggable_id: '555', taggable_type: 'Project', value: 'x' }]) {
      expect(await deliver(ev('photo.tag_added', payload))).toEqual({ status: 200, body: { ignored: 'no photo id' } })
    }
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.calls).toEqual([])
  })

  test('photo.deleted / project.* / comment.* / missing type → 200 ignored, nothing done', async () => {
    global.fetch = ccWorld()
    expect(await deliver(ev('photo.deleted', { id: '555' }))).toEqual({ status: 200, body: { ignored: 'photo.deleted' } })
    expect(await deliver(ev('project.created', { id: '900' }))).toEqual({ status: 200, body: { ignored: 'project.created' } })
    expect(await deliver(ev('comment.created', { id: '1' }))).toEqual({ status: 200, body: { ignored: 'comment.created' } })
    expect(await deliver({ payload: { id: '555' } })).toEqual({ status: 200, body: { ignored: null } })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.calls).toEqual([])
  })

  test('photo not imported → 200 "not imported", no API call, no insert anywhere (no inbox row)', async () => {
    global.fetch = ccWorld({ tags: { 999: API_TAGS } })
    const r = await deliver(ev('photo.tag_added', { id: '999' }))
    expect(r).toEqual({ status: 200, body: { ok: true, status: 'not imported' } })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockState.calls).toEqual([])
    expect(mockState.db.companycam_photo_inbox).toEqual([])
  })

  test('invalid / missing signature → 401, nothing fetched or written', async () => {
    global.fetch = ccWorld({ tags: { 555: API_TAGS } })
    const body = ev('photo.tag_added', { id: '555' })
    expect((await deliver(body, null)).status).toBe(401)
    expect((await deliver(body, sign(JSON.stringify(body), 'wrong-token'))).status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(row('555').companycam_tags).toEqual(['Concrete'])
  })

  test('photo.created still goes to processCcPhoto (bad id still 400, not the tag path)', async () => {
    global.fetch = ccWorld()
    expect((await deliver(ev('photo.created', { id: 'abc' }))).status).toBe(400)
    const dup = await deliver(ev('photo.created', { photo: { id: '555' } }))
    expect(dup).toEqual({ status: 200, body: { ok: true, status: 'duplicate' } })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(row('555').companycam_tags).toEqual(['Concrete'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3) syncCcPhotoTags error mapping', () => {
  // Best-effort: any API failure answers 200 so photo.* volume cannot get the shared webhook
  // (which also carries photo.created imports) disabled. The next event re-syncs.
  test.each([401, 403, 429, 500, 502, 503])('API %s → 200 failed/api (no retry), warns with id + status, tags untouched', async st => {
    global.fetch = ccWorld({ tagStatus: { 555: st } })
    expect(await deliver(ev('photo.tag_added', { id: '555' }))).toEqual({ status: 200, body: { ok: true, status: 'failed' } })
    expect(row('555')).toEqual(PHOTO_ROW())
    expect(mockState.calls).toEqual([])
    const warned = warn.mock.calls.map(c => c.join(' ')).join('\n')
    expect(warned).toContain('555')
    expect(warned).toContain(String(st))
    expect(warned).not.toContain(API_TOKEN)
  })

  test('direct call returns { http: 200, status: failed, reason: api, apiStatus }', async () => {
    global.fetch = ccWorld({ tagStatus: { 555: 429 } })
    const db = require('@supabase/supabase-js').createClient('u', 'k')
    expect(await cc.syncCcPhotoTags(db, '555')).toEqual({ http: 200, status: 'failed', reason: 'api', apiStatus: 429 })
  })

  test('timeout / unreachable → 200 failed (apiStatus 0), tags untouched', async () => {
    for (const name of ['TimeoutError', 'TypeError']) {
      warn.mockClear()
      global.fetch = jest.fn(async () => { throw Object.assign(new Error('t'), { name }) })
      expect(await deliver(ev('photo.tag_added', { id: '555' }))).toEqual({ status: 200, body: { ok: true, status: 'failed' } })
      expect(warn.mock.calls.map(c => c.join(' ')).join('\n')).toMatch(/555.*status 0/)
    }
    expect(row('555')).toEqual(PHOTO_ROW())
    expect(mockState.calls).toEqual([])
  })

  test('missing COMPANYCAM_API_TOKEN → 200 failed (not 503), no fetch, tags untouched, token never logged', async () => {
    delete process.env.COMPANYCAM_API_TOKEN
    global.fetch = ccWorld({ tags: { 555: [{ display_value: 'Rebar' }] } })
    expect(await deliver(ev('photo.tag_added', { id: '555' }))).toEqual({ status: 200, body: { ok: true, status: 'failed' } })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(row('555')).toEqual(PHOTO_ROW())
    expect(mockState.calls).toEqual([])
    expect(warn.mock.calls.map(c => c.join(' ')).join('\n')).toMatch(/555/)
  })

  test('API 404 (photo deleted) → 200 "photo gone", row unchanged', async () => {
    global.fetch = ccWorld({ tagStatus: { 555: 404 } })
    expect(await deliver(ev('photo.tag_removed', { id: '555' }))).toEqual({ status: 200, body: { ok: true, status: 'photo gone' } })
    expect(row('555').companycam_tags).toEqual(['Concrete'])
    expect(mockState.calls).toEqual([])
  })

  test('DB read or write error → 503', async () => {
    global.fetch = ccWorld({ tags: { 555: [{ display_value: 'Rebar' }] } })
    mockState.failWrite = { job_photos: { update: 'connection reset' } }
    expect((await deliver(ev('photo.tag_added', { id: '555' }))).status).toBe(503)
    expect(row('555').companycam_tags).toEqual(['Concrete'])

    mockState.failWrite = {}
    mockState.failSelect = { job_photos: 'connection reset' }
    expect((await deliver(ev('photo.tag_added', { id: '555' }))).status).toBe(503)
  })

  test('before 074 (column missing) → 200 skipped, nothing written', async () => {
    global.fetch = ccWorld({ tags: { 555: [{ display_value: 'Rebar' }] } })
    mockState.missingSelectCols = { job_photos: ['companycam_photo_id'] }
    expect(await deliver(ev('photo.tag_added', { id: '555' }))).toEqual({ status: 200, body: { ok: true, status: 'skipped' } })
    expect(global.fetch).not.toHaveBeenCalled()

    mockState.missingSelectCols = {}
    mockState.missingCols = { job_photos: ['companycam_tags'] }
    expect(await deliver(ev('photo.tag_added', { id: '555' }))).toEqual({ status: 200, body: { ok: true, status: 'skipped' } })
    expect(mockState.calls).toEqual([])
  })

  test('non-array tags body never wipes saved tags; tags normalized (trim, 60 chars, max 20)', async () => {
    global.fetch = jest.fn(async () => json({ unexpected: true }))
    expect((await cc.syncCcPhotoTags(require('@supabase/supabase-js').createClient('u', 'k'), '555')).http).toBe(200)
    expect(row('555').companycam_tags).toEqual(['Concrete'])

    const many = Array.from({ length: 25 }, (_, i) => ({ display_value: ` T${i} ${'x'.repeat(80)}` }))
    global.fetch = ccWorld({ tags: { 555: many } })
    expect((await deliver(ev('photo.tag_added', { id: '555' }))).status).toBe(200)
    expect(row('555').companycam_tags).toHaveLength(20)
    expect(row('555').companycam_tags[0]).toBe(`T0 ${'x'.repeat(57)}`)
  })

  test('inbox is never written (074 inbox has no tags column)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib/companycam.js'), 'utf8')
    const fn = src.slice(src.indexOf('export async function syncCcPhotoTags'), src.indexOf('// ── Route helpers'))
    expect(fn).not.toMatch(/companycam_photo_inbox/)
    expect(fn).not.toMatch(/\.insert\(/)
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations/074_companycam.sql'), 'utf8')
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.companycam_photo_inbox')
    const table = sql.slice(start, sql.indexOf(');', start))
    expect(start).toBeGreaterThan(0)
    expect(table).not.toMatch(/tags/)
  })
})
