/**
 * Prompt 49, item 7: lookahead Send back / resubmit / approve / send feedback.
 *
 * - Send back: office review only, note required and stored (PROPOSED columns, migration
 *   045), back to draft with approval / send flags cleared, bell notice to the original
 *   submitter. Before 045 it is refused (503) instead of saving without the note.
 * - Every submission gets its own dedup key (submitted_at), so a resubmit notifies again
 *   even while the earlier notice is unread.
 * - Approve and a SUCCESSFUL send notify the submitter; the reviewer never replaces the
 *   submitter. A super can't approve / send / send back / reset a reviewed lookahead.
 * - Activities are locked after submit (super) / approve (everyone) until sent back;
 *   the progress chip (status-only PUT) still works.
 * In-memory data only; Resend is mocked and its results are read.
 */
import { lookaheadTransitionError, activityLockError, isReturned, stageHistory, lookaheadStage } from '../lib/lookahead-fields'

const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({
  Resend: function () {
    const { mockState } = require('./helpers/mock-db')
    this.emails = { send: async msg => { (mockState.emails = mockState.emails || []).push(msg); return mockState.resendFail ? { error: { message: 'bounced' } } : { data: { id: 'e1' }, error: null } } }
  },
}))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: () => false,
  }
})
jest.mock('../lib/lookahead-recipients', () => {
  const { mockState } = require('./helpers/mock-db')
  return {
    jobPmUserIds: async () => ['pm1'],
    lookaheadSubRecipients: async () => mockState.subs || [],
  }
})

const route = require('../app/api/lookaheads/route')
const send = require('../app/api/lookaheads/send/route')
const acts = require('../app/api/lookahead-activities/route')
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const put = body => route.PUT(req('/api/lookaheads', 'PUT', body))
const la = () => mockState.db.lookaheads[0]
const notes = type => mockState.db.notifications.filter(n => !type || n.type === type)
const SUPER = { userId: 'super1', role: 'super', email: 's@x.com', error: null }
const PMU = { userId: 'pm1', role: 'pm', email: 'pm@x.com', error: null }

function seed(status = 'draft', extra = {}) {
  resetMockState({
    jobs: [{ id: 'J1', job_number: '101', project_name: 'Main', pm_email: null }],
    pm_job_assignments: [{ id: 'a', job_id: 'J1', user_id: 'pm1' }],
    profiles: [{ id: 'super1', full_name: 'Sam Super' }, { id: 'pm1', full_name: 'Pat PM' }],
    lookaheads: [{ id: 'LA1', job_id: 'J1', week_start_date: '2026-11-09', status, submitted_by: status === 'draft' ? null : 'super1', submitted_by_name: status === 'draft' ? null : 'Sam Super', submitted_at: status === 'draft' ? null : '2026-11-06T10:00:00.000Z', approved_at: null, approved_by: null, approved_by_name: null, sent_to_subs_at: null, sent_to_subs_by: null, sent_to_subs_by_name: null, sent_to_subs_recipients: null, returned_at: null, returned_by: null, returned_by_name: null, return_note: null, notes: null, ...extra }],
    lookahead_activities: [{ id: 'act1', lookahead_id: 'LA1', planned_date: '2026-11-10', description: 'Pour slab', status: 'not_started', sub_id: 'SC1', responsible_type: 'sub' }],
    notifications: [],
  })
  mockState.auth = SUPER
  mockState.emails = []
  mockState.resendFail = false
  mockState.subs = []
}

describe('transition rules (pure)', () => {
  test('who may do what from which stage', () => {
    expect(lookaheadTransitionError({ status: 'draft' }, 'submit', 'super')).toBeNull()
    expect(lookaheadTransitionError({ status: 'submitted' }, 'submit', 'super').status).toBe(409)
    expect(lookaheadTransitionError({ status: 'submitted' }, 'approve', 'super').status).toBe(403)
    expect(lookaheadTransitionError({ status: 'draft' }, 'approve', 'pm').status).toBe(409)
    expect(lookaheadTransitionError({ status: 'submitted' }, 'return', 'pm', { note: '  ' }).status).toBe(400)
    expect(lookaheadTransitionError({ status: 'approved' }, 'return', 'pm', { note: 'fix Tue' })).toBeNull()
    expect(lookaheadTransitionError({ status: 'approved' }, 'return', 'super', { note: 'x' }).status).toBe(403)
    expect(lookaheadTransitionError({ status: 'approved' }, 'draft', 'super').status).toBe(409)
    expect(lookaheadTransitionError({ status: 'approved' }, 'draft', 'pm').status).toBe(409)
  })
  test('activity locks', () => {
    expect(activityLockError({ status: 'draft' }, 'super', null)).toBeNull()
    expect(activityLockError({ status: 'submitted' }, 'super', { description: 'x' }).status).toBe(409)
    expect(activityLockError({ status: 'submitted' }, 'pm', { description: 'x' })).toBeNull()
    expect(activityLockError({ status: 'approved' }, 'pm', { description: 'x' }).status).toBe(409)
    expect(activityLockError({ status: 'approved' }, 'super', { status: 'done' })).toBeNull()
    expect(activityLockError({ status: 'approved' }, 'super', null).status).toBe(409)
  })
  test('derived Sent stage unchanged; returned shows in history', () => {
    expect(lookaheadStage({ status: 'approved', approved_at: '2026-11-06T10:00:00Z', sent_to_subs_at: '2026-11-06T11:00:00Z' })).toBe('sent')
    const r = { status: 'draft', submitted_at: '2026-11-06T10:00:00Z', returned_at: '2026-11-06T12:00:00Z', returned_by_name: 'Pat PM', return_note: 'Add inspections' }
    expect(isReturned(r)).toBe(true)
    expect(stageHistory(r).map(h => h.key)).toEqual(['submitted', 'returned'])
    expect(isReturned({ ...r, submitted_at: '2026-11-07T00:00:00Z' })).toBe(false)
  })
})

