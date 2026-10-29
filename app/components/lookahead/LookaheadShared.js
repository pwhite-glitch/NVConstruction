'use client'
import React, { useState, useEffect, useRef } from 'react'
import { ACTIVITY_STATUSES, statusInfo, LOOKAHEAD_STAGES, lookaheadStage, stageHistory } from '../../../lib/lookahead-fields'
import { forecastText, isRainRisk } from '../../../lib/lookahead-weather'
import { loadForecast, loadSendPreview, sendToSubs } from '../../../lib/lookahead-client'

// Lookahead pieces used by both the job page (PM) and the field app (super),
// so the two sides look and behave the same.

const fmtDay = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const fmtWhen = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// Daily forecast for the job, keyed by date. {} until loaded or when unavailable.
export function useLookaheadForecast(jobId) {
  const [days, setDays] = useState({})
  useEffect(() => {
    if (!jobId) return
    let live = true
    loadForecast(jobId).then(r => { if (live) setDays(r?.days || {}) })
    return () => { live = false }
  }, [jobId])
  return days
}

export function DayWeather({ day, align = 'center' }) {
  if (!day) return null
  const risk = isRainRisk(day)
  return (
    <div title={`${day.label}${day.precip != null ? ` · ${day.precip}% chance of precipitation` : ''}`}
      style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: align, flexWrap: 'wrap', fontSize: '10px', color: '#6b7280', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
      <span>{day.icon} {forecastText(day)}</span>
      {risk && <span style={{ fontSize: '10px', fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '99px', padding: '0 6px' }}>Rain risk</span>}
    </div>
  )
}

// On a card: outdoor-looking work on a Rain risk day.
export function RainTag() {
  return <span title="Outdoor work on a day with 50%+ chance of rain" style={{ fontSize: '10px', fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '99px', padding: '1px 6px' }}>☔ Rain risk</span>
}

// One-tap status: tap opens a small picker. Clicks don't reach the card underneath.
export function StatusChip({ status, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const st = statusInfo(status)
  useEffect(() => {
    if (!open) return
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close) }
  }, [open])
  const stop = e => e.stopPropagation()
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }} onClick={stop} onMouseDown={stop} draggable={false} onDragStart={e => e.preventDefault()}>
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)} aria-label={`Status: ${st.label}. Tap to change.`}
        style={{ fontSize: '10px', fontWeight: 700, color: st.fg, background: st.bg, border: `1px solid ${st.bd}`, borderRadius: '99px', padding: '2px 8px', cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
        {st.label} ▾
      </button>
      {open && (
        <span style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.12)', padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '120px' }}>
          {ACTIVITY_STATUSES.map(opt => (
            <button key={opt.key} type="button" onClick={() => { setOpen(false); if (opt.key !== st.key) onChange(opt.key) }}
              style={{ textAlign: 'left', fontSize: '12px', fontWeight: opt.key === st.key ? 700 : 500, color: opt.fg, background: opt.key === st.key ? opt.bg : 'transparent', border: 'none', borderRadius: '6px', padding: '7px 10px', cursor: 'pointer' }}>
              {opt.label}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

// Start / End date inputs for the Add/Edit Activity form. End is optional (one day).
export function ActivityDateFields({ form, setForm, labelStyle, inputStyle }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
      <div>
        <label style={labelStyle}>Start date</label>
        <input type="date" style={inputStyle} value={form.planned_date || ''}
          onChange={e => { const v = e.target.value; setForm(f => ({ ...f, planned_date: v, end_date: f.end_date && f.end_date < v ? '' : f.end_date })) }} />
      </div>
      <div>
        <label style={labelStyle}>End date <span style={{ fontWeight: 400, color: '#6b7280' }}>(multi-day)</span></label>
        <input type="date" style={inputStyle} min={form.planned_date || undefined} value={form.end_date || ''}
          onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
      </div>
    </div>
  )
}

// Why the save button is disabled.
export function FormHint({ problem }) {
  if (!problem) return null
  return <div style={{ fontSize: '12px', color: '#b45309', marginTop: '8px', textAlign: 'right' }}>{problem}</div>
}

// Draft > Submitted > Reviewed/Approved > Sent to subs, with who and when.
export function WorkflowBar({ lookahead }) {
  if (!lookahead) return null
  const stage = lookaheadStage(lookahead)
  const at = LOOKAHEAD_STAGES.findIndex(s => s.key === stage)
  const history = stageHistory(lookahead)
  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
        {LOOKAHEAD_STAGES.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <span style={{ color: '#d1d5db', fontSize: '11px' }}>›</span>}
            <span style={{
              fontSize: '11px', fontWeight: i === at ? 700 : 500, padding: '2px 9px', borderRadius: '99px',
              color: i === at ? '#fff' : i < at ? '#15803d' : '#9ca3af',
              background: i === at ? (s.key === 'draft' ? '#d97706' : '#16a34a') : i < at ? '#f0fdf4' : '#f9fafb',
              border: `1px solid ${i === at ? 'transparent' : i < at ? '#bbf7d0' : '#e5e7eb'}`,
            }}>{i < at ? '✓ ' : ''}{s.label}</span>
          </React.Fragment>
        ))}
      </div>
      {history.length > 0 && (
        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {history.map(h => <span key={h.key}>{h.label}{h.who ? ` by ${h.who}` : ''} · {fmtWhen(h.when)}</span>)}
        </div>
      )}
    </div>
  )
}

// "Move to day" for the phone view, where there is no drag.
export function MoveToDaySelect({ days, current, onMove }) {
  return (
    <select value="" onChange={e => { if (e.target.value) onMove(e.target.value) }} onClick={e => e.stopPropagation()}
      aria-label="Move to day"
      style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '5px', color: '#4b5563', fontSize: '11px', padding: '3px 4px', cursor: 'pointer', maxWidth: '84px' }}>
      <option value="">Move…</option>
      {days.filter(d => d !== current).map(d => <option key={d} value={d}>{fmtDay(d)}</option>)}
    </select>
  )
}

