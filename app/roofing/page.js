'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const STAGES = [
  { key: 'lead',          label: 'Lead',          color: '#6366f1', bg: '#1a1a2e' },
  { key: 'estimate_sent', label: 'Estimate Sent',  color: '#e8590c', bg: '#2a1200' },
  { key: 'follow_up',     label: 'Follow-Up',      color: '#facc15', bg: '#2a2200' },
  { key: 'won',           label: 'Won',            color: '#4ade80', bg: '#0a2a0a' },
  { key: 'lost',          label: 'Lost',           color: '#ff6b6b', bg: '#2a0a0a' },
]

const ROOF_TYPES = ['TPO', 'EPDM', 'Metal', 'Shingle', 'Modified Bitumen', 'Other']
const BUILDING_TYPES = ['Warehouse', 'Office', 'Retail', 'Industrial', 'Restaurant', 'Church', 'School', 'Other']

const fmt$ = v => v != null && v !== '' ? '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'
const fmtSqft = v => v != null && v !== '' ? Number(v).toLocaleString() + ' sq ft' : '—'

const IS_ADMIN = (role) => ['pm', 'apm', 'super', 'admin'].includes(role)

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', display: 'flex', fontFamily: 'system-ui, -apple-system, sans-serif' },
  sidebar: { width: '220px', minHeight: '100vh', background: '#111', borderRight: '1px solid #1e1e1e', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0 },
  sidebarTop: { padding: '1.5rem 1.25rem 1rem', borderBottom: '1px solid #1e1e1e' },
  sidebarLogo: { width: '36px', height: '36px', objectFit: 'contain', marginBottom: '8px' },
  sidebarBrand: { margin: 0, fontWeight: '800', fontSize: '14px', color: '#f1f1f1', letterSpacing: '0.5px' },
  sidebarDiv: { margin: '2px 0 0', fontSize: '11px', color: '#e8590c', fontWeight: '700', letterSpacing: '2px', textTransform: 'uppercase' },
  sidebarUser: { margin: '4px 0 0', fontSize: '12px', color: '#555' },
  sidebarNav: { flex: 1, padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '4px' },
  navLink: (active) => ({
    display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 12px', borderRadius: '8px',
    background: active ? '#1e1e1e' : 'transparent', color: active ? '#f1f1f1' : '#666',
    fontSize: '13px', fontWeight: active ? '700' : '400', border: 'none', cursor: 'pointer',
    width: '100%', textAlign: 'left', textDecoration: 'none',
  }),
  navDivider: { fontSize: '10px', color: '#333', letterSpacing: '2px', textTransform: 'uppercase', padding: '12px 12px 4px', fontWeight: '700' },
  sidebarBottom: { padding: '1rem', borderTop: '1px solid #1e1e1e' },
  signOut: { width: '100%', padding: '8px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '7px', color: '#555', cursor: 'pointer', fontSize: '12px' },
  main: { flex: 1, minWidth: 0, padding: '2rem', overflowX: 'hidden' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' },
  pageTitle: { margin: 0, fontSize: '22px', fontWeight: '800', color: '#f1f1f1' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '1.75rem' },
  statCard: { background: '#141414', border: '1px solid #1e1e1e', borderRadius: '10px', padding: '1rem 1.25rem' },
  statVal: { fontSize: '22px', fontWeight: '800', color: '#f1f1f1', marginBottom: '2px' },
  statLbl: { fontSize: '11px', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: '600' },
  stageRow: { display: 'flex', gap: '8px', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '2px' },
  stageTab: (active, color) => ({
    padding: '7px 16px', borderRadius: '99px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: 'none',
    background: active ? color : '#1a1a1a', color: active ? '#fff' : '#666',
    letterSpacing: '0.5px', whiteSpace: 'nowrap', flexShrink: 0,
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px' },
  card: { background: '#141414', border: '1px solid #1e1e1e', borderRadius: '12px', padding: '1.25rem', cursor: 'pointer', transition: 'border-color 0.15s' },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px', gap: '8px' },
  company: { margin: 0, fontSize: '15px', fontWeight: '700', color: '#f1f1f1', lineHeight: 1.3 },
  contactLine: { fontSize: '12px', color: '#666', marginTop: '2px' },
  badge: (stg) => {
    const st = STAGES.find(s => s.key === stg) || STAGES[0]
    return { padding: '3px 10px', borderRadius: '99px', fontSize: '10px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', background: st.bg, color: st.color, border: `1px solid ${st.color}33`, flexShrink: 0 }
  },
  cardFields: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginTop: '12px' },
  fieldLbl: { fontSize: '10px', color: '#444', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '600', marginBottom: '1px' },
  fieldVal: { fontSize: '13px', color: '#ccc' },
  cardActions: { display: 'flex', gap: '8px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #1e1e1e' },
  btnEdit: { flex: 1, padding: '7px', background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: '7px', color: '#aaa', cursor: 'pointer', fontSize: '12px', fontWeight: '600' },
  btnDel: { padding: '7px 12px', background: '#1a0808', border: '1px solid #3a1010', borderRadius: '7px', color: '#ff6b6b', cursor: 'pointer', fontSize: '12px', fontWeight: '600' },
  btnAdd: { padding: '10px 22px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '9px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', letterSpacing: '0.5px' },
  empty: { gridColumn: '1/-1', background: '#141414', border: '1px dashed #2a2a2a', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: '#444', fontSize: '14px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2rem 1rem', overflowY: 'auto' },
  modal: { background: '#141414', border: '1px solid #2a2a2a', borderRadius: '14px', width: '100%', maxWidth: '580px', padding: '1.75rem', marginTop: 'auto', marginBottom: 'auto' },
  modalTitle: { margin: '0 0 1.5rem', fontSize: '18px', fontWeight: '800', color: '#f1f1f1' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' },
  formFull: { marginBottom: '14px' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#555', marginBottom: '5px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '10px 12px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '13px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  select: { width: '100%', padding: '10px 12px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '13px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  textarea: { width: '100%', padding: '10px 12px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '13px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none', minHeight: '80px', resize: 'vertical' },
  checkRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' },
  checkLbl: { fontSize: '13px', color: '#ccc', cursor: 'pointer' },
  modalActions: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #222' },
  btnCancel: { padding: '10px 22px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '9px', color: '#666', cursor: 'pointer', fontSize: '13px' },
  btnSave: { padding: '10px 28px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '9px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' },
  sectionHdr: { fontSize: '11px', color: '#444', letterSpacing: '2px', textTransform: 'uppercase', fontWeight: '700', margin: '1.25rem 0 0.75rem', borderTop: '1px solid #1e1e1e', paddingTop: '1.25rem' },
}

export default function RoofingPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [leads, setLeads] = useState([])
  const [reps, setReps] = useState([])
  const [stage, setStage] = useState('all')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    if (!prof) { router.push('/login'); return }
    if (!['pm', 'apm', 'super', 'admin', 'roofing_rep'].includes(prof.role)) { router.push('/login'); return }
    setProfile(prof)
    await Promise.all([loadLeads(), IS_ADMIN(prof.role) ? loadReps() : Promise.resolve()])
    setLoading(false)
  }

  async function loadLeads() {
    const { data } = await supabase
      .from('roofing_leads')
      .select('*, rep:profiles!assigned_to(id, full_name)')
      .order('created_at', { ascending: false })
    setLeads(data || [])
  }

  async function loadReps() {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'roofing_rep').order('full_name')
    setReps(data || [])
  }

  function openAdd() {
    const base = { stage: 'lead', tear_off_needed: false }
    if (profile && !IS_ADMIN(profile.role)) base.assigned_to = profile.id
    setForm(base)
    setModal('add')
  }

  function openEdit(lead) {
    setForm({ ...lead, assigned_to: lead.assigned_to || '' })
    setModal(lead)
  }

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    setSaving(true)
    const payload = {
      company_name:   form.company_name   || null,
      contact_name:   form.contact_name   || null,
      contact_phone:  form.contact_phone  || null,
      contact_email:  form.contact_email  || null,
      address:        form.address        || null,
      stage:          form.stage          || 'lead',
      estimate_value: form.estimate_value ? Number(form.estimate_value) : null,
      notes:          form.notes          || null,
      roof_type:      form.roof_type      || null,
      roof_size_sqft: form.roof_size_sqft ? Number(form.roof_size_sqft) : null,
      building_type:  form.building_type  || null,
      tear_off_needed: !!form.tear_off_needed,
      tear_off_notes: form.tear_off_needed ? (form.tear_off_notes || null) : null,
      assigned_to:    form.assigned_to    || null,
      lost_reason:    form.stage === 'lost' ? (form.lost_reason || null) : null,
      won_date:       form.stage === 'won'  ? (form.won_date    || null) : null,
    }
    if (modal === 'add') {
      await supabase.from('roofing_leads').insert(payload)
    } else {
      await supabase.from('roofing_leads').update(payload).eq('id', modal.id)
    }
    setSaving(false)
    setModal(null)
    loadLeads()
  }

  async function deleteLead(id) {
    if (!confirm('Delete this lead? This cannot be undone.')) return
    await supabase.from('roofing_leads').delete().eq('id', id)
    loadLeads()
  }

  const filtered = stage === 'all' ? leads : leads.filter(l => l.stage === stage)
  const pipelineLeads = leads.filter(l => !['won', 'lost'].includes(l.stage))
  const wonLeads = leads.filter(l => l.stage === 'won')
  const pipelineValue = pipelineLeads.reduce((a, l) => a + Number(l.estimate_value || 0), 0)
  const wonValue = wonLeads.reduce((a, l) => a + Number(l.estimate_value || 0), 0)
  const winRate = leads.length > 0 ? ((wonLeads.length / leads.length) * 100).toFixed(0) : '0'
  const isAdmin = profile ? IS_ADMIN(profile.role) : false

  if (loading) return (
    <div style={{ ...s.page, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#444', fontSize: '14px' }}>Loading...</div>
    </div>
  )

  return (
    <div style={s.page}>
      {/* ── SIDEBAR ── */}
      <nav style={s.sidebar}>
        <div style={s.sidebarTop}>
          <img src="/logo.png" alt="NV" style={s.sidebarLogo} />
          <p style={s.sidebarBrand}>NV Construction</p>
          <p style={s.sidebarDiv}>Commercial Roofing</p>
          <p style={s.sidebarUser}>{profile?.full_name}</p>
        </div>
        <div style={s.sidebarNav}>
          {isAdmin && (
            <>
              <div style={s.navDivider}>Navigate</div>
              <a href="/dashboard" style={s.navLink(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                Dashboard
              </a>
              <a href="/roofing" style={s.navLink(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                Roofing
              </a>
              <a href="/metal-buildings" style={s.navLink(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                Metal Buildings
              </a>
            </>
          )}
          {!isAdmin && (
            <>
              <div style={s.navDivider}>Navigate</div>
              <a href="/roofing" style={s.navLink(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
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
          <h1 style={s.pageTitle}>Commercial Roofing</h1>
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
            <div style={{ ...s.statVal, color: '#4ade80' }}>{fmt$(wonValue)}</div>
            <div style={s.statLbl}>Won Value</div>
          </div>
          <div style={s.statCard}>
            <div style={{ ...s.statVal, color: '#e8590c' }}>{winRate}%</div>
            <div style={s.statLbl}>Win Rate</div>
          </div>
        </div>

        {/* Stage Tabs */}
        <div style={s.stageRow}>
          <button style={s.stageTab(stage === 'all', '#e8590c')} onClick={() => setStage('all')}>
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
                  <div style={s.fieldLbl}>Roof Type</div>
                  <div style={s.fieldVal}>{lead.roof_type || '—'}</div>
                </div>
                <div>
                  <div style={s.fieldLbl}>Size</div>
                  <div style={s.fieldVal}>{fmtSqft(lead.roof_size_sqft)}</div>
                </div>
                <div>
                  <div style={s.fieldLbl}>Building</div>
                  <div style={s.fieldVal}>{lead.building_type || '—'}</div>
                </div>
                {lead.tear_off_needed && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={s.fieldLbl}>Tear-Off</div>
                    <div style={{ ...s.fieldVal, color: '#facc15' }}>Required{lead.tear_off_notes ? ' — ' + lead.tear_off_notes : ''}</div>
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
                    <div style={{ ...s.fieldVal, color: '#ff6b6b' }}>{lead.lost_reason}</div>
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

      {/* ── MODAL ── */}
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

            <div style={s.sectionHdr}>Roofing Details</div>
            <div style={s.formGrid}>
              <div>
                <label style={s.label}>Roof Type</label>
                <select style={s.select} value={form.roof_type || ''} onChange={e => setF('roof_type', e.target.value)}>
                  <option value="">Select...</option>
                  {ROOF_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Roof Size (sq ft)</label>
                <input style={s.input} value={form.roof_size_sqft || ''} onChange={e => setF('roof_size_sqft', e.target.value)} type="number" placeholder="0" />
              </div>
              <div>
                <label style={s.label}>Building Type</label>
                <select style={s.select} value={form.building_type || ''} onChange={e => setF('building_type', e.target.value)}>
                  <option value="">Select...</option>
                  {BUILDING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <label style={s.checkRow}>
                  <input type="checkbox" checked={!!form.tear_off_needed} onChange={e => setF('tear_off_needed', e.target.checked)} />
                  <span style={s.checkLbl}>Tear-off required</span>
                </label>
              </div>
            </div>
            {form.tear_off_needed && (
              <div style={s.formFull}>
                <label style={s.label}>Tear-Off Notes</label>
                <input style={s.input} value={form.tear_off_notes || ''} onChange={e => setF('tear_off_notes', e.target.value)} placeholder="Condition, layers, etc." />
              </div>
            )}

            {form.stage === 'won' && (
              <div style={s.formFull}>
                <label style={s.label}>Won Date</label>
                <input style={s.input} value={form.won_date || ''} onChange={e => setF('won_date', e.target.value)} type="date" />
              </div>
            )}
            {form.stage === 'lost' && (
              <div style={s.formFull}>
                <label style={s.label}>Lost Reason</label>
                <input style={s.input} value={form.lost_reason || ''} onChange={e => setF('lost_reason', e.target.value)} placeholder="Price, competition, no decision..." />
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
              <textarea style={s.textarea} value={form.notes || ''} onChange={e => setF('notes', e.target.value)} placeholder="Additional notes..." />
            </div>

            <div style={s.modalActions}>
              <button style={s.btnCancel} onClick={() => setModal(null)}>Cancel</button>
              <button style={s.btnSave} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Lead'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
