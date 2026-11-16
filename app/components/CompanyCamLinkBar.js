'use client'
import { useState, useRef } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { IMPORT_SESSION_CAP, defaultImportSince, nextImportStep, canResumeImport, importRangeLabel } from '../../lib/companycam-import'

// One row at the top of a job's Photos tab (prompt 82): which CompanyCam project feeds this
// job, link / unlink (Owner or PM), one-time import of existing photos, and (Owner) a link to
// the Unmatched CompanyCam photos inbox. Import (Addendum A): a Central date range (default
// the last 30 days), batches auto-continue until done or IMPORT_SESSION_CAP photos this click,
// then pause; the run's cursor lives on the server (jobs.companycam_import_state). Before migration 074 the job row has no
// companycam_project_id key: hidden for everyone but the Owner, who sees the migration note.
const s = {
  bar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: '#374151' },
  input: { padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', minWidth: '200px' },
  btn: { padding: '5px 10px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnGray: { padding: '5px 10px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  link: { color: '#e8590c', fontWeight: '600', textDecoration: 'none', fontSize: '12px' },
  err: { color: '#dc2626', fontSize: '12px', width: '100%' },
  ok: { color: '#15803d', fontSize: '12px', width: '100%' },
}

async function postJson(url, body) {
  const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let data = null
  try { data = await res.json() } catch { data = null }
  return { ok: res.ok, status: res.status, data: data || {} }
}

export default function CompanyCamLinkBar({ jobId, job, userRole, onImported }) {
  const isOwner = userRole === 'principal'
  const canEdit = isOwner || userRole === 'pm'
  const [linkedId, setLinkedId] = useState(undefined) // undefined = use job prop
  const [projectName, setProjectName] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [since, setSince] = useState(() => defaultImportSince())
  const [until, setUntil] = useState('')
  const [importState, setImportState] = useState(undefined) // undefined = use job prop
  const [capPaused, setCapPaused] = useState(false)
  const stopRef = useRef(false)

  if (!job || !jobId) return null
  const hasColumn = Object.prototype.hasOwnProperty.call(job, 'companycam_project_id')
  if (!hasColumn) {
    if (!isOwner) return null
    return <div style={s.bar}>CompanyCam: <span style={{ color: '#a16207' }}>Needs database migration 074</span></div>
  }
  const current = linkedId !== undefined ? linkedId : job.companycam_project_id || null
  const state = importState !== undefined ? importState : job.companycam_import_state || null
  const resumable = !importing && canResumeImport(state)

  async function link(value) {
    setBusy(true); setErr(''); setMsg('')
    const r = await postJson('/api/companycam/link', { job_id: jobId, companycam_project_id: value })
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || `Error ${r.status}`); return }
    setLinkedId(r.data.companycam_project_id || null)
    if ((r.data.companycam_project_id || null) !== current) { setImportState(null); setCapPaused(false) }
    setProjectName(r.data.project?.name || null)
    setDraft('')
    if (r.data.companycam_project_id) setMsg(`Linked.${r.data.unmatched_waiting ? ` ${r.data.unmatched_waiting} unmatched photo(s) from this project are waiting in the Unmatched list.` : ''}`)
    else setMsg('Unlinked. Photos already imported stay on the job.')
  }

  // resume=false starts the chosen range over; true continues the server's saved cursor.
  async function runImport(resume) {
    if (!resume && until && since && since > until) { setErr('Since must be on or before the end date.'); return }
    setImporting(true); setErr(''); setCapPaused(false); setMsg('Importing…')
    stopRef.current = false
    let imported = 0
    let skipped = 0
    let failed = 0
    let first = true
    for (let guard = 0; guard < 1000; guard++) {
      if (stopRef.current) { setMsg(`Stopped. Imported ${imported} this time — Resume continues where it left off.`); break }
      const body = first && !resume ? { job_id: jobId, start_date: since || null, end_date: until || null } : { job_id: jobId, resume: true }
      first = false
      const r = await postJson('/api/companycam/import', body)
      if (!r.ok) { setErr(r.data.error || `Error ${r.status}`); break }
      if (r.data.state) setImportState(r.data.state)
      imported += r.data.imported || 0
      skipped += r.data.skipped || 0
      failed += (r.data.failed || []).length
      const counts = `Imported ${imported}, skipped ${skipped}${failed ? `, failed ${failed}` : ''}`
      const step = nextImportStep({ done: r.data.done, sessionImported: imported })
      if (step === 'done') { setMsg(`Done. ${counts}.`); break }
      if (step === 'pause') { setCapPaused(true); setMsg(`Imported ${imported} so far. Continue?`); break }
      setMsg(`${counts}…`)
    }
    setImporting(false)
    onImported?.()
  }

  return (
    <div style={s.bar}>
      <span style={{ fontWeight: 600 }}>CompanyCam:</span>
      <span>{current ? `Project ${current}${projectName ? ` — ${projectName}` : ''}` : 'not linked'}</span>
      {canEdit && (
        <>
          <input style={s.input} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Project id or CompanyCam project link" disabled={busy || importing} />
          <button type="button" style={s.btn} disabled={busy || importing || !draft.trim()} onClick={() => link(draft.trim())}>{busy ? 'Saving…' : 'Link'}</button>
          {current && <button type="button" style={s.btnGray} disabled={busy || importing} onClick={() => { if (window.confirm('Unlink this CompanyCam project? Photos already imported stay on the job.')) link(null) }}>Unlink</button>}
          {current && !importing && !resumable && (
            <>
              <label style={{ fontSize: '12px' }}>Since <input type="date" style={{ ...s.input, minWidth: 0 }} value={since} onChange={e => setSince(e.target.value)} disabled={busy} /></label>
              <label style={{ fontSize: '12px' }}>to <input type="date" style={{ ...s.input, minWidth: 0 }} value={until} onChange={e => setUntil(e.target.value)} disabled={busy} title="Optional end date" /></label>
              <button type="button" style={s.btnGray} disabled={busy} onClick={() => runImport(false)}>Import existing CompanyCam photos</button>
            </>
          )}
          {current && resumable && (
            <>
              <span style={{ fontSize: '12px', color: '#a16207' }}>{capPaused ? `Paused after ${IMPORT_SESSION_CAP} this time. ` : ''}Import paused at {Number(state.imported) || 0} photos (range {importRangeLabel(state)})</span>
              <button type="button" style={s.btn} disabled={busy} onClick={() => runImport(true)}>{capPaused ? 'Continue' : 'Resume'}</button>
              <button type="button" style={s.btnGray} disabled={busy} onClick={() => { setImportState(null); setCapPaused(false); setMsg('') }}>Start over</button>
            </>
          )}
          {importing && <button type="button" style={s.btnGray} onClick={() => { stopRef.current = true }}>Stop</button>}
        </>
      )}
      {isOwner && <a href="/companycam" style={s.link}>Unmatched CompanyCam photos</a>}
      {err && <div style={s.err}>{err}</div>}
      {!err && msg && <div style={s.ok}>{msg}</div>}
    </div>
  )
}
