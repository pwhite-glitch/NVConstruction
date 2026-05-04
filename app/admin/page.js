'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const CATEGORIES = ['Materials', 'Equipment', 'Labor', 'Subcontractor', 'Permits & Fees', 'Other']
const PAYMENT_METHODS = ['Check', 'ACH', 'Wire', 'Owner Direct', 'Credit Card', 'Other']
const DOW_LABELS = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' }

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

  // Direct costs state
  const [showAddCost, setShowAddCost] = useState(false)
  const [costForm, setCostForm] = useState({ job_id: '', budget_item_id: '', cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', notes: '' })
  const [savingCost, setSavingCost] = useState(false)
  const [filterCostJob, setFilterCostJob] = useState('')
  const [filterCostCat, setFilterCostCat] = useState('')
  const [filterCostStatus, setFilterCostStatus] = useState('')

  // Billing payment state
  const [expandedBill, setExpandedBill] = useState(null)
  const [payingId, setPayingId] = useState(null)
  const [payForm, setPayForm] = useState({ paid_at: new Date().toISOString().split('T')[0], payment_amount: '', payment_method: 'Check', check_number: '', payment_notes: '' })
  const [savingPay, setSavingPay] = useState(false)
  const [filterBillJob, setFilterBillJob] = useState('')
  const [filterBillStatus, setFilterBillStatus] = useState('')
  const [filterBillPaid, setFilterBillPaid] = useState('')

  // COI state
  const [filterCOI, setFilterCOI] = useState('all')
  const [editingCOI, setEditingCOI] = useState(null)
  const [coiDate, setCoiDate] = useState('')
  const [savingCOI, setSavingCOI] = useState(false)

  // Lien waiver state
  const [filterLienJob, setFilterLienJob] = useState('')
  const [sendingWaiver, setSendingWaiver] = useState(null)
  const [markingReceived, setMarkingReceived] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (!prof || prof.role !== 'admin') { router.push('/login'); return }
      setProfile(prof)
      const [{ data: jobList }, { data: dir }] = await Promise.all([
        supabase.from('jobs').select('id, job_number, project_name, payment_type').order('created_at', { ascending: false }),
        supabase.from('sub_directory').select('*').order('company_name'),
      ])
      setJobs(jobList || [])
      setDirectory(dir || [])
      setLoading(false)
    }
    load()
  }, [router])

  useEffect(() => {
    if (activeTab === 'costs') loadCosts()
    if (activeTab === 'billing') loadBilling()
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
    await supabase.from('billing_submissions').update({
      paid_at: payForm.paid_at ? new Date(payForm.paid_at).toISOString() : new Date().toISOString(),
      payment_amount: payForm.payment_amount ? parseFloat(payForm.payment_amount) : null,
      payment_method: payForm.payment_method,
      check_number: payForm.check_number || null,
      payment_notes: payForm.payment_notes || null,
    }).eq('id', subId)
    setPayingId(null)
    setSavingPay(false)
    await loadBilling()
  }

  async function sendLienWaiver(sub) {
    setSendingWaiver(sub.id)
    await fetch('/api/lien-waiver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submission_id: sub.id }) })
    setSendingWaiver(null)
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
    (!filterCostStatus || c.status === filterCostStatus)
  )

  const filteredBilling = billing.filter(b =>
    (!filterBillJob || b.job_id === filterBillJob) &&
    (!filterBillStatus || b.status === filterBillStatus) &&
    (!filterBillPaid || (filterBillPaid === 'paid' ? !!b.paid_at : !b.paid_at))
  )

  const coiList = directory.filter(d => {
    if (filterCOI === 'all') return true
    const st = coiStatus(d.coi_expiration)
    if (filterCOI === 'issues') return st === 'expired' || st === 'warning' || st === 'none'
    return st === filterCOI
  }).sort((a, b) => {
    const stA = coiStatus(a.coi_expiration), stB = coiStatus(b.coi_expiration)
    const order = { expired: 0, warning: 1, none: 2, active: 3 }
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
            <button style={s.tab(activeTab === 'billing')} onClick={() => setActiveTab('billing')}>Billing & Payments</button>
            <button style={s.tab(activeTab === 'coi')} onClick={() => setActiveTab('coi')}>COI Alerts</button>
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
                          <th style={s.th}>Date</th>
                          <th style={s.th}>Job</th>
                          <th style={s.th}>Description</th>
                          <th style={s.th}>Category</th>
                          <th style={s.th}>Budget line</th>
                          <th style={{ ...s.th, textAlign: 'right' }}>Amount</th>
                          <th style={s.th}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCosts.map(c => (
                          <tr key={c.id}>
                            <td style={s.td}>{c.cost_date ? new Date(c.cost_date).toLocaleDateString() : '—'}</td>
                            <td style={s.td}><span style={{ color: '#f1f1f1', fontWeight: '600' }}>#{c.jobs?.job_number}</span><br /><span style={{ fontSize: '11px', color: '#555' }}>{c.jobs?.project_name}</span></td>
                            <td style={s.td}>{c.description}{c.notes ? <><br /><span style={{ fontSize: '11px', color: '#555' }}>{c.notes}</span></> : ''}</td>
                            <td style={s.td}><span style={{ fontSize: '12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '2px 8px' }}>{c.category}</span></td>
                            <td style={s.td}>{c.budget_items ? <>{c.budget_items.cost_code ? <span style={{ color: '#555', fontSize: '11px' }}>{c.budget_items.cost_code} · </span> : ''}{c.budget_items.description}</> : <span style={{ color: '#333' }}>—</span>}</td>
                            <td style={{ ...s.td, textAlign: 'right', fontWeight: '700', color: '#f1f1f1' }}>${parseFloat(c.amount || 0).toLocaleString()}</td>
                            <td style={s.td}><span style={s.badge(c.status)}>{c.status}</span></td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={5} style={{ ...s.td, fontWeight: '700', color: '#888', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Total</td>
                          <td style={{ ...s.td, textAlign: 'right', fontWeight: '800', color: '#e8590c', fontSize: '16px' }}>${filteredCosts.reduce((a, c) => a + parseFloat(c.amount || 0), 0).toLocaleString()}</td>
                          <td style={s.td} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ── BILLING & PAYMENTS ── */}
            {activeTab === 'billing' && (
              <>
                <div style={s.filterRow}>
                  <select style={s.filterSelect} value={filterBillJob} onChange={e => setFilterBillJob(e.target.value)}>
                    <option value="">All jobs</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                  </select>
                  <select style={s.filterSelect} value={filterBillStatus} onChange={e => setFilterBillStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <select style={s.filterSelect} value={filterBillPaid} onChange={e => setFilterBillPaid(e.target.value)}>
                    <option value="">Paid & unpaid</option>
                    <option value="unpaid">Unpaid only</option>
                    <option value="paid">Paid only</option>
                  </select>
                </div>

                {filteredBilling.length === 0 ? <div style={s.emptyMsg}>No billing submissions found.</div> : filteredBilling.map(sub => {
                  const isPaid = !!sub.paid_at
                  const isOwnerPays = sub.jobs?.payment_type === 'owner_pays_direct'
                  const isExpanded = expandedBill === sub.id
                  return (
                    <div key={sub.id} style={{ border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#0f0f0f', cursor: 'pointer', flexWrap: 'wrap', gap: '10px' }} onClick={() => setExpandedBill(isExpanded ? null : sub.id)}>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{sub.company_name}</span>
                            <span style={s.badge(sub.status)}>{sub.status}</span>
                            {isPaid && <span style={s.badge('paid')}>Paid</span>}
                            {isOwnerPays && <span style={{ fontSize: '10px', color: '#60a5fa', background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: '4px', padding: '2px 7px', fontWeight: '700' }}>Owner Pays</span>}
                          </div>
                          <div style={{ fontSize: '12px', color: '#555', marginTop: '3px' }}>#{sub.jobs?.job_number} — {sub.jobs?.project_name} · {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : ''}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <span style={{ fontSize: '18px', fontWeight: '800', color: isPaid ? '#4ade80' : '#f1f1f1' }}>${parseFloat(sub.amount_billed || 0).toLocaleString()}</span>
                          <span style={{ color: '#555', fontSize: '18px' }}>{isExpanded ? '∧' : '∨'}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid #1a1a1a' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '1rem' }}>
                            <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Period</div><div style={{ fontSize: '13px', color: '#ccc' }}>{sub.billing_period ? new Date(sub.billing_period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'}</div></div>
                            <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>% Complete</div><div style={{ fontSize: '13px', color: '#ccc' }}>{sub.pct_complete ?? '—'}%</div></div>
                            <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Retainage</div><div style={{ fontSize: '13px', color: '#ccc' }}>${parseFloat(sub.retainage_held || 0).toLocaleString()}</div></div>
                            {isPaid && <>
                              <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Paid date</div><div style={{ fontSize: '13px', color: '#4ade80' }}>{new Date(sub.paid_at).toLocaleDateString()}</div></div>
                              <div><div style={{ fontSize: '11px', color: '#555', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Method</div><div style={{ fontSize: '13px', color: '#ccc' }}>{sub.payment_method || '—'}{sub.check_number ? ` #${sub.check_number}` : ''}</div></div>
                            </>}
                          </div>
                          {sub.work_description && <div style={{ fontSize: '13px', color: '#888', marginBottom: '1rem', lineHeight: '1.6' }}>{sub.work_description}</div>}

                          {isOwnerPays && !isPaid && (
                            <div style={{ background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: '8px', padding: '10px 14px', marginBottom: '1rem', fontSize: '13px', color: '#60a5fa' }}>
                              This job is set to Owner Pays Direct. Record a payment below only if NV Construction is cutting a check for this invoice.
                            </div>
                          )}

                          {payingId === sub.id ? (
                            <div style={{ ...s.formBox, marginTop: 0 }}>
                              <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Record payment</p>
                              <div style={{ ...s.grid3, marginBottom: '10px' }}>
                                <div>
                                  <label style={s.label}>Payment date</label>
                                  <input type="date" style={s.input} value={payForm.paid_at} onChange={e => setPayForm(f => ({ ...f, paid_at: e.target.value }))} />
                                </div>
                                <div>
                                  <label style={s.label}>Amount paid</label>
                                  <input type="number" style={s.input} placeholder={sub.amount_billed} value={payForm.payment_amount} onChange={e => setPayForm(f => ({ ...f, payment_amount: e.target.value }))} />
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
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button style={{ ...s.btn, opacity: savingPay ? 0.6 : 1 }} disabled={savingPay} onClick={() => markPaid(sub.id)}>{savingPay ? 'Saving...' : 'Save payment'}</button>
                                <button style={s.btnGray} onClick={() => setPayingId(null)}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {!isPaid && <button style={s.btnSm('green')} onClick={() => { setPayingId(sub.id); setPayForm({ paid_at: new Date().toISOString().split('T')[0], payment_amount: sub.amount_billed || '', payment_method: 'Check', check_number: '', payment_notes: '' }) }}>Record payment</button>}
                              {isPaid && <button style={s.btnSm('orange')} onClick={() => { setPayingId(sub.id); setPayForm({ paid_at: sub.paid_at?.split('T')[0] || '', payment_amount: sub.payment_amount || sub.amount_billed || '', payment_method: sub.payment_method || 'Check', check_number: sub.check_number || '', payment_notes: sub.payment_notes || '' }) }}>Edit payment</button>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {/* ── COI ALERTS ── */}
            {activeTab === 'coi' && (
              <>
                <div style={s.filterRow}>
                  <select style={s.filterSelect} value={filterCOI} onChange={e => setFilterCOI(e.target.value)}>
                    <option value="all">All subs</option>
                    <option value="issues">Issues only (expired, expiring, missing)</option>
                    <option value="expired">Expired</option>
                    <option value="warning">Expiring within 30 days</option>
                    <option value="active">Active</option>
                  </select>
                  <span style={{ fontSize: '13px', color: '#555', marginLeft: '4px' }}>{coiList.length} sub{coiList.length !== 1 ? 's' : ''}</span>
                </div>

                {coiList.length === 0 ? <div style={s.emptyMsg}>No subs found.</div> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={s.th}>Company</th>
                          <th style={s.th}>Trade</th>
                          <th style={s.th}>Contact</th>
                          <th style={s.th}>COI Expiration</th>
                          <th style={s.th}>Status</th>
                          <th style={s.th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coiList.map(d => {
                          const st = coiStatus(d.coi_expiration)
                          const statusLabel = st === 'expired' ? 'Expired' : st === 'warning' ? 'Expiring soon' : st === 'none' ? 'No COI on file' : 'Active'
                          return (
                            <tr key={d.id}>
                              <td style={s.td}><span style={{ fontWeight: '600', color: '#f1f1f1' }}>{d.company_name}</span></td>
                              <td style={s.td}>{d.trade || '—'}</td>
                              <td style={s.td}>{d.contact_name || '—'}{d.email ? <><br /><span style={{ fontSize: '11px', color: '#555' }}>{d.email}</span></> : ''}</td>
                              <td style={s.td}>
                                {editingCOI === d.id ? (
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <input type="date" style={{ ...s.input, maxWidth: '160px', padding: '6px 10px' }} value={coiDate} onChange={e => setCoiDate(e.target.value)} />
                                    <button style={s.btnSm('green')} disabled={savingCOI} onClick={() => saveCOIDate(d.id)}>{savingCOI ? '...' : 'Save'}</button>
                                    <button style={s.btnSm('gray')} onClick={() => setEditingCOI(null)}>✕</button>
                                  </div>
                                ) : (
                                  <span style={{ color: st === 'expired' ? '#ff6b6b' : st === 'warning' ? '#e8590c' : st === 'none' ? '#555' : '#ccc' }}>
                                    {d.coi_expiration ? new Date(d.coi_expiration).toLocaleDateString() : 'Not on file'}
                                  </span>
                                )}
                              </td>
                              <td style={s.td}><span style={s.badge(st === 'active' ? 'approved' : st === 'expired' ? 'rejected' : st === 'warning' ? 'warning' : 'none')}>{statusLabel}</span></td>
                              <td style={s.td}>
                                {editingCOI !== d.id && (
                                  <button style={s.btnSm('orange')} onClick={() => { setEditingCOI(d.id); setCoiDate(d.coi_expiration || '') }}>Update date</button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ── LIEN WAIVERS ── */}
            {activeTab === 'liens' && (
              <>
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