describe('Send back', () => {
  test('empty note refused, nothing changes', async () => {
    seed('submitted'); mockState.auth = PMU
    expect((await put({ id: 'LA1', action: 'return', note: '   ' })).status).toBe(400)
    expect(la().status).toBe('submitted')
  })
  test('super cannot send back', async () => {
    seed('submitted')
    expect((await put({ id: 'LA1', action: 'return', note: 'x' })).status).toBe(403)
  })
  test('PM sends back: note saved, draft again, approval / send cleared, submitter gets a bell with the note', async () => {
    seed('approved', { approved_at: '2026-11-06T11:00:00Z', approved_by: 'pm1', approved_by_name: 'Pat PM', sent_to_subs_at: '2026-11-06T12:00:00Z' })
    mockState.auth = PMU
    const res = await put({ id: 'LA1', action: 'return', note: 'Add the footing inspection on Tue' })
    expect(res.status).toBe(200)
    expect(la()).toMatchObject({ status: 'draft', return_note: 'Add the footing inspection on Tue', returned_by: 'pm1', returned_by_name: 'Pat PM', approved_at: null, approved_by: null, sent_to_subs_at: null, submitted_by: 'super1' })
    const n = notes('lookahead_returned')
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ recipient_id: 'super1' })
    expect(n[0].body).toMatch(/footing inspection/)
    expect(n[0].link).toMatch(/^\/field\?job=J1&tab=lookahead/)
  })
  test('before migration 045: refused with migration-required, nothing written', async () => {
    seed('submitted'); mockState.auth = PMU
    mockState.missingCols.lookaheads = ['approved_at', 'returned_at', 'returned_by', 'returned_by_name', 'return_note']
    const res = await put({ id: 'LA1', action: 'return', note: 'fix' })
    expect(res.status).toBe(503)
    expect(la().status).toBe('submitted')
    expect(notes()).toHaveLength(0)
  })
})

describe('submit / resubmit', () => {
  test('two valid submissions produce two events even while the first is unread', async () => {
    seed('draft')
    expect((await put({ id: 'LA1', status: 'submitted' })).status).toBe(200)
    const first = la().submitted_at
    mockState.auth = PMU
    expect((await put({ id: 'LA1', action: 'return', note: 'more detail' })).status).toBe(200)
    mockState.auth = SUPER
    await new Promise(r => setTimeout(r, 5))
    expect((await put({ id: 'LA1', status: 'submitted' })).status).toBe(200)
    const subs = notes('lookahead_submitted')
    expect(subs).toHaveLength(2)
    expect(subs[0].read_at).toBeUndefined()
    expect(new Set(subs.map(n => n.dedup_key)).size).toBe(2)
    expect(subs[1].dedup_key).toContain(la().submitted_at)
    expect(la().submitted_at).not.toBe(first)
  })
  test('submitting while already submitted / approved is refused', async () => {
    seed('submitted')
    expect((await put({ id: 'LA1', status: 'submitted' })).status).toBe(409)
    seed('approved')
    expect((await put({ id: 'LA1', status: 'submitted' })).status).toBe(409)
  })
  test('super cannot reset a reviewed lookahead to draft', async () => {
    seed('approved')
    expect((await put({ id: 'LA1', status: 'draft' })).status).toBe(409)
    expect(la().status).toBe('approved')
  })
  test('POST ignores a submitted_by in the body', async () => {
    seed('draft')
    mockState.db.lookaheads = []
    const res = await route.POST(req('/api/lookaheads', 'POST', { job_id: 'J1', week_start_date: '2026-11-16', submitted_by: 'forged' }))
    expect(res.status).toBe(200)
    expect(mockState.db.lookaheads[0].submitted_by).toBeUndefined()
  })
})

