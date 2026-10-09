'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'lead',            label: 'Lead',            color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe' },
  { key: 'quoted',          label: 'Quoted',           color: '#c2410c', bg: '#fff7ed', border: '#fdba74' },
  { key: 'contract_signed', label: 'Contract Signed',  color: '#0369a1', bg: '#eff6ff', border: '#bae6fd' },
  { key: 'order_placed',    label: 'Order Placed',     color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
  { key: 'scheduled',       label: 'Scheduled',        color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' },
  { key: 'installed',       label: 'Installed',        color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  { key: 'completed',       label: 'Completed',        color: '#16a34a', bg: '#dcfce7', border: '#86efac' },
  { key: 'cancelled',       label: 'Cancelled',        color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  { key: 'on_hold',         label: 'On Hold',          color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb' },
]

const PROGRESSION = ['lead','quoted','contract_signed','order_placed','scheduled','installed','completed']
const NEXT_STAGE_LABEL = {
  lead:            'Mark as Quoted',
  quoted:          'Record Contract Signed',
  contract_signed: 'Mark as Order Placed',
  order_placed:    'Mark as Scheduled',
  scheduled:       'Mark as Installed',
  installed:       'Mark as Completed',
}
const NEXT_ACTION_TEXT = {
  lead:            { action: 'Send a quote to the customer', person: 'salesperson' },
  quoted:          { action: 'Obtain signed contract', person: 'salesperson' },
  contract_signed: { action: 'Place supplier order', person: 'ops owner' },
  order_placed:    { action: 'Confirm delivery and schedule installation', person: 'ops owner' },
  scheduled:       { action: 'Confirm installation is complete', person: 'ops owner' },
  installed:       { action: 'Complete final walkthrough and upload photos', person: 'ops owner' },
  completed:       { action: 'Order complete', person: null },
}

const DOC_CATEGORIES = ['contract','quote','permit','photo','completion','other','general']
const BUILDING_USES   = ['Storage','Workshop','Agriculture','Commercial','Industrial','Retail','Auto Shop','Church','Other']
const ROOF_TYPES      = ['TPO','EPDM','Metal','Built-Up','Modified Bitumen','Shingle','Other']

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt$ = v => v != null && v !== '' ? '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'
const fmtDate = d => d ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtDT  = d => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const stageCfg = k => STAGES.find(s => s.key === k) || { label: k, color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' }
const nextStageKey = k => { const i = PROGRESSION.indexOf(k); return i >= 0 && i < PROGRESSION.length - 1 ? PROGRESSION[i + 1] : null }

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = {
  page:     { minHeight: '100vh', background: '#f4f6f8', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header:   { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 20, minHeight: '54px' },
  backBtn:  { background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 0', fontWeight: '500', flexShrink: 0 },
  hdivider: { width: '1px', height: '20px', background: '#e5e7eb', flexShrink: 0 },
  htitle:   { margin: 0, fontSize: '15px', fontWeight: '700', color: '#111827' },
  hmeta:    { margin: '2px 0 0', fontSize: '11px', color: '#9ca3af' },
  hright:   { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingTop: '8px', paddingBottom: '8px' },
  badge:    k => { const c = stageCfg(k); return { display: 'inline-block', padding: '3px 9px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', letterSpacing: '0.3px', textTransform: 'uppercase', background: c.bg, color: c.color, border: `1px solid ${c.border}` } },
  divBadge: div => ({ display: 'inline-block', padding: '2px 7px', borderRadius: '3px', fontSize: '10px', fontWeight: '600', textTransform: 'uppercase', background: div === 'metal_buildings' ? '#f0f9ff' : '#fdf4ff', color: div === 'metal_buildings' ? '#0369a1' : '#7e22ce', border: `1px solid ${div === 'metal_buildings' ? '#bae6fd' : '#e9d5ff'}` }),

  tabNav:   { display: 'flex', borderBottom: '1px solid #e5e7eb', background: '#fff', padding: '0 1.5rem', overflowX: 'auto' },
  tab:      a => ({ padding: '11px 16px', borderBottom: a ? '2px solid #e8590c' : '2px solid transparent', color: a ? '#e8590c' : '#6b7280', fontSize: '13px', fontWeight: a ? '600' : '400', background: 'none', border: 'none', borderBottom: a ? '2px solid #e8590c' : '2px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap' }),

  body:     { maxWidth: '960px', margin: '0 auto', padding: '1.5rem' },
  card:     { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' },
  sec:      { margin: '0 0 0.875rem', fontSize: '11px', fontWeight: '700', color: '#6b7280', letterSpacing: '0.8px', textTransform: 'uppercase' },
  g2:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' },
  g3:       { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' },
  fRow:     { marginBottom: '12px' },
  lbl:      { display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '4px' },
  inp:      { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#111827', outline: 'none', boxSizing: 'border-box' },
  ta:       { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#111827', outline: 'none', boxSizing: 'border-box', minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' },
  sel:      { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#111827', outline: 'none', background: '#fff', boxSizing: 'border-box' },

  btn:      { padding: '8px 16px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnGray:  { padding: '8px 16px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  btnSm:    c => ({ padding: '5px 10px', borderRadius: '5px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', background: c === 'red' ? '#fef2f2' : c === 'green' ? '#f0fdf4' : '#f9fafb', color: c === 'red' ? '#dc2626' : c === 'green' ? '#16a34a' : '#374151', border: `1px solid ${c === 'red' ? '#fecaca' : c === 'green' ? '#bbf7d0' : '#e5e7eb'}` }),
  btnBlue:  { padding: '7px 14px', background: '#eff6ff', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },

  kv:       { fontSize: '13px', color: '#111827', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '2px' },
  kvLabel:  { fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' },
  kvValue:  { fontWeight: '500' },

  row:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f3f4f6', gap: '10px' },
  taskRow:  p => ({ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '9px 0', borderBottom: '1px solid #f3f4f6', opacity: p.status === 'done' ? 0.5 : 1 }),

  statusPill: st => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600',
    background: st === 'done' ? '#f0fdf4' : st === 'in_progress' ? '#eff6ff' : st === 'cancelled' ? '#fef2f2' : '#f9fafb',
    color:      st === 'done' ? '#16a34a' : st === 'in_progress' ? '#0369a1' : st === 'cancelled' ? '#dc2626' : '#6b7280',
    border:     `1px solid ${st === 'done' ? '#bbf7d0' : st === 'in_progress' ? '#bae6fd' : st === 'cancelled' ? '#fecaca' : '#e5e7eb'}`,
  }),
  priorityDot: p => ({ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '4px', background: p === 'high' ? '#dc2626' : p === 'low' ? '#9ca3af' : '#e8590c' }),

  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' },
  modal:    { background: '#fff', borderRadius: '10px', padding: '1.5rem', width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' },
  mTitle:   { margin: '0 0 1.25rem', fontSize: '16px', fontWeight: '700', color: '#111827' },

  err:      { color: '#dc2626', fontSize: '12px', marginTop: '4px' },
  ok:       { color: '#16a34a', fontSize: '12px', marginTop: '4px' },
  empty:    { color: '#9ca3af', fontSize: '13px', padding: '1.5rem 0', textAlign: 'center' },

  updateCard: vis => ({ background: vis ? '#fff' : '#f9fafb', border: `1px solid ${vis ? '#e5e7eb' : '#f3f4f6'}`, borderRadius: '6px', padding: '10px 14px', marginBottom: '8px' }),
  histEntry:  { display: 'flex', gap: '10px', padding: '7px 0', borderBottom: '1px solid #f9fafb', fontSize: '12px', color: '#374151' },

  nextAction: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '14px' },
  warning:    { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 12px', marginBottom: '8px', fontSize: '12px', color: '#dc2626' },
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SalesOrderDetailPage() {
  const { id } = useParams()
  const router = useRouter()

  const [profile,   setProfile]   = useState(null)
  const [order,     setOrder]     = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [tab,       setTab]       = useState('overview')
  const [saving,    setSaving]    = useState(false)
  const [saveMsg,   setSaveMsg]   = useState('')
  const [dirty,     setDirty]     = useState(false)

  // Editable fields (form state)
  const [form, setForm] = useState({})

  // Data from related tables
  const [docs,         setDocs]         = useState([])
  const [tasks,        setTasks]        = useState([])
  const [updates,      setUpdates]      = useState([])
  const [history,      setHistory]      = useState([])
  const [sigRequests,  setSigRequests]  = useState([])
  const [portalAccess, setPortalAccess] = useState([])

  // Modals
  const [showStage,       setShowStage]       = useState(false)
  const [newStage,        setNewStage]        = useState('')
  const [stageSaving,     setStageSaving]     = useState(false)
  const [showTaskModal,   setShowTaskModal]   = useState(false)
  const [taskForm,        setTaskForm]        = useState({ title: '', assignee_name: '', due_date: '', priority: 'normal' })
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [updateForm,      setUpdateForm]      = useState({ body: '', visible_to_customer: false })
  const [showPortalModal, setShowPortalModal] = useState(false)
  const [inviteForm,      setInviteForm]      = useState({ email: '', name: '' })
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFile,      setUploadFile]      = useState(null)
  const [uploadMeta,      setUploadMeta]      = useState({ category: 'general', visible_to_customer: false })
  const [uploading,       setUploading]       = useState(false)
  const [modalErr,        setModalErr]        = useState('')
  const [modalOk,         setModalOk]         = useState('')

  // Products / line items (scope tab)
  const [products, setProducts] = useState([])

  const fileInputRef = useRef(null)

  const canEdit       = profile && ['pm','apm','admin','metal_rep','roofing_rep'].includes(profile.role)
  const showFinancials = profile && ['pm','apm','admin'].includes(profile.role)
  const isAdmin       = profile && ['pm','apm','admin'].includes(profile.role)

  // Auth + load
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      const allowed = ['pm','apm','admin','super','metal_rep','roofing_rep']
      if (!allowed.includes(prof?.role)) { router.push('/dashboard'); return }
      setProfile({ ...prof, id: session.user.id, email: session.user.email })
    }
    init()
  }, [])

  const loadOrder = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/sales-orders?id=${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (!res.ok) { setLoading(false); return }
      const { data } = await res.json()
      setOrder(data)
      setForm({
        customer_name: data.customer_name || '',
        customer_company: data.customer_company || '',
        customer_email: data.customer_email || '',
        customer_phone: data.customer_phone || '',
        site_address: data.site_address || '',
        city: data.city || '',
        state: data.state || '',
        zip: data.zip || '',
        salesperson_name: data.salesperson_name || '',
        ops_owner_name: data.ops_owner_name || '',
        scope_description: data.scope_description || '',
        exclusions: data.exclusions || '',
        width_ft: data.width_ft || '',
        length_ft: data.length_ft || '',
        height_ft: data.height_ft || '',
        building_use: data.building_use || '',
        supplier_ref: data.supplier_ref || '',
        roof_type: data.roof_type || '',
        roof_size_sqft: data.roof_size_sqft || '',
        building_type: data.building_type || '',
        quoted_amount: data.quoted_amount || '',
        contract_value: data.contract_value || '',
        internal_cost: data.internal_cost || '',
        estimated_profit: data.estimated_profit || '',
        deposit_amount: data.deposit_amount || '',
        deposit_received: data.deposit_received || false,
        deposit_received_date: data.deposit_received_date || '',
        expected_delivery_date: data.expected_delivery_date || '',
        confirmed_delivery_date: data.confirmed_delivery_date || '',
        delivery_notes: data.delivery_notes || '',
        expected_install_date: data.expected_install_date || '',
        confirmed_install_date: data.confirmed_install_date || '',
        install_notes: data.install_notes || '',
        install_crew: data.install_crew || '',
        supplier_order_confirmation: data.supplier_order_confirmation || '',
        internal_notes: data.internal_notes || '',
      })
      setProducts(Array.isArray(data.products) ? data.products : [])
      setDocs(data.docs || [])
      setTasks(data.tasks || [])
      setUpdates(data.updates || [])
      setHistory(data.history || [])
      setSigRequests(data.signature_requests || [])
      setDirty(false)
    } catch {}
    setLoading(false)
  }, [profile, id])

  useEffect(() => { loadOrder() }, [loadOrder])

  async function authHeader() {
    const { data: { session } } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
  }

  async function save() {
    setSaving(true); setSaveMsg('')
    try {
      const headers = await authHeader()
      const res = await fetch('/api/sales-orders', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'update',
          id,
          fields: {
            ...form,
            products,
            quoted_amount:   form.quoted_amount   !== '' ? Number(form.quoted_amount)   : null,
            contract_value:  form.contract_value  !== '' ? Number(form.contract_value)  : null,
            internal_cost:   form.internal_cost   !== '' ? Number(form.internal_cost)   : null,
            estimated_profit: form.estimated_profit !== '' ? Number(form.estimated_profit) : null,
            deposit_amount:  form.deposit_amount  !== '' ? Number(form.deposit_amount)  : null,
            width_ft:        form.width_ft        !== '' ? Number(form.width_ft)        : null,
            length_ft:       form.length_ft       !== '' ? Number(form.length_ft)       : null,
            height_ft:       form.height_ft       !== '' ? Number(form.height_ft)       : null,
            roof_size_sqft:  form.roof_size_sqft  !== '' ? Number(form.roof_size_sqft)  : null,
          },
          actor_name: profile?.full_name || profile?.email,
        }),
      })
      if (!res.ok) { const j = await res.json(); setSaveMsg('Error: ' + (j.error || 'Save failed')); setSaving(false); return }
      setDirty(false)
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(''), 2500)
      loadOrder()
    } catch (e) { setSaveMsg('Error: ' + e.message) }
    setSaving(false)
  }

  async function setStage(stage) {
    setStageSaving(true)
    const headers = await authHeader()
    await fetch('/api/sales-orders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'set_stage', id, stage, actor_name: profile?.full_name || profile?.email }),
    })
    setStageSaving(false)
    setShowStage(false)
    loadOrder()
  }

  async function createTask() {
    if (!taskForm.title) { setModalErr('Title required'); return }
    setModalErr('')
    const headers = await authHeader()
    const res = await fetch('/api/sales-order-tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'create', order_id: id, ...taskForm, actor_name: profile?.full_name }),
    })
    if (!res.ok) { const j = await res.json(); setModalErr(j.error || 'Failed'); return }
    setShowTaskModal(false)
    setTaskForm({ title: '', assignee_name: '', due_date: '', priority: 'normal' })
    loadOrder()
  }

  async function toggleTask(task) {
    const newStatus = task.status === 'done' ? 'open' : 'done'
    const headers = await authHeader()
    await fetch('/api/sales-order-tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'update', id: task.id, fields: { status: newStatus }, actor_name: profile?.full_name }),
    })
    loadOrder()
  }

  async function postUpdate() {
    if (!updateForm.body.trim()) { setModalErr('Message required'); return }
    setModalErr('')
    const headers = await authHeader()
    const res = await fetch('/api/sales-order-updates', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'create', order_id: id, body: updateForm.body, visible_to_customer: updateForm.visible_to_customer, author_name: profile?.full_name || profile?.email }),
    })
    if (!res.ok) { const j = await res.json(); setModalErr(j.error || 'Failed'); return }
    setShowUpdateModal(false)
    setUpdateForm({ body: '', visible_to_customer: false })
    loadOrder()
  }

  async function inviteCustomer() {
    if (!inviteForm.email) { setModalErr('Email required'); return }
    setModalErr(''); setModalOk('')
    const headers = await authHeader()
    const res = await fetch('/api/customer-portal', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'invite', order_id: id, email: inviteForm.email, name: inviteForm.name, inviter_name: profile?.full_name }),
    })
    if (!res.ok) { const j = await res.json(); setModalErr(j.error || 'Failed'); return }
    setModalOk(`Invitation sent to ${inviteForm.email}`)
    setInviteForm({ email: '', name: '' })
    loadPortalAccess()
  }

  async function loadPortalAccess() {
    const headers = await authHeader()
    const res = await fetch('/api/customer-portal', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'list', order_id: id }),
    })
    if (res.ok) { const j = await res.json(); setPortalAccess(j.accesses || []) }
  }

  useEffect(() => { if (tab === 'portal' && profile) loadPortalAccess() }, [tab, profile])

  async function revokeAccess(accessId) {
    if (!window.confirm('Revoke this customer\'s portal access?')) return
    const headers = await authHeader()
    await fetch('/api/customer-portal', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'revoke', id: accessId }),
    })
    loadPortalAccess()
  }

  async function uploadDoc() {
    if (!uploadFile) { setModalErr('Select a file first'); return }
    setUploading(true); setModalErr('')
    const { data: { session } } = await supabase.auth.getSession()
    const fd = new FormData()
    fd.append('file', uploadFile)
    fd.append('data', JSON.stringify({ order_id: id, category: uploadMeta.category, visible_to_customer: uploadMeta.visible_to_customer, uploaded_by_name: profile?.full_name }))
    const res = await fetch('/api/sales-order-docs', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: fd })
    if (!res.ok) { const j = await res.json(); setModalErr(j.error || 'Upload failed'); setUploading(false); return }
    setUploading(false)
    setShowUploadModal(false)
    setUploadFile(null)
    loadOrder()
  }

  async function downloadDoc(doc) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/sales-order-docs?signed_url=${encodeURIComponent(doc.storage_path)}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (res.ok) { const { url } = await res.json(); window.open(url, '_blank') }
  }

  async function toggleDocVisibility(doc) {
    const headers = await authHeader()
    await fetch('/api/sales-order-docs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'toggle_customer_visibility', id: doc.id, visible_to_customer: !doc.visible_to_customer }),
    })
    loadOrder()
  }

  function addProduct() {
    setProducts(p => [...p, { name: '', qty: 1, unit: 'ea', unit_price: '', description: '' }])
    setDirty(true)
  }
  function updateProduct(idx, key, val) {
    setProducts(p => p.map((x, i) => i === idx ? { ...x, [key]: val } : x))
    setDirty(true)
  }
  function removeProduct(idx) {
    setProducts(p => p.filter((_, i) => i !== idx))
    setDirty(true)
  }

  const formSet = (key, val) => { setForm(f => ({ ...f, [key]: val })); setDirty(true) }

  if (loading || !order) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', color: '#9ca3af', fontFamily: 'system-ui' }}>
      {loading ? 'Loading order…' : 'Order not found.'}
    </div>
  }

  const cfg = stageCfg(order.stage)
  const nextStage = nextStageKey(order.stage)
  const nextAction = NEXT_ACTION_TEXT[order.stage]
  const overdueTasks = tasks.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date) < new Date())

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <header style={s.header}>
        <button style={s.backBtn} onClick={() => router.push('/sales')}>← Orders</button>
        <div style={s.hdivider} />
        <div>
          <p style={s.htitle}>{order.order_number} · {order.customer_name || order.customer_company || 'No customer'}</p>
          <p style={s.hmeta}>{order.site_address || ''}{order.salesperson_name ? ' · ' + order.salesperson_name : ''}</p>
        </div>
        <div style={s.hright}>
          <span style={s.badge(order.stage)}>{cfg.label}</span>
          {dirty && !saving && <span style={{ fontSize: '12px', color: '#9ca3af' }}>Unsaved</span>}
          {saving  && <span style={{ fontSize: '12px', color: '#6b7280' }}>Saving…</span>}
          {saveMsg && <span style={{ fontSize: '12px', color: saveMsg.startsWith('Error') ? '#dc2626' : '#16a34a', fontWeight: '500' }}>{saveMsg}</span>}
          {nextStage && canEdit && (
            <button style={{ ...s.btn, fontSize: '12px', padding: '6px 12px' }} onClick={() => { setNewStage(nextStage); setShowStage(true) }}>
              {NEXT_STAGE_LABEL[order.stage]} →
            </button>
          )}
          {canEdit && (
            <button style={{ ...s.btn, opacity: dirty ? 1 : 0.55, fontSize: '12px', padding: '6px 12px' }} onClick={save} disabled={!dirty || saving}>
              Save
            </button>
          )}
        </div>
      </header>

      {/* ── Tab nav ── */}
      <nav style={s.tabNav}>
        {['overview','scope','documents','schedule','tasks','updates','portal','history'].map(t => (
          <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' : t === 'scope' ? 'Scope & Products' : t === 'documents' ? 'Documents' : t === 'schedule' ? 'Schedule' : t === 'tasks' ? `Tasks${overdueTasks.length ? ` (${overdueTasks.length})` : ''}` : t === 'updates' ? 'Updates' : t === 'portal' ? 'Customer Portal' : 'History'}
          </button>
        ))}
      </nav>

      <div style={s.body}>

        {/* ══ OVERVIEW ══════════════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <>
            {/* Next action banner */}
            {nextAction && order.stage !== 'completed' && (
              <div style={s.nextAction}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '600', fontSize: '13px', color: '#92400e' }}>Next: {nextAction.action}</div>
                  {nextAction.person && <div style={{ fontSize: '12px', color: '#b45309', marginTop: '2px' }}>Responsible: {nextAction.person === 'salesperson' ? (order.salesperson_name || 'Salesperson') : (order.ops_owner_name || 'Ops Owner')}</div>}
                </div>
                {nextStage && canEdit && (
                  <button style={{ ...s.btn, fontSize: '12px', padding: '6px 12px', flexShrink: 0 }} onClick={() => { setNewStage(nextStage); setShowStage(true) }}>
                    {NEXT_STAGE_LABEL[order.stage]}
                  </button>
                )}
              </div>
            )}

            {/* Warnings */}
            {['contract_signed','order_placed','scheduled','installed'].includes(order.stage) && !order.contract_value && (
              <div style={s.warning}>⚠ No contract value recorded</div>
            )}
            {['order_placed','scheduled'].includes(order.stage) && !order.expected_delivery_date && !order.confirmed_delivery_date && (
              <div style={s.warning}>⚠ No delivery date set</div>
            )}
            {overdueTasks.length > 0 && (
              <div style={s.warning}>⚠ {overdueTasks.length} overdue task{overdueTasks.length > 1 ? 's' : ''}</div>
            )}

            {/* Key info grid */}
            <div style={s.card}>
              <p style={s.sec}>Order Info</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
                <div style={s.kv}><span style={s.kvLabel}>Division</span><span style={s.kvValue}><span style={s.divBadge(order.division)}>{order.division === 'metal_buildings' ? 'Metal Buildings' : 'Commercial Roofing'}</span></span></div>
                <div style={s.kv}><span style={s.kvLabel}>Stage</span><span style={s.kvValue}><span style={s.badge(order.stage)}>{cfg.label}</span></span></div>
                <div style={s.kv}><span style={s.kvLabel}>Salesperson</span><span style={s.kvValue}>{order.salesperson_name || '—'}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Ops Owner</span><span style={s.kvValue}>{order.ops_owner_name || '—'}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Quoted</span><span style={s.kvValue}>{fmt$(order.quoted_amount)}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Contract Value</span><span style={{ ...s.kvValue, color: order.contract_value ? '#111827' : '#9ca3af' }}>{fmt$(order.contract_value)}</span></div>
                {showFinancials && <div style={s.kv}><span style={s.kvLabel}>Internal Cost</span><span style={s.kvValue}>{fmt$(order.internal_cost)}</span></div>}
                {showFinancials && <div style={s.kv}><span style={s.kvLabel}>Est. GP</span><span style={{ ...s.kvValue, color: '#16a34a' }}>{fmt$(order.estimated_profit)}</span></div>}
              </div>
            </div>

            {/* Customer */}
            <div style={s.card}>
              <p style={s.sec}>Customer</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
                <div style={s.kv}><span style={s.kvLabel}>Name</span><span style={s.kvValue}>{order.customer_name || '—'}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Company</span><span style={s.kvValue}>{order.customer_company || '—'}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Email</span><span style={s.kvValue}>{order.customer_email || '—'}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Phone</span><span style={s.kvValue}>{order.customer_phone || '—'}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Site Address</span><span style={s.kvValue}>{[order.site_address, order.city, order.state, order.zip].filter(Boolean).join(', ') || '—'}</span></div>
              </div>
            </div>

            {/* Dates */}
            <div style={s.card}>
              <p style={s.sec}>Key Dates</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px' }}>
                <div style={s.kv}><span style={s.kvLabel}>Created</span><span style={s.kvValue}>{fmtDate(order.created_at)}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Won / Signed</span><span style={s.kvValue}>{fmtDate(order.contract_signed_at || order.won_at)}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Supplier Order</span><span style={s.kvValue}>{fmtDate(order.supplier_order_placed_at)}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Expected Delivery</span><span style={{ ...s.kvValue, color: '#9ca3af' }}>{fmtDate(order.expected_delivery_date)}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Confirmed Delivery</span><span style={{ ...s.kvValue, color: '#16a34a' }}>{fmtDate(order.confirmed_delivery_date)}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Expected Install</span><span style={{ ...s.kvValue, color: '#9ca3af' }}>{fmtDate(order.expected_install_date)}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Confirmed Install</span><span style={{ ...s.kvValue, color: '#16a34a' }}>{fmtDate(order.confirmed_install_date)}</span></div>
                <div style={s.kv}><span style={s.kvLabel}>Completed</span><span style={{ ...s.kvValue, color: '#16a34a' }}>{fmtDate(order.completed_at)}</span></div>
              </div>
            </div>

            {/* Recent updates */}
            {updates.length > 0 && (
              <div style={s.card}>
                <p style={s.sec}>Recent Updates</p>
                {updates.slice(0, 3).map(u => (
                  <div key={u.id} style={s.updateCard(u.visible_to_customer)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>{u.author_name}</span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {u.visible_to_customer && <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: '600' }}>Customer visible</span>}
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>{fmtDT(u.created_at)}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', color: '#374151' }}>{u.body}</div>
                  </div>
                ))}
                {updates.length > 3 && <button style={{ ...s.btnSm(), marginTop: '4px' }} onClick={() => setTab('updates')}>View all {updates.length} updates</button>}
              </div>
            )}
          </>
        )}

        {/* ══ SCOPE & PRODUCTS ══════════════════════════════════════════════ */}
        {tab === 'scope' && (
          <>
            {/* Customer / contact info */}
            <div style={s.card}>
              <p style={s.sec}>Customer Information</p>
              <div style={s.g2}>
                <div><label style={s.lbl}>Customer Name</label><input style={s.inp} value={form.customer_name} onChange={e => formSet('customer_name', e.target.value)} disabled={!canEdit} /></div>
                <div><label style={s.lbl}>Company</label><input style={s.inp} value={form.customer_company} onChange={e => formSet('customer_company', e.target.value)} disabled={!canEdit} /></div>
                <div><label style={s.lbl}>Email</label><input type="email" style={s.inp} value={form.customer_email} onChange={e => formSet('customer_email', e.target.value)} disabled={!canEdit} /></div>
                <div><label style={s.lbl}>Phone</label><input style={s.inp} value={form.customer_phone} onChange={e => formSet('customer_phone', e.target.value)} disabled={!canEdit} /></div>
              </div>
              <div style={s.fRow}>
                <label style={s.lbl}>Site Address</label>
                <input style={s.inp} value={form.site_address} onChange={e => formSet('site_address', e.target.value)} disabled={!canEdit} placeholder="123 Main St" />
              </div>
              <div style={s.g3}>
                <div><label style={s.lbl}>City</label><input style={s.inp} value={form.city} onChange={e => formSet('city', e.target.value)} disabled={!canEdit} /></div>
                <div><label style={s.lbl}>State</label><input style={s.inp} value={form.state} onChange={e => formSet('state', e.target.value)} disabled={!canEdit} /></div>
                <div><label style={s.lbl}>Zip</label><input style={s.inp} value={form.zip} onChange={e => formSet('zip', e.target.value)} disabled={!canEdit} /></div>
              </div>
            </div>

            {/* Division-specific specs */}
            {order.division === 'metal_buildings' && (
              <div style={s.card}>
                <p style={s.sec}>Building Specs</p>
                <div style={s.g3}>
                  <div><label style={s.lbl}>Width (ft)</label><input type="number" style={s.inp} value={form.width_ft} onChange={e => formSet('width_ft', e.target.value)} disabled={!canEdit} /></div>
                  <div><label style={s.lbl}>Length (ft)</label><input type="number" style={s.inp} value={form.length_ft} onChange={e => formSet('length_ft', e.target.value)} disabled={!canEdit} /></div>
                  <div><label style={s.lbl}>Height (ft)</label><input type="number" style={s.inp} value={form.height_ft} onChange={e => formSet('height_ft', e.target.value)} disabled={!canEdit} /></div>
                </div>
                <div style={s.g2}>
                  <div>
                    <label style={s.lbl}>Building Use</label>
                    <select style={s.sel} value={form.building_use} onChange={e => formSet('building_use', e.target.value)} disabled={!canEdit}>
                      <option value="">— Select —</option>
                      {BUILDING_USES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div><label style={s.lbl}>Supplier Ref #</label><input style={s.inp} value={form.supplier_ref} onChange={e => formSet('supplier_ref', e.target.value)} disabled={!canEdit} /></div>
                </div>
              </div>
            )}

            {order.division === 'commercial_roofing' && (
              <div style={s.card}>
                <p style={s.sec}>Roofing Specs</p>
                <div style={s.g3}>
                  <div>
                    <label style={s.lbl}>Roof Type</label>
                    <select style={s.sel} value={form.roof_type} onChange={e => formSet('roof_type', e.target.value)} disabled={!canEdit}>
                      <option value="">— Select —</option>
                      {ROOF_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div><label style={s.lbl}>Roof Size (sq ft)</label><input type="number" style={s.inp} value={form.roof_size_sqft} onChange={e => formSet('roof_size_sqft', e.target.value)} disabled={!canEdit} /></div>
                  <div><label style={s.lbl}>Building Type</label><input style={s.inp} value={form.building_type} onChange={e => formSet('building_type', e.target.value)} disabled={!canEdit} /></div>
                </div>
              </div>
            )}

            {/* Scope of work */}
            <div style={s.card}>
              <p style={s.sec}>Scope of Work</p>
              <div style={s.fRow}><label style={s.lbl}>Scope Description</label><textarea style={s.ta} rows={4} value={form.scope_description} onChange={e => formSet('scope_description', e.target.value)} disabled={!canEdit} /></div>
              <div style={s.fRow}><label style={s.lbl}>Exclusions</label><textarea style={s.ta} rows={2} value={form.exclusions} onChange={e => formSet('exclusions', e.target.value)} disabled={!canEdit} /></div>
            </div>

            {/* Products / line items */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
                <p style={{ ...s.sec, margin: 0 }}>Products / Line Items</p>
                {canEdit && <button style={s.btnSm('green')} onClick={addProduct}>+ Add</button>}
              </div>
              {products.length === 0 && <p style={s.empty}>No products added yet.</p>}
              {products.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 70px 100px 36px', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  <input style={s.inp} placeholder="Product / description" value={p.name} onChange={e => updateProduct(i, 'name', e.target.value)} disabled={!canEdit} />
                  <input type="number" style={s.inp} placeholder="Qty" value={p.qty} onChange={e => updateProduct(i, 'qty', e.target.value)} disabled={!canEdit} />
                  <input style={s.inp} placeholder="Unit" value={p.unit} onChange={e => updateProduct(i, 'unit', e.target.value)} disabled={!canEdit} />
                  <input type="number" style={s.inp} placeholder="Unit price" value={p.unit_price} onChange={e => updateProduct(i, 'unit_price', e.target.value)} disabled={!canEdit} />
                  {canEdit ? <button style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '18px', padding: 0, textAlign: 'center' }} onClick={() => removeProduct(i)}>×</button> : <div />}
                </div>
              ))}
              {products.length > 0 && (
                <div style={{ textAlign: 'right', fontSize: '13px', color: '#374151', marginTop: '8px', fontWeight: '600' }}>
                  Total: {fmt$(products.reduce((a, p) => a + (Number(p.qty || 0) * Number(p.unit_price || 0)), 0))}
                </div>
              )}
            </div>

            {/* Financials (restricted) */}
            {showFinancials && (
              <div style={{ ...s.card, borderColor: '#bae6fd', background: '#f0f9ff' }}>
                <p style={{ ...s.sec, color: '#0369a1' }}>Financials (Internal)</p>
                <div style={s.g2}>
                  <div><label style={s.lbl}>Quoted Amount</label><input type="number" style={s.inp} value={form.quoted_amount} onChange={e => formSet('quoted_amount', e.target.value)} /></div>
                  <div><label style={s.lbl}>Contract Value</label><input type="number" style={s.inp} value={form.contract_value} onChange={e => formSet('contract_value', e.target.value)} /></div>
                  <div><label style={s.lbl}>Internal Cost</label><input type="number" style={s.inp} value={form.internal_cost} onChange={e => formSet('internal_cost', e.target.value)} /></div>
                  <div><label style={s.lbl}>Est. Gross Profit</label><input type="number" style={s.inp} value={form.estimated_profit} onChange={e => formSet('estimated_profit', e.target.value)} /></div>
                  <div><label style={s.lbl}>Deposit Amount</label><input type="number" style={s.inp} value={form.deposit_amount} onChange={e => formSet('deposit_amount', e.target.value)} /></div>
                  <div>
                    <label style={s.lbl}>Deposit Received</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
                      <input type="checkbox" checked={!!form.deposit_received} onChange={e => formSet('deposit_received', e.target.checked)} />
                      <span style={{ fontSize: '13px' }}>Received</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Assignments + notes */}
            <div style={s.card}>
              <p style={s.sec}>Assignments & Notes</p>
              <div style={s.g2}>
                <div><label style={s.lbl}>Salesperson</label><input style={s.inp} value={form.salesperson_name} onChange={e => formSet('salesperson_name', e.target.value)} disabled={!canEdit} /></div>
                <div><label style={s.lbl}>Ops Owner</label><input style={s.inp} value={form.ops_owner_name} onChange={e => formSet('ops_owner_name', e.target.value)} disabled={!canEdit} /></div>
              </div>
              {canEdit && <div style={s.fRow}><label style={s.lbl}>Internal Notes</label><textarea style={s.ta} rows={3} value={form.internal_notes} onChange={e => formSet('internal_notes', e.target.value)} /></div>}
            </div>

            {canEdit && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button style={{ ...s.btn, opacity: dirty ? 1 : 0.55 }} onClick={save} disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>}
          </>
        )}

        {/* ══ DOCUMENTS ════════════════════════════════════════════════════ */}
        {tab === 'documents' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div />
              {canEdit && <button style={s.btn} onClick={() => { setUploadFile(null); setUploadMeta({ category: 'general', visible_to_customer: false }); setModalErr(''); setShowUploadModal(true) }}>+ Upload Document</button>}
            </div>

            {docs.length === 0 && <p style={s.empty}>No documents attached yet.</p>}

            {DOC_CATEGORIES.filter(cat => docs.some(d => d.category === cat)).map(cat => (
              <div key={cat} style={s.card}>
                <p style={s.sec}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</p>
                {docs.filter(d => d.category === cat).map(doc => (
                  <div key={doc.id} style={s.row}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '500', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>{fmtDate(doc.created_at)} · {doc.uploaded_by_name || 'Staff'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                      {doc.visible_to_customer
                        ? <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: '600', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '2px 6px', borderRadius: '4px' }}>Customer visible</span>
                        : <span style={{ fontSize: '10px', color: '#9ca3af' }}>Internal</span>}
                      {canEdit && <button style={s.btnSm(doc.visible_to_customer ? 'default' : 'green')} onClick={() => toggleDocVisibility(doc)}>{doc.visible_to_customer ? 'Hide from customer' : 'Share with customer'}</button>}
                      <button style={s.btnSm()} onClick={() => downloadDoc(doc)}>Download ↗</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {/* Signature requests */}
            {sigRequests.length > 0 && (
              <div style={s.card}>
                <p style={s.sec}>Signature Requests</p>
                {sigRequests.map(sr => (
                  <div key={sr.id} style={s.row}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '500' }}>{sr.signer_name || sr.signer_email}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>Requested {fmtDate(sr.created_at)}{sr.signed_at ? ` · Signed ${fmtDate(sr.signed_at)}` : ''}</div>
                    </div>
                    <span style={s.statusPill(sr.status === 'signed' ? 'done' : sr.status === 'awaiting' ? 'in_progress' : 'open')}>
                      {sr.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {isAdmin && (
              <div style={{ ...s.card, borderColor: '#e9d5ff', background: '#fdf4ff' }}>
                <p style={{ ...s.sec, color: '#7e22ce' }}>E-Signature</p>
                <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 10px' }}>
                  To enable electronic signatures, configure <code>ESIGN_PROVIDER_API_KEY</code> (Dropbox Sign / HelloSign) in your environment variables. Signature requests are tracked in <code>sales_signature_requests</code>.
                </p>
              </div>
            )}
          </>
        )}

        {/* ══ SCHEDULE ═════════════════════════════════════════════════════ */}
        {tab === 'schedule' && (
          <>
            <div style={s.card}>
              <p style={s.sec}>Delivery</p>
              <div style={s.g2}>
                <div><label style={s.lbl}>Expected Delivery Date</label><input type="date" style={s.inp} value={form.expected_delivery_date} onChange={e => formSet('expected_delivery_date', e.target.value)} disabled={!canEdit} /></div>
                <div><label style={s.lbl}>Confirmed Delivery Date</label><input type="date" style={s.inp} value={form.confirmed_delivery_date} onChange={e => formSet('confirmed_delivery_date', e.target.value)} disabled={!canEdit} /></div>
              </div>
              <div style={s.fRow}><label style={s.lbl}>Delivery Notes</label><textarea style={s.ta} rows={2} value={form.delivery_notes} onChange={e => formSet('delivery_notes', e.target.value)} disabled={!canEdit} /></div>
            </div>

            <div style={s.card}>
              <p style={s.sec}>Installation</p>
              <div style={s.g2}>
                <div><label style={s.lbl}>Expected Install Date</label><input type="date" style={s.inp} value={form.expected_install_date} onChange={e => formSet('expected_install_date', e.target.value)} disabled={!canEdit} /></div>
                <div><label style={s.lbl}>Confirmed Install Date</label><input type="date" style={s.inp} value={form.confirmed_install_date} onChange={e => formSet('confirmed_install_date', e.target.value)} disabled={!canEdit} /></div>
              </div>
              <div style={s.g2}>
                <div><label style={s.lbl}>Install Crew</label><input style={s.inp} value={form.install_crew} onChange={e => formSet('install_crew', e.target.value)} disabled={!canEdit} /></div>
              </div>
              <div style={s.fRow}><label style={s.lbl}>Install Notes</label><textarea style={s.ta} rows={2} value={form.install_notes} onChange={e => formSet('install_notes', e.target.value)} disabled={!canEdit} /></div>
            </div>

            <div style={s.card}>
              <p style={s.sec}>Supplier Order</p>
              <div style={s.g2}>
                <div><label style={s.lbl}>Supplier Ref #</label><input style={s.inp} value={form.supplier_ref} onChange={e => formSet('supplier_ref', e.target.value)} disabled={!canEdit} /></div>
                <div><label style={s.lbl}>Confirmation #</label><input style={s.inp} value={form.supplier_order_confirmation} onChange={e => formSet('supplier_order_confirmation', e.target.value)} disabled={!canEdit} /></div>
              </div>
            </div>

            {canEdit && <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={{ ...s.btn, opacity: dirty ? 1 : 0.55 }} onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>}
          </>
        )}

        {/* ══ TASKS ════════════════════════════════════════════════════════ */}
        {tab === 'tasks' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>{tasks.filter(t => t.status !== 'done').length} open task{tasks.filter(t => t.status !== 'done').length !== 1 ? 's' : ''}</div>
              {canEdit && <button style={s.btn} onClick={() => { setModalErr(''); setShowTaskModal(true) }}>+ Add Task</button>}
            </div>

            {tasks.length === 0 && <p style={s.empty}>No tasks yet.</p>}

            <div style={s.card}>
              {tasks.map(t => (
                <div key={t.id} style={s.taskRow(t)}>
                  <div style={s.priorityDot(t.priority)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: '500', color: '#111827', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</div>
                    <div style={{ fontSize: '11px', color: t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' ? '#dc2626' : '#9ca3af' }}>
                      {t.assignee_name ? t.assignee_name + ' · ' : ''}{t.due_date ? 'Due ' + fmtDate(t.due_date) : 'No due date'}
                    </div>
                  </div>
                  <span style={s.statusPill(t.status)}>{t.status.replace('_', ' ')}</span>
                  {canEdit && (
                    <button style={s.btnSm(t.status === 'done' ? 'default' : 'green')} onClick={() => toggleTask(t)}>
                      {t.status === 'done' ? 'Reopen' : 'Done ✓'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ══ UPDATES ══════════════════════════════════════════════════════ */}
        {tab === 'updates' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div />
              {canEdit && <button style={s.btn} onClick={() => { setModalErr(''); setUpdateForm({ body: '', visible_to_customer: false }); setShowUpdateModal(true) }}>+ Add Update</button>}
            </div>

            {updates.length === 0 && <p style={s.empty}>No updates yet.</p>}
            {updates.map(u => (
              <div key={u.id} style={s.updateCard(u.visible_to_customer)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>{u.author_name}</span>
                    {u.visible_to_customer
                      ? <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: '600', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '2px 6px', borderRadius: '4px' }}>Customer visible</span>
                      : <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: '500', background: '#f3f4f6', border: '1px solid #e5e7eb', padding: '2px 6px', borderRadius: '4px' }}>Internal</span>}
                  </div>
                  <span style={{ fontSize: '11px', color: '#9ca3af', flexShrink: 0 }}>{fmtDT(u.created_at)}</span>
                </div>
                <div style={{ fontSize: '13px', color: '#374151', lineHeight: '1.5' }}>{u.body}</div>
              </div>
            ))}
          </>
        )}

        {/* ══ CUSTOMER PORTAL ══════════════════════════════════════════════ */}
        {tab === 'portal' && (
          <>
            <div style={{ ...s.card, marginBottom: '1rem' }}>
              <p style={s.sec}>About the Customer Portal</p>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 12px' }}>
                Customers receive a unique link to view their order, shared documents, and updates. They can also send questions. Internal costs, profit, and private notes are never exposed.
              </p>
              {canEdit && <button style={s.btn} onClick={() => { setModalErr(''); setModalOk(''); setInviteForm({ email: '', name: '' }); setShowPortalModal(true) }}>Invite Customer →</button>}
            </div>

            {portalAccess.length === 0 ? <p style={s.empty}>No customer portal invitations yet.</p> : (
              <div style={s.card}>
                <p style={s.sec}>Active Invitations</p>
                {portalAccess.map(a => (
                  <div key={a.id} style={s.row}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '500' }}>{a.name || a.email}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                        {a.email} · Invited {fmtDate(a.invited_at)}{a.last_accessed_at ? ` · Last seen ${fmtDate(a.last_accessed_at)}` : ' · Not yet accessed'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {a.revoked_at
                        ? <span style={{ fontSize: '12px', color: '#dc2626' }}>Revoked</span>
                        : <span style={{ fontSize: '12px', color: '#16a34a' }}>Active</span>}
                      {!a.revoked_at && canEdit && <button style={s.btnSm('red')} onClick={() => revokeAccess(a.id)}>Revoke</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══ HISTORY ══════════════════════════════════════════════════════ */}
        {tab === 'history' && (
          <div style={s.card}>
            <p style={s.sec}>Activity History</p>
            {history.length === 0 && <p style={s.empty}>No history yet.</p>}
            {history.map(h => (
              <div key={h.id} style={s.histEntry}>
                <span style={{ color: '#9ca3af', flexShrink: 0, minWidth: '130px' }}>{fmtDT(h.created_at)}</span>
                <span style={{ flexShrink: 0, minWidth: '100px', fontWeight: '500' }}>{h.actor_name || 'System'}</span>
                <span style={{ color: '#6b7280' }}>
                  {h.action === 'stage_change' ? `Stage: ${h.details?.from} → ${h.details?.to}` :
                   h.action === 'created' ? `Order created (${h.details?.order_number || ''})` :
                   h.action === 'doc_upload' ? `Document uploaded: ${h.details?.file_name || ''}` :
                   h.action === 'task_completed' ? `Task completed: ${h.details?.title || ''}` :
                   h.action === 'task_created' ? `Task created: ${h.details?.title || ''}` :
                   h.action === 'customer_invited' ? `Customer invited: ${h.details?.email || ''}` :
                   h.action === 'customer_access_revoked' ? `Portal access revoked: ${h.details?.email || ''}` :
                   h.action === 'customer_update_posted' ? 'Customer update posted' :
                   h.action === 'internal_note_posted' ? 'Internal note posted' :
                   h.action === 'updated' ? `Fields updated: ${(h.details?.fields || []).join(', ')}` :
                   h.action}
                </span>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* ══ MODALS ═══════════════════════════════════════════════════════════ */}

      {/* Stage change confirmation */}
      {showStage && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setShowStage(false)}>
          <div style={s.modal}>
            <h2 style={s.mTitle}>Advance Stage</h2>
            <p style={{ fontSize: '14px', color: '#374151', marginBottom: '1.25rem' }}>
              Change stage from <strong>{stageCfg(order.stage).label}</strong> to <strong>{stageCfg(newStage).label}</strong>?
            </p>
            {newStage === 'contract_signed' && (
              <div style={{ background: '#eff6ff', border: '1px solid #bae6fd', borderRadius: '6px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: '#0369a1' }}>
                This will set contract signed and won dates to today.
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={s.btnGray} onClick={() => setShowStage(false)}>Cancel</button>
              <button style={{ ...s.btn, opacity: stageSaving ? 0.6 : 1 }} onClick={() => setStage(newStage)} disabled={stageSaving}>
                {stageSaving ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add task */}
      {showTaskModal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setShowTaskModal(false)}>
          <div style={s.modal}>
            <h2 style={s.mTitle}>Add Task</h2>
            <div style={s.fRow}><label style={s.lbl}>Title</label><input style={s.inp} value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Confirm site readiness" /></div>
            <div style={s.g2}>
              <div><label style={s.lbl}>Assignee</label><input style={s.inp} value={taskForm.assignee_name} onChange={e => setTaskForm(f => ({ ...f, assignee_name: e.target.value }))} placeholder="Name" /></div>
              <div><label style={s.lbl}>Due Date</label><input type="date" style={s.inp} value={taskForm.due_date} onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} /></div>
            </div>
            <div style={s.fRow}>
              <label style={s.lbl}>Priority</label>
              <select style={s.sel} value={taskForm.priority} onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
            {modalErr && <p style={s.err}>{modalErr}</p>}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={s.btnGray} onClick={() => setShowTaskModal(false)}>Cancel</button>
              <button style={s.btn} onClick={createTask}>Add Task</button>
            </div>
          </div>
        </div>
      )}

      {/* Add update */}
      {showUpdateModal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setShowUpdateModal(false)}>
          <div style={s.modal}>
            <h2 style={s.mTitle}>Add Update</h2>
            <div style={s.fRow}><label style={s.lbl}>Message</label><textarea style={s.ta} rows={4} value={updateForm.body} onChange={e => setUpdateForm(f => ({ ...f, body: e.target.value }))} placeholder="What happened or needs to happen…" /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
              <input type="checkbox" id="vis" checked={updateForm.visible_to_customer} onChange={e => setUpdateForm(f => ({ ...f, visible_to_customer: e.target.checked }))} />
              <label htmlFor="vis" style={{ fontSize: '13px', cursor: 'pointer' }}>Share with customer (visible in portal)</label>
            </div>
            {modalErr && <p style={s.err}>{modalErr}</p>}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={s.btnGray} onClick={() => setShowUpdateModal(false)}>Cancel</button>
              <button style={s.btn} onClick={postUpdate}>Post Update</button>
            </div>
          </div>
        </div>
      )}

      {/* Invite customer */}
      {showPortalModal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setShowPortalModal(false)}>
          <div style={s.modal}>
            <h2 style={s.mTitle}>Invite Customer to Portal</h2>
            <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '1rem' }}>They'll receive an email with a secure link to view their order, shared documents, and updates.</p>
            <div style={s.g2}>
              <div><label style={s.lbl}>Email</label><input type="email" style={s.inp} value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="customer@email.com" /></div>
              <div><label style={s.lbl}>Name (optional)</label><input style={s.inp} value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="John Smith" /></div>
            </div>
            {modalErr && <p style={s.err}>{modalErr}</p>}
            {modalOk  && <p style={s.ok}>{modalOk}</p>}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={s.btnGray} onClick={() => setShowPortalModal(false)}>Close</button>
              <button style={s.btn} onClick={inviteCustomer}>Send Invitation</button>
            </div>
          </div>
        </div>
      )}

      {/* Upload document */}
      {showUploadModal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setShowUploadModal(false)}>
          <div style={s.modal}>
            <h2 style={s.mTitle}>Upload Document</h2>
            <div style={s.fRow}>
              <label style={s.lbl}>File</label>
              <input type="file" ref={fileInputRef} onChange={e => setUploadFile(e.target.files[0])} style={{ fontSize: '13px' }} />
            </div>
            <div style={s.fRow}>
              <label style={s.lbl}>Category</label>
              <select style={s.sel} value={uploadMeta.category} onChange={e => setUploadMeta(m => ({ ...m, category: e.target.value }))}>
                {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
              <input type="checkbox" id="vis2" checked={uploadMeta.visible_to_customer} onChange={e => setUploadMeta(m => ({ ...m, visible_to_customer: e.target.checked }))} />
              <label htmlFor="vis2" style={{ fontSize: '13px', cursor: 'pointer' }}>Share with customer immediately</label>
            </div>
            {modalErr && <p style={s.err}>{modalErr}</p>}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={s.btnGray} onClick={() => setShowUploadModal(false)}>Cancel</button>
              <button style={{ ...s.btn, opacity: uploading ? 0.6 : 1 }} onClick={uploadDoc} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
