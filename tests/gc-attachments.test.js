/**
 * General Conditions attachments.
 *
 * Files are stored in the 'receipts' bucket under <job_id>/. A replace (PUT)
 * must file under the entry's own job_id from the DB, not a job_id in the
 * request. (Prompt 78: the file is uploaded directly to Storage; the PUT carries
 * attachment { path, uploadReceipt }, which must be for THIS entry on its DB job.) Signed URLs are issued only for the path stored on the entry, and
 * only after checking the caller can access that entry's job.
 */

let mockDb
let mockAuth
let mockUploads
let mockSigns
let mockUpdates
let mockInfo

function mockQuery(table) {
  const filters = []
  let op = 'select'
  let payload = null
  const rows = () => (mockDb[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (op === 'update') {
      const hit = rows()
      mockUpdates.push({ table, ids: hit.map(r => r.id), payload })
      hit.forEach(r => Object.assign(r, payload))
      return { data: hit.map(r => ({ id: r.id })), error: null }
    }
    return { data: rows(), error: null }
  }
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    ilike: (c, v) => { filters.push(r => String(r[c] ?? '').toLowerCase() === String(v).toLowerCase()); return q },
    update: p => { op = 'update'; payload = p; return q },
    maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: r.data?.[0] ?? null })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table => mockQuery(table),
    storage: {
      from: bucket => ({
        upload: async (path) => { mockUploads.push({ bucket, path }); return { data: { path }, error: null } },
        createSignedUrl: async (path, ttl) => { mockSigns.push({ bucket, path, ttl }); return { data: { signedUrl: `https://signed/${bucket}/${path}` }, error: null } },
        info: async (path) => (mockInfo[`${bucket}/${path}`] ? { data: mockInfo[`${bucket}/${path}`], error: null } : { data: null, error: { message: 'Object not found' } }),
      }),
    },
  }),
}))
jest.mock('../lib/server-auth', () => ({
  requirePM: async () => mockAuth,
}))

const route = require('../app/api/general-conditions/route')
const { mintUpload } = require('./helpers/upload-receipt')

function seed() {
  mockUploads = []
  mockSigns = []
  mockUpdates = []
  mockInfo = {}
  mockAuth = { userId: 'u1', role: 'pm', email: 'pm@x.com', error: null }
  mockDb = {
    jobs: [{ id: 'job-1', pm_email: null }, { id: 'job-2', pm_email: null }],
    pm_job_assignments: [{ job_id: 'job-1', user_id: 'u1' }],
    general_conditions: [
      { id: 'gc-1', job_id: 'job-1', description: 'Dumpster', amount: 100, doc_url: 'job-1/111.pdf' },
      { id: 'gc-2', job_id: 'job-2', description: 'Porta john', amount: 50, doc_url: 'job-2/222.pdf' },
      { id: 'gc-3', job_id: 'job-1', description: 'No file', amount: 10, doc_url: null },
    ],
  }
}

// A finished direct upload for this entry (receipt bound to user, entry, DB job, exact path).
async function uploaded(rec, job, subject = mockAuth.userId) {
  const up = await mintUpload({ target: 'gc-doc', subject, ctx: { job, rec }, name: 'invoice.pdf', size: 5 })
  mockInfo[`receipts/${up.path}`] = { size: 5, contentType: 'application/pdf' }
  return up
}
const jsonPut = data => new Request('http://localhost/api/general-conditions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

const signReq = qs => new Request(`http://localhost/api/general-conditions?${qs}`)

beforeEach(seed)

describe('PUT replace attachment', () => {
  test('files under the entry job_id from the DB when no job_id is sent', async () => {
    const up = await uploaded('gc-1', 'job-1')
    const res = await route.PUT(jsonPut({ id: 'gc-1', description: 'Dumpster', attachment: up.attachment }))
    expect(res.status).toBe(200)
    expect(mockUploads).toHaveLength(0) // bytes never pass through the route
    expect(up.path).toMatch(/^job-1\/[0-9a-f-]{36}_invoice\.pdf$/)
    expect(mockDb.general_conditions[0].doc_url).toBe(up.path)
  })

  test('ignores a job_id in the request that differs from the entry', async () => {
    const up = await uploaded('gc-1', 'job-1')
    const res = await route.PUT(jsonPut({ id: 'gc-1', job_id: 'job-2', attachment: up.attachment }))
    expect(res.status).toBe(200)
    expect(mockDb.general_conditions[0].doc_url).toMatch(/^job-1\//)
  })

  test('a receipt made for the body job_id (not the entry job) is refused', async () => {
    const up = await uploaded('gc-1', 'job-2')
    const res = await route.PUT(jsonPut({ id: 'gc-1', job_id: 'job-2', attachment: up.attachment }))
    expect(res.status).toBe(422)
    expect(mockDb.general_conditions[0].doc_url).toBe('job-1/111.pdf')
  })

  test('denied (nothing written) for an entry on a job the user cannot access', async () => {
    const up = await uploaded('gc-2', 'job-2')
    const res = await route.PUT(jsonPut({ id: 'gc-2', job_id: 'job-1', attachment: up.attachment }))
    expect(res.status).toBe(403)
    expect(mockUpdates).toHaveLength(0)
  })

  test('404 for an unknown entry', async () => {
    const up = await uploaded('nope', 'job-1')
    const res = await route.PUT(jsonPut({ id: 'nope', attachment: up.attachment }))
    expect(res.status).toBe(404)
  })

  test('principal (all jobs) still uses the DB job_id', async () => {
    mockAuth = { userId: 'p1', role: 'principal', email: 'p@x.com', error: null }
    const up = await uploaded('gc-2', 'job-2')
    const res = await route.PUT(jsonPut({ id: 'gc-2', attachment: up.attachment }))
    expect(res.status).toBe(200)
    expect(mockDb.general_conditions[1].doc_url).toMatch(/^job-2\//)
  })

  test('multipart is refused with 413 before any file is read; nothing written', async () => {
    const fd = new FormData()
    fd.append('file', new File(['hello'], 'invoice.pdf', { type: 'application/pdf' }))
    fd.append('data', JSON.stringify({ id: 'gc-1' }))
    const res = await route.PUT(new Request('http://localhost/api/general-conditions', { method: 'PUT', body: fd }))
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('direct_upload_required')
    expect(mockUploads).toHaveLength(0)
    expect(mockUpdates).toHaveLength(0)
  })
})

describe('GET signed attachment URL', () => {
  test('mockSigns the entry path from the receipts bucket', async () => {
    const res = await route.GET(signReq('doc_id=gc-1&path=job-1%2F111.pdf'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.url).toBe('https://signed/receipts/job-1/111.pdf')
    expect(mockSigns).toEqual([{ bucket: 'receipts', path: 'job-1/111.pdf', ttl: 3600 }])
  })

  test('denied for an entry on a job the user cannot access', async () => {
    const res = await route.GET(signReq('doc_id=gc-2&path=job-2%2F222.pdf'))
    expect(res.status).toBe(403)
    expect(mockSigns).toHaveLength(0)
  })

  test('path must match the entry (cannot sign another job\'s file via an accessible entry)', async () => {
    const res = await route.GET(signReq('doc_id=gc-1&path=job-2%2F222.pdf'))
    expect(res.status).toBe(403)
    expect(mockSigns).toHaveLength(0)
  })

  test('404 when the entry has no attachment or does not exist', async () => {
    expect((await route.GET(signReq('doc_id=gc-3'))).status).toBe(404)
    expect((await route.GET(signReq('doc_id=missing'))).status).toBe(404)
    expect(mockSigns).toHaveLength(0)
  })
})
