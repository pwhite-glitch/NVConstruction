/**
 * 2026-11-06 morning list route guards:
 * manage-sub-user, register-company + sub-docs paths, customer-portal doc and
 * invite scope, sub-ratings validation, merge-companies Owner gate.
 */

let mockDb
let mockAuth
let mockStaffUser
let mockWrites
let mockRpcCalls
let mockRpcResult
let mockDeleteUserError
let mockSendResult
let mockSent

function mockQuery(table) {
  const filters = []
  let op = 'select'
  let head = false
  let payload = null
  const rows = () => (mockDb[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, payload)); mockWrites.push({ table, op, payload }); return { data: hit.map(r => ({ id: r.id })), error: null } }
    if (op === 'delete') { const gone = rows(); mockDb[table] = (mockDb[table] || []).filter(r => !gone.includes(r)); mockWrites.push({ table, op, ids: gone.map(r => r.id) }); return { data: null, error: null } }
    if (op === 'insert' || op === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map((p, i) => ({ id: p.id || `${table}-new-${(mockDb[table] || []).length + i}`, ...p }))
      mockDb[table] = [...(mockDb[table] || []), ...list]
      mockWrites.push({ table, op, payload })
      return { data: list, error: null }
    }
    const data = rows()
    return head ? { data: null, count: data.length, error: null } : { data, error: null }
  }
  const parseOr = expr => expr.split(',').map(part => {
    const [col, , ...rest] = part.split('.')
    const val = rest.join('.')
    return r => String(r[col]) === val
  })
  const q = {
    select: (cols, opts) => { if (opts?.head) head = true; return q },
    order: () => q, limit: () => q, range: () => q,
    eq: (c, v) => { if (!c.includes('->>')) filters.push(r => r[c] === v); return q },
    neq: (c, v) => { filters.push(r => r[c] !== v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    gte: () => q, lt: () => q, lte: () => q, not: () => q,
    ilike: (c, v) => { const plain = String(v).replace(/\\(.)/g, '$1').toLowerCase(); filters.push(r => String(r[c] ?? '').toLowerCase() === plain); return q },
    or: expr => { const fs = parseOr(expr); filters.push(r => fs.some(f => f(r))); return q },
    update: p => { op = 'update'; payload = p; return q },
    delete: () => { op = 'delete'; return q },
    insert: p => { op = 'insert'; payload = p; return q },
    upsert: p => { op = 'upsert'; payload = p; return q },
    single: () => Promise.resolve(run()).then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
    maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: t => mockQuery(t),
    rpc: async (name, args) => { mockRpcCalls.push({ name, args }); return mockRpcResult },
    auth: {
      getUser: async () => ({ data: { user: mockStaffUser }, error: mockStaffUser ? null : { message: 'no' } }),
      admin: {
        deleteUser: async () => ({ error: mockDeleteUserError }),
        getUserById: async id => ({ data: { user: { id, email: 'new@sub.co', created_at: new Date().toISOString() } }, error: null }),
      },
    },
    storage: { from: () => ({
      createSignedUrl: async path => ({ data: { signedUrl: 'https://signed/' + path }, error: null }),
      createSignedUploadUrl: async path => ({ data: { signedUrl: 'https://upload/' + path }, error: null }),
    }) },
  }),
}))
jest.mock('resend', () => ({ Resend: function () { return { emails: { send: async msg => { mockSent.push(msg); return mockSendResult } } } } }))
jest.mock('../lib/notify', () => ({ notify: async n => { mockSent.push({ notify: n }) } }))
jest.mock('../lib/server-auth', () => {
  const actual = jest.requireActual('../lib/server-auth')
  return {
    ...actual,
    requireAuth: async () => mockAuth,
    requirePM: async () => (actual.isPM(mockAuth.role) ? mockAuth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
  }
})
jest.mock('../lib/sub-access', () => ({ getSubContracts: async () => [] }))

const manageSubUser = require('../app/api/manage-sub-user/route')
const registerCompany = require('../app/api/register-company/route')
const subDocs = require('../app/api/sub-docs/route')
const customerPortal = require('../app/api/customer-portal/route')
const subRatings = require('../app/api/sub-ratings/route')
const mergeCompanies = require('../app/api/merge-companies/route')

const JOB = '8ae26b84-c4df-4a75-a466-48ee7bed9f0c'
const DIR = '0b8f0d4e-1111-4222-8333-944444444444'
const req = (method, body, url = 'http://x/api', headers = {}) => new Request(url, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
const as = (role, extra = {}) => { mockAuth = { userId: 'me', email: 'me@nv.co', role, error: null, ...extra } }
const json = async res => res.json()

beforeEach(() => {
  mockWrites = []
  mockRpcCalls = []
  mockSent = []
  mockRpcResult = { data: null, error: null }
  mockDeleteUserError = null
  mockSendResult = { data: { id: 're_1' }, error: null }
  mockStaffUser = null
  mockDb = {
    profiles: [
      { id: 'me', role: 'super' },
      { id: 'owner1', role: 'principal' },
      { id: 'owner2', role: 'principal' },
      { id: 'pm1', role: 'pm' },
      { id: 'sub1', role: 'subcontractor', company_id: 'co1', full_name: 'Sam' },
    ],
    companies: [{ id: 'co1', name: 'Acme Concrete' }],
    jobs: [{ id: JOB, pm_email: null }],
    pm_job_assignments: [],
    job_assignments: [],
    subcontracts: [],
    sub_directory: [],
    sub_ratings: [],
    sales_orders: [],
    sales_order_docs: [],
    customer_portal_access: [],
    sales_order_history: [],
    sales_order_updates: [],
    sales_email_log: [],
  }
})

// ── 1) manage-sub-user ───────────────────────────────────────────────────────
describe('manage-sub-user', () => {
  test('cannot set an office or Owner role (allow-list is sub roles only)', async () => {
    as('super')
    for (const role of ['principal', 'admin', 'pm', 'apm', 'super', 'owner', 'metal_rep']) {
      const res = await manageSubUser.PATCH(req('PATCH', { userId: 'sub1', role }))
      expect(res.status).toBe(400)
    }
    expect(mockWrites).toEqual([])
  })

  test('sub roles are allowed and only whitelisted fields are written', async () => {
    as('apm')
    const res = await manageSubUser.PATCH(req('PATCH', { userId: 'sub1', role: 'sub_pm', full_name: 'Sam B', can_bill: false, id: 'x' }))
    expect(res.status).toBe(200)
    expect(mockWrites).toEqual([{ table: 'profiles', op: 'update', payload: { full_name: 'Sam B', role: 'sub_pm' } }])
  })

  test('non-sub targets are refused (403) for PATCH and DELETE', async () => {
    as('super')
    for (const userId of ['owner1', 'pm1']) {
      expect((await manageSubUser.PATCH(req('PATCH', { userId, full_name: 'x' }))).status).toBe(403)
      expect((await manageSubUser.DELETE(req('DELETE', { userId }))).status).toBe(403)
    }
    expect(mockWrites).toEqual([])
  })

  test('cannot delete yourself', async () => {
    as('super', { userId: 'sub1' })
    expect((await manageSubUser.DELETE(req('DELETE', { userId: 'sub1' }))).status).toBe(403)
    expect(mockWrites).toEqual([])
  })

  test('deletes profile + login; restores profile when the login delete fails', async () => {
    as('pm')
    mockDeleteUserError = { message: 'boom' }
    const res = await manageSubUser.DELETE(req('DELETE', { userId: 'sub1' }))
    expect(res.status).toBe(500)
    expect(mockDb.profiles.find(p => p.id === 'sub1')).toBeTruthy()
    mockDeleteUserError = null
    expect((await manageSubUser.DELETE(req('DELETE', { userId: 'sub1' }))).status).toBe(200)
    expect(mockDb.profiles.find(p => p.id === 'sub1')).toBeFalsy()
  })

  test('company name lookup escapes LIKE wildcards', async () => {
    as('pm')
    mockDb.companies.push({ id: 'co2', name: 'A_B' })
    await manageSubUser.PATCH(req('PATCH', { userId: 'sub1', company_name: 'A%B' }))
    expect(mockWrites[0].payload.company_id).toBeUndefined()
  })
})

// ── 3) register-company + sub-docs ───────────────────────────────────────────
describe('register-company', () => {
  test('ignores browser w9_url / coi_url, inserts pending, returns directory id, notifies office', async () => {
    const res = await registerCompany.POST(req('POST', {
      user_id: 'u-new', email: 'new@sub.co', company_name: 'New Sub LLC', w9_url: `${DIR}/someone-elses.pdf`, coi_url: 'w9/x.pdf',
    }))
    const body = await json(res)
    expect(res.status).toBe(200)
    const dirInsert = mockWrites.find(w => w.table === 'sub_directory' && w.op === 'insert').payload
    expect(dirInsert.status).toBe('pending')
    expect(dirInsert).not.toHaveProperty('w9_url')
    expect(dirInsert).not.toHaveProperty('coi_url')
    expect(body.directory_id).toBeTruthy()
    expect(mockSent.some(m => /New sub application/.test(m.subject || ''))).toBe(true)
  })

  test('registration still succeeds when the office email fails', async () => {
    mockSendResult = { data: null, error: { message: 'resend down' } }
    const res = await registerCompany.POST(req('POST', { user_id: 'u-new', email: 'new@sub.co', company_name: 'Other Sub' }))
    expect(res.status).toBe(200)
  })
})

describe('sub-docs path ownership', () => {
  beforeEach(() => {
    as('subcontractor', { email: 'sub@co.co', userId: 'sub1' })
    mockDb.sub_directory = [{ id: DIR, email: 'sub@co.co', w9_url: 'w9/legacy.pdf', coi_url: null }]
  })
  test('signed-url refuses a path that is not under <dir.id>/ (even the stored w9_url)', async () => {
    expect((await subDocs.POST(req('POST', { action: 'signed-url', file_path: 'w9/legacy.pdf' }))).status).toBe(403)
    expect((await subDocs.POST(req('POST', { action: 'signed-url', file_path: 'other-dir/x.pdf' }))).status).toBe(403)
    expect((await subDocs.POST(req('POST', { action: 'upload-url', path: `${DIR}/../x.pdf` }))).status).toBe(403)
  })
  test('paths under <dir.id>/ are allowed', async () => {
    expect((await subDocs.POST(req('POST', { action: 'signed-url', file_path: `${DIR}/w9.pdf` }))).status).toBe(200)
    expect((await subDocs.POST(req('POST', { action: 'upload-url', path: `${DIR}/1_w9_w9.pdf` }))).status).toBe(200)
  })
})

// ── 4) customer-portal ───────────────────────────────────────────────────────
describe('customer-portal', () => {
  const ORDER = 'order-1', OTHER = 'order-2'
  beforeEach(() => {
    mockDb.customer_portal_access = [{ id: 'acc1', order_id: ORDER, email: 'c@x.co', name: 'Cust', access_token: 'tok', revoked_at: null }]
    mockDb.sales_orders = [
      { id: ORDER, order_number: 'MB-1', salesperson_id: 'rep1', ops_owner_id: 'ops1', salesperson_name: 'Rep' },
      { id: OTHER, order_number: 'MB-2', salesperson_id: 'rep2', ops_owner_id: null },
    ]
    mockDb.sales_order_docs = [
      { id: 'd1', order_id: ORDER, storage_path: `${ORDER}/1_quote.pdf`, visible_to_customer: true },
      { id: 'd2', order_id: ORDER, storage_path: `${ORDER}/2_internal.pdf`, visible_to_customer: false },
      { id: 'd3', order_id: OTHER, storage_path: `${OTHER}/3_quote.pdf`, visible_to_customer: true },
    ]
    mockDb.profiles.push({ id: 'rep1', role: 'metal_rep', invite_email: 'rep1@nv.co' }, { id: 'rep2', role: 'metal_rep' }, { id: 'ops1', role: 'pm', invite_email: 'ops@nv.co' })
  })
  const get = q => customerPortal.GET(new Request(`http://x/api/customer-portal?token=tok&${q}`))

  test('signs only visible docs on the token’s own order', async () => {
    expect((await get(`doc_url=${encodeURIComponent(`${ORDER}/1_quote.pdf`)}`)).status).toBe(200)
    expect((await get('doc_id=d1')).status).toBe(200)
    expect((await get(`doc_url=${encodeURIComponent(`${ORDER}/2_internal.pdf`)}`)).status).toBe(404)
    expect((await get(`doc_url=${encodeURIComponent(`${OTHER}/3_quote.pdf`)}`)).status).toBe(404)
    expect((await get('doc_id=d3')).status).toBe(404)
    expect((await get('doc_url=anything/else.pdf')).status).toBe(404)
  })

  const staff = (id, body) => customerPortal.POST(req('POST', body, 'http://x/api', { authorization: 'Bearer t' }))
  test('a rep cannot invite / list / revoke on someone else’s order', async () => {
    mockStaffUser = { id: 'rep2' }
    expect((await staff('rep2', { action: 'invite', order_id: ORDER, email: 'a@b.co' })).status).toBe(403)
    expect((await staff('rep2', { action: 'list', order_id: ORDER })).status).toBe(403)
    expect((await staff('rep2', { action: 'revoke', id: 'acc1' })).status).toBe(403)
    expect(mockDb.customer_portal_access[0].revoked_at).toBeNull()
  })

  test('the order’s rep can invite; email escaped; log says sent after Resend accepts', async () => {
    mockStaffUser = { id: 'rep1' }
    const res = await staff('rep1', { action: 'invite', order_id: ORDER, email: 'new@cust.co', name: '<b>Bob</b>', inviter_name: '<i>x</i>' })
    const body = await json(res)
    expect(res.status).toBe(200)
    expect(body.email_status).toBe('sent')
    const msg = mockSent.find(m => m.to === 'new@cust.co')
    expect(msg.html).toContain('&lt;b&gt;Bob&lt;/b&gt;')
    expect(msg.html).not.toContain('<b>Bob</b>')
    expect(mockDb.sales_email_log.find(l => l.template === 'portal_invite').status).toBe('sent')
  })

  test('failed Resend logs failed, not sent', async () => {
    mockStaffUser = { id: 'ops1' }
    mockSendResult = { data: null, error: { message: 'domain not verified' } }
    const body = await json(await staff('ops1', { action: 'invite', order_id: ORDER, email: 'new@cust.co' }))
    expect(body.email_status).toBe('failed')
    expect(mockDb.sales_email_log.map(l => l.status)).toEqual(['failed'])
  })

  test('invite validates email format', async () => {
    mockStaffUser = { id: 'ops1' }
    expect((await staff('ops1', { action: 'invite', order_id: ORDER, email: 'not-an-email' })).status).toBe(400)
  })

  test('customer question notifies the salesperson and ops owner; long questions refused', async () => {
    const res = await customerPortal.POST(req('POST', { action: 'send_question', token: 'tok', access_id: 'acc1', body: 'When is delivery?' }))
    expect(res.status).toBe(200)
    expect(mockSent.filter(m => m.notify).map(m => m.notify.recipient_id).sort()).toEqual(['ops1', 'rep1'])
    expect(mockSent.find(m => Array.isArray(m.to))?.to.sort()).toEqual(['ops@nv.co', 'rep1@nv.co'])
    const long = await customerPortal.POST(req('POST', { action: 'send_question', token: 'tok', access_id: 'acc1', body: 'x'.repeat(2001) }))
    expect(long.status).toBe(400)
  })
})

// ── 7) sub-ratings ───────────────────────────────────────────────────────────
describe('sub-ratings POST', () => {
  beforeEach(() => {
    as('principal', { userId: 'owner1' })
    mockDb.job_assignments = [{ id: 'ja1', job_id: JOB, sub_id: 'sub1', company_id: null }]
  })
  const post = body => subRatings.POST(req('POST', { sub_id: 'sub1', job_id: JOB, ...body }))

  test('requires all three scores as integers 1–5', async () => {
    for (const bad of [
      { quality: 4 },
      { quality: 4, timeliness: 0, communication: 3 },
      { quality: 6, timeliness: 3, communication: 3 },
      { quality: 3.5, timeliness: 3, communication: 3 },
      { quality: '4', timeliness: 3, communication: 3 },
    ]) expect((await post(bad)).status).toBe(400)
    expect(mockWrites).toEqual([])
  })

  test('rated_by comes from the session, not the body', async () => {
    const res = await post({ quality: 5, timeliness: 4, communication: 3, rated_by: 'someone-else' })
    expect(res.status).toBe(200)
    expect(mockWrites[0].payload.rated_by).toBe('owner1')
  })

  test('refuses a sub who is not on the job', async () => {
    mockDb.job_assignments = []
    expect((await post({ quality: 5, timeliness: 4, communication: 3 })).status).toBe(400)
  })

  test('company-level assignment counts', async () => {
    mockDb.job_assignments = [{ id: 'ja2', job_id: JOB, sub_id: null, company_id: 'co1' }]
    expect((await post({ quality: 5, timeliness: 4, communication: 3 })).status).toBe(200)
  })
})

// ── 5) merge-companies ───────────────────────────────────────────────────────
describe('merge-companies', () => {
  test.each(['pm', 'apm', 'super', 'admin'])('%s is refused', async role => {
    as(role)
    const res = await mergeCompanies.POST(req('POST', { keep_company_id: 'a', remove_company_id: 'b' }))
    expect(res.status).toBe(403)
    expect(mockRpcCalls).toEqual([])
  })

  test('Owner runs the merge_companies RPC and gets the summary', async () => {
    as('principal')
    mockRpcResult = { data: { profiles_moved: 2, contacts_moved: 3, contacts_skipped_dup_email: 1, assignments_moved: 4, assignments_folded: 1, contracts_moved: 5, kept_name: 'Acme' }, error: null }
    const res = await mergeCompanies.POST(req('POST', { keep_company_id: 'a', remove_company_id: 'b' }))
    expect(mockRpcCalls).toEqual([{ name: 'merge_companies', args: { p_keep: 'a', p_remove: 'b' } }])
    expect(await json(res)).toEqual({ ok: true, profiles_moved: 2, contacts_moved: 3, contacts_skipped_dup_email: 1, assignments_moved: 4, assignments_folded: 1, contracts_moved: 5, kept: 'Acme' })
  })

  test('RPC error is surfaced (e.g. 043 not applied yet)', async () => {
    as('principal')
    mockRpcResult = { data: null, error: { message: 'function merge_companies does not exist' } }
    const res = await mergeCompanies.POST(req('POST', { keep_company_id: 'a', remove_company_id: 'b' }))
    expect(res.status).toBe(500)
    expect((await json(res)).error).toMatch(/does not exist/)
  })

  test('same company is refused', async () => {
    as('principal')
    expect((await mergeCompanies.POST(req('POST', { keep_company_id: 'a', remove_company_id: 'a' }))).status).toBe(400)
  })
})
