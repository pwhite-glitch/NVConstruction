/**
 * Prompt 78 part B: export manifests + browser ZIP.
 *  - /api/itb-export: auth / bid-package / job denials sign nothing; foreign or missing selected
 *    plan ids refuse the export; exact, unique, stably ordered names across pages; each page
 *    re-authorizes; no server download and no buffered ZIP; signing failure → 422 with names;
 *    generated ITB HTML never crosses the API.
 *  - lib/export-client: an expired / failed signed link, a network error or a bad manifest
 *    page aborts the whole export (no download); bounded concurrency; >5 MB builds in the browser.
 *  - signing PDF route is streamed (see prompt78-large-document).
 * Owner-reimbursement manifest route: tests/prompt66-owner-reimb-export.test.js.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth || { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) },
    isPM: r => PM.has(r),
  }
})

const itb = require('../app/api/itb-export/route')
const { fetchEntries, fetchManifestPages, exportOwnerReimbZip, exportItbZip, ExportError } = require('../lib/export-client')

const BP = 'bp-1', JOB = 'job-1', JOB2 = 'job-2'
const as = (role, userId = `u-${role}`) => { mockState.auth = { userId, email: `${userId}@nv.test`, role, error: null } }
const post = body => itb.POST(new Request('http://x/api/itb-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const out = async r => ({ status: r.status, body: await r.json(), headers: r.headers })
const signs = () => mockState.storageCalls.filter(c => c.op === 'createSignedUrls' || c.op === 'createSignedUrl')
const plan = (id, file_name, pkg = BP) => ({ id, bid_package_id: pkg, file_name, storage_path: `${pkg}/${id}-${file_name}` })

beforeEach(() => {
  resetMockState({
    jobs: [{ id: JOB, pm_email: null }, { id: JOB2, pm_email: null }],
    pm_job_assignments: [{ id: 'a1', job_id: JOB, user_id: 'u-apm' }],
    bid_packages: [
      { id: BP, title: 'Main St Bid', job_id: JOB, allowed_users: ['u-apm'] },
      { id: 'bp-2', title: 'Other', job_id: JOB2, allowed_users: [] },
    ],
    bid_plans: [
      plan('p1', 'Plans.pdf'), plan('p2', 'Plans.pdf'), plan('p3', 'Résumé (1).pdf'), plan('p4', '../../etc/passwd'),
      plan('x1', 'Secret.pdf', 'bp-2'),
    ],
  })
  mockState.auth = null
})

describe('/api/itb-export manifest', () => {
  test('no session / wrong role / not on the package / not on the job → refused, nothing signed', async () => {
    expect((await post({ bidPackageId: BP, selectedPlanIds: ['p1'] })).status).toBe(401)
    as('subcontractor'); expect((await post({ bidPackageId: BP, selectedPlanIds: ['p1'] })).status).toBe(403)
    as('apm', 'u-apm-off'); expect((await post({ bidPackageId: BP, selectedPlanIds: ['p1'] })).status).toBe(403)
    // APM listed on the package but not on its job
    mockState.db.bid_packages[0].allowed_users.push('u-apm-nojob')
    as('apm', 'u-apm-nojob'); expect((await post({ bidPackageId: BP, selectedPlanIds: ['p1'] })).status).toBe(403)
    expect(signs()).toEqual([])
  })

  test('foreign or missing selected ids refuse the whole export (never a smaller success)', async () => {
    as('principal')
    const foreign = await out(await post({ bidPackageId: BP, selectedPlanIds: ['p1', 'x1'] }))
    expect(foreign.status).toBe(422)
    expect(foreign.body.error).toMatch(/1 selected document is not in this bid package/)
    expect((await post({ bidPackageId: BP, selectedPlanIds: ['p1', 'gone'] })).status).toBe(422)
    expect((await post({ bidPackageId: BP, selectedPlanIds: [] })).status).toBe(400)
    expect((await post({ bidPackageId: BP, selectedPlanIds: Array.from({ length: 1001 }, (_, i) => `id${i}`) })).status).toBe(400)
    expect((await post({ bidPackageId: BP, selectedPlanIds: [{ id: 'p1' }] })).status).toBe(400)
    expect(signs()).toEqual([])
  })

  test('itbHtml in the request is refused: generated HTML stays in the browser', async () => {
    as('principal')
    expect((await post({ bidPackageId: BP, selectedPlanIds: ['p1'], itbHtml: '<html>' })).status).toBe(400)
    expect(signs()).toEqual([])
  })

  test('manifest: exact unique safe names in stable order, signed links from bid-plans, README text, no download / ZIP, no-store', async () => {
    as('apm')
    const r = await out(await post({ bidPackageId: BP, selectedPlanIds: ['p4', 'p2', 'p3', 'p1', 'p1'], projectName: 'Main St' }))
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toBe('private, no-store')
    expect(r.body).toMatchObject({ project_name: 'Main St', zip_name: 'ITB_Main_St.zip', total: 4, offset: 0, next_offset: null })
    // order: file name, then id — independent of selection order; duplicate names get _2
    expect(r.body.entries.map(e => e.name)).toEqual(['Documents/.._.._etc_passwd', 'Documents/Plans.pdf', 'Documents/Plans_2.pdf', 'Documents/R_sum_ (1).pdf'])
    expect(r.body.entries.every(e => !e.name.slice('Documents/'.length).includes('/'))).toBe(true)
    expect(r.body.entries[1].url).toBe(`https://signed/bid-plans/${BP}/p1-Plans.pdf`)
    expect(r.body.readme_text).toMatch(/Project: Main St[\s\S]*4 project file\(s\)/)
    expect(mockState.storageCalls.filter(c => c.op === 'download')).toEqual([])
    expect(signs().every(c => c.bucket === 'bid-plans')).toBe(true)
    const src = fs.readFileSync(path.join(__dirname, '../app/api/itb-export/route.js'), 'utf8')
    expect(src).not.toMatch(/zip-builder|buildZip|\.download\(|arrayBuffer/)
  })

  test('signing failure → 422 naming the files; no success manifest', async () => {
    as('principal')
    mockState.signedUrlResults = { 'bid-plans': p => (p.includes('p3') ? { signedUrl: null, error: 'Object not found' } : null) }
    const r = await out(await post({ bidPackageId: BP, selectedPlanIds: ['p1', 'p3'] }))
    expect(r.status).toBe(422)
    expect(r.body.error).toMatch(/R_sum_ \(1\)\.pdf/)
    expect(r.body.entries).toBeUndefined()
  })

  test('large selections page at 100, names stay globally unique, each page re-authorizes, offsets validated', async () => {
    mockState.db.bid_plans = Array.from({ length: 250 }, (_, i) => plan(`q${String(i).padStart(3, '0')}`, 'Sheet.pdf'))
    const ids = mockState.db.bid_plans.map(p => p.id)
    as('principal')
    const pages = []
    for (const offset of [0, 100, 200]) pages.push((await out(await post({ bidPackageId: BP, selectedPlanIds: ids, offset }))).body)
    expect(pages.map(p => p.entries.length)).toEqual([100, 100, 50])
    expect(pages.map(p => p.next_offset)).toEqual([100, 200, null])
    const names = pages.flatMap(p => p.entries.map(e => e.name))
    expect(new Set(names).size).toBe(250)
    expect(names[0]).toBe('Documents/Sheet.pdf')
    expect(names[249]).toBe('Documents/Sheet_250.pdf')
    expect(signs().every(c => c.path.length <= 100)).toBe(true)
    as('subcontractor')
    expect((await post({ bidPackageId: BP, selectedPlanIds: ids, offset: 100 })).status).toBe(403)
    as('principal')
    expect((await post({ bidPackageId: BP, selectedPlanIds: ids, offset: -1 })).status).toBe(400)
    expect((await post({ bidPackageId: BP, selectedPlanIds: ids, offset: 1.5 })).status).toBe(400)
  })
})

// ── export client ───────────────────────────────────────────────────────────
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('lib/export-client', () => {
  const entries = n => Array.from({ length: n }, (_, i) => ({ name: `Documents/f${i}.pdf`, url: `https://signed/f${i}` }))

  test('every file fetched with plain fetch semantics, bounded concurrency, results in order', async () => {
    let live = 0, peak = 0
    const fetchFn = jest.fn(async url => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 2)); live--; return new Response(url, { status: 200 }) })
    const files = await fetchEntries(entries(10), { fetchFn, concurrency: 3 })
    expect(files.map(f => f.name)).toEqual(entries(10).map(e => e.name))
    expect(await files[7].blob.text()).toBe('https://signed/f7')
    expect(peak).toBeLessThanOrEqual(3)
    for (const [, init] of fetchFn.mock.calls) expect(init.headers).toBeUndefined() // no portal Authorization on Storage links
  })

  test.each([
    ['expired link (400)', async () => new Response('{"message":"jwt expired"}', { status: 400, headers: { 'Content-Type': 'application/json' } }), /link expired or was refused/],
    ['refused (403)', async () => new Response('', { status: 403 }), /link expired or was refused/],
    ['HTTP 500', async () => new Response('<html>', { status: 500, headers: { 'Content-Type': 'text/html' } }), /failed \(500\)/],
    ['network error', async () => { throw new TypeError('Failed to fetch') }, /Could not reach/],
  ])('%s on one file → the whole export fails and nothing is saved', async (_l, bad, msg) => {
    const save = jest.fn()
    const fetchFn = async url => (url.endsWith('f3') ? bad() : new Response('ok', { status: 200 }))
    await expect(fetchEntries(entries(6), { fetchFn })).rejects.toThrow(msg)
    const manifest = jest.fn(async () => jsonRes({ project_name: 'P', zip_name: 'ITB_P.zip', total: 6, offset: 0, next_offset: null, readme_text: 'r', entries: entries(6) }))
    await expect(exportItbZip({ fetchFn: manifest, storageFetch: fetchFn, bidPackageId: 'b', selectedPlanIds: ['1'], itbHtml: '<x>', save })).rejects.toThrow(ExportError)
    expect(save).not.toHaveBeenCalled()
  })

  test('manifest errors (JSON 422, non-JSON 413 / 502, out-of-order, incomplete) abort before any file fetch', async () => {
    const storageFetch = jest.fn()
    const save = jest.fn()
    const run = manifest => exportItbZip({ fetchFn: manifest, storageFetch, bidPackageId: 'b', selectedPlanIds: ['1'], save })
    await expect(run(async () => jsonRes({ error: 'Could not prepare the following file: A.pdf. Export aborted.' }, 422))).rejects.toThrow(/A\.pdf/)
    await expect(run(async () => new Response('Request Entity Too Large', { status: 413, headers: { 'Content-Type': 'text/plain' } }))).rejects.toThrow(/too large/)
    await expect(run(async () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))).rejects.toThrow(/502/)
    await expect(run(async () => jsonRes({ total: 1, offset: 5, next_offset: null, entries: [] }))).rejects.toThrow(/out of order/)
    await expect(run(async () => jsonRes({ total: 2, offset: 0, next_offset: null, entries: entries(1) }))).rejects.toThrow(/incomplete/)
    expect(storageFetch).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  test('pages are requested with the same scope + offset only (cursor cannot widen scope)', async () => {
    const bodies = []
    const fetchFn = async (url, init) => { const b = JSON.parse(init.body); bodies.push(b); return jsonRes({ offset: b.offset, next_offset: b.offset === 0 ? 100 : null, total: 0, entries: [] }) }
    await fetchManifestPages(fetchFn, '/api/itb-export', { bidPackageId: 'b', selectedPlanIds: ['1', '2'] })
    expect(bodies).toEqual([{ bidPackageId: 'b', selectedPlanIds: ['1', '2'], offset: 0 }, { bidPackageId: 'b', selectedPlanIds: ['1', '2'], offset: 100 }])
  })

  test('owner export: a receipt row with no link aborts (never NO RECEIPT); >5 MB receipts build in the browser', async () => {
    const save = jest.fn()
    const rows = [{ num: '01', date: '—', vendor: '—', amount: '1.00', description: '', receipt: 'Receipts/01_nodate_novendor_1.00.pdf' }]
    await expect(exportOwnerReimbZip({ fetchFn: async () => jsonRes({ invoice_number: 'RI', zip_name: 'Reimb_RI.zip', total: 1, receipt_count: 1, offset: 0, next_offset: null, rows }), storageFetch: jest.fn(), invoiceId: 'i', invoiceHtml: '<x>', save })).rejects.toThrow(/receipt link was missing/)
    expect(save).not.toHaveBeenCalled()
    const big = new Uint8Array(6 * 1024 * 1024).fill(1)
    const ok = await exportOwnerReimbZip({
      fetchFn: async () => jsonRes({ invoice_number: 'RI', zip_name: 'Reimb_RI.zip', total: 1, receipt_count: 1, offset: 0, next_offset: null, rows: [{ ...rows[0], url: 'https://signed/r' }] }),
      storageFetch: async () => new Response(big, { status: 200 }), invoiceId: 'i', invoiceHtml: '<x>', save,
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(ok.zip.size).toBeGreaterThan(6 * 1024 * 1024)
  })
})
