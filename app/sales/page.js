'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'

// ─── Constants ───────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'lead',             label: 'Lead',             color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe' },
  { key: 'quoted',           label: 'Quoted',            color: '#c2410c', bg: '#fff7ed', border: '#fdba74' },
  { key: 'contract_signed',  label: 'Contract Signed',   color: '#0369a1', bg: '#eff6ff', border: '#bae6fd' },
  { key: 'order_placed',     label: 'Order Placed',      color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
  { key: 'scheduled',        label: 'Scheduled',         color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' },
  { key: 'installed',        label: 'Installed',         color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  { key: 'completed',        label: 'Completed',         color: '#16a34a', bg: '#dcfce7', border: '#86efac' },
  { key: 'cancelled',        label: 'Cancelled',         color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  { key: 'on_hold',          label: 'On Hold',           color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb' },
]

const PIPELINE_STAGES = ['lead','quoted','contract_signed','order_placed','scheduled','installed','completed']

const DIVISIONS = [
  { key: 'metal_buildings',    label: 'Metal Buildings' },
  { key: 'commercial_roofing', label: 'Commercial Roofing' },
]

const fmt$ = v => v != null && v !== '' ? '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const stageCfg = key => STAGES.find(s => s.key === key) || { label: key, color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' }

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = {
  page:       { minHeight: '100vh', background: '#f4f6f8', display: 'flex', fontFamily: 'system-ui, -apple-system, sans-serif' },
  sidebar:    { width: '224px', flexShrink: 0, background: '#1a2332', borderRight: '1px solid rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' },
  sidebarTop: { padding: '1.25rem 1rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  brand:      { margin: 0, fontWeight: '700', fontSize: '13px', color: '#fff', letterSpacing: '0.5px' },
  divLabel:   { margin: '2px 0 0', fontSize: '10px', color: '#64748b', letterSpacing: '1.5px', textTransform: 'uppercase' },
  userLabel:  { margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' },
  nav:        { flex: 1, padding: '0.5rem 0' },
  navItem:    (a) => ({ display: 'flex', alignItems: 'center', gap: '9px', padding: a ? '9px 1rem 9px calc(1rem - 3px)' : '9px 1rem', cursor: 'pointer', background: a ? 'rgba(232,89,12,0.14)' : 'transparent', color: a ? '#e8590c' : 'rgba(255,255,255,0.72)', fontSize: '13px', fontWeight: a ? '600' : '400', border: 'none', borderLeft: a ? '3px solid #e8590c' : '3px solid transparent', width: '100%', textAlign: 'left', outline: 'none' }),
  navDivider: { fontSize: '10px', color: '#334155', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '12px 1rem 4px', fontWeight: '600' },
  sidebarBot: { padding: '0.875rem 1rem', borderTop: '1px solid rgba(255,255,255,0.06)' },
  signOutBtn: { width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#64748b', cursor: 'pointer', fontSize: '12px', textAlign: 'left' },

  main:       { flex: 1, minWidth: 0, padding: '1.5rem 2rem', overflowX: 'hidden' },
  topBar:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' },
  pageTitle:  { margin: 0, fontSize: '22px', fontWeight: '700', color: '#111827' },

  // Stats strip
  stats:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '1.5rem' },
  stat:       { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem' },
  statN:      { margin: '0 0 2px', fontSize: '22px', fontWeight: '700', color: '#111827' },
  statL:      { margin: 0, fontSize: '12px', color: '#6b7280' },

  // Filters
  filters:    { display: 'flex', gap: '10px', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' },
  filterInput:{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#111827', outline: 'none', background: '#fff', minWidth: '220px' },
  filterSel:  { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#111827', outline: 'none', background: '#fff' },

  // View toggle
  viewBtn:    (a) => ({ padding: '6px 12px', background: a ? '#e8590c' : '#fff', color: a ? '#fff' : '#6b7280', border: '1px solid ' + (a ? '#e8590c' : '#d1d5db'), borderRadius: '5px', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }),

  // List view
  table:      { width: '100%', borderCollapse: 'collapse' },
  th:         { padding: '9px 14px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '11px', fontWeight: '700', color: '#6b7280', letterSpacing: '0.8px', textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' },
  tr:         (h) => ({ background: h ? '#fafafa' : '#fff', cursor: 'pointer', borderBottom: '1px solid #f3f4f6', transition: 'background 0.1s' }),
  td:         { padding: '11px 14px', fontSize: '13px', color: '#111827', verticalAlign: 'middle' },
  tdSub:      { fontSize: '11px', color: '#9ca3af', marginTop: '2px' },

  // Pipeline (kanban) view
  pipeline:   { display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '1rem', alignItems: 'flex-start' },
  pipeCol:    { minWidth: '220px', maxWidth: '240px', flexShrink: 0 },
  pipeHdr:    { marginBottom: '8px' },
  pipeCard:   (hover) => ({ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', marginBottom: '8px', cursor: 'pointer', boxShadow: hover ? '0 2px 8px rgba(0,0,0,0.08)' : 'none', transition: 'box-shadow 0.15s' }),
  pipeAmt:    { fontSize: '14px', fontWeight: '700', color: '#111827', margin: '4px 0 0' },
  pipeDate:   { fontSize: '11px', color: '#9ca3af', margin: '4px 0 0' },

  // Buttons
  btn:        { padding: '9px 18px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnGray:    { padding: '7px 14px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  btnSm:      { padding: '5px 12px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },

  // Modal overlay
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' },
  modal:      { background: '#fff', borderRadius: '10px', padding: '1.5rem', width: '100%', maxWidth: '520px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  modalTitle: { margin: '0 0 1.25rem', fontSize: '16px', fontWeight: '700', color: '#111827' },
  label:      { display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '4px' },
  input:      { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#111827', outline: 'none', boxSizing: 'border-box' },
  textarea:   { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#111827', outline: 'none', boxSizing: 'border-box', minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' },
  sel:        { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#111827', outline: 'none', background: '#fff' },
  g2:         { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' },
  fRow:       { marginBottom: '12px' },
  errMsg:     { color: '#dc2626', fontSize: '12px', marginTop: '4px' },

  // Stage badge
  badge:      (stage) => {
    const c = stageCfg(stage)
    return { display: 'inline-block', padding: '3px 9px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', letterSpacing: '0.3px', textTransform: 'uppercase', background: c.bg, color: c.color, border: `1px solid ${c.border}` }
  },
  divBadge:   (div) => ({
    display: 'inline-block', padding: '2px 7px', borderRadius: '3px', fontSize: '10px', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase',
    background: div === 'metal_buildings' ? '#f0f9ff' : '#fdf4ff',
    color:      div === 'metal_buildings' ? '#0369a1' : '#7e22ce',
    border:     `1px solid ${div === 'metal_buildings' ? '#bae6fd' : '#e9d5ff'}`,
  }),
  empty:      { textAlign: 'center', color: '#9ca3af', fontSize: '13px', padding: '3rem 0' },
}

// ─── Component ───────────────────────────────────────────────────────────────

function SalesPageInner() {
  const router = useRouter()
  const qp = useSearchParams()

  const [profile,  setProfile]  = useState(null)
  const [orders,   setOrders]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [view,     setView]     = useState('list')   // 'list' | 'pipeline'
  const [tab,      setTab]      = useState('orders') // 'orders' | 'leaderboard'

  // Filters
  const [search,   setSearch]   = useState('')
  const [division, setDivision] = useState('')
  const [stage,    setStage]    = useState('')
  const [hoveredRow, setHoveredRow] = useState(null)
  const [hoveredCard, setHoveredCard] = useState(null)

  // New order modal
  const [showNew,  setShowNew]  = useState(false)
  const [newForm,  setNewForm]  = useState({ division: 'metal_buildings', customer_name: '', customer_company: '', customer_email: '', customer_phone: '', site_address: '', scope_description: '', quoted_amount: '', salesperson_name: '' })
  const [saving,   setSaving]   = useState(false)
  const [saveErr,  setSaveErr]  = useState('')

  // Leaderboard
  const [lbData,    setLbData]    = useState([])
  const [lbLoading, setLbLoading] = useState(false)
  const [lbFrom,    setLbFrom]    = useState('')
  const [lbTo,      setLbTo]      = useState('')
  const [lbDiv,     setLbDiv]     = useState('')

  const canEdit = profile && ['pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'].includes(profile.role)
  const showFinancials = profile && ['pm', 'apm', 'admin'].includes(profile.role)
  const isAdmin = profile && ['pm', 'apm', 'admin'].includes(profile.role)

  // Auth + initial load
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      const role = prof?.role
      const allowed = ['pm','apm','admin','super','metal_rep','roofing_rep']
      if (!allowed.includes(role)) { router.push('/dashboard'); return }
      setProfile({ ...prof, id: session.user.id, email: session.user.email })
    }
    init()
  }, [])

  const loadOrders = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const params = new URLSearchParams()
      if (division) params.set('division', division)
      if (stage)    params.set('stage', stage)
      if (search)   params.set('search', search)

      const res = await fetch(`/api/sales-orders?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      setOrders(json.data || [])
    } catch {}
    setLoading(false)
  }, [profile, division, stage, search])

  useEffect(() => { loadOrders() }, [loadOrders])

  const loadLeaderboard = useCallback(async () => {
    if (!profile) return
    setLbLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const params = new URLSearchParams()
      if (lbFrom) params.set('from', lbFrom)
      if (lbTo)   params.set('to', lbTo)
      if (lbDiv)  params.set('division', lbDiv)
      const res = await fetch(`/api/sales-leaderboard?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      setLbData(json.rows || [])
    } catch {}
    setLbLoading(false)
  }, [profile, lbFrom, lbTo, lbDiv])

  useEffect(() => { if (tab === 'leaderboard') loadLeaderboard() }, [tab, loadLeaderboard])

  async function createOrder() {
    if (!newForm.customer_name && !newForm.customer_company) { setSaveErr('Customer name or company required'); return }
    setSaving(true); setSaveErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/sales-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: 'create',
          fields: {
            ...newForm,
            quoted_amount: newForm.quoted_amount ? Number(newForm.quoted_amount) : null,
            salesperson_name: newForm.salesperson_name || profile?.full_name || profile?.email,
            salesperson_id: profile?.id,
          },
          actor_name: profile?.full_name || profile?.email,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setSaveErr(json.error || 'Failed'); setSaving(false); return }
      setShowNew(false)
      setNewForm({ division: 'metal_buildings', customer_name: '', customer_company: '', customer_email: '', customer_phone: '', site_address: '', scope_description: '', quoted_amount: '', salesperson_name: '' })
      router.push(`/sales/${json.id}`)
    } catch (e) { setSaveErr(e.message) }
    setSaving(false)
  }

  // Computed stats
  const activeOrders = orders.filter(o => !['cancelled','on_hold'].includes(o.stage))
  const signedValue  = orders.filter(o => !['lead','quoted','cancelled'].includes(o.stage) && o.contract_value).reduce((a, o) => a + Number(o.contract_value), 0)
  const pipelineValue = orders.filter(o => ['lead','quoted'].includes(o.stage) && o.quoted_amount).reduce((a, o) => a + Number(o.quoted_amount), 0)
  const overdue = orders.filter(o => {
    if (['completed','cancelled'].includes(o.stage)) return false
    const d = o.confirmed_install_date || o.expected_install_date
    return d && new Date(d) < new Date()
  })

  // Pipeline grouping
  const pipelineGroups = {}
  for (const st of PIPELINE_STAGES) pipelineGroups[st] = []
  for (const o of orders) {
    if (pipelineGroups[o.stage]) pipelineGroups[o.stage].push(o)
  }

  const filteredOrders = orders.filter(o => {
    if (search) {
      const q = search.toLowerCase()
      return [o.customer_name, o.customer_company, o.order_number, o.site_address, o.salesperson_name].some(v => v?.toLowerCase().includes(q))
    }
    return true
  })

  return (
    <div style={s.page}>

      {/* ── Sidebar ── */}
      <aside style={s.sidebar}>
        <div style={s.sidebarTop}>
          <p style={s.brand}>NV Construction</p>
          <p style={s.divLabel}>Sales & Orders</p>
          <p style={s.userLabel}>{profile?.full_name || profile?.email}</p>
        </div>
        <nav style={s.nav}>
          <button style={s.navItem(tab === 'orders')} onClick={() => setTab('orders')}>📋 Orders</button>
          <button style={s.navItem(tab === 'leaderboard')} onClick={() => setTab('leaderboard')}>🏆 Leaderboard</button>
          <div style={s.navDivider}>Navigate</div>
          <button style={s.navItem(false)} onClick={() => router.push('/dashboard')}>← Dashboard</button>
          <button style={s.navItem(false)} onClick={() => router.push('/metal-buildings')}>Metal Buildings</button>
          <button style={s.navItem(false)} onClick={() => router.push('/roofing')}>Commercial Roofing</button>
        </nav>
        <div style={s.sidebarBot}>
          <button style={s.signOutBtn} onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>Sign out</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={s.main}>

        {/* ── Orders tab ── */}
        {tab === 'orders' && (
          <>
            <div style={s.topBar}>
              <h1 style={s.pageTitle}>Sales & Orders</h1>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button style={s.viewBtn(view === 'list')}     onClick={() => setView('list')}>List</button>
                <button style={s.viewBtn(view === 'pipeline')} onClick={() => setView('pipeline')}>Pipeline</button>
                {canEdit && <button style={s.btn} onClick={() => setShowNew(true)}>+ New Order</button>}
              </div>
            </div>

            {/* Stats */}
            <div style={s.stats}>
              <div style={s.stat}>
                <p style={s.statN}>{activeOrders.length}</p>
                <p style={s.statL}>Active orders</p>
              </div>
              <div style={s.stat}>
                <p style={{ ...s.statN, color: '#e8590c' }}>{fmt$(signedValue)}</p>
                <p style={s.statL}>Signed value</p>
              </div>
              <div style={s.stat}>
                <p style={s.statN}>{fmt$(pipelineValue)}</p>
                <p style={s.statL}>Pipeline (quoted)</p>
              </div>
              <div style={{ ...s.stat, borderColor: overdue.length ? '#fecaca' : '#e5e7eb' }}>
                <p style={{ ...s.statN, color: overdue.length ? '#dc2626' : '#111827' }}>{overdue.length}</p>
                <p style={s.statL}>Overdue</p>
              </div>
            </div>

            {/* Filters */}
            <div style={s.filters}>
              <input
                style={s.filterInput}
                placeholder="Search customer, order#, address…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select style={s.filterSel} value={division} onChange={e => setDivision(e.target.value)}>
                <option value="">All Divisions</option>
                {DIVISIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <select style={s.filterSel} value={stage} onChange={e => setStage(e.target.value)}>
                <option value="">All Stages</option>
                {STAGES.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}
              </select>
              <button style={s.btnSm} onClick={() => { setSearch(''); setDivision(''); setStage('') }}>Clear</button>
            </div>

            {/* ── LIST VIEW ── */}
            {view === 'list' && (
              loading ? <p style={s.empty}>Loading orders…</p> :
              filteredOrders.length === 0 ? <p style={s.empty}>No orders found.</p> : (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Order #</th>
                        <th style={s.th}>Customer</th>
                        <th style={s.th}>Division</th>
                        <th style={s.th}>Stage</th>
                        <th style={s.th}>Salesperson</th>
                        <th style={s.th}>Quoted</th>
                        <th style={s.th}>Contract</th>
                        <th style={s.th}>Install Date</th>
                        <th style={s.th}>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map(o => (
                        <tr
                          key={o.id}
                          style={s.tr(hoveredRow === o.id)}
                          onClick={() => router.push(`/sales/${o.id}`)}
                          onMouseEnter={() => setHoveredRow(o.id)}
                          onMouseLeave={() => setHoveredRow(null)}
                        >
                          <td style={s.td}><strong>{o.order_number}</strong></td>
                          <td style={s.td}>
                            <div>{o.customer_name || o.customer_company || '—'}</div>
                            {o.customer_name && o.customer_company && <div style={s.tdSub}>{o.customer_company}</div>}
                            {o.site_address && <div style={s.tdSub}>{o.city || o.site_address}</div>}
                          </td>
                          <td style={s.td}><span style={s.divBadge(o.division)}>{o.division === 'metal_buildings' ? 'Metal' : 'Roofing'}</span></td>
                          <td style={s.td}><span style={s.badge(o.stage)}>{stageCfg(o.stage).label}</span></td>
                          <td style={s.td}>{o.salesperson_name || '—'}</td>
                          <td style={s.td}>{o.quoted_amount ? fmt$(o.quoted_amount) : '—'}</td>
                          <td style={s.td}>{o.contract_value ? fmt$(o.contract_value) : '—'}</td>
                          <td style={s.td}>
                            {o.confirmed_install_date
                              ? <span style={{ color: '#16a34a' }}>{fmtDate(o.confirmed_install_date)}</span>
                              : o.expected_install_date
                                ? <span style={{ color: '#9ca3af' }}>{fmtDate(o.expected_install_date)} est.</span>
                                : '—'}
                          </td>
                          <td style={{ ...s.td, color: '#9ca3af', fontSize: '11px' }}>
                            {o.updated_at ? new Date(o.updated_at).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* ── PIPELINE VIEW ── */}
            {view === 'pipeline' && (
              loading ? <p style={s.empty}>Loading…</p> : (
                <div style={s.pipeline}>
                  {PIPELINE_STAGES.map(stKey => {
                    const cfg = stageCfg(stKey)
                    const cols = (pipelineGroups[stKey] || []).filter(o => {
                      if (!search) return true
                      const q = search.toLowerCase()
                      return [o.customer_name, o.customer_company, o.order_number].some(v => v?.toLowerCase().includes(q))
                    })
                    const colValue = cols.reduce((a, o) => a + Number(o.contract_value || o.quoted_amount || 0), 0)
                    return (
                      <div key={stKey} style={s.pipeCol}>
                        <div style={s.pipeHdr}>
                          <span style={{ ...s.badge(stKey), display: 'block', textAlign: 'center', marginBottom: '4px' }}>{cfg.label}</span>
                          <div style={{ textAlign: 'center', fontSize: '11px', color: '#9ca3af' }}>
                            {cols.length} order{cols.length !== 1 ? 's' : ''} · {fmt$(colValue)}
                          </div>
                        </div>
                        {cols.length === 0 && <div style={{ ...s.pipeCard(false), cursor: 'default', color: '#9ca3af', fontSize: '12px', textAlign: 'center' }}>—</div>}
                        {cols.map(o => (
                          <div
                            key={o.id}
                            style={s.pipeCard(hoveredCard === o.id)}
                            onClick={() => router.push(`/sales/${o.id}`)}
                            onMouseEnter={() => setHoveredCard(o.id)}
                            onMouseLeave={() => setHoveredCard(null)}
                          >
                            <div style={{ fontSize: '11px', color: '#9ca3af' }}>{o.order_number}</div>
                            <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827', margin: '2px 0' }}>
                              {o.customer_name || o.customer_company || '—'}
                            </div>
                            {o.customer_name && o.customer_company && <div style={{ fontSize: '11px', color: '#6b7280' }}>{o.customer_company}</div>}
                            <div style={s.pipeAmt}>{fmt$(o.contract_value || o.quoted_amount)}</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                              <span style={s.divBadge(o.division)}>{o.division === 'metal_buildings' ? 'Metal' : 'Roof'}</span>
                              {o.salesperson_name && <span style={{ fontSize: '10px', color: '#9ca3af' }}>{o.salesperson_name.split(' ')[0]}</span>}
                            </div>
                            {(o.expected_install_date || o.confirmed_install_date) && (
                              <div style={s.pipeDate}>
                                Install: {fmtDate(o.confirmed_install_date || o.expected_install_date)}
                                {!o.confirmed_install_date && ' (est.)'}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </>
        )}

        {/* ── Leaderboard tab ── */}
        {tab === 'leaderboard' && (
          <>
            <div style={s.topBar}>
              <h1 style={s.pageTitle}>Sales Leaderboard</h1>
            </div>

            {/* Counting rules note */}
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', padding: '10px 14px', marginBottom: '1.25rem', fontSize: '12px', color: '#92400e' }}>
              <strong>Counting rules:</strong> Only orders at stage Contract Signed or later (not Lead, Quoted, or Cancelled) count. Attributed to the assigned salesperson at the time of signing. Split sales are not yet tracked separately.
            </div>

            {/* Leaderboard filters */}
            <div style={s.filters}>
              <div>
                <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }}>From</label>
                <input type="date" style={s.filterInput} value={lbFrom} onChange={e => setLbFrom(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }}>To</label>
                <input type="date" style={s.filterInput} value={lbTo} onChange={e => setLbTo(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }}>Division</label>
                <select style={s.filterSel} value={lbDiv} onChange={e => setLbDiv(e.target.value)}>
                  <option value="">All Divisions</option>
                  {DIVISIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button style={s.btn} onClick={loadLeaderboard}>Refresh</button>
              </div>
            </div>

            {lbLoading ? <p style={s.empty}>Loading…</p> :
             lbData.length === 0 ? <p style={s.empty}>No qualifying sales in the selected period.</p> : (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Rank</th>
                      <th style={s.th}>Salesperson</th>
                      <th style={s.th}>Signed Sales</th>
                      <th style={s.th}>Signed Value</th>
                      {showFinancials && <th style={s.th}>Est. Gross Profit</th>}
                      <th style={s.th}>By Division</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lbData.map((row, i) => (
                      <tr key={row.salesperson_id || row.salesperson_name} style={s.tr(false)}>
                        <td style={s.td}>
                          <span style={{ fontWeight: '700', color: i === 0 ? '#e8590c' : i === 1 ? '#6b7280' : '#9ca3af' }}>
                            #{i + 1}
                          </span>
                        </td>
                        <td style={s.td}><strong>{row.salesperson_name}</strong></td>
                        <td style={s.td}>{row.signed_count}</td>
                        <td style={{ ...s.td, fontWeight: '600', color: '#111827' }}>{fmt$(row.signed_value)}</td>
                        {showFinancials && (
                          <td style={{ ...s.td, color: '#16a34a' }}>{row.gross_profit ? fmt$(row.gross_profit) : '—'}</td>
                        )}
                        <td style={s.td}>
                          {Object.entries(row.by_division || {}).map(([div, d]) => (
                            <span key={div} style={{ ...s.divBadge(div), marginRight: '4px' }}>
                              {div === 'metal_buildings' ? 'Metal' : 'Roof'}: {d.count}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── New Order Modal ── */}
      {showNew && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setShowNew(false)}>
          <div style={s.modal}>
            <h2 style={s.modalTitle}>New Sales Order</h2>

            <div style={s.fRow}>
              <label style={s.label}>Division</label>
              <select style={s.sel} value={newForm.division} onChange={e => setNewForm(f => ({ ...f, division: e.target.value }))}>
                {DIVISIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>

            <div style={s.g2}>
              <div>
                <label style={s.label}>Customer Name</label>
                <input style={s.input} value={newForm.customer_name} onChange={e => setNewForm(f => ({ ...f, customer_name: e.target.value }))} placeholder="John Smith" />
              </div>
              <div>
                <label style={s.label}>Company</label>
                <input style={s.input} value={newForm.customer_company} onChange={e => setNewForm(f => ({ ...f, customer_company: e.target.value }))} placeholder="Smith Farms LLC" />
              </div>
            </div>

            <div style={s.g2}>
              <div>
                <label style={s.label}>Email</label>
                <input type="email" style={s.input} value={newForm.customer_email} onChange={e => setNewForm(f => ({ ...f, customer_email: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Phone</label>
                <input style={s.input} value={newForm.customer_phone} onChange={e => setNewForm(f => ({ ...f, customer_phone: e.target.value }))} />
              </div>
            </div>

            <div style={s.fRow}>
              <label style={s.label}>Site Address</label>
              <input style={s.input} value={newForm.site_address} onChange={e => setNewForm(f => ({ ...f, site_address: e.target.value }))} placeholder="123 Main St, City, TX 78701" />
            </div>

            <div style={s.g2}>
              <div>
                <label style={s.label}>Quoted Amount</label>
                <input type="number" style={s.input} value={newForm.quoted_amount} onChange={e => setNewForm(f => ({ ...f, quoted_amount: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <label style={s.label}>Salesperson</label>
                <input style={s.input} value={newForm.salesperson_name} onChange={e => setNewForm(f => ({ ...f, salesperson_name: e.target.value }))} placeholder={profile?.full_name || ''} />
              </div>
            </div>

            <div style={{ ...s.fRow, marginBottom: '1.25rem' }}>
              <label style={s.label}>Scope / Notes</label>
              <textarea style={s.textarea} value={newForm.scope_description} onChange={e => setNewForm(f => ({ ...f, scope_description: e.target.value }))} rows={2} />
            </div>

            {saveErr && <p style={s.errMsg}>{saveErr}</p>}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={s.btnGray} onClick={() => { setShowNew(false); setSaveErr('') }}>Cancel</button>
              <button style={{ ...s.btn, opacity: saving ? 0.6 : 1 }} onClick={createOrder} disabled={saving}>
                {saving ? 'Creating…' : 'Create Order'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default function SalesPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#f4f6f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', color: '#9ca3af' }}>Loading…</div>}>
      <SalesPageInner />
    </Suspense>
  )
}
