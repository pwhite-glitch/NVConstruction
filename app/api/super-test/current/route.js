import { createClient } from '@supabase/supabase-js'
import { requireRole } from '../../../../lib/server-auth'
import { SUPER_TEST_TAKER_ROLES, weekStartCentral, weekLabel, publicQuestion, isMonday } from '../../../../lib/super-test'
import { MIGRATION, isMissingTable, json, noStore, loadOrCreateAssignment, loadQuestionsByIds, findAssignment, findAttempt, loadHistory } from '../../../../lib/super-test-server'

export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const fail = error => (isMissingTable(error) ? json({ migration_required: MIGRATION }) : json({ error: error.message || 'Could not load the weekly test.' }, 500))
const resultOf = attempt => ({ score: attempt.score, total: attempt.total, submitted_at: attempt.submitted_at, items: attempt.answers || [] })

// GET /api/super-test/current — the caller's weekly test (supers only; prompt 88).
//   ?peek=1           → status for the /field tile. No side effects (creates nothing).
//                       'no_questions' when nothing is assigned yet and the bank has no active question.
//   (no params)       → this week's questions (no answer keys) or, once submitted, the result.
//   ?week=YYYY-MM-DD  → review of the CALLER's own submitted attempt for that week; 404 if none.
// Never reads super_test_answer_keys: results come from the caller's attempt snapshot.
export async function GET(request) {
  const auth = await requireRole(request, SUPER_TEST_TAKER_ROLES)
  if (auth.error) return noStore(auth.error)
  const db = adminSupabase
  const params = new URL(request.url).searchParams
  const week_start = weekStartCentral()

  if (params.get('peek') === '1') {
    const a = await findAssignment(db, auth.userId, week_start)
    if (a.error) return fail(a.error)
    const t = await findAttempt(db, auth.userId, week_start)
    if (t.error) return fail(t.error)
    let status = t.data ? 'submitted' : a.data ? 'in_progress' : 'not_started'
    if (status === 'not_started') {
      const { count, error: cErr } = await db.from('super_test_questions').select('id', { count: 'exact', head: true }).eq('active', true)
      if (cErr) return fail(cErr)
      if (!count) status = 'no_questions'
    }
    return json({ week_start, week_label: weekLabel(week_start), status, ...(t.data ? { score: t.data.score, total: t.data.total } : {}) })
  }

  const { history, error: histErr } = await loadHistory(db, auth.userId)
  if (histErr) return fail(histErr)

  const week = params.get('week')
  if (week) {
    if (!isMonday(week)) return json({ error: 'week must be a Monday (YYYY-MM-DD).' }, 400)
    const t = await findAttempt(db, auth.userId, week)
    if (t.error) return fail(t.error)
    if (!t.data) return json({ error: 'No submitted test for that week.' }, 404)
    return json({ week_start: week, week_label: weekLabel(week), status: 'submitted', result: resultOf(t.data), history })
  }

  const { assignment, noQuestions, error } = await loadOrCreateAssignment(db, auth.userId, week_start)
  if (error) return fail(error)
  if (noQuestions) return json({ week_start, week_label: weekLabel(week_start), status: 'no_questions', history })

  const t = await findAttempt(db, auth.userId, week_start)
  if (t.error) return fail(t.error)
  if (t.data) return json({ week_start, week_label: weekLabel(week_start), status: 'submitted', result: resultOf(t.data), history })

  const { byId, error: qErr } = await loadQuestionsByIds(db, assignment.question_ids)
  if (qErr) return fail(qErr)
  const questions = assignment.question_ids.map(id => byId.get(id)).filter(Boolean).map(publicQuestion)
  return json({ week_start, week_label: weekLabel(week_start), status: 'in_progress', questions, history })
}
