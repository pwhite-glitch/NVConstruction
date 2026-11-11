/**
 * Prompt 73 — internal-only photos.
 *   1. Pure: isInternalPhoto / filterOwnerVisible / ownerPhotoList / pageOwnerPhotos / paging params.
 *   2. insertJobPhotoWithFallbacks: internal ON + missing column (pre-070) → hard migration_070
 *      error, never a visible row; OFF → inserts without the key; tag / GPS still retried.
 *   3. POST /api/photo-visibility: delete-photo gate, 503 migration_required '070' before 070,
 *      daily-report jsonb toggle works without the column.
 *   4. GET /api/owner-photos: internals excluded (photos + total), paging, no 500 pre-070,
 *      other owner 403, signing failure 502.
 *   5. Source checks: migration 070, field / jobdetail / residential / owner pages.
 * All DB access is the in-memory mock; nothing live, no migration applied.
 */
const fs = require('fs')
const path = require('path')
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

const {
  isInternalPhoto, filterOwnerVisible, pageOwnerPhotos, parseOwnerPaging,
  insertJobPhotoWithFallbacks, setReportPhotoInternal, MIGRATION_070_MESSAGE,
} = require('../lib/photo-visibility')
const { ownerPhotoList } = require('../lib/owner-photos')
const { insertWithGpsFallback } = require('../lib/photo-taken-at')

