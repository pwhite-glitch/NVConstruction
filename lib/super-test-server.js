// Server-side weekly super test helpers (prompt 88). Pass the service-role client as `db`.
// Pure of Next.js. Mirrors lib/daily-report-server.js style.
//
// Answer keys: only loadKeysByIds() reads super_test_answer_keys. The GET /current path never
// calls it (tests assert no read of that table before submit).

import { pickWeeklyQuestions, addDays, RECENT_WEEKS, HISTORY_LIMIT } from './super-test'

export const MIGRATION = '077'
export const PAGE = 1000

// Table missing (migration 077 not applied yet).
export const isMissingTable = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''))

export const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
// Shared helpers' 401/403 responses, copied with no-store added.
export const noStore = res => {
  const headers = new Headers(res.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// Every row of a list read, 1000 at a time (Supabase caps a response at 1000 rows).
// build() must return a fresh query each call. → { rows, error }
export async function fetchAllPages(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { rows, error }
    const batch = data || []
    rows.push(...batch)
    if (batch.length < PAGE) return { rows, error: null }
  }
}

const QUESTION_COLS = 'id, category, topic, store, question, choices, source, is_sample, active, created_at, updated_at'

export function loadActiveBank(db) {
  return fetchAllPages(() => db.from('super_test_questions').select('id, category, is_sample, active').eq('active', true).order('id'))
}

// { [id]: question row } for exactly these ids (any active state: past weeks keep inactive ones).
export async function loadQuestionsByIds(db, ids) {
  const out = new Map()
  if (!ids?.length) return { byId: out, error: null }
  const { data, error } = await db.from('super_test_questions').select(QUESTION_COLS).in('id', ids)
  if (error) return { byId: out, error }
  for (const q of data || []) out.set(q.id, q)
  return { byId: out, error: null }
}

// Answer keys for exactly these ids. Service role only — never on the pre-submit path.
export async function loadKeysByIds(db, ids) {
  const out = new Map()
  if (!ids?.length) return { byId: out, error: null }
  const { data, error } = await db.from('super_test_answer_keys').select('question_id, correct_index, explanation').in('question_id', ids)
  if (error) return { byId: out, error }
  for (const k of data || []) out.set(k.question_id, k)
  return { byId: out, error: null }
}

export async function findAssignment(db, superId, weekStart) {
  return db.from('super_test_assignments').select('id, super_id, week_start, question_ids, created_at')
    .eq('super_id', superId).eq('week_start', weekStart).maybeSingle()
}

export async function findAttempt(db, superId, weekStart) {
  return db.from('super_test_attempts').select('id, assignment_id, super_id, week_start, score, total, answers, submitted_at')
    .eq('super_id', superId).eq('week_start', weekStart).maybeSingle()
}

// The caller's last HISTORY_LIMIT attempts (own rows only), newest first.
export async function loadHistory(db, superId) {
  const { data, error } = await db.from('super_test_attempts').select('week_start, score, total')
    .eq('super_id', superId).order('week_start', { ascending: false }).limit(HISTORY_LIMIT)
  if (error) return { history: [], error }
  const history = (data || [])
    .map(r => ({ week_start: r.week_start, score: r.score, total: r.total }))
    .sort((a, b) => (a.week_start < b.week_start ? 1 : a.week_start > b.week_start ? -1 : 0))
    .slice(0, HISTORY_LIMIT)
  return { history, error: null }
}

// This super's assignment for the week: existing row, else pick + INSERT. A racing request
// that inserts first wins (UNIQUE super_id, week_start → 23505): re-read and return its row.
// Never reads answer keys. → { assignment } | { noQuestions: true } | { error }
export async function loadOrCreateAssignment(db, superId, weekStart) {
  const existing = await findAssignment(db, superId, weekStart)
  if (existing.error) return { error: existing.error }
  if (existing.data) return { assignment: existing.data }

  const bank = await loadActiveBank(db)
  if (bank.error) return { error: bank.error }
  if (!bank.rows.length) return { noQuestions: true }

  const recent = await fetchAllPages(() => db.from('super_test_assignments').select('week_start, question_ids')
    .eq('super_id', superId).lt('week_start', weekStart).gte('week_start', addDays(weekStart, -7 * RECENT_WEEKS)).order('week_start'))
  if (recent.error) return { error: recent.error }
  const { count, error: cntErr } = await db.from('super_test_assignments').select('id', { count: 'exact', head: true }).eq('super_id', superId)
  if (cntErr) return { error: cntErr }

  const ids = pickWeeklyQuestions({ superId, weekStart, bank: bank.rows, recent: recent.rows, isFirstWeek: (count ?? 0) === 0 })
  if (!ids.length) return { noQuestions: true }

  const { data, error } = await db.from('super_test_assignments')
    .insert({ super_id: superId, week_start: weekStart, question_ids: ids })
    .select('id, super_id, week_start, question_ids, created_at').single()
  if (error && error.code === '23505') {
    const again = await findAssignment(db, superId, weekStart)
    if (again.error) return { error: again.error }
    if (again.data) return { assignment: again.data }
  }
  if (error) return { error }
  return { assignment: data }
}
