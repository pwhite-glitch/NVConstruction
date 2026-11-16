// Browser-side daily report save / finalize / reopen (prompt 85). Every write goes through
// /api/daily-reports (no browser insert / update of daily_reports), so job assignment, the
// draft rules and "deliveries once" are enforced on the server.
// fetchFn = authFetch (adds the Supabase bearer token).

async function send(fetchFn, url, method, body) {
  let res
  try {
    res = await fetchFn(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) throw new Error(data.error || `Could not save the daily report (server returned ${res.status}).`)
  return data
}

// Save a report.
//   id missing → POST (new draft, or new final when finalize)
//   id set     → PATCH the draft, then (finalize) POST /finalize { id }
// → { report, warning? }
export async function saveDailyReport(fetchFn, { id = null, payload, finalize = false }) {
  if (!id) {
    const data = await send(fetchFn, '/api/daily-reports', 'POST', { ...payload, finalize: !!finalize })
    return { report: data.report, warning: data.warning }
  }
  const patched = await send(fetchFn, '/api/daily-reports', 'PATCH', { ...payload, id })
  if (!finalize) return { report: patched.report, warning: patched.warning }
  const data = await send(fetchFn, '/api/daily-reports/finalize', 'POST', { id })
  return { report: data.report, warning: data.warning }
}

export async function reopenDailyReport(fetchFn, id) {
  const data = await send(fetchFn, '/api/daily-reports/reopen', 'POST', { id })
  return data.report
}

export const FINALIZE_LABEL = 'Finalize – 100% complete'
// Peyton's decision 1: Owner / PM already see drafts (labeled Draft), so the confirm says
// what actually changes — it becomes the official report (owner portal, weather days).
export const FINALIZE_CONFIRM = "Finalize this report? It becomes the official report for Peyton, the office and the owner, and you won't be able to edit it unless an Owner or PM reopens it."
export const REOPEN_CONFIRM = 'Reopen this finalized report as a draft? It will be hidden from the owner portal and weather-day counts until it is finalized again.'

// "Draft" label used everywhere a draft appears (Peyton's decision 1).
export const DRAFT_BADGE = { fontSize: '10px', fontWeight: '800', letterSpacing: '0.5px', color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', padding: '1px 6px', borderRadius: '4px', textTransform: 'uppercase' }
