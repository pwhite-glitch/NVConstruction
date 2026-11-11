/**
 * Prompt 53 items 7 and 14 (in-memory DB, mocked auth/email/notify, nothing real written).
 *  7. /api/rfi-comments: author_name from the caller's profile, author_role from auth,
 *     job_id from the RFI itself (spoofed body values ignored); owner/job access checks;
 *     an owner comment notifies only that job's PM recipients; a failed insert sends no
 *     notification; a notification failure doesn't fail the saved comment. Owner page shows
 *     description/response and keeps the draft on failure; staff thread on job RFI cards.
 * 14. Commercial + field documents go through /api/job-docs (signed upload + insert-document,
 *     DELETE ?id=); every response checked; no direct client job_documents/storage writes;
 *     no field delete control; supers can't delete.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
  }
})
const mockNotifyRfiComment = jest.fn(async () => ({ ok: true }))
jest.mock('../lib/rfi-notify', () => ({ notifyRfiComment: (...a) => mockNotifyRfiComment(...a) }))

const comments = require('../app/api/rfi-comments/route')
const jobDocs = require('../app/api/job-docs/route')
const { uploadJobDocument, signedJobDocUrl, deleteJobDocument, jobDocPath } = require('../lib/job-doc-client')

const J1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const J2 = 'aaaaaaaa-0000-0000-0000-000000000002'
const req = (method, url, body) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const as = (role, extra = {}) => { mockState.auth = { userId: `u-${role}`, email: `${role}@client.com`, role, error: null, ...extra } }
const json = async r => ({ status: r.status, body: await r.json() })
const inserts = table => mockState.calls.filter(c => c.table === table && c.op === 'insert')

function seed() {
  resetMockState({
    jobs: [
      { id: J1, job_number: '7469', project_name: 'Braum Conway', pm_email: 'pm@nv.com', owner_email: 'owner@client.com' },
      { id: J2, job_number: '7470', project_name: 'Other', pm_email: 'pm2@nv.com', owner_email: 'someone@else.com' },
    ],
    rfis: [
      { id: 'rfi-1', job_id: J1, number: 3, title: 'Footing depth', description: 'How deep?', response: '36 in.' },
      { id: 'rfi-2', job_id: J2, number: 1, title: 'Other job RFI', description: 'x' },
    ],
    profiles: [
      { id: 'u-owner', full_name: 'Olivia Owner' },
      { id: 'u-pm', full_name: 'Pat PM' },
    ],
    pm_job_assignments: [{ id: 'a1', job_id: J1, user_id: 'u-pm' }, { id: 'a2', job_id: J1, user_id: 'u-super' }],
    rfi_comments: [],
    job_documents: [{ id: 'doc-1', job_id: J1, storage_path: `${J1}/plans/1-a.pdf`, file_name: 'a.pdf', category: 'plans' }],
    job_docs: [{ id: 'legacy-1', job_id: J1, url: 'old/path.pdf', name: 'old.pdf' }],
  })
  mockNotifyRfiComment.mockClear()
  mockNotifyRfiComment.mockImplementation(async () => ({ ok: true }))
}

beforeEach(seed)

describe('item 7 — POST /api/rfi-comments', () => {
  it('owner comment: author/role from auth+profile, job from the RFI; spoofed values ignored; PM notified', async () => {
    as('owner', { email: 'owner@client.com' })
    const r = await json(await comments.POST(req('POST', '/api/rfi-comments', {
      rfi_id: 'rfi-1', comment: '  Can we use 30in?  ', author_name: 'Fake PM', author_role: 'principal', job_id: J2,
    })))
    expect(r.status).toBe(200)
    const row = mockState.db.rfi_comments[0]
    expect(row).toMatchObject({ rfi_id: 'rfi-1', job_id: J1, author_name: 'Olivia Owner', author_role: 'owner', comment: 'Can we use 30in?' })
    expect(mockNotifyRfiComment).toHaveBeenCalledTimes(1)
    const arg = mockNotifyRfiComment.mock.calls[0][0]
    expect(arg.job.id).toBe(J1)
    expect(arg.rfi.id).toBe('rfi-1')
    expect(arg.author_name).toBe('Olivia Owner')
  })

  it("owner can't comment on another owner's job", async () => {
    as('owner', { email: 'owner@client.com' })
    const r = await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-2', comment: 'hi', job_id: J1 }))
    expect(r.status).toBe(403)
    expect(inserts('rfi_comments')).toHaveLength(0)
    expect(mockNotifyRfiComment).not.toHaveBeenCalled()
  })

  it('missing RFI → 404; RFI lookup error → 500; nothing inserted', async () => {
    as('owner', { email: 'owner@client.com' })
    expect((await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'nope', comment: 'x' }))).status).toBe(404)
    mockState.failSelect.rfis = 'db down'
    expect((await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-1', comment: 'x' }))).status).toBe(500)
    expect(inserts('rfi_comments')).toHaveLength(0)
  })

  it('unassigned super/PM denied; assigned PM can reply; staff replies notify nobody', async () => {
    as('super', { userId: 'u-other-super' })
    expect((await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-1', comment: 'x' }))).status).toBe(403)
    as('pm', { userId: 'u-pm2', email: 'pm9@nv.com' })
    expect((await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-1', comment: 'x' }))).status).toBe(403)
    as('pm', { userId: 'u-pm', email: 'pat@nv.com' })
    const r = await json(await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-1', comment: 'Yes, 30in ok', author_role: 'owner' })))
    expect(r.status).toBe(200)
    expect(r.body.comment).toMatchObject({ author_name: 'Pat PM', author_role: 'pm', job_id: J1 })
    expect(mockNotifyRfiComment).not.toHaveBeenCalled()
  })

  it('subs and other roles are refused', async () => {
    as('subcontractor')
    expect((await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-1', comment: 'x' }))).status).toBe(403)
  })

  it('failed insert → error and NO notification', async () => {
    as('owner', { email: 'owner@client.com' })
    mockState.missingCols.rfi_comments = ['author_name']
    const r = await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-1', comment: 'x' }))
    expect(r.status).toBe(500)
    expect(mockNotifyRfiComment).not.toHaveBeenCalled()
  })

  it('notification failure does not fail the saved comment (warning only)', async () => {
    as('owner', { email: 'owner@client.com' })
    mockNotifyRfiComment.mockImplementation(async () => { throw new Error('resend down') })
    const r = await json(await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-1', comment: 'x' })))
    expect(r.status).toBe(200)
    expect(r.body.comment.id).toBeTruthy()
    expect(r.body.notifyWarning).toMatch(/resend down/)
  })

  it('blank / missing comment rejected', async () => {
    as('owner', { email: 'owner@client.com' })
    expect((await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-1', comment: '   ' }))).status).toBe(400)
    expect((await comments.POST(req('POST', '/api/rfi-comments', { comment: 'x' }))).status).toBe(400)
  })
})

describe('item 7 — GET /api/rfi-comments', () => {
  beforeEach(() => {
    mockState.db.rfi_comments = [
      { id: 'c2', rfi_id: 'rfi-1', job_id: J1, comment: 'second', created_at: '2026-11-02' },
      { id: 'c1', rfi_id: 'rfi-1', job_id: J1, comment: 'first', created_at: '2026-11-01' },
      { id: 'c3', rfi_id: 'rfi-2', job_id: J2, comment: 'other', created_at: '2026-11-01' },
    ]
  })
  it('assigned staff read the thread for an RFI on their job only', async () => {
    as('super', { userId: 'u-super' })
    const r = await json(await comments.GET(req('GET', '/api/rfi-comments?rfi_id=rfi-1')))
    expect(r.status).toBe(200)
    expect(r.body.comments.map(c => c.id).sort()).toEqual(['c1', 'c2'])
    expect((await comments.GET(req('GET', '/api/rfi-comments?rfi_id=rfi-2'))).status).toBe(403)
  })
  it('owner of another job / mismatched job_id refused', async () => {
    as('owner', { email: 'owner@client.com' })
    expect((await comments.GET(req('GET', '/api/rfi-comments?rfi_id=rfi-2'))).status).toBe(403)
    expect((await comments.GET(req('GET', `/api/rfi-comments?rfi_id=rfi-1&job_id=${J2}`))).status).toBe(403)
    expect((await comments.GET(req('GET', '/api/rfi-comments?rfi_id=rfi-1'))).status).toBe(200)
  })
})

describe('item 7 — notifyRfiComment recipients (job PM only, escaped, deduplicated)', () => {
  let notifyRfiComment, mockNotify, mockSent
  beforeAll(() => {
    jest.isolateModules(() => {
      mockNotify = jest.fn(async () => {})
      mockSent = []
      jest.doMock('../lib/notify', () => ({ notify: (...a) => mockNotify(...a) }))
      jest.doMock('../lib/lookahead-recipients', () => ({ jobPmUserIds: async () => ['u-pm', 'u-pm', 'u-apm'] }))
      jest.doMock('resend', () => ({ Resend: function () { this.emails = { send: async m => { mockSent.push(m); return { data: { id: 'e' }, error: null } } } } }))
      notifyRfiComment = jest.requireActual('../lib/rfi-notify').notifyRfiComment
    })
  })
  it('bells each job PM once and emails pm_email + assigned PMs once, with escaped content', async () => {
    mockState.authUsers = []
    const res = await notifyRfiComment({
      rfi: { id: 'rfi-1', number: 3, title: 'Footing <b>' },
      job: { id: J1, job_number: '7469', project_name: 'Braum', pm_email: 'u-pm@x.com' },
      comment: '<script>alert(1)</script>', author_name: 'Olivia', author_user_id: 'u-owner',
    })
    expect(res.ok).toBe(true)
    expect(mockNotify.mock.calls.map(c => c[0].recipient_id).sort()).toEqual(['u-apm', 'u-pm'])
    // getUserById mock resolves "<id>@x.com"; pm_email duplicates u-pm's address → deduped
    const to = mockSent.map(m => m.to).sort()
    expect(to).toEqual(['u-apm@x.com', 'u-pm@x.com'])
    expect(mockSent[0].html).not.toContain('<script>')
    expect(mockSent[0].html).toContain('&lt;script&gt;')
    expect(mockSent[0].html).toContain('https://portal.nv.construction/jobdetail?id=')
  })
})

describe('item 7 — owner page + staff thread wiring', () => {
  const owner = fs.readFileSync(path.join(__dirname, '../app/owner/page.js'), 'utf8')
  const cJob = fs.readFileSync(path.join(__dirname, '../app/jobdetail/page.js'), 'utf8')
  const rJob = fs.readFileSync(path.join(__dirname, '../app/residentialjobdetail/page.js'), 'utf8')
  const thread = fs.readFileSync(path.join(__dirname, '../app/components/RfiCommentThread.js'), 'utf8')
  it('owner RFI detail renders description/response (not the nonexistent question/answer)', () => {
    expect(owner).toMatch(/rfi\.description/)
    expect(owner).toMatch(/rfi\.response/)
    expect(owner).not.toMatch(/rfi\.question|rfi\.answer/)
  })
  it('owner post sends only rfi_id/comment, checks res.ok, clears the draft only after success', () => {
    const fn = owner.slice(owner.indexOf('async function submitComment'), owner.indexOf('async function submitComment') + 2500)
    expect(fn).toMatch(/JSON\.stringify\(\{ rfi_id: rfiId, comment: text \}\)/)
    expect(fn).not.toMatch(/author_name|author_role|job_id/)
    const okCheck = fn.indexOf('!res.ok')
    const clear = fn.indexOf("setCommentDrafts(d => ({ ...d, [rfiId]: '' }))")
    expect(okCheck).toBeGreaterThan(0)
    expect(clear).toBeGreaterThan(okCheck)
  })
  it('commercial and residential job RFI cards render the staff thread (imported)', () => {
    expect(cJob).toMatch(/import RfiCommentThread from '\.\.\/components\/RfiCommentThread'/)
    expect(cJob).toMatch(/<RfiCommentThread rfiId=\{rfi\.id\}/)
    expect(rJob).toMatch(/import RfiCommentThread from '\.\.\/components\/RfiCommentThread'/)
    expect(rJob).toMatch(/<RfiCommentThread rfiId=\{r\.id\}/)
  })
  it('staff thread loads via the API, sorts chronologically, keeps the draft on failure', () => {
    expect(thread).toMatch(/\/api\/rfi-comments\?rfi_id=/)
    expect(thread).toMatch(/localeCompare/)
    const send = thread.slice(thread.indexOf('async function send'))
    expect(send.indexOf('if (r.error)')).toBeLessThan(send.indexOf("setDraft('')"))
  })
})

describe('item 14 — lib/job-doc-client', () => {
  const file = { name: 'Plan Set (A).pdf', type: 'application/pdf' }
  // Real Responses with a JSON Content-Type (prompt 78: lib/fetch-json reads status + type first).
  const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('upload: upload-url → PUT → insert-document, path under the job, record from server', async () => {
    const calls = []
    const fetchFn = jest.fn(async (url, opts) => {
      const body = JSON.parse(opts.body)
      calls.push(body.action)
      if (body.action === 'upload-url') return resp(200, { signedUrl: 'https://upload/x' })
      return resp(200, { ok: true, document: { id: 'new' } })
    })
    const putFn = jest.fn(async () => resp(200, {}))
    const out = await uploadJobDocument({ fetchFn, putFn, jobId: J1, category: 'plans', file, now: 5 })
    expect(calls).toEqual(['upload-url', 'insert-document'])
    expect(putFn).toHaveBeenCalledWith('https://upload/x', expect.objectContaining({ method: 'PUT', body: file }))
    const ins = JSON.parse(fetchFn.mock.calls[1][1].body)
    expect(ins).toEqual({ action: 'insert-document', job_id: J1, storage_path: jobDocPath(J1, 'plans', file.name, 5), file_name: file.name, category: 'plans' })
    expect(ins).not.toHaveProperty('uploaded_by')
    expect(out).toEqual({ uploaded: true, document: { id: 'new' } })
  })

  it('upload-url failure / PUT failure → error, nothing inserted', async () => {
    const f1 = jest.fn(async () => resp(403, { error: 'Not on this job' }))
    const o1 = await uploadJobDocument({ fetchFn: f1, putFn: jest.fn(), jobId: J1, category: 'plans', file })
    expect(o1.uploaded).toBe(false)
    expect(o1.error).toMatch(/Not on this job/)
    const f2 = jest.fn(async () => resp(200, { signedUrl: 'https://u' }))
    const o2 = await uploadJobDocument({ fetchFn: f2, putFn: async () => resp(400, { message: 'too big' }), jobId: J1, category: 'plans', file })
    expect(o2).toMatchObject({ uploaded: false })
    expect(o2.error).toMatch(/too big/)
    expect(f2).toHaveBeenCalledTimes(1)
  })

  it('insert-document failure is reported as "uploaded but record not saved", not success', async () => {
    const fetchFn = jest.fn(async (url, opts) => (JSON.parse(opts.body).action === 'upload-url' ? resp(200, { signedUrl: 'https://u' }) : resp(400, { error: 'Unknown document category.' })))
    const out = await uploadJobDocument({ fetchFn, putFn: async () => resp(200, {}), jobId: J1, category: 'plans', file })
    expect(out.uploaded).toBe(true)
    expect(out.error).toMatch(/File uploaded but the document record was not saved: Unknown document category/)
  })

  it('PUT succeeded, then insert-document THROWS → uploaded:true + "record not saved" with the reason', async () => {
    const fetchFn = jest.fn(async (url, opts) => {
      if (JSON.parse(opts.body).action === 'upload-url') return resp(200, { signedUrl: 'https://u' })
      throw new Error('Failed to fetch')
    })
    const putFn = jest.fn(async () => resp(200, {}))
    const out = await uploadJobDocument({ fetchFn, putFn, jobId: J1, category: 'plans', file })
    expect(putFn).toHaveBeenCalledTimes(1)
    expect(out.uploaded).toBe(true)
    expect(out.document).toBeUndefined()
    expect(out.error).toBe('File uploaded but the document record was not saved: Failed to fetch')
  })

  it('PUT itself throws → uploaded:false (file never reached storage)', async () => {
    const fetchFn = jest.fn(async () => resp(200, { signedUrl: 'https://u' }))
    const out = await uploadJobDocument({ fetchFn, putFn: async () => { throw new Error('offline') }, jobId: J1, category: 'plans', file })
    expect(out).toMatchObject({ uploaded: false })
    // prompt 78: a rejected storage PUT gives a concise network message (shared putToSignedUrl).
    expect(out.error).toMatch(/^Upload error: Upload failed: Could not reach the server/)
  })

  it('network exception → error, never success', async () => {
    const out = await uploadJobDocument({ fetchFn: async () => { throw new Error('offline') }, putFn: jest.fn(), jobId: J1, category: 'plans', file })
    expect(out).toMatchObject({ uploaded: false })
    expect(out.error).toMatch(/offline/)
  })

  it('signed URL: error / missing url reported', async () => {
    expect(await signedJobDocUrl({ fetchFn: async () => resp(200, { url: 'https://s' }), path: 'p' })).toEqual({ url: 'https://s' })
    expect((await signedJobDocUrl({ fetchFn: async () => resp(403, { error: 'Forbidden' }), path: 'p' })).error).toBe('Forbidden')
    expect((await signedJobDocUrl({ fetchFn: async () => resp(200, {}), path: 'p' })).error).toBeTruthy()
  })

  it('delete: DELETE ?id= with only the row id; warning and error surfaced', async () => {
    const fetchFn = jest.fn(async () => resp(200, { ok: true, warning: 'file could not be deleted' }))
    const out = await deleteJobDocument({ fetchFn, id: 'doc-1' })
    expect(fetchFn).toHaveBeenCalledWith('/api/job-docs?id=doc-1', { method: 'DELETE' })
    expect(out).toEqual({ ok: true, warning: 'file could not be deleted' })
    const bad = await deleteJobDocument({ fetchFn: async () => resp(403, { error: 'Forbidden' }), id: 'doc-1' })
    expect(bad.error).toBe('Forbidden')
  })
})

describe('item 14 — /api/job-docs server guards still hold', () => {
  it('super cannot delete; legacy job_docs untouched; PM delete removes the row and its file', async () => {
    as('super', { userId: 'u-super' })
    expect((await jobDocs.DELETE(req('DELETE', '/api/job-docs?id=doc-1'))).status).toBe(403)
    expect(mockState.db.job_documents).toHaveLength(1)
    as('principal')
    const r = await json(await jobDocs.DELETE(req('DELETE', '/api/job-docs?id=doc-1')))
    expect(r.status).toBe(200)
    expect(mockState.db.job_documents).toHaveLength(0)
    expect(mockState.calls.find(c => c.op === 'remove').payload).toEqual([`${J1}/plans/1-a.pdf`])
    expect(mockState.db.job_docs).toHaveLength(1)
    // a legacy job_docs id is not deletable here
    expect((await jobDocs.DELETE(req('DELETE', '/api/job-docs?id=legacy-1'))).status).toBe(404)
  })
  it('insert-document stamps uploaded_by from auth and rejects a path from another job', async () => {
    as('principal')
    const ok = await json(await jobDocs.POST(req('POST', '/api/job-docs', { action: 'insert-document', job_id: J1, storage_path: `${J1}/plans/2-b.pdf`, file_name: 'b.pdf', category: 'plans', uploaded_by: 'spoof' })))
    expect(ok.status).toBe(200)
    expect(ok.body.document.uploaded_by).toBe('u-principal')
    const bad = await jobDocs.POST(req('POST', '/api/job-docs', { action: 'insert-document', job_id: J1, storage_path: `${J2}/plans/x.pdf`, file_name: 'x.pdf', category: 'plans' }))
    expect(bad.status).toBe(400)
  })
})

describe('item 14 — commercial + field pages use the canonical API', () => {
  const cJob = fs.readFileSync(path.join(__dirname, '../app/jobdetail/page.js'), 'utf8')
  const field = fs.readFileSync(path.join(__dirname, '../app/field/page.js'), 'utf8')
  const direct = /from\('job_documents'\)\.(insert|delete|update)|from\('job-documents'\)\.(upload|remove)/
  it('no direct client job_documents writes or job-documents storage upload/remove', () => {
    expect(cJob).not.toMatch(direct)
    expect(field).not.toMatch(direct)
  })
  it('commercial upload/open/delete go through the shared client; delete hidden from supers', () => {
    expect(cJob).toMatch(/uploadJobDocument\(\{ fetchFn: authFetch/)
    expect(cJob).toMatch(/deleteJobDocument\(\{ fetchFn: authFetch, id: docId \}\)/)
    expect(cJob).toMatch(/userRole !== 'super' && <button style=\{s\.btnSmallRed\} onClick=\{\(\) => deleteJobDoc\(d\.id\)\}/)
    const open = cJob.slice(cJob.indexOf('async function openJobDoc'), cJob.indexOf('async function openJobDoc') + 400)
    expect(open.indexOf('openFile(')).toBeLessThan(open.indexOf('await signedJobDocUrl'))
  })
  it('field upload/open go through the API; no field document delete handler was added', () => {
    expect(field).toMatch(/uploadJobDocument\(\{ fetchFn: authFetch/)
    expect(field).toMatch(/signedJobDocUrl\(\{ fetchFn: authFetch/)
    expect(field).not.toMatch(/deleteJobDoc|deleteJobDocument/)
  })
})

// ── 53b D: narrow auth holes in routes this batch rewrote ──────────────────────
describe('53b D1 — /api/job-docs: every role must be on the job (supers included)', () => {
  const unassignedSuper = () => as('super', { userId: 'u-super-other', email: 'other-super@nv.com' })
  const post = body => jobDocs.POST(req('POST', '/api/job-docs', body))

  it('unassigned super denied on upload-url / signed-url / insert-document / insert-doc / GET list; nothing written', async () => {
    unassignedSuper()
    expect((await post({ action: 'upload-url', path: `${J1}/plans/9-x.pdf` })).status).toBe(403)
    expect((await post({ action: 'upload-url-residential', path: `${J1}/plans/9-x.pdf` })).status).toBe(403)
    expect((await post({ action: 'signed-url', path: `${J1}/plans/1-a.pdf` })).status).toBe(403)
    expect((await post({ action: 'insert-document', job_id: J1, storage_path: `${J1}/plans/9-x.pdf`, file_name: 'x.pdf', category: 'plans' })).status).toBe(403)
    expect((await post({ action: 'insert-doc', job_id: J1, url: `${J1}/plans/9-x.pdf`, name: 'x.pdf' })).status).toBe(403)
    expect((await jobDocs.GET(req('GET', `/api/job-docs?job_id=${J1}`))).status).toBe(403)
    expect((await jobDocs.GET(req('GET', `/api/job-docs?path=${encodeURIComponent(`${J1}/plans/1-a.pdf`)}`))).status).toBe(403)
    expect(inserts('job_documents')).toHaveLength(0)
    expect(inserts('job_docs')).toHaveLength(0)
  })

  it('assigned super can still upload / insert / sign on their job', async () => {
    as('super', { userId: 'u-super' })
    expect((await post({ action: 'upload-url', path: `${J1}/plans/9-x.pdf` })).status).toBe(200)
    expect((await post({ action: 'insert-document', job_id: J1, storage_path: `${J1}/plans/9-x.pdf`, file_name: 'x.pdf', category: 'plans' })).status).toBe(200)
    expect((await post({ action: 'signed-url', path: `${J1}/plans/1-a.pdf` })).status).toBe(200)
  })

  it('legacy path with no resolvable job fails closed (even for principal)', async () => {
    as('principal')
    expect((await post({ action: 'signed-url', path: 'nowhere/unknown.pdf' })).status).toBe(404)
  })

  it('DELETE: super still 403; unassigned PM 403 on the doc\'s real job; assigned PM ok', async () => {
    as('super', { userId: 'u-super' })
    expect((await jobDocs.DELETE(req('DELETE', '/api/job-docs?id=doc-1'))).status).toBe(403)
    as('pm', { userId: 'u-pm-other', email: 'nobody@nv.com' })
    expect((await jobDocs.DELETE(req('DELETE', '/api/job-docs?id=doc-1'))).status).toBe(403)
    expect(mockState.db.job_documents).toHaveLength(1)
    as('pm', { userId: 'u-pm', email: 'pat@nv.com' })
    expect((await jobDocs.DELETE(req('DELETE', '/api/job-docs?id=doc-1'))).status).toBe(200)
    expect(mockState.db.job_documents).toHaveLength(0)
  })
})

describe('53b D2 — DELETE /api/rfi-comments checks the comment\'s real job', () => {
  beforeEach(() => {
    mockState.db.rfi_comments = [
      { id: 'c1', rfi_id: 'rfi-1', job_id: J1, comment: 'J1 comment' },
      { id: 'c3', rfi_id: 'rfi-2', job_id: J2, comment: 'J2 comment' },
    ]
  })
  const del = id => comments.DELETE(req('DELETE', `/api/rfi-comments?id=${id}`))

  it('unassigned super cannot delete another job\'s comment', async () => {
    as('super', { userId: 'u-super' }) // assigned to J1 only
    expect((await del('c3')).status).toBe(403)
    expect(mockState.db.rfi_comments.map(c => c.id)).toContain('c3')
    expect(mockState.calls.filter(c => c.op === 'delete')).toHaveLength(0)
  })
  it('missing comment → 404; lookup error → 500; nothing deleted', async () => {
    as('principal')
    expect((await del('nope')).status).toBe(404)
    mockState.failSelect.rfi_comments = 'db down'
    expect((await del('c1')).status).toBe(500)
    expect(mockState.db.rfi_comments).toHaveLength(2)
  })
  it('assigned staff can delete on their job', async () => {
    as('super', { userId: 'u-super' })
    expect((await del('c1')).status).toBe(200)
    expect(mockState.db.rfi_comments.map(c => c.id)).toEqual(['c3'])
  })
})

describe('53b D3 — owner email with LIKE wildcards matches exactly', () => {
  it('"o_ner@client.com" / "%@client.com" do not match owner@client.com\'s job', async () => {
    for (const email of ['o_ner@client.com', '%@client.com', '%']) {
      as('owner', { email })
      expect((await comments.GET(req('GET', '/api/rfi-comments?rfi_id=rfi-1'))).status).toBe(403)
      expect((await comments.POST(req('POST', '/api/rfi-comments', { rfi_id: 'rfi-1', comment: 'x' }))).status).toBe(403)
    }
    expect(inserts('rfi_comments')).toHaveLength(0)
  })
  it('the real owner (any letter case / spaces) still matches', async () => {
    as('owner', { email: '  Owner@Client.com ' })
    expect((await comments.GET(req('GET', '/api/rfi-comments?rfi_id=rfi-1'))).status).toBe(200)
  })
  it('route uses the escaped helper, not raw ilike on auth.email', () => {
    const src = fs.readFileSync(path.join(__dirname, '../app/api/rfi-comments/route.js'), 'utf8')
    expect(src).not.toMatch(/ilike\('owner_email', auth\.email\)/)
    expect(src).toMatch(/ilike\('owner_email', ilikeExact\(email\)\)/)
  })
})
