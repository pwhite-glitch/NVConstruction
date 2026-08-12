'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString() : '—'

const TABS = [
  { id: 'details',      label: 'Details' },
  { id: 'budget',       label: 'Budget' },
  { id: 'subs',         label: 'Subs' },
  { id: 'changeorders', label: 'Change Orders' },
  { id: 'billing',      label: 'Billing' },
  { id: 'schedule',     label: 'Schedule' },
  { id: 'photos',       label: 'Photos' },
  { id: 'documents',    label: 'Documents' },
  { id: 'contacts',     label: 'Contacts' },
]

const s = {
  page: { minHeight: '100vh', background: '#080808', color: '#f1f1f1', fontFamily: "'Inter', sans-serif", fontSize: '14px' },
  header: { padding: '20px 28px 0', borderBottom: '1px solid #1a1a1a' },
  backBtn: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '13px', padding: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '6px' },
  jobTitle: { fontSize: '22px', fontWeight: '700', color: '#f1f1f1', margin: '0 0 4px' },
  jobMeta: { fontSize: '13px', color: '#555', margin: '0 0 16px' },
  tabs: { display: 'flex', gap: '0', overflowX: 'auto' },
  tab: (active) => ({ padding: '10px 18px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', background: 'none', border: 'none', borderBottom: active ? '2px solid #e8590c' : '2px solid transparent', color: active ? '#e8590c' : '#555', whiteSpace: 'nowrap' }),
  body: { padding: '24px 28px', maxWidth: '1100px' },
  card: { background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '10px', padding: '20px', marginBottom: '20px' },
  cardTitle: { fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 16px' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' },
  input: { width: '100%', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '9px 12px', color: '#f1f1f1', fontSize: '13px', outline: 'none', boxSizing: 'border-box' },
  select: { width: '100%', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '9px 12px', color: '#f1f1f1', fontSize: '13px', outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '9px 12px', color: '#f1f1f1', fontSize: '13px', outline: 'none', resize: 'vertical', boxSizing: 'border-box' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' },
  btn: { padding: '9px 20px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' },
  btnSm: { padding: '6px 14px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' },
  btnGray: { padding: '9px 20px', background: '#1a1a1a', color: '#aaa', border: '1px solid #2a2a2a', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnSmGray: { padding: '6px 12px', background: '#1a1a1a', color: '#aaa', border: '1px solid #2a2a2a', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnGreen: { padding: '6px 14px', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' },
  btnRed: { padding: '6px 14px', background: '#1a0a0a', color: '#f87171', border: '1px solid #3a1a1a', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  inlineForm: { background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '16px', marginBottom: '16px' },
  badge: (color) => {
    const map = { orange: ['#2a1200','#e8590c','#4a2200'], green: ['#0a2a0a','#4ade80','#1a4a1a'], red: ['#1a0a0a','#f87171','#3a1a1a'], blue: ['#0a1020','#60a5fa','#1a2a40'], gray: ['#111','#555','#222'] }
    const [bg, fg, border] = map[color] || map.gray
    return { display: 'inline-block', padding: '2px 9px', borderRadius: '99px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.5px', background: bg, color: fg, border: `1px solid ${border}` }
  },
  statCard: { background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '14px 16px' },
  statLabel: { fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' },
  statValue: (color) => ({ fontSize: '20px', fontWeight: '700', color: color || '#f1f1f1', fontFamily: 'monospace' }),
  emptyMsg: { color: '#444', fontSize: '13px', textAlign: 'center', padding: '32px 0' },
  tableRow: { display: 'grid', gap: '12px', padding: '10px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' },
  successMsg: { color: '#4ade80', fontSize: '13px' },
  errMsg: { color: '#f87171', fontSize: '13px' },
}

const statusColor = { pending: 'orange', approved: 'green', rejected: 'red', active: 'green', complete: 'gray', open: 'orange', closed: 'gray', planned: 'blue', 'in-progress': 'orange', done: 'green' }

export default function ResidentialJobDetail() {
  const router = useRouter()
  const [id, setId] = useState(null)
  const [profile, setProfile] = useState(null)
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('details')

  // Details edit
  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsForm, setDetailsForm] = useState({})
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsMsg, setDetailsMsg] = useState('')

  // Budget
  const [budgetItems, setBudgetItems] = useState([])
  const [showAddBudget, setShowAddBudget] = useState(false)
  const [newBudget, setNewBudget] = useState({ description: '', budgeted_amount: '', cost_code: '', notes: '' })
  const [addingBudget, setAddingBudget] = useState(false)
  const [editingBudgetId, setEditingBudgetId] = useState(null)
  const [editBudgetForm, setEditBudgetForm] = useState({})
  const [directCosts, setDirectCosts] = useState([])

  // Subs
  const [contracts, setContracts] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteMsg, setInviteMsg] = useState('')
  const [showInviteForm, setShowInviteForm] = useState(false)

  // Change orders
  const [changeOrders, setChangeOrders] = useState([])
  const [showAddCO, setShowAddCO] = useState(false)
  const [newCO, setNewCO] = useState({ description: '', amount: '', notes: '' })
  const [addingCO, setAddingCO] = useState(false)
  const [coMsg, setCOMsg] = useState('')

  // Billing
  const [billingSubmissions, setBillingSubmissions] = useState([])
  const [drawRequests, setDrawRequests] = useState([])
  const [showCreateDraw, setShowCreateDraw] = useState(false)
  const [drawForm, setDrawForm] = useState({ title: '' })
  const [creatingDraw, setCreatingDraw] = useState(false)
  const [expandedDrawId, setExpandedDrawId] = useState(null)
  const [drawAddCostIds, setDrawAddCostIds] = useState([])
  const [savingDrawCosts, setSavingDrawCosts] = useState(false)
  const [billingBilling, setBillingBillingTab] = useState('submissions')

  // Schedule (milestones)
  const [milestones, setMilestones] = useState([])
  const [showAddMilestone, setShowAddMilestone] = useState(false)
  const [newMilestone, setNewMilestone] = useState({ title: '', planned_date: '', status: 'planned', notes: '' })
  const [addingMilestone, setAddingMilestone] = useState(false)

  // Photos
  const [photos, setPhotos] = useState([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef(null)

  // Documents
  const [documents, setDocuments] = useState([])
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const docInputRef = useRef(null)

  // Contacts
  const [contacts, setContacts] = useState([])
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', role: '', phone: '', email: '', company: '', notes: '' })
  const [addingContact, setAddingContact] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const jobId = params.get('id')
    const tab = params.get('tab')
    setId(jobId)
    if (tab) setActiveTab(tab)
  }, [])

  useEffect(() => { if (id) loadAll() }, [id])

  async function loadAll() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    const [profileRes, jobRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('jobs').select('*').eq('id', id).single(),
    ])
    setProfile(profileRes.data)
    setJob(jobRes.data)
    if (jobRes.data) setDetailsForm(jobRes.data)

    await Promise.all([
      loadBudget(),
      loadContracts(),
      loadChangeOrders(),
      loadBillingSubmissions(),
      loadDrawRequests(),
      loadMilestones(),
      loadPhotos(),
      loadDocuments(),
      loadContacts(),
      loadDirectCosts(),
    ])
    setLoading(false)
  }

  async function loadBudget() {
    const { data } = await supabase.from('budget_items').select('*').eq('job_id', id).order('cost_code')
    setBudgetItems(data || [])
  }

  async function loadContracts() {
    const { data } = await supabase.from('subcontracts').select('*, budget_allocations:subcontract_budget_allocations(*)').eq('job_id', id).order('created_at')
    setContracts(data || [])
  }

  async function loadChangeOrders() {
    const { data } = await supabase.from('prime_change_orders').select('*').eq('job_id', id).order('created_at', { ascending: false })
    setChangeOrders(data || [])
  }

  async function loadBillingSubmissions() {
    const { data } = await supabase.from('billing_submissions').select('*').eq('job_id', id).order('submitted_at', { ascending: false })
    setBillingSubmissions(data || [])
  }

  async function loadDrawRequests() {
    const res = await fetch(`/api/draw-requests?job_id=${id}`)
    if (res.ok) { const { draws } = await res.json(); setDrawRequests(draws || []) }
  }

  async function loadMilestones() {
    const { data } = await supabase.from('milestones').select('*').eq('job_id', id).order('planned_date')
    setMilestones(data || [])
  }

  async function loadPhotos() {
    const { data } = await supabase.from('job_photos').select('*').eq('job_id', id).order('created_at', { ascending: false })
    setPhotos(data || [])
  }

  async function loadDocuments() {
    const { data } = await supabase.from('job_docs').select('*').eq('job_id', id).order('created_at', { ascending: false })
    setDocuments(data || [])
  }

  async function loadContacts() {
    const { data } = await supabase.from('job_contacts').select('*').eq('job_id', id).order('name')
    setContacts(data || [])
  }

  async function loadDirectCosts() {
    const { data } = await supabase.from('direct_costs').select('*').eq('job_id', id).order('date', { ascending: false })
    setDirectCosts(data || [])
  }

  async function saveDetails() {
    setSavingDetails(true)
    setDetailsMsg('')
    const { error } = await supabase.from('jobs').update({
      project_name: detailsForm.project_name,
      job_number: detailsForm.job_number,
      location: detailsForm.location,
      start_date: detailsForm.start_date || null,
      end_date: detailsForm.end_date || null,
      contract_value: detailsForm.contract_value || null,
      owner_name: detailsForm.owner_name,
      owner_email: detailsForm.owner_email,
      owner_phone: detailsForm.owner_phone,
      owner_company: detailsForm.owner_company,
      status: detailsForm.status,
      notes: detailsForm.notes,
    }).eq('id', id)
    if (error) { setDetailsMsg('Error: ' + error.message) }
    else {
      const { data } = await supabase.from('jobs').select('*').eq('id', id).single()
      setJob(data)
      setDetailsForm(data)
      setEditingDetails(false)
      setDetailsMsg('Saved')
      setTimeout(() => setDetailsMsg(''), 3000)
    }
    setSavingDetails(false)
  }

  async function addBudgetItem() {
    if (!newBudget.description || !newBudget.budgeted_amount) return
    setAddingBudget(true)
    await supabase.from('budget_items').insert({ job_id: id, description: newBudget.description, budgeted_amount: parseFloat(newBudget.budgeted_amount), cost_code: newBudget.cost_code || null, notes: newBudget.notes || null })
    await loadBudget()
    setNewBudget({ description: '', budgeted_amount: '', cost_code: '', notes: '' })
    setShowAddBudget(false)
    setAddingBudget(false)
  }

  async function saveBudgetEdit(itemId) {
    await supabase.from('budget_items').update({ description: editBudgetForm.description, budgeted_amount: parseFloat(editBudgetForm.budgeted_amount) || 0, cost_code: editBudgetForm.cost_code || null }).eq('id', itemId)
    await loadBudget()
    setEditingBudgetId(null)
  }

  async function deleteBudgetItem(itemId) {
    if (!confirm('Delete this budget line?')) return
    await supabase.from('budget_items').delete().eq('id', itemId)
    await loadBudget()
  }

  async function addCO() {
    if (!newCO.description || !newCO.amount) return
    setAddingCO(true)
    setCOMsg('')
    const { error } = await supabase.from('prime_change_orders').insert({ job_id: id, description: newCO.description, amount: parseFloat(newCO.amount), notes: newCO.notes || null, status: 'pending' })
    if (error) { setCOMsg('Error: ' + error.message) }
    else {
      await loadChangeOrders()
      setNewCO({ description: '', amount: '', notes: '' })
      setShowAddCO(false)
    }
    setAddingCO(false)
  }

  async function updateCOStatus(coId, status) {
    await supabase.from('prime_change_orders').update({ status }).eq('id', coId)
    if (status === 'approved') {
      const co = changeOrders.find(c => c.id === coId)
      if (co) {
        const current = parseFloat(job?.contract_value || 0)
        await supabase.from('jobs').update({ contract_value: current + parseFloat(co.amount) }).eq('id', id)
        const { data } = await supabase.from('jobs').select('*').eq('id', id).single()
        setJob(data)
      }
    }
    await loadChangeOrders()
  }

  async function inviteSub(e) {
    e.preventDefault()
    setInviteMsg('')
    const res = await fetch('/api/job-assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id, sub_email: inviteEmail.toLowerCase().trim() }) })
    const result = await res.json()
    if (!res.ok) { setInviteMsg(res.status === 409 ? 'Already invited.' : 'Error: ' + result.error); return }
    setInviteMsg('Invited!')
    setInviteEmail('')
    await loadContracts()
    setTimeout(() => setInviteMsg(''), 3000)
  }

  async function createDraw() {
    if (creatingDraw) return
    setCreatingDraw(true)
    const title = drawForm.title || `Draw Request ${drawRequests.length + 1}`
    await fetch('/api/draw-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id, title, dc_ids: [], po_ids: [], gc_ids: [] }) })
    await loadDrawRequests()
    setDrawForm({ title: '' })
    setShowCreateDraw(false)
    setCreatingDraw(false)
  }

  async function updateDrawStatus(drawId, status) {
    await fetch('/api/draw-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: drawId, status }) })
    await loadDrawRequests()
  }

  async function deleteDraw(drawId) {
    if (!confirm('Delete this draw request?')) return
    await fetch(`/api/draw-requests?id=${drawId}`, { method: 'DELETE' })
    await loadDrawRequests()
  }

  async function saveDrawCosts(drawId) {
    setSavingDrawCosts(true)
    if (drawAddCostIds.length > 0) {
      await supabase.from('direct_costs').update({ draw_request_id: drawId }).in('id', drawAddCostIds)
    }
    await Promise.all([loadDrawRequests(), loadDirectCosts()])
    setDrawAddCostIds([])
    setSavingDrawCosts(false)
  }

  async function removeCostFromDraw(costId) {
    await supabase.from('direct_costs').update({ draw_request_id: null }).eq('id', costId)
    await Promise.all([loadDrawRequests(), loadDirectCosts()])
  }

  async function addMilestone() {
    if (!newMilestone.title) return
    setAddingMilestone(true)
    await supabase.from('milestones').insert({ job_id: id, title: newMilestone.title, planned_date: newMilestone.planned_date || null, status: newMilestone.status, notes: newMilestone.notes || null })
    await loadMilestones()
    setNewMilestone({ title: '', planned_date: '', status: 'planned', notes: '' })
    setShowAddMilestone(false)
    setAddingMilestone(false)
  }

  async function updateMilestoneStatus(milestoneId, status) {
    await supabase.from('milestones').update({ status, actual_date: status === 'done' ? new Date().toISOString().slice(0, 10) : null }).eq('id', milestoneId)
    await loadMilestones()
  }

  async function deleteMilestone(milestoneId) {
    if (!confirm('Delete this milestone?')) return
    await supabase.from('milestones').delete().eq('id', milestoneId)
    await loadMilestones()
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    const ext = file.name.split('.').pop()
    const path = `${id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('job-photos').upload(path, file)
    if (!upErr) {
      const { data: { publicUrl } } = supabase.storage.from('job-photos').getPublicUrl(path)
      await supabase.from('job_photos').insert({ job_id: id, url: publicUrl, caption: file.name })
      await loadPhotos()
    }
    setUploadingPhoto(false)
  }

  async function uploadDoc(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingDoc(true)
    const ext = file.name.split('.').pop()
    const path = `${id}/${Date.now()}_${file.name}`
    const { error: upErr } = await supabase.storage.from('job-docs').upload(path, file)
    if (!upErr) {
      const { data: { publicUrl } } = supabase.storage.from('job-docs').getPublicUrl(path)
      await supabase.from('job_docs').insert({ job_id: id, url: publicUrl, name: file.name, doc_type: 'general' })
      await loadDocuments()
    }
    setUploadingDoc(false)
  }

  async function addContact() {
    if (!newContact.name) return
    setAddingContact(true)
    await supabase.from('job_contacts').insert({ job_id: id, name: newContact.name, role: newContact.role || null, phone: newContact.phone || null, email: newContact.email || null, company: newContact.company || null, notes: newContact.notes || null })
    await loadContacts()
    setNewContact({ name: '', role: '', phone: '', email: '', company: '', notes: '' })
    setShowAddContact(false)
    setAddingContact(false)
  }

  async function deleteContact(contactId) {
    if (!confirm('Remove this contact?')) return
    await supabase.from('job_contacts').delete().eq('id', contactId)
    await loadContacts()
  }

  if (loading) return <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><div style={{ color: '#555' }}>Loading...</div></div>
  if (!job) return <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><div style={{ color: '#555' }}>Project not found.</div></div>

  const approvedCOs = changeOrders.filter(c => c.status === 'approved').reduce((a, c) => a + Number(c.amount), 0)
  const baseContract = Number(job.contract_value || 0)
  const budgetTotal = budgetItems.reduce((a, b) => a + Number(b.budgeted_amount || 0), 0)
  const committedTotal = contracts.reduce((a, c) => a + Number(c.contract_value || 0), 0)
  const dcTotal = directCosts.reduce((a, d) => a + Number(d.amount || 0), 0)
  const approvedBillingTotal = billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.amount_billed || 0), 0)

  return (
    <div style={s.page}>
      {/* HEADER */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => router.push('/dashboard?tab=residential')}>← Back to Residential</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
          <div>
            <h1 style={s.jobTitle}>#{job.job_number} — {job.project_name}</h1>
            <p style={s.jobMeta}>
              {job.owner_name ? job.owner_name + ' · ' : ''}
              {job.location ? job.location + ' · ' : ''}
              {job.start_date ? 'Started ' + fmtDate(job.start_date) : ''}
              {job.status ? ' · ' + job.status.toUpperCase() : ''}
            </p>
          </div>
          <span style={s.badge(job.status === 'complete' ? 'gray' : 'green')}>{job.status === 'complete' ? 'COMPLETE' : 'ACTIVE'}</span>
        </div>
        <div style={s.tabs}>
          {TABS.map(t => <button key={t.id} style={s.tab(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>{t.label}</button>)}
        </div>
      </div>

      {/* BODY */}
      <div style={s.body}>

        {/* ── DETAILS ── */}
        {activeTab === 'details' && (
          <>
            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={s.statCard}><div style={s.statLabel}>Contract Value</div><div style={s.statValue()}>${fmt(job.contract_value)}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Approved COs</div><div style={s.statValue('#e8590c')}>${fmt(approvedCOs)}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Sub Billing Approved</div><div style={s.statValue('#4ade80')}>${fmt(approvedBillingTotal)}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Budget Items</div><div style={s.statValue()}>{budgetItems.length}</div></div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Project Details</p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {detailsMsg && <span style={detailsMsg.startsWith('Error') ? s.errMsg : s.successMsg}>{detailsMsg}</span>}
                  {editingDetails
                    ? <><button style={s.btn} onClick={saveDetails} disabled={savingDetails}>{savingDetails ? 'Saving...' : 'Save'}</button><button style={s.btnGray} onClick={() => { setEditingDetails(false); setDetailsForm(job) }}>Cancel</button></>
                    : <button style={s.btnSm} onClick={() => setEditingDetails(true)}>Edit</button>}
                </div>
              </div>

              {editingDetails ? (
                <>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Job number</label><input style={s.input} value={detailsForm.job_number || ''} onChange={e => setDetailsForm(f => ({ ...f, job_number: e.target.value }))} /></div>
                    <div><label style={s.label}>Project name</label><input style={s.input} value={detailsForm.project_name || ''} onChange={e => setDetailsForm(f => ({ ...f, project_name: e.target.value }))} /></div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Property address</label><input style={s.input} value={detailsForm.location || ''} onChange={e => setDetailsForm(f => ({ ...f, location: e.target.value }))} /></div>
                    <div><label style={s.label}>Contract value</label><input style={s.input} type="number" value={detailsForm.contract_value || ''} onChange={e => setDetailsForm(f => ({ ...f, contract_value: e.target.value }))} /></div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Start date</label><input style={s.input} type="date" value={detailsForm.start_date || ''} onChange={e => setDetailsForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                    <div><label style={s.label}>End date</label><input style={s.input} type="date" value={detailsForm.end_date || ''} onChange={e => setDetailsForm(f => ({ ...f, end_date: e.target.value }))} /></div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Status</label>
                      <select style={s.select} value={detailsForm.status || 'active'} onChange={e => setDetailsForm(f => ({ ...f, status: e.target.value }))}>
                        <option value="active">Active</option>
                        <option value="complete">Complete</option>
                        <option value="on-hold">On Hold</option>
                      </select>
                    </div>
                    <div><label style={s.label}>Notes</label><input style={s.input} value={detailsForm.notes || ''} onChange={e => setDetailsForm(f => ({ ...f, notes: e.target.value }))} /></div>
                  </div>
                  <div style={{ ...s.grid3, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Owner name</label><input style={s.input} value={detailsForm.owner_name || ''} onChange={e => setDetailsForm(f => ({ ...f, owner_name: e.target.value }))} /></div>
                    <div><label style={s.label}>Owner email</label><input style={s.input} type="email" value={detailsForm.owner_email || ''} onChange={e => setDetailsForm(f => ({ ...f, owner_email: e.target.value }))} /></div>
                    <div><label style={s.label}>Owner phone</label><input style={s.input} value={detailsForm.owner_phone || ''} onChange={e => setDetailsForm(f => ({ ...f, owner_phone: e.target.value }))} /></div>
                  </div>
                </>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  {[
                    ['Job Number', job.job_number],
                    ['Project Name', job.project_name],
                    ['Address', job.location],
                    ['Start Date', fmtDate(job.start_date)],
                    ['End Date', fmtDate(job.end_date)],
                    ['Contract Value', job.contract_value ? '$' + fmt(job.contract_value) : '—'],
                    ['Owner Name', job.owner_name],
                    ['Owner Email', job.owner_email],
                    ['Owner Phone', job.owner_phone],
                    ['Status', job.status],
                    ['Notes', job.notes],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '3px' }}>{label}</div>
                      <div style={{ fontSize: '14px', color: val ? '#f1f1f1' : '#444' }}>{val || '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── BUDGET ── */}
        {activeTab === 'budget' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={s.statCard}><div style={s.statLabel}>Total Budget</div><div style={s.statValue()}>${fmt(budgetTotal)}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Sub Committed</div><div style={s.statValue('#60a5fa')}>${fmt(committedTotal)}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Direct Costs</div><div style={s.statValue('#e8590c')}>${fmt(dcTotal)}</div></div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Budget Lines ({budgetItems.length})</p>
                <button style={s.btnSm} onClick={() => setShowAddBudget(v => !v)}>{showAddBudget ? 'Cancel' : '+ Add Line'}</button>
              </div>

              {showAddBudget && (
                <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                  <div style={{ ...s.grid3, marginBottom: '10px' }}>
                    <div><label style={s.label}>Description *</label><input style={s.input} placeholder="Framing, Electrical..." value={newBudget.description} onChange={e => setNewBudget(f => ({ ...f, description: e.target.value }))} autoFocus /></div>
                    <div><label style={s.label}>Budgeted Amount *</label><input style={s.input} type="number" placeholder="0.00" value={newBudget.budgeted_amount} onChange={e => setNewBudget(f => ({ ...f, budgeted_amount: e.target.value }))} /></div>
                    <div><label style={s.label}>Cost Code</label><input style={s.input} placeholder="03-000 (optional)" value={newBudget.cost_code} onChange={e => setNewBudget(f => ({ ...f, cost_code: e.target.value }))} /></div>
                  </div>
                  <button style={s.btn} onClick={addBudgetItem} disabled={addingBudget || !newBudget.description || !newBudget.budgeted_amount}>{addingBudget ? 'Adding...' : 'Add Budget Line'}</button>
                </div>
              )}

              {budgetItems.length === 0 ? (
                <div style={s.emptyMsg}>No budget lines yet.</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 80px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #222' }}>
                    {['Description', 'Code', 'Budget', 'Committed', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                  </div>
                  {budgetItems.map(item => {
                    const committed = contracts.filter(c => c.budget_item_id === item.id).reduce((a, c) => a + Number(c.contract_value || 0), 0)
                    const over = committed > Number(item.budgeted_amount)
                    return editingBudgetId === item.id ? (
                      <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 80px', gap: '10px', padding: '8px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' }}>
                        <input style={{ ...s.input, fontSize: '12px' }} value={editBudgetForm.description || ''} onChange={e => setEditBudgetForm(f => ({ ...f, description: e.target.value }))} />
                        <input style={{ ...s.input, fontSize: '12px' }} value={editBudgetForm.cost_code || ''} onChange={e => setEditBudgetForm(f => ({ ...f, cost_code: e.target.value }))} />
                        <input style={{ ...s.input, fontSize: '12px' }} type="number" value={editBudgetForm.budgeted_amount || ''} onChange={e => setEditBudgetForm(f => ({ ...f, budgeted_amount: e.target.value }))} />
                        <span style={{ fontSize: '13px', color: over ? '#f87171' : '#f1f1f1', fontFamily: 'monospace' }}>${fmt(committed)}</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnGreen} onClick={() => saveBudgetEdit(item.id)}>Save</button>
                          <button style={s.btnSmGray} onClick={() => setEditingBudgetId(null)}>×</button>
                        </div>
                      </div>
                    ) : (
                      <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 80px', gap: '10px', padding: '10px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{item.description}</span>
                        <span style={{ fontSize: '12px', color: '#555', fontFamily: 'monospace' }}>{item.cost_code || '—'}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(item.budgeted_amount)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: over ? '#f87171' : committed > 0 ? '#60a5fa' : '#555' }}>${fmt(committed)}</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmGray} onClick={() => { setEditingBudgetId(item.id); setEditBudgetForm(item) }}>Edit</button>
                          <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => deleteBudgetItem(item.id)}>×</button>
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 80px', gap: '10px', padding: '10px 0', marginTop: '4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#555', textTransform: 'uppercase' }}>Total</span>
                    <span />
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>${fmt(budgetTotal)}</span>
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', color: '#60a5fa' }}>${fmt(committedTotal)}</span>
                    <span />
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── SUBS ── */}
        {activeTab === 'subs' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Subcontractors ({contracts.length})</p>
              <button style={s.btnSm} onClick={() => setShowInviteForm(v => !v)}>{showInviteForm ? 'Cancel' : '+ Invite Sub'}</button>
            </div>

            {showInviteForm && (
              <form onSubmit={inviteSub} style={{ ...s.inlineForm, display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '16px' }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>Sub email address</label>
                  <input style={s.input} type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="sub@company.com" required autoFocus />
                </div>
                <button type="submit" style={s.btn}>Invite</button>
                {inviteMsg && <span style={inviteMsg.startsWith('Error') || inviteMsg === 'Already invited.' ? s.errMsg : s.successMsg}>{inviteMsg}</span>}
              </form>
            )}

            {contracts.length === 0 ? (
              <div style={s.emptyMsg}>No subcontracts yet. Invite a sub to get started.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 80px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #222' }}>
                  {['Company', 'Trade', 'Contract', 'Status', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                </div>
                {contracts.map(c => (
                  <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 80px', gap: '10px', padding: '12px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{c.company_name || c.sub_name || '—'}</span>
                    <span style={{ fontSize: '13px', color: '#aaa' }}>{c.trade || '—'}</span>
                    <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(c.contract_value)}</span>
                    <span style={s.badge(c.status === 'active' ? 'green' : c.status === 'pending' ? 'orange' : 'gray')}>{c.status || 'active'}</span>
                    <span />
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 0', borderTop: '1px solid #1a1a1a', marginTop: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>Total: ${fmt(committedTotal)}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── CHANGE ORDERS ── */}
        {activeTab === 'changeorders' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={s.statCard}><div style={s.statLabel}>Pending COs</div><div style={s.statValue('#e8590c')}>{changeOrders.filter(c => c.status === 'pending').length}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Approved COs</div><div style={s.statValue('#4ade80')}>${fmt(approvedCOs)}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Revised Contract</div><div style={s.statValue()}>${fmt(baseContract)}</div></div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Change Orders ({changeOrders.length})</p>
                <button style={s.btnSm} onClick={() => setShowAddCO(v => !v)}>{showAddCO ? 'Cancel' : '+ Add CO'}</button>
              </div>

              {showAddCO && (
                <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                  <div style={{ ...s.grid2, marginBottom: '10px' }}>
                    <div><label style={s.label}>Description *</label><input style={s.input} placeholder="Additional scope..." value={newCO.description} onChange={e => setNewCO(f => ({ ...f, description: e.target.value }))} autoFocus /></div>
                    <div><label style={s.label}>Amount *</label><input style={s.input} type="number" placeholder="0.00" value={newCO.amount} onChange={e => setNewCO(f => ({ ...f, amount: e.target.value }))} /></div>
                  </div>
                  <div style={{ marginBottom: '10px' }}>
                    <label style={s.label}>Notes</label>
                    <textarea style={{ ...s.textarea, minHeight: '60px' }} value={newCO.notes} onChange={e => setNewCO(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes..." />
                  </div>
                  {coMsg && <div style={s.errMsg}>{coMsg}</div>}
                  <button style={s.btn} onClick={addCO} disabled={addingCO || !newCO.description || !newCO.amount}>{addingCO ? 'Saving...' : 'Submit CO'}</button>
                </div>
              )}

              {changeOrders.length === 0 ? (
                <div style={s.emptyMsg}>No change orders yet.</div>
              ) : (
                changeOrders.map(co => (
                  <div key={co.id} style={{ padding: '14px 0', borderBottom: '1px solid #1a1a1a' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1', marginBottom: '4px' }}>{co.description}</div>
                        {co.notes && <div style={{ fontSize: '12px', color: '#555', marginBottom: '6px' }}>{co.notes}</div>}
                        <div style={{ fontSize: '12px', color: '#444' }}>{co.created_at ? new Date(co.created_at).toLocaleDateString() : ''}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'monospace', color: Number(co.amount) >= 0 ? '#4ade80' : '#f87171' }}>
                          {Number(co.amount) >= 0 ? '+' : ''}${fmt(co.amount)}
                        </span>
                        <span style={s.badge(statusColor[co.status] || 'gray')}>{co.status}</span>
                      </div>
                    </div>
                    {co.status === 'pending' && profile?.role === 'pm' && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <button style={s.btnGreen} onClick={() => updateCOStatus(co.id, 'approved')}>Approve</button>
                        <button style={s.btnRed} onClick={() => updateCOStatus(co.id, 'rejected')}>Reject</button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ── BILLING ── */}
        {activeTab === 'billing' && (
          <>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
              {[['submissions', 'Sub Billing'], ['draws', 'Draw Requests']].map(([id2, label]) => (
                <button key={id2} onClick={() => setBillingBillingTab(id2)} style={{ padding: '7px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${billingBilling === id2 ? '#e8590c' : '#2a2a2a'}`, background: billingBilling === id2 ? '#2a1200' : '#0a0a0a', color: billingBilling === id2 ? '#e8590c' : '#555' }}>{label}</button>
              ))}
            </div>

            {billingBilling === 'submissions' && (
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Sub Billing Submissions ({billingSubmissions.length})</p>
                </div>
                {billingSubmissions.length === 0 ? (
                  <div style={s.emptyMsg}>No billing submissions yet.</div>
                ) : (
                  billingSubmissions.map(b => (
                    <div key={b.id} style={{ padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{b.company_name}</div>
                          <div style={{ fontSize: '12px', color: '#555' }}>{b.billing_period || ''}{b.work_description ? ' · ' + b.work_description : ''}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>${fmt(b.amount_billed)}</div>
                            {b.retainage_held ? <div style={{ fontSize: '11px', color: '#555' }}>-${fmt(b.retainage_held)} retainage</div> : null}
                          </div>
                          <span style={s.badge(statusColor[b.status] || 'gray')}>{b.status}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#555' }}>Approved billing total</span>
                  <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', color: '#4ade80' }}>${fmt(approvedBillingTotal)}</span>
                </div>
              </div>
            )}

            {billingBilling === 'draws' && (
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Draw Requests ({drawRequests.length})</p>
                  <button style={s.btnSm} onClick={() => setShowCreateDraw(v => !v)}>{showCreateDraw ? 'Cancel' : '+ New Draw'}</button>
                </div>

                {showCreateDraw && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={s.label}>Draw title (optional)</label>
                      <input style={s.input} placeholder={`Draw Request ${drawRequests.length + 1}`} value={drawForm.title} onChange={e => setDrawForm(f => ({ ...f, title: e.target.value }))} autoFocus />
                    </div>
                    <button style={s.btn} onClick={createDraw} disabled={creatingDraw}>{creatingDraw ? 'Creating...' : 'Create Draw'}</button>
                  </div>
                )}

                {drawRequests.length === 0 ? (
                  <div style={s.emptyMsg}>No draw requests yet.</div>
                ) : (
                  drawRequests.map(dr => {
                    const drCosts = directCosts.filter(c => c.draw_request_id === dr.id)
                    const drTotal = drCosts.reduce((a, c) => a + Number(c.amount || 0), 0)
                    const isExpanded = expandedDrawId === dr.id
                    const undrawnCosts = directCosts.filter(c => !c.draw_request_id && !c.drawn_application_id)
                    return (
                      <div key={dr.id} style={{ marginBottom: '12px', border: '1px solid #1e1e1e', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', cursor: 'pointer' }} onClick={() => setExpandedDrawId(isExpanded ? null : dr.id)}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{dr.title}</div>
                            <div style={{ fontSize: '12px', color: '#555' }}>{drCosts.length} costs · ${fmt(drTotal)}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <span style={s.badge(dr.status === 'open' ? 'orange' : 'gray')}>{dr.status}</span>
                            {profile?.role === 'pm' && (
                              <>
                                {dr.status === 'open'
                                  ? <button style={s.btnSmGray} onClick={e => { e.stopPropagation(); updateDrawStatus(dr.id, 'closed') }}>Close</button>
                                  : <button style={s.btnSmGray} onClick={e => { e.stopPropagation(); updateDrawStatus(dr.id, 'open') }}>Reopen</button>}
                                <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={e => { e.stopPropagation(); deleteDraw(dr.id) }}>Delete</button>
                              </>
                            )}
                            <span style={{ color: '#555' }}>{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div style={{ padding: '0 14px 14px', borderTop: '1px solid #1a1a1a' }}>
                            <p style={{ ...s.cardTitle, marginTop: '12px' }}>Included costs</p>
                            {drCosts.length === 0 ? <div style={{ fontSize: '13px', color: '#444', marginBottom: '10px' }}>No costs added to this draw.</div> : drCosts.map(c => (
                              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #111' }}>
                                <span style={{ fontSize: '13px', color: '#aaa' }}>{c.description}</span>
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                  <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(c.amount)}</span>
                                  {dr.status === 'open' && <button style={{ ...s.btnSmGray, fontSize: '11px' }} onClick={() => removeCostFromDraw(c.id)}>Remove</button>}
                                </div>
                              </div>
                            ))}

                            {dr.status === 'open' && undrawnCosts.length > 0 && (
                              <>
                                <p style={{ ...s.cardTitle, marginTop: '14px' }}>Add direct costs</p>
                                {undrawnCosts.map(c => (
                                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={drawAddCostIds.includes(c.id)} onChange={e => setDrawAddCostIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(x => x !== c.id))} />
                                    <span style={{ fontSize: '13px', color: '#aaa' }}>{c.description}</span>
                                    <span style={{ fontSize: '13px', fontFamily: 'monospace', marginLeft: 'auto' }}>${fmt(c.amount)}</span>
                                  </label>
                                ))}
                                <button style={{ ...s.btnGreen, marginTop: '10px' }} onClick={() => saveDrawCosts(dr.id)} disabled={savingDrawCosts || drawAddCostIds.length === 0}>
                                  {savingDrawCosts ? 'Saving...' : `Add ${drawAddCostIds.length} cost${drawAddCostIds.length !== 1 ? 's' : ''}`}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </>
        )}

        {/* ── SCHEDULE ── */}
        {activeTab === 'schedule' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Milestones ({milestones.length})</p>
              <button style={s.btnSm} onClick={() => setShowAddMilestone(v => !v)}>{showAddMilestone ? 'Cancel' : '+ Add Milestone'}</button>
            </div>

            {showAddMilestone && (
              <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                <div style={{ ...s.grid3, marginBottom: '10px' }}>
                  <div><label style={s.label}>Milestone *</label><input style={s.input} placeholder="Demo complete, Framing..." value={newMilestone.title} onChange={e => setNewMilestone(f => ({ ...f, title: e.target.value }))} autoFocus /></div>
                  <div><label style={s.label}>Planned date</label><input style={s.input} type="date" value={newMilestone.planned_date} onChange={e => setNewMilestone(f => ({ ...f, planned_date: e.target.value }))} /></div>
                  <div><label style={s.label}>Status</label>
                    <select style={s.select} value={newMilestone.status} onChange={e => setNewMilestone(f => ({ ...f, status: e.target.value }))}>
                      <option value="planned">Planned</option>
                      <option value="in-progress">In Progress</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                </div>
                <button style={s.btn} onClick={addMilestone} disabled={addingMilestone || !newMilestone.title}>{addingMilestone ? 'Adding...' : 'Add Milestone'}</button>
              </div>
            )}

            {milestones.length === 0 ? (
              <div style={s.emptyMsg}>No milestones yet. Add project milestones to track schedule.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 100px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #222' }}>
                  {['Milestone', 'Planned', 'Actual', 'Status', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                </div>
                {milestones.map(m => (
                  <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 100px', gap: '10px', padding: '10px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{m.title}</span>
                    <span style={{ fontSize: '12px', color: '#aaa' }}>{fmtDate(m.planned_date)}</span>
                    <span style={{ fontSize: '12px', color: m.actual_date ? '#4ade80' : '#444' }}>{fmtDate(m.actual_date)}</span>
                    <span style={s.badge(statusColor[m.status] || 'gray')}>{m.status}</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {m.status !== 'done' && <button style={s.btnGreen} onClick={() => updateMilestoneStatus(m.id, 'done')}>Done</button>}
                      {m.status === 'done' && <button style={s.btnSmGray} onClick={() => updateMilestoneStatus(m.id, 'planned')}>Reset</button>}
                      <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => deleteMilestone(m.id)}>×</button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── PHOTOS ── */}
        {activeTab === 'photos' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Photos ({photos.length})</p>
              <div>
                <input type="file" ref={photoInputRef} accept="image/*" style={{ display: 'none' }} onChange={uploadPhoto} />
                <button style={s.btnSm} onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>{uploadingPhoto ? 'Uploading...' : '+ Upload Photo'}</button>
              </div>
            </div>

            {photos.length === 0 ? (
              <div style={s.emptyMsg}>No photos yet.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                {photos.map(p => (
                  <div key={p.id} style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #1e1e1e' }}>
                    <img src={p.url} alt={p.caption || 'Photo'} style={{ width: '100%', height: '140px', objectFit: 'cover', display: 'block' }} />
                    {p.caption && <div style={{ padding: '6px 10px', fontSize: '11px', color: '#555', background: '#0a0a0a' }}>{p.caption}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {activeTab === 'documents' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Documents ({documents.length})</p>
              <div>
                <input type="file" ref={docInputRef} style={{ display: 'none' }} onChange={uploadDoc} />
                <button style={s.btnSm} onClick={() => docInputRef.current?.click()} disabled={uploadingDoc}>{uploadingDoc ? 'Uploading...' : '+ Upload Doc'}</button>
              </div>
            </div>

            {documents.length === 0 ? (
              <div style={s.emptyMsg}>No documents yet. Upload contracts, permits, or other project docs.</div>
            ) : (
              documents.map(doc => (
                <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <div>
                    <div style={{ fontSize: '13px', color: '#f1f1f1' }}>{doc.name}</div>
                    <div style={{ fontSize: '11px', color: '#555' }}>{doc.doc_type || 'general'}{doc.created_at ? ' · ' + new Date(doc.created_at).toLocaleDateString() : ''}</div>
                  </div>
                  <a href={doc.url} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: '#60a5fa', textDecoration: 'none' }}>View →</a>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── CONTACTS ── */}
        {activeTab === 'contacts' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Contacts ({contacts.length})</p>
              <button style={s.btnSm} onClick={() => setShowAddContact(v => !v)}>{showAddContact ? 'Cancel' : '+ Add Contact'}</button>
            </div>

            {showAddContact && (
              <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                <div style={{ ...s.grid3, marginBottom: '10px' }}>
                  <div><label style={s.label}>Name *</label><input style={s.input} value={newContact.name} onChange={e => setNewContact(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
                  <div><label style={s.label}>Role</label><input style={s.input} placeholder="Architect, Inspector..." value={newContact.role} onChange={e => setNewContact(f => ({ ...f, role: e.target.value }))} /></div>
                  <div><label style={s.label}>Company</label><input style={s.input} value={newContact.company} onChange={e => setNewContact(f => ({ ...f, company: e.target.value }))} /></div>
                </div>
                <div style={{ ...s.grid3, marginBottom: '10px' }}>
                  <div><label style={s.label}>Phone</label><input style={s.input} value={newContact.phone} onChange={e => setNewContact(f => ({ ...f, phone: e.target.value }))} /></div>
                  <div><label style={s.label}>Email</label><input style={s.input} type="email" value={newContact.email} onChange={e => setNewContact(f => ({ ...f, email: e.target.value }))} /></div>
                  <div><label style={s.label}>Notes</label><input style={s.input} value={newContact.notes} onChange={e => setNewContact(f => ({ ...f, notes: e.target.value }))} /></div>
                </div>
                <button style={s.btn} onClick={addContact} disabled={addingContact || !newContact.name}>{addingContact ? 'Adding...' : 'Add Contact'}</button>
              </div>
            )}

            {contacts.length === 0 ? (
              <div style={s.emptyMsg}>No contacts yet. Add the owner, architect, inspector, or other key contacts.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 40px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #222' }}>
                  {['Name', 'Role', 'Phone', 'Email', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                </div>
                {contacts.map(c => (
                  <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 40px', gap: '10px', padding: '10px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', color: '#f1f1f1' }}>{c.name}</div>
                      {c.company && <div style={{ fontSize: '11px', color: '#555' }}>{c.company}</div>}
                    </div>
                    <span style={{ fontSize: '12px', color: '#aaa' }}>{c.role || '—'}</span>
                    <span style={{ fontSize: '12px', color: '#aaa' }}>{c.phone || '—'}</span>
                    <span style={{ fontSize: '12px', color: '#aaa' }}>{c.email || '—'}</span>
                    <button style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '16px' }} onClick={() => deleteContact(c.id)}>×</button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
