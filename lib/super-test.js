// Weekly superintendent test (prompt 88). Pure helpers: no DB, no Next.js, safe in the
// browser and in tests. The only import is ./central-date (week boundaries are Central).
//
// Answer keys (correct_index / explanation) live ONLY in super_test_answer_keys (migration
// 077), readable by the service role alone. publicQuestion() is what a super's browser gets
// before submitting; scoreAttempt() builds the per-question snapshot stored with the attempt.

import { todayCentral } from './central-date'

// Who sees the admin side (dashboard "Super Test" tab + /api/super-test/admin/*).
// MIRRORED in migrations/077_super_weekly_test.sql RLS policies — change both together
// (adding 'pm' later = this line + the three get_my_role() IN (...) lists in 077).
export const SUPER_TEST_ADMIN_ROLES = ['principal', 'admin']
// Who takes the test. APMs (who can also open /field) do not.
export const SUPER_TEST_TAKER_ROLES = ['super']

export const QUESTIONS_PER_WEEK = 10
export const BRAUMS_PER_WEEK = 7
export const RECENT_WEEKS = 6
export const FIRST_WEEK_SAMPLE = true
export const SAMPLE_IDS = ['q01', 'q02', 'q03', 'q04', 'q05', 'q06', 'q07', 'q08', 'q09', 'q10']
export const CATEGORIES = ['braums', 'general']
export const CATEGORY_LABELS = { braums: "Braum's", general: 'General' }
export const HISTORY_LIMIT = 12

export const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
export const QUESTION_RULES = 'Rules: scenario/judgment questions, enough context to reason it out, no bare recall of project numbers, no money (contract values, NTEs, fees, margins, salaries).'
export const WEEK_CLOSED_MESSAGE = "That week's test is closed."
export const ALREADY_SUBMITTED_MESSAGE = "You already submitted this week's test."

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  // Reject 2026-02-31 etc. (Date.UTC rolls over)
  if (new Date(t).toISOString().slice(0, 10) !== dateStr) return null
  return { y, m, d, t }
}

export const isDateOnly = s => !!parseDate(s)

// 'YYYY-MM-DD' n days after (negative: before) a date-only string.
export function addDays(dateStr, n) {
  const p = parseDate(dateStr)
  if (!p) return null
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10)
}

export function isMonday(dateStr) {
  const p = parseDate(dateStr)
  return !!p && new Date(p.t).getUTCDay() === 1
}

// Monday (Central date) of the week containing `now`. Weeks run Mon 00:00 → Sun 23:59:59 CT.
export function weekStartCentral(now = new Date()) {
  const today = todayCentral(now)
  const [y, m, d] = today.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const back = dow === 0 ? 6 : dow - 1
  return new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10)
}

// "Week of Nov 16, 2026"
export function weekLabel(weekStart) {
  const p = parseDate(weekStart)
  if (!p) return ''
  return `Week of ${MONTHS[p.m - 1]} ${p.d}, ${p.y}`
}

