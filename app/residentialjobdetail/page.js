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
  { id: 'costs',        label: 'Costs' },
  { id: 'subs',         label: 'Subs' },
  { id: 'changeorders', label: 'Change Orders' },
  { id: 'billing',      label: 'Billing' },
  { id: 'ownerdraw',    label: 'Owner/Lender Draw' },
  { id: 'inspections',  label: 'Inspections' },
  { id: 'lienWaivers',  label: 'Lien Waivers' },
  { id: 'punchlist',    label: 'Punch List' },
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
  const [newBudget, setNewBudget] = useState({ description: '', budget_amount: '', cost_code: '', notes: '' })
  const [addingBudget, setAddingBudget] = useState(false)
  const [editingBudgetId, setEditingBudgetId] = useState(null)
  const [editBudgetForm, setEditBudgetForm] = useState({})
  const [directCosts, setDirectCosts] = useState([])

  // Subs
  const [contracts, setContracts] = useState([])
  const [subDirectory, setSubDirectory] = useState([])
  const [showAddSubForm, setShowAddSubForm] = useState(false)
  const [newSubForm, setNewSubForm] = useState({ dir_id: '', company_name: '', trade: '', contract_value: '', budget_item_id: '' })
  const [addingSub, setAddingSub] = useState(false)
  const [subMsg, setSubMsg] = useState('')
  const [editingSubId, setEditingSubId] = useState(null)
  const [editSubForm, setEditSubForm] = useState({})

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
  const [showBillingForm, setShowBillingForm] = useState(false)
  const [billingForm, setBillingForm] = useState({ company_name: '', sub_id: '', amount_billed: '', retainage_pct: '10', work_description: '', billing_period: '' })
  const [addingBilling, setAddingBilling] = useState(false)
  const [billingMsg, setBillingMsg] = useState('')

  // Schedule (milestones)
  const [milestones, setMilestones] = useState([])
  const [showAddMilestone, setShowAddMilestone] = useState(false)
  const [newMilestone, setNewMilestone] = useState({ title: '', planned_date: '', status: 'planned', notes: '' })
  const [addingMilestone, setAddingMilestone] = useState(false)

  // Photos
  const [photos, setPhotos] = useState([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef(null)

  // Direct costs tab
  const [showDcForm, setShowDcForm] = useState(false)
  const [dcForm, setDcForm] = useState({ cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', notes: '', budget_item_id: '' })
  const [dcFile, setDcFile] = useState(null)
  const [submittingDc, setSubmittingDc] = useState(false)
  const [dcSearch, setDcSearch] = useState('')
  const [dcStatusFilter, setDcStatusFilter] = useState('all')
  const [updatingCostId, setUpdatingCostId] = useState(null)
  const [rejectingCostId, setRejectingCostId] = useState(null)
  const [costRejectNote, setCostRejectNote] = useState('')

  // Documents
  const [documents, setDocuments] = useState([])
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const docInputRef = useRef(null)

  // Estimate import
  const [showImportEstimate, setShowImportEstimate] = useState(false)
  const [parsedItems, setParsedItems] = useState([])
  const [selectedImportIds, setSelectedImportIds] = useState(new Set())
  const [parsingEstimate, setParsingEstimate] = useState(false)
  const [importingItems, setImportingItems] = useState(false)
  const [parseMsg, setParseMsg] = useState('')
  const estimateInputRef = useRef(null)

  // Inspections
  const [inspections, setInspections] = useState([])
  const [showAddInspection, setShowAddInspection] = useState(false)
  const [newInspection, setNewInspection] = useState({ inspection_type: 'Framing', scheduled_date: '', inspector_name: '', result: 'pending', notes: '' })
  const [addingInspection, setAddingInspection] = useState(false)

  // Lien Waivers
  const [lienWaivers, setLienWaivers] = useState([])
  const [showAddWaiver, setShowAddWaiver] = useState(false)
  const [newWaiver, setNewWaiver] = useState({ company_name: '', subcontract_id: '', waiver_type: 'conditional', amount: '', payment_date: '', waiver_date: '', status: 'pending', notes: '' })
  const [addingWaiver, setAddingWaiver] = useState(false)

  // Owner Draw
  const [ownerDraws, setOwnerDraws] = useState([])
  const [showAddOwnerDraw, setShowAddOwnerDraw] = useState(false)
  const [newOwnerDraw, setNewOwnerDraw] = useState({ title: '', period_start: '', period_end: '', amount_requested: '', notes: '' })
  const [addingOwnerDraw, setAddingOwnerDraw] = useState(false)

  // Punch List
  const [punchList, setPunchList] = useState([])
  const [showAddPunch, setShowAddPunch] = useState(false)
  const [newPunch, setNewPunch] = useState({ description: '', assigned_to: '', subcontract_id: '', due_date: '', status: 'open', notes: '' })
  const [addingPunch, setAddingPunch] = useState(false)

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
      loadSubDirectory(),
      loadChangeOrders(),
      loadBillingSubmissions(),
      loadDrawRequests(),
      loadMilestones(),
      loadPhotos(),
      loadDocuments(),
      loadContacts(),
      loadDirectCosts(),
      loadInspections(),
      loadLienWaivers(),
      loadOwnerDraws(),
      loadPunchList(),
    ])
    setLoading(false)
  }

  async function loadBudget() {
    const { data } = await supabase.from('budget_items').select('*').eq('job_id', id).order('cost_code')
    setBudgetItems(data || [])
  }

  async function loadContracts() {
    const { data } = await supabase.from('subcontracts').select('*').eq('job_id', id).order('created_at')
    setContracts(data || [])
  }

  async function loadSubDirectory() {
    const { data } = await supabase.from('sub_directory').select('*').eq('status', 'approved').order('company_name')
    setSubDirectory(data || [])
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

  async function loadInspections() {
    const { data } = await supabase.from('res_inspections').select('*').eq('job_id', id).order('scheduled_date')
    setInspections(data || [])
  }

  async function loadLienWaivers() {
    const { data } = await supabase.from('res_lien_waivers').select('*').eq('job_id', id).order('created_at', { ascending: false })
    setLienWaivers(data || [])
  }

  async function loadOwnerDraws() {
    const { data } = await supabase.from('res_owner_draws').select('*').eq('job_id', id).order('draw_number')
    setOwnerDraws(data || [])
  }

  async function loadPunchList() {
    const { data } = await supabase.from('res_punch_list').select('*').eq('job_id', id).order('created_at', { ascending: false })
    setPunchList(data || [])
  }

  async function loadDirectCosts() {
    const res = await fetch(`/api/direct-costs?job_id=${id}`)
    const json = await res.json()
    setDirectCosts(json.data || [])
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
    if (!newBudget.description || !newBudget.budget_amount) return
    setAddingBudget(true)
    await supabase.from('budget_items').insert({ job_id: id, description: newBudget.description, budget_amount: parseFloat(newBudget.budget_amount), cost_code: newBudget.cost_code || null, notes: newBudget.notes || null })
    await loadBudget()
    setNewBudget({ description: '', budget_amount: '', cost_code: '', notes: '' })
    setShowAddBudget(false)
    setAddingBudget(false)
  }

  async function saveBudgetEdit(itemId) {
    await supabase.from('budget_items').update({ description: editBudgetForm.description, budget_amount: parseFloat(editBudgetForm.budget_amount) || 0, cost_code: editBudgetForm.cost_code || null }).eq('id', itemId)
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

  async function addSub(e) {
    e.preventDefault()
    setAddingSub(true)
    setSubMsg('')
    const dirEntry = newSubForm.dir_id ? subDirectory.find(d => d.id === newSubForm.dir_id) : null
    const company_name = dirEntry?.company_name || newSubForm.company_name
    if (!company_name) { setSubMsg('Company name required'); setAddingSub(false); return }
    const res = await fetch('/api/subcontracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: id,
        vendor_name: company_name,
        description: dirEntry?.trade || newSubForm.trade || null,
        contract_value: parseFloat(newSubForm.contract_value) || 0,
        budget_item_id: newSubForm.budget_item_id || null,
        status: 'active',
        created_by: profile?.id || null,
      }),
    })
    const result = await res.json()
    if (result.error) { setSubMsg('Error: ' + result.error); setAddingSub(false); return }
    setNewSubForm({ dir_id: '', company_name: '', trade: '', contract_value: '', budget_item_id: '' })
    setShowAddSubForm(false)
    await loadContracts()
    setAddingSub(false)
  }

  async function saveSubEdit(contractId) {
    const res = await fetch('/api/subcontracts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: contractId, vendor_name: editSubForm.vendor_name, description: editSubForm.description, contract_value: parseFloat(editSubForm.contract_value) || 0, budget_item_id: editSubForm.budget_item_id || null }),
    })
    const data = await res.json()
    if (data.error) { setSubMsg('Error: ' + data.error); return }
    setEditingSubId(null)
    setSubMsg('')
    await loadContracts()
  }

  async function deleteSubcontract(contractId) {
    if (!confirm('Remove this subcontractor?')) return
    await fetch('/api/subcontracts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: contractId }) })
    await loadContracts()
  }

  async function createDraw() {
    if (creatingDraw) return
    setCreatingDraw(true)
    const title = drawForm.title || `Draw Request ${drawRequests.length + 1}`
    const res = await fetch('/api/draw-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id, title, dc_ids: [], po_ids: [], gc_ids: [] }) })
    if (!res.ok) { const j = await res.json(); alert(j.error || 'Failed to create draw'); setCreatingDraw(false); return }
    await loadDrawRequests()
    setDrawForm({ title: '' })
    setShowCreateDraw(false)
    setCreatingDraw(false)
  }

  async function updateDrawStatus(drawId, status) {
    const res = await fetch('/api/draw-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: drawId, status }) })
    if (!res.ok) { const j = await res.json(); alert(j.error || 'Failed to update draw'); return }
    await loadDrawRequests()
  }

  async function deleteDraw(drawId) {
    if (!confirm('Delete this draw request?')) return
    const res = await fetch(`/api/draw-requests?id=${drawId}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json(); alert(j.error || 'Failed to delete draw'); return }
    await loadDrawRequests()
  }

  async function submitBilling() {
    if (!billingForm.amount_billed || (!billingForm.sub_id && !billingForm.company_name)) return
    setAddingBilling(true)
    setBillingMsg('')
    const amount = parseFloat(billingForm.amount_billed) || 0
    const pct = parseFloat(billingForm.retainage_pct) || 0
    const retainage_held = pct > 0 ? +(amount * pct / 100).toFixed(2) : 0
    const body = {
      job_id: id,
      sub_id: billingForm.sub_id || null,
      company_name: billingForm.company_name || '',
      amount_billed: amount,
      retainage_held: retainage_held || null,
      retainage_pct: pct || null,
      work_description: billingForm.work_description || null,
      billing_period: billingForm.billing_period ? billingForm.billing_period + '-01' : null,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    }
    const res = await fetch('/api/billing-entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await res.json()
    if (result.error) { setBillingMsg('Error: ' + result.error); setAddingBilling(false); return }
    setBillingForm({ company_name: '', sub_id: '', amount_billed: '', retainage_pct: '10', work_description: '', billing_period: '' })
    setShowBillingForm(false)
    await loadBillingSubmissions()
    setAddingBilling(false)
  }

  async function updateBillingStatus(billingId, status) {
    const res = await fetch('/api/billing-entry', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: billingId, status }) })
    const result = await res.json()
    if (result.error) { alert('Error: ' + result.error); return }
    await loadBillingSubmissions()
  }

  async function deleteBilling(billingId) {
    if (!confirm('Delete this billing submission?')) return
    const res = await fetch('/api/billing-entry', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: billingId }) })
    const result = await res.json()
    if (result.error) { alert('Error: ' + result.error); return }
    await loadBillingSubmissions()
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
    try {
      const path = `${id}/${Date.now()}_${file.name}`
      const urlRes = await fetch('/api/job-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upload-url-residential', path }),
      })
      const { signedUrl, publicUrl, error: urlErr } = await urlRes.json()
      if (urlErr || !signedUrl) throw new Error(urlErr || 'Could not get upload URL')
      const up = await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
      if (!up.ok) throw new Error('File upload failed')
      const insertRes = await fetch('/api/job-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insert-doc', job_id: id, url: publicUrl, name: file.name, doc_type: 'general' }),
      })
      const insertData = await insertRes.json()
      if (insertData.error) throw new Error(insertData.error)
      await loadDocuments()
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
    setUploadingDoc(false)
    if (docInputRef.current) docInputRef.current.value = ''
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

  async function submitDC(e) {
    e.preventDefault()
    setSubmittingDc(true)
    const { data: { session } } = await supabase.auth.getSession()
    const rowData = {
      job_id: id,
      submitted_by: session.user.id,
      cost_date: dcForm.cost_date,
      description: dcForm.description,
      category: dcForm.category,
      amount: parseFloat(dcForm.amount),
      notes: dcForm.notes || null,
      budget_item_id: dcForm.budget_item_id || null,
      status: 'approved',
    }
    let res, json
    if (dcFile) {
      const fd = new FormData()
      fd.append('file', dcFile)
      fd.append('data', JSON.stringify(rowData))
      res = await fetch('/api/direct-costs', { method: 'POST', body: fd })
    } else {
      res = await fetch('/api/direct-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rowData) })
    }
    json = await res.json()
    if (!json.error) {
      setDcForm({ cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', notes: '', budget_item_id: '' })
      setDcFile(null)
      setShowDcForm(false)
      await loadDirectCosts()
    }
    setSubmittingDc(false)
  }

  async function updateDCStatus(costId, status) {
    setUpdatingCostId(costId)
    if (status === 'deleted') {
      await fetch('/api/direct-costs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: costId }) })
    } else {
      await fetch('/api/direct-costs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: costId, status, reject_notes: costRejectNote || null }) })
    }
    setRejectingCostId(null)
    setCostRejectNote('')
    await loadDirectCosts()
    setUpdatingCostId(null)
  }

  async function assignDCBudgetItem(costId, budgetItemId) {
    await fetch('/api/direct-costs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: costId, budget_item_id: budgetItemId || null }) })
    await loadDirectCosts()
  }

  function exportDCsCSV() {
    const rows = [['Date', 'Description', 'Category', 'Amount', 'Budget Line', 'Status', 'Notes']]
    directCosts.forEach(c => {
      const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)?.description || ''
      rows.push([c.cost_date, c.description, c.category, c.amount, budgetLine, c.status, c.notes || ''])
    })
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `direct-costs-${job.job_number}.csv` })
    a.click()
  }

  async function openDCReceipt(path) {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // ── Inspections ──
  async function addInspection() {
    if (!newInspection.inspection_type) return
    setAddingInspection(true)
    await supabase.from('res_inspections').insert({ job_id: id, inspection_type: newInspection.inspection_type, scheduled_date: newInspection.scheduled_date || null, inspector_name: newInspection.inspector_name || null, result: newInspection.result, notes: newInspection.notes || null })
    await loadInspections()
    setNewInspection({ inspection_type: 'Framing', scheduled_date: '', inspector_name: '', result: 'pending', notes: '' })
    setShowAddInspection(false)
    setAddingInspection(false)
  }

  async function updateInspectionResult(inspectionId, result) {
    await supabase.from('res_inspections').update({ result, actual_date: result !== 'pending' ? new Date().toISOString().slice(0, 10) : null }).eq('id', inspectionId)
    await loadInspections()
  }

  async function deleteInspection(inspectionId) {
    if (!confirm('Delete this inspection?')) return
    await supabase.from('res_inspections').delete().eq('id', inspectionId)
    await loadInspections()
  }

  // ── Lien Waivers ──
  async function addLienWaiver() {
    if (!newWaiver.company_name) return
    setAddingWaiver(true)
    await supabase.from('res_lien_waivers').insert({ job_id: id, company_name: newWaiver.company_name, subcontract_id: newWaiver.subcontract_id || null, waiver_type: newWaiver.waiver_type, amount: parseFloat(newWaiver.amount) || null, payment_date: newWaiver.payment_date || null, waiver_date: newWaiver.waiver_date || null, status: newWaiver.status, notes: newWaiver.notes || null })
    await loadLienWaivers()
    setNewWaiver({ company_name: '', subcontract_id: '', waiver_type: 'conditional', amount: '', payment_date: '', waiver_date: '', status: 'pending', notes: '' })
    setShowAddWaiver(false)
    setAddingWaiver(false)
  }

  async function updateWaiverStatus(waiverId, status) {
    const update = { status }
    if (status === 'received') update.waiver_date = new Date().toISOString().slice(0, 10)
    await supabase.from('res_lien_waivers').update(update).eq('id', waiverId)
    await loadLienWaivers()
  }

  async function deleteWaiver(waiverId) {
    if (!confirm('Delete this waiver record?')) return
    await supabase.from('res_lien_waivers').delete().eq('id', waiverId)
    await loadLienWaivers()
  }

  // ── Owner Draw ──
  async function addOwnerDraw() {
    if (!newOwnerDraw.amount_requested) return
    setAddingOwnerDraw(true)
    const drawNum = (ownerDraws.length > 0 ? Math.max(...ownerDraws.map(d => d.draw_number || 0)) : 0) + 1
    await supabase.from('res_owner_draws').insert({ job_id: id, draw_number: drawNum, title: newOwnerDraw.title || `Draw #${drawNum}`, period_start: newOwnerDraw.period_start || null, period_end: newOwnerDraw.period_end || null, amount_requested: parseFloat(newOwnerDraw.amount_requested), status: 'draft', notes: newOwnerDraw.notes || null })
    await loadOwnerDraws()
    setNewOwnerDraw({ title: '', period_start: '', period_end: '', amount_requested: '', notes: '' })
    setShowAddOwnerDraw(false)
    setAddingOwnerDraw(false)
  }

  async function updateOwnerDrawStatus(drawId, status) {
    const update = { status }
    if (status === 'submitted') update.submitted_date = new Date().toISOString().slice(0, 10)
    if (status === 'funded') update.funded_date = new Date().toISOString().slice(0, 10)
    await supabase.from('res_owner_draws').update(update).eq('id', drawId)
    await loadOwnerDraws()
  }

  async function deleteOwnerDraw(drawId) {
    if (!confirm('Delete this draw request?')) return
    await supabase.from('res_owner_draws').delete().eq('id', drawId)
    await loadOwnerDraws()
  }

  // ── Punch List ──
  async function addPunchItem() {
    if (!newPunch.description) return
    setAddingPunch(true)
    const dirEntry = newPunch.subcontract_id ? contracts.find(c => c.id === newPunch.subcontract_id) : null
    await supabase.from('res_punch_list').insert({ job_id: id, description: newPunch.description, assigned_to: dirEntry?.vendor_name || newPunch.assigned_to || null, subcontract_id: newPunch.subcontract_id || null, due_date: newPunch.due_date || null, status: 'open', notes: newPunch.notes || null })
    await loadPunchList()
    setNewPunch({ description: '', assigned_to: '', subcontract_id: '', due_date: '', status: 'open', notes: '' })
    setShowAddPunch(false)
    setAddingPunch(false)
  }

  async function updatePunchStatus(itemId, status) {
    await supabase.from('res_punch_list').update({ status, completed_date: status === 'done' ? new Date().toISOString().slice(0, 10) : null }).eq('id', itemId)
    await loadPunchList()
  }

  async function deletePunchItem(itemId) {
    if (!confirm('Delete this punch list item?')) return
    await supabase.from('res_punch_list').delete().eq('id', itemId)
    await loadPunchList()
  }

  async function parseEstimate(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setParsingEstimate(true)
    setParseMsg('Parsing estimate…')
    setParsedItems([])
    setSelectedImportIds(new Set())
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/parse-estimate', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) {
        setParseMsg('Error: ' + (data.error || 'Parse failed'))
      } else {
        setParsedItems(data.items || [])
        setSelectedImportIds(new Set((data.items || []).map((_, i) => i)))
        setParseMsg(`Found ${(data.items || []).length} line items — review and import below`)
      }
    } catch (err) {
      setParseMsg('Error: ' + err.message)
    }
    setParsingEstimate(false)
    e.target.value = ''
  }

  async function importSelectedItems() {
    if (selectedImportIds.size === 0) return
    setImportingItems(true)
    setParseMsg('')
    const toInsert = parsedItems
      .filter((_, i) => selectedImportIds.has(i))
      .map(item => ({
        job_id: id,
        description: item.description,
        budget_amount: parseFloat(item.amount) || 0,
        cost_code: item.section || null,
      }))
    try {
      const res = await fetch('/api/budget-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toInsert),
      })
      const data = await res.json()
      if (!res.ok) {
        setParseMsg('Import failed: ' + (data.error || 'Unknown error'))
        setImportingItems(false)
        return
      }
      await loadBudget()
      setParsedItems([])
      setSelectedImportIds(new Set())
      setShowImportEstimate(false)
      setParseMsg('')
    } catch (err) {
      setParseMsg('Import failed: ' + err.message)
    }
    setImportingItems(false)
  }

  if (loading) return <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><div style={{ color: '#555' }}>Loading...</div></div>
  if (!job) return <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><div style={{ color: '#555' }}>Project not found.</div></div>

  const approvedCOs = changeOrders.filter(c => c.status === 'approved').reduce((a, c) => a + Number(c.amount), 0)
  const baseContract = Number(job.contract_value || 0)
  const budgetTotal = budgetItems.reduce((a, b) => a + Number(b.budget_amount || 0), 0)
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
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="file" ref={estimateInputRef} accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={parseEstimate} />
                  <button style={s.btnSmGray} onClick={() => { setShowImportEstimate(v => !v); if (showImportEstimate) { setParsedItems([]); setParseMsg('') } }}>
                    {showImportEstimate ? 'Cancel Import' : '↑ Import Estimate'}
                  </button>
                  <button style={s.btnSm} onClick={() => setShowAddBudget(v => !v)}>{showAddBudget ? 'Cancel' : '+ Add Line'}</button>
                </div>
              </div>

              {showImportEstimate && (
                <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                  {parsedItems.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
                      <p style={{ margin: 0, fontSize: '13px', color: '#aaa', lineHeight: '1.5' }}>
                        Upload your PDF estimate sheet and AI will extract all line items for you to review before importing.
                      </p>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button style={s.btn} onClick={() => estimateInputRef.current?.click()} disabled={parsingEstimate}>
                          {parsingEstimate ? 'Parsing…' : 'Upload Estimate PDF'}
                        </button>
                        {parseMsg && <span style={parseMsg.startsWith('Error') ? s.errMsg : s.successMsg}>{parseMsg}</span>}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', color: '#aaa' }}>{selectedImportIds.size} of {parsedItems.length} selected</span>
                          <button style={s.btnSmGray} onClick={() => setSelectedImportIds(new Set(parsedItems.map((_, i) => i)))}>All</button>
                          <button style={s.btnSmGray} onClick={() => setSelectedImportIds(new Set())}>None</button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {parseMsg && <span style={s.successMsg}>{parseMsg.split('—')[0]}</span>}
                          <button style={s.btn} onClick={importSelectedItems} disabled={importingItems || selectedImportIds.size === 0}>
                            {importingItems ? 'Importing…' : `Import ${selectedImportIds.size} Line${selectedImportIds.size !== 1 ? 's' : ''}`}
                          </button>
                          <button style={s.btnGray} onClick={() => { setParsedItems([]); setSelectedImportIds(new Set()); setParseMsg(''); estimateInputRef.current && (estimateInputRef.current.value = '') }}>Re-upload</button>
                        </div>
                      </div>
                      <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '28px 3fr 1fr 1fr', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #222', position: 'sticky', top: 0, background: '#0a0a0a' }}>
                          {['', 'Description', 'Section', 'Amount'].map(h => <div key={h} style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                        </div>
                        {parsedItems.map((item, i) => (
                          <label key={i} style={{ display: 'grid', gridTemplateColumns: '28px 3fr 1fr 1fr', gap: '10px', padding: '8px 0', borderBottom: '1px solid #111', alignItems: 'center', cursor: 'pointer' }}>
                            <input type="checkbox" checked={selectedImportIds.has(i)} onChange={e => {
                              setSelectedImportIds(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(i); else next.delete(i)
                                return next
                              })
                            }} />
                            <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{item.description}</span>
                            <span style={{ fontSize: '11px', color: '#555' }}>{item.section || '—'}</span>
                            <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(item.amount)}</span>
                          </label>
                        ))}
                        <div style={{ display: 'grid', gridTemplateColumns: '28px 3fr 1fr 1fr', gap: '10px', padding: '10px 0', marginTop: '4px', borderTop: '1px solid #222' }}>
                          <span />
                          <span style={{ fontSize: '12px', fontWeight: '700', color: '#555', textTransform: 'uppercase' }}>Selected total</span>
                          <span />
                          <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>
                            ${fmt(parsedItems.filter((_, i) => selectedImportIds.has(i)).reduce((a, x) => a + Number(x.amount || 0), 0))}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {showAddBudget && (
                <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                  <div style={{ ...s.grid3, marginBottom: '10px' }}>
                    <div><label style={s.label}>Description *</label><input style={s.input} placeholder="Framing, Electrical..." value={newBudget.description} onChange={e => setNewBudget(f => ({ ...f, description: e.target.value }))} autoFocus /></div>
                    <div><label style={s.label}>Budgeted Amount *</label><input style={s.input} type="number" placeholder="0.00" value={newBudget.budget_amount} onChange={e => setNewBudget(f => ({ ...f, budget_amount: e.target.value }))} /></div>
                    <div><label style={s.label}>Cost Code</label><input style={s.input} placeholder="03-000 (optional)" value={newBudget.cost_code} onChange={e => setNewBudget(f => ({ ...f, cost_code: e.target.value }))} /></div>
                  </div>
                  <button style={s.btn} onClick={addBudgetItem} disabled={addingBudget || !newBudget.description || !newBudget.budget_amount}>{addingBudget ? 'Adding...' : 'Add Budget Line'}</button>
                </div>
              )}

              {budgetItems.length === 0 ? (
                <div style={s.emptyMsg}>No budget lines yet.</div>
              ) : (
                <>
                  <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 1fr 80px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #222', minWidth: '700px' }}>
                    {['Description', 'Code', 'Budget', 'Committed', 'Spent', 'Variance', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                  </div>
                  {budgetItems.map(item => {
                    const committed = contracts.filter(c => c.budget_item_id === item.id).reduce((a, c) => a + Number(c.contract_value || 0), 0)
                    const spent = directCosts.filter(c => c.status === 'approved' && c.budget_item_id === item.id).reduce((a, c) => a + Number(c.amount || 0), 0)
                    const budgeted = Number(item.budget_amount || 0)
                    const variance = budgeted - committed - spent
                    const over = variance < 0
                    return editingBudgetId === item.id ? (
                      <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 1fr 80px', gap: '10px', padding: '8px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center', minWidth: '700px' }}>
                        <input style={{ ...s.input, fontSize: '12px' }} value={editBudgetForm.description || ''} onChange={e => setEditBudgetForm(f => ({ ...f, description: e.target.value }))} />
                        <input style={{ ...s.input, fontSize: '12px' }} value={editBudgetForm.cost_code || ''} onChange={e => setEditBudgetForm(f => ({ ...f, cost_code: e.target.value }))} />
                        <input style={{ ...s.input, fontSize: '12px' }} type="number" value={editBudgetForm.budget_amount || ''} onChange={e => setEditBudgetForm(f => ({ ...f, budget_amount: e.target.value }))} />
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: '#60a5fa' }}>${fmt(committed)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: '#e8590c' }}>${fmt(spent)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: over ? '#f87171' : '#4ade80' }}>{over ? '-' : ''}${fmt(Math.abs(variance))}</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnGreen} onClick={() => saveBudgetEdit(item.id)}>Save</button>
                          <button style={s.btnSmGray} onClick={() => setEditingBudgetId(null)}>×</button>
                        </div>
                      </div>
                    ) : (
                      <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 1fr 80px', gap: '10px', padding: '10px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center', minWidth: '700px', background: over ? '#150505' : 'transparent' }}>
                        <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{item.description}</span>
                        <span style={{ fontSize: '12px', color: '#555', fontFamily: 'monospace' }}>{item.cost_code || '—'}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(item.budget_amount)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: committed > 0 ? '#60a5fa' : '#555' }}>${fmt(committed)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: spent > 0 ? '#e8590c' : '#555' }}>${fmt(spent)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: '700', color: over ? '#f87171' : variance < budgeted * 0.1 ? '#f59e0b' : '#4ade80' }}>
                          {over ? '-' : ''}${fmt(Math.abs(variance))}
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmGray} onClick={() => { setEditingBudgetId(item.id); setEditBudgetForm(item) }}>Edit</button>
                          <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => deleteBudgetItem(item.id)}>×</button>
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 1fr 80px', gap: '10px', padding: '10px 0', marginTop: '4px', borderTop: '1px solid #333', minWidth: '700px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#555', textTransform: 'uppercase' }}>Total</span>
                    <span />
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>${fmt(budgetTotal)}</span>
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', color: '#60a5fa' }}>${fmt(committedTotal)}</span>
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', color: '#e8590c' }}>${fmt(directCosts.filter(c => c.status === 'approved' && budgetItems.some(b => b.id === c.budget_item_id)).reduce((a, c) => a + Number(c.amount || 0), 0))}</span>
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', color: (() => { const v = budgetTotal - committedTotal - directCosts.filter(c => c.status === 'approved').reduce((a, c) => a + Number(c.amount || 0), 0); return v < 0 ? '#f87171' : '#4ade80' })() }}>
                      {(() => { const v = budgetTotal - committedTotal - directCosts.filter(c => c.status === 'approved').reduce((a, c) => a + Number(c.amount || 0), 0); return `${v < 0 ? '-' : ''}$${fmt(Math.abs(v))}` })()}
                    </span>
                    <span />
                  </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── COSTS ── */}
        {activeTab === 'costs' && (() => {
          const approvedTotal = directCosts.filter(c => c.status === 'approved').reduce((a, c) => a + Number(c.amount || 0), 0)
          const pendingCount = directCosts.filter(c => c.status === 'pending').length
          const q = dcSearch.toLowerCase().trim()
          const visible = directCosts.filter(c => {
            if (dcStatusFilter !== 'all' && c.status !== dcStatusFilter) return false
            if (!q) return true
            return c.description?.toLowerCase().includes(q) || c.notes?.toLowerCase().includes(q) || String(c.amount).includes(dcSearch.trim())
          })
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div style={s.statCard}><div style={s.statLabel}>Approved Total</div><div style={s.statValue('#4ade80')}>${fmt(approvedTotal)}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Pending Approval</div><div style={s.statValue(pendingCount > 0 ? '#e8590c' : undefined)}>{pendingCount}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Total Entries</div><div style={s.statValue()}>{directCosts.length}</div></div>
              </div>

              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Direct Costs ({directCosts.length})</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {directCosts.length > 0 && <button style={s.btnSmGray} onClick={exportDCsCSV}>Export CSV</button>}
                    <button style={s.btnSm} onClick={() => setShowDcForm(v => !v)}>{showDcForm ? 'Cancel' : '+ Log Cost'}</button>
                  </div>
                </div>

                {showDcForm && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <form onSubmit={submitDC}>
                      <div style={{ ...s.grid3, marginBottom: '12px' }}>
                        <div>
                          <label style={s.label}>Date *</label>
                          <input type="date" style={s.input} required value={dcForm.cost_date} onChange={e => setDcForm(f => ({ ...f, cost_date: e.target.value }))} />
                        </div>
                        <div>
                          <label style={s.label}>Category *</label>
                          <select style={s.select} required value={dcForm.category} onChange={e => setDcForm(f => ({ ...f, category: e.target.value }))}>
                            {['Materials', 'Labor', 'Equipment', 'Subcontractor', 'Permits', 'Fees', 'Meals/Entertainment', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={s.label}>Amount ($) *</label>
                          <input type="number" step="0.01" min="0" style={s.input} required placeholder="0.00" value={dcForm.amount} onChange={e => setDcForm(f => ({ ...f, amount: e.target.value }))} />
                        </div>
                      </div>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div>
                          <label style={s.label}>Description *</label>
                          <input style={s.input} required placeholder="Lumber delivery, Concrete pour..." value={dcForm.description} onChange={e => setDcForm(f => ({ ...f, description: e.target.value }))} />
                        </div>
                        <div>
                          <label style={s.label}>Budget Line</label>
                          <select style={s.select} value={dcForm.budget_item_id} onChange={e => setDcForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                            <option value="">— Unassigned —</option>
                            {budgetItems.map(b => <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div>
                          <label style={s.label}>Notes</label>
                          <input style={s.input} placeholder="Optional notes..." value={dcForm.notes} onChange={e => setDcForm(f => ({ ...f, notes: e.target.value }))} />
                        </div>
                        <div>
                          <label style={s.label}>Receipt (PDF / photo)</label>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...s.input, padding: '8px 12px' }} onChange={e => setDcFile(e.target.files[0])} />
                        </div>
                      </div>
                      <button type="submit" style={s.btn} disabled={submittingDc}>{submittingDc ? 'Saving…' : 'Save Cost'}</button>
                    </form>
                  </div>
                )}

                {/* Status filter */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                  {[['all', 'All', directCosts.length], ['pending', 'Pending', pendingCount], ['approved', 'Approved', directCosts.filter(c => c.status === 'approved').length]].map(([k, label, count]) => (
                    <button key={k} onClick={() => setDcStatusFilter(k)} style={{ padding: '4px 12px', borderRadius: '99px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${dcStatusFilter === k ? '#e8590c' : '#2a2a2a'}`, background: dcStatusFilter === k ? '#2a1200' : 'transparent', color: dcStatusFilter === k ? '#e8590c' : '#555' }}>
                      {label} ({count})
                    </button>
                  ))}
                  <input style={{ ...s.input, width: '180px', padding: '4px 10px', fontSize: '12px', marginLeft: 'auto' }} placeholder="Search..." value={dcSearch} onChange={e => setDcSearch(e.target.value)} />
                </div>

                {visible.length === 0 ? (
                  <div style={s.emptyMsg}>{directCosts.length === 0 ? 'No direct costs logged yet.' : 'No costs match the current filter.'}</div>
                ) : (
                  visible.map(c => {
                    const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)
                    const isRejecting = rejectingCostId === c.id
                    return (
                      <div key={c.id} style={{ border: `1px solid ${c.status === 'approved' ? '#1a4a1a' : c.status === 'rejected' ? '#3a1a1a' : '#1e1e1e'}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{c.description}</span>
                              <span style={s.badge('gray')}>{c.category}</span>
                              <span style={s.badge(c.status === 'approved' ? 'green' : c.status === 'rejected' ? 'red' : 'orange')}>{c.status}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#555' }}>
                              {c.cost_date ? new Date(c.cost_date + 'T12:00:00').toLocaleDateString() : ''}
                              {budgetLine && ` · ${budgetLine.description}`}
                              {c.notes && ` · ${c.notes}`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '16px', fontWeight: '800', fontFamily: 'monospace' }}>${fmt(c.amount)}</span>
                            {c.receipt_url && (
                              <button style={s.btnSmGray} onClick={() => openDCReceipt(c.receipt_url)}>Receipt</button>
                            )}
                            {!c.budget_item_id && (
                              <select style={{ ...s.select, width: '160px', fontSize: '12px', padding: '4px 8px' }} defaultValue="" onChange={e => assignDCBudgetItem(c.id, e.target.value)}>
                                <option value="">Assign budget line</option>
                                {budgetItems.map(b => <option key={b.id} value={b.id}>{b.description}</option>)}
                              </select>
                            )}
                            {c.status === 'pending' && (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button style={s.btnGreen} disabled={updatingCostId === c.id} onClick={() => updateDCStatus(c.id, 'approved')}>Approve</button>
                                <button style={s.btnRed} onClick={() => setRejectingCostId(isRejecting ? null : c.id)}>{isRejecting ? 'Cancel' : 'Reject'}</button>
                              </div>
                            )}
                            {c.status === 'approved' && profile?.role === 'pm' && (
                              <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => updateDCStatus(c.id, 'rejected')}>Undo</button>
                            )}
                            {profile?.role === 'pm' && (
                              <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => { if (confirm('Delete this cost?')) updateDCStatus(c.id, 'deleted') }}>Delete</button>
                            )}
                          </div>
                        </div>
                        {isRejecting && (
                          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input style={{ ...s.input, flex: 1, fontSize: '12px' }} placeholder="Rejection reason (optional)" value={costRejectNote} onChange={e => setCostRejectNote(e.target.value)} autoFocus />
                            <button style={s.btnRed} onClick={() => updateDCStatus(c.id, 'rejected')}>Confirm Reject</button>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )
        })()}

        {/* ── SUBS ── */}
        {activeTab === 'subs' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Subcontractors ({contracts.length})</p>
              <button style={s.btnSm} onClick={() => { setShowAddSubForm(v => !v); setSubMsg('') }}>{showAddSubForm ? 'Cancel' : '+ Add Sub'}</button>
            </div>

            {showAddSubForm && (
              <form onSubmit={addSub} style={{ ...s.inlineForm, marginBottom: '16px' }}>
                {subDirectory.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Pick from sub directory</label>
                    <select style={s.select} value={newSubForm.dir_id} onChange={e => setNewSubForm(f => ({ ...f, dir_id: e.target.value, company_name: '', trade: '' }))}>
                      <option value="">— Select company —</option>
                      {subDirectory.map(d => (
                        <option key={d.id} value={d.id}>{d.company_name}{d.trade ? ` · ${d.trade}` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
                {!newSubForm.dir_id && (
                  <div style={{ ...s.grid2, marginBottom: '12px' }}>
                    <div><label style={s.label}>Company Name *</label><input style={s.input} value={newSubForm.company_name} onChange={e => setNewSubForm(f => ({ ...f, company_name: e.target.value }))} placeholder="ABC Framing..." /></div>
                    <div><label style={s.label}>Trade / Scope</label><input style={s.input} value={newSubForm.trade} onChange={e => setNewSubForm(f => ({ ...f, trade: e.target.value }))} placeholder="Framing, Electrical..." /></div>
                  </div>
                )}
                <div style={{ ...s.grid2, marginBottom: '12px' }}>
                  <div>
                    <label style={s.label}>Contract Value ($)</label>
                    <input style={s.input} type="number" step="0.01" min="0" placeholder="0.00" value={newSubForm.contract_value} onChange={e => setNewSubForm(f => ({ ...f, contract_value: e.target.value }))} />
                  </div>
                  <div>
                    <label style={s.label}>Assign to Budget Line</label>
                    <select style={s.select} value={newSubForm.budget_item_id} onChange={e => setNewSubForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                      <option value="">— Unassigned —</option>
                      {budgetItems.map(b => <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button type="submit" style={s.btn} disabled={addingSub}>{addingSub ? 'Adding…' : 'Add Subcontractor'}</button>
                  {subMsg && <span style={subMsg.startsWith('Error') ? s.errMsg : s.successMsg}>{subMsg}</span>}
                </div>
              </form>
            )}

            {contracts.length === 0 ? (
              <div style={s.emptyMsg}>No subcontractors yet. Add a sub to get started.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 120px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #222' }}>
                  {['Company', 'Trade', 'Budget Line', 'Contract $', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                </div>
                {contracts.map(c => {
                  const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)
                  const isEditing = editingSubId === c.id
                  return isEditing ? (
                    <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 120px', gap: '10px', padding: '8px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' }}>
                      <input style={{ ...s.input, fontSize: '12px' }} value={editSubForm.vendor_name || ''} onChange={e => setEditSubForm(f => ({ ...f, vendor_name: e.target.value }))} />
                      <input style={{ ...s.input, fontSize: '12px' }} placeholder="Trade / scope" value={editSubForm.description || ''} onChange={e => setEditSubForm(f => ({ ...f, description: e.target.value }))} />
                      <select style={{ ...s.select, fontSize: '12px' }} value={editSubForm.budget_item_id || ''} onChange={e => setEditSubForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                        <option value="">— None —</option>
                        {budgetItems.map(b => <option key={b.id} value={b.id}>{b.description}</option>)}
                      </select>
                      <input style={{ ...s.input, fontSize: '12px' }} type="number" value={editSubForm.contract_value || ''} onChange={e => setEditSubForm(f => ({ ...f, contract_value: e.target.value }))} />
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button style={s.btnGreen} onClick={() => saveSubEdit(c.id)}>Save</button>
                        <button style={s.btnSmGray} onClick={() => setEditingSubId(null)}>×</button>
                      </div>
                    </div>
                  ) : (
                    <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 120px', gap: '10px', padding: '12px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{c.vendor_name || '—'}</span>
                      <span style={{ fontSize: '12px', color: '#aaa' }}>{c.description || '—'}</span>
                      <span style={{ fontSize: '12px', color: budgetLine ? '#60a5fa' : '#444' }}>{budgetLine?.description || '—'}</span>
                      <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(c.contract_value)}</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button style={s.btnSmGray} onClick={() => { setEditingSubId(c.id); setEditSubForm(c) }}>Edit</button>
                        <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => deleteSubcontract(c.id)}>×</button>
                      </div>
                    </div>
                  )
                })}
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
                  <button style={s.btnSm} onClick={() => { setShowBillingForm(v => !v); setBillingMsg('') }}>{showBillingForm ? 'Cancel' : '+ New Submission'}</button>
                </div>

                {showBillingForm && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Subcontractor</label>
                        <select style={s.select} value={billingForm.sub_id} onChange={e => {
                          const c = contracts.find(x => x.id === e.target.value)
                          setBillingForm(f => ({ ...f, sub_id: e.target.value, company_name: c?.vendor_name || f.company_name }))
                        }}>
                          <option value="">— Select or enter below —</option>
                          {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name}</option>)}
                        </select>
                        {!billingForm.sub_id && <input style={{ ...s.input, marginTop: '6px' }} placeholder="Company name" value={billingForm.company_name} onChange={e => setBillingForm(f => ({ ...f, company_name: e.target.value }))} />}
                      </div>
                      <div>
                        <label style={s.label}>Billing Period</label>
                        <input type="month" style={s.input} value={billingForm.billing_period} onChange={e => setBillingForm(f => ({ ...f, billing_period: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Amount Billed *</label>
                        <input type="number" step="0.01" style={s.input} placeholder="0.00" value={billingForm.amount_billed} onChange={e => setBillingForm(f => ({ ...f, amount_billed: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Retainage %</label>
                        <input type="number" step="0.1" style={s.input} placeholder="10" value={billingForm.retainage_pct} onChange={e => setBillingForm(f => ({ ...f, retainage_pct: e.target.value }))} />
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <label style={s.label}>Work Description</label>
                        <input style={s.input} placeholder="Framing, rough plumbing, drywall..." value={billingForm.work_description} onChange={e => setBillingForm(f => ({ ...f, work_description: e.target.value }))} />
                      </div>
                    </div>
                    {billingMsg && <div style={{ ...s.errMsg, marginBottom: '8px' }}>{billingMsg}</div>}
                    <button style={s.btn} onClick={submitBilling} disabled={addingBilling || !billingForm.amount_billed || (!billingForm.sub_id && !billingForm.company_name)}>
                      {addingBilling ? 'Submitting...' : 'Add Submission'}
                    </button>
                  </div>
                )}

                {billingSubmissions.length === 0 ? (
                  <div style={s.emptyMsg}>No billing submissions yet.</div>
                ) : (
                  billingSubmissions.map(b => {
                    const period = b.billing_period ? new Date(b.billing_period + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''
                    return (
                      <div key={b.id} style={{ padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{b.company_name}</div>
                            <div style={{ fontSize: '12px', color: '#555' }}>{period}{b.work_description ? ' · ' + b.work_description : ''}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>${fmt(b.amount_billed)}</div>
                              {b.retainage_held ? <div style={{ fontSize: '11px', color: '#555' }}>-${fmt(b.retainage_held)} ret.</div> : null}
                            </div>
                            <span style={s.badge(statusColor[b.status] || 'gray')}>{b.status}</span>
                            {profile?.role === 'pm' && b.status === 'pending' && (<>
                              <button onClick={() => updateBillingStatus(b.id, 'approved')} style={s.btnGreen}>Approve</button>
                              <button onClick={() => updateBillingStatus(b.id, 'rejected')} style={s.btnRed}>Reject</button>
                            </>)}
                            <button onClick={() => deleteBilling(b.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 2px' }}>×</button>
                          </div>
                        </div>
                      </div>
                    )
                  })
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

        {/* ── INSPECTIONS ── */}
        {activeTab === 'inspections' && (() => {
          const TYPES = ['Foundation','Framing','Rough Plumbing','Rough Electrical','Rough HVAC','Insulation','Drywall','Final Plumbing','Final Electrical','Final HVAC','Final']
          const resultColor = { pending: 'orange', passed: 'green', failed: 'red', rescheduled: 'blue' }
          return (
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Inspections ({inspections.length})</p>
                <button style={s.btnSm} onClick={() => setShowAddInspection(v => !v)}>{showAddInspection ? 'Cancel' : '+ Add Inspection'}</button>
              </div>
              {showAddInspection && (
                <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                  <div style={{ ...s.grid3, marginBottom: '10px' }}>
                    <div>
                      <label style={s.label}>Inspection Type *</label>
                      <select style={s.select} value={newInspection.inspection_type} onChange={e => setNewInspection(f => ({ ...f, inspection_type: e.target.value }))}>
                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Scheduled Date</label>
                      <input type="date" style={s.input} value={newInspection.scheduled_date} onChange={e => setNewInspection(f => ({ ...f, scheduled_date: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Inspector Name</label>
                      <input style={s.input} placeholder="City inspector..." value={newInspection.inspector_name} onChange={e => setNewInspection(f => ({ ...f, inspector_name: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '10px' }}>
                    <div>
                      <label style={s.label}>Notes</label>
                      <input style={s.input} value={newInspection.notes} onChange={e => setNewInspection(f => ({ ...f, notes: e.target.value }))} placeholder="Permit #, notes..." />
                    </div>
                  </div>
                  <button style={s.btn} onClick={addInspection} disabled={addingInspection}>{addingInspection ? 'Adding...' : 'Add Inspection'}</button>
                </div>
              )}
              {inspections.length === 0 ? (
                <div style={s.emptyMsg}>No inspections yet. Track each building department inspection here.</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 160px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #222' }}>
                    {['Type', 'Scheduled', 'Inspector', 'Result', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                  </div>
                  {inspections.map(ins => (
                    <div key={ins.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 160px', gap: '10px', padding: '10px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13px', color: '#f1f1f1' }}>{ins.inspection_type}</div>
                        {ins.notes && <div style={{ fontSize: '11px', color: '#555' }}>{ins.notes}</div>}
                      </div>
                      <span style={{ fontSize: '12px', color: '#aaa' }}>{fmtDate(ins.scheduled_date)}</span>
                      <span style={{ fontSize: '12px', color: '#aaa' }}>{ins.inspector_name || '—'}</span>
                      <span style={s.badge(resultColor[ins.result] || 'gray')}>{ins.result}</span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {ins.result !== 'passed' && <button style={s.btnGreen} onClick={() => updateInspectionResult(ins.id, 'passed')}>Pass</button>}
                        {ins.result !== 'failed' && <button style={s.btnRed} onClick={() => updateInspectionResult(ins.id, 'failed')}>Fail</button>}
                        {ins.result !== 'pending' && <button style={s.btnSmGray} onClick={() => updateInspectionResult(ins.id, 'pending')}>Reset</button>}
                        <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => deleteInspection(ins.id)}>×</button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )
        })()}

        {/* ── LIEN WAIVERS ── */}
        {activeTab === 'lienWaivers' && (() => {
          const pendingWaivers = lienWaivers.filter(w => w.status === 'pending')
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div style={s.statCard}><div style={s.statLabel}>Pending Waivers</div><div style={s.statValue(pendingWaivers.length > 0 ? '#e8590c' : undefined)}>{pendingWaivers.length}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Received</div><div style={s.statValue('#4ade80')}>{lienWaivers.filter(w => w.status === 'received').length}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Total Waived</div><div style={s.statValue()}>${fmt(lienWaivers.filter(w => w.status === 'received').reduce((a, w) => a + Number(w.amount || 0), 0))}</div></div>
              </div>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Lien Waivers ({lienWaivers.length})</p>
                  <button style={s.btnSm} onClick={() => setShowAddWaiver(v => !v)}>{showAddWaiver ? 'Cancel' : '+ Add Waiver'}</button>
                </div>
                {showAddWaiver && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <div style={{ ...s.grid3, marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Subcontractor *</label>
                        <select style={s.select} value={newWaiver.subcontract_id} onChange={e => {
                          const c = contracts.find(x => x.id === e.target.value)
                          setNewWaiver(f => ({ ...f, subcontract_id: e.target.value, company_name: c?.vendor_name || f.company_name }))
                        }}>
                          <option value="">— Select or type below —</option>
                          {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name}</option>)}
                        </select>
                        {!newWaiver.subcontract_id && <input style={{ ...s.input, marginTop: '6px' }} placeholder="Company name (if not listed)" value={newWaiver.company_name} onChange={e => setNewWaiver(f => ({ ...f, company_name: e.target.value }))} />}
                      </div>
                      <div>
                        <label style={s.label}>Waiver Type</label>
                        <select style={s.select} value={newWaiver.waiver_type} onChange={e => setNewWaiver(f => ({ ...f, waiver_type: e.target.value }))}>
                          <option value="conditional">Conditional (upon payment)</option>
                          <option value="unconditional">Unconditional (payment received)</option>
                        </select>
                      </div>
                      <div>
                        <label style={s.label}>Amount ($)</label>
                        <input type="number" step="0.01" style={s.input} placeholder="0.00" value={newWaiver.amount} onChange={e => setNewWaiver(f => ({ ...f, amount: e.target.value }))} />
                      </div>
                    </div>
                    <div style={{ ...s.grid3, marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Payment Date</label>
                        <input type="date" style={s.input} value={newWaiver.payment_date} onChange={e => setNewWaiver(f => ({ ...f, payment_date: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Waiver Received Date</label>
                        <input type="date" style={s.input} value={newWaiver.waiver_date} onChange={e => setNewWaiver(f => ({ ...f, waiver_date: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Status</label>
                        <select style={s.select} value={newWaiver.status} onChange={e => setNewWaiver(f => ({ ...f, status: e.target.value }))}>
                          <option value="pending">Pending</option>
                          <option value="received">Received</option>
                        </select>
                      </div>
                    </div>
                    <button style={s.btn} onClick={addLienWaiver} disabled={addingWaiver || (!newWaiver.company_name && !newWaiver.subcontract_id)}>{addingWaiver ? 'Adding...' : 'Add Waiver'}</button>
                  </div>
                )}
                {lienWaivers.length === 0 ? (
                  <div style={s.emptyMsg}>No lien waivers yet. Track conditional and unconditional waivers from each sub upon payment.</div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #222' }}>
                      {['Company', 'Type', 'Amount', 'Paid', 'Received', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                    </div>
                    {lienWaivers.map(w => (
                      <div key={w.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px', gap: '10px', padding: '10px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center', background: w.status === 'pending' ? '#0d0a00' : 'transparent' }}>
                        <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{w.company_name}</span>
                        <span style={s.badge(w.waiver_type === 'conditional' ? 'blue' : 'green')}>{w.waiver_type === 'conditional' ? 'Conditional' : 'Unconditional'}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>{w.amount ? '$' + fmt(w.amount) : '—'}</span>
                        <span style={{ fontSize: '12px', color: '#aaa' }}>{fmtDate(w.payment_date)}</span>
                        <span style={{ fontSize: '12px', color: w.waiver_date ? '#4ade80' : '#e8590c' }}>{fmtDate(w.waiver_date)}</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {w.status === 'pending' && <button style={s.btnGreen} onClick={() => updateWaiverStatus(w.id, 'received')}>Received</button>}
                          <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => deleteWaiver(w.id)}>×</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )
        })()}

        {/* ── OWNER DRAW ── */}
        {activeTab === 'ownerdraw' && (() => {
          const totalFunded = ownerDraws.filter(d => d.status === 'funded').reduce((a, d) => a + Number(d.amount_requested || 0), 0)
          const totalRequested = ownerDraws.reduce((a, d) => a + Number(d.amount_requested || 0), 0)
          const approvedBillingTotal = billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.amount_billed || 0), 0)
          const approvedCostTotal = directCosts.filter(c => c.status === 'approved').reduce((a, c) => a + Number(c.amount || 0), 0)
          const drawStatusColor = { draft: 'gray', submitted: 'orange', approved: 'blue', funded: 'green' }
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div style={s.statCard}><div style={s.statLabel}>Total Requested</div><div style={s.statValue()}>${fmt(totalRequested)}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Total Funded</div><div style={s.statValue('#4ade80')}>${fmt(totalFunded)}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Approved Sub Billing</div><div style={s.statValue('#60a5fa')}>${fmt(approvedBillingTotal)}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Approved Direct Costs</div><div style={s.statValue('#e8590c')}>${fmt(approvedCostTotal)}</div></div>
              </div>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Owner/Lender Draw Requests ({ownerDraws.length})</p>
                  <button style={s.btnSm} onClick={() => setShowAddOwnerDraw(v => !v)}>{showAddOwnerDraw ? 'Cancel' : '+ New Draw'}</button>
                </div>
                {showAddOwnerDraw && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <div style={{ background: '#0a1a0a', border: '1px solid #1a3a1a', borderRadius: '6px', padding: '10px 14px', marginBottom: '14px', fontSize: '12px', color: '#aaa' }}>
                      Current approved sub billing: <strong style={{ color: '#4ade80' }}>${fmt(approvedBillingTotal)}</strong> &nbsp;·&nbsp;
                      Direct costs: <strong style={{ color: '#e8590c' }}>${fmt(approvedCostTotal)}</strong> &nbsp;·&nbsp;
                      Combined: <strong style={{ color: '#f1f1f1' }}>${fmt(approvedBillingTotal + approvedCostTotal)}</strong>
                    </div>
                    <div style={{ ...s.grid3, marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Draw Title</label>
                        <input style={s.input} placeholder={`Draw #${ownerDraws.length + 1}`} value={newOwnerDraw.title} onChange={e => setNewOwnerDraw(f => ({ ...f, title: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Period Start</label>
                        <input type="date" style={s.input} value={newOwnerDraw.period_start} onChange={e => setNewOwnerDraw(f => ({ ...f, period_start: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Period End</label>
                        <input type="date" style={s.input} value={newOwnerDraw.period_end} onChange={e => setNewOwnerDraw(f => ({ ...f, period_end: e.target.value }))} />
                      </div>
                    </div>
                    <div style={{ ...s.grid2, marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Amount Requested ($) *</label>
                        <input type="number" step="0.01" style={s.input} placeholder="0.00" value={newOwnerDraw.amount_requested} onChange={e => setNewOwnerDraw(f => ({ ...f, amount_requested: e.target.value }))} autoFocus />
                      </div>
                      <div>
                        <label style={s.label}>Notes</label>
                        <input style={s.input} value={newOwnerDraw.notes} onChange={e => setNewOwnerDraw(f => ({ ...f, notes: e.target.value }))} placeholder="Bank loan #, inspector contact..." />
                      </div>
                    </div>
                    <button style={s.btn} onClick={addOwnerDraw} disabled={addingOwnerDraw || !newOwnerDraw.amount_requested}>{addingOwnerDraw ? 'Creating...' : 'Create Draw Request'}</button>
                  </div>
                )}
                {ownerDraws.length === 0 ? (
                  <div style={s.emptyMsg}>No owner draw requests yet. Create one to request funds from the construction lender or owner.</div>
                ) : (
                  ownerDraws.map(d => (
                    <div key={d.id} style={{ border: `1px solid ${d.status === 'funded' ? '#1a4a1a' : d.status === 'submitted' ? '#2a1200' : '#1e1e1e'}`, borderRadius: '8px', padding: '14px 16px', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: '700', color: '#f1f1f1', marginBottom: '4px' }}>Draw #{d.draw_number} — {d.title}</div>
                          <div style={{ fontSize: '12px', color: '#555' }}>
                            {d.period_start && d.period_end ? `${fmtDate(d.period_start)} – ${fmtDate(d.period_end)}` : d.period_start ? `From ${fmtDate(d.period_start)}` : ''}
                            {d.submitted_date && ` · Submitted ${fmtDate(d.submitted_date)}`}
                            {d.funded_date && ` · Funded ${fmtDate(d.funded_date)}`}
                            {d.notes && ` · ${d.notes}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '18px', fontWeight: '800', fontFamily: 'monospace', color: '#f1f1f1' }}>${fmt(d.amount_requested)}</span>
                          <span style={s.badge(drawStatusColor[d.status] || 'gray')}>{d.status}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                        {d.status === 'draft' && <button style={s.btnSm} onClick={() => updateOwnerDrawStatus(d.id, 'submitted')}>Submit to Owner/Bank</button>}
                        {d.status === 'submitted' && <button style={s.btnGreen} onClick={() => updateOwnerDrawStatus(d.id, 'approved')}>Mark Approved</button>}
                        {d.status === 'approved' && <button style={s.btnGreen} onClick={() => updateOwnerDrawStatus(d.id, 'funded')}>Mark Funded</button>}
                        {d.status !== 'funded' && <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => deleteOwnerDraw(d.id)}>Delete</button>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )
        })()}

        {/* ── PUNCH LIST ── */}
        {activeTab === 'punchlist' && (() => {
          const openCount = punchList.filter(p => p.status === 'open').length
          const inProgressCount = punchList.filter(p => p.status === 'in-progress').length
          const doneCount = punchList.filter(p => p.status === 'done').length
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div style={s.statCard}><div style={s.statLabel}>Open</div><div style={s.statValue(openCount > 0 ? '#e8590c' : undefined)}>{openCount}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>In Progress</div><div style={s.statValue('#60a5fa')}>{inProgressCount}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Done</div><div style={s.statValue('#4ade80')}>{doneCount}</div></div>
              </div>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Punch List ({punchList.length})</p>
                  <button style={s.btnSm} onClick={() => setShowAddPunch(v => !v)}>{showAddPunch ? 'Cancel' : '+ Add Item'}</button>
                </div>
                {showAddPunch && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={s.label}>Description *</label>
                      <input style={s.input} autoFocus placeholder="Touch-up paint in master bedroom..." value={newPunch.description} onChange={e => setNewPunch(f => ({ ...f, description: e.target.value }))} />
                    </div>
                    <div style={{ ...s.grid3, marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Assign to Sub</label>
                        <select style={s.select} value={newPunch.subcontract_id} onChange={e => setNewPunch(f => ({ ...f, subcontract_id: e.target.value, assigned_to: '' }))}>
                          <option value="">— Select sub or enter below —</option>
                          {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name}</option>)}
                        </select>
                        {!newPunch.subcontract_id && <input style={{ ...s.input, marginTop: '6px' }} placeholder="Or type name / trade..." value={newPunch.assigned_to} onChange={e => setNewPunch(f => ({ ...f, assigned_to: e.target.value }))} />}
                      </div>
                      <div>
                        <label style={s.label}>Due Date</label>
                        <input type="date" style={s.input} value={newPunch.due_date} onChange={e => setNewPunch(f => ({ ...f, due_date: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Notes</label>
                        <input style={s.input} value={newPunch.notes} onChange={e => setNewPunch(f => ({ ...f, notes: e.target.value }))} placeholder="Location, details..." />
                      </div>
                    </div>
                    <button style={s.btn} onClick={addPunchItem} disabled={addingPunch || !newPunch.description}>{addingPunch ? 'Adding...' : 'Add to Punch List'}</button>
                  </div>
                )}
                {punchList.length === 0 ? (
                  <div style={s.emptyMsg}>Punch list is clear. Add items as you approach project closeout.</div>
                ) : (
                  punchList.map(p => {
                    const assignedSub = p.subcontract_id ? contracts.find(c => c.id === p.subcontract_id) : null
                    return (
                      <div key={p.id} style={{ border: `1px solid ${p.status === 'done' ? '#1a4a1a' : p.status === 'in-progress' ? '#0a1a2a' : '#1e1e1e'}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '8px', opacity: p.status === 'done' ? 0.65 : 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: p.status === 'done' ? '#555' : '#f1f1f1', textDecoration: p.status === 'done' ? 'line-through' : 'none', marginBottom: '3px' }}>{p.description}</div>
                            <div style={{ fontSize: '12px', color: '#555' }}>
                              {(assignedSub?.vendor_name || p.assigned_to) && <span style={{ color: '#60a5fa' }}>{assignedSub?.vendor_name || p.assigned_to}</span>}
                              {p.due_date && <span> · Due {fmtDate(p.due_date)}</span>}
                              {p.notes && <span> · {p.notes}</span>}
                              {p.completed_date && <span style={{ color: '#4ade80' }}> · Completed {fmtDate(p.completed_date)}</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={s.badge(statusColor[p.status] || 'gray')}>{p.status}</span>
                            {p.status === 'open' && <button style={s.btnSmGray} onClick={() => updatePunchStatus(p.id, 'in-progress')}>Start</button>}
                            {p.status !== 'done' && <button style={s.btnGreen} onClick={() => updatePunchStatus(p.id, 'done')}>Done</button>}
                            {p.status === 'done' && <button style={s.btnSmGray} onClick={() => updatePunchStatus(p.id, 'open')}>Reopen</button>}
                            <button style={{ ...s.btnSmGray, color: '#f87171' }} onClick={() => deletePunchItem(p.id)}>×</button>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )
        })()}

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
