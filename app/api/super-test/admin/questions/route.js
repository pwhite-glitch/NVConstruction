import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { requireRole } from '../../../../../lib/server-auth'
import { logChange } from '../../../../../lib/change-log'
import { SUPER_TEST_ADMIN_ROLES, CATEGORIES, validateQuestionInput, KEY_FIELDS, QUESTION_FIELDS, weekStartCentral } from '../../../../../lib/super-test'
import { MIGRATION, isMissingTable, json, noStore, fetchAllPages } from '../../../../../lib/super-test-server'

export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const QUESTION_COLS = 'id, category, topic, store, question, choices, source, is_sample, active, created_at, updated_at, created_by, updated_by'
const ENTITY = 'super_test_question'
// change_log.entity_id is a uuid column and question ids are text ('q01', 'qa-…'), so the
// id goes in the note and entity_id stays null. No job_id: these rows stay principal/admin-only.
const logQ = (id, entry) => logChange({ entity_type: ENTITY, entity_id: null, note: `${ENTITY} ${id}`, ...entry })
// Changing these while a super has the question open this week would re-score a pick
// against choices / a key they never saw (picks are stored as indexes).
const OPEN_LOCKED = ['choices', 'correct_index']
const readFail = e => (isMissingTable(e) ? json({ migration_required: MIGRATION }) : json({ error: e.message || 'Could not load questions.' }, 500))
const writeFail = e => (isMissingTable(e)
  ? json({ error: "Weekly test isn't set up yet (needs migration 077).", migration_required: MIGRATION }, 409)
  : json({ error: e.message || 'Could not save the question.' }, 500))
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]))
const asText = v => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v))
const same = (a, b) => asText(a) === asText(b)

async function readBody(request) {
  try { return await request.json() } catch { return null }
}

