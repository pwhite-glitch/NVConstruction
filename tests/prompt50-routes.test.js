/**
 * Prompt 50 route coverage (in-memory DB, no network, nothing real written):
 *  - /api/res-owner-draws (item 10): who may use it, job scoping, schedule validation,
 *    status rules, partial funding, migration-046-missing answers 409 (never false success).
 *  - /api/jobs/details (item 9): allow-listed fields, status spelling, archive rule, PM check.
 *  - /api/job-docs (item 4): canonical job_documents insert/delete; legacy job_docs read-only.
 */
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => ['subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator'].includes(r),
  }
})

const draws = require('../app/api/res-owner-draws/route')
const details = require('../app/api/jobs/details/route')
const docs = require('../app/api/job-docs/route')

const J1 = '11111111-1111-4111-8111-111111111111'
const J2 = '22222222-2222-4222-8222-222222222222'
const req = (method, url, body) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
const as = (role, extra = {}) => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null, ...extra } }
const json = async r => ({ status: r.status, body: await r.json() })

function seed() {
  resetMockState({
    jobs: [
      { id: J1, job_type: 'residential', status: 'active', archived: false, pm_email: 'pm@nv.com', project_name: 'NoLo', job_number: 'R-101' },
      { id: J2, job_type: 'residential', status: 'active', archived: true, pm_email: null, project_name: 'Stanley', job_number: '7554' },
    ],
    pm_job_assignments: [{ id: 'a1', job_id: J1, user_id: 'u-apm' }],
    budget_items: [
      { id: 'b1', job_id: J1, description: 'Framing', budget_amount: 900, owner_amount: 1000 },
      { id: 'bx', job_id: J2, description: 'Other job line', budget_amount: 1, owner_amount: 1 },
    ],
    draw_requests: [{ id: 'dr1', job_id: J1, draw_number: 7, title: 'Pkg 7' }, { id: 'drX', job_id: J2, draw_number: 9, title: 'Foreign' }],
    res_owner_draws: [
      { id: 'od-funded', job_id: J1, draw_number: 1, status: 'funded', amount_requested: 1000, amount_funded: null, funded_date: '2026-10-01' },
      { id: 'od-sub', job_id: J1, draw_number: 2, status: 'submitted', amount_requested: 500 },
      { id: 'od-draft', job_id: J1, draw_number: 3, status: 'draft', amount_requested: 100 },
    ],
    job_docs: [{ id: 'legacy1', job_id: J1, url: `${J1}/old.pdf`, name: 'old.pdf' }],
    job_documents: [{ id: 'doc1', job_id: J1, storage_path: `${J1}/permits/1-p.pdf`, file_name: 'p.pdf', category: 'permits', uploaded_at: '2026-11-01' }],
  })
}
beforeEach(seed)

describe('/api/res-owner-draws access', () => {
  test.each(['subcontractor', 'owner', 'roofing_rep', 'super'])('%s is refused', async role => {
    as(role)
    expect((await draws.GET(req('GET', `/api/res-owner-draws?job_id=${J1}`))).status).toBe(403)
  })
  test('APM on the job may read; APM not on the job is denied (data never returned)', async () => {
    as('apm')
    const ok = await json(await draws.GET(req('GET', `/api/res-owner-draws?job_id=${J1}`)))
    expect(ok.status).toBe(200)
    expect(ok.body.draws).toHaveLength(3)
    const no = await json(await draws.GET(req('GET', `/api/res-owner-draws?job_id=${J2}`)))
    expect(no.status).toBe(403)
    expect(no.body.draws).toBeUndefined()
  })
  test('PM by pm_email may act; foreign draw id is checked against its own job', async () => {
    as('pm')
    expect((await draws.GET(req('GET', `/api/res-owner-draws?job_id=${J1}`))).status).toBe(200)
    mockState.db.res_owner_draws.push({ id: 'od-j2', job_id: J2, draw_number: 1, status: 'draft', amount_requested: 1 })
    expect((await draws.DELETE(req('DELETE', '/api/res-owner-draws?id=od-j2'))).status).toBe(403)
    expect(mockState.db.res_owner_draws.find(d => d.id === 'od-j2')).toBeTruthy()
  })
})

