'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { sendEmail, emailWrap } from '../../lib/email'

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
  roleBadge: (role) => ({
    padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: role === 'pm' ? '#1a0a2a' : role === 'apm' ? '#0a1a2a' : role === 'super' ? '#0a2a1a' : '#2a1a00',
    color: role === 'pm' ? '#c084fc' : role === 'apm' ? '#60a5fa' : role === 'super' ? '#4ade80' : '#e8590c',
    border: `1px solid ${role === 'pm' ? '#3a1a5a' : role === 'apm' ? '#1a3a5a' : role === 'super' ? '#1a4a2a' : '#4a2a00'}`
  }),
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
  const [activeTab, setActiveTab] = useState('jobs')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterJob, setFilterJob] = useState('')
  const [filterTrade, setFilterTrade] = useState('')
  const [filterDirStatus, setFilterDirStatus] = useState('')
  const [searchDir, setSearchDir] = useState('')
  const [newJob, setNewJob] = useState({ job_number: '', project_name: '', start_date: '', sub_billing_start: '', sub_billing_frequency: 'monthly', sub_billing_due: '', sub_billing_anchor: '', owner_billing_start: '', owner_billing_frequency: 'monthly', owner_billing_due: '', owner_billing_anchor: '' })
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() } })
  const [showNewJobForm, setShowNewJobForm] = useState(false)
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
  const [notifySubId, setNotifySubId] = useState(null)
  const [notifySubject, setNotifySubject] = useState('')
  const [notifyMessage, setNotifyMessage] = useState('')
  const [sendingNotify, setSendingNotify] = useState(false)
  const [notifyResult, setNotifyResult] = useState({})
  const [newSubManual, setNewSubManual] = useState({ company_name: '', contact_name: '', email: '', phone: '', address: '', trade: '', license_number: '', coi_expiration: '' })
  const [addingSubManual, setAddingSubManual] = useState(false)

  // Sub directory edit state
  const [editingSubId, setEditingSubId] = useState(null)
  const [editSubForm, setEditSubForm] = useState({})
  const [savingSubEdit, setSavingSubEdit] = useState(false)
  const [subEditMsg, setSubEditMsg] = useState(null)

  // Bid invites state
  const [bidPackages, setBidPackages] = useState([])
  const [expandedBid, setExpandedBid] = useState(null)
  const [showCreateBid, setShowCreateBid] = useState(false)
  const [bidForm, setBidForm] = useState({ title: '', description: '', scope_of_work: '', due_date: '', job_id: '' })
  const [creatingBid, setCreatingBid] = useState(false)
  const [bidDetails, setBidDetails] = useState({})
  const [editingBidId, setEditingBidId] = useState(null)
  const [editBidDueDate, setEditBidDueDate] = useState('')
  const [uploadingPlanFor, setUploadingPlanFor] = useState(null)
  const [uploadingW9For, setUploadingW9For] = useState(null)
  const [uploadingCoiFor, setUploadingCoiFor] = useState(null)
  const [requestingDoc, setRequestingDoc] = useState(null)
  const [docRequestSent, setDocRequestSent] = useState({})
  const [showInviteFor, setShowInviteFor] = useState(null)
  const [selectedEmails, setSelectedEmails] = useState([])
  const [sendingInvites, setSendingInvites] = useState(false)
  const [showManualBidFor, setShowManualBidFor] = useState(null)
  const [manualBidForm, setManualBidForm] = useState({ company_name: '', amount: '', notes: '' })
  const [manualBidFile, setManualBidFile] = useState(null)
  const [showBidCompare, setShowBidCompare] = useState(null)
  const [submittingManualBid, setSubmittingManualBid] = useState(false)

  // Role / APM filtering
  const [assignedJobIds, setAssignedJobIds] = useState(null) // null = no filter (PM), array = APM filter

  // NV Directory state
  const [teamMembers, setTeamMembers] = useState([])
  const [pmJobAssigns, setPmJobAssigns] = useState([])
  const [teamExpandedId, setTeamExpandedId] = useState(null)
  const [teamAssignTarget, setTeamAssignTarget] = useState({})
  const [teamAssignMsg, setTeamAssignMsg] = useState({})
  const [teamAssigningId, setTeamAssigningId] = useState(null)
  const [updatingRoleId, setUpdatingRoleId] = useState(null)
  const [roleMsg, setRoleMsg] = useState({})
  const [editingTeamId, setEditingTeamId] = useState(null)
  const [editTeamForm, setEditTeamForm] = useState({})
  const [savingTeamEdit, setSavingTeamEdit] = useState(false)
  const [teamEditMsg, setTeamEditMsg] = useState(null)
  const [showTeamInviteForm, setShowTeamInviteForm] = useState(false)
  const [teamInviteForm, setTeamInviteForm] = useState({ email: '', full_name: '', role: 'apm', phone: '' })
  const [teamInviting, setTeamInviting] = useState(false)
  const [teamInviteMsg, setTeamInviteMsg] = useState(null)

  // Estimates state
  const [estimates, setEstimates] = useState([])
  const [expandedEstimate, setExpandedEstimate] = useState(null)
  const [showNewEstimate, setShowNewEstimate] = useState(false)
  const [estimateForm, setEstimateForm] = useState({ project_name: '', address: '', owner_name: '', owner_company: '', owner_email: '', owner_phone: '', notes: '' })
  const [estimateLines, setEstimateLines] = useState([{ description: '', amount: '' }])
  const [savingEstimate, setSavingEstimate] = useState(false)
  const [editingEstimate, setEditingEstimate] = useState(null)
  const [editEstimateForm, setEditEstimateForm] = useState({})
  const [editEstimateLines, setEditEstimateLines] = useState([])
  const [savingEstimateEdit, setSavingEstimateEdit] = useState(false)
  const [estimatorInnerTab, setEstimatorInnerTab] = useState('estimates')
  const [convertingEst, setConvertingEst] = useState(null)
  const [convertJobForm, setConvertJobForm] = useState({ job_number: '', start_date: '' })
  const [convertingJob, setConvertingJob] = useState(false)
  const [uploadingEstDoc, setUploadingEstDoc] = useState(null)
  const [estDocs, setEstDocs] = useState({})

  // Business Development state
  const [bdBidPackages, setBdBidPackages] = useState([])
  const [bdOpportunities, setBdOpportunities] = useState([])
  const [bdGoals, setBdGoals] = useState([])
  const [bdYear, setBdYear] = useState(new Date().getFullYear())
  const [bdFilterStage, setBdFilterStage] = useState('all')
  const [showAddBd, setShowAddBd] = useState(false)
  const [addBdForm, setAddBdForm] = useState({ project_name: '', client_name: '', stage: 'prospect', bid_amount: '', contract_value: '', bid_date: '', trade_type: '', notes: '' })
  const [savingBd, setSavingBd] = useState(false)
  const [expandedBd, setExpandedBd] = useState(null)
  const [editingBdId, setEditingBdId] = useState(null)
  const [editBdForm, setEditBdForm] = useState({})
  const [savingBdEdit, setSavingBdEdit] = useState(false)
  const [bdMsg, setBdMsg] = useState(null)
  const [bdGoalInput, setBdGoalInput] = useState('')
  const [savingBdGoal, setSavingBdGoal] = useState(false)
  const [bdLoaded, setBdLoaded] = useState(false)
  const [bdProfits, setBdProfits] = useState({})

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (!prof) { router.push('/login'); return }
      if (prof.role === 'super') { router.push('/field'); return }
      if (prof.role !== 'pm' && prof.role !== 'apm') { router.push('/submit'); return }
      setProfile(prof)
      let jobIds = null
      if (prof.role === 'apm') {
        const { data: assigns } = await supabase.from('pm_job_assignments').select('job_id').eq('user_id', session.user.id)
        jobIds = (assigns || []).map(a => a.job_id)
        setAssignedJobIds(jobIds)
      }
      await loadAll(jobIds)
      setLoading(false)
    }
    load()

    async function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (prof?.role === 'apm') {
        const { data: assigns } = await supabase.from('pm_job_assignments').select('job_id').eq('user_id', session.user.id)
        const jobIds = (assigns || []).map(a => a.job_id)
        setAssignedJobIds(jobIds)
        await loadAll(jobIds)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [router])

  useEffect(() => {
    if (activeTab === 'estimator') { loadEstimates(); loadBidPackages(assignedJobIds) }
    if (activeTab === 'nv-directory') loadTeamData()
    if (activeTab === 'bd' && !bdLoaded) loadBD()
  }, [activeTab])


  async function loadAll(jobIds = null) {
    const ids = jobIds !== undefined ? jobIds : assignedJobIds
    let billingQ = supabase.from('billing_submissions').select('*, jobs(job_number, project_name)').order('submitted_at', { ascending: false })
    let jobsQ = supabase.from('jobs').select('*').order('created_at', { ascending: false })
    let asgnQ = supabase.from('job_assignments').select('*, jobs(job_number, project_name)').order('invited_at', { ascending: false })
    if (ids !== null && ids.length > 0) {
      billingQ = billingQ.in('job_id', ids)
      jobsQ = jobsQ.in('id', ids)
      asgnQ = asgnQ.in('job_id', ids)
    } else if (ids !== null && ids.length === 0) {
      setSubmissions([]); setJobs([]); setAssignments([])
      const { data: dir } = await supabase.from('sub_directory').select('*').order('applied_at', { ascending: false })
      setDirectory(dir || [])
      return
    }
    const { data: subs } = await billingQ
    setSubmissions(subs || [])
    const { data: jobList } = await jobsQ
    setJobs(jobList || [])
    const { data: asgn } = await asgnQ
    setAssignments(asgn || [])
    const { data: dir } = await supabase.from('sub_directory').select('*').order('applied_at', { ascending: false })
    setDirectory(dir || [])
  }

  async function updateStatus(sub, status) {
    await supabase.from('billing_submissions').update({ status, reviewed_at: new Date().toISOString() }).eq('id', sub.id)
    if (sub.sub_email) {
      const approved = status === 'approved'
      const color = approved ? '#4ade80' : '#ff6b6b'
      sendEmail(sub.sub_email, `Billing ${status} — ${sub.jobs?.project_name}`,
        emailWrap(`
          <h2 style="color:${color};margin:0 0 1rem">Billing ${status}</h2>
          <p style="color:#aaa">Your billing submission of <strong style="color:#f1f1f1">$${sub.amount_billed?.toLocaleString()}</strong> for <strong style="color:#f1f1f1">#${sub.jobs?.job_number} — ${sub.jobs?.project_name}</strong> has been <strong style="color:${color}">${status}</strong>.</p>
          ${!approved ? `<p style="color:#888;font-size:13px">Contact NV Construction if you have questions.</p>` : ''}
        `)
      )
    }
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

  async function loadBidPackages(jobIds = null) {
    const { data: { session } } = await supabase.auth.getSession()
    if (profile?.role === 'apm') {
      const { data } = await supabase.from('bid_packages').select('*').contains('allowed_users', [session.user.id]).order('created_at', { ascending: false })
      setBidPackages(data || [])
      return
    }
    const ids = jobIds !== undefined ? jobIds : assignedJobIds
    let q = supabase.from('bid_packages').select('*').order('created_at', { ascending: false })
    if (ids !== null && ids.length > 0) q = q.in('job_id', ids)
    else if (ids !== null && ids.length === 0) { setBidPackages([]); return }
    const { data } = await q
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

  async function toggleEstimateAccess(estId, userId) {
    const est = estimates.find(e => e.id === estId)
    const current = est?.allowed_users || []
    const updated = current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId]
    await supabase.from('estimates').update({ allowed_users: updated }).eq('id', estId)
    setEstimates(prev => prev.map(e => e.id === estId ? { ...e, allowed_users: updated } : e))
  }

  async function toggleBidAccess(bidId, userId) {
    const pkg = bidPackages.find(b => b.id === bidId)
    const current = pkg?.allowed_users || []
    const updated = current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId]
    await supabase.from('bid_packages').update({ allowed_users: updated }).eq('id', bidId)
    setBidPackages(prev => prev.map(b => b.id === bidId ? { ...b, allowed_users: updated } : b))
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
      if (bdLoaded) loadBD()
    }
    setCreatingBid(false)
  }

  async function uploadPlan(bidId, file) {
    setUploadingPlanFor(bidId)
    const path = `${bidId}/${Date.now()}-${file.name}`
    // Get signed upload URL via service role
    const urlRes = await fetch('/api/bid-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload-url', path }) })
    const urlData = await urlRes.json()
    if (urlData.error) { alert('Upload error: ' + urlData.error); setUploadingPlanFor(null); return }
    // Upload directly to signed URL
    const uploadRes = await fetch(urlData.signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
    if (!uploadRes.ok) { alert('Upload failed — please try again'); setUploadingPlanFor(null); return }
    // Insert record
    const insertRes = await fetch('/api/bid-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'insert', bid_package_id: bidId, file_name: file.name, storage_path: path }) })
    const insertData = await insertRes.json()
    if (insertData.error) { alert('Upload error: ' + insertData.error); setUploadingPlanFor(null); return }
    await loadBidDetail(bidId)
    setUploadingPlanFor(null)
  }

  async function openPlan(storagePath) {
    const res = await fetch('/api/bid-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signed-url', path: storagePath }) })
    const data = await res.json()
    if (data.url) window.open(data.url, '_blank')
  }

  async function deletePlan(plan, bidId) {
    if (!window.confirm(`Delete "${plan.file_name}"? This cannot be undone.`)) return
    await fetch('/api/bid-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', path: plan.storage_path }) })
    await loadBidDetail(bidId)
  }

  async function uninviteSub(invitationId, bidId) {
    await supabase.from('bid_invitations').delete().eq('id', invitationId)
    await loadBidDetail(bidId)
  }

  async function inviteSubs(bidId, pkg) {
    if (selectedEmails.length === 0) return
    setSendingInvites(true)
    for (const email of selectedEmails) {
      await supabase.from('bid_invitations').upsert({ bid_package_id: bidId, sub_email: email }, { onConflict: 'bid_package_id,sub_email' })
      sendEmail(email, `You're invited to bid — ${pkg.title}`,
        emailWrap(`
          <h2 style="color:#f1f1f1;margin:0 0 1rem">Bid invitation</h2>
          <p style="color:#aaa">NV Construction has invited you to submit a bid for <strong style="color:#f1f1f1">${pkg.title}</strong>.</p>
          ${pkg.due_date ? `<p style="color:#888;font-size:13px">Bids due: <strong style="color:#f1f1f1">${new Date(pkg.due_date + 'T00:00:00').toLocaleDateString()}</strong></p>` : ''}
          ${pkg.scope_of_work ? `<div style="background:#111;border:1px solid #222;border-radius:8px;padding:1rem;margin:1rem 0"><p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Scope of work</p><p style="color:#aaa;font-size:13px;line-height:1.6;margin:0">${pkg.scope_of_work}</p></div>` : ''}
          <p style="color:#888;font-size:13px;margin:1rem 0">Log in to the sub portal to view plans and submit your bid:</p>
          <a href="${process.env.NEXT_PUBLIC_SITE_URL}/submit" style="display:inline-block;padding:12px 28px;background:#e8590c;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:1px">Open Sub Portal</a>
        `)
      )
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
    const pkg = bidPackages.find(p => p.id === bidId)
    if (submission.sub_email) {
      sendEmail(submission.sub_email, `Your bid has been awarded — ${pkg?.title || 'Bid Package'}`,
        emailWrap(`
          <h2 style="color:#4ade80;margin:0 0 1rem">Congratulations!</h2>
          <p style="color:#aaa">Your bid of <strong style="color:#f1f1f1">$${Number(submission.amount).toLocaleString()}</strong> for <strong style="color:#f1f1f1">${pkg?.title || 'Bid Package'}</strong> has been awarded.</p>
          <p style="color:#888;font-size:13px">NV Construction will be in touch with next steps.</p>
        `)
      )
    }
    await loadBidPackages()
    await loadBidDetail(bidId)
  }

  async function submitManualBid(pkgId) {
    if (!manualBidForm.company_name || !manualBidForm.amount) return
    setSubmittingManualBid(true)
    let doc_url = null
    if (manualBidFile) {
      const path = `${pkgId}/manual-${Date.now()}-${manualBidFile.name}`
      const { error: upErr } = await supabase.storage.from('bid-docs').upload(path, manualBidFile)
      if (!upErr) doc_url = path
    }
    await supabase.from('bid_submissions').insert({
      bid_package_id: pkgId,
      sub_id: null,
      sub_email: manualBidForm.company_name,
      company_name: manualBidForm.company_name,
      amount: parseFloat(manualBidForm.amount),
      notes: manualBidForm.notes || null,
      doc_url,
    })
    setManualBidForm({ company_name: '', amount: '', notes: '' })
    setManualBidFile(null)
    setShowManualBidFor(null)
    setSubmittingManualBid(false)
    await loadBidDetail(pkgId)
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

  async function saveBidDueDate(bidId) {
    await supabase.from('bid_packages').update({ due_date: editBidDueDate || null }).eq('id', bidId)
    setBidPackages(prev => prev.map(p => p.id === bidId ? { ...p, due_date: editBidDueDate || null } : p))
    setEditingBidId(null)
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
    if (!window.confirm('Are you sure you want to permanently delete this subcontractor? This will also revoke their portal access.')) return
    const res = await fetch('/api/delete-sub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory_id: id }) })
    const json = await res.json()
    if (!res.ok) { alert('Delete error: ' + json.error); return }
    setDirectory(prev => prev.filter(s => s.id !== id))
    setExpandedDir(null)
  }

  async function saveSubEdit(id) {
    setSavingSubEdit(true)
    setSubEditMsg(null)
    const res = await fetch('/api/sub-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory_id: id, ...editSubForm }),
    })
    const data = await res.json()
    if (data.error) {
      setSubEditMsg({ ok: false, text: 'Error: ' + data.error })
    } else {
      setSubEditMsg({ ok: true, text: 'Saved.' })
      setEditingSubId(null)
      await loadAll()
      setTimeout(() => setSubEditMsg(null), 3000)
    }
    setSavingSubEdit(false)
  }

  async function sendNotification(sub) {
    if (!notifySubject.trim() || !notifyMessage.trim()) return
    setSendingNotify(true)
    const res = await fetch('/api/notify-sub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_email: sub.email, to_name: sub.contact_name || sub.company_name, company_name: sub.company_name, subject: notifySubject, message: notifyMessage }),
    })
    setSendingNotify(false)
    if (res.ok) {
      setNotifyResult(prev => ({ ...prev, [sub.id]: { ok: true, text: 'Sent!' } }))
      setNotifySubject('')
      setNotifyMessage('')
      setNotifySubId(null)
    } else {
      setNotifyResult(prev => ({ ...prev, [sub.id]: { ok: false, text: 'Failed to send.' } }))
    }
    setTimeout(() => setNotifyResult(prev => { const n = { ...prev }; delete n[sub.id]; return n }), 4000)
  }

  async function addJob(e) {
    e.preventDefault()
    const { data, error } = await supabase.from('jobs').insert({
      job_number: newJob.job_number,
      project_name: newJob.project_name,
      status: 'active',
      start_date: newJob.start_date || null,
      sub_billing_start: newJob.sub_billing_start || null,
      sub_billing_frequency: newJob.sub_billing_frequency || 'monthly',
      sub_billing_due: newJob.sub_billing_due ? parseInt(newJob.sub_billing_due) : null,
      sub_billing_anchor: newJob.sub_billing_anchor || null,
      owner_billing_start: newJob.owner_billing_start || null,
      owner_billing_frequency: newJob.owner_billing_frequency || 'monthly',
      owner_billing_due: newJob.owner_billing_due ? parseInt(newJob.owner_billing_due) : null,
      owner_billing_anchor: newJob.owner_billing_anchor || null,
    }).select('id').single()
    if (error) { setJobMsg('Error: ' + error.message); return }
    router.push(`/jobdetail?id=${data.id}`)
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

  async function getDocUrl(filePath) {
    const res = await fetch('/api/sub-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signed-url', file_path: filePath }) })
    const data = await res.json()
    if (data?.url) window.open(data.url, '_blank')
  }

  async function downloadDoc(filePath, fileName) {
    const res = await fetch('/api/sub-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signed-url', file_path: filePath, download: true }) })
    const data = await res.json()
    if (data?.url) {
      const a = document.createElement('a'); a.href = data.url; a.download = fileName || 'document'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    }
  }

  async function uploadSubDoc(dirId, type, file) {
    if (type === 'w9') setUploadingW9For(dirId)
    else setUploadingCoiFor(dirId)
    const ext = file.name.split('.').pop()
    const path = `${dirId}/${type}-${Date.now()}.${ext}`
    const urlRes = await fetch('/api/sub-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload-url', path }) })
    const { signedUrl, error: urlErr } = await urlRes.json()
    if (urlErr) { alert('Upload error: ' + urlErr); setUploadingW9For(null); setUploadingCoiFor(null); return }
    await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
    const field = type === 'w9' ? 'w9_url' : 'coi_url'
    await fetch('/api/sub-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory_id: dirId, [field]: path }) })
    if (type === 'w9') setUploadingW9For(null)
    else setUploadingCoiFor(null)
    const { data } = await supabase.from('sub_directory').select('*').order('company_name')
    setDirectory(data || [])
  }

  async function sendDocRequest(dirId, type) {
    const key = `${dirId}-${type}`
    setRequestingDoc(key)
    const res = await fetch('/api/doc-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory_id: dirId, type }) })
    const data = await res.json()
    setRequestingDoc(null)
    if (data?.ok) setDocRequestSent(prev => ({ ...prev, [key]: true }))
    else alert('Failed to send: ' + (data?.error || 'Unknown error'))
  }

  async function openBillingDoc(path) {
    const { data } = await supabase.storage.from('billing-docs').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function openBidDoc(path) {
    const { data } = await supabase.storage.from('bid-docs').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function loadTeamData() {
    const [{ data: members }, { data: assigns }] = await Promise.all([
      supabase.from('profiles').select('*').in('role', ['pm', 'apm', 'super', 'admin']).order('full_name'),
      supabase.from('pm_job_assignments').select('*, jobs(id, job_number, project_name)').order('assigned_at'),
    ])
    setTeamMembers(members || [])
    setPmJobAssigns(assigns || [])
  }

  async function assignApmToJob(member) {
    const jobId = teamAssignTarget[member.id]
    if (!jobId) return
    setTeamAssigningId(member.id)
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('pm_job_assignments').insert({ job_id: jobId, user_id: member.id, assigned_by: session.user.id })
    if (error) {
      setTeamAssignMsg(prev => ({ ...prev, [member.id]: { text: error.code === '23505' ? 'Already assigned.' : 'Error: ' + error.message, ok: false } }))
    } else {
      await loadTeamData()
      setTeamAssignTarget(prev => ({ ...prev, [member.id]: '' }))
      setTeamAssignMsg(prev => ({ ...prev, [member.id]: { text: 'Assigned.', ok: true } }))
      setTimeout(() => setTeamAssignMsg(prev => { const n = { ...prev }; delete n[member.id]; return n }), 3000)
    }
    setTeamAssigningId(null)
  }

  async function removeApmFromJob(assignId) {
    await supabase.from('pm_job_assignments').delete().eq('id', assignId)
    await loadTeamData()
  }

  async function updateTeamRole(userId, role) {
    setUpdatingRoleId(userId)
    setRoleMsg(prev => ({ ...prev, [userId]: null }))
    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId)
    if (error) {
      setRoleMsg(prev => ({ ...prev, [userId]: { ok: false, text: 'Failed: ' + (error.message || 'permission denied') } }))
    } else {
      await loadTeamData()
      setRoleMsg(prev => ({ ...prev, [userId]: { ok: true, text: 'Saved' } }))
      setTimeout(() => setRoleMsg(prev => { const n = { ...prev }; delete n[userId]; return n }), 3000)
    }
    setUpdatingRoleId(null)
  }

  async function inviteTeamMember() {
    if (!teamInviteForm.email) return
    setTeamInviting(true)
    setTeamInviteMsg(null)
    const res = await fetch('/api/invite-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(teamInviteForm),
    })
    const json = await res.json()
    if (json.error) {
      setTeamInviteMsg({ ok: false, text: json.error })
    } else if (json.emailError) {
      setTeamInviteMsg({ ok: false, text: `Account created but email failed (${json.emailError}). Send them this link: ${json.inviteUrl}` })
    } else {
      setTeamInviteMsg({ ok: true, text: `Invite sent to ${teamInviteForm.email}` })
      setTeamInviteForm({ email: '', full_name: '', role: 'apm', phone: '' })
      setShowTeamInviteForm(false)
      await loadTeamData()
    }
    setTeamInviting(false)
  }

  async function deleteTeamMember(member) {
    if (!window.confirm(`Remove ${member.full_name || member.email} from the team? This cannot be undone.`)) return
    const res = await fetch('/api/invite-team', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: member.id }),
    })
    const json = await res.json()
    if (json.error) { alert('Error: ' + json.error); return }
    setTeamExpandedId(null)
    await loadTeamData()
  }

  async function saveTeamEdit() {
    setSavingTeamEdit(true)
    setTeamEditMsg(null)
    try {
      const { error: profError } = await supabase.from('profiles').update({
        full_name: editTeamForm.full_name || null,
        phone: editTeamForm.phone || null,
        company_name: editTeamForm.company_name || null,
      }).eq('id', editingTeamId)
      if (profError) { setTeamEditMsg({ ok: false, text: 'Save failed: ' + profError.message }); setSavingTeamEdit(false); return }

      const originalMember = teamMembers.find(m => m.id === editingTeamId)
      if (editTeamForm.email && editTeamForm.email !== originalMember?.email) {
        const res = await fetch('/api/invite-team', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: editingTeamId,
            email: editTeamForm.email,
            full_name: editTeamForm.full_name,
            role: originalMember?.role,
          }),
        })
        const json = await res.json()
        if (json.error) { setTeamEditMsg({ ok: false, text: 'Email update failed: ' + json.error }); setSavingTeamEdit(false); return }
        if (json.emailError) { setTeamEditMsg({ ok: false, text: `Email updated. Send them this link to set their password: ${json.resetUrl}` }); setSavingTeamEdit(false); return }
      }

      setEditingTeamId(null)
      await loadTeamData()
    } catch (e) {
      setTeamEditMsg({ ok: false, text: 'Unexpected error: ' + e.message })
    }
    setSavingTeamEdit(false)
  }

  // ── Estimates ───────────────────────────────────────────────
  async function loadEstimates() {
    const { data: { session } } = await supabase.auth.getSession()
    let q = supabase.from('estimates').select('*, estimate_line_items(*)').order('created_at', { ascending: false })
    if (profile?.role === 'apm') q = q.contains('allowed_users', [session.user.id])
    const { data } = await q
    setEstimates((data || []).map(e => ({ ...e, estimate_line_items: (e.estimate_line_items || []).sort((a, b) => a.sort_order - b.sort_order) })))
  }

  async function saveEstimate() {
    if (!estimateForm.project_name) return
    setSavingEstimate(true)
    const { data: { session } } = await supabase.auth.getSession()
    const year = new Date().getFullYear()
    const yearEstimates = estimates.filter(e => e.estimate_number?.startsWith(`EST-${year}-`))
    const nextNum = String(yearEstimates.length + 1).padStart(3, '0')
    const { data: est, error } = await supabase.from('estimates').insert({
      created_by: session.user.id,
      estimate_number: `EST-${year}-${nextNum}`,
      project_name: estimateForm.project_name,
      address: estimateForm.address || null,
      owner_name: estimateForm.owner_name || null,
      owner_company: estimateForm.owner_company || null,
      owner_email: estimateForm.owner_email || null,
      owner_phone: estimateForm.owner_phone || null,
      notes: estimateForm.notes || null,
      status: 'draft',
    }).select().single()
    if (!error && est) {
      const validLines = estimateLines.filter(l => l.description)
      if (validLines.length > 0) {
        await supabase.from('estimate_line_items').insert(validLines.map((l, i) => ({ estimate_id: est.id, description: l.description, amount: parseFloat(l.amount) || 0, sort_order: i })))
      }
      setShowNewEstimate(false)
      setEstimateForm({ project_name: '', address: '', owner_name: '', owner_company: '', owner_email: '', owner_phone: '', notes: '' })
      setEstimateLines([{ description: '', amount: '' }])
      await loadEstimates()
    }
    setSavingEstimate(false)
  }

  async function saveEstimateEdit() {
    setSavingEstimateEdit(true)
    await supabase.from('estimates').update({
      project_name: editEstimateForm.project_name,
      address: editEstimateForm.address || null,
      owner_name: editEstimateForm.owner_name || null,
      owner_company: editEstimateForm.owner_company || null,
      owner_email: editEstimateForm.owner_email || null,
      owner_phone: editEstimateForm.owner_phone || null,
      notes: editEstimateForm.notes || null,
      status: editEstimateForm.status,
      updated_at: new Date().toISOString(),
    }).eq('id', editingEstimate)
    await supabase.from('estimate_line_items').delete().eq('estimate_id', editingEstimate)
    const validLines = editEstimateLines.filter(l => l.description)
    if (validLines.length > 0) {
      await supabase.from('estimate_line_items').insert(validLines.map((l, i) => ({ estimate_id: editingEstimate, description: l.description, amount: parseFloat(l.amount) || 0, sort_order: i })))
    }
    setEditingEstimate(null)
    await loadEstimates()
    setSavingEstimateEdit(false)
  }

  async function deleteEstimate(estimateId) {
    if (!window.confirm('Delete this estimate?')) return
    await supabase.from('estimates').delete().eq('id', estimateId)
    if (expandedEstimate === estimateId) setExpandedEstimate(null)
    await loadEstimates()
  }

  async function generateEstimatePDF(estimate) {
    // Fetch logo as base64 so it embeds into the printed PDF
    let logoSrc = ''
    try {
      const res = await fetch('/logo.png')
      const blob = await res.blob()
      logoSrc = await new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(blob)
      })
    } catch { /* logo optional */ }

    const w = window.open('', '_blank')
    const lines = estimate.estimate_line_items || []
    const total = lines.reduce((a, l) => a + Number(l.amount || 0), 0)
    const fmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const estDate = new Date(estimate.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const genDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    w.document.write(`<!DOCTYPE html><html><head>
<title>Estimate ${estimate.estimate_number} — ${estimate.project_name}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; line-height: 1.5; }
.page { max-width: 820px; margin: 0 auto; padding: 48px 52px; }
.no-print { padding: 16px 52px; background: #f4f4f4; border-bottom: 1px solid #ddd; display: flex; gap: 10px; }
.btn { padding: 8px 20px; background: #1a1a1a; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; }
.btn-outline { padding: 8px 20px; background: white; color: #555; border: 1px solid #ccc; border-radius: 5px; cursor: pointer; font-size: 12px; }
@media print { .no-print { display: none !important; } body { padding: 0; } }

/* Header */
.header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; margin-bottom: 28px; border-bottom: 3px solid #e8590c; }
.brand { display: flex; align-items: center; gap: 16px; }
.brand-logo { width: 64px; height: 64px; object-fit: contain; }
.brand-text {}
.co-name { font-size: 20px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; color: #111; }
.co-tagline { font-size: 10px; color: #888; letter-spacing: 2.5px; text-transform: uppercase; margin-top: 3px; }
.co-contact { font-size: 10px; color: #666; margin-top: 6px; line-height: 1.8; }
.est-block { text-align: right; }
.est-label { font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: 4px; color: #e8590c; }
.est-num { font-size: 13px; color: #555; margin-top: 4px; font-weight: 600; }
.est-date { font-size: 11px; color: #999; margin-top: 2px; }

/* Info grid */
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
.info-block { padding: 14px 16px; border: 1px solid #e0e0e0; border-radius: 6px; background: #fafafa; }
.info-block-accent { border-left: 3px solid #e8590c; }
.info-label { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #e8590c; font-weight: 800; margin-bottom: 8px; }
.info-name { font-size: 14px; font-weight: 700; color: #111; }
.info-detail { font-size: 11px; color: #555; margin-top: 3px; }

/* Section */
.section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 2.5px; color: #e8590c; font-weight: 800; margin-bottom: 10px; margin-top: 26px; }
.scope-box { border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 16px; font-size: 12px; color: #444; line-height: 1.8; white-space: pre-wrap; background: #fafafa; }

/* Table */
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
thead tr { background: #1a1a1a; }
thead th { padding: 9px 14px; font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: #fff; font-weight: 700; text-align: left; }
thead th.right { text-align: right; }
tbody tr:nth-child(even) { background: #f9f9f9; }
tbody td { padding: 11px 14px; border-bottom: 1px solid #eee; font-size: 12px; color: #222; vertical-align: middle; }
tbody td.num { text-align: center; color: #bbb; width: 36px; font-size: 11px; }
tbody td.right { text-align: right; font-family: 'Courier New', monospace; font-size: 12px; }
.total-row td { padding: 13px 14px; font-weight: 800; border-top: 2px solid #e8590c; border-bottom: none; background: #fff8f5; }
.total-row td.right { font-family: 'Courier New', monospace; font-size: 16px; color: #e8590c; }
.total-label { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #e8590c; }
.footer-note { font-size: 10px; color: #bbb; margin-top: 6px; }

/* Signature */
.terms { margin-top: 32px; border-top: 1px solid #e0e0e0; padding-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 36px; }
.sig-label { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #888; font-weight: 700; margin-bottom: 12px; }
.sig-line { border-bottom: 1px solid #aaa; height: 44px; width: 100%; margin-bottom: 6px; }
.sig-sub { font-size: 10px; color: #aaa; }
.validity { font-size: 10px; color: #bbb; margin-top: 28px; text-align: center; border-top: 1px solid #eee; padding-top: 14px; letter-spacing: 0.5px; }
</style></head><body>
<div class="no-print">
  <button class="btn" onclick="window.print()">&#x2399; Print / Save as PDF</button>
  <button class="btn-outline" onclick="window.close()">Close</button>
</div>
<div class="page">

<div class="header">
  <div class="brand">
    ${logoSrc ? `<img src="${logoSrc}" class="brand-logo" alt="NV Construction" />` : ''}
    <div class="brand-text">
      <div class="co-name">NV Construction</div>
      <div class="co-tagline">General Contractor</div>
      <div class="co-contact">
        management@nvim.co<br>
        nvim.co
      </div>
    </div>
  </div>
  <div class="est-block">
    <div class="est-label">Estimate</div>
    <div class="est-num">${estimate.estimate_number}</div>
    <div class="est-date">Date: ${estDate}</div>
  </div>
</div>

<div class="info-grid">
  <div class="info-block info-block-accent">
    <div class="info-label">Prepared for</div>
    ${estimate.owner_name ? `<div class="info-name">${estimate.owner_name}</div>` : ''}
    ${estimate.owner_company ? `<div class="info-detail">${estimate.owner_company}</div>` : ''}
    ${estimate.owner_email ? `<div class="info-detail">${estimate.owner_email}</div>` : ''}
    ${estimate.owner_phone ? `<div class="info-detail">${estimate.owner_phone}</div>` : ''}
    ${!estimate.owner_name && !estimate.owner_company ? '<div class="info-detail" style="color:#ccc">—</div>' : ''}
  </div>
  <div class="info-block info-block-accent">
    <div class="info-label">Project</div>
    <div class="info-name">${estimate.project_name}</div>
    ${estimate.address ? `<div class="info-detail" style="margin-top:5px">${estimate.address.replace(/\n/g, '<br>')}</div>` : ''}
  </div>
</div>

${estimate.notes ? `<div class="section-label">Scope of work</div><div class="scope-box">${estimate.notes.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : ''}

<div class="section-label">Schedule of values</div>
<table>
  <thead><tr>
    <th class="num">#</th>
    <th>Description</th>
    <th class="right" style="width:160px">Amount</th>
  </tr></thead>
  <tbody>
    ${lines.map((l, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${l.description}</td>
      <td class="right">${fmt(l.amount)}</td>
    </tr>`).join('')}
    <tr class="total-row">
      <td></td>
      <td><span class="total-label">Total Estimate</span></td>
      <td class="right">${fmt(total)}</td>
    </tr>
  </tbody>
</table>
<div class="footer-note">All prices in USD &nbsp;·&nbsp; Subject to revision if scope changes</div>

<div class="terms">
  <div>
    <div class="sig-label">Client acceptance</div>
    <div class="sig-line"></div>
    <div class="sig-sub">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
  </div>
  <div>
    <div class="sig-label">NV Construction — Authorized signature</div>
    <div class="sig-line"></div>
    <div class="sig-sub">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
  </div>
</div>
<div class="validity">This estimate is valid for 30 days &nbsp;·&nbsp; NV Construction &nbsp;·&nbsp; Generated ${genDate}</div>

</div>
</body></html>`)
    w.document.close()
  }

  async function loadEstDocs(estimateId) {
    const { data } = await supabase.from('estimate_docs').select('*').eq('estimate_id', estimateId).order('uploaded_at')
    setEstDocs(prev => ({ ...prev, [estimateId]: data || [] }))
  }

  // ── Business Development ─────────────────────────────────────────
  async function loadBD() {
    const [res, { data: bids }] = await Promise.all([
      fetch('/api/bd').then(r => r.json()),
      supabase.from('bid_packages').select('*, jobs(project_name, job_number, contract_value, status)').order('created_at', { ascending: false })
    ])
    setBdOpportunities(res.opportunities || [])
    setBdGoals(res.goals || [])
    setBdBidPackages(bids || [])
    const currentGoal = (res.goals || []).find(g => g.year === new Date().getFullYear())
    if (currentGoal) setBdGoalInput(String(currentGoal.revenue_goal))
    // Fetch forecast profit for all jobs
    const jobIds = jobs.map(j => j.id)
    if (jobIds.length > 0) {
      const pr = await fetch('/api/job-profit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_ids: jobIds }) })
      const pd = await pr.json()
      setBdProfits(pd.profits || {})
    }
    setBdLoaded(true)
  }

  async function saveBdOpportunity() {
    if (!addBdForm.project_name.trim()) return
    setSavingBd(true)
    const res = await fetch('/api/bd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(addBdForm) })
    const data = await res.json()
    if (data.error) { setBdMsg({ text: data.error, ok: false }); setSavingBd(false); return }
    setBdOpportunities(prev => [data.opportunity, ...prev])
    setAddBdForm({ project_name: '', client_name: '', stage: 'prospect', bid_amount: '', contract_value: '', bid_date: '', trade_type: '', notes: '' })
    setShowAddBd(false)
    setSavingBd(false)
  }

  async function updateBdOpportunity() {
    if (!editingBdId) return
    setSavingBdEdit(true)
    const res = await fetch('/api/bd', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingBdId, ...editBdForm }) })
    const data = await res.json()
    if (data.error) { setBdMsg({ text: data.error, ok: false }); setSavingBdEdit(false); return }
    setBdOpportunities(prev => prev.map(o => o.id === editingBdId ? { ...o, ...editBdForm } : o))
    setEditingBdId(null)
    setSavingBdEdit(false)
    setBdMsg({ text: 'Saved', ok: true })
    setTimeout(() => setBdMsg(null), 2000)
  }

  async function deleteBdOpportunity(id) {
    if (!confirm('Delete this opportunity?')) return
    await fetch('/api/bd', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setBdOpportunities(prev => prev.filter(o => o.id !== id))
    if (expandedBd === id) setExpandedBd(null)
  }

  async function saveBdGoal() {
    setSavingBdGoal(true)
    const res = await fetch('/api/bd', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'goal', year: bdYear, revenue_goal: bdGoalInput }) })
    const data = await res.json()
    if (!data.error) {
      setBdGoals(prev => {
        const exists = prev.find(g => g.year === bdYear)
        if (exists) return prev.map(g => g.year === bdYear ? { ...g, revenue_goal: parseFloat(bdGoalInput) || 0 } : g)
        return [...prev, { year: bdYear, revenue_goal: parseFloat(bdGoalInput) || 0 }]
      })
      setBdMsg({ text: 'Goal saved', ok: true })
      setTimeout(() => setBdMsg(null), 2000)
    }
    setSavingBdGoal(false)
  }

  async function uploadEstDoc(estimateId, file) {
    setUploadingEstDoc(estimateId)
    const path = `${estimateId}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('estimate-docs').upload(path, file)
    if (!error) {
      await supabase.from('estimate_docs').insert({ estimate_id: estimateId, file_name: file.name, storage_path: path })
      await loadEstDocs(estimateId)
    } else {
      alert('Upload error: ' + error.message)
    }
    setUploadingEstDoc(null)
  }

  async function openEstDoc(path) {
    const { data } = await supabase.storage.from('estimate-docs').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function convertToJob(estimate) {
    if (!convertJobForm.job_number.trim()) { alert('Job number is required.'); return }
    setConvertingJob(true)
    const lines = estimate.estimate_line_items || []
    const total = lines.reduce((a, l) => a + Number(l.amount || 0), 0)
    const { data: job, error: jobError } = await supabase.from('jobs').insert({
      job_number: convertJobForm.job_number.trim(),
      project_name: estimate.project_name,
      location: estimate.address || null,
      contract_value: total || null,
      start_date: convertJobForm.start_date || null,
      status: 'active',
    }).select('id').single()
    if (jobError) { alert('Error creating job: ' + jobError.message); setConvertingJob(false); return }
    if (lines.length > 0) {
      await supabase.from('budget_items').insert(
        lines.map(l => ({ job_id: job.id, description: l.description, budget_amount: Number(l.amount) || 0, category: 'General' }))
      )
    }
    await supabase.from('estimates').update({ status: 'won' }).eq('id', estimate.id)
    setConvertingJob(false)
    setConvertingEst(null)
    router.push(`/jobdetail?id=${job.id}&tab=budget`)
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
            <button style={s.tab(activeTab === 'jobs')} onClick={() => setActiveTab('jobs')}>Jobs</button>
            <button style={s.tab(activeTab === 'calendar')} onClick={() => setActiveTab('calendar')}>Calendar</button>
            <button style={s.tab(activeTab === 'directory')} onClick={() => setActiveTab('directory')}>
              Sub directory{pendingApps > 0 ? ` (${pendingApps})` : ''}
            </button>
            <button style={s.tab(activeTab === 'billing')} onClick={() => setActiveTab('billing')}>Billing</button>
            {profile?.role === 'pm' && (
              <button style={s.tab(activeTab === 'nv-directory')} onClick={() => setActiveTab('nv-directory')}>NV Directory</button>
            )}
            {(profile?.role === 'pm' || profile?.role === 'apm') && (
              <button style={s.tab(activeTab === 'estimator')} onClick={() => setActiveTab('estimator')}>Estimator</button>
            )}
            {profile?.role === 'pm' && (
              <button style={s.tab(activeTab === 'bd')} onClick={() => setActiveTab('bd')}>Business Dev</button>
            )}
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
                                  <button onClick={() => updateStatus(sub, 'approved')} style={s.btnSm('green')}>Approve</button>
                                  <button onClick={() => updateStatus(sub, 'rejected')} style={s.btnSm('red')}>Reject</button>
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

                        {/* ── Document status ── */}
                        <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
                          <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Documents</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: sub.w9_url ? '#0a2a0a' : '#1a0a0a', border: `1px solid ${sub.w9_url ? '#1a4a1a' : '#3a1a1a'}`, borderRadius: '6px', minWidth: '80px' }}>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: sub.w9_url ? '#4ade80' : '#ff6b6b' }}>{sub.w9_url ? '✓' : '✗'} W-9</span>
                            </div>
                            {sub.w9_url && <button style={s.btnSm('gray')} onClick={() => getDocUrl(sub.w9_url)}>View</button>}
                            {sub.w9_url && <button style={s.btnSm('gray')} onClick={() => downloadDoc(sub.w9_url, `W9-${sub.company_name}.pdf`)}>Download</button>}
                            <label style={{ ...s.btnSm('blue'), cursor: 'pointer', opacity: uploadingW9For === sub.id ? 0.6 : 1 }}>
                              {uploadingW9For === sub.id ? 'Uploading...' : sub.w9_url ? 'Replace W-9' : 'Upload W-9'}
                              <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} disabled={uploadingW9For === sub.id}
                                onChange={e => { if (e.target.files?.[0]) uploadSubDoc(sub.id, 'w9', e.target.files[0]); e.target.value = '' }} />
                            </label>
                            {!sub.w9_url && sub.email && (
                              <button style={{ ...s.btnSm('orange'), opacity: requestingDoc === `${sub.id}-w9` ? 0.6 : 1 }} disabled={!!requestingDoc} onClick={() => sendDocRequest(sub.id, 'w9')}>
                                {docRequestSent[`${sub.id}-w9`] ? '✓ Sent' : requestingDoc === `${sub.id}-w9` ? '...' : 'Email Reminder'}
                              </button>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: sub.coi_url ? '#0a2a0a' : '#1a0a0a', border: `1px solid ${sub.coi_url ? '#1a4a1a' : '#3a1a1a'}`, borderRadius: '6px', minWidth: '80px' }}>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: sub.coi_url ? '#4ade80' : '#ff6b6b' }}>
                                {sub.coi_url ? '✓' : '✗'} COI{sub.coi_expiration ? ` · ${new Date(sub.coi_expiration).toLocaleDateString()}` : ''}
                              </span>
                            </div>
                            {sub.coi_url && <button style={s.btnSm('gray')} onClick={() => getDocUrl(sub.coi_url)}>View</button>}
                            {sub.coi_url && <button style={s.btnSm('gray')} onClick={() => downloadDoc(sub.coi_url, `COI-${sub.company_name}.pdf`)}>Download</button>}
                            <label style={{ ...s.btnSm('blue'), cursor: 'pointer', opacity: uploadingCoiFor === sub.id ? 0.6 : 1 }}>
                              {uploadingCoiFor === sub.id ? 'Uploading...' : sub.coi_url ? 'Replace COI' : 'Upload COI'}
                              <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} disabled={uploadingCoiFor === sub.id}
                                onChange={e => { if (e.target.files?.[0]) uploadSubDoc(sub.id, 'coi', e.target.files[0]); e.target.value = '' }} />
                            </label>
                            {(!sub.coi_url || new Date(sub.coi_expiration) < new Date()) && sub.email && (
                              <button style={{ ...s.btnSm('orange'), opacity: requestingDoc === `${sub.id}-coi` ? 0.6 : 1 }} disabled={!!requestingDoc} onClick={() => sendDocRequest(sub.id, 'coi')}>
                                {docRequestSent[`${sub.id}-coi`] ? '✓ Sent' : requestingDoc === `${sub.id}-coi` ? '...' : 'Email Reminder'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ── View / Edit toggle ── */}
                        {editingSubId !== sub.id ? (
                          <>
                            <div style={{ ...s.detailGrid, marginBottom: '1rem' }}>
                              <div><div style={s.detailLabel}>Email</div><div style={s.detailValue}>{sub.email}</div></div>
                              <div><div style={s.detailLabel}>Phone</div><div style={s.detailValue}>{sub.phone || '—'}</div></div>
                              <div><div style={s.detailLabel}>Address</div><div style={s.detailValue}>{sub.address || '—'}</div></div>
                              <div><div style={s.detailLabel}>Trade</div><div style={s.detailValue}>{sub.trade || '—'}</div></div>
                              <div><div style={s.detailLabel}>COI expiration</div><div style={s.detailValue}>{sub.coi_expiration ? new Date(sub.coi_expiration).toLocaleDateString() : '—'}</div></div>
                              <div><div style={s.detailLabel}>License</div><div style={s.detailValue}>{sub.license_number || '—'}</div></div>
                            </div>
                            {sub.scope_description && (
                              <div style={{ marginBottom: '1rem' }}>
                                <div style={s.detailLabel}>Scope description</div>
                                <div style={{ ...s.detailValue, lineHeight: '1.7' }}>{sub.scope_description}</div>
                              </div>
                            )}
                            <button style={{ ...s.btnSm('orange'), marginBottom: '1rem' }} onClick={() => {
                              setEditingSubId(sub.id)
                              setEditSubForm({
                                company_name: sub.company_name || '',
                                contact_name: sub.contact_name || '',
                                email: sub.email || '',
                                phone: sub.phone || '',
                                address: sub.address || '',
                                trade: sub.trade || '',
                                license_number: sub.license_number || '',
                                coi_expiration: sub.coi_expiration ? sub.coi_expiration.split('T')[0] : '',
                                scope_description: sub.scope_description || '',
                              })
                              setSubEditMsg(null)
                            }}>Edit info</button>
                          </>
                        ) : (
                          <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem' }}>
                            <p style={{ margin: '0 0 1rem', fontSize: '13px', fontWeight: '700', color: '#e8590c', letterSpacing: '0.5px' }}>Editing {sub.company_name}</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                              <div><label style={s.label}>Company name</label><input style={s.input} value={editSubForm.company_name} onChange={e => setEditSubForm(f => ({ ...f, company_name: e.target.value }))} /></div>
                              <div><label style={s.label}>Contact name</label><input style={s.input} value={editSubForm.contact_name} onChange={e => setEditSubForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
                              <div><label style={s.label}>Email</label><input type="email" style={s.input} value={editSubForm.email} onChange={e => setEditSubForm(f => ({ ...f, email: e.target.value }))} /></div>
                              <div><label style={s.label}>Phone</label><input style={s.input} value={editSubForm.phone} onChange={e => setEditSubForm(f => ({ ...f, phone: e.target.value }))} /></div>
                              <div><label style={s.label}>Address</label><input style={s.input} value={editSubForm.address} onChange={e => setEditSubForm(f => ({ ...f, address: e.target.value }))} /></div>
                              <div>
                                <label style={s.label}>Trade</label>
                                <select style={s.input} value={editSubForm.trade} onChange={e => setEditSubForm(f => ({ ...f, trade: e.target.value }))}>
                                  <option value="">— Select trade —</option>
                                  {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <div><label style={s.label}>License number</label><input style={s.input} value={editSubForm.license_number} onChange={e => setEditSubForm(f => ({ ...f, license_number: e.target.value }))} /></div>
                              <div><label style={s.label}>COI expiration</label><input type="date" style={s.input} value={editSubForm.coi_expiration} onChange={e => setEditSubForm(f => ({ ...f, coi_expiration: e.target.value }))} /></div>
                            </div>
                            <div style={{ marginBottom: '10px' }}>
                              <label style={s.label}>Scope description</label>
                              <textarea style={{ ...s.input, minHeight: '70px', resize: 'vertical' }} value={editSubForm.scope_description} onChange={e => setEditSubForm(f => ({ ...f, scope_description: e.target.value }))} />
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <button style={{ ...s.btnSm('green'), opacity: savingSubEdit ? 0.6 : 1 }} disabled={savingSubEdit} onClick={() => saveSubEdit(sub.id)}>
                                {savingSubEdit ? 'Saving...' : 'Save changes'}
                              </button>
                              <button style={s.btnSm('gray')} onClick={() => { setEditingSubId(null); setSubEditMsg(null) }}>Cancel</button>
                              {subEditMsg && <span style={{ fontSize: '12px', color: subEditMsg.ok ? '#4ade80' : '#ff6b6b' }}>{subEditMsg.text}</span>}
                            </div>
                          </div>
                        )}

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

                        {sub.email && (
                          <div style={{ marginBottom: '1rem' }}>
                            {notifySubId !== sub.id ? (
                              <button style={s.btnSm('blue')} onClick={() => { setNotifySubId(sub.id); setNotifySubject(''); setNotifyMessage('') }}>Send notification</button>
                            ) : (
                              <div style={{ background: '#0a0f1a', border: '1px solid #1a3a5a', borderRadius: '8px', padding: '1rem' }}>
                                <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: '700', color: '#60a5fa', letterSpacing: '1px', textTransform: 'uppercase' }}>Notify {sub.company_name}</p>
                                <div style={{ marginBottom: '8px' }}>
                                  <label style={s.label}>Subject</label>
                                  <input style={s.input} value={notifySubject} onChange={e => setNotifySubject(e.target.value)} placeholder="e.g. COI renewal needed" />
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                  <label style={s.label}>Message</label>
                                  <textarea style={{ ...s.input, minHeight: '80px', resize: 'vertical' }} value={notifyMessage} onChange={e => setNotifyMessage(e.target.value)} placeholder="Your message to the subcontractor..." />
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  <button style={{ ...s.btnSm('blue'), opacity: sendingNotify || !notifySubject || !notifyMessage ? 0.5 : 1 }} disabled={sendingNotify || !notifySubject || !notifyMessage} onClick={() => sendNotification(sub)}>{sendingNotify ? 'Sending...' : 'Send'}</button>
                                  <button style={s.btnSm('gray')} onClick={() => setNotifySubId(null)}>Cancel</button>
                                  {notifyResult[sub.id] && <span style={{ fontSize: '12px', color: notifyResult[sub.id].ok ? '#4ade80' : '#ff6b6b' }}>{notifyResult[sub.id].text}</span>}
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

            {/* ── CALENDAR ── */}
            {activeTab === 'calendar' && (() => {
              const { year, month } = calMonth
              const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
              const firstDay = new Date(year, month, 1).getDay()
              const daysInMonth = new Date(year, month + 1, 0).getDate()
              const cells = []
              for (let i = 0; i < firstDay; i++) cells.push(null)
              for (let d = 1; d <= daysInMonth; d++) cells.push(d)
              while (cells.length % 7 !== 0) cells.push(null)

              // Build per-day maps for sub and owner billing events
              const subByDay = {}
              const ownerByDay = {}
              const addDay = (map, day, job) => { if (!map[day]) map[day] = []; map[day].push(job) }

              const computeEvents = (jobs, getFreq, getDue, getAnchor, getStart, map) => {
                for (const j of jobs) {
                  const freq = getFreq(j) || 'monthly'
                  const due = getDue(j)
                  const start = getStart(j) ? new Date(getStart(j)) : null
                  if (due === null || due === undefined || due === '') continue
                  if (freq === 'monthly') {
                    const d = parseInt(due)
                    if (d >= 1 && d <= daysInMonth) {
                      const cellDate = new Date(year, month, d)
                      if (!start || start <= cellDate) addDay(map, d, j)
                    }
                  } else if (freq === 'weekly') {
                    const dow = parseInt(due)
                    if (!isNaN(dow)) for (let d = 1; d <= daysInMonth; d++) {
                      const cellDate = new Date(year, month, d)
                      if (cellDate.getDay() === dow && (!start || start <= cellDate)) addDay(map, d, j)
                    }
                  } else if (freq === 'biweekly') {
                    const dow = parseInt(due)
                    const anchor = getAnchor(j) ? new Date(getAnchor(j)) : null
                    if (!isNaN(dow) && anchor) for (let d = 1; d <= daysInMonth; d++) {
                      const cellDate = new Date(year, month, d)
                      const diff = Math.round((cellDate - anchor) / 86400000)
                      if (cellDate.getDay() === dow && diff % 14 === 0 && (!start || start <= cellDate)) addDay(map, d, j)
                    }
                  }
                }
              }

              const activeJobs = jobs.filter(j => j.status === 'active')
              computeEvents(activeJobs, j => j.sub_billing_frequency, j => j.sub_billing_due, j => j.sub_billing_anchor, j => j.sub_billing_start, subByDay)
              computeEvents(activeJobs, j => j.owner_billing_frequency, j => j.owner_billing_due, j => j.owner_billing_anchor, j => j.owner_billing_start, ownerByDay)

              // Bid due dates
              const bidByDay = {}
              for (const pkg of bidPackages.filter(p => p.due_date && p.status === 'open')) {
                const d = new Date(pkg.due_date + 'T00:00:00')
                if (d.getFullYear() === year && d.getMonth() === month) {
                  const day = d.getDate()
                  if (!bidByDay[day]) bidByDay[day] = []
                  bidByDay[day].push(pkg)
                }
              }

              const hasAny = activeJobs.some(j => j.sub_billing_due || j.owner_billing_due) || Object.keys(bidByDay).length > 0

              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                    <button style={s.btnSm('gray')} onClick={() => setCalMonth(m => { const d = new Date(m.year, m.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })}>‹ Prev</button>
                    <span style={{ fontWeight: '700', fontSize: '15px', color: '#f1f1f1' }}>{monthNames[month]} {year}</span>
                    <button style={s.btnSm('gray')} onClick={() => setCalMonth(m => { const d = new Date(m.year, m.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })}>Next ›</button>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#1a3a5a' }} /><span style={{ fontSize: '12px', color: '#888' }}>Sub billing due</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#1a4a1a' }} /><span style={{ fontSize: '12px', color: '#888' }}>Owner billing due</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#2a1a4a' }} /><span style={{ fontSize: '12px', color: '#888' }}>Bid deadline</span></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                      <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', paddingBottom: '8px', textTransform: 'uppercase' }}>{d}</div>
                    ))}
                    {cells.map((day, i) => {
                      const subJobs = day ? (subByDay[day] || []) : []
                      const ownerJobs = day ? (ownerByDay[day] || []) : []
                      const bidsDue = day ? (bidByDay[day] || []) : []
                      const isToday = day && new Date().getFullYear() === year && new Date().getMonth() === month && new Date().getDate() === day
                      return (
                        <div key={i} style={{ minHeight: '80px', background: day ? '#0f0f0f' : 'transparent', border: day ? `1px solid ${isToday ? '#e8590c' : '#1e1e1e'}` : 'none', borderRadius: '8px', padding: '6px' }}>
                          {day && <div style={{ fontSize: '12px', fontWeight: isToday ? '800' : '500', color: isToday ? '#e8590c' : '#555', marginBottom: '4px' }}>{day}</div>}
                          {subJobs.map(j => (
                            <div key={j.id} onClick={() => router.push(`/jobdetail?id=${j.id}`)} style={{ background: '#1a3a5a', border: '1px solid #2a5a8a', borderRadius: '4px', padding: '2px 5px', marginBottom: '3px', fontSize: '10px', color: '#93c5fd', cursor: 'pointer', lineHeight: '1.3', fontWeight: '600' }}>
                              #{j.job_number} Sub
                            </div>
                          ))}
                          {ownerJobs.map(j => (
                            <div key={j.id} onClick={() => router.push(`/jobdetail?id=${j.id}`)} style={{ background: '#1a4a1a', border: '1px solid #2a6a2a', borderRadius: '4px', padding: '2px 5px', marginBottom: '3px', fontSize: '10px', color: '#86efac', cursor: 'pointer', lineHeight: '1.3', fontWeight: '600' }}>
                              #{j.job_number} Owner
                            </div>
                          ))}
                          {bidsDue.map(p => (
                            <div key={p.id} onClick={() => { setActiveTab('estimator'); setEstimatorInnerTab('bids') }} style={{ background: '#2a1a4a', border: '1px solid #4a2a7a', borderRadius: '4px', padding: '2px 5px', marginBottom: '3px', fontSize: '10px', color: '#c084fc', cursor: 'pointer', lineHeight: '1.3', fontWeight: '600' }}>
                              {p.title}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                  {!hasAny && <div style={s.emptyMsg}>No active jobs with billing dates set. Add billing due dates when creating or editing a job.</div>}
                </div>
              )
            })()}

            {/* ── JOBS ── */}
            {activeTab === 'jobs' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                  <button style={s.btnSm('orange')} onClick={() => { setShowNewJobForm(v => !v); setNewJob({ job_number: '', project_name: '', start_date: '', sub_billing_start: '', sub_billing_frequency: 'monthly', sub_billing_due: '', sub_billing_anchor: '', owner_billing_start: '', owner_billing_frequency: 'monthly', owner_billing_due: '', owner_billing_anchor: '' }); setJobMsg('') }}>
                    {showNewJobForm ? 'Cancel' : '+ New job'}
                  </button>
                </div>

                {showNewJobForm && (
                  <div style={{ ...s.formBox, marginBottom: '1.25rem' }}>
                    <p style={s.formTitle}>New job</p>
                    <form onSubmit={addJob}>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div><label style={s.label}>Job number</label><input style={s.input} value={newJob.job_number} onChange={e => setNewJob(j => ({ ...j, job_number: e.target.value }))} required placeholder="7469" autoFocus /></div>
                        <div><label style={s.label}>Project name</label><input style={s.input} value={newJob.project_name} onChange={e => setNewJob(j => ({ ...j, project_name: e.target.value }))} required placeholder="Braum's Lubbock" /></div>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <div><label style={s.label}>Job start date</label><input style={s.input} type="date" value={newJob.start_date} onChange={e => setNewJob(j => ({ ...j, start_date: e.target.value }))} /></div>
                      </div>
                      <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                        <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' }}>Subcontractor billing</p>
                        <div style={{ ...s.grid2, marginBottom: '10px' }}>
                          <div><label style={s.label}>Billing start date</label><input style={s.input} type="date" value={newJob.sub_billing_start} onChange={e => setNewJob(j => ({ ...j, sub_billing_start: e.target.value }))} /></div>
                          <div><label style={s.label}>Frequency</label>
                            <select style={s.input} value={newJob.sub_billing_frequency} onChange={e => setNewJob(j => ({ ...j, sub_billing_frequency: e.target.value, sub_billing_due: '', sub_billing_anchor: '' }))}>
                              <option value="monthly">Monthly</option>
                              <option value="weekly">Weekly</option>
                              <option value="biweekly">Bi-weekly</option>
                            </select>
                          </div>
                        </div>
                        <div style={s.grid2}>
                          {newJob.sub_billing_frequency === 'monthly'
                            ? <div><label style={s.label}>Due day of month</label><input style={s.input} type="number" min="1" max="28" value={newJob.sub_billing_due} onChange={e => setNewJob(j => ({ ...j, sub_billing_due: e.target.value }))} placeholder="e.g. 25" /></div>
                            : <div><label style={s.label}>Due day of week</label>
                                <select style={s.input} value={newJob.sub_billing_due} onChange={e => setNewJob(j => ({ ...j, sub_billing_due: e.target.value }))}>
                                  <option value="">Select...</option>
                                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                                </select>
                              </div>
                          }
                          {newJob.sub_billing_frequency === 'biweekly' && <div><label style={s.label}>Anchor date</label><input style={s.input} type="date" value={newJob.sub_billing_anchor} onChange={e => setNewJob(j => ({ ...j, sub_billing_anchor: e.target.value }))} /></div>}
                        </div>
                      </div>
                      <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                        <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' }}>Prime contract (owner) billing</p>
                        <div style={{ ...s.grid2, marginBottom: '10px' }}>
                          <div><label style={s.label}>Billing start date</label><input style={s.input} type="date" value={newJob.owner_billing_start} onChange={e => setNewJob(j => ({ ...j, owner_billing_start: e.target.value }))} /></div>
                          <div><label style={s.label}>Frequency</label>
                            <select style={s.input} value={newJob.owner_billing_frequency} onChange={e => setNewJob(j => ({ ...j, owner_billing_frequency: e.target.value, owner_billing_due: '', owner_billing_anchor: '' }))}>
                              <option value="monthly">Monthly</option>
                              <option value="weekly">Weekly</option>
                              <option value="biweekly">Bi-weekly</option>
                            </select>
                          </div>
                        </div>
                        <div style={s.grid2}>
                          {newJob.owner_billing_frequency === 'monthly'
                            ? <div><label style={s.label}>Due day of month</label><input style={s.input} type="number" min="1" max="28" value={newJob.owner_billing_due} onChange={e => setNewJob(j => ({ ...j, owner_billing_due: e.target.value }))} placeholder="e.g. 1" /></div>
                            : <div><label style={s.label}>Due day of week</label>
                                <select style={s.input} value={newJob.owner_billing_due} onChange={e => setNewJob(j => ({ ...j, owner_billing_due: e.target.value }))}>
                                  <option value="">Select...</option>
                                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                                </select>
                              </div>
                          }
                          {newJob.owner_billing_frequency === 'biweekly' && <div><label style={s.label}>Anchor date</label><input style={s.input} type="date" value={newJob.owner_billing_anchor} onChange={e => setNewJob(j => ({ ...j, owner_billing_anchor: e.target.value }))} /></div>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button type="submit" style={s.btn}>Create & open job</button>
                        {jobMsg && <span style={s.successInline}>{jobMsg}</span>}
                      </div>
                    </form>
                  </div>
                )}

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

            {/* ── BID INVITES (inside Estimator) ── */}
            {activeTab === 'estimator' && estimatorInnerTab === 'bids' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: '#555' }}>{bidPackages.length} package{bidPackages.length !== 1 ? 's' : ''} · {bidPackages.filter(b => b.status === 'open').length} open</p>
                  {profile?.role === 'pm' && <button style={s.btnSm('orange')} onClick={() => setShowCreateBid(v => !v)}>{showCreateBid ? 'Cancel' : '+ New bid package'}</button>}
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

                          {profile?.role === 'pm' && (
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {pkg.status === 'open' && <button style={s.btnSm('gray')} onClick={() => setBidStatus(pkg.id, 'closed')}>Close bidding</button>}
                            {pkg.status === 'closed' && <button style={s.btnSm('orange')} onClick={() => setBidStatus(pkg.id, 'open')}>Re-open</button>}
                            {editingBidId === pkg.id
                              ? <>
                                  <input type="date" style={{ ...s.input, width: 'auto', padding: '6px 10px', fontSize: '13px' }} value={editBidDueDate} onChange={e => setEditBidDueDate(e.target.value)} />
                                  <button style={s.btnSm('green')} onClick={() => saveBidDueDate(pkg.id)}>Save</button>
                                  <button style={s.btnSm('gray')} onClick={() => setEditingBidId(null)}>Cancel</button>
                                </>
                              : <button style={s.btnSm('gray')} onClick={() => { setEditingBidId(pkg.id); setEditBidDueDate(pkg.due_date || '') }}>Edit due date</button>
                            }
                            <button style={s.btnSm('red')} onClick={() => deleteBidPackage(pkg.id)}>Delete package</button>
                          </div>
                          )}
                          {profile?.role === 'pm' && (() => {
                            const apms = teamMembers.filter(m => m.role === 'apm')
                            if (!apms.length) return null
                            return (
                              <div style={{ marginBottom: '1.5rem', padding: '12px 14px', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '8px' }}>
                                <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 10px' }}>APM Access</p>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                  {apms.map(apm => {
                                    const hasAccess = (pkg.allowed_users || []).includes(apm.id)
                                    return (
                                      <button key={apm.id} style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${hasAccess ? '#4ade80' : '#333'}`, background: hasAccess ? '#0a2a0a' : '#111', color: hasAccess ? '#4ade80' : '#555', transition: 'all 0.15s' }} onClick={() => toggleBidAccess(pkg.id, apm.id)}>
                                        {hasAccess ? '✓ ' : ''}{apm.full_name || apm.email}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })()}

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
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button style={s.btnSm('gray')} onClick={() => openPlan(plan.storage_path)}>Open</button>
                                  <button style={s.btnSm('red')} onClick={() => deletePlan(plan, pkg.id)}>Delete</button>
                                </div>
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
                                    onClick={() => inviteSubs(pkg.id, pkg)}>
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
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={s.badge(invBadge)}>{inv.status}</span>
                                    <button onClick={() => uninviteSub(inv.id, pkg.id)} style={{ background: 'none', border: '1px solid #3a1a1a', borderRadius: '6px', color: '#ff6b6b', fontSize: '11px', fontWeight: '700', cursor: 'pointer', padding: '3px 10px' }}>Remove</button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          {/* Submitted bids */}
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Submitted bids ({submissions.length})</span>
                                {submissions.length >= 2 && (
                                  <button style={s.btnSm(showBidCompare === pkg.id ? 'orange' : 'gray')} onClick={() => setShowBidCompare(showBidCompare === pkg.id ? null : pkg.id)}>
                                    {showBidCompare === pkg.id ? 'List view' : 'Compare'}
                                  </button>
                                )}
                              </div>
                              <button style={s.btnSm('orange')} onClick={() => { setShowManualBidFor(showManualBidFor === pkg.id ? null : pkg.id); setManualBidForm({ company_name: '', amount: '', notes: '' }); setManualBidFile(null) }}>
                                {showManualBidFor === pkg.id ? 'Cancel' : '+ Add bid manually'}
                              </button>
                            </div>

                            {showManualBidFor === pkg.id && (
                              <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '1rem', marginBottom: '12px' }}>
                                <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Enter bid received by email/phone</p>
                                <div style={{ ...s.grid2, marginBottom: '10px' }}>
                                  <div>
                                    <label style={s.label}>Company name *</label>
                                    <input style={s.input} placeholder="ABC Concrete Co." value={manualBidForm.company_name} onChange={e => setManualBidForm(f => ({ ...f, company_name: e.target.value }))} />
                                  </div>
                                  <div>
                                    <label style={s.label}>Bid amount *</label>
                                    <input style={s.input} type="number" placeholder="0.00" value={manualBidForm.amount} onChange={e => setManualBidForm(f => ({ ...f, amount: e.target.value }))} />
                                  </div>
                                </div>
                                <div style={{ marginBottom: '10px' }}>
                                  <label style={s.label}>Notes</label>
                                  <input style={s.input} placeholder="Inclusions, exclusions, qualifications..." value={manualBidForm.notes} onChange={e => setManualBidForm(f => ({ ...f, notes: e.target.value }))} />
                                </div>
                                <div style={{ marginBottom: '12px' }}>
                                  <label style={s.label}>Attach estimate (PDF/image)</label>
                                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setManualBidFile(e.target.files[0] || null)} style={{ fontSize: '13px', color: '#888' }} />
                                </div>
                                <button style={{ ...s.btn, opacity: submittingManualBid || !manualBidForm.company_name || !manualBidForm.amount ? 0.6 : 1 }} disabled={submittingManualBid || !manualBidForm.company_name || !manualBidForm.amount} onClick={() => submitManualBid(pkg.id)}>
                                  {submittingManualBid ? 'Saving...' : 'Save bid'}
                                </button>
                              </div>
                            )}

                            {submissions.length === 0 ? <p style={{ fontSize: '13px', color: '#444' }}>No bids submitted yet.</p> : showBidCompare === pkg.id ? (() => {
                              const sorted = [...submissions].filter(s => s.status !== 'rejected').sort((a, b) => Number(a.amount) - Number(b.amount))
                              const low = sorted.length > 0 ? Number(sorted[0].amount) : 0
                              return (
                                <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                      <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Rank</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Company</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Bid amount</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>vs Low</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Notes</th>
                                        <th style={{ padding: '10px 12px' }}></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sorted.map((sub, rank) => {
                                        const diff = Number(sub.amount) - low
                                        const isLow = rank === 0
                                        const isAwarded = sub.status === 'awarded'
                                        return (
                                          <tr key={sub.id} style={{ borderBottom: '1px solid #111', background: isLow ? 'rgba(74,222,128,0.04)' : isAwarded ? 'rgba(74,222,128,0.07)' : 'transparent' }}>
                                            <td style={{ padding: '10px 12px', color: isLow ? '#4ade80' : '#666', fontWeight: '700', fontSize: '12px' }}>#{rank + 1}{isLow && ' ★'}</td>
                                            <td style={{ padding: '10px 12px' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ color: '#f1f1f1', fontWeight: '600' }}>{sub.company_name}</span>
                                                {isAwarded && <span style={s.badge('approved')}>awarded</span>}
                                                {!sub.sub_id && <span style={{ fontSize: '10px', color: '#666', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '2px 6px' }}>manual</span>}
                                              </div>
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '800', fontSize: '15px', color: isLow ? '#4ade80' : '#f1f1f1' }}>${Number(sub.amount).toLocaleString()}</td>
                                            <td style={{ padding: '10px 12px', textAlign: 'right', color: isLow ? '#555' : '#e8590c', fontSize: '13px', fontWeight: '600' }}>
                                              {isLow ? '—' : `+$${diff.toLocaleString()}`}
                                            </td>
                                            <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px', maxWidth: '180px' }}>{sub.notes || '—'}</td>
                                            <td style={{ padding: '10px 12px' }}>
                                              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                {sub.doc_url && <button style={s.btnSm('gray')} onClick={() => openBidDoc(sub.doc_url)}>📎</button>}
                                                {sub.status === 'pending' && pkg.status !== 'awarded' && (
                                                  <>
                                                    <button style={s.btnSm('green')} onClick={() => awardBid(sub, pkg.id)}>Award</button>
                                                    <button style={s.btnSm('red')} onClick={async () => { await supabase.from('bid_submissions').update({ status: 'rejected' }).eq('id', sub.id); loadBidDetail(pkg.id) }}>Pass</button>
                                                  </>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )
                            })() : submissions.map(sub => (
                              <div key={sub.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#0f0f0f', borderRadius: '8px', marginBottom: '6px', flexWrap: 'wrap', gap: '12px', border: sub.status === 'awarded' ? '1px solid #1a4a1a' : '1px solid transparent' }}>
                                <div style={{ flex: 1, minWidth: '180px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                                    <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{sub.company_name}</span>
                                    <span style={s.badge(sub.status === 'awarded' ? 'approved' : sub.status === 'rejected' ? 'rejected' : 'pending')}>{sub.status}</span>
                                    {!sub.sub_id && <span style={{ fontSize: '10px', color: '#666', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '2px 6px', letterSpacing: '0.5px' }}>manual entry</span>}
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

            {/* ── NV DIRECTORY ── */}
            {activeTab === 'nv-directory' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: '#555' }}>
                    Internal team — {teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''}
                  </p>
                  <button style={s.btnSm('orange')} onClick={() => { setShowTeamInviteForm(v => !v); setTeamInviteMsg(null) }}>
                    {showTeamInviteForm ? 'Cancel' : '+ Add Team Member'}
                  </button>
                </div>

                {showTeamInviteForm && (
                  <div style={s.formBox}>
                    <p style={s.formTitle}>Invite team member</p>
                    {teamInviteMsg && (
                      <p style={{ fontSize: '13px', color: teamInviteMsg.ok ? '#4ade80' : '#ff6b6b', marginBottom: '1rem', marginTop: 0 }}>{teamInviteMsg.text}</p>
                    )}
                    <div style={{ ...s.grid2, marginBottom: '12px' }}>
                      <div><label style={s.label}>Email *</label><input style={s.input} type="email" value={teamInviteForm.email} onChange={e => setTeamInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@email.com" /></div>
                      <div><label style={s.label}>Full name</label><input style={s.input} value={teamInviteForm.full_name} onChange={e => setTeamInviteForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Smith" /></div>
                    </div>
                    <div style={{ ...s.grid2, marginBottom: '1.25rem' }}>
                      <div>
                        <label style={s.label}>Role *</label>
                        <select style={s.input} value={teamInviteForm.role} onChange={e => setTeamInviteForm(f => ({ ...f, role: e.target.value }))}>
                          <option value="pm">PM</option>
                          <option value="apm">Assistant PM</option>
                          <option value="super">Superintendent</option>
                          <option value="admin">Office Admin</option>
                        </select>
                      </div>
                      <div><label style={s.label}>Phone</label><input style={s.input} value={teamInviteForm.phone} onChange={e => setTeamInviteForm(f => ({ ...f, phone: e.target.value }))} placeholder="555-0100" /></div>
                    </div>
                    <button style={{ ...s.btnSm('orange'), opacity: teamInviting || !teamInviteForm.email ? 0.6 : 1 }} disabled={teamInviting || !teamInviteForm.email} onClick={inviteTeamMember}>
                      {teamInviting ? 'Sending invite...' : 'Send invite'}
                    </button>
                    <p style={{ fontSize: '12px', color: '#444', marginTop: '10px', marginBottom: 0 }}>They'll receive an email to set their password and access the system.</p>
                  </div>
                )}
                {teamMembers.length === 0 ? (
                  <div style={s.emptyMsg}>No team members yet. Create accounts in Supabase and assign a role.</div>
                ) : teamMembers.map(member => {
                  const isExp = teamExpandedId === member.id
                  const memberAssigns = pmJobAssigns.filter(a => a.user_id === member.id)
                  return (
                    <div key={member.id} style={s.rowBorder}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 8px', cursor: 'pointer' }}
                        onClick={() => setTeamExpandedId(isExp ? null : member.id)}>
                        <div>
                          <p style={s.company}>{member.full_name || member.email}</p>
                          <p style={s.meta}>{member.email}{member.phone ? ' · ' + member.phone : ''}</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={s.roleBadge(member.role)}>{member.role}</span>
                          <span style={{ color: '#555', fontSize: '16px' }}>{isExp ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {isExp && (
                        <div style={s.detail}>
                          {editingTeamId === member.id ? (
                            <>
                              <p style={{ ...s.detailLabel, marginBottom: '1rem', fontSize: '12px' }}>Edit team member</p>
                              <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                <div><label style={s.label}>Full name</label><input style={s.input} value={editTeamForm.full_name} onChange={e => setEditTeamForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Smith" /></div>
                                <div><label style={s.label}>Phone</label><input style={s.input} value={editTeamForm.phone} onChange={e => setEditTeamForm(f => ({ ...f, phone: e.target.value }))} placeholder="555-0100" /></div>
                              </div>
                              <div style={{ marginBottom: '12px' }}>
                                <label style={s.label}>Email</label>
                                <input style={s.input} type="email" value={editTeamForm.email || ''} onChange={e => setEditTeamForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@email.com" />
                                {editTeamForm.email && editTeamForm.email !== teamMembers.find(m => m.id === editingTeamId)?.email && (
                                  <p style={{ fontSize: '11px', color: '#e8590c', marginTop: '4px', marginBottom: 0 }}>A new invite will be sent to this address.</p>
                                )}
                              </div>
                              <div style={{ marginBottom: '1.25rem' }}>
                                <label style={s.label}>Company / title</label>
                                <input style={s.input} value={editTeamForm.company_name} onChange={e => setEditTeamForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Project Manager" />
                              </div>
                              {teamEditMsg && <p style={{ fontSize: '12px', color: teamEditMsg.ok ? '#4ade80' : '#ff6b6b', margin: '0 0 10px', wordBreak: 'break-all' }}>{teamEditMsg.text}</p>}
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={saveTeamEdit} disabled={savingTeamEdit} style={{ ...s.btnSm('orange'), opacity: savingTeamEdit ? 0.6 : 1 }}>{savingTeamEdit ? 'Saving...' : 'Save'}</button>
                                <button onClick={() => { setEditingTeamId(null); setTeamEditMsg(null) }} style={s.btnSm('gray')}>Cancel</button>
                              </div>
                            </>
                          ) : (
                            <>
                              {/* Details row */}
                              <div style={{ ...s.detailGrid, marginBottom: '1rem' }}>
                                <div><div style={s.detailLabel}>Email</div><div style={s.detailValue}>{member.email || '—'}</div></div>
                                <div><div style={s.detailLabel}>Phone</div><div style={s.detailValue}>{member.phone || '—'}</div></div>
                                <div><div style={s.detailLabel}>Title</div><div style={s.detailValue}>{member.company_name || '—'}</div></div>
                              </div>

                              {/* Edit / Delete buttons */}
                              <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem' }}>
                                <button onClick={() => {
                                  setEditingTeamId(member.id)
                                  setEditTeamForm({ full_name: member.full_name || '', phone: member.phone || '', company_name: member.company_name || '' })
                                  setEditTeamForm(f => ({ ...f, email: member.email || '' }))
                                }} style={s.btnSm('orange')}>Edit details</button>
                                <button onClick={() => deleteTeamMember(member)} style={s.btnSm('red')}>Remove</button>
                              </div>

                              {/* Role changer */}
                              <div style={{ marginBottom: '1.25rem' }}>
                                <div style={s.detailLabel}>Role</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                                  <select
                                    style={{ ...s.input, maxWidth: '200px' }}
                                    value={member.role || ''}
                                    onChange={e => updateTeamRole(member.id, e.target.value)}
                                    disabled={updatingRoleId === member.id}
                                  >
                                    <option value="pm">PM</option>
                                    <option value="apm">Assistant PM</option>
                                    <option value="super">Superintendent</option>
                                    <option value="admin">Office Admin</option>
                                  </select>
                                  {updatingRoleId === member.id && <span style={s.successInline}>Saving...</span>}
                                  {roleMsg[member.id] && <span style={roleMsg[member.id].ok ? s.successInline : s.errorInline}>{roleMsg[member.id].text}</span>}
                                </div>
                              </div>

                              {/* Job assignments (APM / Super) */}
                              {(member.role === 'apm' || member.role === 'super') && (
                                <div>
                                  <div style={s.detailLabel}>Assigned jobs</div>
                                  {memberAssigns.length === 0 ? (
                                    <p style={{ fontSize: '13px', color: '#444', margin: '6px 0 1rem' }}>Not assigned to any jobs yet.</p>
                                  ) : (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '6px 0 1rem' }}>
                                      {memberAssigns.map(a => (
                                        <span key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#aaa', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '4px 10px' }}>
                                          #{a.jobs?.job_number} — {a.jobs?.project_name}
                                          <button onClick={() => removeApmFromJob(a.id)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '14px', padding: '0', lineHeight: 1 }}>×</button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div style={s.assignBox}>
                                    <p style={s.assignTitle}>Assign to job</p>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                      <select
                                        style={{ ...s.input, maxWidth: '280px' }}
                                        value={teamAssignTarget[member.id] || ''}
                                        onChange={e => setTeamAssignTarget(prev => ({ ...prev, [member.id]: e.target.value }))}
                                      >
                                        <option value="">Select a job...</option>
                                        {jobs.filter(j => !memberAssigns.some(a => a.job_id === j.id)).map(j => (
                                          <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>
                                        ))}
                                      </select>
                                      <button
                                        style={{ ...s.btnSm('orange'), opacity: teamAssigningId === member.id || !teamAssignTarget[member.id] ? 0.6 : 1 }}
                                        disabled={teamAssigningId === member.id || !teamAssignTarget[member.id]}
                                        onClick={() => assignApmToJob(member)}
                                      >
                                        {teamAssigningId === member.id ? 'Assigning...' : 'Assign'}
                                      </button>
                                      {teamAssignMsg[member.id] && (
                                        <span style={teamAssignMsg[member.id].ok ? s.successInline : s.errorInline}>
                                          {teamAssignMsg[member.id].text}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {/* ── ESTIMATOR INNER NAV ── */}
            {activeTab === 'estimator' && (
              <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', marginBottom: '1.5rem' }}>
                <button style={{ padding: '10px 18px', border: 'none', borderBottom: estimatorInnerTab === 'estimates' ? '2px solid #e8590c' : '2px solid transparent', background: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: estimatorInnerTab === 'estimates' ? '700' : '500', color: estimatorInnerTab === 'estimates' ? '#e8590c' : '#555', letterSpacing: '1px', textTransform: 'uppercase', whiteSpace: 'nowrap' }} onClick={() => setEstimatorInnerTab('estimates')}>
                  Estimates ({estimates.length})
                </button>
                <button style={{ padding: '10px 18px', border: 'none', borderBottom: estimatorInnerTab === 'bids' ? '2px solid #e8590c' : '2px solid transparent', background: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: estimatorInnerTab === 'bids' ? '700' : '500', color: estimatorInnerTab === 'bids' ? '#e8590c' : '#555', letterSpacing: '1px', textTransform: 'uppercase', whiteSpace: 'nowrap' }} onClick={() => setEstimatorInnerTab('bids')}>
                  Bid Packages ({bidPackages.length})
                </button>
              </div>
            )}

            {/* ── ESTIMATES (inside Estimator) ── */}
            {activeTab === 'estimator' && estimatorInnerTab === 'estimates' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: '#555' }}>{estimates.length} estimate{estimates.length !== 1 ? 's' : ''} · {estimates.filter(e => e.status === 'won').length} won · {estimates.filter(e => e.status === 'lost').length} lost</p>
                  {profile?.role === 'pm' && <button style={s.btn} onClick={() => { setShowNewEstimate(v => !v); setExpandedEstimate(null); setEstimateForm({ project_name: '', address: '', owner_name: '', owner_company: '', owner_email: '', owner_phone: '', notes: '' }); setEstimateLines([{ description: '', amount: '' }]) }}>{showNewEstimate ? 'Cancel' : '+ New estimate'}</button>}
                </div>

                {showNewEstimate && (
                  <div style={s.formBox}>
                    <p style={s.formTitle}>New estimate</p>
                    <div style={{ ...s.grid2, marginBottom: '12px' }}>
                      <div><label style={s.label}>Project name *</label><input style={s.input} value={estimateForm.project_name} onChange={e => setEstimateForm(f => ({ ...f, project_name: e.target.value }))} placeholder="Project name" /></div>
                      <div><label style={s.label}>Address</label><input style={s.input} value={estimateForm.address} onChange={e => setEstimateForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St, City, ST" /></div>
                    </div>
                    <div style={{ ...s.grid2, marginBottom: '12px' }}>
                      <div><label style={s.label}>Owner / Contact name</label><input style={s.input} value={estimateForm.owner_name} onChange={e => setEstimateForm(f => ({ ...f, owner_name: e.target.value }))} placeholder="John Smith" /></div>
                      <div><label style={s.label}>Company</label><input style={s.input} value={estimateForm.owner_company} onChange={e => setEstimateForm(f => ({ ...f, owner_company: e.target.value }))} placeholder="ABC Properties" /></div>
                    </div>
                    <div style={{ ...s.grid2, marginBottom: '12px' }}>
                      <div><label style={s.label}>Email</label><input type="email" style={s.input} value={estimateForm.owner_email} onChange={e => setEstimateForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="owner@example.com" /></div>
                      <div><label style={s.label}>Phone</label><input style={s.input} value={estimateForm.owner_phone} onChange={e => setEstimateForm(f => ({ ...f, owner_phone: e.target.value }))} placeholder="555-0100" /></div>
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                      <label style={s.label}>Scope of work / notes</label>
                      <textarea style={{ ...s.input, minHeight: '80px', resize: 'vertical' }} value={estimateForm.notes} onChange={e => setEstimateForm(f => ({ ...f, notes: e.target.value }))} placeholder="Describe the scope of work..." />
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <label style={s.label}>Schedule of values</label>
                        <button type="button" style={s.btnSm('green')} onClick={() => setEstimateLines(l => [...l, { description: '', amount: '' }])}>+ Add line</button>
                      </div>
                      <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 40px', padding: '8px 12px', borderBottom: '1px solid #1e1e1e', fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                          <div>Description</div><div style={{ textAlign: 'right' }}>Amount</div><div></div>
                        </div>
                        {estimateLines.map((line, idx) => (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 40px', borderBottom: idx < estimateLines.length - 1 ? '1px solid #1a1a1a' : 'none', alignItems: 'center' }}>
                            <input style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', borderRight: '1px solid #1e1e1e' }} value={line.description} onChange={e => setEstimateLines(l => l.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} placeholder={`Line item ${idx + 1}`} />
                            <input type="number" step="0.01" style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', textAlign: 'right', borderRight: '1px solid #1e1e1e' }} value={line.amount} onChange={e => setEstimateLines(l => l.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))} placeholder="0.00" />
                            <button style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '18px', padding: 0, width: '40px', textAlign: 'center' }} onClick={() => setEstimateLines(l => l.filter((_, i) => i !== idx))}>×</button>
                          </div>
                        ))}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 40px', padding: '10px 12px', background: '#111', borderTop: '2px solid #1e1e1e' }}>
                          <div style={{ fontSize: '12px', fontWeight: '700', color: '#555', textAlign: 'right', gridColumn: '1/2' }}>Total:</div>
                          <div style={{ textAlign: 'right', fontWeight: '800', color: '#e8590c', fontSize: '14px', fontFamily: 'monospace' }}>
                            ${estimateLines.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div></div>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button style={{ ...s.btn, opacity: savingEstimate || !estimateForm.project_name ? 0.6 : 1 }} disabled={savingEstimate || !estimateForm.project_name} onClick={saveEstimate}>{savingEstimate ? 'Saving...' : 'Save estimate'}</button>
                      <button style={s.btnGray} onClick={() => { setShowNewEstimate(false); setEstimateForm({ project_name: '', address: '', owner_name: '', owner_company: '', owner_email: '', owner_phone: '', notes: '' }); setEstimateLines([{ description: '', amount: '' }]) }}>Cancel</button>
                    </div>
                  </div>
                )}

                {estimates.length === 0 && !showNewEstimate && <div style={s.emptyMsg}>No estimates yet. Click "New estimate" to get started.</div>}

                {estimates.map(est => {
                  const isExp = expandedEstimate === est.id
                  const lines = est.estimate_line_items || []
                  const total = lines.reduce((a, l) => a + Number(l.amount || 0), 0)
                  const isEditingEst = editingEstimate === est.id
                  return (
                    <div key={est.id} style={s.rowBorder}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 8px', cursor: 'pointer' }}
                        onClick={() => { const newId = isExp ? null : est.id; setExpandedEstimate(newId); if (newId) loadEstDocs(newId) }}>
                        <div>
                          <p style={s.company}>{est.project_name}</p>
                          <p style={s.meta}>{est.estimate_number} · {new Date(est.created_at).toLocaleDateString()}{est.owner_name ? ' · ' + est.owner_name : ''}</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '16px', fontWeight: '800', color: '#f1f1f1' }}>${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', background: est.status === 'won' ? '#0a2a0a' : est.status === 'lost' ? '#2a0a0a' : est.status === 'sent' ? '#1a2a00' : est.status === 'accepted' ? '#0a1a2a' : est.status === 'declined' ? '#2a0a0a' : '#1a1a1a', color: est.status === 'won' ? '#4ade80' : est.status === 'lost' ? '#ff6b6b' : est.status === 'sent' ? '#a3e635' : est.status === 'accepted' ? '#60a5fa' : est.status === 'declined' ? '#ff6b6b' : '#888', border: `1px solid ${est.status === 'won' ? '#1a4a1a' : est.status === 'lost' ? '#5a1a1a' : est.status === 'sent' ? '#2a4a00' : est.status === 'accepted' ? '#1a3a5a' : est.status === 'declined' ? '#5a1a1a' : '#2a2a2a'}` }}>{est.status}</span>
                          <span style={{ color: '#555', fontSize: '16px' }}>{isExp ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {isExp && (
                        <div style={s.detail}>
                          {isEditingEst ? (
                            <>
                              <p style={{ ...s.detailLabel, marginBottom: '1rem', fontSize: '12px' }}>Edit estimate</p>
                              <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                <div><label style={s.label}>Project name</label><input style={s.input} value={editEstimateForm.project_name} onChange={e => setEditEstimateForm(f => ({ ...f, project_name: e.target.value }))} /></div>
                                <div><label style={s.label}>Address</label><input style={s.input} value={editEstimateForm.address} onChange={e => setEditEstimateForm(f => ({ ...f, address: e.target.value }))} /></div>
                              </div>
                              <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                <div><label style={s.label}>Owner name</label><input style={s.input} value={editEstimateForm.owner_name} onChange={e => setEditEstimateForm(f => ({ ...f, owner_name: e.target.value }))} /></div>
                                <div><label style={s.label}>Company</label><input style={s.input} value={editEstimateForm.owner_company} onChange={e => setEditEstimateForm(f => ({ ...f, owner_company: e.target.value }))} /></div>
                              </div>
                              <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                <div><label style={s.label}>Email</label><input style={s.input} value={editEstimateForm.owner_email} onChange={e => setEditEstimateForm(f => ({ ...f, owner_email: e.target.value }))} /></div>
                                <div><label style={s.label}>Phone</label><input style={s.input} value={editEstimateForm.owner_phone} onChange={e => setEditEstimateForm(f => ({ ...f, owner_phone: e.target.value }))} /></div>
                              </div>
                              <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                <div>
                                  <label style={s.label}>Status</label>
                                  <select style={s.input} value={editEstimateForm.status} onChange={e => setEditEstimateForm(f => ({ ...f, status: e.target.value }))}>
                                    <option value="draft">Draft</option>
                                    <option value="sent">Sent</option>
                                    <option value="won">Won</option>
                                    <option value="lost">Lost</option>
                                    <option value="accepted">Accepted</option>
                                    <option value="declined">Declined</option>
                                  </select>
                                </div>
                              </div>
                              <div style={{ marginBottom: '1.25rem' }}>
                                <label style={s.label}>Scope / notes</label>
                                <textarea style={{ ...s.input, minHeight: '80px', resize: 'vertical' }} value={editEstimateForm.notes} onChange={e => setEditEstimateForm(f => ({ ...f, notes: e.target.value }))} />
                              </div>
                              <div style={{ marginBottom: '1.25rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                  <label style={s.label}>Schedule of values</label>
                                  <button type="button" style={s.btnSm('green')} onClick={() => setEditEstimateLines(l => [...l, { description: '', amount: '' }])}>+ Add line</button>
                                </div>
                                <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 40px', padding: '8px 12px', borderBottom: '1px solid #1e1e1e', fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                                    <div>Description</div><div style={{ textAlign: 'right' }}>Amount</div><div></div>
                                  </div>
                                  {editEstimateLines.map((line, idx) => (
                                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 40px', borderBottom: idx < editEstimateLines.length - 1 ? '1px solid #1a1a1a' : 'none', alignItems: 'center' }}>
                                      <input style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', borderRight: '1px solid #1e1e1e' }} value={line.description} onChange={e => setEditEstimateLines(l => l.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                                      <input type="number" step="0.01" style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', textAlign: 'right', borderRight: '1px solid #1e1e1e' }} value={line.amount} onChange={e => setEditEstimateLines(l => l.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))} />
                                      <button style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '18px', padding: 0, width: '40px', textAlign: 'center' }} onClick={() => setEditEstimateLines(l => l.filter((_, i) => i !== idx))}>×</button>
                                    </div>
                                  ))}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 40px', padding: '10px 12px', background: '#111', borderTop: '2px solid #1e1e1e' }}>
                                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#555', textAlign: 'right' }}>Total:</div>
                                    <div style={{ textAlign: 'right', fontWeight: '800', color: '#e8590c', fontSize: '14px', fontFamily: 'monospace' }}>
                                      ${editEstimateLines.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <div></div>
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button style={{ ...s.btnSm('orange'), opacity: savingEstimateEdit ? 0.6 : 1 }} disabled={savingEstimateEdit} onClick={saveEstimateEdit}>{savingEstimateEdit ? 'Saving...' : 'Save changes'}</button>
                                <button style={s.btnSm('gray')} onClick={() => setEditingEstimate(null)}>Cancel</button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div style={{ ...s.detailGrid, marginBottom: '1rem' }}>
                                <div><div style={s.detailLabel}>Owner / Contact</div><div style={s.detailValue}>{[est.owner_name, est.owner_company].filter(Boolean).join(' · ') || '—'}</div></div>
                                <div><div style={s.detailLabel}>Address</div><div style={s.detailValue}>{est.address || '—'}</div></div>
                                <div><div style={s.detailLabel}>Email</div><div style={s.detailValue}>{est.owner_email || '—'}</div></div>
                                <div><div style={s.detailLabel}>Phone</div><div style={s.detailValue}>{est.owner_phone || '—'}</div></div>
                              </div>
                              {est.notes && (
                                <div style={{ marginBottom: '1rem' }}>
                                  <div style={s.detailLabel}>Scope / notes</div>
                                  <div style={{ fontSize: '13px', color: '#888', whiteSpace: 'pre-wrap', marginTop: '4px', lineHeight: 1.6 }}>{est.notes}</div>
                                </div>
                              )}
                              {lines.length > 0 && (
                                <div style={{ marginBottom: '1.25rem' }}>
                                  <div style={s.detailLabel}>Schedule of values</div>
                                  <div style={{ marginTop: '8px', border: '1px solid #1e1e1e', borderRadius: '6px', overflow: 'hidden' }}>
                                    {lines.map((l, i) => (
                                      <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 12px', borderBottom: i < lines.length - 1 ? '1px solid #111' : 'none', fontSize: '13px' }}>
                                        <span style={{ color: '#ccc' }}>{l.description}</span>
                                        <span style={{ color: '#f1f1f1', fontWeight: '600', fontFamily: 'monospace' }}>${Number(l.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                      </div>
                                    ))}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: '#111', borderTop: '2px solid #1e1e1e', fontWeight: '800' }}>
                                      <span style={{ color: '#888', fontSize: '12px' }}>Total</span>
                                      <span style={{ color: '#e8590c', fontFamily: 'monospace', fontSize: '15px' }}>${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                              <div style={{ marginBottom: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <div style={s.detailLabel}>Estimate documents</div>
                                  <label style={{ ...s.btnSm('orange'), cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    {uploadingEstDoc === est.id ? 'Uploading...' : '+ Upload doc'}
                                    <input type="file" accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg" style={{ display: 'none' }}
                                      disabled={uploadingEstDoc === est.id}
                                      onChange={e => e.target.files[0] && uploadEstDoc(est.id, e.target.files[0])} />
                                  </label>
                                </div>
                                {!(estDocs[est.id] || []).length ? (
                                  <p style={{ fontSize: '12px', color: '#444', margin: 0 }}>No documents uploaded.</p>
                                ) : (estDocs[est.id] || []).map(doc => (
                                  <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#0f0f0f', borderRadius: '6px', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '12px', color: '#ccc' }}>📄 {doc.file_name}</span>
                                    <button style={s.btnSm('gray')} onClick={() => openEstDoc(doc.storage_path)}>Open</button>
                                  </div>
                                ))}
                              </div>
                              {profile?.role === 'pm' && (() => {
                                const apms = teamMembers.filter(m => m.role === 'apm')
                                if (!apms.length) return null
                                return (
                                  <div style={{ marginBottom: '1rem', padding: '12px 14px', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '8px' }}>
                                    <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 10px' }}>APM Access</p>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                      {apms.map(apm => {
                                        const hasAccess = (est.allowed_users || []).includes(apm.id)
                                        return (
                                          <button key={apm.id} style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${hasAccess ? '#4ade80' : '#333'}`, background: hasAccess ? '#0a2a0a' : '#111', color: hasAccess ? '#4ade80' : '#555', transition: 'all 0.15s' }} onClick={() => toggleEstimateAccess(est.id, apm.id)}>
                                            {hasAccess ? '✓ ' : ''}{apm.full_name || apm.email}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )
                              })()}
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: convertingEst === est.id ? '1rem' : 0 }}>
                                <button style={s.btnSm('orange')} onClick={() => generateEstimatePDF(est)}>Export PDF</button>
                                {profile?.role === 'pm' && <>
                                  <button style={s.btnSm('gray')} onClick={() => {
                                    setEditingEstimate(est.id)
                                    setEditEstimateForm({ project_name: est.project_name || '', address: est.address || '', owner_name: est.owner_name || '', owner_company: est.owner_company || '', owner_email: est.owner_email || '', owner_phone: est.owner_phone || '', notes: est.notes || '', status: est.status || 'draft' })
                                    setEditEstimateLines(lines.map(l => ({ description: l.description, amount: String(l.amount) })))
                                  }}>Edit</button>
                                  {est.status !== 'won' && (
                                    <button style={s.btnSm('green')} onClick={() => { setConvertingEst(est.id); setConvertJobForm({ job_number: '', start_date: '' }) }}>Convert to Job</button>
                                  )}
                                  <button style={s.btnSm('red')} onClick={() => deleteEstimate(est.id)}>Delete</button>
                                </>}
                              </div>
                              {convertingEst === est.id && (
                                <div style={{ background: '#0a1a0a', border: '1px solid #1a3a1a', borderRadius: '8px', padding: '1rem' }}>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', margin: '0 0 0.75rem', letterSpacing: '2px', textTransform: 'uppercase' }}>Convert to Active Job</p>
                                  <div style={{ ...s.grid2, marginBottom: '0.75rem' }}>
                                    <div>
                                      <label style={s.label}>Job number *</label>
                                      <input style={s.input} value={convertJobForm.job_number} onChange={e => setConvertJobForm(f => ({ ...f, job_number: e.target.value }))} placeholder="7469" />
                                    </div>
                                    <div>
                                      <label style={s.label}>Start date</label>
                                      <input type="date" style={s.input} value={convertJobForm.start_date} onChange={e => setConvertJobForm(f => ({ ...f, start_date: e.target.value }))} />
                                    </div>
                                  </div>
                                  <p style={{ fontSize: '12px', color: '#888', margin: '0 0 0.75rem', lineHeight: '1.5' }}>
                                    Creates job "{est.project_name}" with {lines.length} budget line{lines.length !== 1 ? 's' : ''} totaling ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}. Estimate will be marked won.
                                  </p>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button style={{ ...s.btnSm('green'), opacity: convertingJob || !convertJobForm.job_number ? 0.6 : 1 }} disabled={convertingJob || !convertJobForm.job_number} onClick={() => convertToJob(est)}>
                                      {convertingJob ? 'Creating job...' : 'Create job & open'}
                                    </button>
                                    <button style={s.btnSm('gray')} onClick={() => setConvertingEst(null)}>Cancel</button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {/* ── BUSINESS DEVELOPMENT ── */}
            {activeTab === 'bd' && (() => {
              const fmt = (n) => n != null && n !== '' ? '$' + Number(n).toLocaleString() : '—'
              const stageCfg = {
                prospect: { label: 'Prospect', color: '#a78bfa', bg: '#1a0a2a', border: '#3a1a5a' },
                bidding:  { label: 'Bidding',  color: '#facc15', bg: '#2a2200', border: '#4a3a00' },
                active:   { label: 'Active',   color: '#60a5fa', bg: '#0a1a2a', border: '#1a3a5a' },
                complete: { label: 'Complete', color: '#4ade80', bg: '#0a2a0a', border: '#1a4a1a' },
                won:      { label: 'Won (BD)',  color: '#34d399', bg: '#0a1e14', border: '#1a3a28' },
                lost:     { label: 'Lost',     color: '#ff6b6b', bg: '#2a0a0a', border: '#5a1a1a' },
              }
              const stageBadge = (stage) => {
                const c = stageCfg[stage] || stageCfg.prospect
                return { padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', background: c.bg, color: c.color, border: `1px solid ${c.border}` }
              }
              const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)
              const getYear = (d) => new Date(d).getFullYear()

              // bd_opportunities for selected year
              const yearOpps = bdOpportunities.filter(o => getYear(o.bid_date || o.created_at) === bdYear)
              // bid packages for selected year (shown as Bidding)
              const yearBids = bdBidPackages.filter(b => getYear(b.due_date || b.created_at) === bdYear)
              // jobs: active = all (ongoing), complete = filtered by year
              const activeJobs = jobs.filter(j => j.status === 'active')
              const completeJobs = jobs.filter(j => j.status === 'complete' && getYear(j.created_at) === bdYear)

              // Unified items
              const oppItems   = yearOpps.map(o => ({ ...o, _type: 'opp',  _stage: o.stage }))
              const bidItems   = yearBids.map(b => ({ ...b, _type: 'bid',  _stage: 'bidding',  project_name: b.jobs?.project_name || b.title, _sub: b.jobs ? `Job #${b.jobs.job_number}` : 'No job linked', _val: null }))
              const activeItems= activeJobs.map(j => ({ ...j, _type: 'job', _stage: 'active',   project_name: j.project_name, _sub: `Job #${j.job_number}`, _val: j.contract_value }))
              const completeItems=completeJobs.map(j => ({ ...j, _type: 'job', _stage: 'complete', project_name: j.project_name, _sub: `Job #${j.job_number}`, _val: j.contract_value }))
              const allItems = [...oppItems, ...bidItems, ...activeItems, ...completeItems]

              const filtered = bdFilterStage === 'all' ? allItems
                : bdFilterStage === 'bidding' ? [...oppItems.filter(o => o.stage === 'bidding'), ...bidItems]
                : bdFilterStage === 'active'  ? activeItems
                : bdFilterStage === 'complete'? completeItems
                : oppItems.filter(o => o._stage === bdFilterStage)

              // Stats
              const biddingTotal = yearOpps.filter(o => o.stage === 'bidding').length + yearBids.length
              const wonOpps  = yearOpps.filter(o => o.stage === 'won')
              const lostOpps = yearOpps.filter(o => o.stage === 'lost')
              const winRate  = (wonOpps.length + lostOpps.length) > 0 ? Math.round((wonOpps.length / (wonOpps.length + lostOpps.length)) * 100) : 0
              const activeRev  = activeJobs.reduce((s, j) => s + (parseFloat(j.contract_value) || 0), 0)
              const completeRev= completeJobs.reduce((s, j) => s + (parseFloat(j.contract_value) || 0), 0)
              const totalRev   = activeRev + completeRev
              const wonBdVal   = wonOpps.reduce((s, o) => s + (parseFloat(o.contract_value) || parseFloat(o.bid_amount) || 0), 0)

              // Profit from forecast data
              const jobsWithBudget = [...activeJobs, ...completeJobs].filter(j => bdProfits[j.id]?.has_budget)
              const totalProjProfit = jobsWithBudget.reduce((s, j) => s + (bdProfits[j.id]?.projected_profit || 0), 0)
              const totalContractForMargin = jobsWithBudget.reduce((s, j) => s + (bdProfits[j.id]?.contract_value || 0), 0)
              const avgMargin = totalContractForMargin > 0 ? Math.round((totalProjProfit / totalContractForMargin) * 100) : null

              const currentGoal = bdGoals.find(g => g.year === bdYear)
              const goalAmt = currentGoal ? parseFloat(currentGoal.revenue_goal) : 0
              const goalVal = totalRev + wonBdVal
              const goalPct = goalAmt > 0 ? Math.min(100, Math.round((goalVal / goalAmt) * 100)) : 0

              const stageCounts = {
                all:      allItems.length,
                bidding:  biddingTotal,
                active:   activeJobs.length,
                complete: completeJobs.length,
                prospect: yearOpps.filter(o => o.stage === 'prospect').length,
                won:      wonOpps.length,
                lost:     lostOpps.length,
              }

              return (
                <>
                  {/* Year selector + goal */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <select value={bdYear} onChange={e => { setBdYear(parseInt(e.target.value)); const g = bdGoals.find(g => g.year === parseInt(e.target.value)); setBdGoalInput(g ? String(g.revenue_goal) : '') }} style={s.filterSelect}>
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <button style={s.btn} onClick={() => { setShowAddBd(v => !v); setEditingBdId(null) }}>{showAddBd ? 'Cancel' : '+ Add Opportunity'}</button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#666' }}>Revenue Goal</span>
                      <input style={{ ...s.input, width: '140px' }} placeholder="$0" value={bdGoalInput} onChange={e => setBdGoalInput(e.target.value)} onFocus={e => e.target.select()} />
                      <button style={s.btnGray} onClick={saveBdGoal} disabled={savingBdGoal}>{savingBdGoal ? 'Saving…' : 'Set Goal'}</button>
                    </div>
                  </div>

                  {bdMsg && <p style={{ fontSize: '13px', color: bdMsg.ok ? '#4ade80' : '#ff6b6b', marginBottom: '1rem' }}>{bdMsg.text}</p>}

                  {/* Stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '1.25rem' }}>
                    {[
                      { label: 'Bidding',       value: biddingTotal,          accent: '#facc15' },
                      { label: 'Active Jobs',   value: activeJobs.length,     accent: '#60a5fa' },
                      { label: 'Complete',      value: completeJobs.length,   accent: '#4ade80' },
                      { label: 'Revenue',       value: fmt(totalRev || null), accent: '#f1f1f1' },
                      { label: 'Proj. Profit',  value: jobsWithBudget.length > 0 ? fmt(totalProjProfit) : '—', accent: totalProjProfit >= 0 ? '#4ade80' : '#ff6b6b' },
                      { label: 'Avg Margin',    value: avgMargin != null ? avgMargin + '%' : '—', accent: avgMargin != null && avgMargin >= 15 ? '#4ade80' : avgMargin != null ? '#e8590c' : '#555' },
                    ].map(({ label, value, accent }) => (
                      <div key={label} style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '10px', padding: '14px 16px' }}>
                        <div style={{ fontSize: '10px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '6px' }}>{label}</div>
                        <div style={{ fontSize: '22px', fontWeight: '800', color: accent }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Revenue goal progress */}
                  {goalAmt > 0 && (
                    <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '10px', padding: '14px 16px', marginBottom: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' }}>{bdYear} Revenue Goal</span>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: goalPct >= 100 ? '#4ade80' : '#f1f1f1' }}>{fmt(goalVal)} / {fmt(goalAmt)} &mdash; {goalPct}%</span>
                      </div>
                      <div style={{ background: '#1a1a1a', borderRadius: '99px', height: '8px', overflow: 'hidden' }}>
                        <div style={{ width: goalPct + '%', height: '100%', background: goalPct >= 100 ? '#4ade80' : '#e8590c', borderRadius: '99px', transition: 'width 0.4s' }} />
                      </div>
                    </div>
                  )}

                  {/* Add opportunity form */}
                  {showAddBd && (
                    <div style={{ ...s.formBox, marginBottom: '1.25rem' }}>
                      <p style={s.formTitle}>New Opportunity</p>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div><label style={s.label}>Project Name *</label><input style={s.input} value={addBdForm.project_name} onChange={e => setAddBdForm(f => ({ ...f, project_name: e.target.value }))} /></div>
                        <div><label style={s.label}>Client / GC</label><input style={s.input} value={addBdForm.client_name} onChange={e => setAddBdForm(f => ({ ...f, client_name: e.target.value }))} /></div>
                      </div>
                      <div style={{ ...s.grid3, marginBottom: '12px' }}>
                        <div>
                          <label style={s.label}>Stage</label>
                          <select style={s.input} value={addBdForm.stage} onChange={e => setAddBdForm(f => ({ ...f, stage: e.target.value }))}>
                            <option value="prospect">Prospect</option>
                            <option value="bidding">Bidding</option>
                            <option value="won">Won</option>
                            <option value="lost">Lost</option>
                          </select>
                        </div>
                        <div><label style={s.label}>Bid Amount</label><input style={s.input} type="number" placeholder="0" value={addBdForm.bid_amount} onChange={e => setAddBdForm(f => ({ ...f, bid_amount: e.target.value }))} onFocus={e => e.target.select()} /></div>
                        <div><label style={s.label}>Bid Date</label><input style={s.input} type="date" value={addBdForm.bid_date} onChange={e => setAddBdForm(f => ({ ...f, bid_date: e.target.value }))} /></div>
                      </div>
                      <div style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div><label style={s.label}>Contract Value (if won)</label><input style={s.input} type="number" placeholder="0" value={addBdForm.contract_value} onChange={e => setAddBdForm(f => ({ ...f, contract_value: e.target.value }))} onFocus={e => e.target.select()} /></div>
                        <div><label style={s.label}>Trade Type</label><input style={s.input} placeholder="e.g. Commercial, Industrial" value={addBdForm.trade_type} onChange={e => setAddBdForm(f => ({ ...f, trade_type: e.target.value }))} /></div>
                      </div>
                      <div style={{ marginBottom: '12px' }}><label style={s.label}>Notes</label><textarea style={{ ...s.input, minHeight: '70px', resize: 'vertical' }} value={addBdForm.notes} onChange={e => setAddBdForm(f => ({ ...f, notes: e.target.value }))} /></div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button style={s.btn} onClick={saveBdOpportunity} disabled={savingBd}>{savingBd ? 'Saving…' : 'Save Opportunity'}</button>
                        <button style={s.btnGray} onClick={() => setShowAddBd(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Stage filter */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    {['all', 'bidding', 'active', 'complete', 'prospect', 'won', 'lost'].map(st => {
                      const isActive = bdFilterStage === st
                      const c = stageCfg[st] || { color: '#888', bg: '#1a1a1a', border: '#2a2a2a' }
                      const label = st === 'all' ? `All (${stageCounts.all})` : `${stageCfg[st]?.label || st} (${stageCounts[st] ?? 0})`
                      return (
                        <button key={st} onClick={() => setBdFilterStage(st)} style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${isActive ? c.border : '#2a2a2a'}`, background: isActive ? c.bg : '#111', color: isActive ? c.color : '#555', letterSpacing: '0.5px' }}>
                          {label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Unified list */}
                  {filtered.length === 0 ? (
                    <p style={s.emptyMsg}>Nothing to show for {bdYear}{bdFilterStage !== 'all' ? ` — ${stageCfg[bdFilterStage]?.label || bdFilterStage}` : ''}.</p>
                  ) : filtered.map(item => {
                    const isExp = expandedBd === item.id
                    const isEditing = editingBdId === item.id
                    const dateStr = item.bid_date ? new Date(item.bid_date + 'T12:00:00').toLocaleDateString()
                      : item.due_date ? new Date(item.due_date + 'T12:00:00').toLocaleDateString()
                      : item.created_at ? new Date(item.created_at).toLocaleDateString()
                      : '—'
                    const valStr = item._type === 'job' ? fmt(item._val) : item.bid_amount ? fmt(item.bid_amount) : '—'
                    return (
                      <div key={`${item._type}-${item.id}`} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 30px', gap: '1rem', padding: '14px 8px', cursor: 'pointer', borderRadius: '8px' }} onClick={() => { setExpandedBd(isExp ? null : item.id); setEditingBdId(null) }}>
                          <div>
                            <p style={s.company}>{item.project_name}</p>
                            <p style={s.meta}>{item._type === 'job' ? item._sub : item._type === 'bid' ? item._sub : item.client_name || ''}</p>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={stageBadge(item._stage)}>{stageCfg[item._stage]?.label || item._stage}</span>
                            {item._type === 'bid' && <span style={{ fontSize: '10px', color: '#555' }}>Bid Pkg</span>}
                            {item._type === 'job' && <span style={{ fontSize: '10px', color: '#555' }}>Job</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center' }}><span style={{ fontSize: '13px', color: '#ccc' }}>{valStr}</span></div>
                          <div style={{ display: 'flex', alignItems: 'center' }}><span style={{ fontSize: '12px', color: '#555' }}>{dateStr}</span></div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}><span style={{ fontSize: '12px', color: '#444' }}>{isExp ? '▲' : '▼'}</span></div>
                        </div>

                        {isExp && (
                          <div style={{ ...s.detail, marginBottom: '8px' }}>
                            {/* Job row — read only, link to detail */}
                            {item._type === 'job' && (() => {
                              const p = bdProfits[item.id]
                              const profitColor = p && p.projected_profit >= 0 ? '#4ade80' : '#ff6b6b'
                              return (
                                <>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                    <div><p style={s.detailLabel}>Job Number</p><p style={s.detailValue}>{item.job_number}</p></div>
                                    <div><p style={s.detailLabel}>Status</p><p style={s.detailValue}><span style={stageBadge(item._stage)}>{stageCfg[item._stage]?.label}</span></p></div>
                                    <div><p style={s.detailLabel}>Contract Value</p><p style={s.detailValue}>{fmt(item.contract_value)}</p></div>
                                    {p?.has_budget ? (
                                      <>
                                        <div><p style={s.detailLabel}>Est. Cost at Completion</p><p style={s.detailValue}>{fmt(p.eac)}</p></div>
                                        <div><p style={s.detailLabel}>Proj. Profit</p><p style={{ ...s.detailValue, color: profitColor, fontWeight: '700' }}>{fmt(p.projected_profit)}</p></div>
                                        <div><p style={s.detailLabel}>Margin</p><p style={{ ...s.detailValue, color: profitColor, fontWeight: '700' }}>{p.margin_pct}%</p></div>
                                      </>
                                    ) : (
                                      <div style={{ gridColumn: '1/-1' }}><p style={{ fontSize: '12px', color: '#555' }}>No budget set — open job to add budget items for profit tracking.</p></div>
                                    )}
                                  </div>
                                  <button style={s.btnSm('orange')} onClick={() => router.push(`/jobdetail?id=${item.id}`)}>Open Job</button>
                                </>
                              )
                            })()}

                            {/* Bid package row — read only */}
                            {item._type === 'bid' && (
                              <>
                                <div style={s.detailGrid}>
                                  <div><p style={s.detailLabel}>Linked Job</p><p style={s.detailValue}>{item.jobs?.project_name || '—'}</p></div>
                                  <div><p style={s.detailLabel}>Status</p><p style={s.detailValue}>{item.status}</p></div>
                                  <div><p style={s.detailLabel}>Due Date</p><p style={s.detailValue}>{item.due_date ? new Date(item.due_date + 'T12:00:00').toLocaleDateString() : '—'}</p></div>
                                  <div><p style={s.detailLabel}>Created</p><p style={s.detailValue}>{new Date(item.created_at).toLocaleDateString()}</p></div>
                                </div>
                                {item.description && <div style={{ marginBottom: '1rem' }}><p style={s.detailLabel}>Description</p><p style={s.detailValue}>{item.description}</p></div>}
                                <p style={{ fontSize: '12px', color: '#555', marginTop: '8px' }}>Manage this bid package in the Estimator tab.</p>
                              </>
                            )}

                            {/* BD opportunity — editable */}
                            {item._type === 'opp' && (
                              isEditing ? (
                                <>
                                  <p style={{ ...s.detailLabel, fontSize: '12px', marginBottom: '1rem' }}>Edit Opportunity</p>
                                  <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                    <div><label style={s.label}>Project Name</label><input style={s.input} value={editBdForm.project_name} onChange={e => setEditBdForm(f => ({ ...f, project_name: e.target.value }))} /></div>
                                    <div><label style={s.label}>Client / GC</label><input style={s.input} value={editBdForm.client_name || ''} onChange={e => setEditBdForm(f => ({ ...f, client_name: e.target.value }))} /></div>
                                  </div>
                                  <div style={{ ...s.grid3, marginBottom: '12px' }}>
                                    <div>
                                      <label style={s.label}>Stage</label>
                                      <select style={s.input} value={editBdForm.stage} onChange={e => setEditBdForm(f => ({ ...f, stage: e.target.value }))}>
                                        <option value="prospect">Prospect</option>
                                        <option value="bidding">Bidding</option>
                                        <option value="won">Won</option>
                                        <option value="lost">Lost</option>
                                      </select>
                                    </div>
                                    <div><label style={s.label}>Bid Amount</label><input style={s.input} type="number" value={editBdForm.bid_amount || ''} onChange={e => setEditBdForm(f => ({ ...f, bid_amount: e.target.value }))} onFocus={e => e.target.select()} /></div>
                                    <div><label style={s.label}>Bid Date</label><input style={s.input} type="date" value={editBdForm.bid_date || ''} onChange={e => setEditBdForm(f => ({ ...f, bid_date: e.target.value }))} /></div>
                                  </div>
                                  <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                    <div><label style={s.label}>Contract Value</label><input style={s.input} type="number" value={editBdForm.contract_value || ''} onChange={e => setEditBdForm(f => ({ ...f, contract_value: e.target.value }))} onFocus={e => e.target.select()} /></div>
                                    <div><label style={s.label}>Trade Type</label><input style={s.input} value={editBdForm.trade_type || ''} onChange={e => setEditBdForm(f => ({ ...f, trade_type: e.target.value }))} /></div>
                                  </div>
                                  <div style={{ marginBottom: '12px' }}><label style={s.label}>Notes</label><textarea style={{ ...s.input, minHeight: '60px', resize: 'vertical' }} value={editBdForm.notes || ''} onChange={e => setEditBdForm(f => ({ ...f, notes: e.target.value }))} /></div>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button style={s.btnSm('orange')} onClick={updateBdOpportunity} disabled={savingBdEdit}>{savingBdEdit ? 'Saving…' : 'Save'}</button>
                                    <button style={s.btnSm('gray')} onClick={() => setEditingBdId(null)}>Cancel</button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div style={s.detailGrid}>
                                    <div><p style={s.detailLabel}>Client / GC</p><p style={s.detailValue}>{item.client_name || '—'}</p></div>
                                    <div><p style={s.detailLabel}>Stage</p><p style={s.detailValue}><span style={stageBadge(item.stage)}>{stageCfg[item.stage]?.label || item.stage}</span></p></div>
                                    <div><p style={s.detailLabel}>Bid Amount</p><p style={s.detailValue}>{fmt(item.bid_amount)}</p></div>
                                    <div><p style={s.detailLabel}>Contract Value</p><p style={s.detailValue}>{fmt(item.contract_value)}</p></div>
                                    <div><p style={s.detailLabel}>Bid Date</p><p style={s.detailValue}>{item.bid_date ? new Date(item.bid_date + 'T12:00:00').toLocaleDateString() : '—'}</p></div>
                                    <div><p style={s.detailLabel}>Trade Type</p><p style={s.detailValue}>{item.trade_type || '—'}</p></div>
                                  </div>
                                  {item.notes && <div style={{ marginBottom: '1rem' }}><p style={s.detailLabel}>Notes</p><p style={{ ...s.detailValue, whiteSpace: 'pre-wrap' }}>{item.notes}</p></div>}
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button style={s.btnSm('orange')} onClick={() => { setEditingBdId(item.id); setEditBdForm({ project_name: item.project_name, client_name: item.client_name || '', stage: item.stage, bid_amount: item.bid_amount || '', contract_value: item.contract_value || '', bid_date: item.bid_date || '', trade_type: item.trade_type || '', notes: item.notes || '' }) }}>Edit</button>
                                    <button style={s.btnSm('red')} onClick={() => deleteBdOpportunity(item.id)}>Delete</button>
                                  </div>
                                </>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )
            })()}

          </div>
        </div>
      </main>
    </div>
  )
}
