// Browser side of the daily report PDF export / email (prompt 92). fetchFn = authFetch (adds the
// Supabase bearer token). The server re-checks role, job access and draft status every time.

const URL_PATH = '/api/daily-reports/export'

async function errorText(res, fallback) {
  const data = await res.json().catch(() => ({}))
  return data?.error || `${fallback} (server returned ${res.status}).`
}

function filenameFrom(res, fallback = 'Daily Report.pdf') {
  const cd = res.headers?.get?.('content-disposition') || ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (star) { try { return decodeURIComponent(star[1]) } catch { /* fall through */ } }
  const plain = /filename="([^"]+)"/i.exec(cd)
  return plain ? plain[1] : fallback
}

// payload: { report_ids } | { job_id, range: { from, to } } → { blob, filename }
export async function fetchReportsPdf(fetchFn, payload) {
  let res
  try {
    res = await fetchFn(URL_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  if (!res.ok) throw new Error(await errorText(res, 'Could not build the PDF'))
  const blob = await res.blob()
  return { blob: blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }), filename: filenameFrom(res) }
}

// payload: { report_ids } | { job_id, range }, plus { to: [...], subject, note } → server JSON
export async function emailReports(fetchFn, payload) {
  let res
  try {
    res = await fetchFn(URL_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, mode: 'email' }) })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) throw new Error(data.error || `Email not sent (server returned ${res.status}).`)
  return data
}

// Latest send per report for the "Sent to …" line. Any failure → {} (the line just isn't shown).
export async function fetchReportSends(fetchFn, jobId) {
  if (!jobId) return {}
  try {
    const res = await fetchFn(`${URL_PATH}?job_id=${encodeURIComponent(jobId)}`, { method: 'GET' })
    if (!res.ok) return {}
    const data = await res.json().catch(() => ({}))
    return data && typeof data.sends === 'object' && data.sends ? data.sends : {}
  } catch { return {} }
}

export const isIOS = () => typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

// iOS Safari blocks window.open after an await, so open the tab during the tap (before the
// fetch) and point it at the blob afterwards. Elsewhere returns null (a normal download is used).
export function preOpenTab() {
  if (!isIOS() || typeof window === 'undefined') return null
  try { return window.open('', '_blank') } catch { return null }
}

// Save a PDF blob: <a download> everywhere; on iOS the pre-opened tab shows it instead.
export function saveBlob(blob, filename, tab = null) {
  const url = URL.createObjectURL(blob)
  if (tab && !tab.closed) {
    tab.location.href = url
  } else {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
