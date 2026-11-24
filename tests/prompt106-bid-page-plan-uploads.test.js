/**
 * Prompt 106 — bid package page plan uploads / open / delete go through /api/bid-plan
 * (the bid-plans bucket and bid_plans table have no browser write policies), the route's
 * delete reports storage / DB errors, and EstimateWorkspace shows upload errors.
 * All DB access is the in-memory mock; nothing real is touched.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

// The shared mock's storage.remove never fails; wrap it so a test can make it fail.
jest.mock('@supabase/supabase-js', () => {
  const m = require('./helpers/mock-db')
  return {
    createClient: () => {
      const c = m.supabaseModule.createClient()
      return {
        ...c,
        storage: { from: bucket => {
          const s = c.storage.from(bucket)
          return { ...s, remove: async p => (m.mockState.failRemove ? { data: null, error: { message: m.mockState.failRemove } } : s.remove(p)) }
        } },
      }
    },
  }
})
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  return {
    requireAuth: async () => mockState.auth,
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
    PM_ROLES: PM,
    SUB_ROLES: SUB,
  }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const call = async (handler, body) => {
  const res = await handler(new Request('http://x/api/bid-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: res.status, body: await res.json() }
}

const BP = 'c684c508-1111-4222-8333-444455556666'

// ─────────────────────────────────────────────────────────────────────────────
describe('bid page source', () => {
  const page = read('app/bid/[id]/page.js')
  const helper = read('lib/bid-plan-upload.js')

  test('no direct browser bid-plans storage or bid_plans writes', () => {
    expect(page).not.toMatch(/storage\.from\(['"]bid-plans['"]\)/)
    expect(page).not.toMatch(/\.createSignedUrl\(/)
    expect(page).not.toMatch(/from\(['"]bid_plans['"]\)\.(insert|delete)/)
  })

  test('upload / open / delete go through /api/bid-plan via the helper', () => {
    expect(page).toMatch(/import \{[^}]*uploadBidPlan[^}]*\} from '..\/..\/..\/lib\/bid-plan-upload'/)
    expect(page).toMatch(/uploadBidPlan\(authFetch, fetch, bidId, file\)/)
    expect(page).toMatch(/bidPlanSignedUrl\(authFetch, path\)/)
    expect(page).toMatch(/deleteBidPlan\(authFetch, plan\.storage_path\)/)
    expect(page).toMatch(/openFile\(/)
    expect(helper).toMatch(/'\/api\/bid-plan'/)
    for (const a of ['upload-url', 'insert', 'signed-url', 'delete']) expect(helper).toContain(`action: '${a}'`)
    expect(helper).toMatch(/putToSignedUrl\(putFn/)
    expect(helper).toMatch(/safeFileName/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('lib/bid-plan-upload', () => {
  const { uploadBidPlan, bidPlanSignedUrl, deleteBidPlan, bidPlanPath } = require('../lib/bid-plan-upload')
  const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const file = { name: 'Plan 11.24.26.pdf', type: 'application/pdf', size: 10 }
  const now = () => 1795552532496

  test('path uses a safe file name under the package id', () => {
    expect(bidPlanPath(BP, 'Plan 11.24.26.pdf', 1)).toBe(`${BP}/1_Plan_11.24.26.pdf`)
  })

  test('calls upload-url → PUT → insert in order; insert keeps the original name', async () => {
    const order = []
    const fetchFn = jest.fn(async (url, init) => {
      const b = JSON.parse(init.body)
      order.push(`${url}:${b.action}`)
      if (b.action === 'upload-url') return resp(200, { signedUrl: 'https://upload/x' })
      return resp(200, { ok: true })
    })
    const putFn = jest.fn(async url => { order.push(`PUT ${url}`); return new Response('', { status: 200 }) })
    const r = await uploadBidPlan(fetchFn, putFn, BP, file, now)
    expect(r).toEqual({ ok: true, path: `${BP}/1795552532496_Plan_11.24.26.pdf` })
    expect(order).toEqual(['/api/bid-plan:upload-url', 'PUT https://upload/x', '/api/bid-plan:insert'])
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ action: 'upload-url', path: r.path })
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({ action: 'insert', bid_package_id: BP, file_name: 'Plan 11.24.26.pdf', storage_path: r.path })
  })

  test('returns the first error and stops', async () => {
    const putFn = jest.fn(async () => new Response('', { status: 200 }))
    let fetchFn = jest.fn(async () => resp(403, { error: 'Superintendents cannot change bid plans.' }))
    let r = await uploadBidPlan(fetchFn, putFn, BP, file, now)
    expect(r).toMatchObject({ ok: false, stage: 'url', error: 'Upload failed: Superintendents cannot change bid plans.' })
    expect(putFn).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)

    fetchFn = jest.fn(async () => resp(200, { signedUrl: 'https://upload/x' }))
    const badPut = jest.fn(async () => new Response('', { status: 400 }))
    r = await uploadBidPlan(fetchFn, badPut, BP, file, now)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('put')
    expect(r.error).toMatch(/^Upload failed \(400\)/)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    fetchFn = jest.fn(async (u, init) => (JSON.parse(init.body).action === 'upload-url' ? resp(200, { signedUrl: 'https://u' }) : resp(500, { error: 'insert boom' })))
    r = await uploadBidPlan(fetchFn, putFn, BP, file, now)
    expect(r).toMatchObject({ ok: false, stage: 'insert', error: 'Upload failed: insert boom' })
  })

  test('signed-url and delete', async () => {
    expect(await bidPlanSignedUrl(async () => resp(200, { url: 'https://signed/a' }), 'a')).toEqual({ ok: true, url: 'https://signed/a' })
    expect(await bidPlanSignedUrl(async () => resp(403, { error: 'Forbidden' }), 'a')).toEqual({ ok: false, error: 'Forbidden' })
    expect((await bidPlanSignedUrl(async () => resp(200, {}), 'a')).ok).toBe(false)
    expect(await deleteBidPlan(async () => resp(200, { ok: true }), 'a')).toEqual({ ok: true })
    expect(await deleteBidPlan(async () => resp(500, { error: 'rm boom' }), 'a')).toEqual({ ok: false, error: 'rm boom' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('/api/bid-plan route', () => {
  const plan = require('../app/api/bid-plan/route')
  const PATH = `${BP}/1795552532496_Plan_11.24.26.pdf`

  beforeEach(() => {
    resetMockState({
      bid_packages: [{ id: BP, title: 'Delta Energy', job_id: null, status: 'open', allowed_users: [] }],
      bid_plans: [{ id: 'pl1', bid_package_id: BP, file_name: 'old.pdf', storage_path: `${BP}/old.pdf` }],
      bid_invitations: [],
      pm_job_assignments: [],
      jobs: [],
    })
    mockState.failRemove = null
  })

  test('principal upload-url → 200 { signedUrl }', async () => {
    as('principal')
    const r = await call(plan.POST, { action: 'upload-url', path: PATH })
    expect(r.status).toBe(200)
    expect(r.body.signedUrl).toBe(`https://upload/${PATH}`)
  })

  test('super and sub upload-url → 403', async () => {
    as('super')
    expect((await call(plan.POST, { action: 'upload-url', path: PATH })).status).toBe(403)
    as('subcontractor')
    expect((await call(plan.POST, { action: 'upload-url', path: PATH })).status).toBe(403)
    expect(mockState.storageCalls.filter(c => c.op === 'createSignedUploadUrl')).toHaveLength(0)
  })

  test('upload-url with a bad path → 400', async () => {
    as('principal')
    for (const p of ['plans.pdf', `not-a-uuid/x.pdf`, `${BP}/../x.pdf`, `${BP}//x.pdf`, `${BP}/./x.pdf`, '']) {
      expect((await call(plan.POST, { action: 'upload-url', path: p })).status).toBe(400)
    }
    expect(mockState.storageCalls.filter(c => c.op === 'createSignedUploadUrl')).toHaveLength(0)
  })

  test('insert → 200 and the row is written', async () => {
    as('principal')
    const r = await call(plan.POST, { action: 'insert', bid_package_id: BP, file_name: 'Plan 11.24.26.pdf', storage_path: PATH })
    expect(r.status).toBe(200)
    expect(mockState.db.bid_plans.find(p => p.storage_path === PATH)).toMatchObject({ bid_package_id: BP, file_name: 'Plan 11.24.26.pdf' })
  })

  test('delete success → 200 and the row is gone', async () => {
    as('principal')
    const r = await call(plan.POST, { action: 'delete', path: `${BP}/old.pdf` })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect(mockState.db.bid_plans).toHaveLength(0)
  })

  test('delete with a storage error → 500 { error }, row kept', async () => {
    as('principal')
    mockState.failRemove = 'storage down'
    const r = await call(plan.POST, { action: 'delete', path: `${BP}/old.pdf` })
    expect(r.status).toBe(500)
    expect(r.body.error).toBe('storage down')
    expect(mockState.db.bid_plans).toHaveLength(1)
  })

  test('delete with a DB error → 500 { error }', async () => {
    as('principal')
    mockState.failWrite = { bid_plans: { delete: 'db down' } }
    const r = await call(plan.POST, { action: 'delete', path: `${BP}/old.pdf` })
    expect(r.status).toBe(500)
    expect(r.body.error).toBe('db down')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('EstimateWorkspace uploadDoc / deleteDoc', () => {
  const src = read('app/components/estimating/EstimateWorkspace.js')
  const fn = name => {
    const start = src.indexOf(`async function ${name}(`)
    const end = src.indexOf('\n  }\n', start)
    return src.slice(start, end)
  }

  test('uploadDoc checks upload and insert errors, alerts, and stops before insert on upload failure', () => {
    const up = fn('uploadDoc')
    expect(up).toMatch(/const \{ error: upErr \} = await supabase\.storage\.from\('estimate-docs'\)\.upload\(/)
    expect(up).toMatch(/if \(upErr\) \{ alert\('Upload failed: ' \+ upErr\.message\); return \}/)
    expect(up.indexOf('if (upErr)')).toBeLessThan(up.indexOf("from('estimate_docs').insert"))
    expect(up).toMatch(/const \{ error: dbErr \} = await supabase\.from\('estimate_docs'\)\.insert\(/)
    expect(up).toMatch(/alert\('Upload failed: ' \+ dbErr\.message\)/)
    expect(up).toMatch(/\.remove\(\[path\]\)/)
    expect(up).toMatch(/finally \{\s*setUploading\(false\)/)
  })

  test('deleteDoc checks errors', () => {
    const del = fn('deleteDoc')
    expect(del).toMatch(/if \(rmErr\) \{ alert\(/)
    expect(del).toMatch(/if \(dbErr\) \{ alert\(/)
  })
})