describe('/api/res-owner-draws create / edit', () => {
  test('creates a draft with validated Bank lines and the next number', async () => {
    as('principal')
    const r = await json(await draws.POST(req('POST', '/api/res-owner-draws', { job_id: J1, amount_requested: 250, schedule_lines: [{ budget_item_id: 'b1', this_period: '250' }] })))
    expect(r.status).toBe(200)
    expect(r.body.draw).toMatchObject({ status: 'draft', draw_number: 4, amount_requested: 250, title: 'Draw #4' })
    expect(r.body.draw.schedule_lines).toEqual([{ budget_item_id: 'b1', description: 'Framing', scheduled_value: 1000, this_period: 250 }])
  })
  test('foreign budget line or mismatched total is rejected, nothing inserted', async () => {
    as('principal')
    const n = mockState.db.res_owner_draws.length
    expect((await draws.POST(req('POST', '/api/res-owner-draws', { job_id: J1, amount_requested: 1, schedule_lines: [{ budget_item_id: 'bx', this_period: 1 }] }))).status).toBe(400)
    expect((await draws.POST(req('POST', '/api/res-owner-draws', { job_id: J1, amount_requested: 300, schedule_lines: [{ budget_item_id: 'b1', this_period: 250 }] }))).status).toBe(400)
    expect((await draws.POST(req('POST', '/api/res-owner-draws', { job_id: J1, amount_requested: 'abc' }))).status).toBe(400)
    expect(mockState.db.res_owner_draws.length).toBe(n)
  })
  test('linked packaged Draw Request must be on the same job', async () => {
    as('principal')
    expect((await draws.POST(req('POST', '/api/res-owner-draws', { job_id: J1, amount_requested: 5, link_draw_request_id: 'drX' }))).status).toBe(400)
    const ok = await json(await draws.POST(req('POST', '/api/res-owner-draws', { job_id: J1, amount_requested: 5, link_draw_request_id: 'dr1' })))
    expect(ok.body.draw.draw_number).toBe(7)
  })
  test('submitted / funded draws keep their money (edit refused); draft edits allowed', async () => {
    as('pm')
    expect((await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-sub', action: 'edit', amount_requested: 1 }))).status).toBe(409)
    expect(mockState.db.res_owner_draws.find(d => d.id === 'od-sub').amount_requested).toBe(500)
    const ok = await json(await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-draft', action: 'edit', title: 'Draw 3b', amount_requested: 120 })))
    expect(ok.body.draw).toMatchObject({ title: 'Draw 3b', amount_requested: 120 })
  })
})

describe('/api/res-owner-draws funding and status', () => {
  test('partial funding: 500 requested / 400 received is stored as received', async () => {
    as('principal')
    const r = await json(await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-sub', action: 'fund', amount_funded: 400, funded_date: '2026-11-05' })))
    expect(r.status).toBe(200)
    expect(r.body.draw).toMatchObject({ status: 'funded', amount_funded: 400, amount_requested: 500, funded_date: '2026-11-05' })
  })
  test('legacy funded row: amount can be recorded later; requested never changes', async () => {
    as('principal')
    const r = await json(await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-funded', action: 'fund', amount_funded: 950 })))
    expect(r.body.draw).toMatchObject({ amount_funded: 950, amount_requested: 1000, funded_date: '2026-10-01' })
  })
  test('marking funded without an amount is refused; drafts cannot be funded', async () => {
    as('principal')
    expect((await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-sub', action: 'status', status: 'funded' }))).status).toBe(400)
    expect((await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-draft', action: 'fund', amount_funded: 1 }))).status).toBe(409)
  })
  test('void keeps the row; only drafts can be deleted', async () => {
    as('principal')
    expect((await draws.DELETE(req('DELETE', '/api/res-owner-draws?id=od-sub'))).status).toBe(409)
    expect((await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-sub', action: 'status', status: 'void' }))).status).toBe(200)
    expect(mockState.db.res_owner_draws.find(d => d.id === 'od-sub').status).toBe('void')
    expect((await draws.DELETE(req('DELETE', '/api/res-owner-draws?id=od-draft'))).status).toBe(200)
  })
  test('attachment must be in the draw folder', async () => {
    as('principal')
    expect((await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-sub', action: 'attach', path: `${J2}/owner-draws/od-sub/x.pdf` }))).status).toBe(400)
    const ok = await json(await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-sub', action: 'attach', path: `${J1}/owner-draws/od-sub/1-inv.pdf`, name: 'inv.pdf' })))
    expect(ok.body.draw.attachments).toEqual([expect.objectContaining({ path: `${J1}/owner-draws/od-sub/1-inv.pdf`, name: 'inv.pdf' })])
  })
})

describe('/api/res-owner-draws before migration 046', () => {
  beforeEach(() => { mockState.missingSelectCols = { res_owner_draws: ['amount_funded', 'schedule_lines', 'attachments'] } })
  test('GET reports not migrated; fund / void / lines / attach answer 409 and change nothing', async () => {
    as('principal')
    const g = await json(await draws.GET(req('GET', `/api/res-owner-draws?job_id=${J1}`)))
    expect(g.body.migrated).toBe(false)
    const before = JSON.stringify(mockState.db.res_owner_draws)
    for (const body of [
      { id: 'od-sub', action: 'fund', amount_funded: 400 },
      { id: 'od-sub', action: 'status', status: 'void' },
      { id: 'od-sub', action: 'attach', path: `${J1}/owner-draws/od-sub/a.pdf` },
      { id: 'od-draft', action: 'edit', schedule_lines: [{ budget_item_id: 'b1', this_period: 100 }] },
    ]) {
      const r = await json(await draws.PATCH(req('PATCH', '/api/res-owner-draws', body)))
      expect(r.status).toBe(409)
      expect(r.body.error).toMatch(/migration 046/)
    }
    expect(JSON.stringify(mockState.db.res_owner_draws)).toBe(before)
  })
  test('basic draft create and submit still work', async () => {
    as('principal')
    expect((await draws.POST(req('POST', '/api/res-owner-draws', { job_id: J1, amount_requested: 10 }))).status).toBe(200)
    expect((await draws.PATCH(req('PATCH', '/api/res-owner-draws', { id: 'od-draft', action: 'status', status: 'submitted' }))).status).toBe(200)
  })
})

describe('/api/jobs/details (item 9)', () => {
  test('only allow-listed fields are written; legacy on-hold spelling becomes on_hold', async () => {
    as('pm')
    const r = await json(await details.POST(req('POST', '/api/jobs/details', { id: J1, fields: { permit_number: 'BP-1', permit_date: '2026-10-01', status: 'on-hold', end_date: '2027-01-01', sqft: 2000, archived: true, job_type: 'commercial', sub_billing_frequency: 'monthly', sub_billing_due: 25 } })))
    expect(r.status).toBe(200)
    const call = mockState.calls.find(c => c.table === 'jobs' && c.op === 'update')
    expect(call.payload).toEqual({ permit_number: 'BP-1', permit_date: '2026-10-01', status: 'on_hold', sub_billing_frequency: 'monthly', sub_billing_due: 25 })
  })
  test('bad values are refused with a message (nothing written)', async () => {
    as('pm')
    for (const fields of [{ status: 'paused' }, { permit_date: 'yesterday' }, { contract_value: 'abc' }, { owner_billing_frequency: 'monthly', owner_billing_due: 40 }, { project_name: '' }]) {
      const r = await json(await details.POST(req('POST', '/api/jobs/details', { id: J1, fields })))
      expect(r.status).toBe(400)
      expect(r.body.error).toBeTruthy()
    }
    expect(mockState.calls.filter(c => c.table === 'jobs' && c.op === 'update')).toHaveLength(0)
  })
  test('archived job: non-Owner cannot change status; Owner setting Active unarchives', async () => {
    as('admin')
    expect((await details.POST(req('POST', '/api/jobs/details', { id: J2, fields: { status: 'active' } }))).status).toBe(200) // unchanged status → no-op
    expect((await details.POST(req('POST', '/api/jobs/details', { id: J2, fields: { status: 'complete' } }))).status).toBe(400)
    mockState.db.jobs[1].status = 'complete'
    expect((await details.POST(req('POST', '/api/jobs/details', { id: J2, fields: { status: 'active' } }))).status).toBe(400)
    as('principal')
    const r = await json(await details.POST(req('POST', '/api/jobs/details', { id: J2, fields: { status: 'active' } })))
    expect(r.body).toMatchObject({ ok: true, unarchived: true })
    expect(mockState.db.jobs[1]).toMatchObject({ status: 'active', archived: false })
  })
  test('PM must be an Owner/PM/APM login; assignments are never touched', async () => {
    as('principal')
    mockState.authUsers = [{ id: 'u-sub', email: 'sub@x.com' }, { id: 'u-apm2', email: 'apm2@nv.com' }]
    mockState.db.profiles = [{ id: 'u-sub', role: 'subcontractor' }, { id: 'u-apm2', role: 'apm' }]
    expect((await details.POST(req('POST', '/api/jobs/details', { id: J1, fields: { pm_email: 'nobody@x.com' } }))).status).toBe(400)
    expect((await details.POST(req('POST', '/api/jobs/details', { id: J1, fields: { pm_email: 'sub@x.com' } }))).status).toBe(400)
    expect((await details.POST(req('POST', '/api/jobs/details', { id: J1, fields: { pm_email: 'APM2@nv.com' } }))).status).toBe(200)
    expect(mockState.db.jobs[0].pm_email).toBe('apm2@nv.com')
    expect(mockState.calls.some(c => c.table === 'pm_job_assignments')).toBe(false)
  })
  test('APM not on the job and non-office roles are refused', async () => {
    as('apm')
    expect((await details.POST(req('POST', '/api/jobs/details', { id: J2, fields: { permit_number: 'x' } }))).status).toBe(403)
    as('super')
    expect((await details.POST(req('POST', '/api/jobs/details', { id: J1, fields: { permit_number: 'x' } }))).status).toBe(403)
  })
})

describe('/api/job-docs canonical documents (item 4)', () => {
  test('GET include=documents returns job_documents plus the legacy row (read-only)', async () => {
    as('pm')
    const r = await json(await docs.GET(req('GET', `/api/job-docs?job_id=${J1}&include=documents`)))
    expect(r.body.documents.map(d => d.id)).toEqual(['doc1'])
    expect(r.body.data.map(d => d.id)).toEqual(['legacy1'])
  })
  test('insert-document: job-scoped path and known category only', async () => {
    as('pm')
    expect((await docs.POST(req('POST', '/api/job-docs', { action: 'insert-document', job_id: J1, storage_path: `${J2}/plans/x.pdf`, file_name: 'x.pdf', category: 'plans' }))).status).toBe(400)
    expect((await docs.POST(req('POST', '/api/job-docs', { action: 'insert-document', job_id: J1, storage_path: `${J1}/plans/x.pdf`, file_name: 'x.pdf', category: 'secret' }))).status).toBe(400)
    const ok = await json(await docs.POST(req('POST', '/api/job-docs', { action: 'insert-document', job_id: J1, storage_path: `${J1}/plans/x.pdf`, file_name: 'x.pdf', category: 'plans' })))
    expect(ok.body.document).toMatchObject({ job_id: J1, category: 'plans', uploaded_by: 'u-pm' })
    as('apm')
    expect((await docs.POST(req('POST', '/api/job-docs', { action: 'insert-document', job_id: J2, storage_path: `${J2}/plans/x.pdf`, file_name: 'x.pdf', category: 'plans' }))).status).toBe(403)
  })
  test('DELETE removes a job_documents row and its file; never a job_docs row', async () => {
    as('pm')
    expect((await docs.DELETE(req('DELETE', '/api/job-docs?id=legacy1'))).status).toBe(404)
    expect(mockState.db.job_docs).toHaveLength(1)
    expect((await docs.DELETE(req('DELETE', '/api/job-docs?id=doc1'))).status).toBe(200)
    expect(mockState.db.job_documents).toHaveLength(0)
    expect(mockState.calls).toContainEqual(expect.objectContaining({ table: 'storage:job-documents', op: 'remove', payload: [`${J1}/permits/1-p.pdf`] }))
  })
})
