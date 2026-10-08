'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const STAGES = [
  { key: 'lead',          label: 'Lead',          color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe' },
  { key: 'estimate_sent', label: 'Estimate Sent',  color: '#c2410c', bg: '#fff7ed', border: '#fdba74' },
  { key: 'follow_up',     label: 'Follow-Up',      color: '#854d0e', bg: '#fefce8', border: '#fef08a' },
  { key: 'won',           label: 'Won',            color: '#15803d', bg: '#dcfce7', border: '#bbf7d0' },
  { key: 'lost',          label: 'Lost',           color: '#dc2626', bg: '#fee2e2', border: '#fecaca' },
]

const BUILDING_USES = ['Storage', 'Workshop', 'Agriculture', 'Commercial', 'Industrial', 'Retail', 'Auto Shop', 'Church', 'Other']

const fmt$ = v => v != null && v !== '' ? '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'
const fmtDim = (w, l, h) => {
  if (!w && !l && !h) return '—'
  const parts = []
  if (w) parts.push(w + 'W')
  if (l) parts.push(l + 'L')
  if (h) parts.push(h + 'H')
  return parts.join(' × ') + ' ft'
}

const IS_ADMIN = (role) => ['pm', 'apm', 'super', 'admin'].includes(role)

const s = {
  page: { minHeight: '100vh', background: '#f4f6f8', display: 'flex', fontFamily: "system-ui, -apple-system, sans-serif" },

  // Sidebar — matches dashboard sidebar
  sidebar: { width: '224px', flexShrink: 0, background: '#1a2332', borderRight: '1px solid rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' },
  sidebarTop: { padding: '1.25rem 1rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  sidebarLogo: { width: '28px', height: '28px', objectFit: 'contain', display: 'block', marginBottom: '8px', filter: 'brightness(0) invert(1)' },
  sidebarBrand: { margin: '0 0 1px', fontWeight: '700', fontSize: '13px', color: '#fff', letterSpacing: '0.5px' },
  sidebarDiv: { margin: '2px 0 0', fontSize: '10px', color: '#64748b', letterSpacing: '1.5px', textTransform: 'uppercase' },
  sidebarUser: { margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' },
  sidebarNav: { flex: 1, padding: '0.5rem 0', overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  navLink: (active) => ({
    display: 'flex', alignItems: 'center', gap: '9px',
    padding: active ? '9px 1rem 9px calc(1rem - 3px)' : '9px 1rem',
    cursor: 'pointer',
    background: active ? 'rgba(232,89,12,0.14)' : 'transparent',
    color: active ? '#e8590c' : 'rgba(255,255,255,0.72)',
    fontSize: '13px', fontWeight: active ? '600' : '400',
    border: 'none', borderLeft: active ? '3px solid #e8590c' : '3px solid transparent',
    width: '100%', textAlign: 'left', outline: 'none', textDecoration: 'none',
  }),
  navDivider: { fontSize: '10px', color: '#334155', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '12px 1rem 4px', fontWeight: '600' },
  sidebarBottom: { padding: '0.875rem 1rem', borderTop: '1px solid rgba(255,255,255,0.06)' },
  signOut: { width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#64748b', cursor: 'pointer', fontSize: '12px', fontWeight: '500', textAlign: 'left' },

  // Main content
  main: { flex: 1, minWidth: 0, padding: '2rem', overflowX: 'hidden' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' },
  pageTitle: { margin: 0, fontSize: '22px', fontWeight: '700', color: '#111827' },

  // Stats
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '1.75rem' },
  statCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '1rem 1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
  statVal: { fontSize: '22px', fontWeight: '700', color: '#111827', marginBottom: '2px' },
  statLbl: { fontSize: '11px', color: '#6b7280', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: '600' },

  // Stage filter tabs
  stageRow: { display: 'flex', gap: '8px', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '2px' },
  stageTab: (active, color) => ({
    padding: '6px 16px', borderRadius: '99px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
    background: active ? color : '#fff',
    color: active ? '#fff' : '#6b7280',
    border: active ? `1px solid ${color}` : '1px solid #e5e7eb',
    letterSpacing: '0.3px', whiteSpace: 'nowrap', flexShrink: 0,
  }),

  // Card grid
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', transition: 'box-shadow 0.15s, border-color 0.15s' },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px', gap: '8px' },
  company: { margin: 0, fontSize: '15px', fontWeight: '700', color: '#111827', lineHeight: 1.3 },
  contactLine: { fontSize: '12px', color: '#6b7280', marginTop: '2px' },
  badge: (stg) => {
    const st = STAGES.find(s => s.key === stg) || STAGES[0]
    return { padding: '3px 10px', borderRadius: '99px', fontSize: '10px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', background: st.bg, color: st.color, border: `1px solid ${st.border}`, flexShrink: 0 }
  },
  depositBadge: (received) => ({
    display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '99px',
    fontSize: '10px', fontWeight: '700', letterSpacing: '0.5px',
    background: received ? '#dcfce7' : '#fff7ed',
    color: received ? '#15803d' : '#c2410c',
    border: `1px solid ${received ? '#bbf7d0' : '#fdba74'}`,
  }),
  cardFields: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginTop: '12px' },
  fieldLbl: { fontSize: '10px', color: '#9ca3af', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '600', marginBottom: '1px' },
  fieldVal: { fontSize: '13px', color: '#374151' },
  cardActions: { display: 'flex', gap: '8px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' },
  btnEdit: { flex: 1, padding: '7px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '7px', color: '#374151', cursor: 'pointer', fontSize: '12px', fontWeight: '600' },
  btnDel: { padding: '7px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '7px', color: '#dc2626', cursor: 'pointer', fontSize: '12px', fontWeight: '600' },
  btnAdd: { padding: '9px 20px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnSecondary: { padding: '9px 18px', background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  empty: { gridColumn: '1/-1', background: '#fff', border: '1px dashed #d1d5db', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: '#9ca3af', fontSize: '14px' },

  // Modal
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2rem 1rem', overflowY: 'auto' },
  modal: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', width: '100%', maxWidth: '580px', padding: '1.75rem', marginTop: 'auto', marginBottom: 'auto', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' },
  modalTitle: { margin: '0 0 1.5rem', fontSize: '18px', fontWeight: '700', color: '#111827' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' },
  formGrid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' },
  formFull: { marginBottom: '14px' },
  label: { display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '5px' },
  input: { width: '100%', padding: '9px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none' },
  select: { width: '100%', padding: '9px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none' },
  textarea: { width: '100%', padding: '9px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none', minHeight: '80px', resize: 'vertical' },
  checkRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' },
  checkLbl: { fontSize: '13px', color: '#374151', cursor: 'pointer' },
  modalActions: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' },
  btnCancel: { padding: '9px 20px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', color: '#374151', cursor: 'pointer', fontSize: '13px' },
  btnSave: { padding: '9px 20px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  sectionHdr: { fontSize: '11px', color: '#6b7280', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: '600', margin: '1.25rem 0 0.75rem', borderTop: '1px solid #f0f0f0', paddingTop: '1.25rem' },
  supplierRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#f9fafb', borderRadius: '8px', marginBottom: '6px', border: '1px solid #e5e7eb' },
  supplierName: { flex: 1, fontSize: '13px', color: '#374151' },
  btnDelSm: { padding: '4px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '5px', color: '#dc2626', cursor: 'pointer', fontSize: '11px', fontWeight: '600' },
}

export default function MetalBuildingsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [leads, setLeads] = useState([])
  const [reps, setReps] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [stage, setStage] = useState('all')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [supplierModal, setSupplierModal] = useState(false)
  const [newSupplier, setNewSupplier] = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    if (!prof) { router.push('/login'); return }
    if (!['pm', 'apm', 'super', 'admin', 'metal_rep'].includes(prof.role)) { router.push('/login'); return }
    setProfile(prof)
    await Promise.all([loadLeads(), loadSuppliers(), IS_ADMIN(prof.role) ? loadReps() : Promise.resolve()])
    setLoading(false)
  }

  async function loadLeads() {
    const { data } = await supabase
      .from('metal_building_leads')
      .select('*, rep:profiles!assigned_to(id, full_name), supplier:mb_suppliers(id, name)')
      .order('created_at', { ascending: false })
    setLeads(data || [])
  }

  async function loadReps() {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'metal_rep').order('full_name')
    setReps(data || [])
  }

  async function loadSuppliers() {
    const { data } = await supabase.from('mb_suppliers').select('*').order('name')
    setSuppliers(data || [])
  }

  function openAdd() {
    const base = { stage: 'lead', deposit_received: false }
    if (profile && !IS_ADMIN(profile.role)) base.assigned_to = profile.id
    setForm(base)
    setModal('add')
  }

  function openEdit(lead) {
    setForm({
      ...lead,
      assigned_to: lead.assigned_to || '',
      supplier_id: lead.supplier_id || '',
    })
    setModal(lead)
  }

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    setSaving(true)
    const payload = {
      company_name:     form.company_name     || null,
      contact_name:     form.contact_name     || null,
      contact_phone:    form.contact_phone    || null,
      contact_email:    form.contact_email    || null,
      address:          form.address          || null,
      stage:            form.stage            || 'lead',
      estimate_value:   form.estimate_value   ? Number(form.estimate_value)  : null,
      deposit_amount:   form.deposit_amount   ? Number(form.deposit_amount)  : null,
      deposit_received: !!form.deposit_received,
      notes:            form.notes            || null,
      width_ft:         form.width_ft         ? Number(form.width_ft)        : null,
      length_ft:        form.length_ft        ? Number(form.length_ft)       : null,
      height_ft:        form.height_ft        ? Number(form.height_ft)       : null,
      building_use:     form.building_use     || null,
      supplier_id:      form.supplier_id      || null,
      assigned_to:      form.assigned_to      || null,
      lost_reason:      form.stage === 'lost' ? (form.lost_reason || null)   : null,
      won_date:         form.stage === 'won'  ? (form.won_date    || null)   : null,
    }
    if (modal === 'add') {
      await supabase.from('metal_building_leads').insert(payload)
    } else {
      await supabase.from('metal_building_leads').update(payload).eq('id', modal.id)
    }
    setSaving(false)
    setModal(null)
    loadLeads()
  }

  async function deleteLead(id) {
    if (!confirm('Delete this lead? This cannot be undone.')) return
    await supabase.from('metal_building_leads').delete().eq('id', id)
    loadLeads()
  }

  async function addSupplier() {
    if (!newSupplier.trim()) return
    await supabase.from('mb_suppliers').insert({ name: newSupplier.trim() })
    setNewSupplier('')
    loadSuppliers()
  }

  async function deleteSupplier(id) {
    if (!confirm('Remove this supplier?')) return
    await supabase.from('mb_suppliers').delete().eq('id', id)
    loadSuppliers()
  }

  const filtered = stage === 'all' ? leads : leads.filter(l => l.stage === stage)
  const pipelineLeads = leads.filter(l => !['won', 'lost'].includes(l.stage))
  const wonLeads = leads.filter(l => l.stage === 'won')
  const depositsIn = leads.filter(l => l.deposit_received).reduce((a, l) => a + Number(l.deposit_amount || 0), 0)
  const pipelineValue = pipelineLeads.reduce((a, l) => a + Number(l.estimate_value || 0), 0)
  const wonValue = wonLeads.reduce((a, l) => a + Number(l.estimate_value || 0), 0)
  const isAdmin = profile ? IS_ADMIN(profile.role) : false

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#6b7280', fontSize: '14px' }}>Loading…</div>
    </div>
  )

  return (
    <div style={s.page}>
      {/* ── SIDEBAR ── */}
      <nav style={s.sidebar}>
        <div style={s.sidebarTop}>
          <img src="/logo.png" alt="NV" style={s.sidebarLogo} />
          <p style={s.sidebarBrand}>NV Construction</p>
          <p style={s.sidebarDiv}>Metal Buildings</p>
          <p style={s.sidebarUser}>{profile?.full_name}</p>
        </div>
        <div style={s.sidebarNav}>
          {isAdmin && (
            <>
              <div style={s.navDivider}>Navigate</div>
              <a href="/dashboard" style={s.navLink(false)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                Dashboard
              </a>
              <div style={s.navDivider}>Divisions</div>
              <a href="/roofing" style={s.navLink(false)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                Commercial Roofing
              </a>
              <a href="/metal-buildings" style={s.navLink(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                Metal Buildings
              </a>
              <div style={s.navDivider}>Settings</div>
              <button style={{ ...s.navLink(false), border: 'none' }} onClick={() => setSupplierModal(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Manage Suppliers
              </button>
            </>
          )}
          {!isAdmin && (
            <>
              <div style={s.navDivider}>Navigate</div>
              <a href="/metal-buildings" style={s.navLink(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                My Leads
              </a>
            </>
          )}
        </div>
        <div style={s.sidebarBottom}>
          <button style={s.signOut} onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>Sign out</button>
        </div>
      </nav>

      {/* ── MAIN ── */}
      <main style={s.main}>
        <div style={s.topBar}>
          <div>
            <h1 style={s.pageTitle}>Metal Buildings</h1>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#6b7280' }}>Lead pipeline and estimates</p>
          </div>
          <button style={s.btnAdd} onClick={openAdd}>+ Add Lead</button>
        </div>

        {/* Stats */}
        <div style={s.stats}>
          <div style={s.statCard}>
            <div style={s.statVal}>{leads.length}</div>
            <div style={s.statLbl}>Total Leads</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statVal}>{fmt$(pipelineValue)}</div>
            <div style={s.statLbl}>Pipeline Value</div>
          </div>
          <div style={s.statCard}>
            <div style={{ ...s.statVal, color: '#15803d' }}>{fmt$(wonValue)}</div>
            <div style={s.statLbl}>Won Value</div>
          </div>
          <div style={s.statCard}>
            <div style={{ ...s.statVal, color: '#e8590c' }}>{fmt$(depositsIn)}</div>
            <div style={s.statLbl}>Deposits In</div>
          </div>
        </div>

        {/* Stage Tabs */}
        <div style={s.stageRow}>
          <button style={s.stageTab(stage === 'all', '#374151')} onClick={() => setStage('all')}>
            All ({leads.length})
          </button>
          {STAGES.map(st => (
            <button key={st.key} style={s.stageTab(stage === st.key, st.color)} onClick={() => setStage(st.key)}>
              {st.label} ({leads.filter(l => l.stage === st.key).length})
            </button>
          ))}
        </div>

        {/* Cards */}
        <div style={s.grid}>
          {filtered.length === 0 && (
            <div style={s.empty}>No leads in this stage yet.</div>
          )}
          {filtered.map(lead => (
            <div key={lead.id} style={s.card}>
              <div style={s.cardTop}>
                <div style={{ minWidth: 0 }}>
                  <p style={s.company}>{lead.company_name || '(No company)'}</p>
                  <p style={s.contactLine}>{lead.contact_name}{lead.contact_phone ? ' · ' + lead.contact_phone : ''}</p>
                </div>
                <span style={s.badge(lead.stage)}>{STAGES.find(x => x.key === lead.stage)?.label}</span>
              </div>

              <div style={s.cardFields}>
                <div>
                  <div style={s.fieldLbl}>Estimate</div>
                  <div style={s.fieldVal}>{fmt$(lead.estimate_value)}</div>
                </div>
                <div>
                  <div style={s.fieldLbl}>Dimensions</div>
                  <div style={s.fieldVal}>{fmtDim(lead.width_ft, lead.length_ft, lead.height_ft)}</div>
                </div>
                <div>
                  <div style={s.fieldLbl}>Use</div>
                  <div style={s.fieldVal}>{lead.building_use || '—'}</div>
                </div>
                <div>
                  <div style={s.fieldLbl}>Supplier</div>
                  <div style={s.fieldVal}>{lead.supplier?.name || '—'}</div>
                </div>
                {(lead.deposit_amount > 0 || lead.deposit_received) && (
                  <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={s.fieldLbl}>Deposit</div>
                      <div style={s.fieldVal}>{fmt$(lead.deposit_amount)}</div>
                    </div>
                    <span style={{ ...s.depositBadge(lead.deposit_received), marginTop: '14px' }}>
                      {lead.deposit_received ? '✓ Received' : '⏳ Pending'}
                    </span>
                  </div>
                )}
                {isAdmin && lead.rep && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={s.fieldLbl}>Rep</div>
                    <div style={s.fieldVal}>{lead.rep.full_name}</div>
                  </div>
                )}
                {lead.stage === 'lost' && lead.lost_reason && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={s.fieldLbl}>Lost Reason</div>
                    <div style={{ ...s.fieldVal, color: '#dc2626' }}>{lead.lost_reason}</div>
                  </div>
                )}
              </div>

              <div style={s.cardActions}>
                <button style={s.btnEdit} onClick={() => openEdit(lead)}>Edit</button>
                {isAdmin && <button style={s.btnDel} onClick={() => deleteLead(lead.id)}>Delete</button>}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* ── LEAD MODAL ── */}
      {modal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div style={s.modal}>
            <h2 style={s.modalTitle}>{modal === 'add' ? 'Add Lead' : 'Edit Lead'}</h2>

            <div style={s.formGrid}>
              <div>
                <label style={s.label}>Company Name</label>
                <input style={s.input} value={form.company_name || ''} onChange={e => setF('company_name', e.target.value)} placeholder="Acme Corp" />
              </div>
              <div>
                <label style={s.label}>Stage</label>
                <select style={s.select} value={form.stage || 'lead'} onChange={e => setF('stage', e.target.value)}>
                  {STAGES.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Contact Name</label>
                <input style={s.input} value={form.contact_name || ''} onChange={e => setF('contact_name', e.target.value)} />
              </div>
              <div>
                <label style={s.label}>Contact Phone</label>
                <input style={s.input} value={form.contact_phone || ''} onChange={e => setF('contact_phone', e.target.value)} type="tel" />
              </div>
              <div>
                <label style={s.label}>Contact Email</label>
                <input style={s.input} value={form.contact_email || ''} onChange={e => setF('contact_email', e.target.value)} type="email" />
              </div>
              <div>
                <label style={s.label}>Estimate Value</label>
                <input style={s.input} value={form.estimate_value || ''} onChange={e => setF('estimate_value', e.target.value)} type="number" placeholder="0" />
              </div>
            </div>

            <div style={s.formFull}>
              <label style={s.label}>Address</label>
              <input style={s.input} value={form.address || ''} onChange={e => setF('address', e.target.value)} placeholder="123 Main St, City, State" />
            </div>

            <div style={s.sectionHdr}>Building Details</div>
            <div style={s.formGrid3}>
              <div>
                <label style={s.label}>Width (ft)</label>
                <input style={s.input} value={form.width_ft || ''} onChange={e => setF('width_ft', e.target.value)} type="number" placeholder="0" />
              </div>
              <div>
                <label style={s.label}>Length (ft)</label>
                <input style={s.input} value={form.length_ft || ''} onChange={e => setF('length_ft', e.target.value)} type="number" placeholder="0" />
              </div>
              <div>
                <label style={s.label}>Height (ft)</label>
                <input style={s.input} value={form.height_ft || ''} onChange={e => setF('height_ft', e.target.value)} type="number" placeholder="0" />
              </div>
            </div>
            <div style={s.formGrid}>
              <div>
                <label style={s.label}>Building Use</label>
                <select style={s.select} value={form.building_use || ''} onChange={e => setF('building_use', e.target.value)}>
                  <option value="">Select…</option>
                  {BUILDING_USES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Supplier</label>
                <select style={s.select} value={form.supplier_id || ''} onChange={e => setF('supplier_id', e.target.value)}>
                  <option value="">Select…</option>
                  {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                </select>
              </div>
            </div>

            <div style={s.sectionHdr}>Deposit</div>
            <div style={s.formGrid}>
              <div>
                <label style={s.label}>Deposit Amount</label>
                <input style={s.input} value={form.deposit_amount || ''} onChange={e => setF('deposit_amount', e.target.value)} type="number" placeholder="0" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <label style={{ ...s.checkRow, marginBottom: 0 }}>
                  <input type="checkbox" checked={!!form.deposit_received} onChange={e => setF('deposit_received', e.target.checked)} />
                  <span style={s.checkLbl}>Deposit received</span>
                </label>
              </div>
            </div>

            {form.stage === 'won' && (
              <div style={s.formFull}>
                <label style={s.label}>Won Date</label>
                <input style={s.input} value={form.won_date || ''} onChange={e => setF('won_date', e.target.value)} type="date" />
              </div>
            )}
            {form.stage === 'lost' && (
              <div style={s.formFull}>
                <label style={s.label}>Lost Reason</label>
                <input style={s.input} value={form.lost_reason || ''} onChange={e => setF('lost_reason', e.target.value)} placeholder="Price, competition, no decision…" />
              </div>
            )}

            {isAdmin && reps.length > 0 && (
              <div style={s.formFull}>
                <label style={s.label}>Assigned Rep</label>
                <select style={s.select} value={form.assigned_to || ''} onChange={e => setF('assigned_to', e.target.value)}>
                  <option value="">Unassigned</option>
                  {reps.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                </select>
              </div>
            )}

            <div style={s.formFull}>
              <label style={s.label}>Notes</label>
              <textarea style={s.textarea} value={form.notes || ''} onChange={e => setF('notes', e.target.value)} placeholder="Additional notes…" />
            </div>

            <div style={s.modalActions}>
              <button style={s.btnCancel} onClick={() => setModal(null)}>Cancel</button>
              <button style={s.btnSave} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Lead'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SUPPLIER MODAL ── */}
      {supplierModal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setSupplierModal(false)}>
          <div style={{ ...s.modal, maxWidth: '420px' }}>
            <h2 style={s.modalTitle}>Manage Suppliers</h2>
            <div style={{ marginBottom: '1.25rem' }}>
              {suppliers.length === 0 && <p style={{ color: '#9ca3af', fontSize: '13px', margin: '0 0 1rem' }}>No suppliers yet.</p>}
              {suppliers.map(sup => (
                <div key={sup.id} style={s.supplierRow}>
                  <span style={s.supplierName}>{sup.name}</span>
                  <button style={s.btnDelSm} onClick={() => deleteSupplier(sup.id)}>Remove</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={{ ...s.input, flex: 1 }}
                value={newSupplier}
                onChange={e => setNewSupplier(e.target.value)}
                placeholder="Supplier name"
                onKeyDown={e => e.key === 'Enter' && addSupplier()}
              />
              <button style={s.btnSave} onClick={addSupplier}>Add</button>
            </div>
            <div style={s.modalActions}>
              <button style={s.btnCancel} onClick={() => setSupplierModal(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
