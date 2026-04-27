'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const TRADES = [
  'Concrete', 'Masonry', 'Structural Steel', 'Carpentry / Framing',
  'Roofing', 'Drywall', 'Painting', 'Flooring', 'Doors & Windows',
  'Mechanical / HVAC', 'Electrical', 'Plumbing', 'Fire Protection',
  'Site Work / Grading', 'Landscaping', 'Insulation', 'Waterproofing',
  'Signage', 'Cleaning', 'Other'
]

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a' },
  header: { background: '#141414', borderBottom: '1px solid #222', padding: '0 1.5rem', position: 'sticky', top: 0, zIndex: 10 },
  headerInner: { maxWidth: '1040px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoImg: { width: '40px', height: '40px', objectFit: 'contain' },
  logoName: { fontWeight: '700', fontSize: '15px', color: '#f1f1f1', letterSpacing: '1px' },
  logoSub: { fontSize: '11px', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' },
  signOut: { padding: '7px 16px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#888', cursor: 'pointer', fontSize: '13px' },
  main: { maxWidth: '1040px', margin: '0 auto', padding: '2rem 1.5rem' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' },
  statCard: { background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '1.25rem 1.5rem' },
  statLabel: { fontSize: '11px', fontWeight: '600', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '8px' },
  statValue: (accent) => ({ fontSize: '32px', fontWeight: '800', color: accent || '#f1f1f1', margin: 0 }),
  card: { background: '#141414', border: '1px solid #222', borderRadius: '12px', overflow: 'hidden', marginBottom: '1.5rem' },
  tabs: { display: 'flex', borderBottom: '1px solid #222', overflowX: 'auto' },
  tab: (active) => ({ padding: '14px 20px', border: 'none', borderBottom: active ? '2px solid #e8590c' : '2px solid transparent', background: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: active ? '700' : '500', color: active ? '#e8590c' : '#555', letterSpacing: '1px', textTransform: 'uppercase', whiteSpace: 'nowrap' }),
  cardBody: { padding: '1.5rem' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' },
  btn: { padding: '11px 24px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnGray: { padding: '11px 24px', background: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSm: (color) => ({ padding: '7px 16px', background: color === 'red' ? '#2a0a0a' : color === 'green' ? '#0a1a0a' : color === 'orange' ? '#2a1200' : '#1a1a1a', color: color === 'red' ? '#ff6b6b' : color === 'green' ? '#4ade80' : color === 'orange' ? '#e8590c' : '#888', border: `1px solid ${color === 'red' ? '#5a1a1a' : color === 'green' ? '#1a4a1a' : color === 'orange' ? '#4a2200' : '#2a2a2a'}`, borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }),
  filterRow: { display: 'flex', gap: '12px', marginBottom: '1.25rem', flexWrap: 'wrap' },
  filterSelect: { padding: '9px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '13px', color: '#888' },
  filterInput: { padding: '9px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '13px', color: '#f1f1f1', outline: 'none', flex: 1 },
  row: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '1rem', padding: '14px 8px', cursor: 'pointer', borderRadius: '8px' },
  rowBorder: { borderBottom: '1px solid #1a1a1a' },
  company: { margin: 0, fontSize: '14px', fontWeight: '600', color: '#f1f1f1' },
  meta: { margin: 0, fontSize: '12px', color: '#555', marginTop: '3px' },
  detail: { background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1.25rem', marginBottom: '12px' },
  detailGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' },
  detailLabel: { fontSize: '11px', color: '#555', marginBottom: '3px', letterSpacing: '1px', textTransform: 'uppercase' },
  detailValue: { fontSize: '14px', color: '#ccc' },
  emptyMsg: { textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' },
  badge: (status) => ({
    padding: '3px 12px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'approved' ? '#0a2a0a' : status === 'rejected' ? '#2a0a0a' : '#2a1a00',
    color: status === 'approved' ? '#4ade80' : status === 'rejected' ? '#ff6b6b' : '#e8590c',
    border: `1px solid ${status === 'approved' ? '#1a4a1a' : status === 'rejected' ? '#5a1a1a' : '#4a2a00'}`
  }),
  jobBadge: (status) => ({
    padding: '3px 12px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'active' ? '#0a1a2a' : status === 'complete' ? '#0a2a0a' : '#2a2a0a',
    color: status === 'active' ? '#60a5fa' : status === 'complete' ? '#4ade80' : '#facc15',
    border: `1px solid ${status === 'active' ? '#1a3a5a' : status === 'complete' ? '#1a4a1a' : '#4a4a0a'}`
  }),
  coiWarning: { background: '#2a1a00', border: '1px solid #4a3a00', borderRadius: '8px', padding: '12px 16px', fontSize: '13px', color: '#e8590c', marginBottom: '1rem' },
  formBox: { background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.5rem' },
  formTitle: { fontSize: '13px', fontWeight: '700', color: '#888', letterSpacing: '2px', textTransform: 'uppercase', marginTop: 0, marginBottom: '1rem' },
  applyLink: { background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  applyLinkText: { fontSize: '13px', color: '#888' },
  applyLinkUrl: { fontSize: '13px', color: '#e8590c', fontWeight: '600', cursor: 'pointer' },
  assignBox: { background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', marginTop: '1rem' },
  assignTitle: { fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginTop: 0, marginBottom: '0.75rem' },
  successInline: { fontSize: '12px', color: '#4ade80' },
  errorInline: { fontSize: '12px', color: '#ff6b6b' },
}

export default function Dashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [directory, setDirectory] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [expandedDir, setExpandedDir] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('billing')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterJob, setFilterJob] = useState('')
  const [filterTrade, setFilterTrade] = useState('')
  const [filterDirStatus, setFilterDirStatus] = useState('')
  const [searchDir, setSearchDir] = useState('')
  const [newJob, setNewJob] = useState({ job_number: '', project_name: '', location: '', contract_value: '', start_date: '', status: 'active' })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteJobId, setInviteJobId] = useState('')
  const [jobMsg, setJobMsg] = useState('')
  const [inviteMsg, setInviteMsg] = useState('')
  const [showInviteForm, setShowInviteForm] = useState(false)

  // Per-sub assign-to-job state
  const [assignTarget, setAssignTarget] = useState({}) // { [dirSubId]: jobId }
  const [assignMsg, setAssignMsg] = useState({})       // { [dirSubId]: { text, ok } }
  const [assigningId, setAssigningId] = useState(null)

  // Billing edit state
  const [editingBilling, setEditingBilling] = useState(null)
  const [editBillingForm, setEditBillingForm] = useState({})

  // Manual sub add state
  const [showAddSubManual, setShowAddSubManual] = useState(false)
  const [newSubManual, setNewSubManual] = useState({ company_name: '', contact_name: '', email: '', phone: '', address: '', trade: '', license_number: '', coi_expiration: '' })
  const [addingSubManual, setAddingSubManual] = useState(false)

  // Bid invites state
  const [bidPackages, setBidPackages] = useState([])
  const [expandedBid, setExpandedBid] = useState(null)
  const [showCreateBid, setShowCreateBid] = useState(false)
  const [bidForm, setBidForm] = useState({ title: '', description: '', scope_of_work: '', due_date: '', job_id: '' })
  const [creatingBid, setCreatingBid] = useState(false)
  const [bidDetails, setBidDetails] = useState({})
  const [uploadingPlanFor, setUploadingPlanFor] = useState(null)
  const [showInviteFor, setShowInviteFor] = useState(null)
  const [selectedEmails, setSelectedEmails] = useState([])
  const [sendingInvites, setSendingInvites] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (!prof || prof.role !== 'pm') { router.push('/submit'); return }
      setProfile(prof)
      await loadAll()
      setLoading(false)
    }
    load()
  }, [router])

  useEffect(() => {
    if (activeTab === 'bids') loadBidPackages()
  }, [activeTab])


  async function loadAll() {
    const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name)').order('submitted_at', { ascending: false })
    setSubmissions(subs || [])
    const { data: jobList } = await supabase.from('jobs').select('*').order('created_at', { ascending: false })
    setJobs(jobList || [])
    const { data: asgn } = await supabase.from('job_assignments').select('*, jobs(job_number, project_name)').order('invited_at', { ascending: false })
    setAssignments(asgn || [])
    const { data: dir } = await supabase.from('sub_directory').select('*').order('applied_at', { ascending: false })
    setDirectory(dir || [])
  }

  async function updateStatus(id, status) {
    await supabase.from('billing_submissions').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    await loadAll()
    setExpanded(null)
  }

  async function addSubManually(e) {
    e.preventDefault()
    setAddingSubManual(true)
    const { error } = await supabase.from('sub_directory').insert({
      company_name: newSubManual.company_name,
      contact_name: newSubManual.contact_name || null,
      email: newSubManual.email || null,
      phone: newSubManual.phone || null,
      address: newSubManual.address || null,
      trade: newSubManual.trade || null,
      license_number: newSubManual.license_number || null,
      coi_expiration: newSubManual.coi_expiration || null,
      status: 'approved',
      applied_at: new Date().toISOString(),
    })
    if (error) { setInviteMsg('Error: ' + error.message); setAddingSubManual(false); return }
    setShowAddSubManual(false)
    setNewSubManual({ company_name: '', contact_name: '', email: '', phone: '', address: '', trade: '', license_number: '', coi_expiration: '' })
    await loadAll()
    setAddingSubManual(false)
  }

  async function loadBidPackages() {
    const { data } = await supabase.from('bid_packages').select('*').order('created_at', { ascending: false })
    setBidPackages(data || [])
  }

  async function loadBidDetail(bidId) {
    const [{ data: plans }, { data: invites }, { data: subs }] = await Promise.all([
      supabase.from('bid_plans').select('*').eq('bid_package_id', bidId).order('uploaded_at'),
      supabase.from('bid_invitations').select('*').eq('bid_package_id', bidId).order('sent_at'),
      supabase.from('bid_submissions').select('*').eq('bid_package_id', bidId).order('submitted_at'),
    ])
    setBidDetails(prev => ({ ...prev, [bidId]: { plans: plans || [], invitations: invites || [], submissions: subs || [] } }))
  }

  async function createBidPackage(e) {
    e.preventDefault()
    setCreatingBid(true)
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('bid_packages').insert({
      title: bidForm.title,
      description: bidForm.description || null,
      scope_of_work: bidForm.scope_of_work || null,
      due_date: bidForm.due_date || null,
      job_id: bidForm.job_id || null,
      created_by: session.user.id,
      status: 'open',
    })
    if (!error) {
      setShowCreateBid(false)
      setBidForm({ title: '', description: '', scope_of_work: '', due_date: '', job_id: '' })
      await loadBidPackages()
    }
    setCreatingBid(false)
  }

  async function uploadPlan(bidId, file) {
    setUploadingPlanFor(bidId)
    const path = `${bidId}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('bid-plans').upload(path, file)
    if (!uploadError) {
      await supabase.from('bid_plans').insert({ bid_package_id: bidId, file_name: file.name, storage_path: path })
      await loadBidDetail(bidId)
    }
    setUploadingPlanFor(null)
  }

  async function openPlan(storagePath) {
    const { data } = await supabase.storage.from('bid-plans').createSignedUrl(storagePath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function inviteSubs(bidId) {
    if (selectedEmails.length === 0) return
    setSendingInvites(true)
    for (const email of selectedEmails) {
      await supabase.from('bid_invitations').upsert({ bid_package_id: bidId, sub_email: email }, { onConflict: 'bid_package_id,sub_email' })
    }
    setShowInviteFor(null)
    setSelectedEmails([])
    await loadBidDetail(bidId)
    setSendingInvites(false)
  }

  async function awardBid(submission, bidId) {
    if (!window.confirm(`Award this bid to ${submission.company_name} for $${Number(submission.amount).toLocaleString()}?`)) return
    await supabase.from('bid_submissions').update({ status: 'awarded' }).eq('id', submission.id)
    await supabase.from('bid_submissions').update({ status: 'rejected' }).eq('bid_package_id', bidId).neq('id', submission.id)
    await supabase.from('bid_packages').update({ status: 'awarded' }).eq('id', bidId)
    await loadBidPackages()
    await loadBidDetail(bidId)
  }

  async function setBidStatus(bidId, status) {
    await supabase.from('bid_packages').update({ status }).eq('id', bidId)
    await loadBidPackages()
  }

  async function deleteBidPackage(bidId) {
    if (!window.confirm('Delete this bid package and all its plans and bids?')) return
    await supabase.from('bid_packages').delete().eq('id', bidId)
    setExpandedBid(null)
    await loadBidPackages()
  }

  async function saveBillingEdit() {
    const now = new Date().toISOString()
    await supabase.from('billing_submissions').update({
      company_name: editBillingForm.company_name,
      contact_name: editBillingForm.contact_name || null,
      contact_info: editBillingForm.contact_info || null,
      amount_billed: parseFloat(editBillingForm.amount_billed),
      pct_complete: editBillingForm.pct_complete !== '' ? parseFloat(editBillingForm.pct_complete) : null,
      work_description: editBillingForm.work_description || null,
      status: editBillingForm.status,
      reviewed_at: editBillingForm.status !== 'pending' ? now : null,
    }).eq('id', editingBilling)
    setEditingBilling(null)
    await loadAll()
  }

  async function updateDirStatus(id, status) {
    await supabase.from('sub_directory').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    await loadAll()
  }

  async function deleteDirEntry(id) {
    if (!window.confirm('Are you sure you want to permanently delete this subcontractor?')) return
    const { error } = await supabase.from('sub_directory').delete().eq('id', id)
    if (error) { alert('Delete error: ' + error.message); return }
    setDirectory(prev => prev.filter(s => s.id !== id))
    setExpandedDir(null)
  }

  async function addJob(e) {
    e.preventDefault()
    const { data, error } = await supabase.from('jobs').insert({
      job_number: newJob.job_number, project_name: newJob.project_name,
      location: newJob.location || null, contract_value: newJob.contract_value ? parseFloat(newJob.contract_value) : null,
      start_date: newJob.start_date || null, status: newJob.status,
    }).select('id').single()
    if (error) { setJobMsg('Error: ' + error.message); return }
    router.push(`/jobdetail?id=${data.id}&tab=budget`)
  }

  async function inviteSub(e) {
    e.preventDefault()
    const { error } = await supabase.from('job_assignments').insert({ job_id: inviteJobId, sub_email: inviteEmail.toLowerCase().trim() })
    if (error) { setInviteMsg(error.code === '23505' ? 'Already invited to this job.' : 'Error: ' + error.message); return }
    await syncAssignments()
    setInviteEmail('')
    await loadAll()
  }

  async function syncAssignments() {
    const { error } = await supabase.rpc('sync_job_assignments')
    if (!error) {
      setInviteMsg('Invite sent and synced.')
      await loadAll()
      setTimeout(() => setInviteMsg(''), 3000)
    } else {
      setInviteMsg('Error syncing: ' + error.message)
    }
  }

  async function assignToJob(sub) {
    const jobId = assignTarget[sub.id]
    if (!jobId) return
    setAssigningId(sub.id)
    const { error } = await supabase.from('job_assignments').insert({
      job_id: jobId,
      sub_email: sub.email.toLowerCase().trim(),
    })
    if (error) {
      const text = error.code === '23505' ? 'Already assigned to this job.' : 'Error: ' + error.message
      setAssignMsg(prev => ({ ...prev, [sub.id]: { text, ok: false } }))
    } else {
      await supabase.rpc('sync_job_assignments')
      await loadAll()
      setAssignTarget(prev => ({ ...prev, [sub.id]: '' }))
      setAssignMsg(prev => ({ ...prev, [sub.id]: { text: 'Assigned — sub can now bill this job.', ok: true } }))
      setTimeout(() => setAssignMsg(prev => { const n = { ...prev }; delete n[sub.id]; return n }), 4000)
    }
    setAssigningId(null)
  }

  async function getDocUrl(path) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function openBillingDoc(path) {
    const { data } = await supabase.storage.from('billing-docs').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function openBidDoc(path) {
    const { data } = await supabase.storage.from('bid-docs').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#555' }}>Loading...</div>

  const filtered = submissions.filter(s => (!filterStatus || s.status === filterStatus) && (!filterJob || s.jobs?.job_number === filterJob))
  const pending = submissions.filter(s => s.status === 'pending')
  const totalThisWeek = submissions.filter(s => new Date(s.submitted_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).reduce((a, s) => a + (s.amount_billed || 0), 0)
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const expiringCOIs = directory.filter(s => s.status === 'approved' && s.coi_expiration && new Date(s.coi_expiration) < thirtyDaysFromNow)
  const filteredDir = directory.filter(s =>
    (!filterDirStatus || s.status === filterDirStatus) &&
    (!filterTrade || s.trade === filterTrade) &&
    (!searchDir || s.company_name.toLowerCase().includes(searchDir.toLowerCase()) || s.contact_name.toLowerCase().includes(searchDir.toLowerCase()))
  )
  const pendingApps = directory.filter(s => s.status === 'pending').length
  const activeJobs = jobs.filter(j => j.status === 'active')

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
            <div>
              <div style={s.logoName}>NV Construction</div>
              <div style={s.logoSub}>PM Dashboard</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '13px', color: '#555' }}>{profile?.full_name}</span>
            <button style={s.signOut} onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>Sign out</button>
          </div>
        </div>
      </header>

      <main style={s.main}>
        <div style={s.statsGrid}>
          <div style={s.statCard}>
            <div style={s.statLabel}>Pending billing</div>
            <div style={s.statValue('#e8590c')}>{pending.length}</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statLabel}>Billed this week</div>
            <div style={s.statValue()}>${totalThisWeek.toLocaleString()}</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statLabel}>Pending applications</div>
            <div style={s.statValue(pendingApps > 0 ? '#e8590c' : null)}>{pendingApps}</div>
          </div>
        </div>

        <div style={s.card}>
          <div style={s.tabs}>
            <button style={s.tab(activeTab === 'billing')} onClick={() => setActiveTab('billing')}>Billing</button>
            <button style={s.tab(activeTab === 'directory')} onClick={() => setActiveTab('directory')}>
              Sub directory{pendingApps > 0 ? ` (${pendingApps})` : ''}
            </button>
            <button style={s.tab(activeTab === 'jobs')} onClick={() => setActiveTab('jobs')}>Jobs</button>
            <button style={s.tab(activeTab === 'bids')} onClick={() => setActiveTab('bids')}>
              Bid Invites{bidPackages.filter(b => b.status === 'open').length > 0 ? ` (${bidPackages.filter(b => b.status === 'open').length} open)` : ''}
            </button>
          </div>

          <div style={s.cardBody}>

            {/* ── BILLING ── */}
            {activeTab === 'billing' && (
              <>
                <div style={s.filterRow}>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={s.filterSelect}>
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <select value={filterJob} onChange={e => setFilterJob(e.target.value)} style={s.filterSelect}>
                    <option value="">All jobs</option>
                    {jobs.map(j => <option key={j.id} value={j.job_number}>#{j.job_number} — {j.project_name}</option>)}
                  </select>
                </div>
                {filtered.length === 0 ? <div style={s.emptyMsg}>No submissions found.</div> : filtered.map(sub => (
                  <div key={sub.id} style={s.rowBorder}>
                    <div style={s.row} onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}>
                      <div><p style={s.company}>{sub.company_name}</p><p style={s.meta}>{new Date(sub.submitted_at).toLocaleDateString()} · {sub.contact_name}</p></div>
                      <div style={{ display: 'flex', alignItems: 'center', color: '#888', fontSize: '14px' }}>#{sub.jobs?.job_number}</div>
                      <div style={{ display: 'flex', alignItems: 'center', fontWeight: '700', fontSize: '15px', color: '#f1f1f1' }}>${sub.amount_billed?.toLocaleString()}</div>
                      <div style={{ display: 'flex', alignItems: 'center' }}><span style={s.badge(sub.status)}>{sub.status}</span></div>
                    </div>
                    {expanded === sub.id && (
                      <div style={s.detail}>
                        {editingBilling === sub.id ? (
                          <>
                            <p style={{ ...s.detailLabel, marginBottom: '1rem', fontSize: '12px' }}>Edit billing submission</p>
                            <div style={{ ...s.grid2, marginBottom: '12px' }}>
                              <div><label style={s.label}>Company name</label><input style={s.input} value={editBillingForm.company_name} onChange={e => setEditBillingForm(f => ({ ...f, company_name: e.target.value }))} /></div>
                              <div><label style={s.label}>Contact name</label><input style={s.input} value={editBillingForm.contact_name} onChange={e => setEditBillingForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
                            </div>
                            <div style={{ ...s.grid3, marginBottom: '12px' }}>
                              <div><label style={s.label}>Contact info</label><input style={s.input} value={editBillingForm.contact_info} onChange={e => setEditBillingForm(f => ({ ...f, contact_info: e.target.value }))} /></div>
                              <div><label style={s.label}>Amount ($)</label><input type="number" step="0.01" style={s.input} value={editBillingForm.amount_billed} onChange={e => setEditBillingForm(f => ({ ...f, amount_billed: e.target.value }))} /></div>
                              <div><label style={s.label}>% complete</label><input type="number" min="0" max="100" style={s.input} value={editBillingForm.pct_complete} onChange={e => setEditBillingForm(f => ({ ...f, pct_complete: e.target.value }))} /></div>
                            </div>
                            <div style={{ marginBottom: '12px' }}>
                              <label style={s.label}>Work description</label>
                              <textarea style={{ ...s.input, minHeight: '80px', resize: 'vertical' }} value={editBillingForm.work_description} onChange={e => setEditBillingForm(f => ({ ...f, work_description: e.target.value }))} />
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
                              <button onClick={saveBillingEdit} style={s.btnSm('orange')}>Save changes</button>
                              <button onClick={() => setEditingBilling(null)} style={s.btnSm('gray')}>Cancel</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={s.detailGrid}>
                              <div><div style={s.detailLabel}>Contact</div><div style={s.detailValue}>{sub.contact_name} · {sub.contact_info}</div></div>
                              <div><div style={s.detailLabel}>% complete</div><div style={s.detailValue}>{sub.pct_complete ?? '—'}%</div></div>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                              <div style={s.detailLabel}>Work description</div>
                              <div style={{ ...s.detailValue, lineHeight: '1.7' }}>{sub.work_description}</div>
                            </div>
                            {sub.doc_url && (
                              <div style={{ marginBottom: '1rem' }}>
                                <button onClick={() => openBillingDoc(sub.doc_url)} style={s.btnSm('gray')}>📎 View attachment</button>
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {sub.status === 'pending' && (
                                <>
                                  <button onClick={() => updateStatus(sub.id, 'approved')} style={s.btnSm('green')}>Approve</button>
                                  <button onClick={() => updateStatus(sub.id, 'rejected')} style={s.btnSm('red')}>Reject</button>
                                </>
                              )}
                              <button onClick={() => {
                                setEditingBilling(sub.id)
                                setEditBillingForm({
                                  company_name: sub.company_name || '',
                                  contact_name: sub.contact_name || '',
                                  contact_info: sub.contact_info || '',
                                  amount_billed: sub.amount_billed || '',
                                  pct_complete: sub.pct_complete ?? '',
                                  work_description: sub.work_description || '',
                                  status: sub.status,
                                })
                              }} style={s.btnSm('orange')}>Edit</button>
                            </div>
                            {sub.status !== 'pending' && <div style={{ ...s.meta, marginTop: '8px' }}>Reviewed {sub.reviewed_at ? new Date(sub.reviewed_at).toLocaleDateString() : '—'}</div>}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* ── DIRECTORY ── */}
            {activeTab === 'directory' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={s.applyLink}>
                    <span style={s.applyLinkText}>Share with subs to apply:</span>
                    <span style={{ ...s.applyLinkUrl, marginLeft: '12px' }} onClick={() => navigator.clipboard.writeText(window.location.origin + '/apply')} title="Click to copy">
                      {typeof window !== 'undefined' ? window.location.origin : ''}/apply ⧉
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btnSm('orange'), whiteSpace: 'nowrap' }} onClick={() => setShowAddSubManual(v => !v)}>
                      {showAddSubManual ? 'Cancel' : '+ Add subcontractor'}
                    </button>
                    <button style={{ ...s.btnSm('gray'), whiteSpace: 'nowrap' }} onClick={() => setShowInviteForm(v => !v)}>
                      {showInviteForm ? 'Cancel invite' : 'Invite by email'}
                    </button>
                  </div>
                </div>

                {showAddSubManual && (
                  <div style={s.formBox}>
                    <p style={s.formTitle}>Add subcontractor to directory</p>
                    <form onSubmit={addSubManually}>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div><label style={s.label}>Company name *</label><input style={s.input} value={newSubManual.company_name} onChange={e => setNewSubManual(f => ({ ...f, company_name: e.target.value }))} required placeholder="ABC Framing LLC" /></div>
                        <div><label style={s.label}>Contact name</label><input style={s.input} value={newSubManual.contact_name} onChange={e => setNewSubManual(f => ({ ...f, contact_name: e.target.value }))} placeholder="John Smith" /></div>
                      </div>
                      <div style={{ ...s.grid3, marginBottom: '12px' }}>
                        <div><label style={s.label}>Email</label><input type="email" style={s.input} value={newSubManual.email} onChange={e => setNewSubManual(f => ({ ...f, email: e.target.value }))} placeholder="john@abcframing.com" /></div>
                        <div><label style={s.label}>Phone</label><input style={s.input} value={newSubManual.phone} onChange={e => setNewSubManual(f => ({ ...f, phone: e.target.value }))} placeholder="555-0100" /></div>
                        <div><label style={s.label}>Address</label><input style={s.input} value={newSubManual.address} onChange={e => setNewSubManual(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St, City, TX" /></div>
                      </div>
                      <div style={{ ...s.grid3, marginBottom: '1.25rem' }}>
                        <div>
                          <label style={s.label}>Trade</label>
                          <select style={s.input} value={newSubManual.trade} onChange={e => setNewSubManual(f => ({ ...f, trade: e.target.value }))}>
                            <option value="">— Select trade —</option>
                            {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div><label style={s.label}>License number</label><input style={s.input} value={newSubManual.license_number} onChange={e => setNewSubManual(f => ({ ...f, license_number: e.target.value }))} placeholder="TX-12345" /></div>
                        <div><label style={s.label}>COI expiration</label><input type="date" style={s.input} value={newSubManual.coi_expiration} onChange={e => setNewSubManual(f => ({ ...f, coi_expiration: e.target.value }))} /></div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button type="submit" style={{ ...s.btn, opacity: addingSubManual ? 0.6 : 1 }} disabled={addingSubManual}>
                          {addingSubManual ? 'Saving...' : 'Add to directory'}
                        </button>
                        <button type="button" style={s.btnGray} onClick={() => setShowAddSubManual(false)}>Cancel</button>
                      </div>
                    </form>
                  </div>
                )}

                {showInviteForm && (
                  <div style={s.formBox}>
                    <p style={s.formTitle}>Invite subcontractor to a job</p>
                    <form onSubmit={inviteSub}>
                      <div style={{ ...s.grid2, marginBottom: '1.25rem' }}>
                        <div><label style={s.label}>Sub's email address</label><input type="email" style={s.input} value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required placeholder="sub@company.com" /></div>
                        <div>
                          <label style={s.label}>Job</label>
                          <select style={s.input} value={inviteJobId} onChange={e => setInviteJobId(e.target.value)} required>
                            <option value="">Select a job...</option>
                            {activeJobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button type="submit" style={s.btn}>Send invite</button>
                        <button type="button" onClick={syncAssignments} style={s.btnGray}>Sync all</button>
                        {inviteMsg && <span style={s.successInline}>{inviteMsg}</span>}
                      </div>
                    </form>
                  </div>
                )}

                {expiringCOIs.length > 0 && (
                  <div style={s.coiWarning}>
                    ⚠ {expiringCOIs.length} subcontractor{expiringCOIs.length > 1 ? 's have' : ' has'} a COI expiring within 30 days: {expiringCOIs.map(s => s.company_name).join(', ')}
                  </div>
                )}

                <div style={s.filterRow}>
                  <input style={s.filterInput} value={searchDir} onChange={e => setSearchDir(e.target.value)} placeholder="Search by company or contact..." />
                  <select value={filterDirStatus} onChange={e => setFilterDirStatus(e.target.value)} style={s.filterSelect}>
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <select value={filterTrade} onChange={e => setFilterTrade(e.target.value)} style={s.filterSelect}>
                    <option value="">All trades</option>
                    {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {filteredDir.length === 0 ? <div style={s.emptyMsg}>No subcontractors found.</div> : filteredDir.map(sub => (
                  <div key={sub.id} style={s.rowBorder}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 8px', cursor: 'pointer' }} onClick={() => setExpandedDir(expandedDir === sub.id ? null : sub.id)}>
                      <div>
                        <p style={s.company}>{sub.company_name}</p>
                        <p style={s.meta}>{sub.contact_name} · {sub.trade} · Applied {new Date(sub.applied_at).toLocaleDateString()}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {sub.coi_expiration && new Date(sub.coi_expiration) < thirtyDaysFromNow && (
                          <span style={{ fontSize: '11px', color: '#e8590c', fontWeight: '700' }}>COI EXPIRING</span>
                        )}
                        <span style={s.badge(sub.status)}>{sub.status}</span>
                      </div>
                    </div>
                    {expandedDir === sub.id && (
                      <div style={s.detail}>
                        <div style={{ ...s.detailGrid, marginBottom: '1rem' }}>
                          <div><div style={s.detailLabel}>Email</div><div style={s.detailValue}>{sub.email}</div></div>
                          <div><div style={s.detailLabel}>Phone</div><div style={s.detailValue}>{sub.phone || '—'}</div></div>
                          <div><div style={s.detailLabel}>Address</div><div style={s.detailValue}>{sub.address || '—'}</div></div>
                          <div><div style={s.detailLabel}>Trade</div><div style={s.detailValue}>{sub.trade || '—'}</div></div>
                          <div><div style={s.detailLabel}>COI expiration</div><div style={{ ...s.detailValue, color: sub.coi_expiration && new Date(sub.coi_expiration) < thirtyDaysFromNow ? '#e8590c' : '#ccc' }}>{sub.coi_expiration ? new Date(sub.coi_expiration).toLocaleDateString() : '—'}</div></div>
                          <div><div style={s.detailLabel}>License</div><div style={s.detailValue}>{sub.license_number || '—'}</div></div>
                        </div>
                        {sub.scope_description && (
                          <div style={{ marginBottom: '1rem' }}>
                            <div style={s.detailLabel}>Scope description</div>
                            <div style={{ ...s.detailValue, lineHeight: '1.7' }}>{sub.scope_description}</div>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '12px', marginBottom: '1rem', flexWrap: 'wrap' }}>
                          {sub.w9_url && <button onClick={() => getDocUrl(sub.w9_url)} style={s.btnSm('gray')}>View W-9</button>}
                          {sub.coi_url && <button onClick={() => getDocUrl(sub.coi_url)} style={s.btnSm('gray')}>View COI</button>}
                        </div>

                        {/* Assign to job */}
                        {sub.status === 'approved' && (
                          <div style={s.assignBox}>
                            <p style={s.assignTitle}>Assign to job</p>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <select
                                style={{ ...s.input, maxWidth: '280px' }}
                                value={assignTarget[sub.id] || ''}
                                onChange={e => setAssignTarget(prev => ({ ...prev, [sub.id]: e.target.value }))}
                              >
                                <option value="">Select a job...</option>
                                {activeJobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                              </select>
                              <button
                                style={{ ...s.btnSm('orange'), opacity: assigningId === sub.id ? 0.6 : 1 }}
                                disabled={assigningId === sub.id || !assignTarget[sub.id]}
                                onClick={() => assignToJob(sub)}
                              >
                                {assigningId === sub.id ? 'Assigning...' : 'Assign & enable billing'}
                              </button>
                              {assignMsg[sub.id] && (
                                <span style={assignMsg[sub.id].ok ? s.successInline : s.errorInline}>
                                  {assignMsg[sub.id].text}
                                </span>
                              )}
                            </div>
                            {assignments.filter(a => a.sub_email === sub.email).length > 0 && (
                              <div style={{ marginTop: '10px' }}>
                                <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Currently assigned to</div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                  {assignments.filter(a => a.sub_email === sub.email).map(a => (
                                    <span key={a.id} style={{ fontSize: '12px', color: '#888', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '3px 10px' }}>
                                      #{a.jobs?.job_number} — {a.jobs?.project_name}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div style={{ marginTop: '1rem' }}>
                          {sub.status === 'pending' && (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => updateDirStatus(sub.id, 'approved')} style={s.btnSm('green')}>Approve</button>
                              <button onClick={() => deleteDirEntry(sub.id)} style={s.btnSm('red')}>Delete application</button>
                            </div>
                          )}
                          {sub.status === 'approved' && (
                            <button onClick={() => deleteDirEntry(sub.id)} style={s.btnSm('red')}>Delete from directory</button>
                          )}
                          {sub.status === 'rejected' && (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => updateDirStatus(sub.id, 'approved')} style={s.btnSm('green')}>Re-approve</button>
                              <button onClick={() => deleteDirEntry(sub.id)} style={s.btnSm('red')}>Delete</button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* ── JOBS ── */}
            {activeTab === 'jobs' && (
              <>
                <div style={s.formBox}>
                  <p style={s.formTitle}>Add new job</p>
                  <form onSubmit={addJob}>
                    <div style={{ ...s.grid2, marginBottom: '12px' }}>
                      <div><label style={s.label}>Job number</label><input style={s.input} value={newJob.job_number} onChange={e => setNewJob(j => ({ ...j, job_number: e.target.value }))} required placeholder="7469" /></div>
                      <div><label style={s.label}>Project name</label><input style={s.input} value={newJob.project_name} onChange={e => setNewJob(j => ({ ...j, project_name: e.target.value }))} required placeholder="Braum's Lubbock" /></div>
                    </div>
                    <div style={{ ...s.grid3, marginBottom: '1.25rem' }}>
                      <div><label style={s.label}>Location</label><input style={s.input} value={newJob.location} onChange={e => setNewJob(j => ({ ...j, location: e.target.value }))} placeholder="Lubbock, TX" /></div>
                      <div><label style={s.label}>Contract value</label><input type="number" style={s.input} value={newJob.contract_value} onChange={e => setNewJob(j => ({ ...j, contract_value: e.target.value }))} placeholder="0.00" /></div>
                      <div><label style={s.label}>Start date</label><input type="date" style={s.input} value={newJob.start_date} onChange={e => setNewJob(j => ({ ...j, start_date: e.target.value }))} /></div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <button type="submit" style={s.btn}>Add job</button>
                      {jobMsg && <span style={s.successInline}>{jobMsg}</span>}
                    </div>
                  </form>
                </div>
                {jobs.length === 0 ? <div style={s.emptyMsg}>No jobs yet.</div> : jobs.map(j => (
                  <div key={j.id} onClick={() => router.push(`/jobdetail?id=${j.id}`)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 8px', borderBottom: '1px solid #1a1a1a', cursor: 'pointer', borderRadius: '8px' }}>
                    <div>
                      <p style={s.company}>#{j.job_number} — {j.project_name}</p>
                      <p style={s.meta}>{j.location}{j.contract_value ? ' · $' + parseFloat(j.contract_value).toLocaleString() : ''}{j.start_date ? ' · ' + new Date(j.start_date).toLocaleDateString() : ''}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={s.jobBadge(j.status)}>{j.status}</span>
                      <span style={{ color: '#555', fontSize: '18px' }}>›</span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* ── BID INVITES ── */}
            {activeTab === 'bids' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: '#555' }}>{bidPackages.length} package{bidPackages.length !== 1 ? 's' : ''} · {bidPackages.filter(b => b.status === 'open').length} open</p>
                  <button style={s.btnSm('orange')} onClick={() => setShowCreateBid(v => !v)}>
                    {showCreateBid ? 'Cancel' : '+ New bid package'}
                  </button>
                </div>

                {showCreateBid && (
                  <div style={s.formBox}>
                    <p style={s.formTitle}>Create bid package</p>
                    <form onSubmit={createBidPackage}>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div><label style={s.label}>Package title *</label><input style={s.input} value={bidForm.title} onChange={e => setBidForm(f => ({ ...f, title: e.target.value }))} required placeholder="Unit 4 Kitchen Remodel" /></div>
                        <div><label style={s.label}>Bid due date</label><input type="date" style={s.input} value={bidForm.due_date} onChange={e => setBidForm(f => ({ ...f, due_date: e.target.value }))} /></div>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={s.label}>Link to job (optional)</label>
                        <select style={s.input} value={bidForm.job_id} onChange={e => setBidForm(f => ({ ...f, job_id: e.target.value }))}>
                          <option value="">— No job linked —</option>
                          {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={s.label}>Description</label>
                        <input style={s.input} value={bidForm.description} onChange={e => setBidForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief summary of the bid package" />
                      </div>
                      <div style={{ marginBottom: '1.25rem' }}>
                        <label style={s.label}>Scope of work</label>
                        <textarea style={{ ...s.input, minHeight: '100px', resize: 'vertical' }} value={bidForm.scope_of_work} onChange={e => setBidForm(f => ({ ...f, scope_of_work: e.target.value }))} placeholder="Full scope of work for bidders to review..." />
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="submit" style={{ ...s.btn, opacity: creatingBid ? 0.6 : 1 }} disabled={creatingBid}>{creatingBid ? 'Creating...' : 'Create package'}</button>
                        <button type="button" style={s.btnGray} onClick={() => setShowCreateBid(false)}>Cancel</button>
                      </div>
                    </form>
                  </div>
                )}

                {bidPackages.length === 0 && !showCreateBid && <div style={s.emptyMsg}>No bid packages yet. Create one to start inviting subs.</div>}

                {bidPackages.map(pkg => {
                  const isExp = expandedBid === pkg.id
                  const det = bidDetails[pkg.id] || {}
                  const plans = det.plans || []
                  const invitations = det.invitations || []
                  const submissions = det.submissions || []
                  const bidStatusColor = pkg.status === 'awarded' ? 'approved' : pkg.status === 'closed' ? 'rejected' : 'pending'
                  const approvedDir = directory.filter(d => d.status === 'approved')
                  const uninvited = approvedDir.filter(d => !invitations.some(i => i.sub_email === d.email))

                  return (
                    <div key={pkg.id} style={{ border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f', cursor: 'pointer' }}
                        onClick={() => { if (isExp) { setExpandedBid(null) } else { setExpandedBid(pkg.id); loadBidDetail(pkg.id) } }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                            <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{pkg.title}</span>
                            <span style={s.badge(bidStatusColor)}>{pkg.status}</span>
                            {pkg.job_id && <span style={{ fontSize: '11px', color: '#60a5fa', background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: '4px', padding: '2px 8px' }}>linked to job</span>}
                          </div>
                          <div style={{ fontSize: '12px', color: '#555' }}>
                            {pkg.due_date ? `Due ${new Date(pkg.due_date + 'T00:00:00').toLocaleDateString()}` : 'No due date'}
                            {invitations.length > 0 && ` · ${invitations.length} invited`}
                            {submissions.length > 0 && ` · ${submissions.length} bid${submissions.length !== 1 ? 's' : ''} received`}
                          </div>
                        </div>
                        <span style={{ color: '#555', fontSize: '16px' }}>{isExp ? '▲' : '▼'}</span>
                      </div>

                      {isExp && (
                        <div style={{ borderTop: '1px solid #1e1e1e', padding: '1.25rem', background: '#080808' }}>
                          {pkg.description && <p style={{ fontSize: '13px', color: '#888', margin: '0 0 1rem' }}>{pkg.description}</p>}
                          {pkg.scope_of_work && (
                            <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '1rem', marginBottom: '1.25rem' }}>
                              <div style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px' }}>Scope of work</div>
                              <div style={{ fontSize: '13px', color: '#aaa', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>{pkg.scope_of_work}</div>
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                            {pkg.status === 'open' && <button style={s.btnSm('gray')} onClick={() => setBidStatus(pkg.id, 'closed')}>Close bidding</button>}
                            {pkg.status === 'closed' && <button style={s.btnSm('orange')} onClick={() => setBidStatus(pkg.id, 'open')}>Re-open</button>}
                            <button style={s.btnSm('red')} onClick={() => deleteBidPackage(pkg.id)}>Delete package</button>
                          </div>

                          {/* Plans */}
                          <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                              <span style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Plans & documents ({plans.length})</span>
                              <label style={{ ...s.btnSm('orange'), cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                                {uploadingPlanFor === pkg.id ? 'Uploading...' : '+ Upload'}
                                <input type="file" accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.xlsx,.docx" style={{ display: 'none' }}
                                  disabled={uploadingPlanFor === pkg.id}
                                  onChange={e => e.target.files[0] && uploadPlan(pkg.id, e.target.files[0])} />
                              </label>
                            </div>
                            {plans.length === 0 ? <p style={{ fontSize: '13px', color: '#444' }}>No plans uploaded yet.</p> : plans.map(plan => (
                              <div key={plan.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#0f0f0f', borderRadius: '6px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '13px', color: '#ccc' }}>📄 {plan.file_name}</span>
                                <button style={s.btnSm('gray')} onClick={() => openPlan(plan.storage_path)}>Open</button>
                              </div>
                            ))}
                          </div>

                          {/* Invitations */}
                          <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                              <span style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Invited subs ({invitations.length})</span>
                              {showInviteFor !== pkg.id && pkg.status === 'open' && (
                                <button style={s.btnSm('orange')} onClick={() => { setShowInviteFor(pkg.id); setSelectedEmails([]) }}>+ Invite subs</button>
                              )}
                            </div>

                            {showInviteFor === pkg.id && (
                              <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '1rem', marginBottom: '0.75rem' }}>
                                <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 0.75rem' }}>
                                  Select from approved directory
                                </p>
                                {uninvited.length === 0 ? <p style={{ fontSize: '13px', color: '#444', margin: '0 0 0.75rem' }}>All directory subs have already been invited.</p> : (
                                  <div style={{ maxHeight: '220px', overflowY: 'auto', marginBottom: '0.75rem' }}>
                                    {uninvited.map(sub => (
                                      <label key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', cursor: 'pointer', borderBottom: '1px solid #1a1a1a' }}>
                                        <input type="checkbox" checked={selectedEmails.includes(sub.email)}
                                          onChange={e => setSelectedEmails(prev => e.target.checked ? [...prev, sub.email] : prev.filter(em => em !== sub.email))}
                                          style={{ accentColor: '#e8590c', width: '16px', height: '16px' }} />
                                        <span style={{ fontSize: '13px', color: '#f1f1f1', fontWeight: '600' }}>{sub.company_name}</span>
                                        {sub.trade && <span style={{ fontSize: '11px', color: '#555' }}>{sub.trade}</span>}
                                        {sub.email && <span style={{ fontSize: '11px', color: '#444' }}>{sub.email}</span>}
                                      </label>
                                    ))}
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button style={{ ...s.btnSm('orange'), opacity: sendingInvites || selectedEmails.length === 0 ? 0.6 : 1 }}
                                    disabled={sendingInvites || selectedEmails.length === 0}
                                    onClick={() => inviteSubs(pkg.id)}>
                                    {sendingInvites ? 'Sending...' : `Send ${selectedEmails.length > 0 ? selectedEmails.length + ' ' : ''}invite${selectedEmails.length !== 1 ? 's' : ''}`}
                                  </button>
                                  <button style={s.btnSm('gray')} onClick={() => setShowInviteFor(null)}>Cancel</button>
                                </div>
                              </div>
                            )}

                            {invitations.map(inv => {
                              const subEntry = directory.find(d => d.email === inv.sub_email)
                              const invBadge = inv.status === 'submitted' ? 'approved' : inv.status === 'declined' ? 'rejected' : 'pending'
                              return (
                                <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#0f0f0f', borderRadius: '6px', marginBottom: '4px' }}>
                                  <span style={{ fontSize: '13px', color: '#ccc', fontWeight: '600' }}>{subEntry?.company_name || inv.sub_email}</span>
                                  <span style={s.badge(invBadge)}>{inv.status}</span>
                                </div>
                              )
                            })}
                          </div>

                          {/* Submitted bids */}
                          <div>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block', marginBottom: '0.75rem' }}>Submitted bids ({submissions.length})</span>
                            {submissions.length === 0 ? <p style={{ fontSize: '13px', color: '#444' }}>No bids submitted yet.</p> : submissions.map(sub => (
                              <div key={sub.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#0f0f0f', borderRadius: '8px', marginBottom: '6px', flexWrap: 'wrap', gap: '12px', border: sub.status === 'awarded' ? '1px solid #1a4a1a' : '1px solid transparent' }}>
                                <div style={{ flex: 1, minWidth: '180px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                                    <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{sub.company_name}</span>
                                    <span style={s.badge(sub.status === 'awarded' ? 'approved' : sub.status === 'rejected' ? 'rejected' : 'pending')}>{sub.status}</span>
                                  </div>
                                  {sub.notes && <p style={{ fontSize: '12px', color: '#888', margin: '0', lineHeight: '1.5' }}>{sub.notes}</p>}
                                  <span style={{ fontSize: '11px', color: '#444' }}>{new Date(sub.submitted_at).toLocaleDateString()}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                  <span style={{ fontSize: '20px', fontWeight: '800', color: sub.status === 'awarded' ? '#4ade80' : '#f1f1f1' }}>${Number(sub.amount).toLocaleString()}</span>
                                  {sub.doc_url && (
                                    <button style={s.btnSm('gray')} onClick={() => openBidDoc(sub.doc_url)}>📎 Estimate</button>
                                  )}
                                  {sub.status === 'pending' && pkg.status !== 'awarded' && (
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <button style={s.btnSm('green')} onClick={() => awardBid(sub, pkg.id)}>Award</button>
                                      <button style={s.btnSm('red')} onClick={async () => { await supabase.from('bid_submissions').update({ status: 'rejected' }).eq('id', sub.id); loadBidDetail(pkg.id) }}>Pass</button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}

          </div>
        </div>
      </main>
    </div>
  )
}
