'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a' },
  header: { background: '#141414', borderBottom: '1px solid #222', padding: '0 1.5rem', position: 'sticky', top: 0, zIndex: 10 },
  headerInner: { maxWidth: '1040px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoImg: { width: '40px', height: '40px', objectFit: 'contain' },
  logoName: { fontWeight: '700', fontSize: '15px', color: '#f1f1f1', letterSpacing: '1px' },
  logoSub: { fontSize: '11px', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' },
  main: { maxWidth: '1040px', margin: '0 auto', padding: '2rem 1.5rem' },
  backBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#888', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', padding: 0, marginBottom: '1.5rem' },
  card: { background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '1.75rem', marginBottom: '1.5rem' },
  cardTitle: { fontSize: '13px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginTop: 0, marginBottom: '1.25rem' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  textarea: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none', resize: 'vertical', minHeight: '100px' },
  btn: { padding: '11px 24px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnGray: { padding: '11px 24px', background: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnRed: { padding: '11px 24px', background: '#2a0a0a', color: '#ff6b6b', border: '1px solid #5a1a1a', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSmall: { padding: '7px 16px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSmallGray: { padding: '7px 16px', background: '#1a1a1a', color: '#666', border: '1px solid #2a2a2a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  jobTitle: { fontSize: '28px', fontWeight: '800', color: '#f1f1f1', margin: '0 0 4px' },
  jobMeta: { fontSize: '14px', color: '#555', margin: 0 },
  successMsg: { background: '#0a1a0a', border: '1px solid #1a4a1a', color: '#4ade80', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1.5rem' },
  badge: (status) => ({
    padding: '4px 14px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'active' ? '#0a1a2a' : status === 'complete' ? '#0a2a0a' : status === 'archived' ? '#1a1a1a' : '#2a2a0a',
    color: status === 'active' ? '#60a5fa' : status === 'complete' ? '#4ade80' : status === 'archived' ? '#555' : '#facc15',
    border: `1px solid ${status === 'active' ? '#1a3a5a' : status === 'complete' ? '#1a4a1a' : status === 'archived' ? '#2a2a2a' : '#4a4a0a'}`
  }),
  billingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' },
  subRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' },
  statCard: { background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem' },
  statLabel: { fontSize: '11px', fontWeight: '600', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '6px' },
  statValue: (accent) => ({ fontSize: '24px', fontWeight: '800', color: accent || '#f1f1f1', margin: 0 }),
  confirmBox: { background: '#1a0a0a', border: '1px solid #5a1a1a', borderRadius: '8px', padding: '1.25rem', marginTop: '1rem' },
  tabs: { display: 'flex', marginBottom: '1.5rem', borderBottom: '1px solid #222' },
  tab: (active) => ({
    padding: '10px 20px', background: 'none', border: 'none',
    borderBottom: active ? '2px solid #e8590c' : '2px solid transparent',
    color: active ? '#f1f1f1' : '#555', fontSize: '13px', fontWeight: '700',
    cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '-1px',
  }),
  contractRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1a1a1a', cursor: 'pointer' },
  coRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #161616' },
  expandedPanel: { background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', marginTop: '4px', marginBottom: '4px' },
  inlineForm: { background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' },
  pill: (color) => ({
    padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: color === 'green' ? '#0a2a0a' : color === 'red' ? '#2a0a0a' : color === 'blue' ? '#0a1a2a' : color === 'orange' ? '#2a1a00' : '#1a1a1a',
    color: color === 'green' ? '#4ade80' : color === 'red' ? '#ff6b6b' : color === 'blue' ? '#60a5fa' : color === 'orange' ? '#e8590c' : '#555',
    border: `1px solid ${color === 'green' ? '#1a4a1a' : color === 'red' ? '#5a1a1a' : color === 'blue' ? '#1a3a5a' : color === 'orange' ? '#4a2a00' : '#2a2a2a'}`
  }),
}

export default function JobDetail() {
  const router = useRouter()
  const [id, setId] = useState(null)
  const [job, setJob] = useState(null)
  const [form, setForm] = useState({})
  const [subs, setSubs] = useState([])
  const [billing, setBilling] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [activeTab, setActiveTab] = useState('details')
  const [contracts, setContracts] = useState([])
  const [expandedContract, setExpandedContract] = useState(null)
  const [changeOrders, setChangeOrders] = useState({})
  const [showContractForm, setShowContractForm] = useState(false)
  const [contractForm, setContractForm] = useState({ company_name: '', trade: '', scope: '', contract_amount: '', status: 'active' })
  const [showCOForm, setShowCOForm] = useState(null)
  const [coForm, setCoForm] = useState({ description: '', amount: '', status: 'pending' })
  const [contractSaving, setContractSaving] = useState(false)

  const update = (f, v) => setForm(x => ({ ...x, [f]: v }))
  const updateContract = (f, v) => setContractForm(x => ({ ...x, [f]: v }))
  const updateCO = (f, v) => setCoForm(x => ({ ...x, [f]: v }))

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const jobId = params.get('id')
    setId(jobId)
  }, [])

  useEffect(() => {
    if (!id) return
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (prof?.role !== 'pm') { router.push('/submit'); return }
      const { data: jobData } = await supabase.from('jobs').select('*').eq('id', id).single()
      if (!jobData) { router.push('/dashboard'); return }
      setJob(jobData)
      setForm(jobData)
      const { data: subList } = await supabase.from('job_assignments').select('*, profiles(full_name, company_name, phone)').eq('job_id', id)
      setSubs(subList || [])
      const { data: bills } = await supabase.from('billing_submissions').select('*').eq('job_id', id).order('submitted_at', { ascending: false })
      setBilling(bills || [])
      const { data: contractData } = await supabase.from('subcontract_summary').select('*').eq('job_id', id).order('created_at', { ascending: true })
      setContracts(contractData || [])
      setLoading(false)
    }
    load()
  }, [id, router])

  async function saveJob(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('jobs').update({
      job_number: form.job_number,
      project_name: form.project_name,
      location: form.location,
      contract_value: form.contract_value ? parseFloat(form.contract_value) : null,
      start_date: form.start_date || null,
      status: form.status,
      owner_company: form.owner_company,
      owner_name: form.owner_name,
      owner_email: form.owner_email,
      owner_phone: form.owner_phone,
      architect_name: form.architect_name,
      architect_company: form.architect_company,
      architect_email: form.architect_email,
      engineer_name: form.engineer_name,
      engineer_company: form.engineer_company,
      engineer_email: form.engineer_email,
      permit_number: form.permit_number,
      permit_date: form.permit_date || null,
      scope_notes: form.scope_notes,
    }).eq('id', id)
    if (!error) { setMsg('Job saved successfully.'); setTimeout(() => setMsg(''), 3000) }
    setSaving(false)
  }

  async function archiveJob() {
    await supabase.from('jobs').update({ archived: true, status: 'on_hold' }).eq('id', id)
    setMsg('Job archived.')
    setTimeout(() => router.push('/dashboard'), 1500)
  }

  async function deleteJob() {
    await supabase.from('job_assignments').delete().eq('job_id', id)
    await supabase.from('billing_submissions').delete().eq('job_id', id)
    await supabase.from('jobs').delete().eq('id', id)
    router.push('/dashboard')
  }

  async function reloadContracts() {
    const { data } = await supabase.from('subcontract_summary').select('*').eq('job_id', id).order('created_at', { ascending: true })
    setContracts(data || [])
  }

  async function saveContract(e) {
    e.preventDefault()
    setContractSaving(true)
    await supabase.from('subcontracts').insert({
      job_id: id,
      company_name: contractForm.company_name,
      trade: contractForm.trade,
      scope: contractForm.scope,
      contract_amount: contractForm.contract_amount ? parseFloat(contractForm.contract_amount) : null,
      status: contractForm.status,
    })
    await reloadContracts()
    setShowContractForm(false)
    setContractForm({ company_name: '', trade: '', scope: '', contract_amount: '', status: 'active' })
    setContractSaving(false)
  }

  async function toggleContract(subcontractId) {
    if (expandedContract === subcontractId) { setExpandedContract(null); return }
    setExpandedContract(subcontractId)
    if (!changeOrders[subcontractId]) {
      const { data } = await supabase.from('change_orders').select('*').eq('subcontract_id', subcontractId).order('created_at', { ascending: true })
      setChangeOrders(prev => ({ ...prev, [subcontractId]: data || [] }))
    }
  }

  async function saveCO(e, subcontractId) {
    e.preventDefault()
    setContractSaving(true)
    await supabase.from('change_orders').insert({
      subcontract_id: subcontractId,
      job_id: id,
      description: coForm.description,
      amount: coForm.amount ? parseFloat(coForm.amount) : 0,
      status: coForm.status,
    })
    const { data: coData } = await supabase.from('change_orders').select('*').eq('subcontract_id', subcontractId).order('created_at', { ascending: true })
    setChangeOrders(prev => ({ ...prev, [subcontractId]: coData || [] }))
    await reloadContracts()
    setShowCOForm(null)
    setCoForm({ description: '', amount: '', status: 'pending' })
    setContractSaving(false)
  }

  const totalBilled = billing.reduce((a, b) => a + (b.amount_billed || 0), 0)
  const pending = billing.filter(b => b.status === 'pending').length
  const pctContract = job?.contract_value ? ((totalBilled / job.contract_value) * 100).toFixed(1) : null

  const totalContractValue = contracts.reduce((a, c) => a + (c.contract_amount || 0), 0)
  const totalCOValue = contracts.reduce((a, c) => a + (c.approved_co_total || 0), 0)
  const revisedTotal = totalContractValue + totalCOValue

  function contractStatusColor(status) {
    if (status === 'active') return 'blue'
    if (status === 'complete') return 'green'
    if (status === 'void') return 'red'
    return 'gray'
  }

  function coStatusColor(status) {
    if (status === 'approved') return 'green'
    if (status === 'rejected') return 'red'
    return 'orange'
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#555' }}>Loading...</div>

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
            <div>
              <div style={s.logoName}>NV Construction</div>
              <div style={s.logoSub}>Job Detail</div>
            </div>
          </div>
        </div>
      </header>

      <main style={s.main}>
        <button style={s.backBtn} onClick={() => router.push('/dashboard')}>← Back to dashboard</button>

        {msg && <div style={s.successMsg}>{msg}</div>}

        {job && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div>
                <h1 style={s.jobTitle}>#{job.job_number} — {job.project_name}</h1>
                <p style={s.jobMeta}>{job.location}{job.start_date ? ' · Started ' + new Date(job.start_date).toLocaleDateString() : ''}</p>
              </div>
              <span style={s.badge(job.archived ? 'archived' : job.status)}>{job.archived ? 'Archived' : job.status}</span>
            </div>

            <div style={s.statRow}>
              <div style={s.statCard}>
                <div style={s.statLabel}>Total billed</div>
                <div style={s.statValue()}>${totalBilled.toLocaleString()}</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statLabel}>Contract value</div>
                <div style={s.statValue()}>{job.contract_value ? '$' + parseFloat(job.contract_value).toLocaleString() : '—'}</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statLabel}>% billed</div>
                <div style={s.statValue('#e8590c')}>{pctContract ? pctContract + '%' : '—'}</div>
              </div>
            </div>

            <div style={s.tabs}>
              <button style={s.tab(activeTab === 'details')} onClick={() => setActiveTab('details')}>Details</button>
              <button style={s.tab(activeTab === 'contracts')} onClick={() => setActiveTab('contracts')}>
                Contracts{contracts.length > 0 ? ` (${contracts.length})` : ''}
              </button>
            </div>

            {activeTab === 'details' && (
              <>
                <form onSubmit={saveJob}>
                  <div style={s.card}>
                    <p style={s.cardTitle}>Job info</p>
                    <div style={{ ...s.grid3, marginBottom: '12px' }}>
                      <div><label style={s.label}>Job number</label><input style={s.input} value={form.job_number || ''} onChange={e => update('job_number', e.target.value)} required /></div>
                      <div><label style={s.label}>Project name</label><input style={s.input} value={form.project_name || ''} onChange={e => update('project_name', e.target.value)} required /></div>
                      <div><label style={s.label}>Location</label><input style={s.input} value={form.location || ''} onChange={e => update('location', e.target.value)} /></div>
                    </div>
                    <div style={{ ...s.grid3, marginBottom: '12px' }}>
                      <div><label style={s.label}>Contract value</label><input type="number" style={s.input} value={form.contract_value || ''} onChange={e => update('contract_value', e.target.value)} /></div>
                      <div><label style={s.label}>Start date</label><input type="date" style={s.input} value={form.start_date || ''} onChange={e => update('start_date', e.target.value)} /></div>
                      <div><label style={s.label}>Status</label>
                        <select style={s.input} value={form.status || 'active'} onChange={e => update('status', e.target.value)}>
                          <option value="active">Active</option>
                          <option value="on_hold">On hold</option>
                          <option value="complete">Complete</option>
                        </select>
                      </div>
                    </div>
                    <div><label style={s.label}>Scope notes</label><textarea style={s.textarea} value={form.scope_notes || ''} onChange={e => update('scope_notes', e.target.value)} placeholder="Project description, scope of work, special requirements..." /></div>
                  </div>

                  <div style={s.card}>
                    <p style={s.cardTitle}>Owner info</p>
                    <div style={{ ...s.grid2, marginBottom: '12px' }}>
                      <div><label style={s.label}>Owner company</label><input style={s.input} value={form.owner_company || ''} onChange={e => update('owner_company', e.target.value)} placeholder="Braum's Inc." /></div>
                      <div><label style={s.label}>Owner name</label><input style={s.input} value={form.owner_name || ''} onChange={e => update('owner_name', e.target.value)} placeholder="John Smith" /></div>
                    </div>
                    <div style={s.grid2}>
                      <div><label style={s.label}>Owner email</label><input style={s.input} value={form.owner_email || ''} onChange={e => update('owner_email', e.target.value)} placeholder="owner@company.com" /></div>
                      <div><label style={s.label}>Owner phone</label><input style={s.input} value={form.owner_phone || ''} onChange={e => update('owner_phone', e.target.value)} placeholder="(555) 555-5555" /></div>
                    </div>
                  </div>

                  <div style={s.card}>
                    <p style={s.cardTitle}>Architect & engineer</p>
                    <div style={{ ...s.grid3, marginBottom: '12px' }}>
                      <div><label style={s.label}>Architect name</label><input style={s.input} value={form.architect_name || ''} onChange={e => update('architect_name', e.target.value)} /></div>
                      <div><label style={s.label}>Architect company</label><input style={s.input} value={form.architect_company || ''} onChange={e => update('architect_company', e.target.value)} /></div>
                      <div><label style={s.label}>Architect email</label><input style={s.input} value={form.architect_email || ''} onChange={e => update('architect_email', e.target.value)} /></div>
                    </div>
                    <div style={s.grid3}>
                      <div><label style={s.label}>Engineer name</label><input style={s.input} value={form.engineer_name || ''} onChange={e => update('engineer_name', e.target.value)} /></div>
                      <div><label style={s.label}>Engineer company</label><input style={s.input} value={form.engineer_company || ''} onChange={e => update('engineer_company', e.target.value)} /></div>
                      <div><label style={s.label}>Engineer email</label><input style={s.input} value={form.engineer_email || ''} onChange={e => update('engineer_email', e.target.value)} /></div>
                    </div>
                  </div>

                  <div style={s.card}>
                    <p style={s.cardTitle}>Permits</p>
                    <div style={s.grid2}>
                      <div><label style={s.label}>Permit number</label><input style={s.input} value={form.permit_number || ''} onChange={e => update('permit_number', e.target.value)} placeholder="PERM-2024-0001" /></div>
                      <div><label style={s.label}>Permit date</label><input type="date" style={s.input} value={form.permit_date || ''} onChange={e => update('permit_date', e.target.value)} /></div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', marginBottom: '1.5rem' }}>
                    <button type="submit" style={{ ...s.btn, opacity: saving ? 0.6 : 1 }} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
                    <button type="button" style={s.btnGray} onClick={archiveJob}>Archive job</button>
                    <button type="button" style={s.btnRed} onClick={() => setConfirmDelete(!confirmDelete)}>Delete job</button>
                  </div>

                  {confirmDelete && (
                    <div style={s.confirmBox}>
                      <p style={{ color: '#ff6b6b', fontSize: '14px', margin: '0 0 1rem' }}>Are you sure? This will permanently delete the job, all billing submissions, and all sub assignments. This cannot be undone.</p>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" onClick={deleteJob} style={s.btnRed}>Yes, delete permanently</button>
                        <button type="button" onClick={() => setConfirmDelete(false)} style={s.btnGray}>Cancel</button>
                      </div>
                    </div>
                  )}
                </form>

                <div style={s.card}>
                  <p style={s.cardTitle}>Assigned subcontractors ({subs.length})</p>
                  {subs.length === 0 ? <p style={{ color: '#444', fontSize: '14px' }}>No subs assigned yet.</p> : subs.map(a => (
                    <div key={a.id} style={s.subRow}>
                      <div>
                        <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{a.profiles?.company_name || a.sub_email}</p>
                        <p style={{ margin: 0, fontSize: '12px', color: '#555', marginTop: '3px' }}>{a.profiles?.full_name} · {a.sub_email}</p>
                      </div>
                      <span style={{ fontSize: '12px', color: a.sub_id ? '#4ade80' : '#e8590c' }}>{a.sub_id ? 'Registered' : 'Pending registration'}</span>
                    </div>
                  ))}
                </div>

                <div style={s.card}>
                  <p style={s.cardTitle}>Billing activity ({billing.length} submissions · {pending} pending)</p>
                  {billing.length === 0 ? <p style={{ color: '#444', fontSize: '14px' }}>No billing submissions yet.</p> : billing.map(b => (
                    <div key={b.id} style={s.billingRow}>
                      <div>
                        <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{b.company_name}</p>
                        <p style={{ margin: 0, fontSize: '12px', color: '#555', marginTop: '3px' }}>{new Date(b.submitted_at).toLocaleDateString()} · {b.pct_complete}% complete</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <span style={{ fontWeight: '700', color: '#f1f1f1' }}>${b.amount_billed?.toLocaleString()}</span>
                        <span style={{
                          padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700',
                          background: b.status === 'approved' ? '#0a2a0a' : b.status === 'rejected' ? '#2a0a0a' : '#2a1a00',
                          color: b.status === 'approved' ? '#4ade80' : b.status === 'rejected' ? '#ff6b6b' : '#e8590c',
                          border: `1px solid ${b.status === 'approved' ? '#1a4a1a' : b.status === 'rejected' ? '#5a1a1a' : '#4a2a00'}`
                        }}>{b.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'contracts' && (
              <>
                <div style={s.statRow}>
                  <div style={s.statCard}>
                    <div style={s.statLabel}>Subcontract value</div>
                    <div style={s.statValue()}>${totalContractValue.toLocaleString()}</div>
                  </div>
                  <div style={s.statCard}>
                    <div style={s.statLabel}>Change orders</div>
                    <div style={s.statValue(totalCOValue > 0 ? '#4ade80' : totalCOValue < 0 ? '#ff6b6b' : undefined)}>
                      {totalCOValue >= 0 ? '+' : ''}${totalCOValue.toLocaleString()}
                    </div>
                  </div>
                  <div style={s.statCard}>
                    <div style={s.statLabel}>Revised total</div>
                    <div style={s.statValue('#e8590c')}>${revisedTotal.toLocaleString()}</div>
                  </div>
                </div>

                <div style={s.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                    <p style={{ ...s.cardTitle, margin: 0 }}>Subcontracts ({contracts.length})</p>
                    <button style={s.btnSmall} onClick={() => setShowContractForm(!showContractForm)}>
                      {showContractForm ? 'Cancel' : '+ Add subcontract'}
                    </button>
                  </div>

                  {showContractForm && (
                    <form onSubmit={saveContract} style={s.inlineForm}>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div><label style={s.label}>Company name</label><input style={s.input} value={contractForm.company_name} onChange={e => updateContract('company_name', e.target.value)} required placeholder="ABC Electrical" /></div>
                        <div><label style={s.label}>Trade</label><input style={s.input} value={contractForm.trade} onChange={e => updateContract('trade', e.target.value)} placeholder="Electrical" /></div>
                      </div>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div><label style={s.label}>Contract amount</label><input type="number" step="0.01" style={s.input} value={contractForm.contract_amount} onChange={e => updateContract('contract_amount', e.target.value)} placeholder="0.00" /></div>
                        <div><label style={s.label}>Status</label>
                          <select style={s.input} value={contractForm.status} onChange={e => updateContract('status', e.target.value)}>
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                            <option value="complete">Complete</option>
                            <option value="void">Void</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ marginBottom: '12px' }}><label style={s.label}>Scope</label><textarea style={{ ...s.textarea, minHeight: '70px' }} value={contractForm.scope} onChange={e => updateContract('scope', e.target.value)} placeholder="Scope of work..." /></div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="submit" style={{ ...s.btnSmall, opacity: contractSaving ? 0.6 : 1 }} disabled={contractSaving}>{contractSaving ? 'Saving...' : 'Save contract'}</button>
                        <button type="button" style={s.btnSmallGray} onClick={() => setShowContractForm(false)}>Cancel</button>
                      </div>
                    </form>
                  )}

                  {contracts.length === 0 && !showContractForm && (
                    <p style={{ color: '#444', fontSize: '14px' }}>No subcontracts yet.</p>
                  )}

                  {contracts.map(c => (
                    <div key={c.subcontract_id}>
                      <div style={s.contractRow} onClick={() => toggleContract(c.subcontract_id)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <p style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{c.company_name || c.sub_email || '—'}</p>
                            {c.trade && <span style={{ fontSize: '12px', color: '#555' }}>{c.trade}</span>}
                            <span style={s.pill(contractStatusColor(c.status))}>{c.status}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexShrink: 0 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' }}>Contract</div>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>${(c.contract_amount || 0).toLocaleString()}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' }}>COs</div>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: (c.approved_co_total || 0) !== 0 ? '#4ade80' : '#333' }}>
                              {(c.approved_co_total || 0) >= 0 ? '+' : ''}${(c.approved_co_total || 0).toLocaleString()}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' }}>Revised</div>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: '#e8590c' }}>${(c.revised_amount || c.contract_amount || 0).toLocaleString()}</div>
                          </div>
                          <span style={{ color: '#444', fontSize: '14px', marginLeft: '4px' }}>{expandedContract === c.subcontract_id ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {expandedContract === c.subcontract_id && (
                        <div style={s.expandedPanel}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <p style={{ margin: 0, fontSize: '12px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' }}>Change orders</p>
                            <button style={s.btnSmall} onClick={e => { e.stopPropagation(); setShowCOForm(showCOForm === c.subcontract_id ? null : c.subcontract_id) }}>
                              {showCOForm === c.subcontract_id ? 'Cancel' : '+ Add CO'}
                            </button>
                          </div>

                          {showCOForm === c.subcontract_id && (
                            <form onSubmit={e => saveCO(e, c.subcontract_id)} style={{ ...s.inlineForm, background: '#111', border: '1px solid #222', marginBottom: '1rem' }}>
                              <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                <div><label style={s.label}>Amount</label><input type="number" step="0.01" style={s.input} value={coForm.amount} onChange={e => updateCO('amount', e.target.value)} placeholder="0.00" required /></div>
                                <div><label style={s.label}>Status</label>
                                  <select style={s.input} value={coForm.status} onChange={e => updateCO('status', e.target.value)}>
                                    <option value="pending">Pending</option>
                                    <option value="approved">Approved</option>
                                    <option value="rejected">Rejected</option>
                                  </select>
                                </div>
                              </div>
                              <div style={{ marginBottom: '12px' }}><label style={s.label}>Description</label><input style={s.input} value={coForm.description} onChange={e => updateCO('description', e.target.value)} placeholder="Scope addition or deduct..." required /></div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button type="submit" style={{ ...s.btnSmall, opacity: contractSaving ? 0.6 : 1 }} disabled={contractSaving}>{contractSaving ? 'Saving...' : 'Save CO'}</button>
                                <button type="button" style={s.btnSmallGray} onClick={() => setShowCOForm(null)}>Cancel</button>
                              </div>
                            </form>
                          )}

                          {(changeOrders[c.subcontract_id] || []).length === 0 ? (
                            <p style={{ color: '#444', fontSize: '13px', margin: 0 }}>No change orders yet.</p>
                          ) : (
                            (changeOrders[c.subcontract_id] || []).map(co => (
                              <div key={co.id} style={s.coRow}>
                                <div>
                                  <p style={{ margin: 0, fontSize: '13px', color: '#f1f1f1' }}>{co.description}</p>
                                  <p style={{ margin: 0, fontSize: '11px', color: '#555', marginTop: '3px' }}>{new Date(co.created_at).toLocaleDateString()}</p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                                  <span style={{ fontWeight: '700', fontSize: '14px', color: (co.amount || 0) < 0 ? '#ff6b6b' : '#f1f1f1' }}>
                                    {(co.amount || 0) >= 0 ? '+' : ''}${(co.amount || 0).toLocaleString()}
                                  </span>
                                  <span style={s.pill(coStatusColor(co.status))}>{co.status}</span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
