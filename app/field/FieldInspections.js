'use client'
// Field app → Inspections (residential jobs only). Same actions as the office residential
// page: schedule, record a result, reschedule, re-inspect after a failure, and create a punch
// item from a failure through the shared /api/punch-list path. Everything goes through
// /api/res-inspections (service role; the caller must be on the job). No photo field:
// res_inspections has none.
import { useEffect, useState } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { todayCentral } from '../../lib/central-date'
import { INSPECTION_TYPES } from '../../lib/res-inspections'

const fmtDate = d => (d ? new Date(d + 'T12:00:00').toLocaleDateString() : '—')
const RESULT_COLORS = {
  pending: { background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' },
  passed: { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
  failed: { background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' },
  rescheduled: { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
}
const badge = r => ({ ...(RESULT_COLORS[r] || RESULT_COLORS.pending), fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '99px', textTransform: 'uppercase', letterSpacing: '0.5px' })
const EMPTY_FORM = { inspection_type: 'Framing', scheduled_date: '', inspector_name: '', notes: '' }

async function call(url, method, body) {
  try {
    const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) return { ok: false, error: data.error || `HTTP ${res.status}` }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e?.message || 'network error' }
  }
}

export default function FieldInspections({ jobId, userId, s, onCount }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(null)
  const [edit, setEdit] = useState(null) // { id, mode: 'result'|'reschedule'|'reinspect', result, date }

  async function load() {
    setLoading(true)
    const r = await call(`/api/res-inspections?job_id=${encodeURIComponent(jobId)}`, 'GET')
    setLoading(false)
    if (!r.ok) { setMsg('Could not load inspections: ' + r.error); setItems([]); return }
    const list = r.data.inspections || []
    setItems(list)
    onCount?.(list.filter(i => (i.result || 'pending') === 'pending').length)
  }
  useEffect(() => { if (jobId) { setMsg(''); setEdit(null); load() } }, [jobId])

  async function run(key, fn) {
    setBusy(key); setMsg('')
    try { await fn() } finally { setBusy(null) }
  }

  const schedule = e => {
    e.preventDefault()
    if (!form.inspection_type) return
    return run('new', async () => {
      const r = await call('/api/res-inspections', 'POST', { job_id: jobId, inspection_type: form.inspection_type, scheduled_date: form.scheduled_date || null, inspector_name: form.inspector_name || null, notes: form.notes || null, result: 'pending' })
      if (!r.ok) { setMsg('Not saved: ' + r.error); return }
      setForm(EMPTY_FORM); setShowForm(false)
      await load()
    })
  }

  const saveResult = (ins, result, date) => run(ins.id, async () => {
    const r = await call('/api/res-inspections', 'PATCH', { id: ins.id, result, actual_date: result === 'pending' ? null : (date || todayCentral()) })
    if (!r.ok) { setMsg('Not saved: ' + r.error); return }
    setEdit(null); await load()
  })

  const reschedule = (ins, newDate) => {
    if (!newDate) { setMsg('Pick the new date.'); return }
    return run(ins.id, async () => {
      const note = `Rescheduled from ${ins.scheduled_date ? fmtDate(ins.scheduled_date) : 'unscheduled'} on ${fmtDate(todayCentral())}.`
      const r = await call('/api/res-inspections', 'PATCH', { id: ins.id, scheduled_date: newDate, result: 'pending', actual_date: null, notes: [ins.notes, note].filter(Boolean).join('\n') })
      if (!r.ok) { setMsg('Not saved: ' + r.error); return }
      setEdit(null); await load()
    })
  }

  const reinspect = (ins, newDate) => run(ins.id, async () => {
    const ref = `Re-inspection of ${ins.inspection_type} that failed${ins.actual_date ? ' on ' + fmtDate(ins.actual_date) : ''} (ref ${String(ins.id).slice(0, 8)}).`
    const r = await call('/api/res-inspections', 'POST', { job_id: jobId, inspection_type: ins.inspection_type, scheduled_date: newDate || null, inspector_name: ins.inspector_name || null, result: 'pending', notes: ref })
    if (!r.ok) { setMsg('Not saved: ' + r.error); return }
    setEdit(null); await load()
  })

  // Punch item from a failure: the same /api/punch-list path the field Punch List uses.
  const punch = ins => {
    if (!window.confirm(`Create a punch list item for the failed ${ins.inspection_type} inspection?`)) return
    return run(ins.id, async () => {
      const r = await call('/api/punch-list', 'POST', { job_id: jobId, title: `Fix failed ${ins.inspection_type} inspection`, description: ins.notes || null, created_by: userId || null })
      setMsg(r.ok ? 'Punch item created.' : 'Punch item not created: ' + r.error)
    })
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <span style={{ fontSize: '13px', color: '#6b7280' }}>{items.length} inspection{items.length !== 1 ? 's' : ''}</span>
        <button style={s.btnSm('orange')} onClick={() => setShowForm(v => !v)}>{showForm ? 'Cancel' : '+ Schedule'}</button>
      </div>
      {msg && <div style={{ fontSize: '13px', color: msg === 'Punch item created.' ? '#15803d' : '#dc2626', marginBottom: '10px' }}>{msg}</div>}

      {showForm && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Schedule inspection</h2>
          <form onSubmit={schedule}>
            <div style={{ ...s.grid2, marginBottom: '12px' }}>
              <div>
                <label style={s.label}>Type *</label>
                <select style={s.input} value={form.inspection_type} onChange={e => setForm(f => ({ ...f, inspection_type: e.target.value }))}>
                  {INSPECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label style={s.label}>Date</label>
                <input type="date" style={s.input} value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
              </div>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={s.label}>Inspector</label>
              <input style={s.input} value={form.inspector_name} onChange={e => setForm(f => ({ ...f, inspector_name: e.target.value }))} placeholder="City inspector..." />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={s.label}>Notes</label>
              <input style={s.input} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes..." />
            </div>
            <button type="submit" disabled={busy === 'new'} style={{ ...s.btn, opacity: busy === 'new' ? 0.6 : 1 }}>{busy === 'new' ? 'Saving...' : 'Schedule'}</button>
          </form>
        </div>
      )}

      {loading ? <div style={s.empty}>Loading inspections…</div>
        : items.length === 0 && !showForm ? <div style={s.empty}>No inspections yet.<br />Schedule each building department inspection here.</div>
        : items.map(ins => {
          const result = ins.result || 'pending'
          const editing = edit?.id === ins.id ? edit : null
          const disabled = busy === ins.id
          return (
            <div key={ins.id} style={{ ...s.card, padding: '14px 16px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '700', color: '#111827' }}>{ins.inspection_type}</span>
                    <span style={badge(result)}>{result}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                    Scheduled {fmtDate(ins.scheduled_date)}{ins.actual_date ? ` · Inspected ${fmtDate(ins.actual_date)}` : ''}{ins.inspector_name ? ' · ' + ins.inspector_name : ''}
                  </div>
                  {ins.notes && <div style={{ fontSize: '12px', color: '#666', marginTop: '2px', whiteSpace: 'pre-wrap' }}>{ins.notes}</div>}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {result === 'pending' && <>
                    <button disabled={disabled} style={s.btnSm('green')} onClick={() => setEdit({ id: ins.id, mode: 'result', result: 'passed', date: todayCentral() })}>Pass</button>
                    <button disabled={disabled} style={s.btnSm('red')} onClick={() => setEdit({ id: ins.id, mode: 'result', result: 'failed', date: todayCentral() })}>Fail</button>
                    <button disabled={disabled} style={s.btnSm('')} onClick={() => setEdit({ id: ins.id, mode: 'reschedule', date: '' })}>Reschedule</button>
                  </>}
                  {result === 'failed' && <>
                    <button disabled={disabled} style={s.btnSm('orange')} onClick={() => setEdit({ id: ins.id, mode: 'reinspect', date: '' })}>Re-inspect</button>
                    <button disabled={disabled} style={s.btnSm('')} onClick={() => punch(ins)}>+ Punch item</button>
                  </>}
                  {result !== 'pending' && <button disabled={disabled} style={s.btnSm('')} onClick={() => setEdit({ id: ins.id, mode: 'result', result, date: ins.actual_date || todayCentral() })}>Edit result</button>}
                </div>
              </div>
              {editing && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f3f4f6' }}>
                  {editing.mode === 'result' && (
                    <div>
                      <label style={s.label}>Result</label>
                      <select style={{ ...s.input, width: 'auto' }} value={editing.result} onChange={e => setEdit(x => ({ ...x, result: e.target.value }))}>
                        <option value="passed">Passed</option>
                        <option value="failed">Failed</option>
                        <option value="pending">Pending (not done)</option>
                      </select>
                    </div>
                  )}
                  {!(editing.mode === 'result' && editing.result === 'pending') && (
                    <div>
                      <label style={s.label}>{editing.mode === 'result' ? 'Date inspected' : editing.mode === 'reschedule' ? 'New date' : 'Re-inspection date'}</label>
                      <input type="date" style={{ ...s.input, width: 'auto' }} value={editing.date || ''} onChange={e => setEdit(x => ({ ...x, date: e.target.value }))} />
                    </div>
                  )}
                  <button disabled={disabled} style={{ ...s.btn, opacity: disabled ? 0.6 : 1 }} onClick={() => editing.mode === 'result' ? saveResult(ins, editing.result, editing.date) : editing.mode === 'reschedule' ? reschedule(ins, editing.date) : reinspect(ins, editing.date)}>
                    {editing.mode === 'result' ? 'Save result' : editing.mode === 'reschedule' ? 'Reschedule' : 'Add re-inspection'}
                  </button>
                  <button style={s.btnSm('')} onClick={() => setEdit(null)}>Cancel</button>
                </div>
              )}
            </div>
          )
        })}
    </>
  )
}
