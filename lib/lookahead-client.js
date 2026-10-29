// Browser-side calls for the 2-week lookahead, shared by the job page and the field app.
// Every call resolves to { data, error, warning, ... } and never throws.
import { copyableActivity } from './lookahead-fields'

async function call(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ...json, error: json.error || `Server error (${res.status})` }
    return json
  } catch (e) {
    return { error: e.message || 'Network error' }
  }
}

export const loadLookahead = (jobId, weekStart) =>
  call('GET', `/api/lookaheads?job_id=${jobId}&week_start=${weekStart}`).then(r => ({ ...r, data: r.data?.[0] || null }))

export const createLookahead = (jobId, weekStart, submittedBy) =>
  call('POST', '/api/lookaheads', { job_id: jobId, week_start_date: weekStart, submitted_by: submittedBy || null })

// Creates this week's lookahead if needed and carries last week's unfinished work into it.
// Resolves to { data: lookahead with lookahead_activities, added, warning }.
export const copyFromLastWeek = (jobId, weekStart, submittedBy) =>
  call('POST', '/api/lookaheads', { action: 'copy_forward', job_id: jobId, week_start_date: weekStart, submitted_by: submittedBy || null })

export const setLookaheadStatus = (id, status) => call('PUT', '/api/lookaheads', { id, status })

// Add (no id) or edit (id) from the Add/Edit Activity form.
export const saveActivity = (form, { id, lookaheadId }) =>
  id ? call('PUT', '/api/lookahead-activities', { ...form, id }) : call('POST', '/api/lookahead-activities', { ...form, lookahead_id: lookaheadId })

// Partial update: status tap, drag, Move to day.
export const updateActivity = (id, fields) => call('PUT', '/api/lookahead-activities', { ...fields, id })

export const deleteActivity = id => call('DELETE', '/api/lookahead-activities', { id })

export const duplicateActivity = act =>
  call('POST', '/api/lookahead-activities', { ...copyableActivity(act), lookahead_id: act.lookahead_id })

export const loadSendPreview = id => call('GET', `/api/lookaheads/send?id=${id}`)
export const sendToSubs = id => call('POST', '/api/lookaheads/send', { id })

export const loadForecast = jobId => call('GET', `/api/lookahead-weather?job_id=${jobId}`)
