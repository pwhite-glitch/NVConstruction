import { useCallback, useRef, useState } from 'react'
import { suggestNextJobNumber, applyJobNumberSuggestion, countDuplicateJobNumbers, jobNumberWarning } from './job-numbers'

// Loads the job-number inventory from GET /api/jobs/numbers (lib/supabase.js
// adds the session token to same-origin /api calls).
export async function fetchJobNumbers(fetchImpl = fetch) {
  const res = await fetchImpl('/api/jobs/numbers', { cache: 'no-store' })
  let body = null
  try { body = await res.json() } catch {}
  if (!res.ok || !Array.isArray(body?.jobs)) throw new Error(body?.error || `Could not load job numbers (${res.status})`)
  return body.jobs
}

// Save-time recheck. Reloads the inventory (another tab or person may have
// used the number since the form opened) and asks before reusing a number.
// Returns true to go ahead. If the recheck itself fails the save proceeds and
// the database stays the authority.
export async function confirmJobNumberFree(value, { load = fetchJobNumbers, confirm = m => window.confirm(m) } = {}) {
  const v = String(value ?? '').trim()
  if (!v) return false
  let jobs
  try { jobs = await load() } catch { return true }
  if (countDuplicateJobNumbers(jobs, v) === 0) return true
  return confirm(`Job number ${v} is already used by an existing job.\n\nCreate another job with the same number anyway?`)
}

// One inventory per screen, shared by that screen's new-job forms.
// seed(key, jobType, setForm) refreshes the inventory and fills the form's
// job_number with the next suggestion unless the user has already typed one.
export function useJobNumbers() {
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState('')
  const lastSuggestion = useRef({})

  const load = useCallback(async () => {
    try {
      const list = await fetchJobNumbers()
      setJobs(list)
      setError('')
      return list
    } catch (e) {
      setError(e?.message || 'Could not load job numbers')
      throw e
    }
  }, [])

  const seed = useCallback(async (key, jobType, setForm, field = 'job_number') => {
    let list
    try { list = await load() } catch { return }
    const next = suggestNextJobNumber(list, jobType)
    const prev = lastSuggestion.current[key]
    lastSuggestion.current[key] = next
    setForm(f => {
      const cur = f?.[field]
      const val = applyJobNumberSuggestion(cur, prev, next)
      return val === cur ? f : { ...f, [field]: val }
    })
  }, [load])

  const warning = useCallback(value => jobNumberWarning(jobs, value), [jobs])

  return { jobs, error, load, seed, warning }
}
