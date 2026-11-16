'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { referenceElement, PICKER_PAGE_SIZE } from '../../lib/job-photo-picker'

// "Choose from CompanyCam / job photos" (prompt 85) — shared by the field app daily report
// (app/field/page.js step 4) and the job-page DailyReportForm.
// Peyton's decision 4: lists ALL of the job's photos (job_photos: CompanyCam imports +
// gallery uploads), newest first, 40 per page with "Load more", with a CompanyCam filter.
// Default: this report day's photos (America/Chicago date of taken_at).
// Attaches BY REFERENCE: onAttach([{ path, name, caption, internal_only, job_photo_id,
// source: 'job_photos' }]) — no upload, no copy. internal_only comes from the job photo.
// iPhone (Safari + Capacitor): fixed full-height bottom sheet, ≥44px tap targets, no hover,
// 3-column grid, safe-area padding.

const TAP = 44
const chip = active => ({
  minHeight: `${TAP}px`, padding: '0 14px', borderRadius: '22px', fontSize: '13px', fontWeight: 700,
  border: active ? '2px solid #e8590c' : '1px solid #d1d5db', background: active ? '#fff7ed' : '#fff',
  color: active ? '#9a3412' : '#374151', cursor: 'pointer', whiteSpace: 'nowrap',
})
const badge = (bg, color) => ({ fontSize: '9px', fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', background: bg, color, padding: '2px 5px', borderRadius: '3px' })

export default function JobPhotoPicker({ jobId, reportDate, authFetch, attachedPaths = [], onAttach, onClose }) {
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(reportDate || '')
  const [scope, setScope] = useState(validDate ? 'day' : 'all') // 'day' | 'all'
  const [source, setSource] = useState('all') // 'all' | 'companycam'
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState({}) // id → item
  const attached = new Set(attachedPaths)

  // L3: every load gets a sequence number; a response that is no longer the latest request
  // (chips changed while "Load more" was in flight) is dropped instead of appended.
  const requestSeq = useRef(0)
  const load = useCallback(async (offset = 0) => {
    const seq = ++requestSeq.current
    const stale = () => seq !== requestSeq.current
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ job_id: jobId, limit: String(PICKER_PAGE_SIZE), offset: String(offset) })
      if (scope === 'day' && validDate) qs.set('date', reportDate)
      else qs.set('all', '1')
      if (source === 'companycam') qs.set('source', 'companycam')
      const res = await authFetch(`/api/daily-reports/job-photos?${qs}`)
      const data = await res.json().catch(() => ({}))
      if (stale()) return
      if (!res.ok) throw new Error(data.error || `Could not load photos (server returned ${res.status}).`)
      setItems(prev => (offset === 0 ? data.photos || [] : [...prev, ...(data.photos || [])]))
      setTotal(data.total || 0)
      setHasMore(!!data.has_more)
    } catch (e) {
      if (!stale()) setError(e.message || 'Could not load photos.')
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [jobId, scope, source, reportDate, validDate, authFetch])

  useEffect(() => { load(0) }, [load])

  // Lock page scroll behind the sheet (iOS rubber-banding).
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const toggle = item => {
    if (attached.has(item.path)) return
    setSelected(sel => {
      const next = { ...sel }
      if (next[item.id]) delete next[item.id]
      else next[item.id] = item
      return next
    })
  }
  const picked = Object.values(selected)
  const attach = () => {
    if (!picked.length) return
    onAttach?.(picked.map(referenceElement))
    onClose?.()
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Choose job photos" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(17,24,39,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#fff', width: '100%', maxWidth: '720px', height: '92vh', maxHeight: '92dvh', borderRadius: '14px 14px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 -8px 30px rgba(0,0,0,0.25)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '10px 12px 6px 16px', borderBottom: '1px solid #f3f4f6' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#111827' }}>Job photos</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>{loading && !items.length ? 'Loading…' : `${total} photo${total === 1 ? '' : 's'}`}{picked.length ? ` · ${picked.length} selected` : ''}</div>
          </div>
          <button type="button" onClick={onClose} style={{ minHeight: `${TAP}px`, minWidth: `${TAP}px`, padding: '0 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontWeight: 700, color: '#374151', cursor: 'pointer' }}>Cancel</button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '8px', padding: '8px 12px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', flexShrink: 0 }}>
          {validDate && <button type="button" style={chip(scope === 'day')} aria-pressed={scope === 'day'} onClick={() => setScope('day')}>This day&apos;s photos</button>}
          <button type="button" style={chip(scope === 'all')} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All dates</button>
          <button type="button" style={chip(source === 'all')} aria-pressed={source === 'all'} onClick={() => setSource('all')}>All job photos</button>
          <button type="button" style={chip(source === 'companycam')} aria-pressed={source === 'companycam'} onClick={() => setSource('companycam')}>CompanyCam only</button>
        </div>

        {/* Grid */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px 12px' }}>
          {error && <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', margin: '8px 0' }}>{error} <button type="button" onClick={() => load(0)} style={{ minHeight: `${TAP}px`, marginLeft: '6px', background: 'none', border: 'none', color: '#2563eb', fontWeight: 700, cursor: 'pointer' }}>Try again</button></div>}
          {!loading && !error && items.length === 0 && (
            <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '14px', padding: '2rem 1rem' }}>
              {scope === 'day' ? 'No photos from this day.' : source === 'companycam' ? 'No CompanyCam photos on this job yet.' : 'No photos on this job yet.'}
              {scope === 'day' && <div><button type="button" onClick={() => setScope('all')} style={{ ...chip(false), marginTop: '12px' }}>Show all dates</button></div>}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {items.map(p => {
              const isAttached = attached.has(p.path)
              const isSel = !!selected[p.id]
              return (
                <button key={p.id} type="button" onClick={() => toggle(p)} disabled={isAttached} aria-pressed={isSel}
                  aria-label={`${p.name || 'Photo'}${p.date ? ` ${p.date}` : ''}${isAttached ? ' (already attached)' : ''}`}
                  style={{ position: 'relative', aspectRatio: '1', minHeight: `${TAP}px`, padding: 0, border: isSel ? '3px solid #e8590c' : '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', background: '#f3f4f6', cursor: isAttached ? 'default' : 'pointer', opacity: isAttached ? 0.5 : 1 }}>
                  {p.thumb_url
                    ? <img src={p.thumb_url} alt={p.name || ''} loading="lazy" decoding="async" onError={e => { if (p.url && e.target.src !== p.url) e.target.src = p.url }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <span style={{ fontSize: '10px', color: '#6b7280', padding: '4px' }}>{p.name || 'Photo'}</span>}
                  <span style={{ position: 'absolute', top: '4px', left: '4px', display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                    {p.companycam && <span style={badge('#dbeafe', '#1e40af')}>CompanyCam</span>}
                    {p.internal_only && <span style={badge('#ffedd5', '#7c2d12')}>Internal</span>}
                  </span>
                  <span aria-hidden="true" style={{ position: 'absolute', top: '4px', right: '4px', width: '26px', height: '26px', borderRadius: '13px', background: isSel ? '#e8590c' : 'rgba(255,255,255,0.85)', border: isSel ? 'none' : '2px solid #9ca3af', color: '#fff', fontSize: '16px', fontWeight: 900, lineHeight: '26px', textAlign: 'center' }}>{isSel ? '✓' : ''}</span>
                  {(isAttached || p.creator || p.tags.length > 0 || p.date) && (
                    <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', color: '#fff', fontSize: '10px', lineHeight: 1.3, padding: '14px 5px 4px', textAlign: 'left', overflow: 'hidden' }}>
                      {isAttached ? <strong>Attached</strong> : <>
                        {p.creator && <span style={{ display: 'block', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.creator}</span>}
                        {p.tags.length > 0 && <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.tags.join(', ')}</span>}
                        {scope === 'all' && p.date && <span style={{ display: 'block' }}>{p.date}</span>}
                      </>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {hasMore && (
            <button type="button" disabled={loading} onClick={() => load(items.length)} style={{ display: 'block', width: '100%', minHeight: `${TAP}px`, marginTop: '10px', background: '#f9fafb', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontWeight: 700, color: '#374151', cursor: 'pointer' }}>{loading ? 'Loading…' : 'Load more'}</button>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '8px', padding: '10px 12px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))', borderTop: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
          <button type="button" onClick={onClose} style={{ minHeight: `${TAP + 4}px`, flex: '0 0 auto', padding: '0 18px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '15px', fontWeight: 700, color: '#374151', cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={attach} disabled={!picked.length} style={{ minHeight: `${TAP + 4}px`, flex: 1, background: '#e8590c', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 800, color: '#fff', cursor: picked.length ? 'pointer' : 'default', opacity: picked.length ? 1 : 0.5 }}>Attach selected{picked.length ? ` (${picked.length})` : ''}</button>
        </div>
      </div>
    </div>
  )
}
