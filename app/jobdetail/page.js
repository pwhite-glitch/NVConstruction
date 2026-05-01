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
const emptyCO = { subcontract_id: '', amount: '', description: '', direction: 'pm_to_sub', sov: [] }
const emptyPrimeCO = { amount: '', description: '', notes: '', sov: [] }
const emptySOVRow = { description: '', budget_item_id: '', amount: '' }
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
  const [showContractGen, setShowContractGen] = useState(false)
  const [contractGenForm, setContractGenForm] = useState({ contract_id: '', date: '', sub_name: '', sub_address: '', entity_type: 'sole proprietorship', trade: '', project_name: '', project_address: '', owner_name: '', owner_address: '', contract_amount: '', pay_pct: '100', scope_of_work: '', job_number: '', subcontract_number: '', pm_name: 'Peyton White', superintendent: 'Landon Moore' })

  // Change orders state
  const [allCOs, setAllCOs] = useState([])
  const [showAddCO, setShowAddCO] = useState(false)
  const [coForm, setCoForm] = useState(emptyCO)
  const [addingCO, setAddingCO] = useState(false)
  const [primeCOs, setPrimeCOs] = useState([])
  const [showAddPrimeCO, setShowAddPrimeCO] = useState(false)
  const [primeCOForm, setPrimeCOForm] = useState(emptyPrimeCO)
  const [addingPrimeCO, setAddingPrimeCO] = useState(false)
  const [pushCOId, setPushCOId] = useState(null)
  const [pushMarkup, setPushMarkup] = useState('')
  const [pushingToPrime, setPushingToPrime] = useState(false)
  const [expandedPrimeCOId, setExpandedPrimeCOId] = useState(null)
  const [expandedSubCOId, setExpandedSubCOId] = useState(null)

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

  // Schedule tab state
  const [scheduleFiles, setScheduleFiles] = useState([])
  const [uploadingSchedule, setUploadingSchedule] = useState(false)
  const [parsedTasks, setParsedTasks] = useState(null)
  const [parsedFrom, setParsedFrom] = useState(null)

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
    if (activeTab === 'schedule') { loadScheduleFiles() }
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

  // ── Schedule ────────────────────────────────────────────────
  async function loadScheduleFiles() {
    const { data } = await supabase.from('job_schedule_files').select('*').eq('job_id', id).order('uploaded_at', { ascending: false })
    setScheduleFiles(data || [])
  }

  async function uploadScheduleFile(file) {
    setUploadingSchedule(true)
    const path = `${id}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('schedule-files').upload(path, file)
    if (error) { alert('Upload error: ' + error.message); setUploadingSchedule(false); return }
    await supabase.from('job_schedule_files').insert({ job_id: id, file_name: file.name, storage_path: path, file_type: file.name.split('.').pop().toLowerCase() })
    if (file.name.toLowerCase().endsWith('.xml')) {
      const text = await file.text()
      const tasks = parseProjectXml(text)
      setParsedTasks(tasks)
      setParsedFrom(file.name)
    }
    await loadScheduleFiles()
    setUploadingSchedule(false)
  }

  async function openScheduleFile(storagePath) {
    const { data } = await supabase.storage.from('schedule-files').createSignedUrl(storagePath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteScheduleFile(fileId, storagePath) {
    if (!window.confirm('Delete this file?')) return
    await supabase.storage.from('schedule-files').remove([storagePath])
    await supabase.from('job_schedule_files').delete().eq('id', fileId)
    await loadScheduleFiles()
    if (parsedFrom && storagePath.includes(parsedFrom)) { setParsedTasks(null); setParsedFrom(null) }
  }

  function parseProjectXml(xmlText) {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlText, 'application/xml')
      const taskNodes = doc.querySelectorAll('Tasks > Task')
      const tasks = []
      taskNodes.forEach(t => {
        const uid = t.querySelector('UID')?.textContent
        if (uid === '0') return
        const name = t.querySelector('Name')?.textContent || ''
        const start = t.querySelector('Start')?.textContent || ''
        const finish = t.querySelector('Finish')?.textContent || ''
        const pct = t.querySelector('PercentComplete')?.textContent || '0'
        const milestone = t.querySelector('Milestone')?.textContent === '1'
        const summary = t.querySelector('Summary')?.textContent === '1'
        if (!name) return
        tasks.push({ uid, name, start: start.slice(0, 10), finish: finish.slice(0, 10), pct: parseInt(pct, 10), milestone, summary })
      })
      return tasks
    } catch { return [] }
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

  function openContractGenerator(contract) {
    const subName = contract.vendor_name || registeredSubs.find(s => s.sub_id === contract.sub_id)?.profiles?.company_name || ''
    const yr = new Date().getFullYear().toString().slice(2)
    const idx = contracts.findIndex(c => c.id === contract.id)
    const subNo = String((idx >= 0 ? idx : contracts.length) + 1).padStart(3, '0')
    const jobNum = job?.job_number || ''
    setContractGenForm({
      contract_id: contract.id,
      date: new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
      sub_name: subName,
      sub_address: '',
      entity_type: 'sole proprietorship',
      trade: contract.description || '',
      project_name: job?.project_name || '',
      project_address: job?.location || '',
      owner_name: '',
      owner_address: '',
      contract_amount: String(contract.contract_value || ''),
      pay_pct: '100',
      scope_of_work: '',
      job_number: jobNum,
      subcontract_number: `${yr}-${jobNum}-${subNo}`,
      pm_name: 'Peyton White',
      superintendent: 'Landon Moore',
    })
    setShowContractGen(true)
  }

  function generateSubcontract() {
    const f = contractGenForm
    const fmt = v => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const subNoShort = f.subcontract_number.split('-').pop() || f.subcontract_number
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Subcontract — ${f.sub_name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Times New Roman',serif;font-size:11pt;color:#000;background:#fff}
.page{width:8.5in;min-height:11in;padding:.8in 1in;position:relative;page-break-after:always}
.page:last-child{page-break-after:auto}
.logo-wrap{text-align:center;margin-bottom:28px}
.logo-box{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:130px;height:130px;background:#1b2a4a}
.logo-nv{color:#e8560c;font-size:54px;font-weight:900;font-family:Arial Black,sans-serif;line-height:1;letter-spacing:-2px}
.logo-sub{color:#fff;font-size:7.5px;letter-spacing:2.5px;font-family:Arial,sans-serif;margin-top:5px}
.sub-num{font-weight:bold;border-bottom:1px solid #000;padding-bottom:4px;margin-bottom:14px}
.nv-hdr{font-size:12pt;font-weight:bold;text-decoration:underline;margin-bottom:4px}
.agreement-title{text-align:center;font-size:14pt;font-weight:bold;text-decoration:underline;margin:16px 0}
p{margin-bottom:9px;line-height:1.55}
.indent{margin-left:36px}
.num-item{margin-left:28px;margin-bottom:10px;line-height:1.55}
.gp-title{text-align:center;font-size:13pt;font-weight:bold;margin-bottom:18px}
.provision{margin-bottom:12px;line-height:1.6;text-align:justify}
.pnum{font-weight:bold}
.initial{position:absolute;bottom:22px;right:40px;font-size:10pt;border-top:1px solid #000;padding-top:3px;width:55px;text-align:center}
.sig-line{border-bottom:1px solid #000;display:inline-block;vertical-align:bottom}
.dbl{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:14px}
.footer-bar{border-top:3px solid #e8560c;margin-top:32px}
.footer-bar2{border-top:1px solid #e8560c;margin-top:4px}
.footer-addr{text-align:center;font-size:9pt;color:#444;margin-top:8px}
.bold{font-weight:bold}.ul{text-decoration:underline}.bu{font-weight:bold;text-decoration:underline}
.section-lg{font-weight:bold;font-size:13pt;margin:18px 0 8px}
.sc-italic-title{font-style:italic;font-weight:bold;font-size:14pt;text-decoration:underline;text-align:center}
.cps-title{font-weight:bold;font-size:13pt;text-decoration:underline;text-align:center;margin-bottom:12px}
@media print{.page{page-break-after:always}.page:last-child{page-break-after:auto}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>

<!-- PAGE 1: COVER LETTER -->
<div class="page">
  <div class="logo-wrap"><div class="logo-box"><div class="logo-nv">NV</div><div class="logo-sub">NV CONSTRUCTION</div></div></div>
  <p>${f.date}</p>
  <p>${f.sub_name}<br>${f.sub_address}</p>
  <br>
  <p>Dear ${f.sub_name}:</p>
  <br>
  <p class="indent">Please carefully review paragraphs # 5 and #23 of the enclosed contract. All change orders <span class="bu">must</span> have written authorization (defined as a formal NV Construction change order or an email approval defining scope and cost) from the Project Manager before work is commenced in order to ensure you will be paid for the work. All payment requests including claims for additional work must include a formal signed NV Construction Change Order in order for your draw to be processed and paid.</p>
  <br>
  <p class="indent">While I understand that in the heat of battle, a NV Construction employee may ask you to perform work with a verbal authorization; you must get that authorization in writing before proceeding. Any work done with only a verbal agreement will result in not being paid. Also, please note in paragraph #23 that the NV superintendent is <span class="bu">not</span> authorized to approve change orders for additional work. That approval must come from the Project Manager.</p>
  <br>
  <p class="indent">I highlight these paragraphs to protect you as a subcontractor and to ensure that at the end of the job there are no surprises for any of us, including our client.</p>
  <br>
  <p class="indent"><span class="ul">We appreciate your cooperation in this matter and look forward to working with you on this project. Please acknowledge your agreement and understanding of this requirement by signing this letter in the space provided below, and then return the signed copy with your contract.</span></p>
  <br><br>
  <p>Sincerely,</p>
  <br><br>
  <p>Nishil Patel<br>CEO<br>NV Construction LLC</p>
  <br><br>
  <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
    <div style="text-align:center;width:290px"><div style="border-bottom:1px solid #000;height:24px;margin-bottom:4px"></div><div style="font-size:9pt">Subcontractor Signature</div></div>
  </div>
  <br>
  <p>Subcontract #<br>${f.subcontract_number}</p>
  <div class="footer-bar"></div><div class="footer-bar2"></div>
  <div class="footer-addr">2000 N. Eastman Road &nbsp;&bull;&nbsp; Longview, TX 75601 &nbsp;&bull;&nbsp; www.nv.construction</div>
</div>

<!-- PAGE 2: SUBCONTRACT AGREEMENT -->
<div class="page">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <div class="nv-hdr">NV Construction</div>
  <div class="agreement-title">SUBCONTRACT AGREEMENT</div>
  <p>THIS AGREEMENT is made and entered into on ${f.date} (the "Subcontract"), by and between <strong>NV Construction</strong>, a Texas limited partnership, 2000 N. Eastman Road Longview, Texas 75601 ("Contractor"), and ${f.sub_name}, a (sole proprietorship / partnership / corporation) of the State of Texas whose principal address is ${f.sub_address} ("Subcontractor").</p>
  <p class="indent">IN CONSIDERATION of the mutual covenants made by Contractor and Subcontractor, the parties mutually agree as follows:</p>
  <div class="num-item"><strong>1.</strong>&nbsp;&nbsp;Subcontractor agrees to furnish all labor, material, equipment, services, supplies and scaffolding and to pay all applicable federal, state, and local taxes required for the completion of the ${f.trade} work (the "Subcontract Work") for the following project (the "Project"):</div>
  <div style="text-align:center;margin:14px 0"><strong>${f.project_name}</strong><br>${f.project_address}</div>
  <div class="num-item"><strong>2.</strong>&nbsp;&nbsp;Subcontractor shall perform the Subcontract Work in accordance with the terms of the contract between Contractor and ${f.owner_name} ("Owner"), ${f.owner_address} for the construction of the Project (the "General Contract").</div>
  <div class="num-item"><strong>3.</strong>&nbsp;&nbsp;Contractor agrees to pay Subcontractor for the Subcontract Work, and Subcontractor agrees to accept therefore, the sum of <strong>${fmt(f.contract_amount)}</strong>, payment to be made in accordance with Article 2 of the attached "General Provisions."</div>
  <div class="num-item"><strong>4.</strong>&nbsp;&nbsp;The percentage of each estimate to be paid under Article 2 of the General Provisions shall be ${f.pay_pct === '100' ? 'one hundred percent (100%)' : f.pay_pct + '%'}.</div>
  <div class="num-item"><strong>5.</strong>&nbsp;&nbsp;The attached General Provisions are incorporated into and made a part of this Subcontract.</div>
  <br>
  <p style="font-size:10.5pt">IN WITNESS WHEREOF, the parties hereto have executed this agreement for themselves, their heirs, executors, successors, administrators and assigns.</p>
  <p style="margin:14px 0"><span class="bold">Job No:</span> ${f.job_number} &nbsp;&nbsp;&nbsp;&nbsp; <span class="bold">Subcontract No:</span> ${subNoShort} &nbsp;&nbsp;&nbsp;&nbsp; <span class="bold">Contract Amount:</span> ${fmt(f.contract_amount)}</p>
  <div class="dbl">
    <div>
      <p><strong>NV Construction LLC</strong></p><br>
      <p>Signature: <span class="sig-line" style="width:190px"></span></p><br>
      <p>Title: <span class="sig-line" style="width:130px"></span> &nbsp; Date: <span class="sig-line" style="width:90px"></span></p>
      <p>PM: ${f.pm_name}</p>
    </div>
    <div>
      <p><strong>SUBCONTRACTOR:</strong> ${f.sub_name}</p><br>
      <p>Signature: <span class="sig-line" style="width:190px"></span></p>
      <p style="font-size:9pt;text-align:center">(Company officer's signature)</p><br>
      <p>Title: <span class="sig-line" style="width:110px"></span> &nbsp; Date: <span class="sig-line" style="width:80px"></span></p>
      <p>Federal I.D. <span class="sig-line" style="width:120px"></span></p>
      <p>Phone #: <span class="sig-line" style="width:85px"></span> &nbsp; Fax #: <span class="sig-line" style="width:75px"></span></p>
      <p>Cell#: <span class="sig-line" style="width:125px"></span></p>
      <p>E-Mail: <span class="sig-line" style="width:140px"></span></p>
    </div>
  </div>
  <div class="initial">Initial</div>
</div>

<!-- PAGE 3: CONTRACT DOCUMENTS & SCOPE OF WORK -->
<div class="page">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <p class="section-lg">CONTRACT DOCUMENTS:</p>
  <p>Subcontractor Proposal<br>Link to Current Plan Sheets<br>Exhibit A Attached<br>Exhibit B Attached<br>Schedule</p>
  <br>
  <p><strong>SUBMITTALS</strong><br>Provide materials and equipment per plans and specifications. No substitutions allowed. Subcontractor is responsible for any delay arising from substitution requests. Submittal documents for Owner's records to be provided via overnight delivery to NV Construction, 2000 N. Eastman Road Longview, Texas 75601 – Phone: 903-331-8895.</p>
  <p>Completion of submittal requirements in their entirety is required within one week of contract issuance. Approval of submittals within one week of receipt will be requested from Architect.</p>
  <br>
  <p><span class="bu">SUPPLIER / MATERIAL NOTIFICATION REQUIREMENTS</span><br><strong>All supplies and materials purchased for above referenced job site must be listed on the Application &amp; Certificate for Payment form. Required information must include: Name of Company (ies), phone number(s) with area code, dollar amount furnished to date, amount paid to date and materials purchased. This information MUST be provided to NV Construction before the first draw is paid.</strong></p>
  <br>
  <p><strong>CLEAN-UP</strong><br>All work is to be done with care and consideration of surrounding, customers, employees, other trades and the existing premises in general and in accordance with Landlord requirements. Park within designated areas. Follow prescribed traffic routes.</p>
  <p>Construction site to be kept broom clean and ready for public access daily as required. Construction debris shall be placed by Subcontractor in a NV Construction provided dumpster daily.</p>
  <br>
  <p><strong>SAFETY</strong><br>Subcontractor shall obey, maintain, and comply with all laws, regulations, and safety programs (collectively "Safety Standards"), including those set forth in applicable OSHA guidelines and Material Safety Data Sheets ("MSDS"). Subcontractor shall provide to NV Construction superintendent a copy of Safety Program and subcontractor shall maintain onsite all applicable MSDS for this project.</p>
  <p>Subcontractor shall defend, indemnify and hold harmless Contractor from and against any and all damages, liabilities, penalties, costs, and fees, including attorney fees, arising out of or concerning subcontractor violations, breaches, or penalties relating to the Safety Standards. Hard hats, hard sole shoes and other proper attire are to be worn during all construction. <strong>Safety program and competent person form must be onsite before first draw is paid.</strong></p>
  <br>
  <p><strong>SCHEDULE</strong><br>Time is of the essence in this project. Attend weekly site construction meetings as requested to coordinate work schedules and adjustments necessary due to project staging.</p>
  <br>
  <p class="section-lg">SCOPE OF WORK</p>
  <p style="white-space:pre-wrap">${f.scope_of_work}</p>
  <br>
  <p>* Change Orders: You must receive written authorization from the Project Manager before you begin the work.<br>* Daily broom swept clean-up of all trash &amp; debris<br>* Comply with all OSHA regulations. *PPE will be required at all times for this job<br>* Time is of the essence for this project. Complete work per schedule provided below.</p>
  <div class="initial">Initial</div>
</div>

<!-- PAGE 4: GENERAL PROVISIONS 1-4 -->
<div class="page">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <div class="gp-title">GENERAL PROVISIONS</div>
  <div class="provision"><span class="pnum">1.&nbsp;&nbsp;&nbsp;&nbsp;THE "GENERAL CONTRACT" DOCUMENTS:</span> "General Contract" as used in this Subcontract means the contract documents between Contractor and Owner, including all the provisions, general conditions, plans, drawings, specifications, and addenda. Copies of all these documents are on file at the offices of Contractor and are available for inspection by Subcontractor, subject to reasonable redaction of pricing information at Contractor's sole discretion. Insofar as the provisions of the General Contract do not conflict with the specific provisions contained in this Subcontract, they are hereby incorporated as if fully rewritten herein. In the event of a discrepancy between the General Contract and this Subcontract, this Subcontract shall govern. Subcontractor hereby assumes all duties and obligations to Contractor which Contractor has assumed toward Owner in the General Contract to the extent the duties and obligations are not in conflict with the provisions contained in this Subcontract. Subject to the foregoing qualification, Subcontractor agrees to comply with and not violate any term, covenant, or condition of the General Contract, including, but not limited to, any provisions regarding (a) nondiscrimination in employment; (b) Davis-Bacon Act; (c) Contract Work Hours Standards Act; (d) apprentices; (e) signed payroll records and payroll; (f) Copeland (Anti-Kickback) Act--non-rebate of wages; (g) withholding of funds to assure wage payments; (h) termination of subcontract; (i) Buy-American Act; (j) specifications and drawings; (k) changed conditions; (l) termination; (m) materials and workmanship; (n) inspection; (o) other contracts; (p) bonding requirements; (q) renegotiation, and (r) to the extent applicable California prevailing wage requirements. Subcontractor shall be liable for any and all damages assessed by Owner against Contractor, whether direct, actual or consequential, to the extent the damages are attributable to the performance of the Subcontract Work and/or any acts or omissions of Subcontractor in relation to this Subcontract.</div>
  <div class="provision"><span class="pnum">2.&nbsp;&nbsp;&nbsp;&nbsp;PAYMENT:</span> Payments to Subcontractor shall be made monthly in accordance with the procedures and requirements set forth in subparagraphs (1) - (8) below. Subcontractor agrees and acknowledges that Contractor may withhold monthly progress payments in whole or in part in order to protect Contractor from loss because of any breach of this Subcontract, including the items enumerated in Paragraph 15 (Failure to Perform).<br>&nbsp;&nbsp;&nbsp;&nbsp;(1)&nbsp;Applications for payment shall be made bi-weekly in accordance to the Billing Calendar provided in Exhibit B. These applications are to be turned in Bi-Weekly and will be processed and paid within 7 days of the due date highlighted on Exhibit B. The check will then be available for Pickup at our main office at 2000 N. Eastman Road or will be via USPS to your home office. There will be NO EXCEPTIONS.<br>&nbsp;&nbsp;&nbsp;&nbsp;(2)&nbsp;If satisfactory, the estimate will be incorporated into Contractor's estimate and forwarded to Owner.<br>&nbsp;&nbsp;&nbsp;&nbsp;(3)&nbsp;To the extent that Owner approves Subcontractor's estimate and not later than ten days after payment to Contractor, Contractor shall pay Subcontractor the percentage of Subcontractor's estimate set out in Paragraph 4 of the Subcontract, provided that it shall not be incumbent upon Contractor to make payments in an amount that would not leave a sufficient balance to cover all obligations of Subcontractor for labor, materials, etc., previously furnished by Subcontractor under this Subcontract.<br>&nbsp;&nbsp;&nbsp;&nbsp;(4)&nbsp;Final payment will be paid within 15 days of acceptance of, and final payment for, the entire work by Owner, but not before delivery of executed releases or lien waivers from Subcontractor, and its subcontractors and suppliers, as required by Contractor.<br>&nbsp;&nbsp;&nbsp;&nbsp;(5)&nbsp;Title for all materials and work covered by estimates and/or requisitions for payment for which progress payments have been made shall pass to Contractor (or Owner, if the arrangements between Contractor and Owner so provide). However, passage of title shall not relieve Subcontractor from responsibility for all defective materials and work for which payments have been made, the restoration of any damaged work or the maintenance of insurance thereon if required by other provisions of this Subcontract. Nor shall it be considered a waiver of the right of Contractor or Owner to require fulfillment of all terms of this Subcontract.<br>&nbsp;&nbsp;&nbsp;&nbsp;(6)&nbsp;All progress payments and final payment pursuant to this Subcontract are contingent and subject to Owner's acceptance of all work performed by Subcontractor and, to the extent permitted by governing law, Contractor's receipt of payment from Owner for Subcontractor's work. In their negotiations, Subcontractor and Contractor have addressed the contingency that Owner may not pay Contractor for work performed by Subcontractor, and Subcontractor has agreed and does hereby agree to accept the risk of nonpayment by Owner, to the extent permitted by governing law, for whatever reason, it being specifically understood that payment by Owner to Contractor for Subcontractor's work, whether for progress payment or final payment, is a condition precedent to Contractor's liability to pay Subcontractor. Subcontractor's price of the work includes an amount for assuming this risk.<br>&nbsp;&nbsp;&nbsp;&nbsp;(7)&nbsp;Subcontractor agrees to submit to Contractor with each Application for Payment reasonable backup documentation for Subcontractor's costs, and all documents required by the construction lien laws in the state of the project, including lien waivers and sworn statements.<br>&nbsp;&nbsp;&nbsp;&nbsp;(8)&nbsp;Subcontractor agrees to submit to Contractor with each Application for Payment reasonable backup documentation for Subcontractor's costs, and all documents required by the construction lien laws in the state of the project, including lien waivers and sworn statements.</div>
  <div class="provision"><span class="pnum">3.&nbsp;&nbsp;&nbsp;&nbsp;PERFORMANCE:</span> Subcontractor agrees to perform the Subcontract Work in a careful and workmanlike manner in accordance with the best construction practices and with this Subcontract, and in strict accordance with the General Contract. Subcontractor agrees to procure materials and supplies in advance and to provide sufficient men, equipment, scaffolding and supervision to ensure that the Subcontract Work will be prosecuted diligently and coordinated with other work at the site and completed within the time allotted and in accordance with the requirements of the General Contract. Subcontractor shall have a supervisor at all times on the job site. Unless otherwise agreed upon, Subcontractor shall be responsible for all handling of its materials at the job site, including, but not limited to, hoisting, deliveries, transportation, unloading, storing and safekeeping. Subcontractor agrees to pay all freight, storage, taxes, or other incidental expenses associated with its materials. All materials stored at the job site shall be at the risk of Subcontractor unless otherwise agreed upon in writing by Contractor. Contractor assumes no responsibility or liability for materials received or stored by Subcontractor and, unless otherwise agreed in writing by Contractor, Subcontractor assumes full responsibility for loss or damage of any nature to its equipment while in use or stored at the job site. Subcontractor agrees to pay not less than the scale of wages prescribed in the General Contract, or not less than the scale prescribed by law in the event the General Contract provides no such scale. Subcontractor shall insure that all lower-tier subcontractors, suppliers and employees, at all times, are timely paid all amounts due in connection with the performance of this Subcontract, including but not limited to all wages, fringe or other benefit payments or contributions. Subcontractor shall obtain and pay for all permits, licenses and fees required for the performance of the Subcontract Work and shall comply with all applicable ordinances, statutes and regulations relating to the Subcontract Work. Subcontractor shall defend, indemnify and hold harmless Contractor from and against any claim, damages, liability, and losses arising out of Subcontractor's failure or alleged failure to comply with such ordinances, statutes or regulations. These indemnifications, defense, and hold harmless obligations include, but are not limited to, any liability or damage created by the nonpayment of wages, fringe or other benefit payments, or contributions by Subcontractor or by a subcontractor at any tier working under Subcontractor or otherwise failing to comply with Cal. Labor Code section 218.7. Subcontractor has satisfied himself, by his own investigation, regarding the conditions affecting the Subcontract Work to be done and materials to be furnished, and as to the meaning and intention of the General Contract.</div>
  <div class="provision"><span class="pnum">4.&nbsp;&nbsp;&nbsp;&nbsp;COMMENCEMENT AND COMPLETION OF THE WORK:</span> Time is of the essence of this Subcontract. Subcontractor agrees to supply materials, labor and equipment as necessary to commence the Subcontract Work when directed by Contractor. Subcontractor shall diligently pursue the completion of the Subcontract Work and coordinate the Subcontract Work with that being done on the project by Contractor and other trades so that the Subcontract Work or the work of others shall not be delayed or impaired by any act or omission by Subcontractor. Contractor shall have the right to decide the time or order in which the various portions of the work shall be undertaken or completed or the priority of the work of other subcontractors, and, in general, all matters representing the timely and orderly conduct of the Subcontract Work on the premises. Contractor may prepare a coordinated progress schedule, and if he does so, Subcontractor shall be required to perform the work in accordance with such schedule as it may be modified by Contractor as work progresses. Any Critical Path Method ("CPM") schedules or other schedules generated by Contractor shall become part of this Subcontract. Subcontractor shall be liable for any liquidated damages which may become due to Owner under the General Contract or any extra expenses incurred by Contractor, such as overhead and supervision, due to Subcontractor's delays. In the event Subcontractor's performance of the Subcontract Work is delayed, accelerated or interfered with, for any reason and for any period of time, by acts or omissions of Owner, Architect, Contractor, other subcontractors or third persons, Subcontractor may request an extension of time for performance of the Subcontract Work in accordance with the provisions of Paragraphs 5 and 7, it being expressly agreed that said time extension is the sole and exclusive remedy to which Subcontractor is entitled for such delay, acceleration or interference, and Subcontractor shall not be entitled to any increase in the Subcontract amount or to damages or additional compensation as a consequence of such delay, acceleration or interference, save and except to the extent that the General Contract entitles Contractor to compensation, and then only to the extent of any amounts that Contractor may, on behalf of Subcontractor, actually receive from the Owner.</div>
  <div class="initial">Initial</div>
</div>

<!-- PAGE 5: GENERAL PROVISIONS 5-8 -->
<div class="page">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <div class="provision"><span class="pnum">5.&nbsp;&nbsp;&nbsp;&nbsp;CHANGES IN THE WORK:</span> Contractor shall have the right to change the Subcontractor Work by issuing a Construction Change Directive signed by Contractor, or a Change Order signed by Contractor and Subcontractor. Should Contractor, at any time during the progress of the work, request a Change Order to change the scope of the Subcontract Work in this Subcontract, Subcontractor shall within five (5) days thereafter submit an itemized estimate reflecting any cost changes required to make the changes, it being distinctly understood and agreed, regardless from whom orders may be taken for changes in the scope of the work, that no such changes are to be made except by a subcontract Change Order issued by Contractor and then only when such order sets forth the amount of any addition or deduction and is signed by both parties thereto, or a Construction Change Directive signed by Contractor. If Subcontractor initiates a substitution, deviation or change in the work which affects the scope of the work or the Subcontract Work or causes expense to Contractor, Subcontractor shall be liable for the expenses thereof and is not entitled to an increase in the subcontract price, unless there is a Change Order executed by both parties or a Construction Change Directive executed by Contractor. Once Contractor and Subcontractor agree to a price for the changes set forth in the Construction Change Directive, they shall execute a Change Order reflecting those terms. If Contractor and Subcontractor are unable to agree on a price for the changes set forth in a Construction Change Directive, then Subcontractor shall still perform the changes in accordance with the Construction Change Directive, Contractor shall pay Subcontractor the price which Contractor believes is reasonable for the changes, and Subcontractor shall have a right to make a claim for any remaining amounts subject to the terms in Paragraph 7 of this Subcontract.</div>
  <div class="provision"><span class="pnum">6.&nbsp;&nbsp;&nbsp;&nbsp;DEFECTIVE WORK:</span> Payments otherwise due may be withheld by Contractor on account of defective work not remedied, claims filed, evidence indicating probability of filing of claims, failure of Subcontractor to make payments properly to its subcontractors or for material or labor, or a reasonable doubt that the Subcontract can be completed for the balance then unpaid. If said causes are not removed, within 72 hours after written notice, Contractor may rectify the same at Subcontractor's expense, or any other reasonable exposure to Contractor for costs, damages, or liability. If at any time Contractor determines that Subcontractor's financial condition has become such that Subcontractor may be unable to perform the Subcontract Work in accordance with its obligations under this Subcontract, Contractor shall have the right to demand and Subcontractor shall furnish satisfactory security to Contractor within 72 hours after written notice to Subcontractor, and in the event Subcontractor defaults in the furnishing of the security, Contractor shall have the option to terminate this Subcontract in which case, the rights of Contractor shall be the same as if Subcontractor had failed to perform this Subcontract in whole or in part. Contractor shall have the right to deduct from any amounts due Subcontractor under this Subcontract or any other agreement, the amount of any claim owed by Subcontractor to Contractor whether or not such claim arises out of this Subcontract. Subcontractor agrees to be bound by all the provisions of the General Contract, including but not limited to, provisions relating to quantities, measurement and payment, to change orders, extra work, variations in plans or site conditions, time extensions and claims. If any part of the Subcontract Work depends upon the work of Contractor or of any other subcontractor, Subcontractor shall inspect such other work and promptly report to Contractor any defects or inadequate performance which adversely affects Subcontractor's work. If there appear to be any variations or discrepancies in dimensions, quantities, or other matters set forth in the plans, specifications, and other portions of the General Contract, Subcontractor will promptly bring the matter to the attention of Contractor in writing. Subcontractor agrees to be bound by the terms of the General Contract with respect to such variations.</div>
  <div class="provision"><span class="pnum">7.&nbsp;&nbsp;&nbsp;&nbsp;CLAIMS AND DISPUTES:</span> All claims, including for increases in subcontract price or time, or for damages, and regardless of whether the claim is for delays, disruption, interference, differing site conditions, extras, changes, or administration of the Subcontract, which Subcontractor has or wishes to assert against Contractor must be presented in writing to Contractor not later than 10 days after Subcontractor is aware or should be aware that a claim will or does exist, even though the exact nature of the claim and the amount of the claim may not be determinable at that time. If Subcontractor fails to submit the claim in writing to Contractor within the time required in this paragraph, then Subcontractor waives the claim and any right to recover for the claim, including any damages in any way related to the claim. The nature of the claim and the amount of the claim, to the extent known at the time, must be presented to Contractor in the required writing.<br>&nbsp;&nbsp;&nbsp;&nbsp;(1)&nbsp;Subject to the foregoing requirements in this Paragraph 7, should any dispute or controversy arise between Contractor and Subcontractor concerning any matter involving or arising out of the Subcontract, the following procedures shall apply. If the claim results from action or acts by Owner, including without limitation, changes ordered, interpretation of the General Contract by Owner or its authorized representative, or any dispute arising out of inaccuracies, deficiencies, discrepancies or ambiguities in the General Contract, then Subcontractor shall make all claims promptly to Contractor for additional costs, extensions of time, and damages for delays or other causes in accordance with the General Contract. Any such claims which will affect or become part of a claim which Contractor is required to make under the General Contract within a specified time period or in a specified manner shall be made in a sufficient time to permit Contractor to satisfy the requirements of the General Contract. Failure of Subcontractor to make such a timely claim shall bind Subcontractor to the same consequences as those to which Contractor is bound. Subcontractor shall be bound by all procedural provisions, administrative determinations and final judgments which are binding on Contractor as to such claims. Subcontractor shall bear the expenses, including reimbursement of Contractor's attorney fees and providing a reasonable retainer to initiate a claim against the Owner, and the burden of prosecuting and proving any such claims against Owner and shall give Contractor adequate and timely notification in writing of any such claim or dispute action it desires Contractor to make on its behalf against Owner. The terms of the dispute resolution and claims procedure contained in the General Contract shall be binding upon Subcontractor, whether or not Subcontractor records or files a mechanic's lien, stop notice or prosecutes suit thereon or against any bond posted by Contractor; and Subcontractor hereby acknowledges that this Subcontract waives, affects and impairs rights it would otherwise have in connection with such liens, stop notices and suits on said bonds.<br>&nbsp;&nbsp;&nbsp;&nbsp;(2)&nbsp;Subject to the foregoing requirements in this Paragraph 7, if the dispute arises out of or relates to this Subcontract and is solely between Contractor and Subcontractor, then the following dispute resolution procedure shall apply: (1) The dispute or controversy shall be submitted by one party to the other in writing; (2) the parties shall make a good faith attempt to settle such dispute; (3) if the dispute is not settled under (1) and (2), then the parties shall submit to non-binding mediation with the parties agreeing on a neutral mediator. Any disputes or controversies not resolved or settled by the parties under the previous provisions shall be submitted to binding arbitration in accordance with the Construction Industry Rules of the American Arbitration Association and any judgment upon the award by the arbitrators may be entered by any court having jurisdiction. The venue for any hearing under this arbitration provision shall be in Dallas County, Texas. Each party shall bear their own attorney and expert fees in connection with such a dispute and no other provisions of this Subcontract shall be construed otherwise.<br>&nbsp;&nbsp;&nbsp;&nbsp;(3)&nbsp;If the dispute between the Contractor and Subcontractor involves claims or potential disputes by, with or against other subcontractors of Contractor, then Subcontractor agrees to the consolidation of all such related claims or disputes into one consolidated arbitration proceeding with Contractor and the other subcontractors as further provided for above.<br>&nbsp;&nbsp;&nbsp;&nbsp;(4)&nbsp;During the pendency of any dispute under this Subcontract, whether it involves Owner or only Contractor, Subcontractor shall continue working and will proceed on any disputed items of work without waiving its claims.</div>
  <div class="provision"><span class="pnum">8.&nbsp;&nbsp;&nbsp;&nbsp;CLAIMS AGAINST SUBCONTRACTOR:</span> Subcontractor shall settle all claims of its suppliers and subcontractors for labor, materials, and/or damages resulting from the Subcontract Work or take such other action as directed by Contractor in order to hold Contractor and Owner harmless from expense and/or liability for same. In addition, If any lien or bond claim is filed or if a claim of any nature is asserted against the Owner or the Contractor on account of any obligation of the Subcontractor, the Subcontractor shall, within five (5) days thereafter, cause such lien or claim to be satisfied, discharged or bonded off at the Subcontractor's sole cost and expense. The Subcontractor's failure so to do shall constitute a default hereunder. If suit be brought to enforce any such claim, whether valid or not, Subcontractor shall, if requested by Contractor, defend any such suit at its own expense and in any event shall indemnify Contractor against any loss, damage or expenses including attorney's fees, incurred or suffered as a result thereof.</div>
  <div class="initial">Initial</div>
</div>

<!-- PAGE 6: GENERAL PROVISIONS 9-10 -->
<div class="page">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <div class="provision"><span class="pnum">9.&nbsp;&nbsp;&nbsp;&nbsp;INSURANCE AND BONDS:</span><br>&nbsp;&nbsp;&nbsp;&nbsp;(1)&nbsp;<span class="pnum">Commercial General and Umbrella Liability Insurance.</span> Subcontractor shall maintain commercial general liability (CGL) and, if necessary, commercial umbrella insurance with a limit of not less than $1,000,000 Bodily Injury and Property Damage Combined Single limit for each occurrence during the project and for a period of ten years after completion of the project. The CGL insurance shall contain a general aggregate limit which shall apply separately to this project using ISO endorsement CG2503 or a substitute providing equivalent coverage. CGL, insurance shall cover liability arising from premises, operations, independent contractors, products completed operations, personal injury and advertising injury, and contractual liability. During the period required in this paragraph to maintain a CGL policy, Contractor, Owner and any other party required under the General Contract shall be included as an additional insured under the CGL, using ISO Additional Insured Endorsement CG 2010 and CG2037 Owners, Lessees or Contractors-Completed Operations or substitutes providing equivalent coverage, and under the commercial umbrella, if any. This insurance shall apply as primary and non-contributory insurance with respect to any other insurance or self-insurance programs maintained by Contractor or Owner. Subcontractor and its insurer waive all rights against Contractor, Owner and their agents, officers, directors and employees for recovery of damages to the extent these damages are covered by the commercial general liability or commercial umbrella liability insurance maintained pursuant to this Article 9.<br>&nbsp;&nbsp;&nbsp;&nbsp;(2)&nbsp;<span class="pnum">Business Auto and Umbrella Liability Insurance.</span> Subcontractor shall maintain business auto liability and, if necessary, commercial umbrella liability insurance with a limit of not less than $1,000,000 Bodily Injury and Property Damage Combined Single limit for each accident. Such insurance shall cover liability arising out of any auto (including owned, hired, and non-owned autos). Contractor, Owner and any other party required under the General Contract shall be included as an insured under the Business Auto Policy using ISO Additional Insured Endorsement CG 2010 and CG2037 Owners, Lessees or Contractors-Completed Operations or substitutes providing equivalent coverage, and under the commercial umbrella, if any. Subcontractor and its insurer waive all rights against Contractor and Owner, and their agents, officers, directors and employees for recovery of damages to the extent these damages are covered by the business auto liability or commercial umbrella liability insurance obtained by Subcontractor pursuant to this Article 9.<br>&nbsp;&nbsp;&nbsp;&nbsp;(3)&nbsp;<span class="pnum">Workers Compensation Insurance.</span> Subcontractor shall maintain workers compensation and employer's liability insurance. The employer's liability limits shall not be less than $500,000 each accident for bodily injury by accident or $500,000 each employee for bodily injury by disease. Subcontractor and its insurer waive all rights against Contractor and Owner, and their agents, officers, directors and employees for recovery of damages to the extent these damages are covered by the workers compensation policy insurance obtained by Subcontractor pursuant to this Article 9.<br>&nbsp;&nbsp;&nbsp;&nbsp;(4)&nbsp;<span class="pnum">Evidence of Insurance.</span> Prior to commencing the work, Subcontractor shall furnish Contractor with a certificate(s) of insurance, executed by a duly authorized representative of each insurer, showing compliance with the insurance requirements set forth above. All certificates shall provide for 30 days written notice to Contractor prior to the cancellation or material change of any insurance referred to therein. Contractor shall have the right, but not the obligation, of prohibiting Subcontractor or any subcontractor from entering the project site until such certificates or other evidence that insurance has been placed in complete compliance with these requirements is received and approved by Contractor. Failure to maintain the required insurance may result in termination of this Subcontract at Contractor's option. If Subcontractor fails to maintain the insurance as set forth herein, Contractor shall have the right, but not the obligation, to purchase and charge Subcontractor for any costs incurred to purchase said insurance. Subcontractor shall provide certified copies of all insurance policies required above within 10 days of Contractor's written request for said copies.<br>&nbsp;&nbsp;&nbsp;&nbsp;(5)&nbsp;<span class="pnum">Subcontractors' Insurance.</span> Subcontractor shall cause each subcontractor employed by Subcontractor to purchase and maintain insurance of the type, limits and endorsements specified above. Subcontractor shall furnish copies of certificates of insurance evidencing coverage for each subcontractor.<br>&nbsp;&nbsp;&nbsp;&nbsp;(6)&nbsp;<span class="pnum">Builders' Risk Insurance.</span> To the extent that Builders' Risk insurance is carried by Contractor on the General Contract, Subcontractor may have an interest in the insurance policy; however, the provisions of this paragraph do not make it mandatory upon Contractor to carry any insurance whatsoever for the benefit of Subcontractor. Subcontractor agrees he will assume the responsibility to determine whether Builders' Risk insurance is in force. In the event Contractor should elect to carry Builders' Risk Insurance, and only in such event, Subcontractor agrees to submit immediately, for the purpose of determining values under the insurance coverage, a complete breakdown of this contract price showing materials, labor, expendable tools, supplies or any other thing or article of value, the cost of which is included in the subcontract price stated in this Subcontract, and further agrees to pay 90% of the premium applicable to such values reported by Subcontractor and if such payment is not made, authorizes Contractor to deduct such amounts from any payment due Subcontractor. Further, Subcontractor will be responsible for reimbursing Contractor for an amount equal to the percentage of this Subcontract value in relation to the total General Contract Amount to cover any deductible applicable to a Contractor-purchased Builder's Risk policy.<br>&nbsp;&nbsp;&nbsp;&nbsp;(7)&nbsp;Subcontractor is fully responsible for all loss or damage to materials delivered and stored on the job site until such materials are actually installed and/or incorporated into the job.<br>&nbsp;&nbsp;&nbsp;&nbsp;(8)&nbsp;<span class="pnum">Performance and Payment Bond.</span> Subcontractor shall provide performance and payment bonds, if required by Contractor, on a form acceptable to Contractor, prescribed by and with a surety acceptable to Contractor in the full amount of this Subcontract, for the faithful performance of this Subcontract. The premium for bonds shall be paid by Subcontractor and the cost shall be included in subcontract amount.</div>
  <div class="provision"><span class="pnum">10.&nbsp;&nbsp;&nbsp;&nbsp;</span>To the fullest extent permitted by the law, Subcontractor shall fully indemnify, defend and hold harmless Contractor, Owner, and anyone who Contractor has agreed to defend or indemnify, including their respective officers, directors, agents, subsidiaries, and employees (all such persons or entities hereinafter referred to as "Indemnitees") from and against all claims, demands, liabilities, causes of action, suits, judgments, or defense expenses (including attorney's fees) for or on account of or in any way arising out of Subcontractor's Work, fault, breaches, or negligence, for (i) the death or personal injury of any persons (including without limitation Subcontractor, its sub-subcontractors, and their respective agents, employees and invitees; (ii) damages to property of any person (including the loss or loss of use thereof) directly or indirectly connected with, attributable to, or arising from the work to be performed by Subcontractor under this subcontract; (iii) any loss or damage of whatever kind or nature directly or indirectly connected with, attributable to, or arising from the work to be performed under this Subcontract by Subcontractor, its sub-subcontractors, and their respective agents, employees, or invitees; (iv) the providing by Contractor of equipment, operators, and/or other personnel to Subcontractor, its sub-subcontractors, and their respective agents, employees and invitees; (v) in the case of Maryland contracts the costs or damage created by the nonpayment of wages, fringe or other benefit payments, or contributions by Subcontractor or by a subcontractor at any tier working under Subcontractor or otherwise failing to comply with Md. Code, Lab. &amp; Empl. Art. § 3-507.2(b); or (vi) in the case of California contracts the costs or damage created by the nonpayment of wages, fringe or other benefit payments, or contributions by Subcontractor or by a subcontractor at any tier working under Subcontractor or otherwise failing to comply with Cal. Labor Code 218.7; except that as provided for by California Civil Code section 2782.05, Subcontractor shall not be liable for claims of death or bodily injury to persons, injury to property, or any other loss, damage, or expense to the extent the claims arise out of, pertain to, or relate to the active negligence or willful misconduct of Contractor or such other indemnitee, or for defects in design furnished by Contractor or such other indemnitees, or to the extent the claims do not arise out of the scope of work of the Subcontractor. This indemnification provision does not negate, abridge or reduce any other rights or obligations of the persons and entities described herein with respect to indemnity. This indemnification agreement is binding on the Subcontractor, to the fullest extent permitted by law, regardless of the passive negligence, acts or omissions of any Indemnitees. <span class="ul">Further, notwithstanding the foregoing and in any and all claims against Indemnitees by any employee of Indemnitors, the indemnity obligation under this paragraph shall not be limited by any limitation on the amount or type of damages, compensation, or benefits payable by or for Subcontractor under any workers compensation act, disability benefit act, any other employee benefit act, or by any independent obligation of Subcontractor to provide a policy or policies of insurance as provided under the terms of this Subcontract. One percent (1%) of the total Subcontract price represents specific consideration for the obligations assumed by Subcontractor under the above indemnity provisions.</span> In the case of California contracts this indemnity agreement shall be interpreted so as to comply with and be enforceable under the California Civil Code including Sections 2778, 2782 and 2782.05, et seq., and any provisions that are found to be inconsistent with those sections shall be read to meet the requirements of such code sections. In the case of Maryland contracts this indemnity agreement shall be interpreted so as to comply with and be enforceable under Md. Code Ann., Cts. &amp; Jud. Proc. § 5-401, and any provisions that are found to be inconsistent with this section shall be read to meet the requirements of such code section. Indemnitees shall be entitled to receive their attorneys' fees and costs in enforcing their rights to defense and indemnification under this section.</div>
  <div class="initial">Initial</div>
</div>

<!-- PAGE 7: GENERAL PROVISIONS 11-15 -->
<div class="page">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <div class="provision"><span class="pnum">11.&nbsp;&nbsp;&nbsp;&nbsp;HAZARDOUS MATERIALS:</span> Subcontractor shall not transport to, use, generate, dispose of, or install at the Project site any Hazardous Substance, as defined in this Article, except in accordance with applicable Environmental Laws. Further, in performing the Subcontract Work, Subcontractor shall not cause any release of hazardous substance into, or contamination of, the environment, including the soil, the atmosphere, any water course of ground water, except in accordance with applicable Environmental Laws. In the event Subcontractor engages in any of the activities prohibited in this Article, to the fullest extent permitted by law, Subcontractor shall indemnify, defend and hold harmless Contractor, Owner and anyone Contractor has agreed to defend or indemnify, and all of their respective officers, agents and employees from and against any and all claims, damages, losses, causes of action, suits and liabilities of every kind, including, but not limited to, expenses of litigation, court costs, punitive damages and attorneys' fees, arising out of, incidental to or resulting from the activities prohibited in this Article.<br>&nbsp;&nbsp;&nbsp;&nbsp;(1)&nbsp;In the event Subcontractor encounters on the Project site any Hazardous Substance, or what Subcontractor reasonably believes to be a Hazardous Substance, and which is being introduced to the work, or exists on the Project, in a manner violative of any applicable Environmental Laws, Subcontractor shall immediately stop work in the area affected and report the condition to Contractor in writing. The Subcontract Work in the affected area shall not thereafter be resumed except by written authorization of Contractor if in fact a Hazardous Substance has been encountered and has not been rendered harmless. In the event Subcontractor fails to stop the Subcontract Work upon encountering a Hazardous Substance at the Project site, to the fullest extent permitted by law, Subcontractor shall indemnify, defend and hold harmless Contractor, Owner and Architect, and all of their officers, agents and employees from and against all claims, damages, losses, causes of action, suits and liabilities of every kind, including, but not limited to, expenses of litigation, court costs, punitive damages and attorneys' fees, arising out of, incidental to, or resulting from Subcontractor's failure to stop the Subcontract Work.<br>&nbsp;&nbsp;&nbsp;&nbsp;(2)&nbsp;An extension of time shall be Subcontractor's sole remedy for any delay arising out of the encountering and/or rendering harmless of any Hazardous Substance at the Project site. Contractor and Subcontractor may enter into an agreement for Subcontractor to remediate and/or render harmless the Hazardous Substance, but Subcontractor shall not be required to remediate and/or render harmless the Hazardous Substance absent such agreement. Subcontractor shall not be required to resume any work in any area affected by the Hazardous Substance until such time as the Hazardous Substance has been remediated or rendered harmless.<br>&nbsp;&nbsp;&nbsp;&nbsp;(3)&nbsp;For purpose of this Subcontract, the term "Hazardous Substance" shall mean and include, but shall not be limited to, any element, constituent, chemical, substance, compound, or mixture, which are defined in or included under or regulated by any local, state or federal law, rule ordinance, by-law or regulation pertaining to environmental regulation, contamination, clean-up or disclosure.</div>
  <div class="provision"><span class="pnum">12.&nbsp;&nbsp;&nbsp;&nbsp;GUARANTY:</span> Subcontractor warrants and guaranties that all of Subcontractor's Work and material will be furnished in a good and workmanlike manner. Subcontractor shall, before requesting final payment, provide any and all guarantees required by the General Contract. In addition to any specified guaranty required by the General Contract, Subcontractor, in signing this Subcontract, agrees at his own expense to replace or repair any faulty or defective material or workmanship within one year from the day of notice of completion of the project, or Owner's beneficial occupancy, whichever occurs first. In addition, Subcontractor shall be responsible and pay for replacement or repair of adjacent materials or work which may be damaged due to the failure of Subcontractor's material or work and/or damaged as a result of the replacement or repairs thereof.</div>
  <div class="provision"><span class="pnum">13.&nbsp;&nbsp;&nbsp;&nbsp;DIRECTION OF SUBCONTRACT WORK:</span> It is understood that Subcontractor is an independent contractor and Contractor shall have no right to direct the operations or employees of Subcontractor. Subcontractor agrees to maintain a familiarity with conditions existing over the entire project on which the work is located so that it will be aware of dangerous conditions, whether obvious or hidden, and Subcontractor agrees to warn its employees, subcontractors and suppliers of unsafe conditions on the project premises.</div>
  <div class="provision"><span class="pnum">14.&nbsp;&nbsp;&nbsp;&nbsp;FUTURE RIGHTS:</span> Any waiver or failure to assert any right, which either party has under this Subcontract, shall not constitute a continuing waiver of future rights. Rights can be waived only if expressed in writing signed by the waiving party. If any provision of this Subcontract is held invalid or unenforceable under any present or future laws, then the remainder of the subcontract shall remain in effect.</div>
  <div class="provision"><span class="pnum">15.&nbsp;&nbsp;&nbsp;&nbsp;FAILURE TO PERFORM:</span> Should Subcontractor at any time (a) fail to supply and pay a sufficient number of skilled workmen or supply a sufficient quantity of materials of proper quality; (b) fail in any respect to prosecute the work covered by this Subcontract with promptness and diligence; (c) fail to perform work of the quality required by the General Contract; (d) fail in the performance of any of the agreements herein contained; (e) in the case of California contracts, fail to provide Contractor with the payroll records and award information on behalf of itself and all lower tier subcontractors on a monthly basis pursuant to Cal. Labor Code section 218.7(f); (f) fail to make payments properly to his sub-subcontractors or for labor (including all wages, fringe or other benefit payments or contributions), materials or equipment, transportation for shipping costs, taxes, fees or any other claims arising out of the Subcontract Work; (g) have any workmen performing work covered by this Subcontract engage in a strike or other stoppage or cease to work due to picketing or other such activity; (h) file for bankruptcy or be adjudged a bankrupt, or make an assignment for the benefit of its creditors; or (i) breach this Subcontract, Contractor may, in any of such events at its option, after twenty-four (24) hours written notice to Subcontractor, provide any such labor and materials and deduct the cost thereof from any money then due or thereafter to become due Subcontractor, or, in any of such events, Contractor, may, at its option, terminate the employment of Subcontractor for the work under this Subcontract and shall have the right to enter upon the project premises and take possession, for the purpose of completing the work hereunder, of all the materials, tools, and equipment thereon, and to finish the work and provide the materials, therefor, either with its own employees or other subcontractors; and in case of such discontinuance of the employment by Contractor, Subcontractor shall not be entitled to receive any further payments under this Subcontract or otherwise, but shall nevertheless remain liable for any damages which Contractor incurs. Contractor shall be entitled to a 15% mark up for overhead on any expenses or damages incurred by Contractor as a result of Subcontractor's default. If the expenses incurred by Contractor in completing the work shall exceed the unpaid balance, Subcontractor shall pay the difference to Contractor, along with any other damages incurred by Contractor as a result of Subcontractor's default. Contractor shall have a lien upon all materials, tools, and appliances of which possession is taken in order to secure the payment thereof. Subcontractor shall be liable to Contractor for all costs and damages incurred by Contractor due to the failure of performance by Subcontractor, the failure of Subcontractor to keep the progress of work up to that of Contractor or other trades, or the failure to execute its work as directed by Contractor. Subcontractor agrees to execute any assignments necessary to make available to Contractor and Owner the rights of Subcontractor under purchase orders and subcontracts. Contractor will credit Subcontractor's account with the value of the materials and supplies so used but there will be no credit for rent on equipment. Subcontractor shall reimburse Contractor in Dallas County, Texas, to the extent that Contractor's expense, including attorneys' fees, in completing the Subcontract Work and proceeding under this Article to recover damages, exceeds the balance which would have become due to Subcontractor under this Subcontract had Subcontractor completed the Subcontract Work; if Contractor's expense is less than such amount, then Contractor will pay the difference to Subcontractor. Subcontractor hereby waives all claims against Contractor for profits, rent or equipment or other damages related to any proceeding, which Contractor institutes under this Article. The parties agree that the terms of this Article shall be binding if Contractor in good faith has made a reasonable determination that Subcontractor's performance is inadequate and that Owner or Contractor or other subcontractors may be able to perform its contractual obligations. The parties agree that such determinations are difficult to make and must be made under pressing circumstances, and agree to be bound in accordance with this Article in light of the circumstances confronting Contractor at the time such a decision is made.</div>
  <div class="initial">Initial</div>
</div>

<!-- PAGE 8: GENERAL PROVISIONS 16-26 -->
<div class="page">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <div class="provision"><span class="pnum">16.&nbsp;&nbsp;&nbsp;&nbsp;TERMINATION FOR CONVENIENCE:</span> Contractor shall have the right to terminate this Subcontract for convenience irrespective of the existence of any fault of either party. If Contractor terminates the Subcontract for convenience, then Subcontractor shall only recover actual costs for work furnished at the time of the termination for convenience. If Contractor's termination for cause is found to be improper, then the termination for cause shall be treated as a termination for convenience.</div>
  <div class="provision"><span class="pnum">17.&nbsp;&nbsp;&nbsp;&nbsp;CONNECTION TO OTHER WORK:</span> If Subcontractor deems that surfaces of work to which his work is to be applied or affixed is unsatisfactory or unsuitable, written notification of said condition shall be given to Contractor before proceeding or taking remedial action, otherwise Subcontractor shall be fully and solely responsible and liable for any and all expense, loss, or damages resulting from said condition and Contractor shall be relieved of all liability in connection therewith.</div>
  <div class="provision"><span class="pnum">18.&nbsp;&nbsp;&nbsp;&nbsp;STORAGE:</span> Subcontractor shall provide at its own expense, whatever storage, sheds, workshops and offices are necessary for the performance of this Subcontract and shall remove same and thoroughly clean the premises at the completion of his work.</div>
  <div class="provision"><span class="pnum">19.&nbsp;&nbsp;&nbsp;&nbsp;CLEANUP:</span> Subcontractor shall clean up and remove from the site as directed by Contractor all rubbish and debris resulting from his work. Also, he shall clean up to the satisfaction of the inspectors all dirt, grease, marks, etc., from walls, ceilings, floors, fixtures, etc., deposited or placed thereon as a result of the execution of this Subcontract. If Subcontractor refuses or fails to perform this cleaning as directed by Contractor, Contractor shall have the right and power to proceed with said cleaning, and Subcontractor will on demand repay to Contractor the actual cost of said labor, plus a reasonable percentage of such costs to cover supervision, insurance, overhead, etc.</div>
  <div class="provision"><span class="pnum">20.&nbsp;&nbsp;&nbsp;&nbsp;SHOP DRAWINGS AND SAMPLES:</span> Subcontractor shall furnish promptly all samples, lists, drawings, cuts, schedules, etc. required in connection with his work, but, approval of same, does not relieve him of his responsibility of complying with the requirements of the drawings and specifications. All transportation costs on samples and drawings furnished by Subcontractor shall be paid by him.</div>
  <div class="provision"><span class="pnum">21.&nbsp;&nbsp;&nbsp;&nbsp;HOISTING:</span> If Subcontractor makes use of Contractor's hoisting facilities, he shall pay for this service unless otherwise provided.</div>
  <div class="provision"><span class="pnum">22.&nbsp;&nbsp;&nbsp;&nbsp;PATENT INDEMNIFICATION:</span> Subcontractor shall defend, indemnify and hold Contractor harmless from any liability including cost and expenses and reasonable attorney's fees, for or on account of any patented or unpatented invention, article or appliance manufactured or used in the performance of this Subcontract including their use by Owner.</div>
  <div class="provision"><span class="pnum">23.&nbsp;&nbsp;&nbsp;&nbsp;NO OVERTIME:</span> No overtime will be paid by Contractor to Subcontractor unless so specifically agreed to in writing by Contractor in advance of incurring the overtime.</div>
  <div class="provision"><span class="pnum">24.&nbsp;&nbsp;&nbsp;&nbsp;LIMIT OF AUTHORITY OF CONTRACTOR'S ON-SITE SUPERINTENDENT:</span> The authority of the Contractor's on-site representative (Superintendent) to make changes to the Subcontractor's work under Paragraph 5 of this Agreement shall be limited to an amount not in excess of $0 on any individual change and shall not exceed $0 in the total aggregate of changes to this Agreement. Any changes, whether individual change orders or in the total aggregate, that are in excess of the foregoing limits must be specifically authorized in writing by the Contractor's Project Manager.</div>
  <div class="provision"><span class="pnum">25.&nbsp;&nbsp;&nbsp;&nbsp;ASSIGNMENT:</span> Subcontractor shall not assign responsibility for performance of this Subcontract or any rights, obligations, or duties of it without first obtaining the written consent of Contractor. Subcontractor may not assign or attempt to assign any funds accrued or to be accrued under this Subcontract without first obtaining the written consent of Contractor and no such assignment shall be binding on Contractor unless and until accepted in writing by Contractor. Subcontractor shall not place on the project or incorporate into the Subcontract Work any equipment of which it is not sole owner unless it obtains written permission in advance from Contractor.</div>
  <div class="provision"><span class="pnum">26.&nbsp;&nbsp;&nbsp;&nbsp;MISCELLANEOUS:</span> Waiver of any breach hereof shall not constitute a waiver of any subsequent breach of the same or any other provision hereof. The Subcontract Amount and the other provisions and terms of this Subcontract have been negotiated and agreed to by experienced, knowledgeable and consenting persons. Accordingly, in the event of any dispute over its meaning or application, this Subcontract form shall not be construed for, or against, either Subcontractor or Contractor and shall be interpreted neither more strongly for nor against either party if ambiguity exists. The headings and captions of the Articles and paragraphs of this Subcontract are not substantive or limiting and are for convenience only and are not to be considered in construing this Subcontract. This Subcontract contains the entire agreement between the parties, and all prior proposals, negotiations and agreements prior to the Subcontract Date are not included in this Subcontract and are hereby voided. This Subcontract does not create, nor does any course of conduct between the Contractor and Subcontractor, create, any contractual relationship or benefit to any third-party claimant not a party to it. The terms and conditions of this Subcontract are intended by the Parties to be in compliance with all Federal and State laws in all respects, and if any portion or provision of this Subcontract is determined judicially to be invalid or unenforceable, the Parties agree that such portion or provision shall be judicially rewritten so as to make such portion or provision valid and enforceable to the fullest extent permissible at law as if originally written in compliance thereof. In the event of partial invalidity, all other provisions are to be enforced as written and such partial invalidity shall only affect the invalid provision(s), which shall be judicially rewritten as provided herein so as to effectuate the intent of the Parties.</div>
  <div class="initial">Initial</div>
</div>

<!-- PAGE 9: COMPETENT PERSON STATEMENT -->
<div class="page">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <p><strong>GENERAL PROVISIONS</strong></p><br>
  <div style="text-align:center;margin-bottom:14px">
    <div style="font-style:italic;font-weight:bold;font-size:16pt;text-decoration:underline">NV Construction</div>
    <div style="font-weight:bold;font-size:13pt;text-decoration:underline;margin-top:8px">SUBCONTRACTORS COMPETENT PERSON STATEMENT</div>
  </div>
  <p>Every employer is required by law to have a competent person on the job with his employees. This person must have the necessary training or experience to comply with OSHA safety standards. The competent person could take on personal liability for any accidents that happen. The subcontractor represents the Competent Person has had sufficient training to comply with regulations. The ownership of the company he/she works for assigns the competent person. This form must be completed before they begin work on our jobsite.</p><br>
  <p style="font-style:italic;font-weight:bold;font-size:13pt;text-decoration:underline">OWNER STATEMENT:</p><br>
  <p>I <span class="sig-line" style="width:150px">&nbsp;</span>&nbsp; hereby state that I am <span class="sig-line" style="width:120px">&nbsp;</span>&nbsp; of the<br><small>&nbsp;&nbsp;&nbsp;PRINT NAME&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;TITLE</small></p>
  <p><span class="sig-line" style="width:200px">&nbsp;</span>&nbsp; and that I have the authority to assign<br><small>COMPANY NAME</small></p>
  <p><span class="sig-line" style="width:200px">&nbsp;</span>&nbsp; as the competent person on this job for our company.<br><small>COMPETENT PERSON</small></p>
  <p>He has the training and experience needed to comply with OSHA safety standards for our company. He also has the authority to stop any unsafe or hazardous activities of our employees.</p><br>
  <div style="display:flex;gap:60px;margin-bottom:6px"><div style="flex:1"><div style="border-bottom:1px solid #000;height:22px"></div><small>SIGNATURE</small></div><div style="flex:1"><div style="border-bottom:1px solid #000;height:22px"></div><small>DATE</small></div></div><br>
  <p>Please mark the appropriate items. Our competent person is authorized such for the following:</p>
  <p>GENERAL CONSTRUCTION ________ &nbsp;&nbsp; SCAFFOLDING ________ &nbsp;&nbsp; TRENCHING ________<br>FALL PROTECTION ________ &nbsp;&nbsp; ELECTRICAL ________</p><br>
  <p style="font-style:italic;font-weight:bold;font-size:13pt;text-decoration:underline">COMPETENT PERSON STATEMENT</p><br>
  <p>I <span class="sig-line" style="width:150px">&nbsp;</span>&nbsp; hereby acknowledge that I have been authorized as competent person for my company<br><small>PRINT NAME</small></p>
  <p>for this job site. I have by training or experience the knowledge needed to identify existing and predictable hazards at the job site and to adhere to OSHA regulations. I also have the authority to take prompt corrective action to ensure the safety of our employees.</p><br>
  <div style="display:flex;gap:60px;margin-bottom:6px"><div style="flex:1"><div style="border-bottom:1px solid #000;height:22px"></div><small>SIGNATURE</small></div><div style="flex:1"><div style="border-bottom:1px solid #000;height:22px"></div><small>DATE</small></div></div><br>
  <p>Please mark the appropriate items. I am the competent person authorized for the following:</p>
  <p>GENERAL CONSTRUCTION ________ &nbsp;&nbsp; SCAFFOLDING ________ &nbsp;&nbsp; TRENCHING ________</p><br>
  <p><em><span class="ul"><strong>You must complete, sign and return this form to NV Construction with your signed subcontract prior to beginning work.</strong></span></em></p>
  <p><strong>Sub-contractor is responsible for submitting site-specific program and written safety program to the NV Construction Superintendent prior to beginning work.</strong></p><br>
  <p>For NV Construction's use. &nbsp; - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</p><br>
  <p><strong><em>NV Construction Job Superintendent:</em></strong> ${f.superintendent}</p><br>
  <p><strong><em>JOB NUMBER:</em></strong> ${f.job_number} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong><em>JOB NAME:</em></strong> ${f.project_name}</p><br>
  <p><strong>KEEP COMPLETED FORM IN JOB FOLDER</strong></p>
  <div class="initial">Initial</div>
</div>

</body></html>`
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 800)
  }

  // ── Change Orders ───────────────────────────────────────────
  async function addCO() {
    const sovTotal = coForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
    const finalAmount = coForm.sov.length > 0 ? sovTotal : parseFloat(coForm.amount)
    if (!coForm.subcontract_id || !finalAmount || !coForm.description) return
    setAddingCO(true)
    const { data: { session } } = await supabase.auth.getSession()
    const validSOV = coForm.sov.filter(r => r.description || r.budget_item_id || r.amount)
    await supabase.from('change_orders').insert({
      subcontract_id: coForm.subcontract_id,
      initiated_by: session.user.id,
      direction: coForm.direction,
      amount: finalAmount,
      description: coForm.description,
      status: 'pending',
      sov: validSOV.length > 0 ? validSOV : null,
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
    if (status === 'approved') {
      const co = allCOs.find(c => c.id === coId)
      for (const sovItem of co?.sov || []) {
        if (!sovItem.budget_item_id || !sovItem.amount) continue
        const { data: item } = await supabase.from('budget_items').select('budget_amount').eq('id', sovItem.budget_item_id).single()
        if (item) await supabase.from('budget_items').update({ budget_amount: Number(item.budget_amount) + Number(sovItem.amount) }).eq('id', sovItem.budget_item_id)
      }
      await loadBudgetItems()
    }
    await loadAllCOs()
    await loadContracts()
  }

  // ── Prime Contract Change Orders ────────────────────────────
  async function loadPrimeCOs() {
    const { data } = await supabase.from('prime_change_orders').select('*, budget_items(description, cost_code)').eq('job_id', id).order('created_at', { ascending: false })
    setPrimeCOs(data || [])
  }

  async function addPrimeCO() {
    const sovTotal = primeCOForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
    const finalAmount = primeCOForm.sov.length > 0 ? sovTotal : parseFloat(primeCOForm.amount)
    if (!finalAmount || !primeCOForm.description) return
    setAddingPrimeCO(true)
    const { data: { session } } = await supabase.auth.getSession()
    const validSOV = primeCOForm.sov.filter(r => r.description || r.budget_item_id || r.amount)
    const { error } = await supabase.from('prime_change_orders').insert({
      job_id: id,
      description: primeCOForm.description,
      amount: finalAmount,
      notes: primeCOForm.notes || null,
      status: 'pending',
      created_by: session.user.id,
      sov: validSOV.length > 0 ? validSOV : null,
    })
    if (error) { setErrMsg(error.message); setTimeout(() => setErrMsg(''), 4000) }
    else { setShowAddPrimeCO(false); setPrimeCOForm(emptyPrimeCO); await loadPrimeCOs() }
    setAddingPrimeCO(false)
  }

  async function reviewPrimeCO(coId, status, coAmount) {
    const { error } = await supabase.from('prime_change_orders').update({ status }).eq('id', coId)
    if (error) { alert('Error updating prime CO: ' + error.message); return }
    if (status === 'approved') {
      if (coAmount != null) {
        const newVal = (Number(job.contract_value) || 0) + Number(coAmount)
        await supabase.from('jobs').update({ contract_value: newVal }).eq('id', id)
        setJob(j => ({ ...j, contract_value: newVal }))
        setForm(f => ({ ...f, contract_value: newVal }))
      }
      const co = primeCOs.find(c => c.id === coId)
      for (const sovItem of co?.sov || []) {
        if (!sovItem.budget_item_id || !sovItem.amount) continue
        const { data: item } = await supabase.from('budget_items').select('budget_amount').eq('id', sovItem.budget_item_id).single()
        if (item) await supabase.from('budget_items').update({ budget_amount: Number(item.budget_amount) + Number(sovItem.amount) }).eq('id', sovItem.budget_item_id)
      }
      await loadBudgetItems()
    }
    await loadPrimeCOs()
  }

  async function deletePrimeCO(coId) {
    if (!window.confirm('Delete this prime contract change order?')) return
    await supabase.from('prime_change_orders').delete().eq('id', coId)
    await loadPrimeCOs()
  }

  async function pushSubCOToPrime(co, subName) {
    setPushingToPrime(true)
    const markupPct = parseFloat(pushMarkup) || 0
    const markedUpAmt = Math.round(Number(co.amount) * (1 + markupPct / 100) * 100) / 100
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('prime_change_orders').insert({
      job_id: id,
      description: `${subName} — ${co.description}`,
      amount: markedUpAmt,
      notes: markupPct > 0 ? `Sub amount: $${Number(co.amount).toLocaleString()} + ${markupPct}% markup` : `From sub CO: ${subName}`,
      status: 'pending',
      created_by: session.user.id,
    })
    if (error) { alert('Error: ' + error.message) }
    else { setPushCOId(null); setPushMarkup(''); await loadPrimeCOs() }
    setPushingToPrime(false)
  }

  function printPrimeCO(co, coNum) {
    const w = window.open('', '_blank')
    const date = co.created_at ? new Date(co.created_at).toLocaleDateString() : new Date().toLocaleDateString()
    const amount = Number(co.amount)
    w.document.write(`<!DOCTYPE html><html><head><title>PCO-${String(coNum).padStart(3,'0')} — Job #${job.job_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,Arial,sans-serif;color:#111;padding:60px;font-size:13px;line-height:1.5;max-width:800px;margin:0 auto}.print-btn{padding:8px 20px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin-bottom:32px}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:20px;border-bottom:2px solid #111}.co{font-size:22px;font-weight:800}.co-sub{font-size:12px;color:#888;margin-top:2px}.lbl{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:3px}.val{font-size:14px;font-weight:600}.num-lbl{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#888;font-weight:700}.num{font-size:28px;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}.amt-box{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center}.amt{font-size:28px;font-weight:800;color:${amount>=0?'#22863a':'#cc0000'}}.scope-box{border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px}.notes{background:#f8f8f8;border-radius:8px;padding:16px;margin-bottom:32px;font-size:13px;color:#555}.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}.sig-block{border-top:1.5px solid #111;padding-top:12px}.sig-lbl{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:8px}.sig-line{height:32px;border-bottom:1px solid #ccc;margin-bottom:6px}.sig-field{font-size:12px;color:#aaa}.footer{margin-top:48px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#aaa;text-align:center}@media print{.print-btn{display:none}}</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="hdr"><div><div class="co">NV Construction</div><div class="co-sub">Change Order — Prime Contract</div></div><div style="text-align:right"><div class="num-lbl">Change Order No.</div><div class="num">PCO-${String(coNum).padStart(3,'0')}</div></div></div>
<div class="grid"><div><div class="lbl">Project</div><div class="val">${job.project_name}</div></div><div><div class="lbl">Job Number</div><div class="val">#${job.job_number}</div></div><div><div class="lbl">Date</div><div class="val">${date}</div></div><div><div class="lbl">Location</div><div class="val">${job.location||'—'}</div></div>${job.owner_company||job.owner_name?`<div><div class="lbl">Owner</div><div class="val">${[job.owner_company,job.owner_name].filter(Boolean).join(' · ')}</div></div>`:''}</div>
<div class="amt-box"><div><div class="num-lbl">Change Order Amount</div><div style="font-size:12px;color:#888;margin-top:4px">Status: ${co.status}</div></div><div class="amt">${amount>=0?'+':''}$${Math.abs(amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
<div class="scope-box"><div class="lbl" style="margin-bottom:8px">Description of Change</div><div style="font-size:14px;line-height:1.7">${co.description}</div></div>
${co.notes?`<div class="notes"><strong style="font-size:11px;text-transform:uppercase;letter-spacing:1px">Notes:</strong><br>${co.notes}</div>`:''}
<div class="sig-grid"><div class="sig-block"><div class="sig-lbl">Owner / Authorized Representative</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Print Name &amp; Title</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div><div class="sig-block"><div class="sig-lbl">NV Construction</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Print Name &amp; Title</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div></div>
<div class="footer">NV Construction · Generated ${new Date().toLocaleDateString()} · Job #${job.job_number}</div>
</body></html>`)
    w.document.close()
  }

  function printSubCO(co, subName, scope, coNum) {
    const w = window.open('', '_blank')
    const date = co.created_at ? new Date(co.created_at).toLocaleDateString() : new Date().toLocaleDateString()
    const amount = Number(co.amount)
    const isPmToSub = co.direction === 'pm_to_sub'
    w.document.write(`<!DOCTYPE html><html><head><title>SCO-${String(coNum).padStart(3,'0')} — ${subName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,Arial,sans-serif;color:#111;padding:60px;font-size:13px;line-height:1.5;max-width:800px;margin:0 auto}.print-btn{padding:8px 20px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin-bottom:32px}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #111}.co{font-size:22px;font-weight:800}.co-sub{font-size:12px;color:#888;margin-top:2px}.lbl{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:3px}.val{font-size:14px;font-weight:600}.num-lbl{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#888;font-weight:700}.num{font-size:28px;font-weight:800}.badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:${isPmToSub?'#e8f4e8':'#fff3e0'};color:${isPmToSub?'#22863a':'#e65100'};margin-bottom:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}.amt-box{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center}.amt{font-size:28px;font-weight:800;color:${amount>=0?'#22863a':'#cc0000'}}.scope-box{border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px}.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}.sig-block{border-top:1.5px solid #111;padding-top:12px}.sig-lbl{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:8px}.sig-line{height:32px;border-bottom:1px solid #ccc;margin-bottom:6px}.sig-field{font-size:12px;color:#aaa}.footer{margin-top:48px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#aaa;text-align:center}@media print{.print-btn{display:none}}</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="hdr"><div><div class="co">NV Construction</div><div class="co-sub">Change Order — Subcontract</div></div><div style="text-align:right"><div class="num-lbl">Change Order No.</div><div class="num">SCO-${String(coNum).padStart(3,'0')}</div></div></div>
<div class="badge">${isPmToSub?'NV Construction → Subcontractor':'Subcontractor Request'}</div>
<div class="grid"><div><div class="lbl">Project</div><div class="val">${job.project_name}</div></div><div><div class="lbl">Job Number</div><div class="val">#${job.job_number}</div></div><div><div class="lbl">Subcontractor</div><div class="val">${subName}</div></div>${scope?`<div><div class="lbl">Contract Scope</div><div class="val">${scope}</div></div>`:''}<div><div class="lbl">Date</div><div class="val">${date}</div></div><div><div class="lbl">Location</div><div class="val">${job.location||'—'}</div></div></div>
<div class="amt-box"><div><div class="num-lbl">Change Order Amount</div><div style="font-size:12px;color:#888;margin-top:4px">Status: ${co.status}</div></div><div class="amt">${amount>=0?'+':''}$${Math.abs(amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
<div class="scope-box"><div class="lbl" style="margin-bottom:8px">Description of Change</div><div style="font-size:14px;line-height:1.7">${co.description}</div></div>
<div class="sig-grid"><div class="sig-block"><div class="sig-lbl">Subcontractor — ${subName}</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Print Name &amp; Title</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div><div class="sig-block"><div class="sig-lbl">NV Construction</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Print Name &amp; Title</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div></div>
<div class="footer">NV Construction · Generated ${new Date().toLocaleDateString()} · Job #${job.job_number}</div>
</body></html>`)
    w.document.close()
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
      markup_pct: form.markup_pct ? parseFloat(form.markup_pct) : null,
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
          <button style={s.tab(activeTab === 'schedule')} onClick={() => setActiveTab('schedule')}>Schedule</button>
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
                  <div><label style={s.label}>Default markup %</label><input type="number" style={s.input} placeholder="0" value={form.markup_pct || ''} onChange={e => update('markup_pct', e.target.value)} /></div>
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

            {showContractGen && (
              <div style={{ ...s.card, border: '1px solid #1a3a1a', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <p style={{ ...s.cardTitle, margin: 0, color: '#4ade80' }}>Generate Subcontract</p>
                  <button style={s.btnGray} onClick={() => setShowContractGen(false)}>Close</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Date</label><input style={s.input} value={contractGenForm.date} onChange={e => setContractGenForm(f => ({ ...f, date: e.target.value }))} /></div>
                  <div><label style={s.label}>Subcontract #</label><input style={s.input} value={contractGenForm.subcontract_number} onChange={e => setContractGenForm(f => ({ ...f, subcontract_number: e.target.value }))} placeholder="26-JOBNO-001" /></div>
                  <div><label style={s.label}>PM Name</label><input style={s.input} value={contractGenForm.pm_name} onChange={e => setContractGenForm(f => ({ ...f, pm_name: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Subcontractor name</label>
                    <select style={s.input} value={contractGenForm.contract_id} onChange={e => { const c = contracts.find(x => x.id === e.target.value); if (c) openContractGenerator(c) }}>
                      <option value="">— Select —</option>
                      {contracts.map(c => { const n = c.vendor_name || registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown'; return <option key={c.id} value={c.id}>{n}{c.description ? ` — ${c.description}` : ''}</option> })}
                    </select>
                  </div>
                  <div><label style={s.label}>Sub address</label><input style={s.input} value={contractGenForm.sub_address} onChange={e => setContractGenForm(f => ({ ...f, sub_address: e.target.value }))} placeholder="123 Main St, City, TX 75000" /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Trade / work type</label><input style={s.input} value={contractGenForm.trade} onChange={e => setContractGenForm(f => ({ ...f, trade: e.target.value }))} placeholder="Plumbing" /></div>
                  <div><label style={s.label}>Contract amount ($)</label><input type="number" style={s.input} value={contractGenForm.contract_amount} onChange={e => setContractGenForm(f => ({ ...f, contract_amount: e.target.value }))} /></div>
                  <div><label style={s.label}>Pay % (para 4)</label><input type="number" style={s.input} value={contractGenForm.pay_pct} onChange={e => setContractGenForm(f => ({ ...f, pay_pct: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Project name</label><input style={s.input} value={contractGenForm.project_name} onChange={e => setContractGenForm(f => ({ ...f, project_name: e.target.value }))} /></div>
                  <div><label style={s.label}>Project address</label><input style={s.input} value={contractGenForm.project_address} onChange={e => setContractGenForm(f => ({ ...f, project_address: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Owner name</label><input style={s.input} value={contractGenForm.owner_name} onChange={e => setContractGenForm(f => ({ ...f, owner_name: e.target.value }))} placeholder="Braum's Ice Cream and Dairy" /></div>
                  <div><label style={s.label}>Owner address</label><input style={s.input} value={contractGenForm.owner_address} onChange={e => setContractGenForm(f => ({ ...f, owner_address: e.target.value }))} placeholder="1420 West Loop 281, Longview TX 75603" /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Job number</label><input style={s.input} value={contractGenForm.job_number} onChange={e => setContractGenForm(f => ({ ...f, job_number: e.target.value }))} /></div>
                  <div><label style={s.label}>Superintendent</label><input style={s.input} value={contractGenForm.superintendent} onChange={e => setContractGenForm(f => ({ ...f, superintendent: e.target.value }))} /></div>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={s.label}>Scope of work</label>
                  <textarea style={{ ...s.input, minHeight: '140px', resize: 'vertical', fontFamily: 'inherit' }} value={contractGenForm.scope_of_work} onChange={e => setContractGenForm(f => ({ ...f, scope_of_work: e.target.value }))} placeholder="Provide all labor, equipment, and material to complete the [trade] scope per plans and specs to include but not limited to: ..." />
                </div>
                <button style={{ ...s.btn, background: '#1a3a1a', color: '#4ade80' }} onClick={generateSubcontract}>Print / Generate PDF</button>
              </div>
            )}

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
                          <button style={{ ...s.btnSmall, background: '#1a3a1a', color: '#4ade80', border: '1px solid #1a3a1a' }} onClick={() => openContractGenerator(c)}>Gen Contract</button>
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

              {showAddPrimeCO && (() => {
                const primeSovTotal = primeCOForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                const primeHasSOV = primeCOForm.sov.length > 0
                return (
                <div style={s.inlineForm}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>New prime contract change order</p>
                  <div style={{ ...s.grid2, marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Description</label>
                      <input style={s.input} placeholder="Scope change, owner directive..." value={primeCOForm.description} onChange={e => setPrimeCOForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Notes (optional)</label>
                      <input style={s.input} placeholder="Additional notes..." value={primeCOForm.notes} onChange={e => setPrimeCOForm(f => ({ ...f, notes: e.target.value }))} />
                    </div>
                  </div>
                  {!primeHasSOV && (
                    <div style={{ marginBottom: '12px', maxWidth: '220px' }}>
                      <label style={s.label}>Amount ($)</label>
                      <input type="number" style={s.input} placeholder="0.00" value={primeCOForm.amount} onChange={e => setPrimeCOForm(f => ({ ...f, amount: e.target.value }))} />
                    </div>
                  )}
                  {/* SOV Section */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' }}>Schedule of Values</p>
                      <button type="button" style={s.btnSmall} onClick={() => setPrimeCOForm(f => ({ ...f, sov: [...f.sov, { ...emptySOVRow }] }))}>+ Add Line</button>
                    </div>
                    {primeCOForm.sov.length === 0 && <p style={{ fontSize: '12px', color: '#444', marginBottom: '8px' }}>No SOV lines — CO will use the amount above. Add lines to break down cost by budget item.</p>}
                    {primeCOForm.sov.map((row, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 32px', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                        <input style={s.input} placeholder="Description" value={row.description} onChange={e => setPrimeCOForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, description: e.target.value } : r) }))} />
                        <select style={s.input} value={row.budget_item_id} onChange={e => setPrimeCOForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, budget_item_id: e.target.value } : r) }))}>
                          <option value="">— Budget line —</option>
                          {budgetItems.map(bi => <option key={bi.id} value={bi.id}>{bi.cost_code ? `${bi.cost_code} · ` : ''}{bi.description}</option>)}
                        </select>
                        <input type="number" style={s.input} placeholder="$0.00" value={row.amount} onChange={e => setPrimeCOForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, amount: e.target.value } : r) }))} />
                        <button type="button" style={{ background: 'none', border: 'none', color: '#e8590c', cursor: 'pointer', fontSize: '16px', padding: '0' }} onClick={() => setPrimeCOForm(f => ({ ...f, sov: f.sov.filter((_, j) => j !== i) }))}>×</button>
                      </div>
                    ))}
                    {primeHasSOV && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center', paddingTop: '6px', borderTop: '1px solid #1a1a1a' }}>
                        <span style={{ fontSize: '12px', color: '#555' }}>SOV Total:</span>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>${primeSovTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: addingPrimeCO ? 0.6 : 1 }} disabled={addingPrimeCO} onClick={addPrimeCO}>{addingPrimeCO ? 'Saving...' : 'Save Prime CO'}</button>
                    <button style={s.btnGray} onClick={() => { setShowAddPrimeCO(false); setPrimeCOForm(emptyPrimeCO) }}>Cancel</button>
                  </div>
                </div>
                )
              })()}

              {primeCOs.length === 0 && !showAddPrimeCO && <p style={{ color: '#444', fontSize: '14px' }}>No prime contract change orders yet.</p>}

              {primeCOs.map(co => {
                const isExpanded = expandedPrimeCOId === co.id
                const hasSov = co.sov?.length > 0
                return (
                <div key={co.id} style={{ ...s.coRow, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#f1f1f1' }}>{co.description}</span>
                        {hasSov && <span style={{ fontSize: '10px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }} onClick={() => setExpandedPrimeCOId(isExpanded ? null : co.id)}>{co.sov.length} SOV lines {isExpanded ? '▲' : '▼'}</span>}
                        <span style={{ fontSize: '11px', color: '#444' }}>{new Date(co.created_at).toLocaleDateString()}</span>
                      </div>
                      {co.notes && <span style={{ fontSize: '13px', color: '#aaa' }}>{co.notes}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                      <span style={{ fontSize: '15px', fontWeight: '700', color: Number(co.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>
                        {Number(co.amount) >= 0 ? '+' : ''}${Number(co.amount).toLocaleString()}
                      </span>
                      <span style={s.coBadge(co.status)}>{co.status}</span>
                      {co.status === 'pending' && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmallGreen} onClick={() => reviewPrimeCO(co.id, 'approved', co.amount)}>Approve</button>
                          <button style={s.btnSmallRed} onClick={() => reviewPrimeCO(co.id, 'rejected', co.amount)}>Reject</button>
                        </div>
                      )}
                      <button style={{ ...s.btnSmall, fontSize: '11px', padding: '3px 10px' }} onClick={() => { const idx = [...primeCOs].reverse().findIndex(c => c.id === co.id); printPrimeCO(co, idx + 1) }}>Print CO</button>
                      <button style={{ ...s.btnSmallRed, fontSize: '11px', padding: '2px 8px' }} onClick={() => deletePrimeCO(co.id)}>Delete</button>
                    </div>
                  </div>
                  {isExpanded && hasSov && (
                    <div style={{ marginTop: '10px', padding: '12px', background: '#0a0a0a', borderRadius: '6px', border: '1px solid #1a1a1a' }}>
                      <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>Schedule of Values</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '10px', color: '#444', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                        <span>Description</span><span>Budget Line</span><span style={{ textAlign: 'right' }}>Amount</span>
                      </div>
                      {co.sov.map((item, i) => {
                        const bi = budgetItems.find(b => b.id === item.budget_item_id)
                        return (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '5px 0', borderTop: '1px solid #1a1a1a' }}>
                            <span>{item.description || '—'}</span>
                            <span style={{ color: bi ? '#888' : '#555' }}>{bi ? `${bi.cost_code ? bi.cost_code + ' · ' : ''}${bi.description}` : '—'}</span>
                            <span style={{ textAlign: 'right', fontWeight: '600', color: Number(item.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>{Number(item.amount) >= 0 ? '+' : ''}${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )
                      })}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid #2a2a2a', marginTop: '4px' }}>
                        <span style={{ fontSize: '12px', color: '#555' }}>Total:</span>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: '#f1f1f1' }}>${co.sov.reduce((a, r) => a + Number(r.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  )}
                </div>
                )
              })}
            </div>

            {/* Subcontract Change Orders */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Subcontract Change Orders ({allCOs.length})</p>
                {!showAddCO && <button style={s.btnSmallOrange} onClick={() => setShowAddCO(true)}>+ Add CO</button>}
              </div>

              {showAddCO && (() => {
                const subSovTotal = coForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                const subHasSOV = coForm.sov.length > 0
                return (
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
                  <div style={{ ...s.grid2, marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Direction</label>
                      <select style={s.input} value={coForm.direction} onChange={e => setCoForm(f => ({ ...f, direction: e.target.value }))}>
                        <option value="pm_to_sub">PM → Sub (add scope)</option>
                        <option value="sub_to_pm">Sub → PM (sub request)</option>
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Description</label>
                      <input style={s.input} placeholder="Additional scope, credit..." value={coForm.description} onChange={e => setCoForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                  </div>
                  {!subHasSOV && (
                    <div style={{ marginBottom: '12px', maxWidth: '220px' }}>
                      <label style={s.label}>Amount ($)</label>
                      <input type="number" style={s.input} placeholder="0.00" value={coForm.amount} onChange={e => setCoForm(f => ({ ...f, amount: e.target.value }))} />
                    </div>
                  )}
                  {/* SOV Section */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' }}>Schedule of Values</p>
                      <button type="button" style={s.btnSmall} onClick={() => { setCoForm(f => ({ ...f, sov: [...f.sov, { ...emptySOVRow }] })); if (!budgetItems.length) loadBudgetItems() }}>+ Add Line</button>
                    </div>
                    {coForm.sov.length === 0 && <p style={{ fontSize: '12px', color: '#444', marginBottom: '8px' }}>No SOV lines — CO will use the amount above. Add lines to break down cost by budget item.</p>}
                    {coForm.sov.map((row, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 32px', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                        <input style={s.input} placeholder="Description" value={row.description} onChange={e => setCoForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, description: e.target.value } : r) }))} />
                        <select style={s.input} value={row.budget_item_id} onChange={e => setCoForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, budget_item_id: e.target.value } : r) }))}>
                          <option value="">— Budget line —</option>
                          {budgetItems.map(bi => <option key={bi.id} value={bi.id}>{bi.cost_code ? `${bi.cost_code} · ` : ''}{bi.description}</option>)}
                        </select>
                        <input type="number" style={s.input} placeholder="$0.00" value={row.amount} onChange={e => setCoForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, amount: e.target.value } : r) }))} />
                        <button type="button" style={{ background: 'none', border: 'none', color: '#e8590c', cursor: 'pointer', fontSize: '16px', padding: '0' }} onClick={() => setCoForm(f => ({ ...f, sov: f.sov.filter((_, j) => j !== i) }))}>×</button>
                      </div>
                    ))}
                    {subHasSOV && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center', paddingTop: '6px', borderTop: '1px solid #1a1a1a' }}>
                        <span style={{ fontSize: '12px', color: '#555' }}>SOV Total:</span>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>${subSovTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: addingCO ? 0.6 : 1 }} disabled={addingCO} onClick={addCO}>{addingCO ? 'Saving...' : 'Save CO'}</button>
                    <button style={s.btnGray} onClick={() => { setShowAddCO(false); setCoForm(emptyCO) }}>Cancel</button>
                  </div>
                </div>
                )
              })()}

              {allCOs.length === 0 && !showAddCO && <p style={{ color: '#444', fontSize: '14px' }}>No change orders yet.</p>}

              {allCOs.map((co, coIdx) => {
                const subId = co.subcontracts?.sub_id
                const matchedContract = contracts.find(c => c.id === co.subcontract_id)
                const subName = matchedContract?.vendor_name || registeredSubs.find(s => s.sub_id === subId)?.profiles?.company_name || 'Unknown sub'
                const scope = co.subcontracts?.description
                const isPushing = pushCOId === co.id
                const markedUpPreview = pushMarkup !== '' ? Math.round(Number(co.amount) * (1 + parseFloat(pushMarkup || 0) / 100) * 100) / 100 : null
                const hasSov = co.sov?.length > 0
                const isSOVExpanded = expandedSubCOId === co.id
                return (
                  <div key={co.id} style={{ ...s.coRow, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: isPushing ? '10px' : 0 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: '#f1f1f1' }}>{subName}</span>
                          {scope && <span style={{ fontSize: '11px', color: '#555' }}>{scope}</span>}
                          <span style={{ fontSize: '11px', color: '#555' }}>{co.direction === 'pm_to_sub' ? 'PM → Sub' : 'Sub → PM'}</span>
                          {hasSov && <span style={{ fontSize: '10px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }} onClick={() => setExpandedSubCOId(isSOVExpanded ? null : co.id)}>{co.sov.length} SOV lines {isSOVExpanded ? '▲' : '▼'}</span>}
                          <span style={{ fontSize: '11px', color: '#444' }}>{new Date(co.created_at).toLocaleDateString()}</span>
                        </div>
                        <span style={{ fontSize: '13px', color: '#aaa' }}>{co.description}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
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
                        {co.direction === 'sub_to_pm' && (
                          <button style={{ ...s.btnSmall, fontSize: '11px', padding: '3px 10px', color: isPushing ? '#e8590c' : undefined }} onClick={() => { if (isPushing) { setPushCOId(null); setPushMarkup('') } else { setPushCOId(co.id); setPushMarkup(String(job.markup_pct || '')) } }}>
                            {isPushing ? '✕ Cancel' : '↑ Push to Prime'}
                          </button>
                        )}
                        <button style={{ ...s.btnSmall, fontSize: '11px', padding: '3px 10px' }} onClick={() => { const num = allCOs.length - coIdx; printSubCO(co, subName, scope, num) }}>Print CO</button>
                      </div>
                    </div>
                    {isPushing && (
                      <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '14px 16px', marginTop: '8px' }}>
                        <p style={{ fontSize: '12px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '10px' }}>Push to Prime Contract CO</p>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div>
                            <label style={s.label}>Sub amount</label>
                            <div style={{ fontSize: '15px', fontWeight: '700', color: '#f1f1f1', paddingTop: '6px' }}>${Number(co.amount).toLocaleString()}</div>
                          </div>
                          <div>
                            <label style={s.label}>Markup %</label>
                            <input type="number" style={{ ...s.input, width: '90px' }} placeholder="0" value={pushMarkup} onChange={e => setPushMarkup(e.target.value)} />
                          </div>
                          {markedUpPreview != null && (
                            <div>
                              <label style={s.label}>Prime CO amount</label>
                              <div style={{ fontSize: '15px', fontWeight: '700', color: '#4ade80', paddingTop: '6px' }}>${markedUpPreview.toLocaleString()}</div>
                            </div>
                          )}
                          <button style={{ ...s.btn, opacity: pushingToPrime ? 0.6 : 1, flexShrink: 0 }} disabled={pushingToPrime} onClick={() => pushSubCOToPrime(co, subName)}>
                            {pushingToPrime ? 'Creating...' : 'Create Prime CO'}
                          </button>
                        </div>
                      </div>
                    )}
                    {isSOVExpanded && hasSov && (
                      <div style={{ marginTop: '10px', padding: '12px', background: '#0a0a0a', borderRadius: '6px', border: '1px solid #1a1a1a' }}>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>Schedule of Values</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '10px', color: '#444', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                          <span>Description</span><span>Budget Line</span><span style={{ textAlign: 'right' }}>Amount</span>
                        </div>
                        {co.sov.map((item, i) => {
                          const bi = budgetItems.find(b => b.id === item.budget_item_id)
                          return (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '5px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{item.description || '—'}</span>
                              <span style={{ color: bi ? '#888' : '#555' }}>{bi ? `${bi.cost_code ? bi.cost_code + ' · ' : ''}${bi.description}` : '—'}</span>
                              <span style={{ textAlign: 'right', fontWeight: '600', color: Number(item.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>{Number(item.amount) >= 0 ? '+' : ''}${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )
                        })}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid #2a2a2a', marginTop: '4px' }}>
                          <span style={{ fontSize: '12px', color: '#555' }}>Total:</span>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: '#f1f1f1' }}>${co.sov.reduce((a, r) => a + Number(r.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    )}
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
                      {/* Weather */}
                      {(r.weather || r.weather_temp) && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Weather</p>
                          <p style={{ fontSize: '13px', color: '#ccc', margin: 0 }}>
                            {[r.weather, r.weather_temp && `${r.weather_temp}°F`].filter(Boolean).join(' · ')}
                            {r.weather_delay && <span style={{ marginLeft: '8px', color: '#e8590c', fontWeight: '700', fontSize: '11px' }}>DELAY</span>}
                          </p>
                        </div>
                      )}
                      {/* Work Performed */}
                      {r.work_performed && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Work Performed</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.work_performed}</p>
                        </div>
                      )}
                      {/* Crew Log */}
                      {r.crew_log?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Crew / Manpower</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr 1fr', gap: '4px 12px', fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                            <span>Name</span><span>Company</span><span>Trade</span><span>Hrs</span>
                          </div>
                          {r.crew_log.map((c, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '4px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{c.name || '—'}</span><span>{c.company || '—'}</span><span>{c.trade || '—'}</span><span>{c.hours || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Subcontractor Activity */}
                      {r.subcontractor_activity?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Subcontractor Activity</p>
                          {r.subcontractor_activity.map((sub, i) => (
                            <div key={i} style={{ padding: '8px 12px', background: '#0f0f0f', borderRadius: '6px', marginBottom: '6px' }}>
                              <p style={{ fontSize: '13px', color: '#f1f1f1', fontWeight: '600', margin: '0 0 4px' }}>{sub.company || '—'} {sub.trade ? `· ${sub.trade}` : ''} {sub.crew_size ? `· ${sub.crew_size} crew` : ''}</p>
                              {sub.notes && <p style={{ fontSize: '13px', color: '#888', margin: 0, whiteSpace: 'pre-wrap' }}>{sub.notes}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Equipment */}
                      {r.equipment_log?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Equipment</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                            <span>Equipment</span><span>Operator</span><span>Hrs</span>
                          </div>
                          {r.equipment_log.map((e, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '4px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{e.equipment || '—'}</span><span>{e.operator || '—'}</span><span>{e.hours || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Materials Delivered */}
                      {r.materials_delivered?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Materials Delivered</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                            <span>Material</span><span>Supplier</span><span>Qty</span>
                          </div>
                          {r.materials_delivered.map((m, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '4px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{m.material || '—'}</span><span>{m.supplier || '—'}</span><span>{m.quantity || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Visitors / Inspections */}
                      {r.visitors?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Visitors / Inspections</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr', gap: '4px 12px', fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                            <span>Name</span><span>Company</span><span>Purpose</span>
                          </div>
                          {r.visitors.map((v, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '4px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{v.name || '—'}</span><span>{v.company || '—'}</span><span>{v.purpose || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Safety */}
                      {r.safety_observations && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Safety Observations</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.safety_observations}</p>
                        </div>
                      )}
                      {/* Toolbox Talk */}
                      {r.toolbox_talk && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Toolbox Talk</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.toolbox_talk}</p>
                        </div>
                      )}
                      {/* Issues / Delays */}
                      {r.issues && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Issues / Delays</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.issues}</p>
                        </div>
                      )}
                      {/* Photos */}
                      {r.photos?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Photos ({r.photos.length})</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {r.photos.map((ph, i) => (
                              <div key={i} style={{ fontSize: '12px', color: '#e8590c', cursor: 'pointer', textDecoration: 'underline' }}
                                onClick={async () => {
                                  const { data } = await supabase.storage.from('daily-report-photos').createSignedUrl(ph.path, 3600)
                                  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                                }}>
                                {ph.name || `Photo ${i + 1}`}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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

        {/* ── SCHEDULE TAB ── */}
        {activeTab === 'schedule' && (
          <>
            <div style={s.card}>
              <p style={s.cardTitle}>Project Schedule</p>
              <p style={{ fontSize: '13px', color: '#666', marginTop: '-0.75rem', marginBottom: '1.25rem' }}>
                Upload Microsoft Project files (.mpp, .xml), PDFs, or Excel schedules. XML exports from MS Project will be parsed to show task progress.
              </p>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: uploadingSchedule ? '#111' : '#2a1200', color: uploadingSchedule ? '#555' : '#e8590c', border: '1px solid #4a2200', borderRadius: '8px', fontSize: '12px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', cursor: uploadingSchedule ? 'not-allowed' : 'pointer' }}>
                {uploadingSchedule ? 'Uploading...' : '+ Upload Schedule File'}
                <input type="file" accept=".mpp,.xml,.pdf,.xlsx,.xls,.csv" style={{ display: 'none' }} disabled={uploadingSchedule}
                  onChange={e => { if (e.target.files?.[0]) uploadScheduleFile(e.target.files[0]); e.target.value = '' }} />
              </label>
            </div>

            {scheduleFiles.length > 0 && (
              <div style={s.card}>
                <p style={s.cardTitle}>Uploaded Files</p>
                {scheduleFiles.map(f => (
                  <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
                    <div>
                      <span style={{ fontSize: '14px', color: '#f1f1f1' }}>{f.file_name}</span>
                      <span style={{ fontSize: '12px', color: '#555', marginLeft: '12px' }}>{new Date(f.uploaded_at).toLocaleDateString()}</span>
                      {f.file_type && <span style={{ marginLeft: '8px', padding: '2px 8px', background: '#1a1a2a', color: '#60a5fa', borderRadius: '4px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>{f.file_type}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {f.file_type === 'xml' && (
                        <button style={s.btnSmallOrange} onClick={async () => {
                          const { data } = await supabase.storage.from('schedule-files').createSignedUrl(f.storage_path, 3600)
                          if (data?.signedUrl) {
                            const res = await fetch(data.signedUrl)
                            const text = await res.text()
                            const tasks = parseProjectXml(text)
                            setParsedTasks(tasks)
                            setParsedFrom(f.file_name)
                          }
                        }}>Parse Tasks</button>
                      )}
                      <button style={s.btnSmall} onClick={() => openScheduleFile(f.storage_path)}>Open</button>
                      <button style={s.btnSmallRed} onClick={() => deleteScheduleFile(f.id, f.storage_path)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {parsedTasks && parsedTasks.length > 0 && (() => {
              const today = new Date().toISOString().slice(0, 10)
              const upcoming = parsedTasks.filter(t => !t.summary && !t.milestone && t.pct < 100 && t.finish >= today)
              const overdue = parsedTasks.filter(t => !t.summary && !t.milestone && t.pct < 100 && t.finish < today)
              const inProgress = parsedTasks.filter(t => !t.summary && !t.milestone && t.pct > 0 && t.pct < 100)
              return (
                <>
                  <div style={{ ...s.card, marginBottom: '1rem' }}>
                    <p style={s.cardTitle}>What's Next — from {parsedFrom}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                      <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: '#e8590c' }}>{inProgress.length}</div>
                        <div style={{ fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>In Progress</div>
                      </div>
                      <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: '#60a5fa' }}>{upcoming.length}</div>
                        <div style={{ fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Upcoming</div>
                      </div>
                      <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: '#ff6b6b' }}>{overdue.length}</div>
                        <div style={{ fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Overdue</div>
                      </div>
                    </div>

                    {overdue.length > 0 && (
                      <>
                        <p style={{ fontSize: '12px', fontWeight: '700', color: '#ff6b6b', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px' }}>Overdue</p>
                        {overdue.map(t => (
                          <div key={t.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#1a0a0a', border: '1px solid #5a1a1a', borderRadius: '6px', marginBottom: '6px' }}>
                            <div>
                              <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{t.name}</span>
                              <span style={{ fontSize: '12px', color: '#ff6b6b', marginLeft: '10px' }}>Due {t.finish}</span>
                            </div>
                            <span style={{ fontSize: '12px', color: '#ff6b6b', fontWeight: '700' }}>{t.pct}%</span>
                          </div>
                        ))}
                      </>
                    )}

                    {inProgress.length > 0 && (
                      <>
                        <p style={{ fontSize: '12px', fontWeight: '700', color: '#e8590c', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px', marginTop: overdue.length > 0 ? '1rem' : 0 }}>In Progress</p>
                        {inProgress.map(t => (
                          <div key={t.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '6px', marginBottom: '6px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{t.name}</span>
                                <span style={{ fontSize: '12px', color: '#e8590c', fontWeight: '700' }}>{t.pct}%</span>
                              </div>
                              <div style={{ background: '#1a1a1a', borderRadius: '4px', height: '4px' }}>
                                <div style={{ background: '#e8590c', borderRadius: '4px', height: '4px', width: `${t.pct}%` }} />
                              </div>
                              <span style={{ fontSize: '11px', color: '#555' }}>{t.start} → {t.finish}</span>
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {upcoming.filter(t => !inProgress.find(ip => ip.uid === t.uid)).length > 0 && (
                      <>
                        <p style={{ fontSize: '12px', fontWeight: '700', color: '#60a5fa', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px', marginTop: (overdue.length > 0 || inProgress.length > 0) ? '1rem' : 0 }}>Upcoming (next 30 days)</p>
                        {upcoming.filter(t => !inProgress.find(ip => ip.uid === t.uid)).filter(t => t.start <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).slice(0, 10).map(t => (
                          <div key={t.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#0a0a1a', border: '1px solid #1a2a3a', borderRadius: '6px', marginBottom: '6px' }}>
                            <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{t.name}</span>
                            <span style={{ fontSize: '12px', color: '#60a5fa' }}>{t.start} → {t.finish}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                  <div style={s.card}>
                    <p style={s.cardTitle}>All Tasks ({parsedTasks.filter(t => !t.summary).length})</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 80px', gap: '8px', padding: '6px 0 10px', fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #1e1e1e', marginBottom: '4px' }}>
                      <span>Task</span><span>Start</span><span>Finish</span><span style={{ textAlign: 'right' }}>Complete</span>
                    </div>
                    {parsedTasks.filter(t => !t.summary).map(t => {
                      const isOverdue = t.pct < 100 && t.finish < today
                      const isInProg = t.pct > 0 && t.pct < 100
                      return (
                        <div key={t.uid} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 80px', gap: '8px', padding: '10px 0', borderBottom: '1px solid #111', alignItems: 'center' }}>
                          <div>
                            <span style={{ fontSize: '13px', color: isOverdue ? '#ff6b6b' : '#f1f1f1' }}>{t.milestone ? '◆ ' : ''}{t.name}</span>
                          </div>
                          <span style={{ fontSize: '12px', color: '#555' }}>{t.start}</span>
                          <span style={{ fontSize: '12px', color: isOverdue ? '#ff6b6b' : '#555' }}>{t.finish}</span>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '12px', fontWeight: '700', color: t.pct === 100 ? '#4ade80' : isOverdue ? '#ff6b6b' : isInProg ? '#e8590c' : '#555' }}>{t.pct}%</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )
            })()}

            {scheduleFiles.length === 0 && (
              <div style={{ ...s.card, textAlign: 'center', padding: '3rem' }}>
                <p style={{ color: '#555', margin: 0 }}>No schedule files uploaded yet. Upload an MS Project XML export to see task progress here.</p>
              </div>
            )}
          </>
        )}

      </main>
    </div>
  )
}
