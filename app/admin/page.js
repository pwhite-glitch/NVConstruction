'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const CATEGORIES = ['Materials', 'Equipment', 'Labor', 'Subcontractor', 'Permits & Fees', 'Other']
const PAYMENT_METHODS = ['Check', 'ACH', 'Wire', 'Owner Direct', 'Credit Card', 'Other']
const DOW_LABELS = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' }
const TRADES = ['Concrete', 'Masonry', 'Structural Steel', 'Carpentry / Framing', 'Roofing', 'Drywall', 'Painting', 'Flooring', 'Doors & Windows', 'Mechanical / HVAC', 'Electrical', 'Plumbing', 'Fire Protection', 'Site Work / Grading', 'Landscaping', 'Insulation', 'Waterproofing', 'Signage', 'Cleaning', 'Other']

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a' },
  header: { background: '#141414', borderBottom: '1px solid #222', padding: '0 1.5rem', position: 'sticky', top: 0, zIndex: 10 },
  headerInner: { maxWidth: '1100px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoImg: { width: '40px', height: '40px', objectFit: 'contain' },
  logoName: { fontWeight: '700', fontSize: '15px', color: '#f1f1f1', letterSpacing: '1px' },
  logoSub: { fontSize: '11px', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' },
  signOut: { padding: '7px 16px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#888', cursor: 'pointer', fontSize: '13px' },
  main: { maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem' },
  card: { background: '#141414', border: '1px solid #222', borderRadius: '12px', overflow: 'hidden', marginBottom: '1.5rem' },
  tabs: { display: 'flex', borderBottom: '1px solid #222', overflowX: 'auto' },
  tab: (a) => ({ padding: '14px 20px', border: 'none', borderBottom: a ? '2px solid #e8590c' : '2px solid transparent', background: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: a ? '700' : '500', color: a ? '#e8590c' : '#555', letterSpacing: '1px', textTransform: 'uppercase', whiteSpace: 'nowrap' }),
  cardBody: { padding: '1.5rem' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' },
  btn: { padding: '11px 24px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnGray: { padding: '11px 24px', background: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSm: (c) => ({ padding: '6px 14px', background: c === 'red' ? '#2a0a0a' : c === 'green' ? '#0a1a0a' : c === 'orange' ? '#2a1200' : c === 'blue' ? '#0a1a2a' : '#1a1a1a', color: c === 'red' ? '#ff6b6b' : c === 'green' ? '#4ade80' : c === 'orange' ? '#e8590c' : c === 'blue' ? '#60a5fa' : '#888', border: `1px solid ${c === 'red' ? '#5a1a1a' : c === 'green' ? '#1a4a1a' : c === 'orange' ? '#4a2200' : c === 'blue' ? '#1a3a5a' : '#2a2a2a'}`, borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }),
  filterRow: { display: 'flex', gap: '10px', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' },
  filterSelect: { padding: '9px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '13px', color: '#888' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #1e1e1e' },
  td: { padding: '12px', fontSize: '13px', color: '#ccc', borderBottom: '1px solid #1a1a1a', verticalAlign: 'middle' },
  badge: (s) => ({ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.5px', textTransform: 'uppercase', background: s === 'approved' || s === 'paid' ? '#0a2a0a' : s === 'rejected' ? '#2a0a0a' : s === 'expired' ? '#2a0a0a' : s === 'warning' ? '#2a1a00' : '#1a1a1a', color: s === 'approved' || s === 'paid' ? '#4ade80' : s === 'rejected' ? '#ff6b6b' : s === 'expired' ? '#ff6b6b' : s === 'warning' ? '#e8590c' : '#888', border: `1px solid ${s === 'approved' || s === 'paid' ? '#1a4a1a' : s === 'rejected' ? '#5a1a1a' : s === 'expired' ? '#5a1a1a' : s === 'warning' ? '#4a2a00' : '#2a2a2a'}` }),
  formBox: { background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' },
  emptyMsg: { textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' },
}

export default function AdminPortal() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('costs')

  // Data
  const [jobs, setJobs] = useState([])
  const [costs, setCosts] = useState([])
  const [budgetItemsMap, setBudgetItemsMap] = useState({})
  const [billing, setBilling] = useState([])
  const [directory, setDirectory] = useState([])
  const [teamMap, setTeamMap] = useState({}) // userId → full_name

  // Direct costs state
  const [showAddCost, setShowAddCost] = useState(false)
  const [costForm, setCostForm] = useState({ job_id: '', budget_item_id: '', cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', notes: '' })
  const [savingCost, setSavingCost] = useState(false)
  const [filterCostJob, setFilterCostJob] = useState('')
  const [filterCostLogged, setFilterCostLogged] = useState('')
  const [filterCostCat, setFilterCostCat] = useState('')
  const [filterCostStatus, setFilterCostStatus] = useState('')

  // Billing payment state
  const [expandedBill, setExpandedBill] = useState(null)
  const [payingId, setPayingId] = useState(null)
  const [payForm, setPayForm] = useState({ paid_at: new Date().toISOString().split('T')[0], payment_amount: '', payment_method: 'Check', check_number: '', payment_notes: '' })
  const [savingPay, setSavingPay] = useState(false)
  const [payMsg, setPayMsg] = useState('')
  const [filterBillJob, setFilterBillJob] = useState('')
  const [filterBillStatus, setFilterBillStatus] = useState('')
  const [filterBillPaid, setFilterBillPaid] = useState('')
  const [filterBillNvCheck, setFilterBillNvCheck] = useState(false)
  const [filterBillReadyToPay, setFilterBillReadyToPay] = useState(false)
  const [togglingNvCheck, setTogglingNvCheck] = useState(null)
  const [togglingQb, setTogglingQb] = useState(null)

  // Sub directory state
  const [filterCOI, setFilterCOI] = useState('all')
  const [editingCOI, setEditingCOI] = useState(null)
  const [coiDate, setCoiDate] = useState('')
  const [savingCOI, setSavingCOI] = useState(false)
  const [requestingDoc, setRequestingDoc] = useState(null)
  const [docRequestSent, setDocRequestSent] = useState({})
  const [showAddDir, setShowAddDir] = useState(false)
  const [addDirForm, setAddDirForm] = useState({ company_name: '', contact_name: '', email: '', phone: '', address: '', trade: '', license_number: '', coi_expiration: '', scope_description: '' })
  const [savingDir, setSavingDir] = useState(false)
  const [expandedDirId, setExpandedDirId] = useState(null)
  const [editingDirId, setEditingDirId] = useState(null)
  const [editDirForm, setEditDirForm] = useState({})
  const [savingDirEdit, setSavingDirEdit] = useState(false)
  const [dirMsg, setDirMsg] = useState('')
  const [dirSearch, setDirSearch] = useState('')
  const [filterDirTrade, setFilterDirTrade] = useState('')
  const [filterDirDocs, setFilterDirDocs] = useState('all')
  const [uploadingW9For, setUploadingW9For] = useState(null)
  const [uploadingCoiFor, setUploadingCoiFor] = useState(null)
  const [invitingSubFor, setInvitingSubFor] = useState(null)
  const [inviteSentFor, setInviteSentFor] = useState({})

  // Lien waiver state
  const [filterLienJob, setFilterLienJob] = useState('')
  const [sendingWaiver, setSendingWaiver] = useState(null)
  const [markingReceived, setMarkingReceived] = useState(null)
  const [lienMsg, setLienMsg] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (!prof || prof.role !== 'admin') { router.push('/login'); return }
      setProfile(prof)
      const [{ data: jobList }, { data: dir }, { data: team }] = await Promise.all([
        supabase.from('jobs').select('id, job_number, project_name, payment_type').order('created_at', { ascending: false }),
        supabase.from('sub_directory').select('*').order('company_name'),
        supabase.from('profiles').select('id, full_name').in('role', ['pm', 'apm', 'admin', 'super']),
      ])
      setJobs(jobList || [])
      setDirectory(dir || [])
      const map = {}
      for (const t of team || []) map[t.id] = t.full_name || 'Unknown'
      setTeamMap(map)
      setLoading(false)
    }
    load()
  }, [router])

  useEffect(() => {
    if (activeTab === 'costs') loadCosts()
    if (activeTab === 'billing' || activeTab === 'payments') loadBilling()
  }, [activeTab])

  async function loadCosts() {
    const { data } = await supabase
      .from('direct_costs')
      .select('*, jobs(job_number, project_name), budget_items(description, cost_code)')
      .order('cost_date', { ascending: false })
    setCosts(data || [])
  }

  async function loadBilling() {
    const { data } = await supabase
      .from('billing_submissions')
      .select('*, jobs(job_number, project_name, payment_type)')
      .eq('status', 'approved')
      .order('submitted_at', { ascending: false })
    setBilling(data || [])
  }

  async function loadBudgetItemsForJob(jobId) {
    if (!jobId || budgetItemsMap[jobId]) return
    const { data } = await supabase.from('budget_items').select('id, description, cost_code').eq('job_id', jobId).order('cost_code')
    setBudgetItemsMap(prev => ({ ...prev, [jobId]: data || [] }))
  }

  async function addCost(e) {
    e.preventDefault()
    setSavingCost(true)
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('direct_costs').insert({
      job_id: costForm.job_id,
      budget_item_id: costForm.budget_item_id || null,
      cost_date: costForm.cost_date,
      description: costForm.description,
      category: costForm.category,
      amount: parseFloat(costForm.amount),
      notes: costForm.notes || null,
      submitted_by: session.user.id,
      status: 'approved',
    })
    setCostForm({ job_id: '', budget_item_id: '', cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', notes: '' })
    setShowAddCost(false)
    setSavingCost(false)
    await loadCosts()
  }

  async function markPaid(subId) {
    setSavingPay(true)
    setPayMsg('')
    const { error } = await supabase.from('billing_submissions').update({
      paid_at: payForm.paid_at ? new Date(payForm.paid_at + 'T12:00:00').toISOString() : new Date().toISOString(),
      payment_amount: payForm.payment_amount ? parseFloat(payForm.payment_amount) : null,
      payment_method: payForm.payment_method,
      check_number: payForm.check_number || null,
      payment_notes: payForm.payment_notes || null,
    }).eq('id', subId)
    setSavingPay(false)
    if (error) { setPayMsg('Error saving payment: ' + error.message); return }
    setPayingId(null)
    await loadBilling()
  }

  async function toggleReadyToPay(subId, current) {
    await supabase.from('billing_submissions').update({ ready_to_pay: !current }).eq('id', subId)
    await loadBilling()
  }

  async function toggleQb(costId, current) {
    setTogglingQb(costId)
    await supabase.from('direct_costs').update({ logged_to_quickbooks: !current }).eq('id', costId)
    setTogglingQb(null)
    await loadCosts()
  }

  async function toggleNvCutsCheck(subId, current) {
    setTogglingNvCheck(subId)
    await supabase.from('billing_submissions').update({ nv_cuts_check: !current }).eq('id', subId)
    setTogglingNvCheck(null)
    await loadBilling()
  }

  async function sendLienWaiver(sub) {
    setSendingWaiver(sub.id)
    setLienMsg('')
    const res = await fetch('/api/lien-waiver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submission_id: sub.id }) })
    const data = await res.json()
    setSendingWaiver(null)
    if (data?.ok) {
      setLienMsg(`✓ Waiver emailed to ${sub.company_name}`)
      setTimeout(() => setLienMsg(''), 4000)
    } else {
      setLienMsg(`Error: ${data?.error || 'Unknown error — check Resend logs'}`)
    }
    await loadBilling()
  }

  async function markLienReceived(subId) {
    setMarkingReceived(subId)
    await supabase.from('billing_submissions').update({ lien_waiver_received: true, lien_waiver_received_at: new Date().toISOString() }).eq('id', subId)
    setMarkingReceived(null)
    await loadBilling()
  }

  async function saveCOIDate(dirId) {
    setSavingCOI(true)
    await supabase.from('sub_directory').update({ coi_expiration: coiDate || null }).eq('id', dirId)
    setEditingCOI(null)
    setSavingCOI(false)
    const { data } = await supabase.from('sub_directory').select('*').order('company_name')
    setDirectory(data || [])
  }

  async function sendDocRequest(dirId, type) {
    const key = `${dirId}-${type}`
    setRequestingDoc(key)
    const res = await fetch('/api/doc-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory_id: dirId, type }),
    })
    const data = await res.json()
    setRequestingDoc(null)
    if (data?.ok) {
      setDocRequestSent(prev => ({ ...prev, [key]: true }))
    } else {
      alert('Failed to send: ' + (data?.error || 'Unknown error'))
    }
  }

  async function reloadDirectory() {
    const { data } = await supabase.from('sub_directory').select('*').order('company_name')
    setDirectory(data || [])
  }

  async function addDirEntry(e) {
    e.preventDefault()
    setSavingDir(true)
    setDirMsg('')
    const res = await fetch('/api/sub-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'insert', ...addDirForm }),
    })
    const data = await res.json()
    setSavingDir(false)
    if (data?.ok) {
      setShowAddDir(false)
      setAddDirForm({ company_name: '', contact_name: '', email: '', phone: '', address: '', trade: '', license_number: '', coi_expiration: '', scope_description: '' })
      await reloadDirectory()
    } else {
      setDirMsg('Error: ' + (data?.error || 'Unknown'))
    }
  }

  async function saveDirEdit(id) {
    setSavingDirEdit(true)
    const res = await fetch('/api/sub-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory_id: id, ...editDirForm }),
    })
    const data = await res.json()
    setSavingDirEdit(false)
    if (data?.ok) {
      setEditingDirId(null)
      await reloadDirectory()
    } else {
      setDirMsg('Error saving: ' + (data?.error || 'Unknown'))
    }
  }

  async function deleteDirEntry(id) {
    if (!window.confirm('Delete this subcontractor from the directory? This cannot be undone.')) return
    await fetch('/api/sub-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', directory_id: id }) })
    setExpandedDirId(null)
    setEditingDirId(null)
    await reloadDirectory()
  }

  async function uploadSubDoc(dirId, type, file) {
    if (type === 'w9') setUploadingW9For(dirId)
    else setUploadingCoiFor(dirId)
    const ext = file.name.split('.').pop()
    const path = `${dirId}/${type}-${Date.now()}.${ext}`
    const urlRes = await fetch('/api/sub-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upload-url', path }),
    })
    const { signedUrl, error: urlErr } = await urlRes.json()
    if (urlErr) { alert('Upload error: ' + urlErr); setUploadingW9For(null); setUploadingCoiFor(null); return }
    await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
    const field = type === 'w9' ? 'w9_url' : 'coi_url'
    await fetch('/api/sub-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory_id: dirId, [field]: path }),
    })
    if (type === 'w9') setUploadingW9For(null)
    else setUploadingCoiFor(null)
    await reloadDirectory()
  }

  async function getDocUrl(filePath) {
    const res = await fetch('/api/sub-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signed-url', file_path: filePath }) })
    const data = await res.json()
    if (data?.url) window.open(data.url, '_blank')
  }

  async function downloadDoc(filePath, fileName) {
    const res = await fetch('/api/sub-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signed-url', file_path: filePath, download: true }) })
    const data = await res.json()
    if (data?.url) {
      const a = document.createElement('a')
      a.href = data.url
      a.download = fileName || 'document'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  async function inviteSub(dirId) {
    setInvitingSubFor(dirId)
    const res = await fetch('/api/invite-sub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory_id: dirId }) })
    const data = await res.json()
    setInvitingSubFor(null)
    if (data?.ok) {
      setInviteSentFor(prev => ({ ...prev, [dirId]: data.action }))
    } else {
      setDirMsg('Invite failed: ' + (data?.error || 'Unknown error'))
    }
  }

  function printLienWaiver(sub) {
    const job = jobs.find(j => j.id === sub.job_id) || sub.jobs || {}
    const amt = parseFloat(sub.payment_amount || sub.amount_billed || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const period = sub.billing_period ? new Date(sub.billing_period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const w = window.open('', '_blank')
    w.document.write(`<!DOCTYPE html><html><head><title>Lien Waiver — ${sub.company_name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', serif; color: #111; padding: 60px; font-size: 13px; line-height: 1.6; max-width: 760px; margin: 0 auto; }
  .print-btn { padding: 8px 20px; background: #111; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 28px; }
  h1 { font-size: 16px; font-weight: bold; text-align: center; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .subtitle { text-align: center; font-size: 12px; color: #555; margin-bottom: 28px; }
  .notice { font-size: 11px; color: #444; text-align: center; margin-bottom: 24px; border: 1px solid #ccc; padding: 10px 16px; border-radius: 4px; }
  .section { margin-bottom: 20px; }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .field { margin-bottom: 12px; }
  .field-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; margin-bottom: 4px; }
  .field-value { border-bottom: 1px solid #333; padding-bottom: 4px; min-height: 22px; font-size: 14px; }
  .body-text { font-size: 13px; line-height: 1.8; margin-bottom: 20px; }
  .sig-section { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .sig-line { border-bottom: 1px solid #333; margin-bottom: 6px; height: 40px; }
  .sig-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
  @media print { .print-btn { display: none; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<h1>Conditional Waiver and Release on Progress Payment</h1>
<div class="subtitle">This document waives and releases lien, stop payment notice, and payment bond rights conditioned on receipt of payment.</div>
<div class="notice">NOTICE: THIS DOCUMENT WAIVES THE CLAIMANT'S LIEN AND OTHER PAYMENT RIGHTS EFFECTIVE ON RECEIPT OF PAYMENT. A PERSON SHOULD CONSIDER CONSULTING AN ATTORNEY BEFORE SIGNING THIS DOCUMENT.</div>

<div class="section">
  <div class="field-row">
    <div class="field"><div class="field-label">Claimant (Subcontractor)</div><div class="field-value">${sub.company_name || ''}</div></div>
    <div class="field"><div class="field-label">Customer / Hiring Party</div><div class="field-value">NV Construction</div></div>
  </div>
  <div class="field-row">
    <div class="field"><div class="field-label">Job / Project</div><div class="field-value">#${sub.jobs?.job_number || ''} — ${sub.jobs?.project_name || ''}</div></div>
    <div class="field"><div class="field-label">Billing Period Through</div><div class="field-value">${period}</div></div>
  </div>
  <div class="field-row">
    <div class="field"><div class="field-label">Conditional Payment Amount</div><div class="field-value">${amt}</div></div>
    <div class="field"><div class="field-label">Check / Payment No.</div><div class="field-value">${sub.check_number || '____________________'}</div></div>
  </div>
</div>

<p class="body-text">
  This document, when endorsed by the Claimant, conditionally waives and releases any mechanic's lien, stop payment notice, or payment bond right the Claimant has for labor, services, equipment, or materials furnished to the Job through the Billing Period Through date, conditioned on receipt of the Conditional Payment Amount in good funds.
</p>
<p class="body-text">
  Rights based upon labor, services, equipment, or materials furnished before the Through Date that are not within the scope of this release are not affected. This release does not cover the following items: <span style="text-decoration:underline;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> (if none, write "None").
</p>

<div class="sig-section">
  <div>
    <div class="field-label" style="margin-bottom:8px">Claimant Signature</div>
    <div class="sig-line"></div>
    <div class="sig-label">Authorized Signature</div>
  </div>
  <div>
    <div class="field-label" style="margin-bottom:8px">Date Signed</div>
    <div class="sig-line"></div>
    <div class="sig-label">Date</div>
  </div>
  <div>
    <div class="field-label" style="margin-bottom:8px">Printed Name</div>
    <div class="sig-line"></div>
    <div class="sig-label">Name &amp; Title</div>
  </div>
  <div>
    <div class="field-label" style="margin-bottom:8px">Company Name</div>
    <div class="sig-line"></div>
    <div class="sig-label">Company</div>
  </div>
</div>
</body></html>`)
    w.document.close()
  }

  const today = new Date()
  const in30 = new Date(today); in30.setDate(today.getDate() + 30)

  function coiStatus(exp) {
    if (!exp) return 'none'
    const d = new Date(exp)
    if (d < today) return 'expired'
    if (d <= in30) return 'warning'
    return 'active'
  }

  const filteredCosts = costs.filter(c =>
    (!filterCostJob || c.job_id === filterCostJob) &&
    (!filterCostCat || c.category === filterCostCat) &&
    (!filterCostStatus || c.status === filterCostStatus) &&
    (!filterCostLogged || c.submitted_by === filterCostLogged)
  )

  const filteredBilling = billing.filter(b =>
    (!filterBillJob || b.job_id === filterBillJob) &&
    (!filterBillStatus || b.status === filterBillStatus) &&
    (!filterBillPaid || (filterBillPaid === 'paid' ? !!b.paid_at : !b.paid_at)) &&
    (!filterBillNvCheck || b.nv_cuts_check) &&
    (!filterBillReadyToPay || b.ready_to_pay)
  )

  const coiList = directory.filter(d => {
    if (filterCOI === 'all') return true
    const st = coiStatus(d.coi_expiration)
    if (filterCOI === 'issues') return st === 'expired' || st === 'warning' || st === 'none' || !d.w9_url
    return st === filterCOI
  }).sort((a, b) => {
    const stA = coiStatus(a.coi_expiration), stB = coiStatus(b.coi_expiration)
    const order = { expired: 0, warning: 1, none: 2, active: 3 }
    const w9A = a.w9_url ? 1 : 0, w9B = b.w9_url ? 1 : 0
    if (w9A !== w9B) return w9A - w9B
    return (order[stA] ?? 4) - (order[stB] ?? 4)
  })

  const lienList = billing.filter(b => b.status === 'approved' && (!filterLienJob || b.job_id === filterLienJob))

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#f1f1f1' }}>Loading...</div>

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NV" style={s.logoImg} />
            <div>
              <div style={s.logoName}>NV Construction</div>
              <div style={s.logoSub}>Office Admin</div>
            </div>
          </div>
          <button style={s.signOut} onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>Sign out</button>
        </div>
      </header>

      <main style={s.main}>
        <div style={s.card}>
          <div style={s.tabs}>
            <button style={s.tab(activeTab === 'costs')} onClick={() => setActiveTab('costs')}>Direct Costs</button>
            <button style={s.tab(activeTab === 'billing')} onClick={() => setActiveTab('billing')}>Billing</button>
            <button style={s.tab(activeTab === 'payments')} onClick={() => setActiveTab('payments')}>Payments</button>
            <button style={s.tab(activeTab === 'coi')} onClick={() => setActiveTab('coi')}>Sub Directory</button>
            <button style={s.tab(activeTab === 'liens')} onClick={() => setActiveTab('liens')}>Lien Waivers</button>
          </div>

          <div style={s.cardBody}>

            {/* ── DIRECT COSTS ── */}
            {activeTab === 'costs' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={s.filterRow}>
                    <select style={s.filterSelect} value={filterCostJob} onChange={e => setFilterCostJob(e.target.value)}>
                      <option value="">All jobs</option>
                      {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                    </select>
                    <select style={s.filterSelect} value={filterCostCat} onChange={e => setFilterCostCat(e.target.value)}>
                      <option value="">All categories</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select style={s.filterSelect} value={filterCostStatus} onChange={e => setFilterCostStatus(e.target.value)}>
                      <option value="">All statuses</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    <select style={s.filterSelect} value={filterCostLogged} onChange={e => setFilterCostLogged(e.target.value)}>
                      <option value="">All staff</option>
                      {Object.entries(teamMap).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </div>
                  <button style={s.btnSm('orange')} onClick={() => setShowAddCost(v => !v)}>{showAddCost ? 'Cancel' : '+ Add direct cost'}</button>
                </div>

                {showAddCost && (
                  <div style={s.formBox}>
                    <p style={{ margin: '0 0 1rem', fontSize: '12px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>New direct cost</p>
                    <form onSubmit={addCost}>
                      <div style={{ ...s.grid3, marginBottom: '12px' }}>
                        <div>
                          <label style={s.label}>Job *</label>
                          <select style={s.input} value={costForm.job_id} onChange={e => { setCostForm(f => ({ ...f, job_id: e.target.value, budget_item_id: '' })); loadBudgetItemsForJob(e.target.value) }} required>
                            <option value="">Select job...</option>
                            {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={s.label}>Category</label>
                          <select style={s.input} value={costForm.category} onChange={e => setCostForm(f => ({ ...f, category: e.target.value }))}>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={s.label}>Date *</label>
                          <input type="date" style={s.input} value={costForm.cost_date} onChange={e => setCostForm(f => ({ ...f, cost_date: e.target.value }))} required />
                        </div>
                      </div>
                      <div style={{ ...s.grid3, marginBottom: '12px' }}>
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={s.label}>Description *</label>
                          <input style={s.input} value={costForm.description} onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))} required placeholder="e.g. Concrete delivery — footing pour" />
                        </div>
                        <div>
                          <label style={s.label}>Amount *</label>
                          <input type="number" style={s.input} value={costForm.amount} onChange={e => setCostForm(f => ({ ...f, amount: e.target.value }))} required placeholder="0.00" />
                        </div>
                      </div>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div>
                          <label style={s.label}>Budget line item</label>
                          <select style={s.input} value={costForm.budget_item_id} onChange={e => setCostForm(f => ({ ...f, budget_item_id: e.target.value }))} disabled={!costForm.job_id}>
                            <option value="">— None —</option>
                            {(budgetItemsMap[costForm.job_id] || []).map(b => <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={s.label}>Notes</label>
                          <input style={s.input} value={costForm.notes} onChange={e => setCostForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
                        </div>
                      </div>
                      <button type="submit" style={{ ...s.btn, opacity: savingCost ? 0.6 : 1 }} disabled={savingCost}>{savingCost ? 'Saving...' : 'Add cost'}</button>
                    </form>
                  </div>
                )}

                {filteredCosts.length === 0 ? <div style={s.emptyMsg}>No direct costs found.</div> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ ...s.th, textAlign: 'center', width: '48px' }}>QB</th>
                          <th style={s.th}>Date</th>
                          <th style={s.th}>Job</th>
                          <th style={s.th}>Description</th>
                          <th style={s.th}>Category</th>
                          <th style={s.th}>Budget line</th>
                          <th style={{ ...s.th, textAlign: 'right' }}>Amount</th>
                          <th style={s.th}>Status</th>
                          <th style={s.th}>Logged by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCosts.map(c => (
                          <tr key={c.id}>
                            <td style={{ ...s.td, textAlign: 'center' }}>
                              <button
                                title={c.logged_to_quickbooks ? 'Logged to QuickBooks' : 'Mark as logged to QuickBooks'}
                                disabled={togglingQb === c.id}
                                onClick={() => toggleQb(c.id, c.logged_to_quickbooks)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', opacity: togglingQb === c.id ? 0.4 : 1, padding: '2px' }}
                              >
                                {c.logged_to_quickbooks ? '✅' : '⬜'}
                              </button>
                            </td>
                            <td style={s.td}>{c.cost_date ? new Date(c.cost_date).toLocaleDateString() : '—'}</td>
                            <td style={s.td}><span style={{ color: '#f1f1f1', fontWeight: '600' }}>#{c.jobs?.job_number}</span><br /><span style={{ fontSize: '11px', color: '#555' }}>{c.jobs?.project_name}</span></td>
                            <td style={s.td}>{c.description}{c.notes ? <><br /><span style={{ fontSize: '11px', color: '#555' }}>{c.notes}</span></> : ''}</td>
                            <td style={s.td}><span style={{ fontSize: '12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '2px 8px' }}>{c.category}</span></td>
                            <td style={s.td}>{c.budget_items ? <>{c.budget_items.cost_code ? <span style={{ color: '#555', fontSize: '11px' }}>{c.budget_items.cost_code} · </span> : ''}{c.budget_items.description}</> : <span style={{ color: '#333' }}>—</span>}</td>
                            <td style={{ ...s.td, textAlign: 'right', fontWeight: '700', color: '#f1f1f1' }}>${parseFloat(c.amount || 0).toLocaleString()}</td>
                            <td style={s.td}><span style={s.badge(c.status)}>{c.status}</span></td>
                            <td style={s.td}>{teamMap[c.submitted_by] || '—'}<br /><span style={{ fontSize: '11px', color: '#555' }}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span></td>
                          </tr>
                        ))}
                        <tr>
                          <td style={s.td} />
                          <td colSpan={5} style={{ ...s.td, fontWeight: '700', color: '#888', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Total</td>
                          <td style={{ ...s.td, textAlign: 'right', fontWeight: '800', color: '#e8590c', fontSize: '16px' }}>${filteredCosts.reduce((a, c) => a + parseFloat(c.amount || 0), 0).toLocaleString()}</td>
                          <td style={s.td} />
                          <td style={s.td} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ── BILLING ── */}
            {activeTab === 'billing' && (
              <>
                {payMsg && (
                  <div style={{ background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' }}>{payMsg}</div>
                )}
                <div style={s.filterRow}>
                  <select style={s.filterSelect} value={filterBillJob} onChange={e => setFilterBillJob(e.target.value)}>
                    <option value="">All jobs</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                  </select>
                  <select style={s.filterSelect} value={filterBillPaid} onChange={e => setFilterBillPaid(e.target.value)}>
                    <option value="">Paid & unpaid</option>
                    <option value="unpaid">Unpaid only</option>
                    <option value="paid">Paid only</option>
                  </select>
                  <button style={s.btnSm(filterBillReadyToPay ? 'green' : 'gray')} onClick={() => setFilterBillReadyToPay(v => !v)}>Ready to pay only</button>
                  <button style={s.btnSm(filterBillNvCheck ? 'orange' : 'gray')} onClick={() => setFilterBillNvCheck(v => !v)}>NV cuts check only</button>
                </div>

                {filteredBilling.length === 0 ? <div style={s.emptyMsg}>No billing submissions found.</div> : filteredBilling.map(sub => {
                  const isPaid = !!sub.paid_at
                  const isOwnerPays = sub.jobs?.payment_type === 'owner_pays_direct'
                  const isExpanded = expandedBill === sub.id
                  const grossAmt = parseFloat(sub.amount_billed || 0)
                  const retainageAmt = parseFloat(sub.retainage_held || 0)
                  const netAmt = grossAmt - retainageAmt
                  return (
                    <div key={sub.id} style={{ border: `1px solid ${isPaid ? '#1a4a1a' : sub.ready_to_pay ? '#1a3a1a' : sub.nv_cuts_check ? '#4a2200' : '#1e1e1e'}`, borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: isPaid ? '#0a1a0a' : sub.ready_to_pay ? '#091209' : sub.nv_cuts_check ? '#140a00' : '#0f0f0f', cursor: 'pointer', flexWrap: 'wrap', gap: '10px' }} onClick={() => { setExpandedBill(isExpanded ? null : sub.id); setPayingId(null) }}>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{sub.company_name}</span>
                            {isPaid ? <span style={s.badge('paid')}>Paid</span> : <span style={s.badge('approved')}>Unpaid</span>}
                            {sub.ready_to_pay && !isPaid && <span style={{ fontSize: '10px', color: '#4ade80', background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '4px', padding: '2px 7px', fontWeight: '700' }}>Ready to Pay</span>}
                            {isOwnerPays && !sub.nv_cuts_check && <span style={{ fontSize: '10px', color: '#60a5fa', background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: '4px', padding: '2px 7px', fontWeight: '700' }}>Owner Pays</span>}
                            {(!isOwnerPays || sub.nv_cuts_check) && <span style={{ fontSize: '10px', color: '#e8590c', background: '#2a1200', border: '1px solid #4a2200', borderRadius: '4px', padding: '2px 7px', fontWeight: '700' }}>NV Paid Invoice</span>}
                          </div>
                          <div style={{ fontSize: '12px', color: '#555', marginTop: '3px' }}>#{sub.jobs?.job_number} — {sub.jobs?.project_name} · {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : ''}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '18px', fontWeight: '800', color: isPaid ? '#4ade80' : '#f1f1f1' }}>${netAmt.toLocaleString()}</div>
                            {retainageAmt > 0 && <div style={{ fontSize: '11px', color: '#555' }}>Gross ${grossAmt.toLocaleString()} · -${retainageAmt.toLocaleString()} ret.</div>}
                          </div>
                          <span style={{ color: '#555', fontSize: '18px' }}>{isExpanded ? '∧' : '∨'}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid #1a1a1a' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '1rem' }}>
                            <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Period</div><div style={{ fontSize: '13px', color: '#ccc' }}>{sub.billing_period ? new Date(sub.billing_period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'}</div></div>
                            <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>% Complete</div><div style={{ fontSize: '13px', color: '#ccc' }}>{sub.pct_complete ?? '—'}%</div></div>
                            <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Gross Invoice</div><div style={{ fontSize: '13px', color: '#ccc' }}>${grossAmt.toLocaleString()}</div></div>
                            <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Retainage Held</div><div style={{ fontSize: '13px', color: '#e8590c' }}>-${retainageAmt.toLocaleString()}</div></div>
                            <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Net to Pay</div><div style={{ fontSize: '15px', fontWeight: '700', color: '#f1f1f1' }}>${netAmt.toLocaleString()}</div></div>
                          </div>
                          {sub.work_description && <div style={{ fontSize: '13px', color: '#888', marginBottom: '1rem', lineHeight: '1.6' }}>{sub.work_description}</div>}

                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '1rem' }}>
                            <button style={s.btnSm(sub.nv_cuts_check ? 'orange' : 'gray')} disabled={togglingNvCheck === sub.id} onClick={() => toggleNvCutsCheck(sub.id, sub.nv_cuts_check)}>
                              {togglingNvCheck === sub.id ? '...' : sub.nv_cuts_check ? 'NV Check: On' : 'NV Check: Off'}
                            </button>
                            <button style={s.btnSm(sub.ready_to_pay ? 'green' : 'gray')} onClick={() => toggleReadyToPay(sub.id, sub.ready_to_pay)}>
                              {sub.ready_to_pay ? 'Ready to Pay: On' : 'Ready to Pay: Off'}
                            </button>
                          </div>

                          {payingId === sub.id ? (
                            <div style={{ ...s.formBox, marginTop: 0 }}>
                              <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Record payment</p>
                              <div style={{ ...s.grid3, marginBottom: '10px' }}>
                                <div>
                                  <label style={s.label}>Payment date</label>
                                  <input type="date" style={{ ...s.input, colorScheme: 'dark' }} value={payForm.paid_at} onChange={e => setPayForm(f => ({ ...f, paid_at: e.target.value }))} />
                                </div>
                                <div>
                                  <label style={s.label}>Amount paid</label>
                                  <input type="number" style={s.input} placeholder={netAmt} value={payForm.payment_amount} onChange={e => setPayForm(f => ({ ...f, payment_amount: e.target.value }))} />
                                </div>
                                <div>
                                  <label style={s.label}>Payment method</label>
                                  <select style={s.input} value={payForm.payment_method} onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}>
                                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                <div>
                                  <label style={s.label}>Check / reference #</label>
                                  <input style={s.input} placeholder="Optional" value={payForm.check_number} onChange={e => setPayForm(f => ({ ...f, check_number: e.target.value }))} />
                                </div>
                                <div>
                                  <label style={s.label}>Notes</label>
                                  <input style={s.input} placeholder="Optional" value={payForm.payment_notes} onChange={e => setPayForm(f => ({ ...f, payment_notes: e.target.value }))} />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button style={{ ...s.btn, opacity: savingPay ? 0.6 : 1 }} disabled={savingPay} onClick={() => markPaid(sub.id)}>{savingPay ? 'Saving...' : 'Save payment'}</button>
                                <button style={s.btnGray} onClick={() => { setPayingId(null); setPayMsg('') }}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {!isPaid && <button style={s.btnSm('green')} onClick={() => { setPayingId(sub.id); setPayMsg(''); setPayForm({ paid_at: new Date().toISOString().split('T')[0], payment_amount: netAmt.toString(), payment_method: 'Check', check_number: '', payment_notes: '' }) }}>Record payment</button>}
                              {isPaid && <button style={s.btnSm('orange')} onClick={() => { setPayingId(sub.id); setPayMsg(''); setPayForm({ paid_at: sub.paid_at ? new Date(sub.paid_at).toISOString().split('T')[0] : '', payment_amount: sub.payment_amount || netAmt.toString(), payment_method: sub.payment_method || 'Check', check_number: sub.check_number || '', payment_notes: sub.payment_notes || '' }) }}>Edit payment</button>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {/* ── PAYMENTS (paid history) ── */}
            {activeTab === 'payments' && (() => {
              const paidList = billing.filter(b => !!b.paid_at && (!filterBillJob || b.job_id === filterBillJob))
              const totalPaid = paidList.reduce((sum, b) => sum + parseFloat(b.payment_amount || b.amount_billed || 0), 0)
              return (
                <>
                  <div style={s.filterRow}>
                    <select style={s.filterSelect} value={filterBillJob} onChange={e => setFilterBillJob(e.target.value)}>
                      <option value="">All jobs</option>
                      {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                    </select>
                    <span style={{ fontSize: '12px', color: '#555', alignSelf: 'center' }}>{paidList.length} payment{paidList.length !== 1 ? 's' : ''}</span>
                  </div>

                  {paidList.length === 0 ? <div style={s.emptyMsg}>No payments recorded yet.</div> : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={s.th}>Sub</th>
                            <th style={s.th}>Job</th>
                            <th style={s.th}>Period</th>
                            <th style={{ ...s.th, textAlign: 'right' }}>Gross</th>
                            <th style={{ ...s.th, textAlign: 'right' }}>Retainage</th>
                            <th style={{ ...s.th, textAlign: 'right' }}>Paid</th>
                            <th style={s.th}>Date</th>
                            <th style={s.th}>Method / Check #</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paidList.map(sub => {
                            const grossAmt = parseFloat(sub.amount_billed || 0)
                            const retainageAmt = parseFloat(sub.retainage_held || 0)
                            const paidAmt = parseFloat(sub.payment_amount || grossAmt - retainageAmt)
                            return (
                              <tr key={sub.id}>
                                <td style={s.td}><span style={{ fontWeight: '600', color: '#f1f1f1' }}>{sub.company_name}</span></td>
                                <td style={s.td}><span style={{ color: '#f1f1f1' }}>#{sub.jobs?.job_number}</span><br /><span style={{ fontSize: '11px', color: '#555' }}>{sub.jobs?.project_name}</span></td>
                                <td style={s.td}>{sub.billing_period ? new Date(sub.billing_period).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}</td>
                                <td style={{ ...s.td, textAlign: 'right', color: '#888' }}>${grossAmt.toLocaleString()}</td>
                                <td style={{ ...s.td, textAlign: 'right', color: '#e8590c' }}>{retainageAmt > 0 ? `-$${retainageAmt.toLocaleString()}` : '—'}</td>
                                <td style={{ ...s.td, textAlign: 'right', fontWeight: '700', color: '#4ade80' }}>${paidAmt.toLocaleString()}</td>
                                <td style={s.td}>{new Date(sub.paid_at).toLocaleDateString()}</td>
                                <td style={s.td}>{sub.payment_method || '—'}{sub.check_number ? <><br /><span style={{ fontSize: '11px', color: '#555' }}>Check #{sub.check_number}</span></> : ''}</td>
                              </tr>
                            )
                          })}
                          <tr>
                            <td colSpan={5} style={{ ...s.td, fontWeight: '700', color: '#888', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Total paid</td>
                            <td style={{ ...s.td, textAlign: 'right', fontWeight: '800', color: '#4ade80', fontSize: '16px' }}>${totalPaid.toLocaleString()}</td>
                            <td colSpan={2} style={s.td} />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )
            })()}

            {/* ── SUB DIRECTORY ── */}
            {activeTab === 'coi' && (() => {
              const dirFiltered = directory.filter(d => {
                const q = dirSearch.toLowerCase()
                if (q && !d.company_name?.toLowerCase().includes(q) && !d.contact_name?.toLowerCase().includes(q) && !d.email?.toLowerCase().includes(q)) return false
                if (filterDirTrade && d.trade !== filterDirTrade) return false
                if (filterDirDocs === 'missing-w9') return !d.w9_url
                if (filterDirDocs === 'missing-coi') { const st = coiStatus(d.coi_expiration); return !d.coi_url || st === 'expired' || st === 'warning' }
                if (filterDirDocs === 'issues') { const st = coiStatus(d.coi_expiration); return !d.w9_url || !d.coi_url || st === 'expired' || st === 'warning' }
                return true
              })
              return (
                <>
                  {dirMsg && <div style={{ background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' }}>{dirMsg}</div>}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={s.filterRow} style={{ margin: 0, flexWrap: 'wrap', gap: '8px', display: 'flex', alignItems: 'center' }}>
                      <input style={{ ...s.filterSelect, minWidth: '220px', color: '#f1f1f1' }} placeholder="Search company, contact, email..." value={dirSearch} onChange={e => setDirSearch(e.target.value)} />
                      <select style={s.filterSelect} value={filterDirTrade} onChange={e => setFilterDirTrade(e.target.value)}>
                        <option value="">All trades</option>
                        {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <select style={s.filterSelect} value={filterDirDocs} onChange={e => setFilterDirDocs(e.target.value)}>
                        <option value="all">All subs</option>
                        <option value="issues">Issues only</option>
                        <option value="missing-w9">Missing W-9</option>
                        <option value="missing-coi">COI missing/expired</option>
                      </select>
                      <span style={{ fontSize: '12px', color: '#555' }}>{dirFiltered.length} sub{dirFiltered.length !== 1 ? 's' : ''}</span>
                    </div>
                    <button style={s.btnSm('orange')} onClick={() => { setShowAddDir(v => !v); setDirMsg('') }}>
                      {showAddDir ? 'Cancel' : '+ Add subcontractor'}
                    </button>
                  </div>

                  {showAddDir && (
                    <div style={s.formBox}>
                      <p style={{ margin: '0 0 1rem', fontSize: '12px', fontWeight: '700', color: '#e8590c', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Add subcontractor</p>
                      <form onSubmit={addDirEntry}>
                        <div style={{ ...s.grid2, marginBottom: '10px' }}>
                          <div><label style={s.label}>Company name *</label><input style={s.input} required value={addDirForm.company_name} onChange={e => setAddDirForm(f => ({ ...f, company_name: e.target.value }))} placeholder="ABC Framing LLC" /></div>
                          <div><label style={s.label}>Contact name</label><input style={s.input} value={addDirForm.contact_name} onChange={e => setAddDirForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="John Smith" /></div>
                        </div>
                        <div style={{ ...s.grid3, marginBottom: '10px' }}>
                          <div><label style={s.label}>Email</label><input type="email" style={s.input} value={addDirForm.email} onChange={e => setAddDirForm(f => ({ ...f, email: e.target.value }))} placeholder="john@abcframing.com" /></div>
                          <div><label style={s.label}>Phone</label><input style={s.input} value={addDirForm.phone} onChange={e => setAddDirForm(f => ({ ...f, phone: e.target.value }))} placeholder="555-0100" /></div>
                          <div><label style={s.label}>Address</label><input style={s.input} value={addDirForm.address} onChange={e => setAddDirForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St" /></div>
                        </div>
                        <div style={{ ...s.grid3, marginBottom: '10px' }}>
                          <div><label style={s.label}>Trade</label><select style={s.input} value={addDirForm.trade} onChange={e => setAddDirForm(f => ({ ...f, trade: e.target.value }))}><option value="">— Select —</option>{TRADES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                          <div><label style={s.label}>License #</label><input style={s.input} value={addDirForm.license_number} onChange={e => setAddDirForm(f => ({ ...f, license_number: e.target.value }))} placeholder="TX-12345" /></div>
                          <div><label style={s.label}>COI expiration</label><input type="date" style={s.input} value={addDirForm.coi_expiration} onChange={e => setAddDirForm(f => ({ ...f, coi_expiration: e.target.value }))} /></div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Scope description</label>
                          <textarea style={{ ...s.input, minHeight: '60px', resize: 'vertical' }} value={addDirForm.scope_description} onChange={e => setAddDirForm(f => ({ ...f, scope_description: e.target.value }))} placeholder="General scope of work..." />
                        </div>
                        <button type="submit" style={{ ...s.btn, opacity: savingDir ? 0.6 : 1 }} disabled={savingDir}>{savingDir ? 'Saving...' : 'Add to directory'}</button>
                      </form>
                    </div>
                  )}

                  {dirFiltered.length === 0
                    ? <div style={s.emptyMsg}>No subcontractors found.</div>
                    : dirFiltered.map(d => {
                        const st = coiStatus(d.coi_expiration)
                        const hasW9 = !!d.w9_url
                        const hasCOI = !!d.coi_url
                        const needsW9 = !hasW9
                        const needsCOI = !hasCOI || st === 'expired' || st === 'warning'
                        const w9Key = `${d.id}-w9`
                        const coiKey = `${d.id}-coi`
                        const bothKey = `${d.id}-both`
                        const isExpanded = expandedDirId === d.id
                        return (
                          <div key={d.id} style={{ border: '1px solid #1e1e1e', borderRadius: '10px', marginBottom: '8px', overflow: 'hidden' }}>
                            {/* Row header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', background: '#0f0f0f' }}
                              onClick={() => { setExpandedDirId(isExpanded ? null : d.id); setEditingDirId(null) }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontWeight: '700', color: '#f1f1f1', fontSize: '14px' }}>{d.company_name}</span>
                                {d.trade && <span style={{ fontSize: '12px', color: '#555', marginLeft: '10px' }}>{d.trade}</span>}
                                {d.contact_name && <span style={{ fontSize: '12px', color: '#888', marginLeft: '10px' }}>{d.contact_name}</span>}
                                {d.email && <span style={{ fontSize: '11px', color: '#555', marginLeft: '10px' }}>{d.email}</span>}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                <span style={{ ...s.badge(hasW9 ? 'approved' : 'rejected'), fontSize: '10px' }}>{hasW9 ? 'W-9 ✓' : 'W-9 ✗'}</span>
                                <span style={{ ...s.badge(st === 'active' ? 'approved' : st === 'expired' ? 'rejected' : st === 'warning' ? 'warning' : 'none'), fontSize: '10px' }}>
                                  COI {st === 'active' ? '✓' : st === 'expired' ? 'Exp' : st === 'warning' ? '~30d' : '✗'}
                                </span>
                                <span style={{ color: '#555', fontSize: '16px' }}>{isExpanded ? '▲' : '▼'}</span>
                              </div>
                            </div>

                            {/* Expanded detail */}
                            {isExpanded && (
                              <div style={{ padding: '1.25rem', borderTop: '1px solid #1e1e1e', background: '#080808' }}>

                                {/* Info / Edit */}
                                {editingDirId !== d.id ? (
                                  <div style={{ marginBottom: '1.25rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '10px' }}>
                                      <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', letterSpacing: '1px', textTransform: 'uppercase' }}>Email</div><div style={{ fontSize: '13px', color: '#ccc' }}>{d.email || '—'}</div></div>
                                      <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', letterSpacing: '1px', textTransform: 'uppercase' }}>Phone</div><div style={{ fontSize: '13px', color: '#ccc' }}>{d.phone || '—'}</div></div>
                                      <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', letterSpacing: '1px', textTransform: 'uppercase' }}>License</div><div style={{ fontSize: '13px', color: '#ccc' }}>{d.license_number || '—'}</div></div>
                                      <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', letterSpacing: '1px', textTransform: 'uppercase' }}>Address</div><div style={{ fontSize: '13px', color: '#ccc' }}>{d.address || '—'}</div></div>
                                      <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', letterSpacing: '1px', textTransform: 'uppercase' }}>COI Expiration</div><div style={{ fontSize: '13px', color: st === 'expired' ? '#ff6b6b' : st === 'warning' ? '#e8590c' : '#ccc' }}>{d.coi_expiration ? new Date(d.coi_expiration).toLocaleDateString() : '—'}</div></div>
                                      {d.scope_description && <div style={{ gridColumn: 'span 3' }}><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', letterSpacing: '1px', textTransform: 'uppercase' }}>Scope</div><div style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.6' }}>{d.scope_description}</div></div>}
                                    </div>
                                    <button style={s.btnSm('orange')} onClick={() => {
                                      setEditingDirId(d.id)
                                      setEditDirForm({
                                        company_name: d.company_name || '', contact_name: d.contact_name || '',
                                        email: d.email || '', phone: d.phone || '', address: d.address || '',
                                        trade: d.trade || '', license_number: d.license_number || '',
                                        coi_expiration: d.coi_expiration ? d.coi_expiration.split('T')[0] : '',
                                        scope_description: d.scope_description || '',
                                      })
                                    }}>Edit info</button>
                                  </div>
                                ) : (
                                  <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
                                    <p style={{ margin: '0 0 1rem', fontSize: '12px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase' }}>Editing {d.company_name}</p>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                                      <div><label style={s.label}>Company name</label><input style={s.input} value={editDirForm.company_name} onChange={e => setEditDirForm(f => ({ ...f, company_name: e.target.value }))} /></div>
                                      <div><label style={s.label}>Contact name</label><input style={s.input} value={editDirForm.contact_name} onChange={e => setEditDirForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
                                      <div><label style={s.label}>Email</label><input type="email" style={s.input} value={editDirForm.email} onChange={e => setEditDirForm(f => ({ ...f, email: e.target.value }))} /></div>
                                      <div><label style={s.label}>Phone</label><input style={s.input} value={editDirForm.phone} onChange={e => setEditDirForm(f => ({ ...f, phone: e.target.value }))} /></div>
                                      <div><label style={s.label}>Address</label><input style={s.input} value={editDirForm.address} onChange={e => setEditDirForm(f => ({ ...f, address: e.target.value }))} /></div>
                                      <div><label style={s.label}>Trade</label><select style={s.input} value={editDirForm.trade} onChange={e => setEditDirForm(f => ({ ...f, trade: e.target.value }))}><option value="">— Select —</option>{TRADES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                                      <div><label style={s.label}>License #</label><input style={s.input} value={editDirForm.license_number} onChange={e => setEditDirForm(f => ({ ...f, license_number: e.target.value }))} /></div>
                                      <div><label style={s.label}>COI expiration</label><input type="date" style={s.input} value={editDirForm.coi_expiration} onChange={e => setEditDirForm(f => ({ ...f, coi_expiration: e.target.value }))} /></div>
                                    </div>
                                    <div style={{ marginBottom: '10px' }}><label style={s.label}>Scope</label><textarea style={{ ...s.input, minHeight: '60px', resize: 'vertical' }} value={editDirForm.scope_description} onChange={e => setEditDirForm(f => ({ ...f, scope_description: e.target.value }))} /></div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                      <button style={{ ...s.btnSm('green'), opacity: savingDirEdit ? 0.6 : 1 }} disabled={savingDirEdit} onClick={() => saveDirEdit(d.id)}>{savingDirEdit ? 'Saving...' : 'Save changes'}</button>
                                      <button style={s.btnSm('gray')} onClick={() => setEditingDirId(null)}>Cancel</button>
                                    </div>
                                  </div>
                                )}

                                {/* Documents */}
                                <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                                  <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Documents</p>

                                  {/* W-9 */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: hasW9 ? '#0a2a0a' : '#1a0a0a', border: `1px solid ${hasW9 ? '#1a4a1a' : '#3a1a1a'}`, borderRadius: '8px', minWidth: '100px' }}>
                                      <span style={{ fontSize: '12px', fontWeight: '700', color: hasW9 ? '#4ade80' : '#ff6b6b' }}>{hasW9 ? '✓' : '✗'} W-9</span>
                                    </div>
                                    {hasW9 && (
                                      <>
                                        <button style={s.btnSm('gray')} onClick={() => getDocUrl(d.w9_url)}>View</button>
                                        <button style={s.btnSm('gray')} onClick={() => downloadDoc(d.w9_url, `W9-${d.company_name}.pdf`)}>Download</button>
                                      </>
                                    )}
                                    <label style={{ ...s.btnSm('blue'), cursor: 'pointer', opacity: uploadingW9For === d.id ? 0.6 : 1 }}>
                                      {uploadingW9For === d.id ? 'Uploading...' : hasW9 ? 'Replace W-9' : 'Upload W-9'}
                                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} disabled={uploadingW9For === d.id}
                                        onChange={e => { if (e.target.files?.[0]) uploadSubDoc(d.id, 'w9', e.target.files[0]); e.target.value = '' }} />
                                    </label>
                                  </div>

                                  {/* COI */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: hasCOI && st === 'active' ? '#0a2a0a' : '#1a0a0a', border: `1px solid ${hasCOI && st === 'active' ? '#1a4a1a' : '#3a1a1a'}`, borderRadius: '8px', minWidth: '100px' }}>
                                      <span style={{ fontSize: '12px', fontWeight: '700', color: hasCOI && st === 'active' ? '#4ade80' : st === 'warning' ? '#e8590c' : '#ff6b6b' }}>
                                        {hasCOI ? '✓' : '✗'} COI{d.coi_expiration ? ` · ${new Date(d.coi_expiration).toLocaleDateString()}` : ''}
                                      </span>
                                    </div>
                                    {hasCOI && (
                                      <>
                                        <button style={s.btnSm('gray')} onClick={() => getDocUrl(d.coi_url)}>View</button>
                                        <button style={s.btnSm('gray')} onClick={() => downloadDoc(d.coi_url, `COI-${d.company_name}.pdf`)}>Download</button>
                                      </>
                                    )}
                                    <label style={{ ...s.btnSm('blue'), cursor: 'pointer', opacity: uploadingCoiFor === d.id ? 0.6 : 1 }}>
                                      {uploadingCoiFor === d.id ? 'Uploading...' : hasCOI ? 'Replace COI' : 'Upload COI'}
                                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} disabled={uploadingCoiFor === d.id}
                                        onChange={e => { if (e.target.files?.[0]) uploadSubDoc(d.id, 'coi', e.target.files[0]); e.target.value = '' }} />
                                    </label>
                                  </div>
                                </div>

                                {/* Request buttons */}
                                {d.email && (needsW9 || needsCOI) && (
                                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '1rem' }}>
                                    <span style={{ fontSize: '11px', color: '#555', alignSelf: 'center', letterSpacing: '1px', textTransform: 'uppercase' }}>Request via email:</span>
                                    {needsW9 && !docRequestSent[w9Key] && (
                                      <button style={{ ...s.btnSm('blue'), opacity: requestingDoc === w9Key ? 0.6 : 1 }} disabled={requestingDoc === w9Key} onClick={() => sendDocRequest(d.id, 'w9')}>
                                        {requestingDoc === w9Key ? '...' : 'Request W-9'}
                                      </button>
                                    )}
                                    {needsCOI && !docRequestSent[coiKey] && !docRequestSent[bothKey] && (
                                      <button style={{ ...s.btnSm('blue'), opacity: requestingDoc === coiKey ? 0.6 : 1 }} disabled={requestingDoc === coiKey} onClick={() => sendDocRequest(d.id, 'coi')}>
                                        {requestingDoc === coiKey ? '...' : 'Request COI'}
                                      </button>
                                    )}
                                    {needsW9 && needsCOI && !docRequestSent[bothKey] && (
                                      <button style={{ ...s.btnSm('orange'), opacity: requestingDoc === bothKey ? 0.6 : 1 }} disabled={requestingDoc === bothKey} onClick={() => sendDocRequest(d.id, 'both')}>
                                        {requestingDoc === bothKey ? '...' : 'Request Both'}
                                      </button>
                                    )}
                                    {(docRequestSent[w9Key] || docRequestSent[coiKey] || docRequestSent[bothKey]) && (
                                      <span style={{ fontSize: '12px', color: '#4ade80', alignSelf: 'center' }}>✓ Request sent</span>
                                    )}
                                  </div>
                                )}

                                {/* Portal access */}
                                {d.email && (
                                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' }}>Portal access:</span>
                                    {inviteSentFor[d.id] ? (
                                      <span style={{ fontSize: '12px', color: '#4ade80' }}>
                                        ✓ {inviteSentFor[d.id] === 'reset' ? 'Password reset sent' : 'Invite sent'} to {d.email}
                                      </span>
                                    ) : (
                                      <button
                                        style={{ ...s.btnSm('blue'), opacity: invitingSubFor === d.id ? 0.6 : 1 }}
                                        disabled={invitingSubFor === d.id}
                                        onClick={() => inviteSub(d.id)}
                                      >{invitingSubFor === d.id ? 'Sending...' : 'Invite to portal'}</button>
                                    )}
                                  </div>
                                )}
                                <button style={s.btnSm('red')} onClick={() => deleteDirEntry(d.id)}>Delete from directory</button>
                              </div>
                            )}
                          </div>
                        )
                      })
                  }
                </>
              )
            })()}

            {/* ── LIEN WAIVERS ── */}
            {activeTab === 'liens' && (
              <>
                {lienMsg && (
                  <div style={{ background: lienMsg.startsWith('✓') ? '#0a1a0a' : '#2a0a0a', border: `1px solid ${lienMsg.startsWith('✓') ? '#1a4a1a' : '#5a1a1a'}`, color: lienMsg.startsWith('✓') ? '#4ade80' : '#ff6b6b', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' }}>
                    {lienMsg}
                  </div>
                )}
                <div style={s.filterRow}>
                  <select style={s.filterSelect} value={filterLienJob} onChange={e => setFilterLienJob(e.target.value)}>
                    <option value="">All jobs</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                  </select>
                  <span style={{ fontSize: '12px', color: '#555' }}>Showing approved billing submissions</span>
                </div>

                {lienList.length === 0 ? <div style={s.emptyMsg}>No approved billing submissions found.</div> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={s.th}>Sub</th>
                          <th style={s.th}>Job</th>
                          <th style={s.th}>Amount</th>
                          <th style={s.th}>Period</th>
                          <th style={s.th}>Waiver sent</th>
                          <th style={s.th}>Waiver received</th>
                          <th style={s.th}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lienList.map(sub => (
                          <tr key={sub.id}>
                            <td style={s.td}><span style={{ fontWeight: '600', color: '#f1f1f1' }}>{sub.company_name}</span><br /><span style={{ fontSize: '11px', color: '#555' }}>{sub.sub_email}</span></td>
                            <td style={s.td}>#{sub.jobs?.job_number}<br /><span style={{ fontSize: '11px', color: '#555' }}>{sub.jobs?.project_name}</span></td>
                            <td style={{ ...s.td, fontWeight: '700', color: '#f1f1f1' }}>${parseFloat(sub.amount_billed || 0).toLocaleString()}</td>
                            <td style={s.td}>{sub.billing_period ? new Date(sub.billing_period).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}</td>
                            <td style={s.td}>
                              {sub.lien_waiver_sent_at
                                ? <span style={{ color: '#4ade80', fontSize: '12px' }}>✓ {new Date(sub.lien_waiver_sent_at).toLocaleDateString()}</span>
                                : <span style={{ color: '#555', fontSize: '12px' }}>Not sent</span>}
                            </td>
                            <td style={s.td}>
                              {sub.lien_waiver_received
                                ? <span style={{ color: '#4ade80', fontSize: '12px' }}>✓ Received{sub.lien_waiver_received_at ? ` ${new Date(sub.lien_waiver_received_at).toLocaleDateString()}` : ''}</span>
                                : <span style={{ color: '#555', fontSize: '12px' }}>Pending</span>}
                            </td>
                            <td style={s.td}>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                <button style={s.btnSm('orange')} onClick={() => printLienWaiver(sub)}>Print</button>
                                <button style={{ ...s.btnSm('blue'), opacity: sendingWaiver === sub.id ? 0.6 : 1 }} disabled={sendingWaiver === sub.id} onClick={() => sendLienWaiver(sub)}>{sendingWaiver === sub.id ? '...' : 'Email to sub'}</button>
                                {!sub.lien_waiver_received && <button style={{ ...s.btnSm('green'), opacity: markingReceived === sub.id ? 0.6 : 1 }} disabled={markingReceived === sub.id} onClick={() => markLienReceived(sub.id)}>Mark received</button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

          </div>
        </div>
      </main>
    </div>
  )
}
