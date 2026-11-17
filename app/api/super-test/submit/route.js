import { createClient } from '@supabase/supabase-js'
import { requireRole } from '../../../../lib/server-auth'
import { SUPER_TEST_TAKER_ROLES, weekStartCentral, validateAnswers, scoreAttempt, WEEK_CLOSED_MESSAGE, ALREADY_SUBMITTED_MESSAGE } from '../../../../lib/super-test'
import { MIGRATION, isMissingTable, json, noStore, findAssignment, findAttempt, loadQuestionsByIds, loadKeysByIds } from '../../../../lib/super-test-server'

export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const fail = error => (isMissingTable(error)
  ? json({ error: "Weekly test isn't set up yet.", migration_required: MIGRATION }, 409)
  : json({ error: error.message || 'Could not submit the test.' }, 500))
const already = () => json({ error: ALREADY_SUBMITTED_MESSAGE }, 409)

// POST /api/super-test/submit { week_start, answers: { [question_id]: chosen_index } }
// Supers only. Only week_start and answers are read from the body (score / super_id / total
// are ignored). Scored here with the service-role answer keys; one INSERT, and the UNIQUE
// (super_id, week_start) constraint makes a second submit (or a race) a 409.
export async function POST(request) {
  const auth = await requireRole(request, SUPER_TEST_TAKER_ROLES)
  if (auth.error) return noStore(auth.error)
  const db = adminSupabase

  let body
  try { body = await request.json() } catch { return json({ error: 'Send the answers as JSON.' }, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Send the answers as JSON.' }, 400)

  const week_start = weekStartCentral()
  if (body.week_start !== week_start) return json({ error: WEEK_CLOSED_MESSAGE }, 409)

  const a = await findAssignment(db, auth.userId, week_start)
  if (a.error) return fail(a.error)
  if (!a.data) return json({ error: 'No test was assigned to you this week. Open the Weekly Test first.' }, 404)
  const questionIds = a.data.question_ids || []

  const check = validateAnswers(questionIds, body.answers)
  if (!check.ok) return json({ error: check.error }, 400)

  const prior = await findAttempt(db, auth.userId, week_start)
  if (prior.error) return fail(prior.error)
  if (prior.data) return already()

  const qs = await loadQuestionsByIds(db, questionIds)
  if (qs.error) return fail(qs.error)
  const keys = await loadKeysByIds(db, questionIds)
  if (keys.error) return fail(keys.error)
  const scored = scoreAttempt({ questionIds, questionsById: qs.byId, keysById: keys.byId, answers: body.answers })
  if (scored.error) return json({ error: scored.error }, 500)

  const { error } = await db.from('super_test_attempts').insert({
    assignment_id: a.data.id,
    super_id: auth.userId,
    week_start,
    score: scored.score,
    total: scored.total,
    answers: scored.items,
  })
  if (error && error.code === '23505') return already()
  if (error) return fail(error)
  return json({ score: scored.score, total: scored.total, items: scored.items })
}
