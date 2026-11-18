'use client'

// Daily report "Export PDF" / "Email to owner" controls (prompt 92). Shared by the commercial
// (app/jobdetail) and residential (app/residentialjobdetail) job pages.
// Callers render these only for canExportReports(role) (Owner / admin / PM / APM — never
// supers) and only on FINAL reports; the server re-checks role, job access and status.

import { useCallback, useEffect, useState } from 'react'
import {
  thisWeekCentral, validateRange, validateRecipients, validateMessage, defaultSubject, sentLabel,
  OWNER_EMAIL_NOTE, SUBJECT_MAX, NOTE_MAX, MAX_RANGE_DAYS,
} from '../../lib/daily-report-export'
import { fetchReportsPdf, emailReports, fetchReportSends, preOpenTab, saveBlob } from '../../lib/daily-report-export-client'

const btn = { minHeight: '36px', padding: '0 12px', fontSize: '12px', fontWeight: 700, border: '1px solid #d1d5db', background: '#fff', color: '#111827', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }
const btnPrimary = { ...btn, background: '#111827', color: '#fff', border: '1px solid #111827' }
const errText = { fontSize: '12px', color: '#b91c1c', margin: '6px 0 0' }

// Latest "Sent to …" per report. Errors → {} (no line shown).
export function useReportSends(fetchFn, jobId, enabled = true) {
  const [sends, setSends] = useState({})
  const reload = useCallback(async () => {
    if (!enabled || !jobId) { setSends({}); return }
    setSends(await fetchReportSends(fetchFn, jobId))
  }, [fetchFn, jobId, enabled])
  useEffect(() => { reload() }, [reload])
  return [sends, reload]
}

export function ReportSentLine({ send }) {
  const label = sentLabel(send)
  if (!label) return null
  return <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }} title={Array.isArray(send?.to) ? send.to.join(', ') : undefined}>{label}</span>
}

async function downloadPdf(fetchFn, payload) {
  const tab = preOpenTab()
  try {
    const { blob, filename } = await fetchReportsPdf(fetchFn, payload)
    saveBlob(blob, filename, tab)
  } catch (e) {
    if (tab && !tab.closed) tab.close()
    throw e
  }
}

// "Export PDF" + "Email to owner" on one FINAL report row.
export function ReportExportButtons({ report, fetchFn, onEmail, style }) {
  const [busy, setBusy] = useState(false)
  const b = style || btn
  return (
    <>
      <button type="button" style={{ ...b, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={async e => {
        e.stopPropagation()
        setBusy(true)
        try { await downloadPdf(fetchFn, { report_ids: [report.id] }) } catch (err) { alert(err.message) } finally { setBusy(false) }
      }}>{busy ? 'Building PDF…' : 'Export PDF'}</button>
      <button type="button" style={b} onClick={e => { e.stopPropagation(); onEmail({ report_ids: [report.id], dates: [report.report_date] }) }}>Email to owner</button>
    </>
  )
}

// From / To (+ "This week", Mon–Sun Central) → one combined PDF, or email it.
export function ReportRangeExport({ jobId, fetchFn, onEmail }) {
  const [range, setRange] = useState(() => thisWeekCentral())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const check = () => {
    const v = validateRange(range.from, range.to)
    setError(v.ok ? '' : v.error)
    return v.ok
  }
  const input = { fontSize: '16px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '8px', minHeight: '36px', background: '#fff', color: '#111827' }
  return (
    <div className="drx-range" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '8px', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '10px', background: '#f9fafb', margin: '0 0 12px' }}>
      <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#6b7280', width: '100%' }}>Export range (final reports, up to {MAX_RANGE_DAYS} days)</div>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '11px', color: '#6b7280', gap: '2px' }}>From
        <input type="date" style={input} value={range.from} max={range.to || undefined} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '11px', color: '#6b7280', gap: '2px' }}>To
        <input type="date" style={input} value={range.to} min={range.from || undefined} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
      </label>
      <button type="button" style={btn} onClick={() => { setRange(thisWeekCentral()); setError('') }}>This week</button>
      <button type="button" style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={async () => {
        if (!check()) return
        setBusy(true)
        try { await downloadPdf(fetchFn, { job_id: jobId, range }) } catch (err) { setError(err.message) } finally { setBusy(false) }
      }}>{busy ? 'Building PDF…' : 'Export range'}</button>
      <button type="button" style={btn} onClick={() => { if (check()) onEmail({ job_id: jobId, range: { ...range } }) }}>Email range to owner</button>
      {error && <p style={{ ...errText, width: '100%' }}>{error}</p>}
    </div>
  )
}

