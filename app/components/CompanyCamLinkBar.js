'use client'
import { useState, useEffect, useRef } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { canResumeImport, importRangeLabel, isBackgroundActive, isImportRunning, importStatusLabel, centralDateTimeLabel } from '../../lib/companycam-import'
import { atLeastPM } from '../../lib/roles'

// One row at the top of a job's Photos tab (prompt 82): which CompanyCam project feeds this
// job, link / unlink (Owner or PM), import of existing photos, and (Owner) a link to the
// Unmatched CompanyCam photos inbox. Import (prompt 84): a background run — pick an optional
// Central date range (blank Since = the whole project) and "Start background import"; the
// server runs one batch right away and /api/companycam/import-cron continues it about every
// minute until done, page open or not. While a run is active the bar refreshes its state every
// ~20 s (GET /api/companycam/import) and shows status, counts, last update and Stop. Only an
// Owner / PM polls (the GET route is atLeastPM); everyone else sees the status from the job row.
// An older client's one-batch import that is running right now shows "Import running…".
// Before migration 074 the job row has no companycam_project_id key: hidden for everyone but
// the Owner, who sees the migration note.
const s = {
  bar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: '#374151' },
  input: { padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', minWidth: '200px' },
  btn: { padding: '5px 10px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnGray: { padding: '5px 10px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  link: { color: '#e8590c', fontWeight: '600', textDecoration: 'none', fontSize: '12px' },
  err: { color: '#dc2626', fontSize: '12px', width: '100%' },
  ok: { color: '#15803d', fontSize: '12px', width: '100%' },
  help: { color: '#6b7280', fontSize: '12px', width: '100%' },
  status: { width: '100%', fontSize: '12px', color: '#374151', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
}

const POLL_MS = 20000

async function postJson(url, body) {
  const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let data = null
  try { data = await res.json() } catch { data = null }
  return { ok: res.ok, status: res.status, data: data || {} }
}

const counts = st => `Imported ${Number(st?.imported) || 0} · Already in portal ${Number(st?.skipped) || 0} · Failed ${Number(st?.failed) || 0}`

export default function CompanyCamLinkBar({ jobId, job, userRole, onImported }) {
  const isOwner = userRole === 'principal'
  const canEdit = atLeastPM(userRole)
  const [linkedId, setLinkedId] = useState(undefined) // undefined = use job prop
  const [projectName, setProjectName] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [since, setSince] = useState('') // blank = the whole project
  const [until, setUntil] = useState('')
  const [importState, setImportState] = useState(undefined) // undefined = use job prop
  const [showStart, setShowStart] = useState(false) // "Start over" on a stopped / paused run
  const lastImported = useRef(null)

  const hasColumn = !!job && Object.prototype.hasOwnProperty.call(job, 'companycam_project_id')
  const current = linkedId !== undefined ? linkedId : job?.companycam_project_id || null
  const state = importState !== undefined ? importState : job?.companycam_import_state || null
  const active = !!current && isBackgroundActive(state)
  // A legacy (non-background) batch running right now (fresh 'running'): no Start form.
  const runningNow = !!current && !active && isImportRunning(state)
  const poll = canEdit && (active || runningNow)

  // While a run is active (Owner / PM only): refresh its state every ~20 s and refresh the
  // gallery when the imported count moves (or the run ends).
  useEffect(() => {
    if (!poll || !jobId) return undefined
    let cancelled = false
    const tick = async () => {
      let r
      try { r = await authFetch(`/api/companycam/import?job_id=${encodeURIComponent(jobId)}`) } catch { return }
      if (cancelled || !r.ok) return
      let data = null
      try { data = await r.json() } catch { return }
      if (cancelled || !data) return
      const st = data.state || null
      setImportState(st)
      const n = Number(st?.imported) || 0
      if (lastImported.current !== null && (n !== lastImported.current || !(isBackgroundActive(st) || isImportRunning(st)))) onImported?.()
      lastImported.current = n
    }
    lastImported.current = Number(state?.imported) || 0
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll, jobId])

  if (!job || !jobId) return null
  if (!hasColumn) {
    if (!isOwner) return null
    return <div style={s.bar}>CompanyCam: <span style={{ color: '#a16207' }}>Needs database migration 074</span></div>
  }
  const resumable = !!current && !active && canResumeImport(state)
  const finished = !!current && state?.status === 'done'

  async function link(value) {
    setBusy(true); setErr(''); setMsg('')
    const r = await postJson('/api/companycam/link', { job_id: jobId, companycam_project_id: value })
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || `Error ${r.status}`); return }
    setLinkedId(r.data.companycam_project_id || null)
    if ((r.data.companycam_project_id || null) !== current) { setImportState(null); setShowStart(false) }
    setProjectName(r.data.project?.name || null)
    setDraft('')
    if (r.data.companycam_project_id) setMsg(`Linked.${r.data.unmatched_waiting ? ` ${r.data.unmatched_waiting} unmatched photo(s) from this project are waiting in the Unmatched list.` : ''}`)
    else setMsg('Unlinked. Photos already imported stay on the job.')
  }

  // Start (new range), resume or stop. Every call answers with the saved state.
  async function send(body, okMsg) {
    setBusy(true); setErr(''); setMsg('')
    const r = await postJson('/api/companycam/import', { job_id: jobId, ...body })
    setBusy(false)
    if (r.data.state !== undefined) setImportState(r.data.state || null)
    if (!r.ok) { setErr(r.data.error || `Error ${r.status}`); return false }
    setShowStart(false)
    if (okMsg) setMsg(okMsg)
    onImported?.()
    return true
  }

  function start() {
    if (until && since && since > until) { setErr('Since must be on or before the Until date.'); return }
    send({ start_date: since || null, end_date: until || null, background: true }, 'Background import started.')
  }

  function stop() {
    if (!window.confirm('Stop the background CompanyCam import? Photos already imported stay on the job. You can resume it later.')) return
    send({ stop: true }, 'Stopped. Resume in background continues where it left off.')
  }

  const lastUpdate = state?.updated_at ? centralDateTimeLabel(state.updated_at) : ''
  const statusBlock = (
    <div style={s.status}>
      <span style={{ fontWeight: 600 }}>{importStatusLabel(state)}</span>
      <span>Range {importRangeLabel(state)}</span>
      <span>{counts(state)}</span>
      {lastUpdate && <span style={{ color: '#6b7280' }}>Last update {lastUpdate} (Central)</span>}
    </div>
  )
  const startForm = (
    <>
      <label style={{ fontSize: '12px' }}>Since <input type="date" style={{ ...s.input, minWidth: 0 }} value={since} onChange={e => setSince(e.target.value)} disabled={busy} title="Optional. Blank = the whole project" /></label>
      <label style={{ fontSize: '12px' }}>Until <input type="date" style={{ ...s.input, minWidth: 0 }} value={until} onChange={e => setUntil(e.target.value)} disabled={busy} title="Optional end date" /></label>
      <button type="button" style={s.btnGray} disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start background import'}</button>
      <div style={s.help}>Runs on its own about every minute until done. You can close this page. Leave Since blank to bring in the whole project.</div>
    </>
  )

  return (
    <div style={s.bar}>
      <span style={{ fontWeight: 600 }}>CompanyCam:</span>
      <span>{current ? `Project ${current}${projectName ? ` — ${projectName}` : ''}` : 'not linked'}</span>
      {canEdit && (
        <>
          <input style={s.input} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Project id or CompanyCam project link" disabled={busy} />
          <button type="button" style={s.btn} disabled={busy || !draft.trim()} onClick={() => link(draft.trim())}>{busy ? 'Saving…' : 'Link'}</button>
          {current && <button type="button" style={s.btnGray} disabled={busy} onClick={() => { if (window.confirm('Unlink this CompanyCam project? Photos already imported stay on the job.')) link(null) }}>Unlink</button>}
        </>
      )}
      {isOwner && <a href="/companycam" style={s.link}>Unmatched CompanyCam photos</a>}

      {active && (
        <>
          {statusBlock}
          {state.last_error && <div style={s.err}>Last error: {state.last_error}</div>}
          {canEdit && <button type="button" style={s.btnGray} disabled={busy} onClick={stop}>Stop</button>}
          <div style={s.help}>Runs on its own about every minute until done. You can close this page.</div>
        </>
      )}
      {runningNow && (
        <>
          <div style={s.status}>
            <span style={{ fontWeight: 600 }}>Import running…</span>
            <span>Range {importRangeLabel(state)}</span>
            <span>{counts(state)}</span>
          </div>
        </>
      )}
      {resumable && !showStart && (
        <>
          {statusBlock}
          {state.last_error && <div style={s.err}>Last error: {state.last_error}</div>}
          {canEdit && <button type="button" style={s.btn} disabled={busy} onClick={() => send({ resume: true }, 'Resumed in the background.')}>Resume in background</button>}
          {canEdit && <button type="button" style={s.btnGray} disabled={busy} onClick={() => { setShowStart(true); setMsg('') }}>Start over with a new range</button>}
        </>
      )}
      {finished && !showStart && (
        <>
          <div style={s.status}><span style={{ fontWeight: 600, color: '#15803d' }}>Import finished</span><span>Range {importRangeLabel(state)}</span><span>{counts(state)}</span>{lastUpdate && <span style={{ color: '#6b7280' }}>{lastUpdate} (Central)</span>}</div>
          {canEdit && <button type="button" style={s.btnGray} disabled={busy} onClick={() => { setShowStart(true); setMsg('') }}>Import another range</button>}
        </>
      )}
      {canEdit && current && !active && !runningNow && (showStart || (!resumable && !finished)) && startForm}

      {err && <div style={s.err}>{err}</div>}
      {!err && msg && <div style={s.ok}>{msg}</div>}
    </div>
  )
}
