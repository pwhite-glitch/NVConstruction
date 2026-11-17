'use client'

// Earlier (final) versions of a daily report, saved each time it was reopened (prompt 86,
// migration 076). Shared by the commercial / residential job pages and the field app.
// Office only (Owner / admin / PM) — callers show the link only for canViewReportVersions.
// Text only: snapshot photos are listed by caption / name, never signed or shown.

import { useEffect, useState } from 'react'
import { fetchReportVersions } from '../../lib/daily-report-client'

const PAGE = 20
const central = iso => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const rows = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [])
const join = (...parts) => parts.filter(p => p != null && String(p).trim() !== '').join(' · ')

const overlay = { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }
const box = { background: '#fff', borderRadius: '10px', width: '100%', maxWidth: '640px', maxHeight: '85vh', overflowY: 'auto', padding: '18px 20px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }
const label = { fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '10px' }
const text = { fontSize: '13px', color: '#111827', whiteSpace: 'pre-wrap' }
const btn = { fontSize: '12px', padding: '6px 12px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '6px', cursor: 'pointer' }

function Lines({ title, items }) {
  if (!items.length) return null
  return (
    <>
      <div style={label}>{title}</div>
      {items.map((line, i) => <div key={i} style={text}>{line}</div>)}
    </>
  )
}

function Snapshot({ s = {} }) {
  const photos = rows(s.photos)
  const field = (t, v) => (v != null && String(v).trim() !== '' ? <><div style={label}>{t}</div><div style={text}>{String(v)}</div></> : null)
  return (
    <div style={{ padding: '8px 0 4px' }}>
      {field('Report date', s.report_date)}
      {(s.weather || s.weather_temp || s.weather_delay) && (
        <>
          <div style={label}>Weather</div>
          <div style={text}>{join(s.weather, s.weather_temp ? `${s.weather_temp}°` : null)}{s.weather_delay ? <span style={{ color: '#dc2626', fontWeight: 700 }}> DELAY</span> : null}</div>
        </>
      )}
      {field('Crew count', s.crew_count)}
      {field('Work performed', s.work_performed)}
      {field('Issues', s.issues)}
      {field('Safety observations', s.safety_observations)}
      {field('Toolbox talk', s.toolbox_talk)}
      <Lines title="Crew" items={rows(s.crew_log).map(c => join(c.name, c.company, c.trade, c.hours ? `${c.hours} h` : null))} />
      <Lines title="Subcontractors" items={rows(s.subcontractor_activity).map(a => join(a.company, a.trade, a.crew_count ? `${a.crew_count} crew` : null, a.work_performed))} />
      <Lines title="Materials delivered" items={rows(s.materials_delivered).map(m => join(m.description, m.quantity, m.supplier))} />
      <Lines title="Equipment" items={rows(s.equipment_log).map(e => join(e.name, e.quantity ? `qty ${e.quantity}` : null, e.hours ? `${e.hours} h` : null))} />
      <Lines title="Visitors" items={rows(s.visitors).map(v => join(v.name, v.company, v.purpose))} />
      <div style={label}>Photos</div>
      <div style={text}>{photos.length} photo{photos.length !== 1 ? 's' : ''}</div>
      {photos.map((p, i) => (p.caption || p.name) ? <div key={i} style={{ ...text, color: '#374151' }}>• {join(p.caption, p.name)}</div> : null)}
    </div>
  )
}

export default function ReportVersionsModal({ reportId, fetchFn, onClose }) {
  const [versions, setVersions] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [migration, setMigration] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  const load = async offset => {
    setLoading(true); setError('')
    try {
      const data = await fetchReportVersions(fetchFn, reportId, { limit: PAGE, offset })
      setVersions(prev => (offset ? [...prev, ...data.versions] : data.versions))
      setHasMore(!!data.has_more)
      setMigration(data.migration_required === '076')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load(0) }, [reportId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Earlier versions">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <strong style={{ fontSize: '15px', color: '#111827' }}>Earlier versions</strong>
          <button type="button" style={btn} onClick={onClose}>Close</button>
        </div>
        {error && <div style={{ color: '#b91c1c', fontSize: '13px', marginBottom: '8px' }}>{error}</div>}
        {!loading && !error && migration && <div style={{ color: '#6b7280', fontSize: '13px' }}>Earlier versions need migration 076.</div>}
        {!loading && !error && !migration && versions.length === 0 && <div style={{ color: '#6b7280', fontSize: '13px' }}>No earlier versions saved.</div>}
        {versions.map(v => (
          <div key={v.id} style={{ borderTop: '1px solid #f3f4f6', padding: '8px 0' }}>
            <button type="button" onClick={() => setOpen(open === v.id ? null : v.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%', fontSize: '13px', color: '#111827' }}>
              <strong>Rev {v.rev_number}</strong> — finalized {central(v.finalized_at)} · reopened {central(v.reopened_at)} <span style={{ color: '#6b7280' }}>{open === v.id ? '▲' : '▼'}</span>
            </button>
            {open === v.id && <Snapshot s={v.snapshot || {}} />}
          </div>
        ))}
        {loading && <div style={{ color: '#6b7280', fontSize: '13px', padding: '6px 0' }}>Loading…</div>}
        {!loading && hasMore && <button type="button" style={{ ...btn, marginTop: '8px' }} onClick={() => load(versions.length)}>Load more</button>}
      </div>
    </div>
  )
}