const MODAL_CSS = `
.drx-overlay{position:fixed;inset:0;background:rgba(17,24,39,.5);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
.drx-modal{background:#fff;border-radius:12px;width:100%;max-width:600px;max-height:90vh;overflow-y:auto;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.2);box-sizing:border-box}
.drx-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
@media (max-width:600px){
  .drx-overlay{padding:0;align-items:stretch}
  .drx-modal{max-width:none;max-height:none;min-height:100%;border-radius:0;padding:16px 16px calc(16px + env(safe-area-inset-bottom))}
  .drx-actions{flex-direction:column-reverse}
  .drx-actions button{width:100%;min-height:44px}
}`

// target: { report_ids, dates } | { job_id, range }
export function EmailReportsModal({ target, job, fetchFn, onClose, onSent }) {
  const [to, setTo] = useState(job?.owner_email || '')
  const [subject, setSubject] = useState(() => defaultSubject(job, target?.dates || [], target?.range))
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const ownerEmpty = !String(job?.owner_email || '').trim()
  const payload = target?.report_ids ? { report_ids: target.report_ids } : { job_id: target?.job_id, range: target?.range }

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const label = { display: 'block', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '12px 0 4px' }
  const field = { width: '100%', boxSizing: 'border-box', fontSize: '16px', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontFamily: 'inherit', color: '#111827', background: '#fff' }

  const send = async () => {
    const rv = validateRecipients(to)
    if (!rv.ok) { setError(rv.error); return }
    const mv = validateMessage({ subject, note }, defaultSubject(job, target?.dates || [], target?.range))
    if (!mv.ok) { setError(mv.error); return }
    setError('')
    setSending(true)
    try {
      const res = await emailReports(fetchFn, { ...payload, to: rv.recipients, subject: mv.subject, note: mv.note })
      onSent(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="drx-overlay" onClick={() => { if (!sending) onClose() }}>
      <style>{MODAL_CSS}</style>
      <div className="drx-modal" role="dialog" aria-modal="true" aria-label="Email daily report to owner" onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '16px', fontWeight: 800, color: '#111827' }}>Email to owner</div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>The PDF is attached. Internal-only photos are left out.</div>

        <label style={label} htmlFor="drx-to">To</label>
        <textarea id="drx-to" style={{ ...field, minHeight: '44px' }} rows={2} value={to} disabled={sending} placeholder="owner@example.com, another@example.com"
          onChange={e => setTo(e.target.value)} />
        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '3px' }}>Separate addresses with commas or new lines (up to 20).</div>
        {ownerEmpty && <div style={{ fontSize: '12px', color: '#92400e', marginTop: '4px' }}>{OWNER_EMAIL_NOTE}</div>}

        <label style={label} htmlFor="drx-subject">Subject</label>
        <input id="drx-subject" style={field} value={subject} maxLength={SUBJECT_MAX} disabled={sending} onChange={e => setSubject(e.target.value)} />

        <label style={label} htmlFor="drx-note">Note (optional)</label>
        <textarea id="drx-note" style={{ ...field, minHeight: '80px' }} rows={4} value={note} maxLength={NOTE_MAX} disabled={sending} onChange={e => setNote(e.target.value)} />

        {preview && (
          <div style={{ marginTop: '12px' }}>
            <iframe title="PDF preview" src={preview} style={{ width: '100%', height: '50vh', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
            <a href={preview} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#2563eb' }}>Open the PDF in a new tab</a>
          </div>
        )}

        {error && <p style={errText} role="alert">{error}</p>}

        <div className="drx-actions">
          <button type="button" style={btn} disabled={sending} onClick={onClose}>Cancel</button>
          <button type="button" style={{ ...btn, opacity: previewing ? 0.6 : 1 }} disabled={previewing || sending} onClick={async () => {
            setPreviewing(true)
            setError('')
            try {
              const { blob } = await fetchReportsPdf(fetchFn, payload)
              setPreview(URL.createObjectURL(blob))
            } catch (e) { setError(e.message) } finally { setPreviewing(false) }
          }}>{previewing ? 'Building preview…' : 'Preview PDF'}</button>
          <button type="button" style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={send}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  )
}
