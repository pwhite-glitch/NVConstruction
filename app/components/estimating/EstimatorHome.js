'use client'
import { useState, useMemo } from 'react'

const STAGE_MAP = {
  lead:        { label: 'Lead',        color: '#374151', bg: '#f3f4f6', border: '#e5e7eb' },
  estimating:  { label: 'Estimating',  color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  bid_out:     { label: 'Bid Out',     color: '#c2410c', bg: '#fff7ed', border: '#fdba74' },
  sent:        { label: 'Bid Out',     color: '#c2410c', bg: '#fff7ed', border: '#fdba74' },
  negotiating: { label: 'Negotiating', color: '#854d0e', bg: '#fefce8', border: '#fef08a' },
  draft:       { label: 'Estimating',  color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
}

const FILTER_OPTS = [
  { key: 'all',         label: 'All stages' },
  { key: 'lead',        label: 'Lead' },
  { key: 'estimating',  label: 'Estimating' },
  { key: 'bid_out',     label: 'Bid Out' },
  { key: 'negotiating', label: 'Negotiating' },
]

const SORT_OPTS = [
  { key: 'newest',     label: 'Newest first' },
  { key: 'oldest',     label: 'Oldest first' },
  { key: 'value_desc', label: 'Highest value' },
  { key: 'value_asc',  label: 'Lowest value' },
  { key: 'name',       label: 'Project name' },
]

function calcTotal(est) {
  const globalPct = Number(est.markup_pct || 0)
  const lines = est.estimate_line_items || []
  const raw = lines.reduce((a, l) => a + Number(l.amount || 0), 0)
  const billed = lines.reduce((a, l) => {
    const pct = l.markup_pct != null ? Number(l.markup_pct) : globalPct
    const flat = l.markup_flat != null ? Number(l.markup_flat) : 0
    return a + Number(l.amount || 0) * (1 + pct / 100) + flat
  }, 0)
  return billed + Number(est.markup_flat || 0) + (est.taxable ? raw * 0.0825 : 0)
}

function fmtDate(s) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const s = {
  toolbar: { display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' },
  search:  { flex: 1, minWidth: '200px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none', background: '#fff', color: '#111827' },
  sort:    { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', background: '#fff', outline: 'none', cursor: 'pointer', color: '#374151' },
  filters: { display: 'flex', gap: '6px', marginBottom: '1rem', flexWrap: 'wrap' },
  fBtn:    (a) => ({ padding: '5px 13px', borderRadius: '5px', fontSize: '12px', fontWeight: a ? '600' : '400', background: a ? '#fff7ed' : '#fff', color: a ? '#c2410c' : '#374151', border: `1px solid ${a ? '#fdba74' : '#e5e7eb'}`, cursor: 'pointer', whiteSpace: 'nowrap' }),
  row:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 14px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '6px', cursor: 'pointer' },
  left:    { flex: 1, minWidth: 0 },
  name:    { fontSize: '14px', fontWeight: '600', color: '#111827', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta:    { fontSize: '12px', color: '#6b7280', margin: '3px 0 0' },
  right:   { display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, marginLeft: '14px' },
  badge:   (status) => {
    const c = STAGE_MAP[status] || { label: status, color: '#374151', bg: '#f3f4f6', border: '#e5e7eb' }
    return { padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', letterSpacing: '0.3px', textTransform: 'uppercase', background: c.bg, color: c.color, border: `1px solid ${c.border}` }
  },
  openBtn: { padding: '5px 12px', borderRadius: '5px', fontSize: '12px', fontWeight: '600', background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb', cursor: 'pointer' },
  empty:   { textAlign: 'center', color: '#9ca3af', fontSize: '13px', padding: '3rem 0' },
}

export default function EstimatorHome({ estimates, onOpen }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort]     = useState('newest')

  const filtered = useMemo(() => {
    let list = estimates
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        (e.project_name   || '').toLowerCase().includes(q) ||
        (e.owner_name     || '').toLowerCase().includes(q) ||
        (e.owner_company  || '').toLowerCase().includes(q) ||
        (e.estimate_number|| '').toLowerCase().includes(q) ||
        (e.address        || '').toLowerCase().includes(q)
      )
    }
    if (filter !== 'all') {
      list = list.filter(e => {
        const st = (e.status || 'lead').toLowerCase()
        if (filter === 'bid_out')    return st === 'bid_out' || st === 'sent'
        if (filter === 'estimating') return st === 'estimating' || st === 'draft'
        return st === filter
      })
    }
    return [...list].sort((a, b) => {
      if (sort === 'newest')     return new Date(b.created_at) - new Date(a.created_at)
      if (sort === 'oldest')     return new Date(a.created_at) - new Date(b.created_at)
      if (sort === 'value_desc') return calcTotal(b) - calcTotal(a)
      if (sort === 'value_asc')  return calcTotal(a) - calcTotal(b)
      if (sort === 'name')       return (a.project_name || '').localeCompare(b.project_name || '')
      return 0
    })
  }, [estimates, search, filter, sort])

  return (
    <div>
      <div style={s.toolbar}>
        <input
          style={s.search}
          placeholder="Search by project, owner, estimate number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select style={s.sort} value={sort} onChange={e => setSort(e.target.value)}>
          {SORT_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      <div style={s.filters}>
        {FILTER_OPTS.map(o => (
          <button key={o.key} style={s.fBtn(filter === o.key)} onClick={() => setFilter(o.key)}>{o.label}</button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={s.empty}>
          {search || filter !== 'all' ? 'No estimates match your search.' : 'No active estimates. Won / lost estimates are in Archive.'}
        </div>
      )}

      {filtered.map(est => {
        const total = calcTotal(est)
        const psf   = est.square_footage > 0 ? Math.round(total / est.square_footage) : null
        const cfg   = STAGE_MAP[est.status] || { label: est.status || 'Lead', color: '#374151', bg: '#f3f4f6', border: '#e5e7eb' }
        return (
          <div key={est.id} style={s.row} className="nv-table-row" onClick={() => onOpen(est)}>
            <div style={s.left}>
              <p style={s.name}>
                {est.project_name}
                {est.project_type && <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '400', marginLeft: '8px' }}>{est.project_type}</span>}
              </p>
              <p style={s.meta}>
                {est.estimate_number}
                {est.owner_name    ? ' · ' + est.owner_name    : ''}
                {est.owner_company && !est.owner_name ? ' · ' + est.owner_company : ''}
                {' · '}{fmtDate(est.created_at)}
                {psf ? ` · $${psf}/sqft` : ''}
              </p>
            </div>
            <div style={s.right}>
              <span style={{ fontSize: '15px', fontWeight: '700', color: '#111827' }}>
                ${Math.round(total).toLocaleString()}
              </span>
              <span style={s.badge(est.status)}>{cfg.label}</span>
              <button style={s.openBtn} onClick={e => { e.stopPropagation(); onOpen(est) }}>Open →</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
