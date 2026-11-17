import { createClient } from '@supabase/supabase-js'
import { requireRole } from '../../../../../lib/server-auth'
import { isBotAccount } from '../../../../../lib/bot-rules'
import { SUPER_TEST_ADMIN_ROLES, weekStartCentral, addDays, missedTopics, parseStatsWeeks } from '../../../../../lib/super-test'
import { MIGRATION, isMissingTable, json, noStore, fetchAllPages } from '../../../../../lib/super-test-server'

export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const fail = e => (isMissingTable(e) ? json({ migration_required: MIGRATION }) : json({ error: e.message || 'Could not load test stats.' }, 500))

// GET /api/super-test/admin/stats?weeks=8 — principal / admin only.
// { current_week, weeks (Mondays, newest first), supers, scores, this_week, topics }
export async function GET(request) {
  const auth = await requireRole(request, SUPER_TEST_ADMIN_ROLES)
  if (auth.error) return noStore(auth.error)
  const db = adminSupabase
  const n = parseStatsWeeks(new URL(request.url).searchParams.get('weeks'))
  const current_week = weekStartCentral()
  const weeks = Array.from({ length: n }, (_, i) => addDays(current_week, -7 * i))
  const oldest = weeks[weeks.length - 1]

  // '*' so is_bot (migration 036) is read when present. profiles has no email column: bot
  // logins are also caught by their auth email (isBotAccount → isBotEmail), like /api/team-members.
  const profs = await fetchAllPages(() => db.from('profiles').select('*').eq('role', 'super').order('id'))
  if (profs.error) return json({ error: profs.error.message }, 500)
  const { data: authData } = await db.auth.admin.listUsers({ perPage: 1000 })
  const emailOf = Object.fromEntries((authData?.users || []).map(u => [u.id, u.email]))
  const supers = profs.rows
    .filter(p => !isBotAccount(p, emailOf[p.id]))
    .map(p => ({ id: p.id, full_name: p.full_name || '(no name)' }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  const attempts = await fetchAllPages(() => db.from('super_test_attempts').select('super_id, week_start, score, total, answers')
    .gte('week_start', oldest).lte('week_start', current_week).order('week_start'))
  if (attempts.error) return fail(attempts.error)
  const assigns = await fetchAllPages(() => db.from('super_test_assignments').select('super_id, week_start').eq('week_start', current_week).order('super_id'))
  if (assigns.error) return fail(assigns.error)

  // Only current, non-bot supers: a former super (role changed) or a bot account is left out of
  // the score grid and the most-missed topics alike.
  const superIds = new Set(supers.map(s => s.id))
  const rows = attempts.rows.filter(a => superIds.has(a.super_id))
  const scores = rows.map(a => ({ super_id: a.super_id, week_start: a.week_start, score: a.score, total: a.total }))
  const opened = new Set(assigns.rows.map(a => a.super_id))
  const doneNow = new Map(rows.filter(a => a.week_start === current_week).map(a => [a.super_id, a]))
  const this_week = supers.map(s => {
    const a = doneNow.get(s.id)
    if (a) return { super_id: s.id, full_name: s.full_name, status: 'submitted', score: a.score, total: a.total }
    return { super_id: s.id, full_name: s.full_name, status: opened.has(s.id) ? 'opened' : 'not_started' }
  })

  return json({ current_week, weeks, supers, scores, this_week, topics: missedTopics(rows) })
}
