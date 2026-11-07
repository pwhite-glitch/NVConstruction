// Job-number suggestions and duplicate checks for every new-job screen.
// No imports, so the browser screens and API routes/tests share it.
//
// A suggestion is only a starting value: the field stays editable, nothing is
// reserved, and no existing job is ever renumbered.
//
// Series rules (deliberate, the same on every screen):
//  - A job number belongs to a series when it is digits with an optional short
//    prefix: "7469" (no prefix), "R-101" / "R101" (letters, optional dash), or
//    "2026-042" (four-digit year + dash). Anything else ("7469A", "12-34-56",
//    blank) is ignored for suggestions but still counts for duplicates.
//  - Numbers compare as integers inside a series, so 10 > 9 (never A-Z order).
//  - The series for a new job is the prefix family used most by existing jobs
//    of that type (commercial / residential). With no jobs of that type, the
//    default is no prefix for commercial and "R-" for residential. Year
//    prefixes count as one family and the latest year in use is continued (the
//    year is never rolled over automatically).
//  - Next = highest number in that series across ALL jobs (any type, status,
//    archived or not) + 1, keeping the prefix as written and the zero padding
//    of the highest number ("2026-042" -> "2026-043", "099" -> "100").
//  - An empty series gives no suggestion; the field stays blank for the user.
//  - Duplicate = same text ignoring case/spaces, or the same series and the
//    same integer ("042" vs "42").

const SERIES_RE = /^(\d{4}-|[A-Za-z]{1,4}-?)?(\d{1,9})$/
const YEAR_RE = /^\d{4}-$/

export const DEFAULT_PREFIX = { commercial: '', residential: 'R-' }

export function parseJobNumber(value) {
  if (value == null) return null
  const s = String(value).trim()
  const m = SERIES_RE.exec(s)
  if (!m) return null
  const rawPrefix = m[1] || ''
  return { rawPrefix, prefix: rawPrefix.toUpperCase(), digits: m[2], n: Number(m[2]) }
}

const typeOf = j => (j?.job_type === 'residential' ? 'residential' : 'commercial')
const numOf = j => (j && typeof j === 'object' ? j.job_number : j)
const familyOf = prefix => (YEAR_RE.test(prefix) ? 'YEAR' : prefix)

// The prefix new jobs of this type should use (see rules above).
export function seriesPrefixFor(jobs, jobType = 'commercial') {
  const type = jobType === 'residential' ? 'residential' : 'commercial'
  const counts = new Map()
  let latestYear = ''
  for (const j of jobs || []) {
    if (typeOf(j) !== type) continue
    const p = parseJobNumber(numOf(j))
    if (!p) continue
    const fam = familyOf(p.prefix)
    counts.set(fam, (counts.get(fam) || 0) + 1)
    if (fam === 'YEAR' && p.prefix > latestYear) latestYear = p.prefix
  }
  const def = DEFAULT_PREFIX[type]
  if (!counts.size) return def
  let best = null
  for (const [fam, c] of counts) {
    if (best == null || c > counts.get(best) || (c === counts.get(best) && (fam === def || (best !== def && fam < best)))) best = fam
  }
  return best === 'YEAR' ? latestYear : best
}

// Next job number for a new job of this type, or '' when the series is empty.
export function suggestNextJobNumber(jobs, jobType = 'commercial') {
  const prefix = seriesPrefixFor(jobs, jobType)
  let top = null
  for (const j of jobs || []) {
    const p = parseJobNumber(numOf(j))
    if (!p || p.prefix !== prefix) continue
    if (!top || p.n > top.n || (p.n === top.n && p.digits.length > top.digits.length)) top = p
  }
  if (!top) return ''
  return top.rawPrefix + String(top.n + 1).padStart(top.digits.length, '0')
}

// How many existing jobs already use this number (0 when blank).
export function countDuplicateJobNumbers(jobs, value) {
  const v = String(value ?? '').trim()
  if (!v) return 0
  const lower = v.toLowerCase()
  const pv = parseJobNumber(v)
  let count = 0
  for (const j of jobs || []) {
    const raw = numOf(j)
    if (raw == null) continue
    const s = String(raw).trim()
    if (!s) continue
    if (s.toLowerCase() === lower) { count++; continue }
    const p = pv && parseJobNumber(s)
    if (p && p.prefix === pv.prefix && p.n === pv.n) count++
  }
  return count
}

export function jobNumberWarning(jobs, value) {
  const v = String(value ?? '').trim()
  if (!v || !jobs) return ''
  return countDuplicateJobNumbers(jobs, v) > 0
    ? `Job number ${v} is already used by an existing job. Change it unless you really mean to reuse it.`
    : ''
}

// Fill the field with the new suggestion only if the user has not typed their
// own number: it is blank, or still equal to the previous suggestion. A late
// lookup therefore never overwrites typing.
export function applyJobNumberSuggestion(current, previousSuggestion, nextSuggestion) {
  const cur = current == null ? '' : String(current)
  if (!nextSuggestion) return cur
  if (cur.trim() === '' || (previousSuggestion && cur === previousSuggestion)) return nextSuggestion
  return cur
}

// Clear message for a failed job insert (unique-index violation or otherwise).
export function jobNumberSaveError(error, value) {
  const msg = error?.message || String(error || 'Could not create the job.')
  if (error?.code === '23505' || (/duplicate key|already exists/i.test(msg) && /job_number/i.test(msg))) {
    return `Job number ${String(value ?? '').trim()} already exists. Choose a different number.`
  }
  return msg
}

// Roles that may read the job-number inventory (the roles that create jobs).
export const JOB_NUMBER_ROLES = new Set(['principal', 'pm', 'apm', 'admin', 'dev'])