// ─────────────────────────────────────────────────────────────────────────────
describe('1) pure helpers', () => {
  test('isInternalPhoto is strict true only', () => {
    expect(isInternalPhoto({ internal_only: true })).toBe(true)
    for (const v of [false, null, undefined, 'true', 1]) expect(isInternalPhoto({ internal_only: v })).toBe(false)
    expect(isInternalPhoto({})).toBe(false)
    expect(isInternalPhoto(null)).toBe(false)
  })

  test('filterOwnerVisible drops internals, keeps legacy rows', () => {
    expect(filterOwnerVisible([{ path: 'a', internal_only: true }, { path: 'b', internal_only: false }, { path: 'c' }]).map(p => p.path)).toEqual(['b', 'c'])
    expect(filterOwnerVisible(null)).toEqual([])
  })

  test('ownerPhotoList drops gallery + jsonb internals; keeps dedupe, thumbs, job folder rules; no internal flag in output', () => {
    const list = ownerPhotoList({
      jobId: 'J1',
      jobPhotos: [
        { storage_path: 'J1/gallery/1.jpg', caption: 'Footings', taken_at: '2026-11-05T15:00:00Z', internal_only: false },
        { storage_path: 'J1/gallery/2.jpg', caption: 'Secret', taken_at: '2026-11-07T15:00:00Z', internal_only: true },
        { storage_path: 'J1/gallery/3.jpg', taken_at: '2026-11-04T15:00:00Z' }, // pre-070: no column
        { storage_path: 'J1/gallery/1_thumb.jpg' },
        { storage_path: 'J2/gallery/9.jpg' },
      ],
      reports: [
        { report_date: '2026-11-06', photos: [{ path: 'J1/abc.jpg', caption: 'Slab' }, { path: 'J1/hid.jpg', internal_only: true }, { path: 'J1/gallery/1.jpg' }, { path: 'J1/nul.jpg', internal_only: null }] },
        // same path internal in one source → hidden everywhere
        { report_date: '2026-11-08', photos: [{ path: 'J1/gallery/2.jpg' }] },
      ],
    })
    expect(list.map(p => p.path)).toEqual(['J1/abc.jpg', 'J1/nul.jpg', 'J1/gallery/1.jpg', 'J1/gallery/3.jpg'])
    for (const p of list) expect(p).not.toHaveProperty('internal_only')
  })

  test('ownerPhotoList order is deterministic within a date (date desc, then path asc) so paging never skips / repeats', () => {
    const jobPhotos = [
      { storage_path: 'J1/gallery/c.jpg', taken_at: '2026-11-05T15:00:00Z' },
      { storage_path: 'J1/gallery/a.jpg', taken_at: '2026-11-05T18:00:00Z' },
      { storage_path: 'J1/gallery/z.jpg', taken_at: '2026-11-06T15:00:00Z' },
    ]
    const reports = [{ report_date: '2026-11-05', photos: [{ path: 'J1/b.jpg' }, { path: 'J1/d.jpg' }] }]
    const expected = ['J1/gallery/z.jpg', 'J1/b.jpg', 'J1/d.jpg', 'J1/gallery/a.jpg', 'J1/gallery/c.jpg']
    expect(ownerPhotoList({ jobId: 'J1', jobPhotos, reports }).map(p => p.path)).toEqual(expected)
    // DB row order must not matter
    const rev = ownerPhotoList({ jobId: 'J1', jobPhotos: [...jobPhotos].reverse(), reports: [{ ...reports[0], photos: [...reports[0].photos].reverse() }] })
    expect(rev.map(p => p.path)).toEqual(expected)
    // pages concatenate to the full list exactly once each
    const all = ownerPhotoList({ jobId: 'J1', jobPhotos, reports })
    const pages = [0, 2, 4].flatMap(offset => pageOwnerPhotos(all, { limit: 2, offset }).photos.map(p => p.path))
    expect(pages).toEqual(expected)
  })

  test('pageOwnerPhotos totals / has_more; parseOwnerPaging clamps', () => {
    const list = Array.from({ length: 250 }, (_, i) => ({ path: `J1/${i}.jpg` }))
    expect(pageOwnerPhotos(list, { limit: 100, offset: 0 })).toMatchObject({ total: 250, limit: 100, offset: 0, has_more: true })
    const last = pageOwnerPhotos(list, { limit: 100, offset: 200 })
    expect(last.photos).toHaveLength(50)
    expect(last.has_more).toBe(false)
    expect(pageOwnerPhotos(list, { limit: 100, offset: 300 })).toMatchObject({ photos: [], total: 250, has_more: false })
    const p = q => parseOwnerPaging(new URLSearchParams(q))
    expect(p('')).toEqual({ limit: 100, offset: 0 })
    expect(p('limit=500&offset=-4')).toEqual({ limit: 100, offset: 0 })
    expect(p('limit=0&offset=20')).toEqual({ limit: 1, offset: 20 })
    expect(p('limit=abc&offset=x')).toEqual({ limit: 100, offset: 0 })
  })

  test('setReportPhotoInternal sets / clears one element', () => {
    const photos = [{ path: 'J1/a.jpg', caption: 'x' }, { path: 'J1/b.jpg', internal_only: true }]
    expect(setReportPhotoInternal(photos, 'J1/a.jpg', true)).toEqual({ found: true, photos: [{ path: 'J1/a.jpg', caption: 'x', internal_only: true }, photos[1]] })
    expect(setReportPhotoInternal(photos, 'J1/b.jpg', false).photos[1]).toEqual({ path: 'J1/b.jpg' })
    expect(setReportPhotoInternal(photos, 'J1/zz.jpg', true).found).toBe(false)
    expect(setReportPhotoInternal(null, 'J1/a.jpg', true)).toEqual({ found: false, photos: [] })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2) insertJobPhotoWithFallbacks', () => {
  const base = { job_id: 'J1', super_id: 'u1', storage_path: 'J1/gallery/1.jpg', file_name: 'a.jpg' }
  // Fake job_photos table: columns in `missing` fail like PostgREST; successful rows are kept.
  const fakeDb = missing => {
    const calls = [], rows = []
    const insert = async row => {
      calls.push(row)
      const col = Object.keys(row).find(k => missing.includes(k))
      if (col) return { error: { code: 'PGRST204', message: `Could not find the '${col}' column of 'job_photos' in the schema cache` } }
      rows.push(row)
      return { error: null }
    }
    return { calls, rows, insert }
  }
  // Same composition as the pages: outer extra (caption / tag / internal_only) + inner GPS retry.
  const run = (db, extra, gps = null) => insertJobPhotoWithFallbacks(x => insertWithGpsFallback(g => db.insert({ ...base, ...x, taken_at: 'T', ...g }), gps), extra)

  test('internal ON + missing column (pre-070) → hard migration_070 error, no row written', async () => {
    const db = fakeDb(['internal_only', 'tag', 'latitude', 'longitude'])
    const r = await run(db, { caption: 'c', tag: null, internal_only: true }, { lat: 36, lng: -95 })
    expect(r.migrationRequired).toBe('070')
    expect(r.error).toEqual({ code: 'migration_070', message: MIGRATION_070_MESSAGE })
    expect(r.error.message).toMatch(/migration 070/)
    expect(db.rows).toEqual([])
    // every attempt still carried internal_only: true — never retried without it
    for (const c of db.calls) expect(c.internal_only).toBe(true)
  })

  test('internal ON after 070 → stored true (tag / GPS still retried)', async () => {
    const db = fakeDb(['tag', 'latitude', 'longitude'])
    const r = await run(db, { caption: 'c', tag: 'Framing', internal_only: true }, { lat: 36, lng: -95 })
    expect(r.error).toBeNull()
    expect(db.rows).toEqual([{ ...base, caption: 'c', internal_only: true, taken_at: 'T' }])
  })

  test('internal OFF + missing column → success without the key (owner-visible, today\'s behavior)', async () => {
    const db = fakeDb(['internal_only', 'tag'])
    const r = await run(db, { caption: null, tag: 'Framing', internal_only: false })
    expect(r).toEqual({ error: null, dropped: ['tag'] })
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).not.toHaveProperty('internal_only')
    for (const c of db.calls) expect(c).not.toHaveProperty('internal_only')
  })

  test('OFF with an empty extra still inserts; GPS still retried pre-066', async () => {
    const db = fakeDb(['latitude', 'longitude'])
    const r = await run(db, { internal_only: false }, { lat: 36.1, lng: -95.9 })
    expect(r.error).toBeNull()
    expect(db.calls).toHaveLength(2)
    expect(db.calls[0]).toMatchObject({ latitude: 36.1, longitude: -95.9 })
    expect(db.rows[0]).toEqual({ ...base, taken_at: 'T' })
  })

  test('a non-column error is returned as-is (not migration_070)', async () => {
    const r = await insertJobPhotoWithFallbacks(async () => ({ error: { code: '42501', message: 'denied' } }), { internal_only: true })
    expect(r.error).toEqual({ code: '42501', message: 'denied' })
    expect(r.migrationRequired).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3) POST /api/photo-visibility', () => {
  const route = require('../app/api/photo-visibility/route')
  const seed = (extra = {}) => resetMockState({
    jobs: [{ id: 'J1', pm_email: 'other@x.com', owner_email: 'client@braums.test' }, { id: 'J2' }],
    job_photos: [{ id: 'g1', job_id: 'J1', storage_path: 'J1/gallery/1.jpg', internal_only: false }],
    daily_reports: [
      { id: 'd1', job_id: 'J1', report_date: '2026-11-06', photos: [{ path: 'J1/a.jpg', caption: 'x' }, { path: 'J1/b.jpg' }] },
      { id: 'd2', job_id: 'J2', report_date: '2026-11-06', photos: [{ path: 'J2/a.jpg' }] },
    ],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'super1' }],
    ...extra,
  })
  const hide = (body = {}) => call(route.POST, '/api/photo-visibility', 'POST', { jobId: 'J1', path: 'J1/gallery/1.jpg', internal_only: true, ...body })
  const gallery = () => mockState.db.job_photos[0].internal_only

  test('principal / admin / on-job pm / assigned super can toggle a gallery photo', async () => {
    for (const [role, id] of [['principal', 'principal1'], ['admin', 'admin1'], ['pm', 'pm1'], ['super', 'super1']]) {
      seed()
      as(role, id)
      const r = await hide()
      expect([role, r.status, r.body]).toEqual([role, 200, { ok: true, internal_only: true }])
      expect(gallery()).toBe(true)
      expect((await hide({ internal_only: false })).status).toBe(200)
      expect(gallery()).toBe(false)
    }
  })

  test('owner / apm / sub / unrelated pm / unassigned super → 403, nothing changed', async () => {
    for (const [role, id, email] of [['owner', 'o1', 'client@braums.test'], ['apm', 'apm1'], ['subcontractor', 'sub1'], ['pm', 'pm9'], ['super', 'super9']]) {
      seed()
      as(role, id, email)
      const r = await hide()
      expect([role, id, r.status]).toEqual([role, id, 403])
      expect(gallery()).toBe(false)
    }
  })

  test('validation: internal_only must be boolean; photo must be on the job', async () => {
    seed(); as('principal')
    expect((await hide({ internal_only: 'yes' })).status).toBe(400)
    expect((await call(route.POST, '/api/photo-visibility', 'POST', { jobId: 'J1', internal_only: true })).status).toBe(400)
    expect((await hide({ path: 'J1/gallery/nope.jpg' })).status).toBe(404)
    expect((await hide({ jobId: 'J2' })).status).toBe(404) // row is on J1, not J2
  })

  test('gallery before migration 070 → 503 migration_required 070, no partial success', async () => {
    seed({ job_photos: [{ id: 'g1', job_id: 'J1', storage_path: 'J1/gallery/1.jpg' }] })
    mockState.missingCols = { job_photos: ['internal_only'] }
    as('principal')
    const r = await hide()
    expect(r.status).toBe(503)
    expect(r.body.migration_required).toBe('070')
    expect(r.body.error).toMatch(/migration 070/)
    expect(r.body.ok).toBeUndefined()
    expect(mockState.db.job_photos[0]).not.toHaveProperty('internal_only')
  })

  test('daily-report jsonb toggle works without the column; report must be on the job', async () => {
    seed()
    mockState.missingCols = { job_photos: ['internal_only'] }
    as('pm', 'pm1')
    let r = await hide({ path: 'J1/b.jpg', fromReport: true, reportId: 'd1' })
    expect(r).toEqual({ status: 200, body: { ok: true, internal_only: true } })
    expect(mockState.db.daily_reports[0].photos).toEqual([{ path: 'J1/a.jpg', caption: 'x' }, { path: 'J1/b.jpg', internal_only: true }])
    r = await hide({ path: 'J1/b.jpg', fromReport: true, reportId: 'd1', internal_only: false })
    expect(r.status).toBe(200)
    expect(mockState.db.daily_reports[0].photos[1]).toEqual({ path: 'J1/b.jpg' })
    expect((await hide({ path: 'J1/zz.jpg', fromReport: true, reportId: 'd1' })).status).toBe(404)
    // report on another job → 403 (even for principal)
    as('principal')
    expect((await hide({ path: 'J2/a.jpg', fromReport: true, reportId: 'd2' })).status).toBe(403)
    expect(mockState.db.daily_reports[1].photos).toEqual([{ path: 'J2/a.jpg' }])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4) GET /api/owner-photos', () => {
  const route = require('../app/api/owner-photos/route')
  const seed = (nGallery = 0, extra = {}) => resetMockState({
    jobs: [{ id: 'J1', owner_email: 'client@braums.test' }],
    job_photos: [
      { job_id: 'J1', storage_path: 'J1/gallery/hidden.jpg', taken_at: '2026-11-08T15:00:00Z', internal_only: true },
      ...Array.from({ length: nGallery }, (_, i) => ({ job_id: 'J1', storage_path: `J1/gallery/${String(i).padStart(3, '0')}.jpg`, taken_at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T15:00:00Z`, internal_only: false })),
    ],
    daily_reports: [{ id: 'd1', job_id: 'J1', report_date: '2026-11-06', photos: [{ path: 'J1/vis.jpg' }, { path: 'J1/int.jpg', internal_only: true }] }],
    ...extra,
  })
  const get = q => call(route.GET, `/api/owner-photos?job_id=J1${q || ''}`, 'GET')

  test('internals excluded from photos and total; nothing internal in the payload or signed', async () => {
    seed(2)
    as('owner', 'o1', 'client@braums.test')
    const signedPaths = []
    mockState.signedUrlResults = { 'daily-report-photos': p => { signedPaths.push(p); return null } }
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.body.photos.map(p => p.path)).toEqual(['J1/vis.jpg', 'J1/gallery/001.jpg', 'J1/gallery/000.jpg'])
    expect(r.body).toMatchObject({ total: 3, limit: 100, offset: 0, has_more: false })
    const json = JSON.stringify(r.body)
    expect(json).not.toMatch(/internal|hidden\.jpg|int\.jpg/)
    expect(signedPaths).toContain('J1/vis.jpg')
    for (const p of signedPaths) expect(p).not.toMatch(/hidden|int\.jpg/)
  })

  test('paging: limit / offset / has_more; limit clamped to 100', async () => {
    seed(150)
    as('owner', 'o1', 'client@braums.test')
    let r = await get('&limit=100&offset=0')
    expect(r.body.photos).toHaveLength(100)
    expect(r.body).toMatchObject({ total: 151, limit: 100, offset: 0, has_more: true })
    r = await get('&limit=100&offset=100')
    expect(r.body.photos).toHaveLength(51)
    expect(r.body).toMatchObject({ total: 151, offset: 100, has_more: false })
    const all = [...(await get('&offset=0')).body.photos, ...(await get('&offset=100')).body.photos].map(p => p.path)
    expect(new Set(all).size).toBe(151)
    r = await get('&limit=1000')
    expect(r.body.limit).toBe(100)
    r = await get('&offset=500')
    expect(r).toMatchObject({ status: 200, body: { photos: [], total: 151, has_more: false } })
  })

  test('pre-070 / pre-068 schema (no internal_only, no tag column) → 200, gallery all visible, jsonb still filtered', async () => {
    seed(0, { job_photos: [{ job_id: 'J1', storage_path: 'J1/gallery/1.jpg', taken_at: '2026-11-05T15:00:00Z' }] })
    mockState.missingSelectCols = { job_photos: ['internal_only', 'tag', 'latitude'] }
    as('owner', 'o1', 'client@braums.test')
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.body.photos.map(p => p.path)).toEqual(['J1/vis.jpg', 'J1/gallery/1.jpg'])
    expect(r.body.total).toBe(2)
  })

  test('owner of another job → 403; signing failure → 502 (prompt59)', async () => {
    seed(1)
    as('owner', 'o2', 'other@x.test')
    expect((await get()).status).toBe(403)
    as('owner', 'o1', 'client@braums.test')
    mockState.signedUrlResults = { 'daily-report-photos': p => (p === 'J1/vis.jpg' ? { signedUrl: null, error: 'Object not found' } : null) }
    const r = await get()
    expect(r.status).toBe(502)
    expect(r.body.photos).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('5) source checks', () => {
  const between = (src, start, end) => {
    const a = src.indexOf(start)
    expect(a).toBeGreaterThan(-1)
    const b = src.indexOf(end, a + start.length)
    expect(b).toBeGreaterThan(a)
    return src.slice(a, b)
  }

  test('migration 070: idempotent internal_only column, no storage policy, commented ROLLBACK, PROPOSED', () => {
    const sql = read('migrations/070_job_photos_internal.sql')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/ALTER TABLE public\.job_photos\s+ADD COLUMN IF NOT EXISTS internal_only boolean NOT NULL DEFAULT false/)
    expect(code).not.toMatch(/storage\.|POLICY|\btag\b|UPDATE|DROP|INDEX/i)
    expect((code.match(/ADD COLUMN(?! IF NOT EXISTS)/g) || [])).toHaveLength(0)
    expect(sql).toMatch(/STATUS: PROPOSED/)
    expect(sql).toMatch(/-- ROLLBACK/)
    expect(sql).toMatch(/--\s+ALTER TABLE public\.job_photos DROP COLUMN IF EXISTS internal_only/)
  })

  test('no 068 / 071 migration from this package', () => {
    const files = fs.readdirSync(path.join(root, 'migrations'))
    // Prompt 78 later added the only 071 (sales-docs bucket cap removal, unapplied).
    expect(files.filter(f => /^(068|071)_/.test(f))).toEqual(['071_remove_sales_docs_file_cap.sql'])
    expect(files.filter(f => /^070_/.test(f))).toEqual(['070_job_photos_internal.sql'])
  })

  test('field page: Internal only switch on gallery upload and daily-report photos', () => {
    const field = read('app/field/page.js')
    const gal = between(field, 'async function uploadGalleryPhoto', 'async function migratePhotos')
    expect(gal).toMatch(/insertJobPhotoWithFallbacks\(/)
    expect(gal).toMatch(/internal_only: usedInternal/)
    expect(gal).toMatch(/migrationRequired\) \{ await supabase\.storage\.from\('daily-report-photos'\)\.remove\(\[path, tp\(path\)\]\)/)
    const rep = between(field, 'async function uploadReportPhotos', '\n  }\n')
    expect(rep).toMatch(/internal_only: true/)
    expect(rep).toMatch(/reportPhotosInternal/)
    expect(field).toMatch(/Internal only \(hide from owner\)/)
    expect(field).toMatch(/setInternalOnlyDraft/)
  })

  test('field deletePhoto (report branch): fresh re-read before write, preserves other elements (internal_only), storage removed only after DB write', () => {
    const field = read('app/field/page.js')
    const del = between(field, 'async function deletePhoto(', 'async function uploadGalleryPhoto')
    const rep = between(del, 'if (photo.fromReport)', '} else {')
    // not the cached state copy
    expect(rep).not.toMatch(/dailyReports\.find/)
    const iRead = rep.indexOf(".from('daily_reports').select('id, photos').eq('id', photo.reportId).maybeSingle()")
    const iFilter = rep.indexOf('current.filter(p => p?.path !== photo.path)')
    const iWrite = rep.indexOf(".from('daily_reports').update({ photos: updated.length ? updated : null }).eq('id', fresh.id)")
    const iStorage = rep.indexOf(".storage.from('daily-report-photos').remove(")
    expect(iRead).toBeGreaterThan(-1)
    expect(iFilter).toBeGreaterThan(iRead)
    expect(iWrite).toBeGreaterThan(iFilter)
    expect(iStorage).toBeGreaterThan(iWrite)
    // fresh read / write errors stop before any write / storage removal
    expect(rep).toMatch(/if \(readErr\) throw/)
    expect(rep).toMatch(/if \(!fresh\) throw/)
    expect(rep).toMatch(/if \(writeErr\) throw/)
    expect(rep).toMatch(/setDailyReports\(/)
    // still browser-direct (apm keeps working), not /api/delete-photo
    expect(del).not.toMatch(/\/api\/delete-photo/)
    // gallery branch unchanged: storage then job_photos delete
    const gal = del.slice(del.indexOf('} else {'))
    expect(gal.indexOf(".remove(")).toBeLessThan(gal.indexOf(".from('job_photos').delete()"))

    // Filter semantics: only the deleted path goes; other elements kept exactly (internal_only, caption, tag, name)
    const current = [
      { path: 'J1/a.jpg', caption: 'A', tag: 'progress', name: 'a.jpg', internal_only: true },
      { path: 'J1/b.jpg', caption: 'B', name: 'b.jpg' },
    ]
    const updated = current.filter(p => p?.path !== 'J1/b.jpg')
    expect(updated).toEqual([{ path: 'J1/a.jpg', caption: 'A', tag: 'progress', name: 'a.jpg', internal_only: true }])
  })

  test('field loadPhotoGallery always refetches daily_reports (one query, no cached reuse)', () => {
    const field = read('app/field/page.js')
    const load = between(field, 'async function loadPhotoGallery()', 'async function deletePhoto(')
    expect(load).not.toMatch(/let reports = dailyReports/)
    expect(load.match(/\.from\('daily_reports'\)/g)).toHaveLength(1)
    expect(load).toMatch(/setDailyReports\(rpts \|\| \[\]\)/)
  })

  test('jobdetail + residential: badge and Hide / Show to owner via /api/photo-visibility', () => {
    for (const f of ['app/jobdetail/page.js', 'app/residentialjobdetail/page.js']) {
      const src = read(f)
      expect([f, /\/api\/photo-visibility/.test(src)]).toEqual([f, true])
      expect(src).toMatch(/Hide from owner/)
      expect(src).toMatch(/Show to owner/)
      expect(src).toMatch(/>Internal</)
      expect(src).toMatch(/internal_only: p\.internal_only === true/)
      expect(src).not.toMatch(/from\('job_photos'\)\.update\(/)
    }
    const resi = read('app/residentialjobdetail/page.js')
    const up = between(resi, 'async function uploadPhoto(e)', 'await loadPhotos()')
    expect(up).toMatch(/insertJobPhotoWithFallbacks\(/)
    expect(up).toMatch(/internal_only: photoInternalDraft/)
  })

  test('owner-photos route: no hard tag select, paging metadata, no silent slice(0, 500)', () => {
    const src = read('app/api/owner-photos/route.js')
    expect(src).not.toMatch(/select\('[^']*\btag\b/)
    expect(src).not.toMatch(/slice\(0, 500\)/)
    expect(src).toMatch(/has_more/)
    expect(src).toMatch(/parseOwnerPaging/)
    expect(src).toMatch(/Cache-Control': 'no-store'/)
  })

  test('owner page: Load more + Showing X of Y, no internal flag', () => {
    const page = read('app/owner/page.js')
    expect(page).toMatch(/Load more/)
    expect(page).toMatch(/Showing \{photos\.length\} of/)
    expect(page).toMatch(/offset=\$\{photos\.length\}/)
    expect(page).not.toMatch(/internal_only/)
  })
})