describe('approve', () => {
  test('notifies the submitter and keeps the submitter identity', async () => {
    seed('submitted'); mockState.auth = PMU
    expect((await put({ id: 'LA1', status: 'approved' })).status).toBe(200)
    expect(la()).toMatchObject({ status: 'approved', approved_by: 'pm1', submitted_by: 'super1', submitted_by_name: 'Sam Super' })
    expect(la().approved_at).toBeTruthy()
    expect(notes('lookahead_approved')).toEqual([expect.objectContaining({ recipient_id: 'super1' })])
  })
  test('super cannot approve; draft cannot be approved', async () => {
    seed('submitted')
    expect((await put({ id: 'LA1', status: 'approved' })).status).toBe(403)
    seed('draft'); mockState.auth = PMU
    expect((await put({ id: 'LA1', status: 'approved' })).status).toBe(409)
  })
  test('before 045 (approved_at missing) approval still saves, with a warning', async () => {
    seed('submitted'); mockState.auth = PMU
    mockState.missingCols.lookaheads = ['approved_at']
    const res = await put({ id: 'LA1', status: 'approved' })
    expect(res.status).toBe(200)
    expect((await res.json()).warning).toMatch(/approved_at.*045/)
    expect(la().status).toBe('approved')
  })
})

describe('send to subs', () => {
  const doSend = () => send.POST(req('/api/lookaheads/send', 'POST', { id: 'LA1' }))
  const sub = (emails, portal = false) => ({ contract_id: 'SC1', vendor_name: 'Acme', activities: [{ planned_date: '2026-11-10', description: 'Pour' }], people: emails.map((e, i) => ({ name: `P${i}`, email: e, portal, id: portal ? `u${i}` : null })) })

  test('successful send notifies the submitter and records the send', async () => {
    seed('approved', { approved_at: '2026-11-06T11:00:00Z' }); mockState.auth = PMU
    mockState.subs = [sub(['a@x.com'])]
    const res = await doSend()
    expect(res.status).toBe(200)
    expect(la().sent_to_subs_at).toBeTruthy()
    expect(notes('lookahead_sent_confirm')).toEqual([expect.objectContaining({ recipient_id: 'super1' })])
  })
  test('every email fails and no portal user: 502, not recorded as sent, no "sent" notice', async () => {
    seed('approved'); mockState.auth = PMU
    mockState.subs = [sub(['a@x.com'])]
    mockState.resendFail = true
    const res = await doSend()
    expect(res.status).toBe(502)
    expect(la().sent_to_subs_at).toBeNull()
    expect(notes('lookahead_sent_confirm')).toHaveLength(0)
  })
  test('partial failure is reported', async () => {
    seed('approved'); mockState.auth = PMU
    mockState.subs = [sub(['a@x.com'], true)]
    mockState.resendFail = true
    const res = await doSend()
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.warning).toMatch(/1 email failed \(a@x.com\)/)
    expect(out.failed_emails).toBe(1)
  })
  test('super cannot send; unapproved cannot be sent', async () => {
    seed('approved')
    expect((await doSend()).status).toBe(403)
    seed('submitted'); mockState.auth = PMU
    expect((await doSend()).status).toBe(400)
  })
})

describe('activities after review cannot silently change', () => {
  const add = () => acts.POST(req('/api/lookahead-activities', 'POST', { lookahead_id: 'LA1', planned_date: '2026-11-11', description: 'Frame' }))
  const edit = f => acts.PUT(req('/api/lookahead-activities', 'PUT', { id: 'act1', ...f }))
  const del = () => acts.DELETE(req('/api/lookahead-activities', 'DELETE', { id: 'act1' }))

  test('submitted: super locked out; PM reviewer can still adjust', async () => {
    seed('submitted')
    expect((await add()).status).toBe(409)
    expect((await edit({ description: 'Changed' })).status).toBe(409)
    expect((await del()).status).toBe(409)
    mockState.auth = PMU
    expect((await edit({ description: 'Changed by PM' })).status).toBe(200)
  })
  test('approved: nobody can add / edit / delete, progress chip still works', async () => {
    seed('approved'); mockState.auth = PMU
    expect((await add()).status).toBe(409)
    expect((await edit({ planned_date: '2026-11-12' })).status).toBe(409)
    expect((await del()).status).toBe(409)
    expect(mockState.db.lookahead_activities[0].description).toBe('Pour slab')
    mockState.auth = SUPER
    expect((await edit({ status: 'done' })).status).toBe(200)
    expect(mockState.db.lookahead_activities[0].status).toBe('done')
  })
  test('after send back (draft) the super can edit again', async () => {
    seed('draft', { returned_at: '2026-11-06T12:00:00Z', return_note: 'fix' })
    expect((await edit({ description: 'Fixed' })).status).toBe(200)
  })
})
