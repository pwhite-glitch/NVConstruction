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
  btnSmall: { padding: '7px 16px', background: '#1a1a1a', color: '#aaa', border: '1px solid #2a2a2a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSmallOrange: { padding: '7px 16px', background: '#2a1200', color: '#e8590c', border: '1px solid #4a2200', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSmallGreen: { padding: '7px 16px', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSmallRed: { padding: '7px 16px', background: '#2a0a0a', color: '#ff6b6b', border: '1px solid #5a1a1a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  jobTitle: { fontSize: '28px', fontWeight: '800', color: '#f1f1f1', margin: '0 0 4px' },
  jobMeta: { fontSize: '14px', color: '#555', margin: 0 },
  successMsg: { background: '#0a1a0a', border: '1px solid #1a4a1a', color: '#4ade80', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1.5rem' },
  errorMsg: { background: '#1a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1.5rem' },
  badge: (status) => ({
    padding: '4px 14px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'active' ? '#0a1a2a' : status === 'complete' ? '#0a2a0a' : status === 'archived' ? '#1a1a1a' : '#2a2a0a',
    color: status === 'active' ? '#60a5fa' : status === 'complete' ? '#4ade80' : status === 'archived' ? '#555' : '#facc15',
    border: `1px solid ${status === 'active' ? '#1a3a5a' : status === 'complete' ? '#1a4a1a' : status === 'archived' ? '#2a2a2a' : '#4a4a0a'}`
  }),
  contractBadge: (status) => ({
    padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'signed' ? '#0a2a0a' : status === 'active' ? '#0a1a2a' : '#1a1a1a',
    color: status === 'signed' ? '#4ade80' : status === 'active' ? '#60a5fa' : '#888',
    border: `1px solid ${status === 'signed' ? '#1a4a1a' : status === 'active' ? '#1a3a5a' : '#2a2a2a'}`
  }),
  coBadge: (status) => ({
    padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'approved' ? '#0a2a0a' : status === 'rejected' ? '#2a0a0a' : '#2a1200',
    color: status === 'approved' ? '#4ade80' : status === 'rejected' ? '#ff6b6b' : '#e8590c',
    border: `1px solid ${status === 'approved' ? '#1a4a1a' : status === 'rejected' ? '#5a1a1a' : '#4a2200'}`
  }),
  billingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' },
  subRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' },
  statCard: { background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem' },
  statLabel: { fontSize: '11px', fontWeight: '600', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '6px' },
  statValue: (accent) => ({ fontSize: '24px', fontWeight: '800', color: accent || '#f1f1f1', margin: 0 }),
  confirmBox: { background: '#1a0a0a', border: '1px solid #5a1a1a', borderRadius: '8px', padding: '1.25rem', marginTop: '1rem' },
  tabRow: { display: 'flex', gap: '4px', marginBottom: '1.5rem', borderBottom: '1px solid #222', paddingBottom: '0', overflowX: 'auto' },
  tab: (active) => ({
    padding: '10px 20px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', background: 'none', border: 'none',
    color: active ? '#f1f1f1' : '#555', borderBottom: active ? '2px solid #e8590c' : '2px solid transparent',
    letterSpacing: '0.5px', marginBottom: '-1px', whiteSpace: 'nowrap'
  }),
  inlineForm: { background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' },
  contractRow: { border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' },
  contractRowHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' },
  contractRowExpanded: { borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' },
  coRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' },
  budgetTableHeader: { display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 60px 80px', gap: '12px', padding: '8px 12px 10px', fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #1e1e1e', marginBottom: '4px', alignItems: 'center' },
  budgetTableRow: { display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 60px 80px', gap: '12px', padding: '14px 12px', borderBottom: '1px solid #111', alignItems: 'center' },
  billingEntryRow: { border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' },
  billingEntryHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' },
  billingEntryExpanded: { borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' },
}

const emptyContract = { dir_id: '', contract_value: '', description: '', onedrive_url: '', budget_item_id: '', retainage_pct: '10' }
const emptyCO = { subcontract_id: '', amount: '', description: '', direction: 'pm_to_sub' }
const emptyPrimeCO = { amount: '', description: '', budget_item_id: '', notes: '' }
const emptyBudgetItem = { cost_code: '', description: '', budget_amount: '', owner_amount: '' }
const emptyCreateBilling = { _contract_id: '', _contract_value: '', _retainage_pct: '0', sub_id: '', company_name: '', contact_name: '', contact_info: '', amount_billed: '', pct_complete: '', work_description: '', billing_period: new Date().toISOString().slice(0, 7), auto_approve: true }

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
  const [errMsg, setErrMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [activeTab, setActiveTab] = useState('details')

  // Contracts state
  const [contracts, setContracts] = useState([])
  const [showAddContract, setShowAddContract] = useState(false)
  const [contractForm, setContractForm] = useState(emptyContract)
  const [addingContract, setAddingContract] = useState(false)
  const [editingContract, setEditingContract] = useState(null)
  const [editContractForm, setEditContractForm] = useState({})

  // Change orders state
  const [allCOs, setAllCOs] = useState([])
  const [showAddCO, setShowAddCO] = useState(false)
  const [coForm, setCoForm] = useState(emptyCO)
  const [addingCO, setAddingCO] = useState(false)
  const [primeCOs, setPrimeCOs] = useState([])
  const [showAddPrimeCO, setShowAddPrimeCO] = useState(false)
  const [primeCOForm, setPrimeCOForm] = useState(emptyPrimeCO)
  const [addingPrimeCO, setAddingPrimeCO] = useState(false)

  // Budget state
  const [budgetItems, setBudgetItems] = useState([])
  const [showAddBudgetItem, setShowAddBudgetItem] = useState(false)
  const [budgetItemForm, setBudgetItemForm] = useState(emptyBudgetItem)
  const [addingBudgetItem, setAddingBudgetItem] = useState(false)
  const [csvUploading, setCsvUploading] = useState(false)
  const [editingBudgetItem, setEditingBudgetItem] = useState(null)
  const [editBudgetForm, setEditBudgetForm] = useState({})

  // Billing tab state
  const [billingSubmissions, setBillingSubmissions] = useState([])
  const [showCreateBilling, setShowCreateBilling] = useState(false)
  const [createBillingForm, setCreateBillingForm] = useState(emptyCreateBilling)
  const [creatingBilling, setCreatingBilling] = useState(false)
  const [createBillingError, setCreateBillingError] = useState('')
  const [editingBilling, setEditingBilling] = useState(null)
  const [editBillingForm, setEditBillingForm] = useState({})

  // Subs tab state
  const [subDirectory, setSubDirectory] = useState([])
  const [showAssignSub, setShowAssignSub] = useState(false)
  const [assignSubForm, setAssignSubForm] = useState({ email: '', from_dir: '' })
  const [assigningSubLoading, setAssigningSubLoading] = useState(false)

  // Field tab state
  const [fieldDailyReports, setFieldDailyReports] = useState([])
  const [fieldRfis, setFieldRfis] = useState([])
  const [fieldDeliveries, setFieldDeliveries] = useState([])
  const [fieldMilestones, setFieldMilestones] = useState([])
  const [expandedFieldReport, setExpandedFieldReport] = useState(null)
  const [expandedFieldRfi, setExpandedFieldRfi] = useState(null)
  const [fieldSubTab, setFieldSubTab] = useState('reports')
  const [respondingRfi, setRespondingRfi] = useState(null)
  const [rfiResponse, setRfiResponse] = useState('')
  const [savingRfiResponse, setSavingRfiResponse] = useState(false)
  const [milestoneForm, setMilestoneForm] = useState({ title: '', due_date: '', notes: '' })
  const [addingMilestone, setAddingMilestone] = useState(false)
  const [showMilestoneForm, setShowMilestoneForm] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState(null)
  const [editMilestoneForm, setEditMilestoneForm] = useState({})

  // Direct Costs tab state
  const [directCosts, setDirectCosts] = useState([])
  const [updatingCostId, setUpdatingCostId] = useState(null)
  const [rejectingCostId, setRejectingCostId] = useState(null)
  const [costRejectNote, setCostRejectNote] = useState('')
  const [assigningCostId, setAssigningCostId] = useState(null)
  const [showDcForm, setShowDcForm] = useState(false)
  const [dcForm, setDcForm] = useState({ cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', notes: '', budget_item_id: '' })
  const [dcFile, setDcFile] = useState(null)
  const [submittingDc, setSubmittingDc] = useState(false)

  // Prime Contract tab state
  const [primeContractFile, setPrimeContractFile] = useState(null)
  const [uploadingPrimeContract, setUploadingPrimeContract] = useState(false)
  const [aiaApplications, setAiaApplications] = useState([])
  const [activeAia, setActiveAia] = useState(null)
  const [aiaLines, setAiaLines] = useState([])
  const [showNewAia, setShowNewAia] = useState(false)
  const [newAiaForm, setNewAiaForm] = useState({ app_number: '1', period_to: '', retainage_pct: '10', markup_pct: '0' })
  const [savingAia, setSavingAia] = useState(false)
  const [aiaLoading, setAiaLoading] = useState(false)
  const [periodBilling, setPeriodBilling] = useState([])
  const [appliedBillings, setAppliedBillings] = useState(new Set())
  const [manualMapBillingId, setManualMapBillingId] = useState(null)
  const [manualMapBudgetItemId, setManualMapBudgetItemId] = useState('')
  const [pinnedLineIds, setPinnedLineIds] = useState(new Set())

  // Contract SOV state
  const [contractSovLines, setContractSovLines] = useState({})
  const [expandedSov, setExpandedSov] = useState(null)
  const [showAddSovLine, setShowAddSovLine] = useState(null)
  const [sovLineForm, setSovLineForm] = useState({ description: '', scheduled_value: '' })
  const [addingSovLine, setAddingSovLine] = useState(false)
  const [editingSovLine, setEditingSovLine] = useState(null)
  const [editSovLineForm, setEditSovLineForm] = useState({})
  const [billingSovData, setBillingSovData] = useState({})

  const update = (f, v) => setForm(x => ({ ...x, [f]: v }))

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setId(params.get('id'))
    const tab = params.get('tab')
    if (tab) setActiveTab(tab)
  }, [])

  useEffect(() => {
    if (!id) return
    try {
      const stored = localStorage.getItem(`aia_pinned_${id}`)
      if (stored) setPinnedLineIds(new Set(JSON.parse(stored)))
    } catch {}
  }, [id])

  useEffect(() => {
    if (!id) return
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (prof?.role !== 'pm' && prof?.role !== 'apm') { router.push('/submit'); return }
      const { data: jobData } = await supabase.from('jobs').select('*').eq('id', id).single()
      if (!jobData) { router.push('/dashboard'); return }
      setJob(jobData)
      setForm(jobData)
      const { data: subList } = await supabase.from('job_assignments').select('*, profiles(full_name, company_name, phone)').eq('job_id', id)
      setSubs(subList || [])
      const { data: bills } = await supabase.from('billing_submissions').select('*').eq('job_id', id).order('submitted_at', { ascending: false })
      setBilling(bills || [])
      setLoading(false)
    }
    load()
  }, [id, router])

  async function loadContracts() {
    const { data: summary } = await supabase.from('subcontract_summary').select('*').eq('job_id', id).order('created_at', { ascending: true })
    if (!summary) { setContracts([]); return [] }
    // Fetch budget_item_id from the base table — the view may predate this column
    const { data: raw } = await supabase.from('subcontracts').select('id, budget_item_id, vendor_name, retainage_pct').eq('job_id', id)
    const merged = summary.map(c => ({
      ...c,
      budget_item_id: raw?.find(r => r.id === c.id)?.budget_item_id ?? null,
      vendor_name: raw?.find(r => r.id === c.id)?.vendor_name ?? null,
      retainage_pct: raw?.find(r => r.id === c.id)?.retainage_pct ?? 10,
    }))
    setContracts(merged)
    return merged
  }

  async function loadBudgetItems() {
    const { data } = await supabase.from('budget_items').select('*').eq('job_id', id).order('cost_code', { ascending: true })
    setBudgetItems(data || [])
  }

  async function loadAllCOs() {
    const { data } = await supabase
      .from('change_orders')
      .select('*, subcontracts!inner(sub_id, description, job_id)')
      .eq('subcontracts.job_id', id)
      .order('created_at', { ascending: false })
    setAllCOs(data || [])
  }

  async function loadBillingForJob() {
    const { data } = await supabase.from('billing_submissions').select('*').eq('job_id', id).order('submitted_at', { ascending: false })
    setBillingSubmissions(data || [])
  }

  async function reloadSubs() {
    const { data } = await supabase.from('job_assignments').select('*, profiles(full_name, company_name, phone)').eq('job_id', id)
    setSubs(data || [])
  }

  async function loadSubDirectory() {
    const { data } = await supabase.from('sub_directory').select('*').eq('status', 'approved').order('company_name')
    setSubDirectory(data || [])
  }

  async function loadFieldData() {
    const [{ data: reports }, { data: rfis }, { data: deliveries }, { data: milestones }] = await Promise.all([
      supabase.from('daily_reports').select('*').eq('job_id', id).order('report_date', { ascending: false }),
      supabase.from('rfis').select('*').eq('job_id', id).order('created_at', { ascending: false }),
      supabase.from('deliveries').select('*').eq('job_id', id).order('expected_date', { ascending: true }),
      supabase.from('milestones').select('*').eq('job_id', id).order('due_date', { ascending: true }),
    ])
    setFieldDailyReports(reports || [])
    setFieldRfis(rfis || [])
    setFieldDeliveries(deliveries || [])
    setFieldMilestones(milestones || [])
  }

  async function respondToRfi(rfiId) {
    setSavingRfiResponse(true)
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('rfis').update({ response: rfiResponse, status: 'answered', responded_at: new Date().toISOString(), responded_by: session.user.id }).eq('id', rfiId)
    setRespondingRfi(null)
    setRfiResponse('')
    await loadFieldData()
    setSavingRfiResponse(false)
  }

  async function addMilestone(e) {
    e.preventDefault()
    setAddingMilestone(true)
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('milestones').insert({ job_id: id, title: milestoneForm.title, due_date: milestoneForm.due_date || null, notes: milestoneForm.notes || null, created_by: session.user.id })
    setMilestoneForm({ title: '', due_date: '', notes: '' })
    setShowMilestoneForm(false)
    await loadFieldData()
    setAddingMilestone(false)
  }

  async function saveMilestoneEdit() {
    await supabase.from('milestones').update({ title: editMilestoneForm.title, due_date: editMilestoneForm.due_date || null, notes: editMilestoneForm.notes || null, status: editMilestoneForm.status }).eq('id', editingMilestone)
    setEditingMilestone(null)
    await loadFieldData()
  }

  async function deleteMilestone(milestoneId) {
    if (!window.confirm('Delete this milestone?')) return
    await supabase.from('milestones').delete().eq('id', milestoneId)
    await loadFieldData()
  }

  async function loadDirectCosts() {
    const { data } = await supabase.from('direct_costs').select('*').eq('job_id', id).order('cost_date', { ascending: false })
    setDirectCosts(data || [])
  }

  async function openDcReceiptUrl(path) {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function submitDirectCostPM(e) {
    e.preventDefault()
    setSubmittingDc(true)
    const { data: { session } } = await supabase.auth.getSession()
    let receipt_url = null
    if (dcFile) {
      const ext = dcFile.name.split('.').pop()
      const path = `${id}/${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('receipts').upload(path, dcFile)
      if (!uploadError) receipt_url = path
    }
    await supabase.from('direct_costs').insert({
      job_id: id, submitted_by: session.user.id,
      cost_date: dcForm.cost_date, description: dcForm.description,
      category: dcForm.category, amount: parseFloat(dcForm.amount),
      receipt_url, notes: dcForm.notes || null,
      budget_item_id: dcForm.budget_item_id || null,
      status: 'approved',
    })
    setDcForm({ cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', notes: '', budget_item_id: '' })
    setDcFile(null)
    setShowDcForm(false)
    await loadDirectCosts()
    setSubmittingDc(false)
  }

  async function updateCostStatus(costId, status, notes) {
    setUpdatingCostId(costId)
    await supabase.from('direct_costs').update({ status, notes: notes || null }).eq('id', costId)
    setRejectingCostId(null)
    setCostRejectNote('')
    await loadDirectCosts()
    setUpdatingCostId(null)
  }

  async function assignDcBudgetItem(costId, budgetItemId) {
    setAssigningCostId(costId)
    await supabase.from('direct_costs').update({ budget_item_id: budgetItemId || null }).eq('id', costId)
    await loadDirectCosts()
    setAssigningCostId(null)
  }

  function exportDirectCostsCSV() {
    const rows = [['Date', 'Description', 'Category', 'Amount', 'Budget Line', 'Status', 'Notes']]
    directCosts.forEach(c => {
      const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)?.description || ''
      rows.push([c.cost_date, c.description, c.category, c.amount, budgetLine, c.status, c.notes || ''])
    })
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `direct-costs-${job.job_number}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function uploadPrimeContract() {
    if (!primeContractFile) return
    setUploadingPrimeContract(true)
    const ext = primeContractFile.name.split('.').pop()
    const path = `${id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('prime-contracts').upload(path, primeContractFile)
    if (!error) {
      await supabase.from('jobs').update({ prime_contract_url: path }).eq('id', id)
      setJob(j => ({ ...j, prime_contract_url: path }))
      setPrimeContractFile(null)
    }
    setUploadingPrimeContract(false)
  }

  async function openPrimeContractUrl() {
    const { data } = await supabase.storage.from('prime-contracts').createSignedUrl(job.prime_contract_url, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function loadAiaApplications() {
    const { data } = await supabase.from('aia_applications').select('*').eq('job_id', id).order('app_number', { ascending: false })
    setAiaApplications(data || [])
    return data || []
  }

  async function openAiaApp(app) {
    if (activeAia?.id === app.id) { setActiveAia(null); setAiaLines([]); setPeriodBilling([]); setAppliedBillings(new Set()); return }
    setAiaLoading(true)
    setActiveAia(app)
    setAppliedBillings(new Set())
    const monthPrefix = app.period_to ? app.period_to.slice(0, 7) + '-01' : null
    const [{ data: lines }, { data: bills }] = await Promise.all([
      supabase.from('aia_application_lines').select('*').eq('application_id', app.id),
      monthPrefix
        ? supabase.from('billing_submissions').select('id, sub_id, company_name, amount_billed, retainage_held').eq('job_id', id).eq('status', 'approved').eq('billing_period', monthPrefix)
        : Promise.resolve({ data: [] }),
    ])
    const lineMap = Object.fromEntries((lines || []).map(l => [l.budget_item_id, l]))
    setAiaLines(budgetItems.map(b => ({
      budget_item_id: b.id,
      cost_code: b.cost_code,
      description: b.description,
      budget_amount: b.owner_amount ?? b.budget_amount,
      pct_prev: String(lineMap[b.id]?.pct_prev ?? 0),
      pct_this: String(lineMap[b.id]?.pct_this_period ?? 0),
    })))
    setPeriodBilling(bills || [])
    setAiaLoading(false)
  }

  async function applyBillingToAia(billing) {
    // Try SOV lines first: billing_sov_lines → subcontract_sov_lines → subcontracts → budget_item_id
    const { data: sovLines } = await supabase
      .from('billing_sov_lines')
      .select('amount, subcontract_sov_lines(subcontract_id, subcontracts(budget_item_id))')
      .eq('billing_submission_id', billing.id)

    const byBudgetItem = {}
    if (sovLines && sovLines.length > 0) {
      for (const l of sovLines) {
        const budgetItemId = l.subcontract_sov_lines?.subcontracts?.budget_item_id
        if (!budgetItemId) continue
        byBudgetItem[budgetItemId] = (byBudgetItem[budgetItemId] || 0) + Number(l.amount || 0)
      }
    }

    // Fall back: contract's budget_item_id + total amount
    if (Object.keys(byBudgetItem).length === 0 && billing.sub_id) {
      const contract = contracts.find(c => c.sub_id === billing.sub_id)
      if (contract?.budget_item_id) {
        byBudgetItem[contract.budget_item_id] = Number(billing.amount_billed || 0)
      }
    }

    // No automatic mapping found — open manual picker
    if (Object.keys(byBudgetItem).length === 0) {
      setManualMapBillingId(billing.id)
      setManualMapBudgetItemId('')
      return
    }

    applyAmountsToAiaLines(byBudgetItem, billing.id)
  }

  function applyAmountsToAiaLines(byBudgetItem, billingId) {
    const markupMultiplier = 1 + (parseFloat(activeAia?.markup_pct) || 0) / 100
    setAiaLines(lines => {
      const updated = lines.map(line => {
        const rawAmt = byBudgetItem[line.budget_item_id]
        if (!rawAmt) return line
        const addAmt = Math.round(rawAmt * markupMultiplier * 100) / 100
        const budgetAmt = Number(line.budget_amount || 0)
        if (budgetAmt === 0) return line
        // No rounding on the percentage — store full precision so dollar round-trip is exact
        const addedPct = addAmt / budgetAmt * 100
        const newPct = Math.min(100, (parseFloat(line.pct_this) || 0) + addedPct)
        return { ...line, pct_this: String(newPct) }
      })
      return recalcPinnedLines(updated, pinnedLineIds)
    })
    setAppliedBillings(prev => new Set([...prev, billingId]))
    setManualMapBillingId(null)
    setManualMapBudgetItemId('')
  }

  function recalcPinnedLines(lines, pinnedIds) {
    if (!pinnedIds || pinnedIds.size === 0) return lines
    const unpinnedLines = lines.filter(l => !pinnedIds.has(l.budget_item_id))
    const totalSched = unpinnedLines.reduce((a, l) => a + Number(l.budget_amount || 0), 0)
    if (totalSched === 0) return lines
    const totalDone = unpinnedLines.reduce((a, l) => {
      const sched = Number(l.budget_amount || 0)
      return a + sched * ((parseFloat(l.pct_prev) || 0) + (parseFloat(l.pct_this) || 0)) / 100
    }, 0)
    const overallPct = totalDone / totalSched * 100
    return lines.map(l => {
      if (!pinnedIds.has(l.budget_item_id)) return l
      const prevPct = parseFloat(l.pct_prev) || 0
      const newThisPct = Math.max(0, Math.min(100 - prevPct, overallPct - prevPct))
      return { ...l, pct_this: String(Math.round(newThisPct * 10) / 10) }
    })
  }

  function togglePinLine(budgetItemId) {
    setPinnedLineIds(prev => {
      const next = new Set(prev)
      if (next.has(budgetItemId)) next.delete(budgetItemId)
      else next.add(budgetItemId)
      try { localStorage.setItem(`aia_pinned_${id}`, JSON.stringify([...next])) } catch {}
      return next
    })
  }

  function applyBillingManual(billing) {
    if (!manualMapBudgetItemId) return
    applyAmountsToAiaLines({ [manualMapBudgetItemId]: Number(billing.amount_billed || 0) }, billing.id)
  }

  function autoCalcProRataLine(lineIndex) {
    const line = aiaLines[lineIndex]
    setAiaLines(lines => recalcPinnedLines(
      lines,
      new Set([...(pinnedLineIds || []), line.budget_item_id])
    ))
  }

  async function createAiaApplication() {
    if (!newAiaForm.period_to) return
    setSavingAia(true)
    const { data: { session } } = await supabase.auth.getSession()
    const prevApp = aiaApplications[0]
    let prevLines = []
    if (prevApp) {
      const { data: pl } = await supabase.from('aia_application_lines').select('*').eq('application_id', prevApp.id)
      prevLines = pl || []
    }
    const [year, month] = newAiaForm.period_to.split('-').map(Number)
    const periodTo = new Date(year, month, 0).toISOString().split('T')[0]
    const { data: newApp, error } = await supabase.from('aia_applications').insert({
      job_id: id,
      app_number: parseInt(newAiaForm.app_number) || (aiaApplications.length + 1),
      period_to: periodTo,
      retainage_pct: parseFloat(newAiaForm.retainage_pct) || 10,
      markup_pct: parseFloat(newAiaForm.markup_pct) || 0,
      created_by: session.user.id,
    }).select().single()
    if (error) { setErrMsg(error.message); setTimeout(() => setErrMsg(''), 4000); setSavingAia(false); return }
    if (budgetItems.length > 0) {
      const lineInserts = budgetItems.map(b => {
        const prevLine = prevLines.find(l => l.budget_item_id === b.id)
        return {
          application_id: newApp.id,
          budget_item_id: b.id,
          pct_prev: prevLine ? Math.min(100, parseFloat(prevLine.pct_prev || 0) + parseFloat(prevLine.pct_this_period || 0)) : 0,
          pct_this_period: 0,
        }
      })
      await supabase.from('aia_application_lines').insert(lineInserts)
    }
    const updatedApps = await loadAiaApplications()
    setShowNewAia(false)
    const created = updatedApps.find(a => a.id === newApp.id) || newApp
    await openAiaApp(created)
    setSavingAia(false)
  }

  async function saveAiaLines() {
    if (!activeAia) return
    setSavingAia(true)
    await supabase.from('aia_applications').update({
      retainage_pct: parseFloat(activeAia.retainage_pct),
      markup_pct: parseFloat(activeAia.markup_pct) || 0,
      status: activeAia.status || 'draft',
      updated_at: new Date().toISOString(),
    }).eq('id', activeAia.id)
    for (const line of aiaLines) {
      await supabase.from('aia_application_lines').update({
        pct_this_period: parseFloat(line.pct_this) || 0,
      }).eq('application_id', activeAia.id).eq('budget_item_id', line.budget_item_id)
    }
    await loadAiaApplications()
    setSavingAia(false)
  }

  async function deleteAiaApplication(appId) {
    if (!window.confirm('Delete this AIA application?')) return
    await supabase.from('aia_applications').delete().eq('id', appId)
    if (activeAia?.id === appId) { setActiveAia(null); setAiaLines([]); setPeriodBilling([]) }
    await loadAiaApplications()
  }

  function generateAIAFromApp() {
    if (!activeAia) return
    const app = activeAia
    const retPct = Math.max(0, Math.min(100, parseFloat(app.retainage_pct) || 10)) / 100
    const approvedCOsVal = primeCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
    const origContract = Number(job.contract_value || 0)
    const contractSumToDate = origContract + approvedCOsVal
    const periodDate = app.period_to ? new Date(app.period_to + 'T12:00:00').toLocaleDateString() : '—'
    const genDate = new Date().toLocaleDateString()
    const fmt = n => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const fmtSigned = n => (n < 0 ? '-' : '') + fmt(n)

    const sovLines = aiaLines.map((line, idx) => {
      const scheduled = Number(line.budget_amount || 0)
      const prevAmt = scheduled * Math.min(100, Math.max(0, parseFloat(line.pct_prev) || 0)) / 100
      const thisAmt = scheduled * Math.min(100, Math.max(0, parseFloat(line.pct_this) || 0)) / 100
      const totalAmt = prevAmt + thisAmt
      const totalPct = scheduled > 0 ? Math.min(100, totalAmt / scheduled * 100) : 0
      const balance = scheduled - totalAmt
      return { ...line, idx: idx + 1, scheduled, prevAmt, thisAmt, totalAmt, totalPct, balance, retainage: totalAmt * retPct }
    })

    const totalScheduled = sovLines.reduce((a, l) => a + l.scheduled, 0)
    const totalPrev = sovLines.reduce((a, l) => a + l.prevAmt, 0)
    const totalThis = sovLines.reduce((a, l) => a + l.thisAmt, 0)
    const totalCompleted = sovLines.reduce((a, l) => a + l.totalAmt, 0)
    const totalRetainage = sovLines.reduce((a, l) => a + l.retainage, 0)
    const totalEarnedLessRet = totalCompleted - totalRetainage
    const prevCertificates = totalPrev * (1 - retPct)
    const currentPaymentDue = totalEarnedLessRet - prevCertificates
    const balanceToFinish = contractSumToDate - totalCompleted
    const overallPct = totalScheduled > 0 ? (totalCompleted / totalScheduled * 100).toFixed(1) : '0.0'

    if (Math.abs(totalScheduled - contractSumToDate) > 0.01) {
      window.alert(`Cannot generate AIA — SOV total (${fmt(totalScheduled)}) doesn't match contract sum to date (${fmt(contractSumToDate)}).\n\nUpdate the budget item values in the Budget tab so the G703 balances correctly.`)
      return
    }

    const w = window.open('', '_blank')
    w.document.write(`<!DOCTYPE html><html><head>
<title>AIA G702/G703 — App #${app.app_number} — Job #${job.job_number}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 24px; line-height: 1.5; }
.btn { padding: 8px 20px; background: #111; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 12px; margin-bottom: 20px; margin-right: 8px; }
@media print { .btn { display: none; } }
h1 { font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; border-bottom: 3px solid #111; padding-bottom: 8px; margin-bottom: 4px; }
.sub { font-size: 10px; color: #777; margin-bottom: 18px; }
.hgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
.hblock { border: 1px solid #ddd; padding: 10px 12px; border-radius: 4px; }
.hlabel { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 2px; }
.hval { font-size: 12px; font-weight: 700; }
.hsub { font-size: 10px; color: #666; margin-top: 2px; }
.stitle { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #666; font-weight: 700; margin: 18px 0 8px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
.g702 { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
.g702 td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; }
.g702 td:first-child { color: #888; width: 28px; font-size: 10px; }
.g702 td:last-child { text-align: right; font-family: monospace; font-size: 12px; font-weight: 600; min-width: 130px; }
.g702 tr.due td { font-weight: 800; font-size: 13px; border-top: 2px solid #111; background: #f5f5f5; }
.page-break { page-break-before: always; padding-top: 24px; }
.g703 { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; }
.g703 th { padding: 5px 7px; border: 1px solid #ccc; background: #f0f0f0; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.3px; text-align: center; line-height: 1.3; }
.g703 td { padding: 5px 7px; border: 1px solid #e8e8e8; }
.g703 td.r { text-align: right; font-family: monospace; }
.g703 td.c { text-align: center; }
.g703 td.code { font-family: monospace; font-size: 9px; color: #888; }
.g703 tr.tot td { font-weight: 700; border-top: 2px solid #111; background: #f5f5f5; }
.foot { margin-top: 24px; font-size: 9px; color: #bbb; border-top: 1px solid #eee; padding-top: 8px; }
</style></head><body>
<button class="btn" onclick="window.print()">Print / Save as PDF</button>
<button class="btn" style="background:#666" onclick="window.close()">Close</button>

<h1>Application and Certificate for Payment</h1>
<div class="sub">AIA Document G702 &nbsp;·&nbsp; Application No. ${app.app_number} &nbsp;·&nbsp; Period to: ${periodDate}</div>

<div class="hgrid">
  <div>
    <div class="hblock" style="margin-bottom:10px">
      <div class="hlabel">To Owner</div>
      <div class="hval">${job.owner_company || '—'}</div>
      ${job.owner_name ? `<div class="hsub">${job.owner_name}</div>` : ''}
    </div>
    <div class="hblock">
      <div class="hlabel">Via Architect</div>
      <div class="hval">${job.architect_name || job.architect_company || '—'}</div>
      ${job.architect_company && job.architect_name ? `<div class="hsub">${job.architect_company}</div>` : ''}
    </div>
  </div>
  <div>
    <div class="hblock" style="margin-bottom:10px">
      <div class="hlabel">From Contractor</div>
      <div class="hval">NV Construction</div>
    </div>
    <div class="hblock">
      <div class="hlabel">Project</div>
      <div class="hval">${job.project_name}</div>
      <div class="hsub">Contract No. ${job.job_number}${job.location ? ' &nbsp;·&nbsp; ' + job.location : ''}</div>
    </div>
  </div>
</div>

<div class="stitle">Contractor's Application for Payment (G702)</div>
<table class="g702">
  <tr><td>1.</td><td>Original Contract Sum</td><td>${fmt(origContract)}</td></tr>
  <tr><td>2.</td><td>Net Change by Change Orders</td><td>${approvedCOsVal >= 0 ? '+' : ''}${fmtSigned(approvedCOsVal)}</td></tr>
  <tr><td>3.</td><td>Contract Sum to Date (Line 1 ± 2)</td><td>${fmt(contractSumToDate)}</td></tr>
  <tr><td>4.</td><td>Total Completed &amp; Stored to Date (column G, G703)</td><td>${fmt(totalCompleted)}</td></tr>
  <tr><td>5.</td><td>Retainage: ${app.retainage_pct}% of Completed Work</td><td>(${fmt(totalRetainage)})</td></tr>
  <tr><td>6.</td><td>Total Earned Less Retainage (Line 4 less 5)</td><td>${fmt(totalEarnedLessRet)}</td></tr>
  <tr><td>7.</td><td>Less Previous Certificates for Payment</td><td>(${fmt(prevCertificates)})</td></tr>
  <tr class="due"><td>8.</td><td>CURRENT PAYMENT DUE</td><td>${fmtSigned(currentPaymentDue)}</td></tr>
  <tr><td>9.</td><td>Balance to Finish, Including Retainage (Line 3 less 4)</td><td>${fmtSigned(balanceToFinish)}</td></tr>
</table>

${sovLines.length > 0 ? `
<div class="page-break">
<h1>Continuation Sheet</h1>
<div class="sub">AIA Document G703 &nbsp;·&nbsp; Application No. ${app.app_number} &nbsp;·&nbsp; ${job.project_name} &nbsp;·&nbsp; Contract No. ${job.job_number} &nbsp;·&nbsp; Period to: ${periodDate}</div>
<table class="g703">
  <thead><tr>
    <th style="width:28px">A<br>No.</th>
    <th style="width:22px">B<br>Code</th>
    <th>C — Description of Work</th>
    <th>D<br>Scheduled<br>Value</th>
    <th>E<br>Work Completed<br>From Previous<br>Application</th>
    <th>F<br>Work Completed<br>This Period</th>
    <th>G<br>Total Completed<br>&amp; Stored to Date</th>
    <th>%<br>G/C</th>
    <th>H<br>Balance<br>to Finish</th>
    <th>I<br>Retainage</th>
  </tr></thead>
  <tbody>
    ${sovLines.filter(l => l.scheduled > 0).map(l => `<tr>
      <td class="c">${l.idx}</td>
      <td class="code">${l.cost_code || ''}</td>
      <td>${l.description}</td>
      <td class="r">${fmt(l.scheduled)}</td>
      <td class="r">${fmt(l.prevAmt)}</td>
      <td class="r">${fmt(l.thisAmt)}</td>
      <td class="r">${fmt(l.totalAmt)}</td>
      <td class="c">${l.totalPct.toFixed(0)}%</td>
      <td class="r">${fmtSigned(l.balance)}</td>
      <td class="r">${fmt(l.retainage)}</td>
    </tr>`).join('')}
    <tr class="tot">
      <td colspan="3">TOTALS</td>
      <td class="r">${fmt(totalScheduled)}</td>
      <td class="r">${fmt(totalPrev)}</td>
      <td class="r">${fmt(totalThis)}</td>
      <td class="r">${fmt(totalCompleted)}</td>
      <td class="c">${overallPct}%</td>
      <td class="r">${fmtSigned(balanceToFinish)}</td>
      <td class="r">${fmt(totalRetainage)}</td>
    </tr>
  </tbody>
</table>
</div>` : ''}

<div class="foot">Generated ${genDate} &nbsp;·&nbsp; NV Construction &nbsp;·&nbsp; Job #${job.job_number} — ${job.project_name}</div>
</body></html>`)
    w.document.close()
  }

  useEffect(() => {
    if (!id) return
    if (activeTab === 'contracts') { loadContracts(); loadBudgetItems(); loadSubDirectory() }
    if (activeTab === 'budget') { loadBudgetItems(); loadContracts(); loadDirectCosts() }
    if (activeTab === 'changeorders') { loadContracts(); loadAllCOs(); loadPrimeCOs() }
    if (activeTab === 'billing') { loadBillingForJob(); loadContracts() }
    if (activeTab === 'subs') { loadSubDirectory() }
    if (activeTab === 'field') { loadFieldData() }
    if (activeTab === 'costs') { loadDirectCosts(); loadBudgetItems() }
    if (activeTab === 'prime') { loadBudgetItems(); loadAllCOs(); loadPrimeCOs(); loadAiaApplications() }
  }, [activeTab, id])


  // ── Sub SOV ─────────────────────────────────────────────────
  async function loadContractSov(contractId) {
    const { data: lines } = await supabase.from('subcontract_sov_lines').select('*').eq('subcontract_id', contractId).order('sort_order').order('created_at')
    if (!lines || lines.length === 0) { setContractSovLines(prev => ({ ...prev, [contractId]: [] })); return }
    const lineIds = lines.map(l => l.id)
    const { data: billedData } = await supabase.from('billing_sov_lines').select('sov_line_id, amount, billing_submissions(status)').in('sov_line_id', lineIds)
    const approvedBilled = {}
    ;(billedData || []).forEach(b => {
      if (b.billing_submissions?.status === 'approved') {
        approvedBilled[b.sov_line_id] = (approvedBilled[b.sov_line_id] || 0) + Number(b.amount || 0)
      }
    })
    setContractSovLines(prev => ({ ...prev, [contractId]: lines.map(l => ({ ...l, billed_to_date: approvedBilled[l.id] || 0 })) }))
  }

  async function addSovLine(contractId) {
    if (!sovLineForm.description || !sovLineForm.scheduled_value) return
    setAddingSovLine(true)
    await supabase.from('subcontract_sov_lines').insert({
      subcontract_id: contractId,
      description: sovLineForm.description,
      scheduled_value: parseFloat(sovLineForm.scheduled_value),
      sort_order: (contractSovLines[contractId]?.length || 0) + 1,
    })
    setSovLineForm({ description: '', scheduled_value: '' })
    setShowAddSovLine(null)
    await loadContractSov(contractId)
    setAddingSovLine(false)
  }

  async function updateSovLine(lineId, contractId) {
    await supabase.from('subcontract_sov_lines').update({
      description: editSovLineForm.description,
      scheduled_value: parseFloat(editSovLineForm.scheduled_value),
    }).eq('id', lineId)
    setEditingSovLine(null)
    await loadContractSov(contractId)
  }

  async function deleteSovLine(lineId, contractId) {
    if (!window.confirm('Delete this SOV line?')) return
    await supabase.from('subcontract_sov_lines').delete().eq('id', lineId)
    await loadContractSov(contractId)
  }

  async function loadBillingSov(submissionId) {
    const { data } = await supabase.from('billing_sov_lines').select('*, subcontract_sov_lines(description, scheduled_value)').eq('billing_submission_id', submissionId)
    setBillingSovData(prev => ({ ...prev, [submissionId]: data || [] }))
  }

  // ── Contracts ──────────────────────────────────────────────
  async function addContract() {
    if (!contractForm.dir_id || !contractForm.contract_value) return
    setAddingContract(true)
    const { data: { session } } = await supabase.auth.getSession()
    const dirEntry = subDirectory.find(d => d.id === contractForm.dir_id)
    const matchedSub = subs.find(s => s.sub_email?.toLowerCase() === dirEntry?.email?.toLowerCase() && s.sub_id)
    const { error } = await supabase.from('subcontracts').insert({
      job_id: id,
      sub_id: matchedSub?.sub_id || null,
      vendor_name: dirEntry?.company_name || '',
      contract_value: parseFloat(contractForm.contract_value),
      description: contractForm.description || null,
      onedrive_url: contractForm.onedrive_url || null,
      budget_item_id: contractForm.budget_item_id || null,
      retainage_pct: parseFloat(contractForm.retainage_pct) || 0,
      created_by: session.user.id,
      status: 'active',
    })
    if (error) { setErrMsg(error.message); setTimeout(() => setErrMsg(''), 4000) }
    else { setShowAddContract(false); setContractForm(emptyContract); await loadContracts() }
    setAddingContract(false)
  }

  async function updateContract() {
    const { error } = await supabase.from('subcontracts').update({
      contract_value: parseFloat(editContractForm.contract_value),
      description: editContractForm.description || null,
      onedrive_url: editContractForm.onedrive_url || null,
      budget_item_id: editContractForm.budget_item_id || null,
      retainage_pct: parseFloat(editContractForm.retainage_pct) || 0,
    }).eq('id', editingContract)
    if (error) { setErrMsg('Save failed: ' + error.message); setTimeout(() => setErrMsg(''), 5000); return }
    setEditingContract(null)
    await loadContracts()
  }

  async function deleteContract(contractId) {
    if (!window.confirm('Delete this subcontract and all its change orders?')) return
    await supabase.from('subcontracts').delete().eq('id', contractId)
    await loadContracts()
  }

  // ── Change Orders ───────────────────────────────────────────
  async function addCO() {
    if (!coForm.subcontract_id || !coForm.amount || !coForm.description) return
    setAddingCO(true)
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('change_orders').insert({
      subcontract_id: coForm.subcontract_id,
      initiated_by: session.user.id,
      direction: coForm.direction,
      amount: parseFloat(coForm.amount),
      description: coForm.description,
      status: 'pending',
    })
    setShowAddCO(false)
    setCoForm(emptyCO)
    await loadAllCOs()
    await loadContracts()
    setAddingCO(false)
  }

  async function reviewCO(coId, status) {
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('change_orders').update({ status, reviewed_by: session.user.id, reviewed_at: new Date().toISOString() }).eq('id', coId)
    await loadAllCOs()
    await loadContracts()
  }

  // ── Prime Contract Change Orders ────────────────────────────
  async function loadPrimeCOs() {
    const { data } = await supabase.from('prime_change_orders').select('*, budget_items(description, cost_code)').eq('job_id', id).order('created_at', { ascending: false })
    setPrimeCOs(data || [])
  }

  async function addPrimeCO() {
    if (!primeCOForm.amount || !primeCOForm.description) return
    setAddingPrimeCO(true)
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('prime_change_orders').insert({
      job_id: id,
      description: primeCOForm.description,
      amount: parseFloat(primeCOForm.amount),
      budget_item_id: primeCOForm.budget_item_id || null,
      notes: primeCOForm.notes || null,
      status: 'pending',
      created_by: session.user.id,
    })
    if (error) { setErrMsg(error.message); setTimeout(() => setErrMsg(''), 4000) }
    else { setShowAddPrimeCO(false); setPrimeCOForm(emptyPrimeCO); await loadPrimeCOs() }
    setAddingPrimeCO(false)
  }

  async function reviewPrimeCO(coId, status) {
    const { error } = await supabase.from('prime_change_orders').update({ status }).eq('id', coId)
    if (error) { alert('Error updating prime CO: ' + error.message); return }
    await loadPrimeCOs()
  }

  async function deletePrimeCO(coId) {
    if (!window.confirm('Delete this prime contract change order?')) return
    await supabase.from('prime_change_orders').delete().eq('id', coId)
    await loadPrimeCOs()
  }

  // ── Budget ──────────────────────────────────────────────────
  async function saveBudgetItem(e) {
    e.preventDefault()
    setAddingBudgetItem(true)
    await supabase.from('budget_items').insert({
      job_id: id,
      cost_code: budgetItemForm.cost_code || null,
      description: budgetItemForm.description,
      budget_amount: parseFloat(budgetItemForm.budget_amount),
      owner_amount: budgetItemForm.owner_amount ? parseFloat(budgetItemForm.owner_amount) : null,
    })
    await loadBudgetItems()
    setShowAddBudgetItem(false)
    setBudgetItemForm(emptyBudgetItem)
    setAddingBudgetItem(false)
  }

  async function updateBudgetItem(e) {
    e.preventDefault()
    await supabase.from('budget_items').update({
      cost_code: editBudgetForm.cost_code || null,
      description: editBudgetForm.description,
      budget_amount: parseFloat(editBudgetForm.budget_amount),
      owner_amount: editBudgetForm.owner_amount ? parseFloat(editBudgetForm.owner_amount) : null,
    }).eq('id', editingBudgetItem)
    setEditingBudgetItem(null)
    await loadBudgetItems()
  }

  async function deleteBudgetItem(itemId) {
    if (!window.confirm('Delete this budget line?')) return
    await supabase.from('budget_items').delete().eq('id', itemId)
    await loadBudgetItems()
  }

  async function handleCSVUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setCsvUploading(true)
    try {
      const text = await file.text()
      const lines = text.trim().split(/\r?\n/)
      const isHeader = isNaN(parseFloat(lines[0].split(',').slice(-1)[0].replace(/"/g, '')))
      const rows = []
      for (let i = isHeader ? 1 : 0; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
        if (cols.length >= 2 && cols[1]) {
          rows.push({ job_id: id, cost_code: cols[0] || null, description: cols[1], budget_amount: parseFloat(cols[2]) || 0 })
        }
      }
      if (rows.length > 0) { await supabase.from('budget_items').insert(rows); await loadBudgetItems() }
    } catch (err) {
      setErrMsg('CSV import failed: ' + err.message)
      setTimeout(() => setErrMsg(''), 4000)
    }
    e.target.value = ''
    setCsvUploading(false)
  }

  function committedForItem(budgetItemId) {
    return contracts.filter(c => c.budget_item_id === budgetItemId).reduce((a, c) => a + Number(c.adjusted_contract_value || c.contract_value || 0), 0)
  }

  async function saveForecastEac(budgetItemId, value) {
    const val = value === '' ? null : parseFloat(value)
    await supabase.from('budget_items').update({ forecast_eac: val }).eq('id', budgetItemId)
    setBudgetItems(prev => prev.map(b => b.id === budgetItemId ? { ...b, forecast_eac: val } : b))
  }

  // ── Subs ────────────────────────────────────────────────────
  async function assignSubToJob() {
    const email = assignSubForm.from_dir
      ? subDirectory.find(d => d.id === assignSubForm.from_dir)?.email
      : assignSubForm.email.trim()
    if (!email) return
    setAssigningSubLoading(true)
    const { error } = await supabase.from('job_assignments').insert({ job_id: id, sub_email: email.toLowerCase() })
    if (error) {
      setErrMsg(error.code === '23505' ? 'This sub is already assigned to this job.' : error.message)
      setTimeout(() => setErrMsg(''), 4000)
    } else {
      await supabase.rpc('sync_job_assignments')
      await reloadSubs()
      setShowAssignSub(false)
      setAssignSubForm({ email: '', from_dir: '' })
    }
    setAssigningSubLoading(false)
  }

  async function removeSubFromJob(assignmentId) {
    if (!window.confirm('Remove this subcontractor from this job?')) return
    await supabase.from('job_assignments').delete().eq('id', assignmentId)
    await reloadSubs()
  }

  // ── Billing (PM-managed) ─────────────────────────────────────
  async function createBilling() {
    if (!createBillingForm.amount_billed || !createBillingForm.company_name) return
    setCreatingBilling(true)
    const now = new Date().toISOString()
    const status = createBillingForm.auto_approve ? 'approved' : 'pending'
    const amtBilled = parseFloat(createBillingForm.amount_billed) || 0
    const retPct = parseFloat(createBillingForm._retainage_pct) || 0
    const retHeld = Math.round(amtBilled * retPct / 100 * 100) / 100
    const { error } = await supabase.from('billing_submissions').insert({
      job_id: id,
      company_name: createBillingForm.company_name,
      contact_name: createBillingForm.contact_name || null,
      contact_info: createBillingForm.contact_info || null,
      amount_billed: amtBilled,
      retainage_pct: retPct,
      retainage_held: retHeld,
      pct_complete: createBillingForm.pct_complete ? parseFloat(createBillingForm.pct_complete) : null,
      work_description: createBillingForm.work_description || null,
      billing_period: createBillingForm.billing_period ? createBillingForm.billing_period + '-01' : null,
      status,
      submitted_at: now,
      reviewed_at: status === 'approved' ? now : null,
    })
    if (error) { setCreateBillingError(error.message) }
    else {
      setCreateBillingError('')
      setShowCreateBilling(false)
      setCreateBillingForm(emptyCreateBilling)
      await loadBillingForJob()
    }
    setCreatingBilling(false)
  }

  async function updateBillingEntry() {
    const now = new Date().toISOString()
    const editAmt = parseFloat(editBillingForm.amount_billed) || 0
    const editRetPct = parseFloat(editBillingForm.retainage_pct) || 0
    await supabase.from('billing_submissions').update({
      company_name: editBillingForm.company_name,
      contact_name: editBillingForm.contact_name || null,
      contact_info: editBillingForm.contact_info || null,
      amount_billed: editAmt,
      retainage_pct: editRetPct,
      retainage_held: Math.round(editAmt * editRetPct / 100 * 100) / 100,
      pct_complete: editBillingForm.pct_complete ? parseFloat(editBillingForm.pct_complete) : null,
      work_description: editBillingForm.work_description || null,
      billing_period: editBillingForm.billing_period ? editBillingForm.billing_period + '-01' : null,
      status: editBillingForm.status,
      reviewed_at: editBillingForm.status !== 'pending' ? now : null,
    }).eq('id', editingBilling)
    setEditingBilling(null)
    await loadBillingForJob()
  }

  async function deleteBillingEntry(billingId) {
    if (!window.confirm('Delete this billing submission?')) return
    await supabase.from('billing_submissions').delete().eq('id', billingId)
    await loadBillingForJob()
  }

  // ── Job ─────────────────────────────────────────────────────
  async function saveJob(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('jobs').update({
      job_number: form.job_number, project_name: form.project_name, location: form.location,
      contract_value: form.contract_value ? parseFloat(form.contract_value) : null,
      start_date: form.start_date || null, status: form.status,
      owner_company: form.owner_company, owner_name: form.owner_name, owner_email: form.owner_email, owner_phone: form.owner_phone,
      architect_name: form.architect_name, architect_company: form.architect_company, architect_email: form.architect_email,
      engineer_name: form.engineer_name, engineer_company: form.engineer_company, engineer_email: form.engineer_email,
      permit_number: form.permit_number, permit_date: form.permit_date || null, scope_notes: form.scope_notes,
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

  // ── PDF exports ──────────────────────────────────────────────
  function exportContractsPDF() {
    const w = window.open('', '_blank')
    const date = new Date().toLocaleDateString()
    const rows = contracts.map(c => ({ c, subName: c.vendor_name || registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown' }))
    w.document.write(`<!DOCTYPE html><html><head>
<title>Subcontract Summary — Job #${job.job_number}</title>
<style>* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, Arial, sans-serif; color: #111; padding: 40px; font-size: 13px; line-height: 1.5; }
h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; } .meta { color: #666; margin-bottom: 28px; }
.print-btn { padding: 8px 20px; background: #111; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 28px; }
.section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #888; font-weight: 700; margin-bottom: 12px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #111; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
td { padding: 10px; border-bottom: 1px solid #eee; vertical-align: top; }
.right { text-align: right; } .over { color: #cc0000; }
.total td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; }
.generated { font-size: 11px; color: #aaa; margin-top: 40px; }
@media print { .print-btn { display: none; } }</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<h1>#${job.job_number} — ${job.project_name}</h1>
<p class="meta">${[job.location, job.start_date ? 'Started ' + new Date(job.start_date).toLocaleDateString() : ''].filter(Boolean).join(' · ')}</p>
<div class="section-title">Subcontract Summary</div>
<table><thead><tr><th>Subcontractor</th><th>Scope</th><th class="right">Contract</th><th class="right">COs</th><th class="right">Revised</th><th class="right">Remaining</th></tr></thead>
<tbody>${rows.map(({ c, subName }) => `<tr><td>${subName}</td><td style="color:#666">${c.description || '—'}</td><td class="right">$${Number(c.contract_value).toLocaleString()}</td><td class="right">${Number(c.approved_change_orders) >= 0 ? '+' : ''}$${Number(c.approved_change_orders).toLocaleString()}</td><td class="right">$${Number(c.adjusted_contract_value).toLocaleString()}</td><td class="right ${Number(c.remaining_balance) < 0 ? 'over' : ''}">$${Number(c.remaining_balance).toLocaleString()}</td></tr>`).join('')}
<tr class="total"><td colspan="2">Total</td><td class="right">$${totalContractValue.toLocaleString()}</td><td class="right">${totalCOs >= 0 ? '+' : ''}$${Math.abs(totalCOs).toLocaleString()}</td><td class="right">$${totalRevised.toLocaleString()}</td><td></td></tr>
</tbody></table><p class="generated">Generated ${date} · NV Construction</p></body></html>`)
    w.document.close()
  }

  function exportBudgetPDF() {
    const w = window.open('', '_blank')
    const date = new Date().toLocaleDateString()
    w.document.write(`<!DOCTYPE html><html><head>
<title>Budget Report — Job #${job.job_number}</title>
<style>* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, Arial, sans-serif; color: #111; padding: 40px; font-size: 13px; line-height: 1.5; }
h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; } .meta { color: #666; margin-bottom: 28px; }
.print-btn { padding: 8px 20px; background: #111; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 28px; }
.summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
.stat { padding: 14px 16px; border: 1px solid #ddd; border-radius: 8px; }
.stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 800; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #111; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
td { padding: 10px; border-bottom: 1px solid #eee; }
.right { text-align: right; } .mono { font-family: monospace; font-size: 11px; color: #888; } .over { color: #cc0000; }
.total td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; }
.generated { font-size: 11px; color: #aaa; margin-top: 40px; }
@media print { .print-btn { display: none; } }</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<h1>#${job.job_number} — ${job.project_name}</h1>
<p class="meta">${[job.location, job.start_date ? 'Started ' + new Date(job.start_date).toLocaleDateString() : ''].filter(Boolean).join(' · ')}</p>
<div class="summary">
  <div class="stat"><div class="stat-label">Total budget</div><div class="stat-value">$${totalBudget.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-label">Committed</div><div class="stat-value">$${totalCommitted.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-label">Uncommitted</div><div class="stat-value ${totalUncommitted < 0 ? 'over' : ''}">${totalUncommitted < 0 ? '-' : ''}$${Math.abs(totalUncommitted).toLocaleString()}</div></div>
</div>
<table><thead><tr><th>Code</th><th>Description</th><th class="right">Budget</th><th class="right">Committed</th><th class="right">Uncommitted</th><th class="right">% Used</th></tr></thead>
<tbody>${budgetItems.map(item => { const committed = committedForItem(item.id); const uncommitted = Number(item.budget_amount) - committed; const pct = Number(item.budget_amount) > 0 ? (committed / Number(item.budget_amount) * 100).toFixed(0) : 0; const over = uncommitted < 0; return `<tr><td class="mono">${item.cost_code || '—'}</td><td>${item.description}</td><td class="right">$${Number(item.budget_amount).toLocaleString()}</td><td class="right">$${committed.toLocaleString()}</td><td class="right ${over ? 'over' : ''}">${over ? '-' : ''}$${Math.abs(uncommitted).toLocaleString()}</td><td class="right ${over ? 'over' : ''}">${pct}%</td></tr>` }).join('')}
<tr class="total"><td></td><td>Total</td><td class="right">$${totalBudget.toLocaleString()}</td><td class="right">$${totalCommitted.toLocaleString()}</td><td class="right ${totalUncommitted < 0 ? 'over' : ''}">${totalUncommitted < 0 ? '-' : ''}$${Math.abs(totalUncommitted).toLocaleString()}</td><td class="right">${totalBudget > 0 ? ((totalCommitted / totalBudget) * 100).toFixed(0) : 0}%</td></tr>
</tbody></table><p class="generated">Generated ${date} · NV Construction</p></body></html>`)
    w.document.close()
  }

  // ── Derived values ───────────────────────────────────────────
  const totalBilled = billing.reduce((a, b) => a + (b.amount_billed || 0), 0)
  const pendingBilling = billing.filter(b => b.status === 'pending').length
  const pctContract = job?.contract_value ? ((totalBilled / job.contract_value) * 100).toFixed(1) : null
  const totalContractValue = contracts.reduce((a, c) => a + Number(c.contract_value || 0), 0)
  const totalCOs = contracts.reduce((a, c) => a + Number(c.approved_change_orders || 0), 0)
  const totalRevised = contracts.reduce((a, c) => a + Number(c.adjusted_contract_value || 0), 0)
  const totalBudget = budgetItems.reduce((a, b) => a + Number(b.budget_amount || 0), 0)
  const totalOwnerSOV = budgetItems.reduce((a, b) => a + Number(b.owner_amount ?? b.budget_amount ?? 0), 0)
  const totalMarkup = totalOwnerSOV - totalBudget
  const totalCommitted = budgetItems.reduce((a, b) => a + committedForItem(b.id), 0)
  const totalUncommitted = totalBudget - totalCommitted
  const registeredSubs = subs.filter(s => s.sub_id)
  const pendingCOs = allCOs.filter(co => co.status === 'pending').length
  const approvedCOValue = allCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
  const pendingBillingCount = billingSubmissions.filter(b => b.status === 'pending').length
  const approvedBillingTotal = billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.amount_billed || 0), 0)

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
        {errMsg && <div style={s.errorMsg}>{errMsg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={s.jobTitle}>#{job.job_number} — {job.project_name}</h1>
            <p style={s.jobMeta}>{job.location}{job.start_date ? ' · Started ' + new Date(job.start_date).toLocaleDateString() : ''}</p>
          </div>
          <span style={s.badge(job.archived ? 'archived' : job.status)}>{job.archived ? 'Archived' : job.status}</span>
        </div>

        <div style={s.statRow}>
          <div style={s.statCard}><div style={s.statLabel}>Total billed</div><div style={s.statValue()}>${totalBilled.toLocaleString()}</div></div>
          <div style={s.statCard}><div style={s.statLabel}>Contract value</div><div style={s.statValue()}>{job.contract_value ? '$' + parseFloat(job.contract_value).toLocaleString() : '—'}</div></div>
          <div style={s.statCard}><div style={s.statLabel}>% billed</div><div style={s.statValue('#e8590c')}>{pctContract ? pctContract + '%' : '—'}</div></div>
        </div>

        <div style={s.tabRow}>
          <button style={s.tab(activeTab === 'details')} onClick={() => setActiveTab('details')}>Details</button>
          <button style={s.tab(activeTab === 'subs')} onClick={() => setActiveTab('subs')}>
            Subs{subs.length > 0 ? ` (${subs.length})` : ''}
          </button>
          <button style={s.tab(activeTab === 'budget')} onClick={() => setActiveTab('budget')}>
            Budget{budgetItems.length > 0 ? ` (${budgetItems.length})` : ''}
          </button>
          <button style={s.tab(activeTab === 'contracts')} onClick={() => setActiveTab('contracts')}>
            Contracts{contracts.length > 0 ? ` (${contracts.length})` : ''}
          </button>
          <button style={s.tab(activeTab === 'changeorders')} onClick={() => setActiveTab('changeorders')}>
            Change Orders{pendingCOs > 0 ? ` (${pendingCOs} pending)` : allCOs.length > 0 ? ` (${allCOs.length})` : ''}
          </button>
          <button style={s.tab(activeTab === 'billing')} onClick={() => setActiveTab('billing')}>
            Billing{pendingBillingCount > 0 ? ` (${pendingBillingCount} pending)` : billingSubmissions.length > 0 ? ` (${billingSubmissions.length})` : ''}
          </button>
          <button style={s.tab(activeTab === 'field')} onClick={() => setActiveTab('field')}>
            Field{fieldRfis.filter(r => r.status === 'open').length > 0 ? ` (${fieldRfis.filter(r => r.status === 'open').length} RFI)` : ''}
          </button>
          <button style={s.tab(activeTab === 'costs')} onClick={() => setActiveTab('costs')}>
            Direct Costs{directCosts.filter(c => c.status === 'pending').length > 0 ? ` (${directCosts.filter(c => c.status === 'pending').length} pending)` : directCosts.length > 0 ? ` (${directCosts.length})` : ''}
          </button>
          <button style={s.tab(activeTab === 'prime')} onClick={() => setActiveTab('prime')}>Prime Contract</button>
        </div>

        {/* ── DETAILS TAB ── */}
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
                  <div><label style={s.label}>Owner company</label><input style={s.input} value={form.owner_company || ''} onChange={e => update('owner_company', e.target.value)} /></div>
                  <div><label style={s.label}>Owner name</label><input style={s.input} value={form.owner_name || ''} onChange={e => update('owner_name', e.target.value)} /></div>
                </div>
                <div style={s.grid2}>
                  <div><label style={s.label}>Owner email</label><input style={s.input} value={form.owner_email || ''} onChange={e => update('owner_email', e.target.value)} /></div>
                  <div><label style={s.label}>Owner phone</label><input style={s.input} value={form.owner_phone || ''} onChange={e => update('owner_phone', e.target.value)} /></div>
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
                  <div><label style={s.label}>Permit number</label><input style={s.input} value={form.permit_number || ''} onChange={e => update('permit_number', e.target.value)} /></div>
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
                  <p style={{ color: '#ff6b6b', fontSize: '14px', margin: '0 0 1rem' }}>This will permanently delete the job, all billing submissions, and all sub assignments. This cannot be undone.</p>
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
              <p style={s.cardTitle}>Billing activity ({billing.length} submissions · {pendingBilling} pending)</p>
              {billing.length === 0 ? <p style={{ color: '#444', fontSize: '14px' }}>No billing submissions yet.</p> : billing.map(b => (
                <div key={b.id} style={s.billingRow}>
                  <div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{b.company_name}</p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#555', marginTop: '3px' }}>{new Date(b.submitted_at).toLocaleDateString()} · {b.pct_complete}% complete</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <span style={{ fontWeight: '700', color: '#f1f1f1' }}>${b.amount_billed?.toLocaleString()}</span>
                    <span style={s.coBadge(b.status)}>{b.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── SUBS TAB ── */}
        {activeTab === 'subs' && (
          <>
            <div style={s.statRow}>
              <div style={s.statCard}><div style={s.statLabel}>Assigned</div><div style={s.statValue()}>{subs.length}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Portal access</div><div style={s.statValue('#4ade80')}>{registeredSubs.length}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Not registered</div><div style={s.statValue(subs.length - registeredSubs.length > 0 ? '#e8590c' : undefined)}>{subs.length - registeredSubs.length}</div></div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Assigned subcontractors ({subs.length})</p>
                {!showAssignSub && <button style={s.btnSmallOrange} onClick={() => { setShowAssignSub(true); loadSubDirectory() }}>+ Assign sub</button>}
              </div>

              {showAssignSub && (
                <div style={{ ...s.inlineForm, border: '1px solid #4a2200' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Assign subcontractor to job</p>

                  {subDirectory.filter(d => !subs.some(s => s.sub_email?.toLowerCase() === d.email?.toLowerCase())).length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <label style={s.label}>Pick from approved directory</label>
                      <select style={s.input} value={assignSubForm.from_dir}
                        onChange={e => setAssignSubForm({ from_dir: e.target.value, email: '' })}>
                        <option value="">— Select company —</option>
                        {subDirectory
                          .filter(d => !subs.some(s => s.sub_email?.toLowerCase() === d.email?.toLowerCase()))
                          .map(d => <option key={d.id} value={d.id}>{d.company_name}{d.trade ? ` · ${d.trade}` : ''}</option>)}
                      </select>
                    </div>
                  )}

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={s.label}>{subDirectory.length > 0 ? 'Or assign by email directly' : 'Email address'}</label>
                    <input type="email" style={s.input} placeholder="sub@company.com"
                      value={assignSubForm.email}
                      onChange={e => setAssignSubForm({ email: e.target.value, from_dir: '' })} />
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: assigningSubLoading ? 0.6 : 1 }}
                      disabled={assigningSubLoading || (!assignSubForm.from_dir && !assignSubForm.email)}
                      onClick={assignSubToJob}>
                      {assigningSubLoading ? 'Assigning...' : 'Assign & enable billing'}
                    </button>
                    <button style={s.btnGray} onClick={() => { setShowAssignSub(false); setAssignSubForm({ email: '', from_dir: '' }) }}>Cancel</button>
                  </div>
                </div>
              )}

              {subs.length === 0 && !showAssignSub && (
                <p style={{ color: '#444', fontSize: '14px' }}>No subcontractors assigned yet.</p>
              )}

              {subs.map(a => {
                const dirEntry = subDirectory.find(d => d.email?.toLowerCase() === a.sub_email?.toLowerCase())
                const companyName = a.profiles?.company_name || dirEntry?.company_name || a.sub_email || 'Unknown'
                const contactName = a.profiles?.full_name || dirEntry?.contact_name
                const phone = a.profiles?.phone || dirEntry?.phone
                const address = dirEntry?.address
                const isRegistered = !!a.sub_id
                return (
                  <div key={a.id} style={{ ...s.contractRow, marginBottom: '8px' }}>
                    <div style={{ ...s.contractRowHeader, flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '15px', fontWeight: '700', color: '#f1f1f1' }}>{companyName}</span>
                          <span style={{
                            fontSize: '11px', padding: '2px 8px', borderRadius: '99px', fontWeight: '700',
                            background: isRegistered ? '#0a2a0a' : '#1a1a1a',
                            color: isRegistered ? '#4ade80' : '#555',
                            border: `1px solid ${isRegistered ? '#1a4a1a' : '#2a2a2a'}`
                          }}>{isRegistered ? 'Registered' : 'Not registered'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', color: '#555' }}>
                          {contactName && <span>{contactName}</span>}
                          {phone && <span>{phone}</span>}
                          {a.sub_email && <span>{a.sub_email}</span>}
                          {address && <span>{address}</span>}
                        </div>
                      </div>
                      <button style={s.btnSmallRed} onClick={() => removeSubFromJob(a.id)}>Remove</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── BUDGET TAB ── */}
        {activeTab === 'budget' && (
          <>
            <div style={s.statRow}>
              <div style={s.statCard}>
                <div style={s.statLabel}>Internal budget</div>
                <div style={s.statValue()}>${totalBudget.toLocaleString()}</div>
                <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>Your actual cost target</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statLabel}>Owner SOV total</div>
                <div style={s.statValue('#60a5fa')}>${totalOwnerSOV.toLocaleString()}</div>
                <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>What owner sees on AIA</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statLabel}>Gross profit</div>
                <div style={s.statValue(totalMarkup > 0 ? '#4ade80' : '#555')}>{totalMarkup > 0 ? '+' : ''}${totalMarkup.toLocaleString()}</div>
                {totalBudget > 0 && totalMarkup > 0 && <div style={{ fontSize: '12px', color: '#4ade80', marginTop: '4px' }}>{((totalMarkup / totalBudget) * 100).toFixed(1)}% margin</div>}
              </div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Budget lines ({budgetItems.length})</p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {budgetItems.length > 0 && <button style={s.btnSmall} onClick={exportBudgetPDF}>Export PDF</button>}
                  <label style={{ ...s.btnSmall, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                    {csvUploading ? 'Importing...' : 'Import CSV'}
                    <input type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleCSVUpload} disabled={csvUploading} />
                  </label>
                  <button style={s.btnSmallOrange} onClick={() => setShowAddBudgetItem(v => !v)}>
                    {showAddBudgetItem ? 'Cancel' : '+ Add line'}
                  </button>
                </div>
              </div>
              <p style={{ fontSize: '12px', color: '#333', margin: '0 0 1.25rem' }}>CSV format: cost_code, description, amount · Header row optional</p>

              {showAddBudgetItem && (
                <form onSubmit={saveBudgetItem} style={s.inlineForm}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: '12px', marginBottom: '8px' }}>
                    <div><label style={s.label}>Cost code</label><input style={s.input} value={budgetItemForm.cost_code} onChange={e => setBudgetItemForm(f => ({ ...f, cost_code: e.target.value }))} placeholder="03-000" /></div>
                    <div><label style={s.label}>Description *</label><input style={s.input} value={budgetItemForm.description} onChange={e => setBudgetItemForm(f => ({ ...f, description: e.target.value }))} required placeholder="Concrete" /></div>
                    <div><label style={s.label}>Internal budget *</label><input type="number" step="0.01" style={s.input} value={budgetItemForm.budget_amount} onChange={e => setBudgetItemForm(f => ({ ...f, budget_amount: e.target.value }))} required placeholder="0.00" /></div>
                    <div><label style={s.label}>Owner SOV amount</label><input type="number" step="0.01" style={s.input} value={budgetItemForm.owner_amount} onChange={e => setBudgetItemForm(f => ({ ...f, owner_amount: e.target.value }))} placeholder="Leave blank = same as budget" /></div>
                  </div>
                  <p style={{ fontSize: '11px', color: '#444', margin: '0 0 10px' }}>Owner SOV is what appears on the AIA G702/G703. Leave blank to match internal budget.</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" style={{ ...s.btnSmallOrange, opacity: addingBudgetItem ? 0.6 : 1 }} disabled={addingBudgetItem}>{addingBudgetItem ? 'Saving...' : 'Save line'}</button>
                    <button type="button" style={s.btnSmall} onClick={() => setShowAddBudgetItem(false)}>Cancel</button>
                  </div>
                </form>
              )}

              {editingBudgetItem && (
                <form onSubmit={updateBudgetItem} style={{ ...s.inlineForm, border: '1px solid #4a2200' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Edit budget line</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div><label style={s.label}>Cost code</label><input style={s.input} value={editBudgetForm.cost_code || ''} onChange={e => setEditBudgetForm(f => ({ ...f, cost_code: e.target.value }))} placeholder="03-000" /></div>
                    <div><label style={s.label}>Description</label><input style={s.input} value={editBudgetForm.description || ''} onChange={e => setEditBudgetForm(f => ({ ...f, description: e.target.value }))} required /></div>
                    <div><label style={s.label}>Internal budget</label><input type="number" step="0.01" style={s.input} value={editBudgetForm.budget_amount || ''} onChange={e => setEditBudgetForm(f => ({ ...f, budget_amount: e.target.value }))} required /></div>
                    <div><label style={s.label}>Owner SOV amount</label><input type="number" step="0.01" style={s.input} value={editBudgetForm.owner_amount || ''} onChange={e => setEditBudgetForm(f => ({ ...f, owner_amount: e.target.value }))} placeholder="Blank = same as budget" /></div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" style={s.btnSmallOrange}>Save changes</button>
                    <button type="button" style={s.btnSmall} onClick={() => setEditingBudgetItem(null)}>Cancel</button>
                  </div>
                </form>
              )}

              {budgetItems.length === 0 && !showAddBudgetItem && (
                <p style={{ color: '#444', fontSize: '14px' }}>No budget lines yet. Import a CSV or add lines manually.</p>
              )}

              {budgetItems.length > 0 && (
                <>
                  <div style={s.budgetTableHeader}>
                    <span>Description</span>
                    <span style={{ textAlign: 'right' }}>Internal</span>
                    <span style={{ textAlign: 'right' }}>Owner SOV</span>
                    <span style={{ textAlign: 'right' }}>Committed</span>
                    <span style={{ textAlign: 'right' }}>Uncommitted</span>
                    <span style={{ textAlign: 'right' }}>% Used</span>
                    <span></span>
                  </div>
                  {budgetItems.map(item => {
                    const committed = committedForItem(item.id)
                    const uncommitted = Number(item.budget_amount) - committed
                    const pct = Number(item.budget_amount) > 0 ? Math.min(110, (committed / Number(item.budget_amount)) * 100) : 0
                    const over = uncommitted < 0
                    const ownerAmt = item.owner_amount != null ? Number(item.owner_amount) : Number(item.budget_amount)
                    const markup = ownerAmt - Number(item.budget_amount)
                    return (
                      <div key={item.id} style={{ ...s.budgetTableRow, opacity: editingBudgetItem === item.id ? 0.4 : 1 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                            {item.cost_code && <span style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace', flexShrink: 0 }}>{item.cost_code}</span>}
                            <span style={{ fontSize: '14px', color: '#f1f1f1' }}>{item.description}</span>
                          </div>
                          <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '2px', marginTop: '8px' }}>
                            <div style={{ height: '100%', width: Math.min(100, pct) + '%', background: over ? '#ff6b6b' : pct > 85 ? '#e8590c' : '#4ade80', borderRadius: '2px' }} />
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '14px', color: '#f1f1f1', fontWeight: '600' }}>${Number(item.budget_amount).toLocaleString()}</div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '14px', color: '#60a5fa', fontWeight: '600' }}>${ownerAmt.toLocaleString()}</div>
                          {markup !== 0 && <div style={{ fontSize: '11px', color: markup > 0 ? '#4ade80' : '#ff6b6b', marginTop: '2px' }}>{markup > 0 ? '+' : ''}{((markup / Number(item.budget_amount)) * 100).toFixed(1)}%</div>}
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '14px', color: committed > 0 ? '#e8590c' : '#444', fontWeight: '600' }}>${committed.toLocaleString()}</div>
                        <div style={{ textAlign: 'right', fontSize: '14px', color: over ? '#ff6b6b' : '#4ade80', fontWeight: '600' }}>{over ? '-' : ''}${Math.abs(uncommitted).toLocaleString()}</div>
                        <div style={{ textAlign: 'right', fontSize: '13px', color: over ? '#ff6b6b' : pct > 85 ? '#e8590c' : '#555' }}>{pct.toFixed(0)}%</div>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button style={s.btnSmall} onClick={() => { setEditingBudgetItem(item.id); setEditBudgetForm({ cost_code: item.cost_code || '', description: item.description, budget_amount: item.budget_amount, owner_amount: item.owner_amount || '' }); setShowAddBudgetItem(false) }}>Edit</button>
                          <button style={s.btnSmallRed} onClick={() => deleteBudgetItem(item.id)}>Del</button>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>

            {/* Cost to Complete Forecast */}
            {budgetItems.length > 0 && (() => {
              const forecastRows = budgetItems.map(item => {
                const spent = directCosts.filter(c => c.status === 'approved' && c.budget_item_id === item.id).reduce((a, c) => a + Number(c.amount || 0), 0)
                const contracted = committedForItem(item.id)
                const autoEac = Math.max(contracted, spent)
                const eac = item.forecast_eac != null ? Number(item.forecast_eac) : autoEac
                const revenue = item.owner_amount != null ? Number(item.owner_amount) : Number(item.budget_amount)
                return { item, spent, contracted, autoEac, eac, revenue, variance: Number(item.budget_amount) - eac, projProfit: revenue - eac }
              })
              const T = forecastRows.reduce((acc, r) => ({
                budget: acc.budget + Number(r.item.budget_amount), revenue: acc.revenue + r.revenue,
                spent: acc.spent + r.spent, contracted: acc.contracted + r.contracted,
                eac: acc.eac + r.eac, variance: acc.variance + r.variance, projProfit: acc.projProfit + r.projProfit,
              }), { budget: 0, revenue: 0, spent: 0, contracted: 0, eac: 0, variance: 0, projProfit: 0 })
              const hdr = { fontSize: '11px', color: '#555', textAlign: 'right' }
              const col = { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.2fr 1fr 1fr', gap: '8px', padding: '8px 12px' }
              return (
                <div style={s.card}>
                  <p style={{ ...s.cardTitle, marginBottom: '0.5rem' }}>Cost to Complete Forecast</p>
                  <p style={{ fontSize: '12px', color: '#444', margin: '0 0 1rem' }}>EAC = Estimate at Completion. Auto-calculates as max(contracted, direct costs spent). Enter a value to override.</p>
                  <div style={{ ...s.statRow, marginBottom: '1.25rem' }}>
                    <div style={s.statCard}><div style={s.statLabel}>Proj. profit</div><div style={s.statValue(T.projProfit >= 0 ? '#4ade80' : '#ff6b6b')}>{T.projProfit >= 0 ? '+' : '-'}${Math.abs(T.projProfit).toLocaleString()}</div></div>
                    <div style={s.statCard}><div style={s.statLabel}>Budget variance</div><div style={s.statValue(T.variance >= 0 ? '#4ade80' : '#ff6b6b')}>{T.variance >= 0 ? '+' : '-'}${Math.abs(T.variance).toLocaleString()}</div></div>
                    <div style={s.statCard}><div style={s.statLabel}>Direct costs spent</div><div style={s.statValue()}>${T.spent.toLocaleString()}</div></div>
                    <div style={s.statCard}><div style={s.statLabel}>Total EAC</div><div style={s.statValue()}>${T.eac.toLocaleString()}</div></div>
                  </div>
                  <div style={{ ...col, borderBottom: '1px solid #1a1a1a', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#555' }}>Description</span>
                    {['Budget', 'Revenue', 'DC Spent', 'Contracted', 'EAC override', 'Variance', 'Proj. Profit'].map(h => <span key={h} style={hdr}>{h}</span>)}
                  </div>
                  {forecastRows.map(({ item, spent, contracted, autoEac, eac, revenue, variance, projProfit }) => (
                    <div key={item.id} style={{ ...col, borderBottom: '1px solid #111', alignItems: 'center' }}>
                      <div>
                        {item.cost_code && <span style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace' }}>{item.cost_code} · </span>}
                        <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{item.description}</span>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '13px', color: '#f1f1f1' }}>${Number(item.budget_amount).toLocaleString()}</div>
                      <div style={{ textAlign: 'right', fontSize: '13px', color: '#60a5fa' }}>${revenue.toLocaleString()}</div>
                      <div style={{ textAlign: 'right', fontSize: '13px', color: '#aaa' }}>${spent.toLocaleString()}</div>
                      <div style={{ textAlign: 'right', fontSize: '13px', color: '#aaa' }}>${contracted.toLocaleString()}</div>
                      <div>
                        <input
                          type="number" step="0.01"
                          style={{ ...s.input, textAlign: 'right', padding: '4px 8px', fontSize: '12px' }}
                          placeholder={autoEac.toLocaleString()}
                          value={item.forecast_eac != null ? String(item.forecast_eac) : ''}
                          onChange={e => setBudgetItems(prev => prev.map(b => b.id === item.id ? { ...b, forecast_eac: e.target.value === '' ? null : e.target.value } : b))}
                          onBlur={e => saveForecastEac(item.id, e.target.value)}
                        />
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: '600', color: variance >= 0 ? '#4ade80' : '#ff6b6b' }}>{variance >= 0 ? '+' : '-'}${Math.abs(variance).toLocaleString()}</div>
                      <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: '600', color: projProfit >= 0 ? '#4ade80' : '#ff6b6b' }}>{projProfit >= 0 ? '+' : '-'}${Math.abs(projProfit).toLocaleString()}</div>
                    </div>
                  ))}
                  <div style={{ ...col, borderTop: '2px solid #222', marginTop: '4px' }}>
                    <span style={{ fontSize: '13px', color: '#555', fontWeight: '700' }}>TOTAL</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#f1f1f1', fontWeight: '700' }}>${T.budget.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#60a5fa', fontWeight: '700' }}>${T.revenue.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#aaa', fontWeight: '700' }}>${T.spent.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#aaa', fontWeight: '700' }}>${T.contracted.toLocaleString()}</span>
                    <span />
                    <span style={{ textAlign: 'right', fontSize: '13px', fontWeight: '700', color: T.variance >= 0 ? '#4ade80' : '#ff6b6b' }}>{T.variance >= 0 ? '+' : '-'}${Math.abs(T.variance).toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', fontWeight: '700', color: T.projProfit >= 0 ? '#4ade80' : '#ff6b6b' }}>{T.projProfit >= 0 ? '+' : '-'}${Math.abs(T.projProfit).toLocaleString()}</span>
                  </div>
                </div>
              )
            })()}
          </>
        )}

        {/* ── CONTRACTS TAB ── */}
        {activeTab === 'contracts' && (
          <>
            <div style={s.statRow}>
              <div style={s.statCard}><div style={s.statLabel}>Subcontract value</div><div style={s.statValue()}>${totalContractValue.toLocaleString()}</div></div>
              <div style={s.statCard}>
                <div style={s.statLabel}>Approved COs</div>
                <div style={s.statValue(totalCOs >= 0 ? '#4ade80' : '#ff6b6b')}>{totalCOs >= 0 ? '+' : ''}${totalCOs.toLocaleString()}</div>
              </div>
              <div style={s.statCard}><div style={s.statLabel}>Revised total</div><div style={s.statValue('#e8590c')}>${totalRevised.toLocaleString()}</div></div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Subcontracts ({contracts.length})</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {contracts.length > 0 && <button style={s.btnSmall} onClick={exportContractsPDF}>Export PDF</button>}
                  {!showAddContract && <button style={s.btnSmallOrange} onClick={() => setShowAddContract(true)}>+ Add subcontract</button>}
                </div>
              </div>

              {showAddContract && (
                <div style={s.inlineForm}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>New subcontract</p>
                  <div style={{ ...s.grid2, marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Subcontractor</label>
                      <select style={s.input} value={contractForm.dir_id} onChange={e => setContractForm(f => ({ ...f, dir_id: e.target.value }))}>
                        <option value="">Select a sub...</option>
                        {subDirectory.map(d => <option key={d.id} value={d.id}>{d.company_name}{d.trade ? ` · ${d.trade}` : ''}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Contract value ($)</label>
                      <input type="number" style={s.input} placeholder="0.00" value={contractForm.contract_value} onChange={e => setContractForm(f => ({ ...f, contract_value: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Retainage %</label>
                      <input type="number" min="0" max="100" step="0.5" style={s.input} placeholder="10" value={contractForm.retainage_pct} onChange={e => setContractForm(f => ({ ...f, retainage_pct: e.target.value }))} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
                      <p style={{ fontSize: '12px', color: '#555', margin: 0 }}>
                        {contractForm.retainage_pct > 0
                          ? `${contractForm.retainage_pct}% of each billing will be withheld until project completion.`
                          : 'No retainage — full payment on each billing.'}
                      </p>
                    </div>
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Description / scope</label>
                    <input style={s.input} placeholder="Framing, electrical, plumbing..." value={contractForm.description} onChange={e => setContractForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  {budgetItems.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <label style={s.label}>Budget line item</label>
                      <select style={s.input} value={contractForm.budget_item_id} onChange={e => setContractForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                        <option value="">— Unassigned —</option>
                        {budgetItems.map(item => (
                          <option key={item.id} value={item.id}>{item.cost_code ? `${item.cost_code} · ` : ''}{item.description} (${Number(item.budget_amount).toLocaleString()})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={s.label}>OneDrive link (optional)</label>
                    <input style={s.input} placeholder="https://onedrive.live.com/..." value={contractForm.onedrive_url} onChange={e => setContractForm(f => ({ ...f, onedrive_url: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: addingContract ? 0.6 : 1 }} disabled={addingContract} onClick={addContract}>{addingContract ? 'Saving...' : 'Save contract'}</button>
                    <button style={s.btnGray} onClick={() => { setShowAddContract(false); setContractForm(emptyContract) }}>Cancel</button>
                  </div>
                </div>
              )}

              {contracts.length === 0 && !showAddContract && <p style={{ color: '#444', fontSize: '14px' }}>No subcontracts yet.</p>}

              {contracts.map(c => {
                const subName = c.vendor_name || registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown sub'
                const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)
                const isEditing = editingContract === c.id

                return (
                  <div key={c.id} style={s.contractRow}>
                    <div style={s.contractRowHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1 }}>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{subName}</span>
                        {c.description && <span style={{ fontSize: '12px', color: '#555' }}>{c.description}</span>}
                        {budgetLine && <span style={{ fontSize: '11px', color: '#60a5fa', background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: '4px', padding: '2px 8px' }}>{budgetLine.cost_code || budgetLine.description}</span>}
                        <span style={s.contractBadge(c.status)}>{c.status}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Contract</div>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>${Number(c.contract_value).toLocaleString()}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>COs</div>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: Number(c.approved_change_orders) !== 0 ? '#4ade80' : '#333' }}>
                            {Number(c.approved_change_orders) >= 0 ? '+' : ''}${Number(c.approved_change_orders).toLocaleString()}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Revised</div>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: '#e8590c' }}>${Number(c.adjusted_contract_value).toLocaleString()}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Remaining</div>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: Number(c.remaining_balance) < 0 ? '#ff6b6b' : '#aaa' }}>${Number(c.remaining_balance).toLocaleString()}</div>
                        </div>
                        {(c.retainage_pct > 0) && (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Retainage</div>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: '#facc15' }}>{Number(c.retainage_pct)}%</div>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmallOrange} onClick={() => {
                            if (expandedSov === c.id) { setExpandedSov(null) }
                            else { setExpandedSov(c.id); loadContractSov(c.id); setShowAddSovLine(null); setEditingSovLine(null) }
                          }}>
                            {expandedSov === c.id ? 'Hide SOV' : 'SOV'}
                          </button>
                          <button style={s.btnSmall} onClick={() => { setEditingContract(isEditing ? null : c.id); setEditContractForm({ contract_value: c.contract_value, description: c.description || '', onedrive_url: c.onedrive_url || '', budget_item_id: c.budget_item_id || '', retainage_pct: String(c.retainage_pct ?? 10) }) }}>
                            {isEditing ? 'Cancel' : 'Edit'}
                          </button>
                          <button style={s.btnSmallRed} onClick={() => deleteContract(c.id)}>Delete</button>
                        </div>
                      </div>
                    </div>

                    {isEditing && (
                      <div style={s.contractRowExpanded}>
                        <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Edit subcontract</p>
                        <div style={{ ...s.grid2, marginBottom: '12px' }}>
                          <div>
                            <label style={s.label}>Contract value ($)</label>
                            <input type="number" style={s.input} value={editContractForm.contract_value} onChange={e => setEditContractForm(f => ({ ...f, contract_value: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Description / scope</label>
                            <input style={s.input} value={editContractForm.description} onChange={e => setEditContractForm(f => ({ ...f, description: e.target.value }))} />
                          </div>
                        </div>
                        {budgetItems.length > 0 && (
                          <div style={{ marginBottom: '12px' }}>
                            <label style={s.label}>Budget line item</label>
                            <select style={s.input} value={editContractForm.budget_item_id} onChange={e => setEditContractForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                              <option value="">— Unassigned —</option>
                              {budgetItems.map(item => (
                                <option key={item.id} value={item.id}>{item.cost_code ? `${item.cost_code} · ` : ''}{item.description} (${Number(item.budget_amount).toLocaleString()})</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div style={{ ...s.grid2, marginBottom: '12px' }}>
                          <div>
                            <label style={s.label}>Retainage %</label>
                            <input type="number" min="0" max="100" step="0.5" style={s.input} value={editContractForm.retainage_pct} onChange={e => setEditContractForm(f => ({ ...f, retainage_pct: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>OneDrive link</label>
                            <input style={s.input} value={editContractForm.onedrive_url} onChange={e => setEditContractForm(f => ({ ...f, onedrive_url: e.target.value }))} placeholder="https://onedrive.live.com/..." />
                          </div>
                        </div>
                        <button style={s.btnSmallOrange} onClick={updateContract}>Save changes</button>
                      </div>
                    )}

                    {c.onedrive_url && !isEditing && (
                      <div style={{ ...s.contractRowExpanded, paddingTop: '10px', paddingBottom: '10px' }}>
                        <a href={c.onedrive_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#60a5fa' }}>View contract on OneDrive ↗</a>
                      </div>
                    )}

                    {expandedSov === c.id && (() => {
                      const sovs = contractSovLines[c.id]
                      const totalScheduled = (sovs || []).reduce((a, l) => a + Number(l.scheduled_value), 0)
                      const totalBilled = (sovs || []).reduce((a, l) => a + Number(l.billed_to_date || 0), 0)
                      return (
                        <div style={{ ...s.contractRowExpanded, background: '#060606' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                            <p style={{ ...s.cardTitle, margin: 0 }}>Schedule of Values{sovs ? ` (${sovs.length})` : ''}</p>
                            {showAddSovLine !== c.id && (
                              <button style={s.btnSmallOrange} onClick={() => setShowAddSovLine(c.id)}>+ Add line</button>
                            )}
                          </div>

                          {showAddSovLine === c.id && (
                            <div style={{ ...s.inlineForm, marginBottom: '0.75rem' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                <div>
                                  <label style={s.label}>Description *</label>
                                  <input style={s.input} value={sovLineForm.description} onChange={e => setSovLineForm(f => ({ ...f, description: e.target.value }))} placeholder="Mobilization, framing, drywall..." />
                                </div>
                                <div>
                                  <label style={s.label}>Scheduled value ($) *</label>
                                  <input type="number" step="0.01" style={s.input} value={sovLineForm.scheduled_value} onChange={e => setSovLineForm(f => ({ ...f, scheduled_value: e.target.value }))} placeholder="0.00" />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button style={{ ...s.btnSmallOrange, opacity: (addingSovLine || !sovLineForm.description || !sovLineForm.scheduled_value) ? 0.6 : 1 }}
                                  disabled={addingSovLine || !sovLineForm.description || !sovLineForm.scheduled_value}
                                  onClick={() => addSovLine(c.id)}>
                                  {addingSovLine ? 'Adding...' : 'Add line'}
                                </button>
                                <button style={s.btnSmall} onClick={() => { setShowAddSovLine(null); setSovLineForm({ description: '', scheduled_value: '' }) }}>Cancel</button>
                              </div>
                            </div>
                          )}

                          {!sovs && <p style={{ color: '#444', fontSize: '13px' }}>Loading...</p>}
                          {sovs && sovs.length === 0 && !showAddSovLine && (
                            <p style={{ color: '#444', fontSize: '13px' }}>No SOV lines yet. Add lines to track sub's completion per scope item.</p>
                          )}

                          {sovs && sovs.length > 0 && (
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                                    <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>Description</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700', whiteSpace: 'nowrap' }}>Scheduled</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700', whiteSpace: 'nowrap' }}>Billed to Date</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>Balance</th>
                                    <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>% Done</th>
                                    <th style={{ width: '90px' }}></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sovs.map(line => {
                                    const balance = Number(line.scheduled_value) - Number(line.billed_to_date || 0)
                                    const pct = Number(line.scheduled_value) > 0 ? (Number(line.billed_to_date || 0) / Number(line.scheduled_value)) * 100 : 0
                                    const isEditingThisLine = editingSovLine === line.id
                                    return (
                                      <tr key={line.id} style={{ borderBottom: '1px solid #111' }}>
                                        {isEditingThisLine ? (
                                          <>
                                            <td style={{ padding: '4px' }}>
                                              <input style={{ ...s.input, padding: '5px 8px', fontSize: '12px' }} value={editSovLineForm.description} onChange={e => setEditSovLineForm(f => ({ ...f, description: e.target.value }))} />
                                            </td>
                                            <td style={{ padding: '4px' }}>
                                              <input type="number" step="0.01" style={{ ...s.input, padding: '5px 8px', fontSize: '12px', width: '110px', textAlign: 'right' }} value={editSovLineForm.scheduled_value} onChange={e => setEditSovLineForm(f => ({ ...f, scheduled_value: e.target.value }))} />
                                            </td>
                                            <td colSpan="3"></td>
                                            <td style={{ padding: '4px', textAlign: 'right' }}>
                                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                <button style={s.btnSmallOrange} onClick={() => updateSovLine(line.id, c.id)}>Save</button>
                                                <button style={s.btnSmall} onClick={() => setEditingSovLine(null)}>✕</button>
                                              </div>
                                            </td>
                                          </>
                                        ) : (
                                          <>
                                            <td style={{ padding: '8px', color: '#ccc' }}>{line.description}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', color: '#f1f1f1', fontFamily: 'monospace' }}>${Number(line.scheduled_value).toLocaleString()}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', color: Number(line.billed_to_date) > 0 ? '#4ade80' : '#444', fontFamily: 'monospace' }}>${Number(line.billed_to_date || 0).toLocaleString()}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', color: balance < 0 ? '#ff6b6b' : '#555', fontFamily: 'monospace' }}>${balance.toLocaleString()}</td>
                                            <td style={{ padding: '8px', textAlign: 'center' }}>
                                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                                                <span style={{ fontSize: '11px', fontWeight: '700', color: pct >= 100 ? '#4ade80' : pct > 50 ? '#e8590c' : '#555' }}>{pct.toFixed(0)}%</span>
                                                <div style={{ width: '56px', height: '3px', background: '#1a1a1a', borderRadius: '2px' }}>
                                                  <div style={{ width: Math.min(100, pct) + '%', height: '100%', background: pct >= 100 ? '#4ade80' : '#e8590c', borderRadius: '2px' }} />
                                                </div>
                                              </div>
                                            </td>
                                            <td style={{ padding: '4px', textAlign: 'right' }}>
                                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                <button style={s.btnSmall} onClick={() => { setEditingSovLine(line.id); setEditSovLineForm({ description: line.description, scheduled_value: String(line.scheduled_value) }) }}>Edit</button>
                                                <button style={s.btnSmallRed} onClick={() => deleteSovLine(line.id, c.id)}>Del</button>
                                              </div>
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    )
                                  })}
                                  <tr style={{ borderTop: '2px solid #2a2a2a' }}>
                                    <td style={{ padding: '8px', color: '#888', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>Total</td>
                                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '700', color: '#f1f1f1' }}>${totalScheduled.toLocaleString()}</td>
                                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '700', color: '#4ade80' }}>${totalBilled.toLocaleString()}</td>
                                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '700', color: (totalScheduled - totalBilled) < 0 ? '#ff6b6b' : '#555' }}>${(totalScheduled - totalBilled).toLocaleString()}</td>
                                    <td style={{ padding: '8px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#555' }}>{totalScheduled > 0 ? ((totalBilled / totalScheduled) * 100).toFixed(0) : 0}%</td>
                                    <td></td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── CHANGE ORDERS TAB ── */}
        {activeTab === 'changeorders' && (
          <>
            {(() => {
              const approvedPrimeCOVal = primeCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
              const pendingPrimeCOs = primeCOs.filter(co => co.status === 'pending').length
              return (
                <div style={s.statRow}>
                  <div style={s.statCard}><div style={s.statLabel}>Sub COs pending</div><div style={s.statValue(pendingCOs > 0 ? '#e8590c' : undefined)}>{pendingCOs}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Sub CO approved value</div><div style={s.statValue('#4ade80')}>{approvedCOValue >= 0 ? '+' : ''}${approvedCOValue.toLocaleString()}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Prime COs pending</div><div style={s.statValue(pendingPrimeCOs > 0 ? '#e8590c' : undefined)}>{pendingPrimeCOs}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Prime CO approved value</div><div style={s.statValue('#4ade80')}>{approvedPrimeCOVal >= 0 ? '+' : ''}${approvedPrimeCOVal.toLocaleString()}</div></div>
                </div>
              )
            })()}

            {/* Prime Contract Change Orders */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Prime Contract Change Orders ({primeCOs.length})</p>
                {!showAddPrimeCO && <button style={s.btnSmallOrange} onClick={() => { setShowAddPrimeCO(true); loadBudgetItems() }}>+ Add Prime CO</button>}
              </div>

              {showAddPrimeCO && (
                <div style={s.inlineForm}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>New prime contract change order</p>
                  <div style={{ ...s.grid3, marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Amount ($)</label>
                      <input type="number" style={s.input} placeholder="0.00" value={primeCOForm.amount} onChange={e => setPrimeCOForm(f => ({ ...f, amount: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Description</label>
                      <input style={s.input} placeholder="Scope change, owner directive..." value={primeCOForm.description} onChange={e => setPrimeCOForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Budget Line (optional)</label>
                      <select style={s.input} value={primeCOForm.budget_item_id} onChange={e => setPrimeCOForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                        <option value="">— None —</option>
                        {budgetItems.map(bi => <option key={bi.id} value={bi.id}>{bi.cost_code ? `${bi.cost_code} ` : ''}{bi.description}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Notes</label>
                    <input style={s.input} placeholder="Additional notes..." value={primeCOForm.notes} onChange={e => setPrimeCOForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: addingPrimeCO ? 0.6 : 1 }} disabled={addingPrimeCO} onClick={addPrimeCO}>{addingPrimeCO ? 'Saving...' : 'Save Prime CO'}</button>
                    <button style={s.btnGray} onClick={() => { setShowAddPrimeCO(false); setPrimeCOForm(emptyPrimeCO) }}>Cancel</button>
                  </div>
                </div>
              )}

              {primeCOs.length === 0 && !showAddPrimeCO && <p style={{ color: '#444', fontSize: '14px' }}>No prime contract change orders yet.</p>}

              {primeCOs.map(co => (
                <div key={co.id} style={s.coRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#f1f1f1' }}>{co.description}</span>
                      {co.budget_items && <span style={{ fontSize: '11px', color: '#555' }}>{co.budget_items.cost_code ? `${co.budget_items.cost_code} · ` : ''}{co.budget_items.description}</span>}
                      <span style={{ fontSize: '11px', color: '#444' }}>{new Date(co.created_at).toLocaleDateString()}</span>
                    </div>
                    {co.notes && <span style={{ fontSize: '13px', color: '#aaa' }}>{co.notes}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '15px', fontWeight: '700', color: Number(co.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>
                      {Number(co.amount) >= 0 ? '+' : ''}${Number(co.amount).toLocaleString()}
                    </span>
                    <span style={s.coBadge(co.status)}>{co.status}</span>
                    {co.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button style={s.btnSmallGreen} onClick={() => reviewPrimeCO(co.id, 'approved')}>Approve</button>
                        <button style={s.btnSmallRed} onClick={() => reviewPrimeCO(co.id, 'rejected')}>Reject</button>
                      </div>
                    )}
                    <button style={{ ...s.btnSmallRed, fontSize: '11px', padding: '2px 8px' }} onClick={() => deletePrimeCO(co.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Subcontract Change Orders */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Subcontract Change Orders ({allCOs.length})</p>
                {!showAddCO && <button style={s.btnSmallOrange} onClick={() => setShowAddCO(true)}>+ Add CO</button>}
              </div>

              {showAddCO && (
                <div style={s.inlineForm}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>New change order</p>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Subcontract</label>
                    <select style={s.input} value={coForm.subcontract_id} onChange={e => setCoForm(f => ({ ...f, subcontract_id: e.target.value }))}>
                      <option value="">Select subcontract...</option>
                      {contracts.map(c => {
                        const subName = c.vendor_name || registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown'
                        return <option key={c.id} value={c.id}>{subName}{c.description ? ` — ${c.description}` : ''}</option>
                      })}
                    </select>
                  </div>
                  <div style={{ ...s.grid3, marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Direction</label>
                      <select style={s.input} value={coForm.direction} onChange={e => setCoForm(f => ({ ...f, direction: e.target.value }))}>
                        <option value="pm_to_sub">PM → Sub (add scope)</option>
                        <option value="sub_to_pm">Sub → PM (sub request)</option>
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Amount ($)</label>
                      <input type="number" style={s.input} placeholder="0.00" value={coForm.amount} onChange={e => setCoForm(f => ({ ...f, amount: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Description</label>
                      <input style={s.input} placeholder="Additional scope, credit..." value={coForm.description} onChange={e => setCoForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: addingCO ? 0.6 : 1 }} disabled={addingCO} onClick={addCO}>{addingCO ? 'Saving...' : 'Save CO'}</button>
                    <button style={s.btnGray} onClick={() => { setShowAddCO(false); setCoForm(emptyCO) }}>Cancel</button>
                  </div>
                </div>
              )}

              {allCOs.length === 0 && !showAddCO && <p style={{ color: '#444', fontSize: '14px' }}>No change orders yet.</p>}

              {allCOs.map(co => {
                const subId = co.subcontracts?.sub_id
                const matchedContract = contracts.find(c => c.id === co.subcontract_id)
                const subName = matchedContract?.vendor_name || registeredSubs.find(s => s.sub_id === subId)?.profiles?.company_name || 'Unknown sub'
                const scope = co.subcontracts?.description
                return (
                  <div key={co.id} style={s.coRow}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#f1f1f1' }}>{subName}</span>
                        {scope && <span style={{ fontSize: '11px', color: '#555' }}>{scope}</span>}
                        <span style={{ fontSize: '11px', color: '#555' }}>{co.direction === 'pm_to_sub' ? 'PM → Sub' : 'Sub → PM'}</span>
                        <span style={{ fontSize: '11px', color: '#444' }}>{new Date(co.created_at).toLocaleDateString()}</span>
                      </div>
                      <span style={{ fontSize: '13px', color: '#aaa' }}>{co.description}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '15px', fontWeight: '700', color: Number(co.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>
                        {Number(co.amount) >= 0 ? '+' : ''}${Number(co.amount).toLocaleString()}
                      </span>
                      <span style={s.coBadge(co.status)}>{co.status}</span>
                      {co.status === 'pending' && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmallGreen} onClick={() => reviewCO(co.id, 'approved')}>Approve</button>
                          <button style={s.btnSmallRed} onClick={() => reviewCO(co.id, 'rejected')}>Reject</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── BILLING TAB ── */}
        {activeTab === 'billing' && (
          <>
            <div style={s.statRow}>
              <div style={s.statCard}><div style={s.statLabel}>Total submissions</div><div style={s.statValue()}>{billingSubmissions.length}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Pending review</div><div style={s.statValue(pendingBillingCount > 0 ? '#e8590c' : undefined)}>{pendingBillingCount}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Approved total</div><div style={s.statValue('#4ade80')}>${approvedBillingTotal.toLocaleString()}</div></div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Billing submissions ({billingSubmissions.length})</p>
                {!showCreateBilling && (
                  <button style={s.btnSmallOrange} onClick={() => setShowCreateBilling(true)}>+ Create billing for sub</button>
                )}
              </div>

              {showCreateBilling && (
                <div style={{ ...s.inlineForm, border: '1px solid #4a2200' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Create billing on behalf of subcontractor</p>
                  <p style={{ fontSize: '12px', color: '#555', margin: '-0.5rem 0 1rem' }}>Use when a sub emails you billing info and you want to enter and approve it directly.</p>

                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Contractor on this project</label>
                    <select style={s.input} value={createBillingForm._contract_id || ''}
                      onChange={e => {
                        const contractId = e.target.value
                        if (!contractId) { setCreateBillingForm(f => ({ ...f, _contract_id: '', _contract_value: '', _retainage_pct: '0', sub_id: '', company_name: '', contact_name: '', contact_info: '' })); return }
                        const contract = contracts.find(c => c.id === contractId)
                        const regSub = contract?.sub_id ? subs.find(s => s.sub_id === contract.sub_id) : null
                        setCreateBillingForm(f => ({
                          ...f,
                          _contract_id: contractId,
                          _contract_value: String(contract?.adjusted_contract_value || contract?.contract_value || ''),
                          _retainage_pct: String(contract?.retainage_pct ?? 0),
                          sub_id: contract?.sub_id || '',
                          company_name: contract?.vendor_name || regSub?.profiles?.company_name || '',
                          contact_name: regSub?.profiles?.full_name || '',
                          contact_info: regSub?.profiles?.phone || '',
                        }))
                      }}>
                      <option value="">— Select a contractor —</option>
                      {contracts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.vendor_name || 'Unknown'}{c.description ? ` — ${c.description}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ ...s.grid2, marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Company name *</label>
                      <input style={s.input} value={createBillingForm.company_name} onChange={e => setCreateBillingForm(f => ({ ...f, company_name: e.target.value }))} placeholder="ABC Framing LLC" required />
                    </div>
                    <div>
                      <label style={s.label}>Contact name</label>
                      <input style={s.input} value={createBillingForm.contact_name} onChange={e => setCreateBillingForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="John Smith" />
                    </div>
                  </div>
                  <div style={{ ...s.grid3, marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Contact info (phone / email)</label>
                      <input style={s.input} value={createBillingForm.contact_info} onChange={e => setCreateBillingForm(f => ({ ...f, contact_info: e.target.value }))} placeholder="555-0100" />
                    </div>
                    <div>
                      <label style={s.label}>Amount billed ($) *</label>
                      <input type="number" step="0.01" style={s.input} value={createBillingForm.amount_billed} onChange={e => {
                        const amt = parseFloat(e.target.value) || 0
                        const contractVal = parseFloat(createBillingForm._contract_value) || 0
                        const pct = contractVal > 0 ? Math.min(100, Math.round(amt / contractVal * 100)) : null
                        setCreateBillingForm(f => ({ ...f, amount_billed: e.target.value, pct_complete: pct !== null ? String(pct) : f.pct_complete }))
                      }} placeholder="0.00" required />
                      {parseFloat(createBillingForm._retainage_pct) > 0 && parseFloat(createBillingForm.amount_billed) > 0 && (() => {
                        const retHeld = Math.round(parseFloat(createBillingForm.amount_billed) * parseFloat(createBillingForm._retainage_pct) / 100 * 100) / 100
                        const net = parseFloat(createBillingForm.amount_billed) - retHeld
                        return (
                          <div style={{ fontSize: '11px', marginTop: '5px', color: '#888' }}>
                            <span style={{ color: '#facc15' }}>{createBillingForm._retainage_pct}% retainage held: ${retHeld.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            <span style={{ color: '#4ade80', marginLeft: '10px' }}>Net payment: ${net.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )
                      })()}
                    </div>
                    <div>
                      <label style={s.label}>% complete</label>
                      <input type="number" min="0" max="100" style={s.input} value={createBillingForm.pct_complete} onChange={e => setCreateBillingForm(f => ({ ...f, pct_complete: e.target.value }))} placeholder="0" />
                    </div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                    <div>
                      <label style={s.label}>Work description</label>
                      <textarea style={{ ...s.textarea, minHeight: '80px' }} value={createBillingForm.work_description} onChange={e => setCreateBillingForm(f => ({ ...f, work_description: e.target.value }))} placeholder="Describe the work completed this billing period..." />
                    </div>
                    <div>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={s.label}>Retainage % (from contract)</label>
                        <input type="number" min="0" max="100" step="0.5" style={s.input} value={createBillingForm._retainage_pct} onChange={e => setCreateBillingForm(f => ({ ...f, _retainage_pct: e.target.value }))} placeholder="0" />
                      </div>
                      <div>
                        <label style={s.label}>Billing period</label>
                        <input type="month" style={s.input} value={createBillingForm.billing_period} onChange={e => setCreateBillingForm(f => ({ ...f, billing_period: e.target.value }))} />
                        <p style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>Month this billing covers — used to auto-fill AIA applications</p>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input type="checkbox" id="autoApprove" checked={createBillingForm.auto_approve} onChange={e => setCreateBillingForm(f => ({ ...f, auto_approve: e.target.checked }))} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#e8590c' }} />
                    <label htmlFor="autoApprove" style={{ fontSize: '13px', color: '#ccc', cursor: 'pointer' }}>
                      Approve immediately (skip pending queue)
                    </label>
                  </div>
                  {(!createBillingForm.company_name || !createBillingForm.amount_billed) && (
                    <p style={{ fontSize: '12px', color: '#e8590c', marginBottom: '10px' }}>
                      {!createBillingForm.company_name ? 'Select a contractor or enter a company name. ' : ''}{!createBillingForm.amount_billed ? 'Enter the amount billed.' : ''}
                    </p>
                  )}
                  {createBillingError && (
                    <p style={{ fontSize: '12px', color: '#ff6b6b', marginBottom: '10px' }}>{createBillingError}</p>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: (creatingBilling || !createBillingForm.company_name || !createBillingForm.amount_billed) ? 0.4 : 1 }} disabled={creatingBilling || !createBillingForm.company_name || !createBillingForm.amount_billed} onClick={createBilling}>
                      {creatingBilling ? 'Saving...' : createBillingForm.auto_approve ? 'Save & approve' : 'Save as pending'}
                    </button>
                    <button style={s.btnGray} onClick={() => { setShowCreateBilling(false); setCreateBillingForm(emptyCreateBilling); setCreateBillingError('') }}>Cancel</button>
                  </div>
                </div>
              )}

              {billingSubmissions.length === 0 && !showCreateBilling && (
                <p style={{ color: '#444', fontSize: '14px' }}>No billing submissions yet. Create one above or wait for subs to submit from their portal.</p>
              )}

              {billingSubmissions.map(b => {
                const isEditing = editingBilling === b.id
                return (
                  <div key={b.id} style={{ ...s.billingEntryRow, opacity: isEditing ? 0.95 : 1 }}>
                    <div style={s.billingEntryHeader}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '3px' }}>
                          <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{b.company_name}</span>
                          {b.contact_name && <span style={{ fontSize: '12px', color: '#555' }}>{b.contact_name}</span>}
                          <span style={s.coBadge(b.status)}>{b.status}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#555' }}>
                          {new Date(b.submitted_at).toLocaleDateString()}
                          {b.billing_period && <span style={{ background: '#1a2a1a', color: '#4ade80', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', marginLeft: '6px' }}>{new Date(b.billing_period + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
                          {b.pct_complete != null ? ` · ${b.pct_complete}% complete` : ''}
                          {b.work_description ? ` · ${b.work_description.slice(0, 60)}${b.work_description.length > 60 ? '…' : ''}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '16px', fontWeight: '800', color: '#f1f1f1' }}>${Number(b.amount_billed).toLocaleString()}</div>
                          {b.retainage_held > 0 && (
                            <div style={{ fontSize: '11px', marginTop: '2px' }}>
                              <span style={{ color: '#facc15' }}>Ret: ${Number(b.retainage_held).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                              <span style={{ color: '#4ade80', marginLeft: '8px' }}>Net: ${(Number(b.amount_billed) - Number(b.retainage_held)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmallOrange} onClick={() => {
                            if (!isEditing) loadBillingSov(b.id)
                            setEditingBilling(isEditing ? null : b.id)
                            setEditBillingForm({
                              company_name: b.company_name || '',
                              contact_name: b.contact_name || '',
                              contact_info: b.contact_info || '',
                              amount_billed: b.amount_billed || '',
                              retainage_pct: b.retainage_pct ?? 0,
                              pct_complete: b.pct_complete ?? '',
                              work_description: b.work_description || '',
                              billing_period: b.billing_period ? b.billing_period.slice(0, 7) : '',
                              status: b.status,
                            })
                          }}>
                            {isEditing ? 'Cancel' : 'Edit'}
                          </button>
                          <button style={s.btnSmallRed} onClick={() => deleteBillingEntry(b.id)}>Delete</button>
                        </div>
                      </div>
                    </div>

                    {isEditing && (
                      <div style={s.billingEntryExpanded}>
                        <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Edit billing submission</p>
                        <div style={{ ...s.grid2, marginBottom: '12px' }}>
                          <div>
                            <label style={s.label}>Company name</label>
                            <input style={s.input} value={editBillingForm.company_name} onChange={e => setEditBillingForm(f => ({ ...f, company_name: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Contact name</label>
                            <input style={s.input} value={editBillingForm.contact_name} onChange={e => setEditBillingForm(f => ({ ...f, contact_name: e.target.value }))} />
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                          <div>
                            <label style={s.label}>Contact info</label>
                            <input style={s.input} value={editBillingForm.contact_info} onChange={e => setEditBillingForm(f => ({ ...f, contact_info: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Amount billed ($)</label>
                            <input type="number" step="0.01" style={s.input} value={editBillingForm.amount_billed} onChange={e => setEditBillingForm(f => ({ ...f, amount_billed: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Retainage %</label>
                            <input type="number" min="0" max="100" step="0.5" style={s.input} value={editBillingForm.retainage_pct} onChange={e => setEditBillingForm(f => ({ ...f, retainage_pct: e.target.value }))} />
                            {parseFloat(editBillingForm.retainage_pct) > 0 && parseFloat(editBillingForm.amount_billed) > 0 && (
                              <div style={{ fontSize: '11px', marginTop: '4px', color: '#facc15' }}>
                                Held: ${Math.round(parseFloat(editBillingForm.amount_billed) * parseFloat(editBillingForm.retainage_pct) / 100 * 100) / 100}
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={s.label}>% complete</label>
                            <input type="number" min="0" max="100" style={s.input} value={editBillingForm.pct_complete} onChange={e => setEditBillingForm(f => ({ ...f, pct_complete: e.target.value }))} />
                          </div>
                        </div>
                        <div style={{ ...s.grid2, marginBottom: '12px' }}>
                          <div>
                            <label style={s.label}>Work description</label>
                            <textarea style={{ ...s.textarea, minHeight: '80px' }} value={editBillingForm.work_description} onChange={e => setEditBillingForm(f => ({ ...f, work_description: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Billing period</label>
                            <input type="month" style={s.input} value={editBillingForm.billing_period || ''} onChange={e => setEditBillingForm(f => ({ ...f, billing_period: e.target.value }))} />
                          </div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Status</label>
                          <select style={s.input} value={editBillingForm.status} onChange={e => setEditBillingForm(f => ({ ...f, status: e.target.value }))}>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button style={s.btnSmallOrange} onClick={updateBillingEntry}>Save changes</button>
                          <button style={s.btnSmall} onClick={() => setEditingBilling(null)}>Cancel</button>
                        </div>
                        {billingSovData[b.id] && billingSovData[b.id].length > 0 && (
                          <div style={{ marginTop: '1.25rem', borderTop: '1px solid #1e1e1e', paddingTop: '1rem' }}>
                            <p style={{ ...s.cardTitle, marginBottom: '0.75rem' }}>Schedule of values — this submission</p>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Description</th>
                                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Scheduled</th>
                                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>This submission</th>
                                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>% Complete</th>
                                </tr>
                              </thead>
                              <tbody>
                                {billingSovData[b.id].map(line => {
                                  const sched = Number(line.subcontract_sov_lines?.scheduled_value || 0)
                                  const amt = Number(line.amount || 0)
                                  const pct = sched > 0 ? (amt / sched * 100).toFixed(0) : '—'
                                  return (
                                    <tr key={line.id} style={{ borderBottom: '1px solid #111' }}>
                                      <td style={{ padding: '8px', color: '#ccc' }}>{line.subcontract_sov_lines?.description || '—'}</td>
                                      <td style={{ padding: '8px', textAlign: 'right', color: '#888' }}>${sched.toLocaleString()}</td>
                                      <td style={{ padding: '8px', textAlign: 'right', color: '#f1f1f1', fontWeight: '600' }}>${amt.toLocaleString()}</td>
                                      <td style={{ padding: '8px', textAlign: 'right', color: '#4ade80' }}>{pct}%</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
        {/* ── FIELD TAB ── */}
        {activeTab === 'field' && (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', borderBottom: '1px solid #1a1a1a', paddingBottom: '0' }}>
              {['reports', 'rfis', 'deliveries', 'milestones'].map(t => (
                <button key={t} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', background: 'none', border: 'none', color: fieldSubTab === t ? '#f1f1f1' : '#555', borderBottom: fieldSubTab === t ? '2px solid #e8590c' : '2px solid transparent', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '-1px' }}
                  onClick={() => setFieldSubTab(t)}>
                  {t === 'reports' ? `Daily Reports (${fieldDailyReports.length})` : t === 'rfis' ? `RFIs (${fieldRfis.length})` : t === 'deliveries' ? `Deliveries (${fieldDeliveries.length})` : `Milestones (${fieldMilestones.length})`}
                </button>
              ))}
            </div>

            {/* Daily Reports */}
            {fieldSubTab === 'reports' && (
              fieldDailyReports.length === 0 ? <div style={{ textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' }}>No daily reports submitted yet.</div>
              : fieldDailyReports.map(r => (
                <div key={r.id} style={s.billingEntryRow}>
                  <div style={s.billingEntryHeader} onClick={() => setExpandedFieldReport(expandedFieldReport === r.id ? null : r.id)}>
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{new Date(r.report_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      {r.weather && <span style={{ fontSize: '12px', color: '#555' }}>{r.weather}</span>}
                      {r.crew_count != null && <span style={{ fontSize: '12px', color: '#555' }}>{r.crew_count} crew</span>}
                    </div>
                    <span style={{ color: '#555' }}>{expandedFieldReport === r.id ? '▲' : '▼'}</span>
                  </div>
                  {expandedFieldReport === r.id && (
                    <div style={s.billingEntryExpanded}>
                      <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Work performed</p>
                      <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>{r.work_performed}</p>
                      {r.issues && <>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Issues / delays</p>
                        <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.issues}</p>
                      </>}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* RFIs */}
            {fieldSubTab === 'rfis' && (
              fieldRfis.length === 0 ? <div style={{ textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' }}>No RFIs submitted yet.</div>
              : fieldRfis.map(rfi => (
                <div key={rfi.id} style={s.billingEntryRow}>
                  <div style={s.billingEntryHeader} onClick={() => setExpandedFieldRfi(expandedFieldRfi === rfi.id ? null : rfi.id)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{rfi.title}</span>
                        <span style={s.coBadge(rfi.status === 'answered' ? 'approved' : rfi.status === 'closed' ? 'rejected' : 'pending')}>{rfi.status}</span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#555' }}>{new Date(rfi.created_at).toLocaleDateString()}</span>
                    </div>
                    <span style={{ color: '#555' }}>{expandedFieldRfi === rfi.id ? '▲' : '▼'}</span>
                  </div>
                  {expandedFieldRfi === rfi.id && (
                    <div style={s.billingEntryExpanded}>
                      {rfi.description && <>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Details</p>
                        <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>{rfi.description}</p>
                      </>}
                      {rfi.response && (
                        <div style={{ background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Your response</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{rfi.response}</p>
                        </div>
                      )}
                      {respondingRfi === rfi.id ? (
                        <div>
                          <label style={s.label}>Response</label>
                          <textarea rows={4} style={{ ...s.textarea, marginBottom: '10px' }} value={rfiResponse} onChange={e => setRfiResponse(e.target.value)} placeholder="Type your response..." />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => respondToRfi(rfi.id)} disabled={savingRfiResponse || !rfiResponse} style={{ ...s.btnSmallOrange, opacity: savingRfiResponse || !rfiResponse ? 0.6 : 1 }}>{savingRfiResponse ? 'Saving...' : 'Send response'}</button>
                            <button onClick={() => { setRespondingRfi(null); setRfiResponse('') }} style={s.btnSmall}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setRespondingRfi(rfi.id); setRfiResponse(rfi.response || '') }} style={s.btnSmallOrange}>
                          {rfi.response ? 'Edit response' : 'Respond'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Deliveries */}
            {fieldSubTab === 'deliveries' && (
              fieldDeliveries.length === 0 ? <div style={{ textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' }}>No deliveries logged yet.</div>
              : fieldDeliveries.map(d => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 12px', borderBottom: '1px solid #1a1a1a', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{d.material}</span>
                      <span style={s.coBadge(d.status === 'received' ? 'approved' : d.status === 'partial' ? 'pending' : 'pending')}>{d.status}</span>
                    </div>
                    <span style={{ fontSize: '12px', color: '#555' }}>
                      {d.vendor && `${d.vendor} · `}{d.quantity && `${d.quantity} · `}
                      {d.expected_date && `Expected ${new Date(d.expected_date + 'T12:00:00').toLocaleDateString()}`}
                      {d.received_date && ` · Received ${new Date(d.received_date + 'T12:00:00').toLocaleDateString()}`}
                    </span>
                  </div>
                </div>
              ))
            )}

            {/* Milestones */}
            {fieldSubTab === 'milestones' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                  <button style={s.btnSmallOrange} onClick={() => setShowMilestoneForm(v => !v)}>{showMilestoneForm ? 'Cancel' : '+ Add milestone'}</button>
                </div>
                {showMilestoneForm && (
                  <div style={s.inlineForm}>
                    <form onSubmit={addMilestone}>
                      <div style={{ ...s.grid3, marginBottom: '12px' }}>
                        <div style={{ gridColumn: 'span 2' }}><label style={s.label}>Title *</label><input style={s.input} required value={milestoneForm.title} onChange={e => setMilestoneForm(f => ({ ...f, title: e.target.value }))} placeholder="Foundation pour, framing complete..." /></div>
                        <div><label style={s.label}>Due date</label><input type="date" style={s.input} value={milestoneForm.due_date} onChange={e => setMilestoneForm(f => ({ ...f, due_date: e.target.value }))} /></div>
                      </div>
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={s.label}>Notes</label>
                        <input style={s.input} value={milestoneForm.notes} onChange={e => setMilestoneForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
                      </div>
                      <button type="submit" disabled={addingMilestone} style={{ ...s.btnSmallOrange, opacity: addingMilestone ? 0.6 : 1 }}>{addingMilestone ? 'Adding...' : 'Add milestone'}</button>
                    </form>
                  </div>
                )}
                {fieldMilestones.length === 0 && !showMilestoneForm && <div style={{ textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' }}>No milestones yet.</div>}
                {fieldMilestones.map(m => (
                  <div key={m.id} style={{ padding: '14px 12px', borderBottom: '1px solid #1a1a1a' }}>
                    {editingMilestone === m.id ? (
                      <div style={s.inlineForm}>
                        <div style={{ ...s.grid3, marginBottom: '12px' }}>
                          <div style={{ gridColumn: 'span 2' }}><label style={s.label}>Title</label><input style={s.input} value={editMilestoneForm.title} onChange={e => setEditMilestoneForm(f => ({ ...f, title: e.target.value }))} /></div>
                          <div><label style={s.label}>Due date</label><input type="date" style={s.input} value={editMilestoneForm.due_date} onChange={e => setEditMilestoneForm(f => ({ ...f, due_date: e.target.value }))} /></div>
                        </div>
                        <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                          <div><label style={s.label}>Notes</label><input style={s.input} value={editMilestoneForm.notes} onChange={e => setEditMilestoneForm(f => ({ ...f, notes: e.target.value }))} /></div>
                          <div>
                            <label style={s.label}>Status</label>
                            <select style={s.input} value={editMilestoneForm.status} onChange={e => setEditMilestoneForm(f => ({ ...f, status: e.target.value }))}>
                              <option value="pending">Pending</option>
                              <option value="complete">Complete</option>
                              <option value="delayed">Delayed</option>
                            </select>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={saveMilestoneEdit} style={s.btnSmallOrange}>Save</button>
                          <button onClick={() => setEditingMilestone(null)} style={s.btnSmall}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                            <span style={{ fontSize: '14px', fontWeight: '600', color: m.status === 'complete' ? '#4ade80' : '#f1f1f1' }}>{m.title}</span>
                            <span style={s.coBadge(m.status === 'complete' ? 'approved' : m.status === 'delayed' ? 'rejected' : 'pending')}>{m.status}</span>
                          </div>
                          <span style={{ fontSize: '12px', color: '#555' }}>
                            {m.due_date && `Due ${new Date(m.due_date + 'T12:00:00').toLocaleDateString()}`}
                            {m.completed_date && ` · Completed ${new Date(m.completed_date + 'T12:00:00').toLocaleDateString()}`}
                          </span>
                          {m.notes && <div style={{ fontSize: '12px', color: '#444', marginTop: '2px' }}>{m.notes}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => { setEditingMilestone(m.id); setEditMilestoneForm({ title: m.title, due_date: m.due_date || '', notes: m.notes || '', status: m.status }) }} style={s.btnSmallOrange}>Edit</button>
                          <button onClick={() => deleteMilestone(m.id)} style={s.btnSmallRed}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── DIRECT COSTS TAB ── */}
        {activeTab === 'costs' && (
          <>
            {(() => {
              const totalCosts = directCosts.reduce((a, c) => a + Number(c.amount || 0), 0)
              const approvedTotal = directCosts.filter(c => c.status === 'approved').reduce((a, c) => a + Number(c.amount || 0), 0)
              const pendingCount = directCosts.filter(c => c.status === 'pending').length
              return (
                <div style={s.statRow}>
                  <div style={s.statCard}><div style={s.statLabel}>Total submitted</div><div style={s.statValue()}>${totalCosts.toLocaleString()}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Approved</div><div style={s.statValue('#4ade80')}>${approvedTotal.toLocaleString()}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Pending review</div><div style={s.statValue(pendingCount > 0 ? '#e8590c' : undefined)}>{pendingCount}</div></div>
                </div>
              )
            })()}

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Direct Costs ({directCosts.length})</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {directCosts.length > 0 && <button style={s.btnSmall} onClick={exportDirectCostsCSV}>Export CSV</button>}
                  <button style={s.btnSmallOrange} onClick={() => setShowDcForm(v => !v)}>{showDcForm ? 'Cancel' : '+ Log cost'}</button>
                </div>
              </div>

              {showDcForm && (
                <div style={{ ...s.inlineForm, border: '1px solid #4a2200', marginBottom: '1.25rem' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Log direct cost</p>
                  <form onSubmit={submitDirectCostPM}>
                    <div style={{ ...s.grid3, marginBottom: '12px' }}>
                      <div>
                        <label style={s.label}>Date *</label>
                        <input type="date" style={s.input} required value={dcForm.cost_date} onChange={e => setDcForm(f => ({ ...f, cost_date: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Category *</label>
                        <select style={s.input} required value={dcForm.category} onChange={e => setDcForm(f => ({ ...f, category: e.target.value }))}>
                          {['Materials', 'Labor', 'Equipment', 'Subcontractor', 'Permits', 'Fees', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={s.label}>Amount ($) *</label>
                        <input type="number" step="0.01" min="0" style={s.input} required value={dcForm.amount} onChange={e => setDcForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                      <div>
                        <label style={s.label}>Description *</label>
                        <input style={s.input} required value={dcForm.description} onChange={e => setDcForm(f => ({ ...f, description: e.target.value }))} placeholder="Lumber, concrete delivery..." />
                      </div>
                      <div>
                        <label style={s.label}>Budget line</label>
                        <select style={s.input} value={dcForm.budget_item_id} onChange={e => setDcForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                          <option value="">— Unassigned —</option>
                          {budgetItems.map(b => <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={s.label}>Notes</label>
                        <input style={s.input} value={dcForm.notes} onChange={e => setDcForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
                      </div>
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                      <label style={s.label}>Receipt (photo / PDF)</label>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...s.input, padding: '8px 14px' }} onChange={e => setDcFile(e.target.files[0])} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" disabled={submittingDc} style={{ ...s.btn, opacity: submittingDc ? 0.6 : 1 }}>{submittingDc ? 'Saving...' : 'Save & approve'}</button>
                      <button type="button" style={s.btnGray} onClick={() => setShowDcForm(false)}>Cancel</button>
                    </div>
                  </form>
                </div>
              )}

              {directCosts.length === 0 && (
                <p style={{ color: '#444', fontSize: '14px' }}>No direct costs logged yet. Superintendents can log costs from the field portal.</p>
              )}

              {directCosts.map(c => {
                const isRejecting = rejectingCostId === c.id
                const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)
                return (
                  <div key={c.id} style={{ ...s.billingEntryRow, border: `1px solid ${c.status === 'approved' ? '#1a4a1a' : c.status === 'rejected' ? '#5a1a1a' : '#1e1e1e'}` }}>
                    <div style={s.billingEntryHeader}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{c.description}</span>
                          <span style={s.coBadge('pending')}>{c.category}</span>
                          <span style={s.coBadge(c.status)}>{c.status}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#555' }}>
                          {new Date(c.cost_date + 'T12:00:00').toLocaleDateString()}
                          {budgetLine && ` · ${budgetLine.description}`}
                          {c.notes && ` · ${c.notes}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: '#f1f1f1' }}>${Number(c.amount).toLocaleString()}</span>
                        {c.receipt_url && (
                          <button style={s.btnSmall} onClick={() => openDcReceiptUrl(c.receipt_url)}>View receipt</button>
                        )}
                        {c.status === 'pending' && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              style={{ ...s.btnSmallGreen, opacity: updatingCostId === c.id ? 0.6 : 1 }}
                              disabled={updatingCostId === c.id}
                              onClick={() => updateCostStatus(c.id, 'approved', c.notes)}>
                              Approve
                            </button>
                            <button
                              style={s.btnSmallRed}
                              onClick={() => { setRejectingCostId(isRejecting ? null : c.id); setCostRejectNote('') }}>
                              {isRejecting ? 'Cancel' : 'Reject'}
                            </button>
                          </div>
                        )}
                        {c.status === 'approved' && (
                          <button style={s.btnSmallRed} onClick={() => updateCostStatus(c.id, 'rejected', c.notes)}>Undo approve</button>
                        )}
                      </div>
                    </div>

                    {isRejecting && (
                      <div style={{ ...s.billingEntryExpanded }}>
                        <label style={s.label}>Rejection note (optional)</label>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                          <input style={s.input} value={costRejectNote} onChange={e => setCostRejectNote(e.target.value)} placeholder="Reason for rejection..." />
                          <button style={{ ...s.btnSmallRed, whiteSpace: 'nowrap', opacity: updatingCostId === c.id ? 0.6 : 1 }} disabled={updatingCostId === c.id} onClick={() => updateCostStatus(c.id, 'rejected', costRejectNote)}>
                            {updatingCostId === c.id ? '...' : 'Confirm reject'}
                          </button>
                        </div>
                      </div>
                    )}

                    <div style={{ ...s.billingEntryExpanded, display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <label style={{ ...s.label, margin: 0, whiteSpace: 'nowrap' }}>Budget line</label>
                      <select
                        style={{ ...s.input, flex: 1, opacity: assigningCostId === c.id ? 0.6 : 1 }}
                        disabled={assigningCostId === c.id}
                        value={c.budget_item_id || ''}
                        onChange={e => assignDcBudgetItem(c.id, e.target.value)}>
                        <option value="">— Unassigned —</option>
                        {budgetItems.map(b => (
                          <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── PRIME CONTRACT TAB ── */}
        {activeTab === 'prime' && (
          <>
            <div style={s.card}>
              <p style={s.cardTitle}>Prime contract document</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {job.prime_contract_url && (
                  <button style={s.btnSmallOrange} onClick={openPrimeContractUrl}>View prime contract PDF</button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                  <input type="file" accept=".pdf" style={{ ...s.input, padding: '8px 14px', flex: 1 }} onChange={e => setPrimeContractFile(e.target.files[0])} />
                  <button style={{ ...s.btn, opacity: (!primeContractFile || uploadingPrimeContract) ? 0.5 : 1 }} disabled={!primeContractFile || uploadingPrimeContract} onClick={uploadPrimeContract}>
                    {uploadingPrimeContract ? 'Uploading...' : job.prime_contract_url ? 'Replace' : 'Upload'}
                  </button>
                </div>
              </div>
              {job.contract_value && (
                <p style={{ margin: '1rem 0 0', fontSize: '13px', color: '#555' }}>
                  Contract value: <strong style={{ color: '#f1f1f1' }}>${Number(job.contract_value).toLocaleString()}</strong>
                  <span style={{ fontSize: '12px', color: '#444', marginLeft: '8px' }}>— edit in the Details tab</span>
                </p>
              )}
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>AIA Applications ({aiaApplications.length})</p>
                {!showNewAia && (
                  <button style={s.btnSmallOrange} onClick={() => {
                    setShowNewAia(true)
                    setNewAiaForm({ app_number: String(aiaApplications.length + 1), period_to: '', retainage_pct: '10' })
                  }}>+ New application</button>
                )}
              </div>

              {showNewAia && (
                <div style={{ ...s.inlineForm, border: '1px solid #4a2200', marginBottom: '1.25rem' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>New AIA Application</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 100px 100px', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>App #</label>
                      <input type="number" min="1" style={s.input} value={newAiaForm.app_number} onChange={e => setNewAiaForm(f => ({ ...f, app_number: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Billing period</label>
                      <select style={s.input} value={newAiaForm.period_to} onChange={e => setNewAiaForm(f => ({ ...f, period_to: e.target.value }))}>
                        <option value="">Select month...</option>
                        {(() => {
                          const opts = []
                          const now = new Date()
                          for (let i = 24; i >= -6; i--) {
                            const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
                            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                            const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                            opts.push(<option key={val} value={val}>{label}</option>)
                          }
                          return opts
                        })()}
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Retainage %</label>
                      <input type="number" min="0" max="100" step="0.5" style={s.input} value={newAiaForm.retainage_pct} onChange={e => setNewAiaForm(f => ({ ...f, retainage_pct: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Markup %</label>
                      <input type="number" min="0" step="0.5" style={s.input} value={newAiaForm.markup_pct} onChange={e => setNewAiaForm(f => ({ ...f, markup_pct: e.target.value }))} placeholder="0" />
                    </div>
                  </div>
                  {aiaApplications.length > 0 && (
                    <p style={{ fontSize: '11px', color: '#555', margin: '0 0 12px' }}>
                      % complete from App #{aiaApplications[0].app_number} will auto-carry forward as "Previous" on this application.
                    </p>
                  )}
                  {budgetItems.length === 0 && (
                    <p style={{ fontSize: '12px', color: '#e8590c', margin: '0 0 12px' }}>Add budget line items in the Budget tab first — they become the G703 schedule of values.</p>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: (savingAia || !newAiaForm.period_to || budgetItems.length === 0) ? 0.6 : 1 }}
                      disabled={savingAia || !newAiaForm.period_to || budgetItems.length === 0}
                      onClick={createAiaApplication}>
                      {savingAia ? 'Creating...' : 'Create application'}
                    </button>
                    <button style={s.btnGray} onClick={() => setShowNewAia(false)}>Cancel</button>
                  </div>
                </div>
              )}

              {aiaApplications.length === 0 && !showNewAia && (
                <p style={{ color: '#444', fontSize: '14px' }}>No AIA applications yet. Create your first application above to get started.</p>
              )}

              {aiaApplications.map(app => {
                const isActive = activeAia?.id === app.id
                const periodLabel = app.period_to ? new Date(app.period_to + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'
                return (
                  <div key={app.id} style={{ ...s.billingEntryRow, border: `1px solid ${isActive ? '#4a2200' : '#1e1e1e'}` }}>
                    <div style={{ ...s.billingEntryHeader, cursor: 'pointer' }} onClick={() => openAiaApp(app)}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>App #{app.app_number}</span>
                          <span style={{ fontSize: '13px', color: '#888' }}>{periodLabel}</span>
                          <span style={s.coBadge(app.status === 'certified' ? 'approved' : app.status === 'submitted' ? 'pending' : 'pending')}>{app.status}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {isActive && (
                          <button style={s.btnSmallRed} onClick={e => { e.stopPropagation(); deleteAiaApplication(app.id) }}>Delete</button>
                        )}
                        <span style={{ color: '#555', fontSize: '14px' }}>{isActive ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isActive && (
                      <div style={s.billingEntryExpanded}>
                        {aiaLoading ? (
                          <p style={{ color: '#444', fontSize: '14px' }}>Loading...</p>
                        ) : (
                          <>
                            <div style={{ display: 'flex', gap: '16px', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                              <div>
                                <label style={s.label}>Status</label>
                                <select style={{ ...s.input, width: 'auto' }} value={activeAia.status || 'draft'} onChange={e => setActiveAia(a => ({ ...a, status: e.target.value }))}>
                                  <option value="draft">Draft</option>
                                  <option value="submitted">Submitted</option>
                                  <option value="certified">Certified</option>
                                </select>
                              </div>
                              <div>
                                <label style={s.label}>Retainage %</label>
                                <input type="number" min="0" max="100" step="0.5" style={{ ...s.input, width: '80px' }} value={activeAia.retainage_pct} onChange={e => setActiveAia(a => ({ ...a, retainage_pct: e.target.value }))} />
                              </div>
                              <div>
                                <label style={s.label}>Markup %</label>
                                <input type="number" min="0" step="0.5" style={{ ...s.input, width: '80px' }} value={activeAia.markup_pct || 0} onChange={e => setActiveAia(a => ({ ...a, markup_pct: e.target.value }))} placeholder="0" />
                                {parseFloat(activeAia.markup_pct) > 0 && (
                                  <p style={{ fontSize: '10px', color: '#e8590c', margin: '3px 0 0', whiteSpace: 'nowrap' }}>Applied on G703 billing</p>
                                )}
                              </div>
                            </div>

                            {periodBilling.length > 0 && (
                              <div style={{ background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
                                <p style={{ fontSize: '11px', fontWeight: '700', color: '#60a5fa', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 8px' }}>
                                  Approved billing this period — ${periodBilling.reduce((a, b) => a + Number(b.amount_billed || 0), 0).toLocaleString()} from {periodBilling.length} sub{periodBilling.length !== 1 ? 's' : ''}
                                </p>
                                {periodBilling.map((b, i) => {
                                  const applied = appliedBillings.has(b.id)
                                  const needsManual = manualMapBillingId === b.id
                                  return (
                                    <div key={i} style={{ padding: '6px 0', borderBottom: i < periodBilling.length - 1 ? '1px solid #1a3a5a' : 'none' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                          <span style={{ fontSize: '13px', color: '#aaa' }}>{b.company_name}</span>
                                          {b.retainage_held > 0 && (
                                            <span style={{ fontSize: '11px', color: '#facc15', marginLeft: '8px' }}>({Number(b.retainage_held).toLocaleString('en-US', { minimumFractionDigits: 2 })} ret.)</span>
                                          )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                          <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#f1f1f1' }}>${Number(b.amount_billed).toLocaleString()}</div>
                                            {parseFloat(activeAia?.markup_pct) > 0 && (
                                              <div style={{ fontSize: '10px', color: '#e8590c', marginTop: '1px' }}>
                                                +{activeAia.markup_pct}% = ${(Math.round(Number(b.amount_billed) * (1 + parseFloat(activeAia.markup_pct) / 100) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} billed
                                              </div>
                                            )}
                                          </div>
                                          <button
                                            style={{ padding: '4px 10px', background: applied ? '#0a2a0a' : '#1a2a0a', color: applied ? '#4ade80' : '#a3e635', border: `1px solid ${applied ? '#1a4a1a' : '#3a5a1a'}`, borderRadius: '5px', fontSize: '11px', fontWeight: '700', cursor: applied ? 'default' : 'pointer', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}
                                            disabled={applied}
                                            onClick={() => applyBillingToAia(b)}
                                          >
                                            {applied ? '✓ Applied' : 'Apply to G703'}
                                          </button>
                                        </div>
                                      </div>
                                      {needsManual && (
                                        <div style={{ marginTop: '8px', background: '#0f1a0f', border: '1px solid #2a4a1a', borderRadius: '6px', padding: '10px' }}>
                                          <p style={{ fontSize: '11px', color: '#a3e635', margin: '0 0 8px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>No budget line linked — pick one manually</p>
                                          <p style={{ fontSize: '11px', color: '#555', margin: '0 0 8px' }}>To auto-map in future, assign a budget line item to this subcontract in the Contracts tab.</p>
                                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <select
                                              style={{ ...s.input, flex: 1, fontSize: '12px', padding: '7px 10px' }}
                                              value={manualMapBudgetItemId}
                                              onChange={e => setManualMapBudgetItemId(e.target.value)}
                                            >
                                              <option value="">— Select a budget line —</option>
                                              {budgetItems.map(item => (
                                                <option key={item.id} value={item.id}>
                                                  {item.cost_code ? `${item.cost_code} · ` : ''}{item.description} (${Number(item.owner_amount ?? item.budget_amount).toLocaleString()})
                                                </option>
                                              ))}
                                            </select>
                                            <button
                                              style={{ padding: '7px 14px', background: '#1a3a0a', color: '#a3e635', border: '1px solid #3a5a1a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: manualMapBudgetItemId ? 'pointer' : 'default', opacity: manualMapBudgetItemId ? 1 : 0.4, whiteSpace: 'nowrap' }}
                                              disabled={!manualMapBudgetItemId}
                                              onClick={() => applyBillingManual(b)}
                                            >
                                              Confirm
                                            </button>
                                            <button
                                              style={{ padding: '7px 12px', background: 'transparent', color: '#555', border: '1px solid #2a2a2a', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}
                                              onClick={() => { setManualMapBillingId(null); setManualMapBudgetItemId('') }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            {aiaLines.length === 0 ? (
                              <p style={{ color: '#444', fontSize: '14px' }}>No budget line items found. Add them in the Budget tab.</p>
                            ) : (
                              <>
                                <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                    <thead>
                                      <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                                        <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Description</th>
                                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>Scheduled</th>
                                        <th style={{ textAlign: 'center', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>% Prev</th>
                                        <th style={{ textAlign: 'center', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>% This Period</th>
                                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>Total</th>
                                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>Balance</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {aiaLines.map((line, i) => {
                                        const scheduled = Number(line.budget_amount || 0)
                                        const prevAmt = scheduled * Math.min(100, Math.max(0, parseFloat(line.pct_prev) || 0)) / 100
                                        const thisAmt = scheduled * Math.min(100, Math.max(0, parseFloat(line.pct_this) || 0)) / 100
                                        const total = prevAmt + thisAmt
                                        const balance = scheduled - total
                                        const isPinnedRow = pinnedLineIds.has(line.budget_item_id)
                                        return (
                                          <tr key={line.budget_item_id} style={{ borderBottom: '1px solid #111', background: isPinnedRow ? '#1a0e00' : 'transparent' }}>
                                            <td style={{ padding: '10px', color: '#ccc' }}>
                                              {line.cost_code && <span style={{ fontSize: '10px', color: '#555', marginRight: '8px', fontFamily: 'monospace' }}>{line.cost_code}</span>}
                                              {line.description}
                                              {isPinnedRow && <span style={{ fontSize: '10px', color: '#e8590c', marginLeft: '8px', fontWeight: '700', letterSpacing: '1px' }}>AUTO</span>}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: '#f1f1f1', fontFamily: 'monospace' }}>${Number(scheduled).toLocaleString()}</td>
                                            <td style={{ padding: '10px', textAlign: 'center', color: '#555', fontFamily: 'monospace', fontSize: '12px' }}>
                                              {parseFloat(line.pct_prev) || 0}%
                                            </td>
                                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                              {(() => {
                                                const isPinned = pinnedLineIds.has(line.budget_item_id)
                                                return (
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                                                    <input type="number" min="0" max="100" step="1"
                                                      style={{ ...s.input, textAlign: 'center', padding: '6px 8px', width: '70px', opacity: isPinned ? 0.5 : 1 }}
                                                      value={line.pct_this}
                                                      readOnly={isPinned}
                                                      onChange={e => setAiaLines(v => {
                                                        const updated = v.map((l, idx) => idx === i ? { ...l, pct_this: e.target.value } : l)
                                                        return recalcPinnedLines(updated, pinnedLineIds)
                                                      })} />
                                                    {!isPinned && (
                                                      <button
                                                        title="One-time: set to weighted average % of all other lines"
                                                        onClick={() => autoCalcProRataLine(i)}
                                                        style={{ padding: '5px 7px', background: '#1a1a2a', color: '#60a5fa', border: '1px solid #1a3a5a', borderRadius: '5px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                                                      >≈%</button>
                                                    )}
                                                    <button
                                                      title={isPinned ? 'Pinned — auto-calculates. Click to unpin.' : 'Pin: always auto-calculate to match overall % complete'}
                                                      onClick={() => togglePinLine(line.budget_item_id)}
                                                      style={{ padding: '5px 7px', background: isPinned ? '#2a1800' : '#111', color: isPinned ? '#e8590c' : '#444', border: `1px solid ${isPinned ? '#4a2800' : '#2a2a2a'}`, borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}
                                                    >📌</button>
                                                  </div>
                                                )
                                              })()}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: total > 0 ? '#4ade80' : '#555', fontFamily: 'monospace' }}>${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: balance < 0 ? '#ff6b6b' : '#555', fontFamily: 'monospace' }}>${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {(() => {
                                  const retPct = Math.max(0, Math.min(100, parseFloat(activeAia.retainage_pct) || 10)) / 100
                                  const approvedCOsVal = primeCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
                                  const contractSumToDate = Number(job.contract_value || 0) + approvedCOsVal
                                  const totalSov = aiaLines.reduce((a, l) => a + Number(l.budget_amount || 0), 0)
                                  const sovMismatch = Math.abs(totalSov - contractSumToDate) > 0.01
                                  const totalCompleted = aiaLines.reduce((a, line) => {
                                    const sv = Number(line.budget_amount || 0)
                                    return a + sv * (Math.min(100, Math.max(0, parseFloat(line.pct_prev) || 0)) + Math.min(100, Math.max(0, parseFloat(line.pct_this) || 0))) / 100
                                  }, 0)
                                  const totalRetainage = totalCompleted * retPct
                                  const totalPrevCompleted = aiaLines.reduce((a, line) => {
                                    const sv = Number(line.budget_amount || 0)
                                    return a + sv * Math.min(100, Math.max(0, parseFloat(line.pct_prev) || 0)) / 100
                                  }, 0)
                                  const earnedLessRet = totalCompleted - totalRetainage
                                  const prevCerts = totalPrevCompleted * (1 - retPct)
                                  const currentDue = earnedLessRet - prevCerts
                                  return (
                                    <>
                                      {sovMismatch && (
                                        <div style={{ background: '#2a1200', border: '1px solid #e8590c', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                                          <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#e8590c', fontWeight: '700' }}>
                                            SOV total (${totalSov.toLocaleString()}) doesn't match contract sum to date (${contractSumToDate.toLocaleString()})
                                          </p>
                                          <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>
                                            Update the owner amounts on your budget items in the Budget tab so the G703 totals balance before generating.
                                          </p>
                                        </div>
                                      )}
                                      <div style={{ background: '#0f0f0f', border: `1px solid ${sovMismatch ? '#5a1a1a' : '#2a2a2a'}`, borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }}>
                                        <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>G702 Summary</p>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: '13px' }}>
                                          <span style={{ color: '#555' }}>Contract sum to date</span><span style={{ color: '#f1f1f1', textAlign: 'right', fontFamily: 'monospace' }}>${contractSumToDate.toLocaleString()}</span>
                                          <span style={{ color: '#555' }}>SOV total (G703)</span><span style={{ color: sovMismatch ? '#ff6b6b' : '#f1f1f1', textAlign: 'right', fontFamily: 'monospace' }}>${totalSov.toLocaleString()}</span>
                                          <span style={{ color: '#555' }}>Total completed</span><span style={{ color: '#f1f1f1', textAlign: 'right', fontFamily: 'monospace' }}>${totalCompleted.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                          <span style={{ color: '#555' }}>Retainage ({activeAia.retainage_pct}%)</span><span style={{ color: '#555', textAlign: 'right', fontFamily: 'monospace' }}>(${totalRetainage.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span>
                                          <span style={{ color: '#555' }}>Less previous certificates</span><span style={{ color: '#555', textAlign: 'right', fontFamily: 'monospace' }}>(${prevCerts.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span>
                                          <span style={{ color: '#f1f1f1', fontWeight: '700' }}>Current payment due</span><span style={{ color: '#e8590c', textAlign: 'right', fontFamily: 'monospace', fontWeight: '800', fontSize: '15px' }}>${currentDue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        </div>
                                      </div>
                                    </>
                                  )
                                })()}

                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button style={{ ...s.btn, opacity: savingAia ? 0.6 : 1 }} disabled={savingAia} onClick={saveAiaLines}>{savingAia ? 'Saving...' : 'Save application'}</button>
                                  <button style={s.btnGray} onClick={generateAIAFromApp}>Generate AIA G702/G703</button>
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

      </main>
    </div>
  )
}
