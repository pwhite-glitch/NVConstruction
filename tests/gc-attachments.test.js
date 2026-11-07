/**
 * General Conditions attachments.
 *
 * Files are stored in the 'receipts' bucket under <job_id>/. A replace (PUT)
 * must file under the entry's own job_id from the DB, not a job_id in the
 * request. Signed URLs are issued only for the path stored on the entry, and
 * only after checking the caller can access that entry's job.
 */

let mockDb
let mockAuth
let mockUploads
let mockSigns
let mockUpdates

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
      }),
    },
  }),
}))
jest.mock('../lib/server-auth', () => ({
  requirePM: async () => mockAuth,
}))

const route = require('../app/api/general-conditions/route')

function seed() {
  mockUploads = []
  mockSigns = []
  mockUpdates = []
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

function multipartPut(data) {
  const fd = new FormData()
  fd.append('file', new File(['hello'], 'invoice.pdf', { type: 'application/pdf' }))
  fd.append('data', JSON.stringify(data))
  return new Request('http://localhost/api/general-conditions', { method: 'PUT', body: fd })
}

const signReq = qs => new Request(`http://localhost/api/general-conditions?${qs}`)

beforeEach(seed)

describe('PUT replace attachment', () => {
  test('files under the entry job_id from the DB when no job_id is sent', async () => {
    const res = await route.PUT(multipartPut({ id: 'gc-1', description: 'Dumpster' }))
    expect(res.status).toBe(200)
    expect(mockUploads).toHaveLength(1)
    expect(mockUploads[0].bucket).toBe('receipts')
    expect(mockUploads[0].path).toMatch(/^job-1\/\d+\.pdf$/)
    expect(mockDb.general_conditions[0].doc_url).toBe(mockUploads[0].path)
  })

  test('ignores a job_id in the request that differs from the entry', async () => {
    const res = await route.PUT(multipartPut({ id: 'gc-1', job_id: 'job-2' }))
    expect(res.status).toBe(200)
    expect(mockUploads[0].path).toMatch(/^job-1\//)
  })

  test('denied (no upload) for an entry on a job the user cannot access', async () => {
    const res = await route.PUT(multipartPut({ id: 'gc-2', job_id: 'job-1' }))
    expect(res.status).toBe(403)
    expect(mockUploads).toHaveLength(0)
    expect(mockUpdates).toHaveLength(0)
  })

  test('404 for an unknown entry', async () => {
    const res = await route.PUT(multipartPut({ id: 'nope' }))
    expect(res.status).toBe(404)
    expect(mockUploads).toHaveLength(0)
  })

  test('principal (all jobs) still uses the DB job_id', async () => {
    mockAuth = { userId: 'p1', role: 'principal', email: 'p@x.com', error: null }
    const res = await route.PUT(multipartPut({ id: 'gc-2' }))
    expect(res.status).toBe(200)
    expect(mockUploads[0].path).toMatch(/^job-2\//)
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
