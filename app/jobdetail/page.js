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
  budgetTableHeader: { display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 60px 80px', gap: '12px', padding: '8px 12px 10px', fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #1e1e1e', marginBottom: '4px', alignItems: 'center' },
  budgetTableRow: { display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 60px 80px', gap: '12px', padding: '14px 12px', borderBottom: '1px solid #111', alignItems: 'center' },
  billingEntryRow: { border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' },
  billingEntryHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' },
  billingEntryExpanded: { borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' },
}

const emptyContract = { sub_id: '', contract_value: '', description: '', onedrive_url: '', budget_item_id: '' }
const emptyCO = { subcontract_id: '', amount: '', description: '', direction: 'pm_to_sub' }
const emptyBudgetItem = { cost_code: '', description: '', budget_amount: '' }
const emptyCreateBilling = { sub_id: '', company_name: '', contact_name: '', contact_info: '', amount_billed: '', pct_complete: '', work_description: '', auto_approve: true }

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
  const [editingBilling, setEditingBilling] = useState(null)
  const [editBillingForm, setEditBillingForm] = useState({})

  const update = (f, v) => setForm(x => ({ ...x, [f]: v }))

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setId(params.get('id'))
    const tab = params.get('tab')
    if (tab) setActiveTab(tab)
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
      setLoading(false)
    }
    load()
  }, [id, router])

  async function loadContracts() {
    const { data } = await supabase.from('subcontract_summary').select('*').eq('job_id', id).order('created_at', { ascending: true })
    setContracts(data || [])
    return data || []
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

  useEffect(() => {
    if (!id) return
    if (activeTab === 'contracts') { loadContracts(); loadBudgetItems() }
    if (activeTab === 'budget') { loadBudgetItems(); loadContracts() }
    if (activeTab === 'changeorders') { loadContracts(); loadAllCOs() }
    if (activeTab === 'billing') { loadBillingForJob() }
  }, [activeTab, id])

  // ── Contracts ──────────────────────────────────────────────
  async function addContract() {
    if (!contractForm.sub_id || !contractForm.contract_value) return
    setAddingContract(true)
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('subcontracts').insert({
      job_id: id,
      sub_id: contractForm.sub_id,
      contract_value: parseFloat(contractForm.contract_value),
      description: contractForm.description || null,
      onedrive_url: contractForm.onedrive_url || null,
      budget_item_id: contractForm.budget_item_id || null,
      created_by: session.user.id,
      status: 'active',
    })
    if (error) { setErrMsg(error.message); setTimeout(() => setErrMsg(''), 4000) }
    else { setShowAddContract(false); setContractForm(emptyContract); await loadContracts() }
    setAddingContract(false)
  }

  async function updateContract() {
    await supabase.from('subcontracts').update({
      contract_value: parseFloat(editContractForm.contract_value),
      description: editContractForm.description || null,
      onedrive_url: editContractForm.onedrive_url || null,
      budget_item_id: editContractForm.budget_item_id || null,
    }).eq('id', editingContract)
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

  // ── Budget ──────────────────────────────────────────────────
  async function saveBudgetItem(e) {
    e.preventDefault()
    setAddingBudgetItem(true)
    await supabase.from('budget_items').insert({
      job_id: id,
      cost_code: budgetItemForm.cost_code || null,
      description: budgetItemForm.description,
      budget_amount: parseFloat(budgetItemForm.budget_amount),
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

  // ── Billing (PM-managed) ─────────────────────────────────────
  async function createBilling() {
    if (!createBillingForm.amount_billed || !createBillingForm.company_name) return
    setCreatingBilling(true)
    const now = new Date().toISOString()
    const status = createBillingForm.auto_approve ? 'approved' : 'pending'
    const { error } = await supabase.from('billing_submissions').insert({
      job_id: id,
      company_name: createBillingForm.company_name,
      contact_name: createBillingForm.contact_name || null,
      contact_info: createBillingForm.contact_info || null,
      amount_billed: parseFloat(createBillingForm.amount_billed),
      pct_complete: createBillingForm.pct_complete ? parseFloat(createBillingForm.pct_complete) : null,
      work_description: createBillingForm.work_description || null,
      status,
      submitted_at: now,
      reviewed_at: status === 'approved' ? now : null,
    })
    if (error) { setErrMsg(error.message); setTimeout(() => setErrMsg(''), 4000) }
    else {
      setShowCreateBilling(false)
      setCreateBillingForm(emptyCreateBilling)
      await loadBillingForJob()
    }
    setCreatingBilling(false)
  }

  async function updateBillingEntry() {
    const now = new Date().toISOString()
    await supabase.from('billing_submissions').update({
      company_name: editBillingForm.company_name,
      contact_name: editBillingForm.contact_name || null,
      contact_info: editBillingForm.contact_info || null,
      amount_billed: parseFloat(editBillingForm.amount_billed),
      pct_complete: editBillingForm.pct_complete ? parseFloat(editBillingForm.pct_complete) : null,
      work_description: editBillingForm.work_description || null,
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
    const rows = contracts.map(c => ({ c, subName: registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown' }))
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

        {/* ── BUDGET TAB ── */}
        {activeTab === 'budget' && (
          <>
            <div style={s.statRow}>
              <div style={s.statCard}><div style={s.statLabel}>Total budget</div><div style={s.statValue()}>${totalBudget.toLocaleString()}</div></div>
              <div style={s.statCard}>
                <div style={s.statLabel}>Committed</div>
                <div style={s.statValue('#e8590c')}>${totalCommitted.toLocaleString()}</div>
                {totalBudget > 0 && <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>{((totalCommitted / totalBudget) * 100).toFixed(1)}% of budget</div>}
              </div>
              <div style={s.statCard}>
                <div style={s.statLabel}>Uncommitted</div>
                <div style={s.statValue(totalUncommitted < 0 ? '#ff6b6b' : '#4ade80')}>{totalUncommitted < 0 ? '-' : ''}${Math.abs(totalUncommitted).toLocaleString()}</div>
                {totalUncommitted < 0 && <div style={{ fontSize: '12px', color: '#ff6b6b', marginTop: '4px' }}>Over budget</div>}
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
                  <div style={{ ...s.grid3, marginBottom: '12px' }}>
                    <div><label style={s.label}>Cost code</label><input style={s.input} value={budgetItemForm.cost_code} onChange={e => setBudgetItemForm(f => ({ ...f, cost_code: e.target.value }))} placeholder="03-000" /></div>
                    <div><label style={s.label}>Description</label><input style={s.input} value={budgetItemForm.description} onChange={e => setBudgetItemForm(f => ({ ...f, description: e.target.value }))} required placeholder="Concrete" /></div>
                    <div><label style={s.label}>Budget amount</label><input type="number" step="0.01" style={s.input} value={budgetItemForm.budget_amount} onChange={e => setBudgetItemForm(f => ({ ...f, budget_amount: e.target.value }))} required placeholder="0.00" /></div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" style={{ ...s.btnSmallOrange, opacity: addingBudgetItem ? 0.6 : 1 }} disabled={addingBudgetItem}>{addingBudgetItem ? 'Saving...' : 'Save line'}</button>
                    <button type="button" style={s.btnSmall} onClick={() => setShowAddBudgetItem(false)}>Cancel</button>
                  </div>
                </form>
              )}

              {editingBudgetItem && (
                <form onSubmit={updateBudgetItem} style={{ ...s.inlineForm, border: '1px solid #4a2200' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Edit budget line</p>
                  <div style={{ ...s.grid3, marginBottom: '12px' }}>
                    <div><label style={s.label}>Cost code</label><input style={s.input} value={editBudgetForm.cost_code || ''} onChange={e => setEditBudgetForm(f => ({ ...f, cost_code: e.target.value }))} placeholder="03-000" /></div>
                    <div><label style={s.label}>Description</label><input style={s.input} value={editBudgetForm.description || ''} onChange={e => setEditBudgetForm(f => ({ ...f, description: e.target.value }))} required /></div>
                    <div><label style={s.label}>Budget amount</label><input type="number" step="0.01" style={s.input} value={editBudgetForm.budget_amount || ''} onChange={e => setEditBudgetForm(f => ({ ...f, budget_amount: e.target.value }))} required /></div>
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
                    <span style={{ textAlign: 'right' }}>Budget</span>
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
                        <div style={{ textAlign: 'right', fontSize: '14px', color: committed > 0 ? '#e8590c' : '#444', fontWeight: '600' }}>${committed.toLocaleString()}</div>
                        <div style={{ textAlign: 'right', fontSize: '14px', color: over ? '#ff6b6b' : '#4ade80', fontWeight: '600' }}>{over ? '-' : ''}${Math.abs(uncommitted).toLocaleString()}</div>
                        <div style={{ textAlign: 'right', fontSize: '13px', color: over ? '#ff6b6b' : pct > 85 ? '#e8590c' : '#555' }}>{pct.toFixed(0)}%</div>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button style={s.btnSmall} onClick={() => { setEditingBudgetItem(item.id); setEditBudgetForm({ cost_code: item.cost_code || '', description: item.description, budget_amount: item.budget_amount }); setShowAddBudgetItem(false) }}>Edit</button>
                          <button style={s.btnSmallRed} onClick={() => deleteBudgetItem(item.id)}>Del</button>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
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
                      <select style={s.input} value={contractForm.sub_id} onChange={e => setContractForm(f => ({ ...f, sub_id: e.target.value }))}>
                        <option value="">Select a sub...</option>
                        {registeredSubs.map(a => <option key={a.sub_id} value={a.sub_id}>{a.profiles?.company_name || a.sub_email}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Contract value ($)</label>
                      <input type="number" style={s.input} placeholder="0.00" value={contractForm.contract_value} onChange={e => setContractForm(f => ({ ...f, contract_value: e.target.value }))} />
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
                const subName = registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown sub'
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
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmall} onClick={() => { setEditingContract(isEditing ? null : c.id); setEditContractForm({ contract_value: c.contract_value, description: c.description || '', onedrive_url: c.onedrive_url || '', budget_item_id: c.budget_item_id || '' }) }}>
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
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>OneDrive link</label>
                          <input style={s.input} value={editContractForm.onedrive_url} onChange={e => setEditContractForm(f => ({ ...f, onedrive_url: e.target.value }))} placeholder="https://onedrive.live.com/..." />
                        </div>
                        <button style={s.btnSmallOrange} onClick={updateContract}>Save changes</button>
                      </div>
                    )}

                    {c.onedrive_url && !isEditing && (
                      <div style={{ ...s.contractRowExpanded, paddingTop: '10px', paddingBottom: '10px' }}>
                        <a href={c.onedrive_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#60a5fa' }}>View contract on OneDrive ↗</a>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── CHANGE ORDERS TAB ── */}
        {activeTab === 'changeorders' && (
          <>
            <div style={s.statRow}>
              <div style={s.statCard}><div style={s.statLabel}>Pending</div><div style={s.statValue(pendingCOs > 0 ? '#e8590c' : undefined)}>{pendingCOs}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Approved CO value</div><div style={s.statValue('#4ade80')}>{approvedCOValue >= 0 ? '+' : ''}${approvedCOValue.toLocaleString()}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Total COs</div><div style={s.statValue()}>{allCOs.length}</div></div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Change Orders ({allCOs.length})</p>
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
                        const subName = registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown'
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
                const subName = registeredSubs.find(s => s.sub_id === subId)?.profiles?.company_name || 'Unknown sub'
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

                  {registeredSubs.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <label style={s.label}>Auto-fill from sub (optional)</label>
                      <select style={s.input} value={createBillingForm.sub_id}
                        onChange={e => {
                          const sub_id = e.target.value
                          const subData = registeredSubs.find(s => s.sub_id === sub_id)
                          setCreateBillingForm(f => ({
                            ...f,
                            sub_id,
                            company_name: subData?.profiles?.company_name || f.company_name,
                            contact_name: subData?.profiles?.full_name || f.contact_name,
                            contact_info: subData?.profiles?.phone || f.contact_info,
                          }))
                        }}>
                        <option value="">— Select to auto-fill —</option>
                        {registeredSubs.map(a => <option key={a.sub_id} value={a.sub_id}>{a.profiles?.company_name || a.sub_email}</option>)}
                      </select>
                    </div>
                  )}

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
                      <input type="number" step="0.01" style={s.input} value={createBillingForm.amount_billed} onChange={e => setCreateBillingForm(f => ({ ...f, amount_billed: e.target.value }))} placeholder="0.00" required />
                    </div>
                    <div>
                      <label style={s.label}>% complete</label>
                      <input type="number" min="0" max="100" style={s.input} value={createBillingForm.pct_complete} onChange={e => setCreateBillingForm(f => ({ ...f, pct_complete: e.target.value }))} placeholder="0" />
                    </div>
                  </div>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={s.label}>Work description</label>
                    <textarea style={{ ...s.textarea, minHeight: '80px' }} value={createBillingForm.work_description} onChange={e => setCreateBillingForm(f => ({ ...f, work_description: e.target.value }))} placeholder="Describe the work completed this billing period..." />
                  </div>
                  <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input type="checkbox" id="autoApprove" checked={createBillingForm.auto_approve} onChange={e => setCreateBillingForm(f => ({ ...f, auto_approve: e.target.checked }))} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#e8590c' }} />
                    <label htmlFor="autoApprove" style={{ fontSize: '13px', color: '#ccc', cursor: 'pointer' }}>
                      Approve immediately (skip pending queue)
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: creatingBilling ? 0.6 : 1 }} disabled={creatingBilling || !createBillingForm.company_name || !createBillingForm.amount_billed} onClick={createBilling}>
                      {creatingBilling ? 'Saving...' : createBillingForm.auto_approve ? 'Save & approve' : 'Save as pending'}
                    </button>
                    <button style={s.btnGray} onClick={() => { setShowCreateBilling(false); setCreateBillingForm(emptyCreateBilling) }}>Cancel</button>
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
                          {b.pct_complete != null ? ` · ${b.pct_complete}% complete` : ''}
                          {b.work_description ? ` · ${b.work_description.slice(0, 60)}${b.work_description.length > 60 ? '…' : ''}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: '#f1f1f1' }}>${Number(b.amount_billed).toLocaleString()}</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmallOrange} onClick={() => {
                            setEditingBilling(isEditing ? null : b.id)
                            setEditBillingForm({
                              company_name: b.company_name || '',
                              contact_name: b.contact_name || '',
                              contact_info: b.contact_info || '',
                              amount_billed: b.amount_billed || '',
                              pct_complete: b.pct_complete ?? '',
                              work_description: b.work_description || '',
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
                        <div style={{ ...s.grid3, marginBottom: '12px' }}>
                          <div>
                            <label style={s.label}>Contact info</label>
                            <input style={s.input} value={editBillingForm.contact_info} onChange={e => setEditBillingForm(f => ({ ...f, contact_info: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Amount billed ($)</label>
                            <input type="number" step="0.01" style={s.input} value={editBillingForm.amount_billed} onChange={e => setEditBillingForm(f => ({ ...f, amount_billed: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>% complete</label>
                            <input type="number" min="0" max="100" style={s.input} value={editBillingForm.pct_complete} onChange={e => setEditBillingForm(f => ({ ...f, pct_complete: e.target.value }))} />
                          </div>
                        </div>
                        <div style={{ marginBottom: '12px' }}>
                          <label style={s.label}>Work description</label>
                          <textarea style={{ ...s.textarea, minHeight: '80px' }} value={editBillingForm.work_description} onChange={e => setEditBillingForm(f => ({ ...f, work_description: e.target.value }))} />
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
