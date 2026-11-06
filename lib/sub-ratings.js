// Sub ratings: score validation (shared by the job page and the API) and the
// server check that the rated sub is on the job.

export const RATING_FIELDS = ['quality', 'timeliness', 'communication']

export const isScore = v => Number.isInteger(v) && v >= 1 && v <= 5

// Null when quality, timeliness and communication are all integers 1–5, else a message.
export function ratingScoresError(form) {
  const missing = RATING_FIELDS.filter(f => !isScore(form?.[f]))
  return missing.length ? `Rate ${missing.join(', ')} from 1 to 5.` : null
}

// Is this sub user on the job? A job_assignments row for them or their company,
// or a non-draft subcontract for them or their company. Returns { ok } or { error }.
export async function subIsOnJob(db, subId, jobId) {
  const { data: prof, error: pErr } = await db.from('profiles').select('id, company_id, invite_email').eq('id', subId).maybeSingle()
  if (pErr) return { error: pErr }
  if (!prof) return { ok: false }

  const who = [`sub_id.eq.${subId}`]
  if (prof.company_id) who.push(`company_id.eq.${prof.company_id}`)
  const { data: assigns, error: aErr } = await db.from('job_assignments').select('id').eq('job_id', jobId).or(who.join(',')).limit(1)
  if (aErr) return { error: aErr }
  if (assigns?.length) return { ok: true }

  const { data: contracts, error: cErr } = await db.from('subcontracts').select('id, status').eq('job_id', jobId).or(who.join(','))
  if (cErr) return { error: cErr }
  return { ok: (contracts || []).some(c => c.status !== 'draft') }
}

// Directory roll-up: group ratings by the rated person's company. Rows carry
// `profiles` = { company_id, company_name, invite_email }. The key is the
// companyKey() of the company's name (from `companies` by company_id, else the
// profile's company_name), so a sub_directory row looks itself up with
// companyKey(dir.company_name). People with no company fall back to
// 'email:<invite_email>'.
export function rollupRatingsByCompany(ratings, companies, keyOf) {
  const nameById = new Map((companies || []).map(c => [c.id, c.name]))
  const map = {}
  for (const r of ratings || []) {
    const p = r.profiles || {}
    const name = (p.company_id && nameById.get(p.company_id)) || p.company_name
    const key = name ? keyOf(name) : (p.invite_email ? 'email:' + p.invite_email.toLowerCase().trim() : null)
    if (!key) continue
    ;(map[key] = map[key] || []).push(r)
  }
  return map
}

// Rounded 0–5 star average over ratings that have all three scores 1–5.
export function averageStars(ratings) {
  const valid = (ratings || []).filter(r => !ratingScoresError(r))
  if (!valid.length) return 0
  return Math.round(valid.reduce((a, r) => a + (r.quality + r.timeliness + r.communication) / 3, 0) / valid.length)
}