// FNV-1a 32-bit, unsigned. Deterministic; no crypto import.
export function hashKey(str) {
  let h = 0x811c9dc5
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const isActive = q => q && q.active !== false
const isSampleQ = q => !!(q && (q.is_sample ?? q.sample))

// Ordered question ids for one super's week (spec §5).
//   bank:   question rows { id, category, active, is_sample } (inactive rows are ignored)
//   recent: this super's assignments [{ week_start, question_ids }]; only weeks in
//           [weekStart − 7·RECENT_WEEKS days, weekStart) count
//   isFirstWeek: the super has no assignment at all yet
export function pickWeeklyQuestions({ superId, weekStart, bank = [], recent = [], isFirstWeek = false }) {
  const active = (bank || []).filter(isActive)
  if (!active.length) return []
  const byId = new Map(active.map(q => [q.id, q]))

  if (isFirstWeek && FIRST_WEEK_SAMPLE && SAMPLE_IDS.every(id => byId.has(id) && isSampleQ(byId.get(id)))) {
    return [...SAMPLE_IDS]
  }

  const windowStart = addDays(weekStart, -7 * RECENT_WEEKS)
  const lastSeen = new Map()
  for (const a of recent || []) {
    const ws = a?.week_start
    if (typeof ws !== 'string' || ws >= weekStart || (windowStart && ws < windowStart)) continue
    for (const id of a.question_ids || []) {
      const prev = lastSeen.get(id)
      if (!prev || ws > prev) lastSeen.set(id, ws)
    }
  }

  const rank = new Map(active.map(q => [q.id, hashKey(`${superId}|${weekStart}|${q.id}`)]))
  const compare = (a, b) => {
    const sa = lastSeen.get(a.id), sb = lastSeen.get(b.id)
    if (!sa !== !sb) return sa ? 1 : -1 // never seen first
    if (sa && sb && sa !== sb) return sa < sb ? -1 : 1 // oldest lastSeen first
    const ha = rank.get(a.id), hb = rank.get(b.id)
    if (ha !== hb) return ha - hb
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }

  const total = Math.min(QUESTIONS_PER_WEEK, active.length)
  const pools = {}
  for (const c of CATEGORIES) pools[c] = active.filter(q => q.category === c).sort(compare)
  const want = { braums: BRAUMS_PER_WEEK, general: QUESTIONS_PER_WEEK - BRAUMS_PER_WEEK }

  const chosen = []
  const taken = new Set()
  for (const c of CATEGORIES) {
    for (const q of pools[c].slice(0, want[c])) { chosen.push(q.id); taken.add(q.id) }
  }
  if (chosen.length < total) {
    const rest = active.filter(q => !taken.has(q.id)).sort(compare)
    for (const q of rest) {
      if (chosen.length >= total) break
      chosen.push(q.id)
      taken.add(q.id)
    }
  }

  const orderKey = id => hashKey(`order|${superId}|${weekStart}|${id}`)
  return chosen.slice(0, total).sort((a, b) => (orderKey(a) - orderKey(b)) || (a < b ? -1 : a > b ? 1 : 0))
}

// What a super's browser may see of a question. NEVER correct_index / explanation.
export function publicQuestion(q) {
  return {
    id: q.id,
    category: q.category,
    topic: q.topic,
    store: q.store ?? null,
    question: q.question,
    choices: Array.isArray(q.choices) ? [...q.choices] : [],
  }
}

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v)

// answers = { [question_id]: chosen_index }. Must be exactly the assignment's ids, each 0–3.
export function validateAnswers(questionIds, answers) {
  if (!isPlainObject(answers)) return { ok: false, error: 'Answers are required.' }
  const ids = new Set(questionIds || [])
  for (const k of Object.keys(answers)) {
    if (!ids.has(k)) return { ok: false, error: 'An answer was sent for a question that is not on this week\'s test.' }
  }
  for (const id of ids) {
    if (!(id in answers) || answers[id] === null || answers[id] === undefined) return { ok: false, error: 'Answer every question before submitting.' }
    const v = answers[id]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 3) return { ok: false, error: 'Each answer must be one of the four choices.' }
  }
  return { ok: true, error: null }
}

// → { score, total, items } where items is the snapshot stored in super_test_attempts.answers,
// one per question in assignment order. { error } if a question or key is missing.
export function scoreAttempt({ questionIds, questionsById, keysById, answers }) {
  const get = (m, k) => (m instanceof Map ? m.get(k) : m?.[k])
  const items = []
  let score = 0
  for (const id of questionIds || []) {
    const q = get(questionsById, id)
    const key = get(keysById, id)
    if (!q || !key) return { score: 0, total: 0, items: [], error: `Question ${id} is missing its ${q ? 'answer key' : 'text'}.` }
    const chosen = answers[id]
    const isCorrect = chosen === key.correct_index
    if (isCorrect) score++
    items.push({
      question_id: id,
      category: q.category,
      topic: q.topic,
      question: q.question,
      choices: Array.isArray(q.choices) ? [...q.choices] : [],
      chosen_index: chosen,
      correct_index: key.correct_index,
      explanation: key.explanation,
      is_correct: isCorrect,
    })
  }
  return { score, total: items.length, items, error: null }
}

