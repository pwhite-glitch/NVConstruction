/**
 * Prompt 88 — Weekly superintendent test. Supers answer ~10 multiple-choice questions a week.
 * Migration 077 (NOT applied) adds super_test_questions / super_test_answer_keys /
 * super_test_assignments / super_test_attempts. All DB access is the in-memory mock; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const forbid = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    requireAuth: async () => mockState.auth,
    requireRole: async (_req, roles) => (mockState.auth.error ? mockState.auth : roles.includes(mockState.auth.role) ? mockState.auth : forbid()),
  }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const as = (role, userId = `${role}1`) => { mockState.auth = { userId, role, email: `${userId}@x.com`, error: null } }
const asAnon = () => { mockState.auth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) } }
const jreq = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method = 'GET', body) => {
  const res = await handler(jreq(url, method, body))
  return { status: res.status, body: await res.json() }
}

const T = require('../lib/super-test')
const { buildSeedSql, loadQuestions } = require('../scripts/gen-super-test-seed')
const currentRoute = require('../app/api/super-test/current/route')
const submitRoute = require('../app/api/super-test/submit/route')
const questionsRoute = require('../app/api/super-test/admin/questions/route')
const statsRoute = require('../app/api/super-test/admin/stats/route')

const BANK = JSON.parse(read('data/super-test-questions.json'))
const KEY = Object.fromEntries(BANK.map(q => [q.id, q]))
const EXPLANATIONS = BANK.map(q => q.explanation)

const getCurrent = (qs = '') => call(currentRoute.GET, `/api/super-test/current${qs}`)
const submit = body => call(submitRoute.POST, '/api/super-test/submit', 'POST', body)

// Wed Nov 18 2026, noon Central → week of Mon Nov 16.
const NOW = Date.parse('2026-11-18T18:00:00Z')
const WEEK = '2026-11-16'
const FAKE = { doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick', 'performance', 'hrtime'] }

let keyReads = 0
function seed({ bank = BANK, extra = {} } = {}) {
  const keys = bank.map(q => ({ question_id: q.id, correct_index: q.correct_index, explanation: q.explanation }))
  resetMockState({
    super_test_questions: bank.map(q => ({ id: q.id, category: q.category, topic: q.topic, store: q.store, question: q.question, choices: [...q.choices], source: q.source, is_sample: !!q.sample, active: q.active !== false })),
    super_test_assignments: [],
    super_test_attempts: [],
    change_log: [],
    profiles: [],
    ...extra,
  })
  // Count every read of the answer-key table (the mock reads mockState.db[table] per query).
  keyReads = 0
  let keyRows = keys
  Object.defineProperty(mockState.db, 'super_test_answer_keys', {
    configurable: true, enumerable: true,
    get() { keyReads++; return keyRows },
    set(v) { keyRows = v },
  })
  mockState.unique = {
    super_test_assignments: [r => `${r.super_id}|${r.week_start}`],
    super_test_attempts: [r => `${r.super_id}|${r.week_start}`, r => r.assignment_id],
    super_test_questions: [r => r.id],
  }
}

beforeEach(() => {
  jest.useFakeTimers(FAKE)
  jest.setSystemTime(NOW)
  seed()
})
afterEach(() => jest.useRealTimers())

const allAnswers = (ids, wrong = []) => Object.fromEntries(ids.map(id => [id, wrong.includes(id) ? (KEY[id].correct_index + 1) % 4 : KEY[id].correct_index]))

// ── Week ─────────────────────────────────────────────────────────────────────
describe('week boundaries (America/Chicago)', () => {
  const ws = iso => T.weekStartCentral(new Date(iso))
  test('Mon 00:00 CT → that Monday; one ms earlier → previous Monday', () => {
    expect(ws('2026-11-16T06:00:00Z')).toBe('2026-11-16')
    expect(ws('2026-11-16T05:59:59.999Z')).toBe('2026-11-09')
  })
  test('Sun 23:59 CT → previous Monday', () => {
    expect(ws('2026-11-23T05:59:00Z')).toBe('2026-11-16')
  })
  test('Monday in UTC but still Sunday in Central → previous Monday', () => {
    expect(ws('2026-11-23T03:00:00Z')).toBe('2026-11-16')
  })
  test('DST weeks: 2026-03-08 (spring forward) and 2026-11-01 (fall back)', () => {
    expect(ws('2026-03-08T12:00:00Z')).toBe('2026-03-02')
    expect(ws('2026-03-09T04:59:00Z')).toBe('2026-03-02')
    expect(ws('2026-03-09T05:00:00Z')).toBe('2026-03-09')
    expect(ws('2026-11-01T12:00:00Z')).toBe('2026-10-26')
    expect(ws('2026-11-02T05:59:00Z')).toBe('2026-10-26')
    expect(ws('2026-11-02T06:00:00Z')).toBe('2026-11-02')
  })
  test('output is always a Monday; labels; isMonday', () => {
    for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2027-01-01T00:00:00Z'); t += 7 * 3600 * 1000) {
      expect(T.isMonday(T.weekStartCentral(new Date(t)))).toBe(true)
    }
    expect(T.weekLabel('2026-11-16')).toBe('Week of Nov 16, 2026')
    expect(T.isMonday('2026-11-17')).toBe(false)
    expect(T.isMonday('2026-02-30')).toBe(false)
    expect(T.isMonday('nope')).toBe(false)
  })
  test('hashKey is FNV-1a 32-bit unsigned', () => {
    expect(T.hashKey('')).toBe(0x811c9dc5)
    expect(T.hashKey('a')).toBe(0xe40c292c)
    expect(T.hashKey('foobar')).toBe(0xbf9cf968)
  })
})

// ── Rotation ─────────────────────────────────────────────────────────────────
const bankRows = BANK.map(q => ({ id: q.id, category: q.category, is_sample: !!q.sample, active: true }))
const cat = id => KEY[id]?.category
const weekN = (n, base = WEEK) => T.addDays(base, 7 * n)

describe('pickWeeklyQuestions', () => {
  test('deterministic; different super or week → different set', () => {
    const a = T.pickWeeklyQuestions({ superId: 'A', weekStart: WEEK, bank: bankRows })
    expect(T.pickWeeklyQuestions({ superId: 'A', weekStart: WEEK, bank: bankRows })).toEqual(a)
    const b = T.pickWeeklyQuestions({ superId: 'B', weekStart: WEEK, bank: bankRows })
    const c = T.pickWeeklyQuestions({ superId: 'A', weekStart: weekN(1), bank: bankRows })
    expect([...b].sort()).not.toEqual([...a].sort())
    expect([...c].sort()).not.toEqual([...a].sort())
  })

  test('7 braums + 3 general from the 80-question bank, no duplicates, only active', () => {
    const bank = bankRows.map(q => (['q11', 'q12', 'q13', 'q72'].includes(q.id) ? { ...q, active: false } : q))
    for (const sid of ['A', 'B', 'C', 'D']) {
      const ids = T.pickWeeklyQuestions({ superId: sid, weekStart: WEEK, bank })
      expect(ids).toHaveLength(10)
      expect(new Set(ids).size).toBe(10)
      expect(ids.filter(id => cat(id) === 'braums')).toHaveLength(7)
      expect(ids.filter(id => cat(id) === 'general')).toHaveLength(3)
      for (const id of ['q11', 'q12', 'q13', 'q72']) expect(ids).not.toContain(id)
    }
  })

  test('no repeats across 7 consecutive weeks (6-week window), then a 7+-week-old question can return', () => {
    const history = []
    const seen = new Set()
    for (let i = 0; i < 7; i++) {
      const weekStart = weekN(i)
      const recent = history.filter(h => h.week_start < weekStart && h.week_start >= T.addDays(weekStart, -42))
      const ids = T.pickWeeklyQuestions({ superId: 'S', weekStart, bank: bankRows, recent, isFirstWeek: i === 0 })
      for (const id of ids) { expect(seen.has(id)).toBe(false); seen.add(id) }
      history.push({ week_start: weekStart, question_ids: ids })
    }
    expect(seen.size).toBe(70)

    // Three disjoint groups of 10 (7 braums + 3 general each)
    const br = BANK.filter(q => q.category === 'braums').map(q => q.id)
    const gn = BANK.filter(q => q.category === 'general').map(q => q.id)
    const X = [...br.slice(0, 7), ...gn.slice(0, 3)]
    const Y = [...br.slice(7, 14), ...gn.slice(3, 6)]
    const Z = [...br.slice(14, 21), ...gn.slice(6, 9)]
    const bank = [...X, ...Y, ...Z].map(id => ({ id, category: cat(id), active: true }))
    const pick = recent => T.pickWeeklyQuestions({ superId: 'S', weekStart: WEEK, bank, recent })
    const at = (n, ids) => ({ week_start: T.addDays(WEEK, -7 * n), question_ids: ids })
    // X 7 weeks ago is outside the window: same as never seen.
    expect(pick([at(7, X), at(1, Y)])).toEqual(pick([at(1, Y)]))
    expect(pick([at(7, X), at(1, Y)]).some(id => X.includes(id))).toBe(true)
    // X 6 weeks ago is inside the window: only Z (fresh) is used.
    expect([...pick([at(6, X), at(1, Y)])].sort()).toEqual([...Z].sort())
  })

  test('short fresh pool fills with the oldest-seen first', () => {
    const br = BANK.filter(q => q.category === 'braums').map(q => q.id)
    const gn = BANK.filter(q => q.category === 'general').map(q => q.id)
    const X = [...br.slice(0, 7), ...gn.slice(0, 3)]
    const Y = [...br.slice(7, 14), ...gn.slice(3, 6)]
    const Zb = br.slice(14, 18) // only 4 fresh braums
    const Zg = gn.slice(6, 9)
    const bank = [...X, ...Y, ...Zb, ...Zg].map(id => ({ id, category: cat(id), active: true }))
    const recent = [{ week_start: T.addDays(WEEK, -14), question_ids: X }, { week_start: T.addDays(WEEK, -7), question_ids: Y }]
    const ids = T.pickWeeklyQuestions({ superId: 'S', weekStart: WEEK, bank, recent })
    expect(ids).toHaveLength(10)
    for (const id of [...Zb, ...Zg]) expect(ids).toContain(id)
    const filled = ids.filter(id => !Zb.includes(id) && !Zg.includes(id))
    expect(filled).toHaveLength(3)
    for (const id of filled) expect(X.slice(0, 7)).toContain(id) // oldest-seen braums, not last week's
  })

  test('category short → fills from the other category; bank < 10 → all active; empty → []', () => {
    const br = BANK.filter(q => q.category === 'braums').map(q => q.id)
    const gn = BANK.filter(q => q.category === 'general').map(q => q.id)
    const bank = [...br.slice(0, 2), ...gn.slice(0, 12)].map(id => ({ id, category: cat(id), active: true }))
    const ids = T.pickWeeklyQuestions({ superId: 'S', weekStart: WEEK, bank })
    expect(ids).toHaveLength(10)
    expect(ids.filter(id => cat(id) === 'braums')).toHaveLength(2)
    const small = bankRows.slice(20, 25)
    expect([...T.pickWeeklyQuestions({ superId: 'S', weekStart: WEEK, bank: small })].sort()).toEqual(small.map(q => q.id).sort())
    expect(T.pickWeeklyQuestions({ superId: 'S', weekStart: WEEK, bank: [] })).toEqual([])
  })

  test('first-ever week → q01–q10 in order; second week does not; sample needs all 10 active', () => {
    expect(T.pickWeeklyQuestions({ superId: 'S', weekStart: WEEK, bank: bankRows, isFirstWeek: true })).toEqual(T.SAMPLE_IDS)
    const second = T.pickWeeklyQuestions({ superId: 'S', weekStart: weekN(1), bank: bankRows, recent: [{ week_start: WEEK, question_ids: T.SAMPLE_IDS }], isFirstWeek: false })
    expect(second).not.toEqual(T.SAMPLE_IDS)
    for (const id of T.SAMPLE_IDS) expect(second).not.toContain(id)
    const noQ01 = bankRows.map(q => (q.id === 'q01' ? { ...q, active: false } : q))
    expect(T.pickWeeklyQuestions({ superId: 'S', weekStart: WEEK, bank: noQ01, isFirstWeek: true })).not.toEqual(T.SAMPLE_IDS)
  })
})

// ── Answer-key wall ──────────────────────────────────────────────────────────
describe('GET /api/super-test/current', () => {
  test('not submitted: no correct_index / explanation anywhere, no read of the answer-key table', async () => {
    as('super', 'S1')
    const r = await getCurrent()
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('in_progress')
    expect(r.body.week_start).toBe(WEEK)
    expect(r.body.week_label).toBe('Week of Nov 16, 2026')
    expect(r.body.questions.map(q => q.id)).toEqual(T.SAMPLE_IDS)
    const text = JSON.stringify(r.body)
    expect(text).not.toMatch(/correct_index/)
    expect(text).not.toMatch(/explanation/)
    for (const e of EXPLANATIONS) expect(text).not.toContain(JSON.stringify(e).slice(1, -1))
    expect(keyReads).toBe(0)
    expect(mockState.calls.some(c => c.table === 'super_test_answer_keys')).toBe(false)
  })

  test('?peek=1 creates nothing; reports not_started → in_progress → submitted', async () => {
    as('super', 'S1')
    let r = await getCurrent('?peek=1')
    expect(r.body).toEqual({ week_start: WEEK, week_label: 'Week of Nov 16, 2026', status: 'not_started' })
    expect(mockState.calls.filter(c => c.op === 'insert')).toHaveLength(0)
    expect(mockState.db.super_test_assignments).toHaveLength(0)
    await getCurrent()
    r = await getCurrent('?peek=1')
    expect(r.body.status).toBe('in_progress')
    await submit({ week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS, ['q01', 'q02']) })
    r = await getCurrent('?peek=1')
    expect(r.body).toMatchObject({ status: 'submitted', score: 8, total: 10 })
  })

  test('reload: identical ids/order, no second insert — even after a bank edit mid-week', async () => {
    as('super', 'S1')
    // Not first week, so the normal algorithm runs.
    mockState.db.super_test_assignments.push({ id: 'old', super_id: 'S1', week_start: '2026-11-09', question_ids: T.SAMPLE_IDS })
    const a = await getCurrent()
    const inserts = mockState.calls.filter(c => c.op === 'insert').length
    expect(inserts).toBe(1)
    mockState.db.super_test_questions.find(q => q.id === a.body.questions[0].id).active = false
    const b = await getCurrent()
    expect(b.body.questions.map(q => q.id)).toEqual(a.body.questions.map(q => q.id))
    expect(mockState.calls.filter(c => c.op === 'insert').length).toBe(inserts)
    expect(a.body.questions.filter(q => q.category === 'braums')).toHaveLength(7)
    for (const id of T.SAMPLE_IDS) expect(a.body.questions.map(q => q.id)).not.toContain(id)
  })

  test('race on assignment insert (23505) → returns the winner\'s row', async () => {
    as('super', 'S1')
    mockState.beforeWrite = (table, op) => {
      if (table === 'super_test_assignments' && op === 'insert' && !mockState.db.super_test_assignments.length) {
        mockState.db.super_test_assignments.push({ id: 'winner', super_id: 'S1', week_start: WEEK, question_ids: ['q20', 'q21'] })
      }
    }
    const r = await getCurrent()
    expect(r.status).toBe(200)
    expect(r.body.questions.map(q => q.id)).toEqual(['q20', 'q21'])
    expect(mockState.db.super_test_assignments).toHaveLength(1)
  })

  test('empty / all-inactive bank → no_questions; missing tables → migration_required 077', async () => {
    as('super', 'S1')
    for (const q of mockState.db.super_test_questions) q.active = false
    let r = await getCurrent()
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('no_questions')
    seed({ bank: [] })
    r = await getCurrent()
    expect(r.body.status).toBe('no_questions')
    mockState.failSelect = { super_test_assignments: 'relation "public.super_test_assignments" does not exist' }
    r = await getCurrent()
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ migration_required: '077' })
    r = await getCurrent('?peek=1')
    expect(r.body).toEqual({ migration_required: '077' })
  })

  test('peek: empty / all-inactive bank → no_questions (no "Not taken" nag); only peek=1 peeks', async () => {
    as('super', 'S1')
    for (const q of mockState.db.super_test_questions) q.active = false
    let r = await getCurrent('?peek=1')
    expect(r.body).toEqual({ week_start: WEEK, week_label: 'Week of Nov 16, 2026', status: 'no_questions' })
    seed({ bank: [] })
    r = await getCurrent('?peek=1')
    expect(r.body.status).toBe('no_questions')
    seed()
    r = await getCurrent('?peek=0')
    expect(r.body.status).toBe('in_progress')
    expect(r.body.questions).toHaveLength(10)
    const field = read('app/field/page.js')
    expect(field).toMatch(/superTestPeek\.status !== 'no_questions'/)
  })
})

// ── Submit ───────────────────────────────────────────────────────────────────
describe('POST /api/super-test/submit', () => {
  test('scores server-side, returns items with keys for exactly the assignment, ignores body super_id/score', async () => {
    as('super', 'S1')
    await getCurrent()
    const r = await submit({ week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS, ['q03', 'q09']), super_id: 'S2', score: 10, total: 10 })
    expect(r.status).toBe(200)
    expect(r.body.score).toBe(8)
    expect(r.body.total).toBe(10)
    expect(r.body.items.map(i => i.question_id)).toEqual(T.SAMPLE_IDS)
    for (const it of r.body.items) {
      expect(it.correct_index).toBe(KEY[it.question_id].correct_index)
      expect(it.explanation).toBe(KEY[it.question_id].explanation)
      expect(it.is_correct).toBe(!['q03', 'q09'].includes(it.question_id))
    }
    const rows = mockState.db.super_test_attempts
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ super_id: 'S1', week_start: WEEK, score: 8, total: 10 })
    // Now the current view shows the result
    const cur = await getCurrent()
    expect(cur.body.status).toBe('submitted')
    expect(cur.body.result.score).toBe(8)
    expect(cur.body.history).toEqual([{ week_start: WEEK, score: 8, total: 10 }])
  })

  test('double submit → 409, still one attempt; race (UNIQUE 23505) → 409 without keys', async () => {
    as('super', 'S1')
    await getCurrent()
    const body = { week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS) }
    expect((await submit(body)).status).toBe(200)
    const again = await submit(body)
    expect(again.status).toBe(409)
    expect(again.body.error).toBe("You already submitted this week's test.")
    expect(mockState.db.super_test_attempts).toHaveLength(1)

    // Race: a concurrent request's attempt lands between our pre-check and our insert.
    seed()
    as('super', 'S1')
    await getCurrent()
    mockState.beforeWrite = (table, op) => {
      if (table === 'super_test_attempts' && op === 'insert' && !mockState.db.super_test_attempts.length) {
        mockState.db.super_test_attempts.push({ id: 'other', assignment_id: 'x', super_id: 'S1', week_start: WEEK, score: 1, total: 10, answers: [] })
      }
    }
    const race = await submit(body)
    expect(race.status).toBe(409)
    const text = JSON.stringify(race.body)
    expect(text).not.toMatch(/correct_index|explanation/)
    expect(mockState.db.super_test_attempts).toHaveLength(1)
  })

  test('400 for missing / extra / non-integer / out-of-range answers', async () => {
    as('super', 'S1')
    await getCurrent()
    const good = allAnswers(T.SAMPLE_IDS)
    const { q05, ...missing } = good
    const cases = [
      missing,
      { ...good, q50: 1 },
      { ...good, q01: 1.5 },
      { ...good, q01: '1' },
      { ...good, q01: 4 },
      { ...good, q01: -1 },
      null,
      [1, 2, 3],
    ]
    for (const answers of cases) {
      const r = await submit({ week_start: WEEK, answers })
      expect(r.status).toBe(400)
    }
    expect(mockState.db.super_test_attempts).toHaveLength(0)
    expect(keyReads).toBe(0)
  })

  test('409 for past or future week_start; 404 when no assignment', async () => {
    as('super', 'S1')
    let r = await submit({ week_start: '2026-11-09', answers: allAnswers(T.SAMPLE_IDS) })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe("That week's test is closed.")
    r = await submit({ week_start: '2026-11-23', answers: allAnswers(T.SAMPLE_IDS) })
    expect(r.status).toBe(409)
    r = await submit({ week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS) })
    expect(r.status).toBe(404)
  })

  test('a page left open past Sunday midnight cannot submit last week', async () => {
    as('super', 'S1')
    await getCurrent()
    jest.setSystemTime(Date.parse('2026-11-23T06:00:00Z')) // Mon Nov 23 00:00 CT
    const r = await submit({ week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS) })
    expect(r.status).toBe(409)
  })
})

// ── Isolation / roles ────────────────────────────────────────────────────────
describe('isolation and roles', () => {
  test('super A cannot review a week only super B submitted; history is own only', async () => {
    as('super', 'B')
    await getCurrent()
    await submit({ week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS) })
    mockState.db.super_test_attempts.push({ id: 'b-old', assignment_id: 'ab', super_id: 'B', week_start: '2026-11-09', score: 7, total: 10, answers: [] })
    as('super', 'A')
    let r = await getCurrent('?week=2026-11-09')
    expect(r.status).toBe(404)
    expect(JSON.stringify(r.body)).not.toMatch(/"B"|score/)
    r = await getCurrent()
    expect(r.body.history).toEqual([])
    r = await getCurrent('?week=bad')
    expect(r.status).toBe(400)
    as('super', 'B')
    r = await getCurrent('?week=2026-11-09')
    expect(r.status).toBe(200)
    expect(r.body.result.score).toBe(7)
    expect(r.body.history.map(h => h.week_start)).toEqual([WEEK, '2026-11-09'])
  })

  test('current/submit: 403 for non-super roles, 401 anon', async () => {
    for (const role of ['pm', 'apm', 'principal', 'admin', 'owner', 'subcontractor']) {
      as(role)
      expect((await getCurrent()).status).toBe(403)
      expect((await getCurrent('?peek=1')).status).toBe(403)
      expect((await submit({ week_start: WEEK, answers: {} })).status).toBe(403)
    }
    asAnon()
    expect((await getCurrent()).status).toBe(401)
    asAnon()
    expect((await submit({ week_start: WEEK, answers: {} })).status).toBe(401)
    expect(mockState.calls).toHaveLength(0)
  })

  test('admin routes: 403 for super / pm / apm, 200 for principal and admin', async () => {
    for (const role of ['super', 'pm', 'apm', 'owner']) {
      as(role)
      expect((await call(statsRoute.GET, '/api/super-test/admin/stats')).status).toBe(403)
      expect((await call(questionsRoute.GET, '/api/super-test/admin/questions')).status).toBe(403)
      expect((await call(questionsRoute.POST, '/api/super-test/admin/questions', 'POST', {})).status).toBe(403)
      expect((await call(questionsRoute.PATCH, '/api/super-test/admin/questions', 'PATCH', { id: 'q01', active: false })).status).toBe(403)
    }
    expect(mockState.db.super_test_questions.find(q => q.id === 'q01').active).toBe(true)
    for (const role of T.SUPER_TEST_ADMIN_ROLES) {
      as(role)
      expect((await call(statsRoute.GET, '/api/super-test/admin/stats')).status).toBe(200)
      expect((await call(questionsRoute.GET, '/api/super-test/admin/questions')).status).toBe(200)
    }
    expect(T.SUPER_TEST_ADMIN_ROLES).toEqual(['principal', 'admin'])
  })
})

// ── Admin ────────────────────────────────────────────────────────────────────
describe('admin stats', () => {
  test('this_week statuses, score grid, topics; bots excluded', async () => {
    seed({ extra: { profiles: [
      { id: 'S1', role: 'super', full_name: 'Ann' },
      { id: 'S2', role: 'super', full_name: 'Bob' },
      { id: 'S3', role: 'super', full_name: 'Cy' },
      { id: 'BOT', role: 'super', full_name: 'Portal Bot', is_bot: true },
      { id: 'P1', role: 'pm', full_name: 'Pam' },
    ] } })
    as('super', 'S1'); await getCurrent(); await submit({ week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS, ['q01', 'q02']) })
    as('super', 'S2'); await getCurrent()
    mockState.db.super_test_attempts.push({ id: 'old', assignment_id: 'o', super_id: 'S2', week_start: '2026-11-09', score: 6, total: 10, answers: [
      { question_id: 'q01', topic: 'owner-furnished-scope', is_correct: false },
      { question_id: 'q08', topic: 'fall-protection', is_correct: false },
    ] })
    mockState.db.super_test_attempts.push({ id: 'ancient', assignment_id: 'z', super_id: 'S3', week_start: '2025-01-06', score: 0, total: 10, answers: [] })
    as('admin', 'AD')
    const r = await call(statsRoute.GET, '/api/super-test/admin/stats?weeks=4')
    expect(r.status).toBe(200)
    expect(r.body.current_week).toBe(WEEK)
    expect(r.body.weeks).toEqual(['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-26'])
    expect(r.body.supers.map(s => s.full_name)).toEqual(['Ann', 'Bob', 'Cy'])
    expect(r.body.this_week).toEqual([
      { super_id: 'S1', full_name: 'Ann', status: 'submitted', score: 8, total: 10 },
      { super_id: 'S2', full_name: 'Bob', status: 'opened' },
      { super_id: 'S3', full_name: 'Cy', status: 'not_started' },
    ])
    expect(r.body.scores).toEqual(expect.arrayContaining([
      { super_id: 'S1', week_start: WEEK, score: 8, total: 10 },
      { super_id: 'S2', week_start: '2026-11-09', score: 6, total: 10 },
    ]))
    expect(r.body.scores).toHaveLength(2)
    const owner = r.body.topics.find(t => t.topic === 'owner-furnished-scope')
    expect(owner).toEqual({ topic: 'owner-furnished-scope', missed: 2, answered: 2, missRate: 1 })
    expect(r.body.topics[0].topic).toBe('owner-furnished-scope')
    expect(T.parseStatsWeeks('99')).toBe(26)
    expect(T.parseStatsWeeks('0')).toBe(1)
    expect(T.parseStatsWeeks(null)).toBe(8)
  })

  test('topics and scores leave out attempts by former supers and bots', async () => {
    seed({ extra: { profiles: [
      { id: 'S1', role: 'super', full_name: 'Ann' },
      { id: 'EX', role: 'pm', full_name: 'Former Super' },
      { id: 'BOT', role: 'super', full_name: 'Portal Bot', is_bot: true },
    ] } })
    const miss = topic => [{ question_id: 'q01', topic, is_correct: false }]
    mockState.db.super_test_attempts.push(
      { id: 'a1', assignment_id: 'x1', super_id: 'S1', week_start: WEEK, score: 9, total: 10, answers: miss('mine') },
      { id: 'a2', assignment_id: 'x2', super_id: 'EX', week_start: WEEK, score: 0, total: 10, answers: miss('former') },
      { id: 'a3', assignment_id: 'x3', super_id: 'BOT', week_start: WEEK, score: 0, total: 10, answers: miss('bot') },
    )
    as('principal', 'P')
    const r = await call(statsRoute.GET, '/api/super-test/admin/stats?weeks=2')
    expect(r.body.topics.map(t => t.topic)).toEqual(['mine'])
    expect(r.body.scores.map(x => x.super_id)).toEqual(['S1'])
  })

  test('missedTopics math and sort', () => {
    const at = items => ({ answers: items.map(([topic, ok]) => ({ topic, is_correct: ok })) })
    const out = T.missedTopics([
      at([['b', false], ['b', true], ['a', false], ['c', false], ['c', false]]),
      at([['a', false], ['d', true], ['e', false], ['e', true], ['e', true]]),
    ])
    expect(out).toEqual([
      { topic: 'a', missed: 2, answered: 2, missRate: 1 },
      { topic: 'c', missed: 2, answered: 2, missRate: 1 },
      { topic: 'b', missed: 1, answered: 2, missRate: 0.5 },
      { topic: 'e', missed: 1, answered: 3, missRate: 1 / 3 },
      { topic: 'd', missed: 0, answered: 1, missRate: 0 },
    ])
  })
})

describe('admin questions', () => {
  const valid = { category: 'general', topic: 'Ladders', store: '', question: 'Which side of a step ladder may you climb?', choices: ['Front only', 'Back only', 'Either side', 'Neither'], correct_index: 0, explanation: 'Step ladders are climbed from the front unless rated for both sides.', source: 'general practice' }
  const post = body => call(questionsRoute.POST, '/api/super-test/admin/questions', 'POST', body)
  const patch = body => call(questionsRoute.PATCH, '/api/super-test/admin/questions', 'PATCH', body)

  test('GET joins keys and per-question counts; filters', async () => {
    as('super', 'S1'); await getCurrent(); await submit({ week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS, ['q01']) })
    as('principal', 'P')
    let r = await call(questionsRoute.GET, '/api/super-test/admin/questions')
    expect(r.body.questions).toHaveLength(80)
    const q01 = r.body.questions.find(q => q.id === 'q01')
    expect(q01).toMatchObject({ correct_index: 1, answered: 1, missed: 1, active: true })
    expect(r.body.questions.find(q => q.id === 'q02')).toMatchObject({ answered: 1, missed: 0 })
    r = await call(questionsRoute.GET, '/api/super-test/admin/questions?category=general')
    expect(r.body.questions).toHaveLength(24)
  })

  test('POST validates and ignores body id / created_by / is_sample', async () => {
    as('admin', 'AD')
    const bad = [
      { ...valid, choices: ['a', 'b', 'c'] },
      { ...valid, choices: ['Yes', 'yes ', 'No', 'Maybe'] },
      { ...valid, correct_index: 4 },
      { ...valid, topic: 'Bad Topic!' },
      { ...valid, category: 'other' },
      { ...valid, question: ' ' },
      { ...valid, explanation: 'x'.repeat(601) },
      { ...valid, store: 'x'.repeat(61) },
    ]
    for (const b of bad) expect((await post(b)).status).toBe(400)
    expect(mockState.db.super_test_questions).toHaveLength(80)

    const r = await post({ ...valid, id: 'q01', created_by: 'someone', is_sample: true, active: false })
    expect(r.status).toBe(200)
    const id = r.body.question.id
    expect(id).toMatch(/^qa-[0-9a-f]{8}$/)
    const row = mockState.db.super_test_questions.find(q => q.id === id)
    expect(row).toMatchObject({ topic: 'ladders', store: null, created_by: 'AD', is_sample: false, active: true })
    expect(mockState.db.super_test_answer_keys.find(k => k.question_id === id)).toMatchObject({ correct_index: 0 })
    expect(mockState.db.super_test_questions.find(q => q.id === 'q01').question).toBe(KEY.q01.question)
    expect(mockState.db.change_log).toEqual([expect.objectContaining({ entity_type: 'super_test_question', entity_id: null, note: `super_test_question ${id}`, field_name: 'created', changed_by: 'AD' })])
  })

  test('POST: key insert fails → the question is removed again', async () => {
    as('admin', 'AD')
    mockState.failWrite = { super_test_answer_keys: { insert: 'boom' } }
    const r = await post(valid)
    expect(r.status).toBe(500)
    expect(mockState.db.super_test_questions).toHaveLength(80)
  })

  test('PATCH updates the key and logs each change; validation; 404', async () => {
    as('principal', 'P')
    const r = await patch({ id: 'q20', correct_index: 0, explanation: 'New why.', created_by: 'x' })
    expect(r.status).toBe(200)
    expect(mockState.db.super_test_answer_keys.find(k => k.question_id === 'q20')).toMatchObject({ correct_index: 0, explanation: 'New why.' })
    const logs = mockState.db.change_log.filter(l => l.note === 'super_test_question q20')
    expect(logs.map(l => l.field_name).sort()).toEqual(['correct_index', 'explanation'])
    expect(logs.find(l => l.field_name === 'correct_index')).toMatchObject({ old_value: String(KEY.q20.correct_index), new_value: '0', changed_by: 'P' })
    expect((await patch({ id: 'q20', topic: 'BAD TOPIC' })).status).toBe(400)
    expect((await patch({ id: 'q20' })).status).toBe(400)
    expect((await patch({ id: 'nope', active: false })).status).toBe(404)
    expect(questionsRoute.DELETE).toBeUndefined()
  })

  test('deactivate removes it from future rotation (and breaks the sample week); reactivate', async () => {
    as('admin', 'AD')
    expect((await patch({ id: 'q01', active: false })).status).toBe(200)
    expect(mockState.db.change_log.find(l => l.note === 'super_test_question q01')).toMatchObject({ field_name: 'active', old_value: 'true', new_value: 'false', entity_id: null })
    as('super', 'NEW')
    const r = await getCurrent()
    const ids = r.body.questions.map(q => q.id)
    expect(ids).not.toContain('q01')
    expect(ids).not.toEqual(T.SAMPLE_IDS)
    as('admin', 'AD')
    expect((await patch({ id: 'q01', active: true })).status).toBe(200)
    expect(mockState.db.super_test_questions.find(q => q.id === 'q01').active).toBe(true)
  })

  test('change_log entity_id is always null or a uuid (the column is uuid); no job_id', async () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    as('admin', 'AD')
    const created = await post(valid)
    expect(created.status).toBe(200)
    expect((await patch({ id: created.body.question.id, topic: 'step-ladders', correct_index: 2 })).status).toBe(200)
    expect((await patch({ id: 'q30', active: false })).status).toBe(200)
    const logs = mockState.db.change_log
    expect(logs.length).toBe(4)
    for (const l of logs) {
      expect(l.entity_id === null || UUID.test(l.entity_id)).toBe(true)
      expect(l.job_id).toBeNull()
      expect(l.note).toMatch(/^super_test_question (q\d\d|qa-[0-9a-f]{8})$/)
    }
  })

  test('choices / correct answer locked while a super has the question in an open test this week', async () => {
    as('super', 'S1'); await getCurrent() // S1 now has q01–q10 open (not submitted)
    as('admin', 'AD')
    let r = await patch({ id: 'q01', correct_index: (KEY.q01.correct_index + 1) % 4 })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ open_tests: 1 })
    expect(JSON.stringify(r.body)).not.toMatch(/explanation"/)
    r = await patch({ id: 'q01', choices: [...KEY.q01.choices].reverse() })
    expect(r.status).toBe(409)
    expect(mockState.db.super_test_questions.find(q => q.id === 'q01').choices).toEqual(KEY.q01.choices)
    expect(mockState.db.super_test_answer_keys.find(k => k.question_id === 'q01').correct_index).toBe(KEY.q01.correct_index)
    expect(mockState.db.change_log).toHaveLength(0)
    // Same values (the edit form resends everything) and wording / explanation edits are fine.
    expect((await patch({ id: 'q01', choices: KEY.q01.choices, correct_index: KEY.q01.correct_index, explanation: 'Clearer why.' })).status).toBe(200)
    expect((await patch({ id: 'q01', active: false })).status).toBe(200)
    // A question not in anyone's open test is not locked.
    expect((await patch({ id: 'q40', correct_index: (KEY.q40.correct_index + 1) % 4 })).status).toBe(200)
    // Last week's unsubmitted assignment doesn't lock (it can no longer be submitted).
    mockState.db.super_test_assignments.push({ id: 'last', super_id: 'S2', week_start: '2026-11-09', question_ids: ['q41'] })
    expect((await patch({ id: 'q41', correct_index: (KEY.q41.correct_index + 1) % 4 })).status).toBe(200)
    // Once S1 submits, the lock lifts.
    expect((await patch({ id: 'q01', active: true })).status).toBe(200)
    as('super', 'S1'); expect((await submit({ week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS) })).status).toBe(200)
    as('admin', 'AD')
    expect((await patch({ id: 'q01', correct_index: (KEY.q01.correct_index + 1) % 4 })).status).toBe(200)
  })

  test('PATCH: key write fails → the question fields are put back (no half edit)', async () => {
    as('admin', 'AD')
    mockState.failWrite = { super_test_answer_keys: { update: 'boom' } }
    const r = await patch({ id: 'q40', question: 'Half edit?', correct_index: (KEY.q40.correct_index + 1) % 4 })
    expect(r.status).toBe(500)
    expect(mockState.db.super_test_questions.find(q => q.id === 'q40').question).toBe(KEY.q40.question)
    expect(mockState.db.super_test_answer_keys.find(k => k.question_id === 'q40').correct_index).toBe(KEY.q40.correct_index)
    expect(mockState.db.change_log).toHaveLength(0)
  })

  test('admin UI: 44px row buttons, error cleared on reload; full-bleed Weekly Test header / submit bar', () => {
    const admin = read('app/components/SuperTestAdmin.js')
    expect(admin).toMatch(/ghost: \{ minHeight: '44px'/)
    expect(admin).toMatch(/const loadStats = useCallback\(async \(\) => \{\n\s+setError\(''\)/)
    expect(admin).toMatch(/const loadQuestions = useCallback\(async \(\) => \{\n\s+setError\(''\)/)
    expect(read('app/field/page.js')).toMatch(/className="rx-bleed" style=\{\{ position: 'sticky'.*margin: '0 -1\.5rem', padding: '0 1\.5rem'/)
    expect(read('app/field/SuperWeeklyTest.js')).toMatch(/className="rx-bleed" style=\{st\.bar\}/)
    expect(read('app/globals.css')).toMatch(/\.rx-bleed\s+\{ margin-left: -0\.75rem !important; margin-right: -0\.75rem !important;/)
  })

  test('editing a question after an attempt does not change that attempt\'s review (snapshot)', async () => {
    as('super', 'S1'); await getCurrent(); await submit({ week_start: WEEK, answers: allAnswers(T.SAMPLE_IDS) })
    as('admin', 'AD')
    expect((await patch({ id: 'q01', question: 'Edited text?', correct_index: 3, choices: ['A', 'B', 'C', 'D'] })).status).toBe(200)
    as('super', 'S1')
    const r = await getCurrent(`?week=${WEEK}`)
    const it = r.body.result.items.find(i => i.question_id === 'q01')
    expect(it.question).toBe(KEY.q01.question)
    expect(it.choices).toEqual(KEY.q01.choices)
    expect(it.correct_index).toBe(KEY.q01.correct_index)
    expect(r.body.result.score).toBe(10)
  })
})

// ── Migration / seed / data ──────────────────────────────────────────────────
describe('migration 077 and the question bank', () => {
  const sql = read('migrations/077_super_weekly_test.sql')
  const code = sql.replace(/--[^\n]*/g, '') // statements only (comments stripped)
  const TABLES = ['super_test_questions', 'super_test_answer_keys', 'super_test_assignments', 'super_test_attempts']

  test('header, transaction, RLS and the answer-key wall', () => {
    expect(sql).toMatch(/STATUS: PROPOSED — written, NOT applied/)
    expect(code).toMatch(/^\s*BEGIN;/)
    expect(code.trim().endsWith('COMMIT;')).toBe(true)
    expect(code).toMatch(/RAISE EXCEPTION[^;]*profiles/)
    expect(code).toMatch(/RAISE EXCEPTION[^;]*get_my_role/)
    for (const t of TABLES) {
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`))
      expect(code).toMatch(new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon, authenticated;`))
      expect(code).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`))
    }
    const statements = code.split(';')
    expect(statements.filter(s => /\bGRANT\b/.test(s) && /super_test_answer_keys/.test(s))).toEqual([])
    expect(statements.filter(s => /CREATE POLICY/.test(s) && /super_test_answer_keys/.test(s))).toEqual([])
    expect(statements.filter(s => /CREATE POLICY/.test(s) && /FOR (INSERT|UPDATE|DELETE|ALL)/.test(s))).toEqual([])
    expect(code).toMatch(/CONSTRAINT super_test_assignments_super_week_key UNIQUE \(super_id, week_start\)/)
    expect(code).toMatch(/CONSTRAINT super_test_attempts_super_week_key UNIQUE \(super_id, week_start\)/)
    expect(code).toMatch(/assignment_id\s+uuid NOT NULL UNIQUE REFERENCES public\.super_test_assignments\(id\)/)
    expect((code.match(/EXTRACT\(ISODOW FROM week_start\) = 1/g) || []).length).toBe(2)
    expect(code).toMatch(/ON CONFLICT \(id\) DO NOTHING;/)
    expect(code).toMatch(/ON CONFLICT \(question_id\) DO NOTHING;/)
    expect(code).not.toMatch(/DO UPDATE/i)
    // admin role list mirrors SUPER_TEST_ADMIN_ROLES
    const lists = code.match(/get_my_role\(\) IN \(([^)]*)\)/g) || []
    expect(lists.length).toBe(3)
    for (const l of lists) expect(l).toBe(`get_my_role() IN (${T.SUPER_TEST_ADMIN_ROLES.map(r => `'${r}'`).join(', ')})`)
  })

  test('seed block matches the generator byte-for-byte', () => {
    const begin = '-- BEGIN GENERATED SEED (scripts/gen-super-test-seed.js)\n'
    const end = '-- END GENERATED SEED'
    const i = sql.indexOf(begin)
    const j = sql.indexOf(end)
    expect(i).toBeGreaterThan(0)
    expect(sql.slice(i + begin.length, j)).toBe(buildSeedSql(loadQuestions()))
  })

  // Exact copy of the reviewed bank (checked only where the source file exists, i.e. not in CI).
  const SRC = '/workspace/portal-fixes/prompt88-super-weekly-test-questions.json'
  ;(fs.existsSync(SRC) ? test : test.skip)('data JSON is a byte-for-byte copy of the reviewed bank', () => {
    expect(read('data/super-test-questions.json')).toBe(fs.readFileSync(SRC, 'utf8'))
  })

  test('data JSON content rules', () => {
    expect(BANK).toHaveLength(80)
    expect(BANK.filter(q => q.category === 'braums')).toHaveLength(56)
    expect(BANK.filter(q => q.category === 'general')).toHaveLength(24)
    expect(new Set(BANK.map(q => q.id)).size).toBe(80)
    const money = /\$\s?\d|\bNTE\b|\bfees?\b|\bmargins?\b|\bsalar|\bprofit/i
    for (const q of BANK) {
      expect(q.choices).toHaveLength(4)
      expect(new Set(q.choices.map(c => c.trim().toLowerCase())).size).toBe(4)
      expect(Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index <= 3).toBe(true)
      expect(q.sample).toBe(T.SAMPLE_IDS.includes(q.id))
      expect(q.topic).toMatch(T.TOPIC_RE)
      expect(q.store == null || q.store.length <= 60).toBe(true)
      expect(q.question.trim().length).toBeGreaterThan(0)
      expect(q.question.length).toBeLessThanOrEqual(1000)
      expect(q.explanation.trim().length).toBeGreaterThan(0)
      expect(q.explanation.length).toBeLessThanOrEqual(600)
      for (const t of [q.question, q.explanation, ...q.choices]) expect(t).not.toMatch(money)
      // The bank itself passes the admin validator
      expect(T.validateQuestionInput(q).ok).toBe(true)
    }
  })

  test('publicQuestion never carries the key', () => {
    const p = T.publicQuestion({ ...KEY.q01, correct_index: 1, explanation: 'x' })
    expect(Object.keys(p).sort()).toEqual(['category', 'choices', 'id', 'question', 'store', 'topic'])
  })
})