// Send to subs: shows who will receive it, sends only after the PM confirms.
export function SendToSubsDialog({ lookahead, onClose, onSent }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    loadSendPreview(lookahead.id).then(r => { if (r.error) setError(r.error); else setPreview(r.recipients || []) })
  }, [lookahead.id])

  async function confirmSend() {
    setSending(true)
    setError('')
    const r = await sendToSubs(lookahead.id)
    setSending(false)
    if (r.error) { setError(r.error); return }
    setResult(r)
    onSent?.(r)
  }

  const reachable = (preview || []).filter(s => s.people.some(p => p.email || p.portal))
  const box = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }
  const btn = { padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }

  return (
    <div style={box} onClick={e => { if (e.target === e.currentTarget && !sending) onClose() }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', width: '100%', maxWidth: '520px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, color: '#111827' }}>{result ? 'Sent to subs' : 'Send lookahead to subs?'}</h3>
        {!result && <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#6b7280' }}>Each sub tagged on an activity gets an email with their own activities and a notice in their sub portal. Nothing is sent until you confirm.</p>}
        {!preview && !error && <p style={{ fontSize: '13px', color: '#6b7280' }}>Loading recipients…</p>}
        {(result?.results || preview || []).map(s => (
          <div key={s.contract_id || s.vendor_name} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>{s.vendor_name}</span>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>{s.activity_count} activit{s.activity_count === 1 ? 'y' : 'ies'}</span>
            </div>
            {s.people.length === 0 && <div style={{ fontSize: '12px', color: '#b45309', marginTop: '4px' }}>No portal user or email on file — this sub will not receive it.</div>}
            {s.people.map((p, i) => (
              <div key={i} style={{ fontSize: '12px', color: '#4b5563', marginTop: '4px' }}>
                {p.name || p.email || 'Portal user'}{p.name && p.email ? ` · ${p.email}` : ''}
                <span style={{ color: '#6b7280' }}>
                  {result ? ` — ${[p.emailed ? 'emailed' : p.email ? 'email failed' : null, p.portal ? 'portal notice' : null].filter(Boolean).join(', ') || 'not reached'}`
                    : ` — ${[p.email ? 'email' : null, p.portal ? 'portal' : null].filter(Boolean).join(' + ') || 'no contact'}`}
                </span>
              </div>
            ))}
          </div>
        ))}
        {preview && preview.length === 0 && !result && <p style={{ fontSize: '13px', color: '#b45309' }}>No subcontractors are tagged on this lookahead's activities.</p>}
        {result?.warning && <div style={{ fontSize: '12px', color: '#b45309', marginTop: '8px' }}>{result.warning}</div>}
        {error && <div style={{ marginTop: '10px', padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#b91c1c', fontSize: '13px' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button onClick={onClose} disabled={sending} style={{ ...btn, background: '#f3f4f6', border: '1px solid #d1d5db', color: '#4b5563' }}>{result ? 'Close' : 'Cancel'}</button>
          {!result && (
            <button onClick={confirmSend} disabled={sending || !reachable.length}
              style={{ ...btn, background: sending || !reachable.length ? '#d1d5db' : '#16a34a', border: 'none', color: '#fff', cursor: sending || !reachable.length ? 'default' : 'pointer' }}>
              {sending ? 'Sending…' : `Send to ${reachable.length} sub${reachable.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