// attempts: [{ answers: items[] }] → [{ topic, missed, answered, missRate }]
// sorted by missed desc, then missRate desc, then topic.
export function missedTopics(attempts) {
  const by = new Map()
  for (const a of attempts || []) {
    for (const it of Array.isArray(a?.answers) ? a.answers : []) {
      if (!it || !it.topic) continue
      const t = by.get(it.topic) || { topic: it.topic, missed: 0, answered: 0 }
      t.answered++
      if (!it.is_correct) t.missed++
      by.set(it.topic, t)
    }
  }
  return [...by.values()]
    .map(t => ({ ...t, missRate: t.answered ? t.missed / t.answered : 0 }))
    .sort((a, b) => (b.missed - a.missed) || (b.missRate - a.missRate) || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0))
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const optText = (v, max, label) => {
  if (v === null || v === undefined) return { v: null }
  if (typeof v !== 'string') return { error: `${label} must be text.` }
  const t = v.trim()
  if (!t) return { v: null }
  if (t.length > max) return { error: `${label} must be ${max} characters or fewer.` }
  return { v: t }
}

// Whitelisted fields only (id / created_by / is_sample / anything else in the body is ignored).
// partial: only the fields present are checked (PATCH); `active` (boolean) is allowed there.
// → { ok, value, error }
export function validateQuestionInput(body, { partial = false } = {}) {
  if (!isPlainObject(body)) return { ok: false, value: null, error: 'Send the question as JSON.' }
  const need = k => !partial || has(body, k)
  const value = {}
  const fail = error => ({ ok: false, value: null, error })

  if (need('category')) {
    if (!CATEGORIES.includes(body.category)) return fail("Category must be Braum's or General.")
    value.category = body.category
  }
  if (need('topic')) {
    const t = typeof body.topic === 'string' ? body.topic.trim().toLowerCase() : ''
    if (!TOPIC_RE.test(t)) return fail('Topic must be 1–40 lowercase letters, numbers or dashes (like "fall-protection").')
    value.topic = t
  }
  if (need('question')) {
    const q = typeof body.question === 'string' ? body.question.trim() : ''
    if (!q || q.length > 1000) return fail('Question text is required (1–1000 characters).')
    value.question = q
  }
  if (need('choices')) {
    const c = body.choices
    if (!Array.isArray(c) || c.length !== 4) return fail('Give exactly 4 choices.')
    const out = []
    for (const x of c) {
      const t = typeof x === 'string' ? x.trim() : ''
      if (!t || t.length > 300) return fail('Each choice must be 1–300 characters.')
      out.push(t)
    }
    if (new Set(out.map(x => x.toLowerCase())).size !== 4) return fail('The 4 choices must all be different.')
    value.choices = out
  }
  if (need('correct_index')) {
    const ci = body.correct_index
    if (typeof ci !== 'number' || !Number.isInteger(ci) || ci < 0 || ci > 3) return fail('Pick which choice is correct.')
    value.correct_index = ci
  }
  if (need('explanation')) {
    const e = typeof body.explanation === 'string' ? body.explanation.trim() : ''
    if (!e || e.length > 600) return fail('Explanation is required (1–600 characters).')
    value.explanation = e
  }
  if (need('store')) {
    const r = optText(body.store, 60, 'Store')
    if (r.error) return fail(r.error)
    value.store = r.v
  }
  if (need('source')) {
    const r = optText(body.source, 200, 'Source')
    if (r.error) return fail(r.error)
    value.source = r.v
  }
  if (partial && has(body, 'active')) {
    if (typeof body.active !== 'boolean') return fail('active must be true or false.')
    value.active = body.active
  }
  if (partial && !Object.keys(value).length) return fail('Nothing to change.')
  return { ok: true, value, error: null }
}

// /api/super-test/admin/stats ?weeks= : clamp 1–26, default 8.
export function parseStatsWeeks(v) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(26, Math.max(1, n)) : 8
}

// Split validated fields into the question row vs. the answer-key row.
export const KEY_FIELDS = ['correct_index', 'explanation']
export const QUESTION_FIELDS = ['category', 'topic', 'store', 'question', 'choices', 'source', 'active']