// GET ?category=braums|general&active=true|false — every question with its answer key and
// answered / missed counts from submitted attempts. Principal / admin only.
export async function GET(request) {
  const auth = await requireRole(request, SUPER_TEST_ADMIN_ROLES)
  if (auth.error) return noStore(auth.error)
  const db = adminSupabase
  const params = new URL(request.url).searchParams
  const category = params.get('category')
  const active = params.get('active')

  const qs = await fetchAllPages(() => {
    let q = db.from('super_test_questions').select(QUESTION_COLS).order('id')
    if (CATEGORIES.includes(category)) q = q.eq('category', category)
    if (active === 'true' || active === 'false') q = q.eq('active', active === 'true')
    return q
  })
  if (qs.error) return readFail(qs.error)
  const keys = await fetchAllPages(() => db.from('super_test_answer_keys').select('question_id, correct_index, explanation').order('question_id'))
  if (keys.error) return readFail(keys.error)
  const attempts = await fetchAllPages(() => db.from('super_test_attempts').select('id, answers').order('id'))
  if (attempts.error) return readFail(attempts.error)

  const keyBy = new Map(keys.rows.map(k => [k.question_id, k]))
  const counts = new Map()
  for (const a of attempts.rows) {
    for (const it of Array.isArray(a.answers) ? a.answers : []) {
      const c = counts.get(it?.question_id) || { answered: 0, missed: 0 }
      c.answered++
      if (!it.is_correct) c.missed++
      counts.set(it?.question_id, c)
    }
  }
  const questions = qs.rows
    .map(q => ({
      ...q,
      correct_index: keyBy.get(q.id)?.correct_index ?? null,
      explanation: keyBy.get(q.id)?.explanation ?? null,
      answered: counts.get(q.id)?.answered || 0,
      missed: counts.get(q.id)?.missed || 0,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return json({ questions })
}

// POST { category, topic, store?, question, choices[4], correct_index, explanation, source? }
// New questions are active; id is server-generated ('qa-' + 8 hex). Body id / created_by ignored.
export async function POST(request) {
  const auth = await requireRole(request, SUPER_TEST_ADMIN_ROLES)
  if (auth.error) return noStore(auth.error)
  const db = adminSupabase
  const check = validateQuestionInput(await readBody(request))
  if (!check.ok) return json({ error: check.error }, 400)
  const v = check.value

  const id = 'qa-' + randomBytes(4).toString('hex')
  const now = new Date().toISOString()
  const row = { id, ...pick(v, QUESTION_FIELDS), is_sample: false, active: true, created_by: auth.userId, updated_by: auth.userId, created_at: now, updated_at: now }
  const { error: qErr } = await db.from('super_test_questions').insert(row)
  if (qErr) return writeFail(qErr)
  const { error: kErr } = await db.from('super_test_answer_keys').insert({ question_id: id, correct_index: v.correct_index, explanation: v.explanation, updated_at: now })
  if (kErr) {
    // No question may exist without a key: undo the question insert.
    await db.from('super_test_questions').delete().eq('id', id)
    return writeFail(kErr)
  }
  await logQ(id, { field_name: 'created', changed_by: auth.userId })
  return json({ question: { ...row, correct_index: v.correct_index, explanation: v.explanation, answered: 0, missed: 0 } })
}

// PATCH { id, ...fields } (partial) or { id, active: true|false }. Each changed field is logged.
// No DELETE: questions are never hard-deleted (attempts reference them) — deactivate instead.
export async function PATCH(request) {
  const auth = await requireRole(request, SUPER_TEST_ADMIN_ROLES)
  if (auth.error) return noStore(auth.error)
  const db = adminSupabase
  const body = await readBody(request)
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!id) return json({ error: 'Question id is required.' }, 400)
  const check = validateQuestionInput(body, { partial: true })
  if (!check.ok) return json({ error: check.error }, 400)

  const { data: old, error: oErr } = await db.from('super_test_questions').select(QUESTION_COLS).eq('id', id).maybeSingle()
  if (oErr) return writeFail(oErr)
  if (!old) return json({ error: 'Question not found.' }, 404)
  const { data: oldKey, error: kReadErr } = await db.from('super_test_answer_keys').select('question_id, correct_index, explanation').eq('question_id', id).maybeSingle()
  if (kReadErr) return writeFail(kReadErr)

  const qChanges = pick(check.value, QUESTION_FIELDS.filter(k => k in check.value && !same(check.value[k], old[k])))
  const kChanges = pick(check.value, KEY_FIELDS.filter(k => k in check.value && !same(check.value[k], oldKey?.[k])))
  const now = new Date().toISOString()
  if (!oldKey && Object.keys(kChanges).length && (kChanges.correct_index === undefined || kChanges.explanation === undefined)) {
    return json({ error: 'This question has no answer key yet: send both the correct choice and the explanation.' }, 400)
  }

  // Block choice / correct-answer edits while any super has this question in this week's
  // test and hasn't submitted it yet. Wording, explanation and active edits are still allowed.
  if (OPEN_LOCKED.some(k => k in qChanges || k in kChanges)) {
    const week = weekStartCentral()
    const assigns = await fetchAllPages(() => db.from('super_test_assignments').select('id, question_ids').eq('week_start', week).order('id'))
    if (assigns.error) return writeFail(assigns.error)
    const holding = assigns.rows.filter(a => Array.isArray(a.question_ids) && a.question_ids.includes(id)).map(a => a.id)
    if (holding.length) {
      const done = await fetchAllPages(() => db.from('super_test_attempts').select('assignment_id').in('assignment_id', holding).order('assignment_id'))
      if (done.error) return writeFail(done.error)
      const submitted = new Set(done.rows.map(r => r.assignment_id))
      const open = holding.filter(a => !submitted.has(a)).length
      if (open) return json({ error: `${open} super${open === 1 ? ' has' : 's have'} this question in an open test this week. Change the choices or correct answer after the week ends (Sunday night); wording and explanation can be edited now.`, open_tests: open }, 409)
    }
  }

  if (Object.keys(qChanges).length) {
    const { error } = await db.from('super_test_questions').update({ ...qChanges, updated_at: now, updated_by: auth.userId }).eq('id', id)
    if (error) return writeFail(error)
  }
  if (Object.keys(kChanges).length) {
    const { error } = oldKey
      ? await db.from('super_test_answer_keys').update({ ...kChanges, updated_at: now }).eq('question_id', id)
      : await db.from('super_test_answer_keys').insert({ question_id: id, correct_index: kChanges.correct_index, explanation: kChanges.explanation, updated_at: now })
    if (error) {
      // Don't leave the question half-edited: put the question fields back.
      if (Object.keys(qChanges).length) {
        await db.from('super_test_questions').update({ ...pick(old, Object.keys(qChanges)), updated_at: old.updated_at, updated_by: old.updated_by }).eq('id', id)
      }
      return writeFail(error)
    }
  }
  for (const [field, nv] of Object.entries({ ...qChanges, ...kChanges })) {
    const ov = field in qChanges ? old[field] : oldKey?.[field]
    await logQ(id, { field_name: field, old_value: asText(ov), new_value: asText(nv), changed_by: auth.userId })
  }

  const question = { ...old, ...qChanges, ...(Object.keys(qChanges).length ? { updated_at: now, updated_by: auth.userId } : {}),
    correct_index: kChanges.correct_index ?? oldKey?.correct_index ?? null, explanation: kChanges.explanation ?? oldKey?.explanation ?? null }
  return json({ question, changed: Object.keys({ ...qChanges, ...kChanges }) })
}
