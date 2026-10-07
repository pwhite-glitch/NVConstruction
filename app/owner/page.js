'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const s = {
  root: { display: 'flex', minHeight: '100vh', background: '#f4f6f8', fontFamily: 'system-ui,-apple-system,sans-serif' },

  // ── Sidebar — dark charcoal ──
  sidebar: { width: '240px', flexShrink: 0, background: '#1a2332', borderRight: '1px solid rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', padding: '0 0 1.5rem', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' },
  devBanner: { background: 'rgba(124,58,237,0.15)', borderBottom: '1px solid rgba(124,58,237,0.3)', color: '#7c3aed', fontSize: '10px', fontWeight: '700', letterSpacing: '1px', textAlign: 'center', padding: '6px', textTransform: 'uppercase' },
  logoWrap: { padding: '1.25rem 1rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  sidebarLabel: { fontSize: '10px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)', padding: '1.25rem 1rem 0.5rem' },
  jobBtn: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', width: '100%', padding: '9px 1rem', background: 'transparent', border: 'none', borderLeft: '3px solid transparent', cursor: 'pointer', textAlign: 'left' },
  jobBtnActive: { background: 'rgba(232,89,12,0.12)', borderLeftColor: '#e8590c' },
  jobBtnName: { fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.85)', lineHeight: 1.3 },
  jobBtnNum: { fontSize: '11px', color: '#64748b' },
  noJobs: { fontSize: '13px', color: '#64748b', padding: '1rem', fontStyle: 'italic' },
  logoutBtn: { margin: '0 1rem', padding: '7px 0', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#64748b', fontSize: '12px', fontWeight: '500', cursor: 'pointer' },

  // ── Main content ──
  main: { flex: 1, minWidth: 0, padding: '2rem 2rem 4rem' },
  jobHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' },
  jobTitle: { fontSize: '1.25rem', fontWeight: '700', margin: 0, color: '#111827' },
  jobMeta: { fontSize: '13px', color: '#6b7280', marginTop: '4px' },
  tabNav: { display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: '1.5rem', overflowX: 'auto' },
  tabBtn: { padding: '9px 16px', background: 'transparent', border: 'none', borderBottom: '2px solid transparent', color: '#6b7280', fontSize: '13px', fontWeight: '500', cursor: 'pointer', whiteSpace: 'nowrap' },
  tabBtnActive: { color: '#e8590c', borderBottomColor: '#e8590c', fontWeight: '600' },

  // ── Cards ──
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem 1.5rem', marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  cardTitle: { fontSize: '11px', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase', color: '#6b7280', marginBottom: '1rem' },

  // ── Stats ──
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.25rem' },
  statCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  statLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase', color: '#6b7280', marginBottom: '4px' },
  statValue: { fontSize: '1.25rem', fontWeight: '700', color: '#111827', fontVariantNumeric: 'tabular-nums' },
  statSub: { fontSize: '11px', color: '#9ca3af', marginTop: '3px' },

  // ── Detail grid ──
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' },
  detailLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase', color: '#6b7280', marginBottom: '4px' },
  detailValue: { fontSize: '13px', color: '#111827' },

  // ── Budget rows ──
  budgetRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f3f4f6', fontSize: '14px', fontVariantNumeric: 'tabular-nums', color: '#374151' },
  budgetRowTotal: { fontWeight: '700', fontSize: '15px', color: '#111827', borderBottom: 'none', borderTop: '1px solid #e5e7eb', paddingTop: '12px', marginTop: '4px' },
  progressBarWrap: { height: '5px', background: '#f3f4f6', borderRadius: '99px', overflow: 'hidden', marginTop: '1rem' },
  progressBar: { height: '100%', background: '#e8590c', borderRadius: '99px' },

  // ── Tables ──
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '8px 12px', fontSize: '11px', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' },
  td: { padding: '10px 12px', borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'middle' },

  // ── Empty states ──
  emptyMsg: { fontSize: '13px', color: '#9ca3af', padding: '2rem 0', textAlign: 'center' },
  emptyState: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#9ca3af', fontSize: '14px' },

  // ── RFI rows ──
  rfiRow: { borderBottom: '1px solid #f3f4f6' },
  rfiHeader: { display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px', cursor: 'pointer', userSelect: 'none' },
  rfiBody: { padding: '0 14px 14px', borderTop: '1px solid #e5e7eb' },

  // ── Comments ──
  commentBubble: { background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '8px 12px', marginTop: '6px' },
  commentMeta: { display: 'flex', gap: '8px', marginBottom: '4px', alignItems: 'baseline' },
  commentAuthor: { fontSize: '11px', fontWeight: '700', color: '#e8590c', textTransform: 'uppercase', letterSpacing: '.04em' },
  commentDate: { fontSize: '11px', color: '#9ca3af' },
  commentText: { fontSize: '13px', color: '#374151', lineHeight: 1.5 },
  textarea: { width: '100%', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', color: '#111827', padding: '8px 10px', fontSize: '13px', resize: 'vertical', minHeight: '70px', outline: 'none', marginTop: '6px', boxSizing: 'border-box' },
  btn: { padding: '7px 16px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
}

function statusBadge(status) {
  const map = {
    active:    { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
    complete:  { background: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb' },
    'on-hold': { background: '#fefce8', color: '#a16207', border: '1px solid #fde68a' },
    open:      { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
    closed:    { background: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb' },
    approved:  { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
    pending:   { background: '#fefce8', color: '#a16207', border: '1px solid #fde68a' },
    rejected:  { background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' },
    submitted: { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
    answered:  { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
  }
  const style = map[status?.toLowerCase()] || { background: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb' }
  return { ...style, fontSize: '10px', fontWeight: '600', letterSpacing: '.06em', textTransform: 'uppercase', padding: '3px 7px', borderRadius: '4px', whiteSpace: 'nowrap' }
}

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d.includes('T') ? d : d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return d }
}

export default function OwnerPortal() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isDevPreview, setIsDevPreview] = useState(false)
  const [currentUserName, setCurrentUserName] = useState('')
  const [currentUserEmail, setCurrentUserEmail] = useState('')

  // Job list & selection
  const [jobs, setJobs] = useState([])
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  // Per-job data
  const [job, setJob] = useState(null)
  const [pmProfile, setPmProfile] = useState(null)
  const [changeOrders, setChangeOrders] = useState([])
  const [rfis, setRfis] = useState([])
  const [rfiComments, setRfiComments] = useState({})
  const [aiaApps, setAiaApps] = useState([])
  const [drawRequests, setDrawRequests] = useState([])
  const [milestones, setMilestones] = useState([])
  const [photos, setPhotos] = useState([])
  const [loadingJob, setLoadingJob] = useState(false)

  // RFI UI
  const [expandedRfi, setExpandedRfi] = useState(null)
  const [commentDrafts, setCommentDrafts] = useState({})
  const [submittingComment, setSubmittingComment] = useState(null)

  useEffect(() => { init() }, [])

  async function init() {
    const devRole = typeof window !== 'undefined' ? localStorage.getItem('nvc_dev_role') : null
    const pmSession = typeof window !== 'undefined' ? localStorage.getItem('nvc_pm_session') : null

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    const { data: profile } = await supabase.from('profiles').select('role, full_name, invite_email').eq('id', session.user.id).single()

    const dev = devRole === 'owner' && (pmSession === '1' || ['pm', 'apm', 'admin'].includes(profile?.role))
    setIsDevPreview(dev)
    setCurrentUserName(profile?.full_name || session.user.email)
    setCurrentUserEmail(session.user.email)

    if (!dev && profile?.role !== 'owner') {
      router.push('/login')
      return
    }

    let q = supabase.from('jobs').select('*').order('project_name')
    if (!dev) q = q.eq('owner_email', session.user.email)

    const { data: jobsData } = await q
    const list = jobsData || []
    setJobs(list)
    if (list.length > 0) setSelectedJobId(list[0].id)
    setLoading(false)
  }

  useEffect(() => {
    if (!selectedJobId || !jobs.length) return
    const j = jobs.find(j => j.id === selectedJobId) || null
    setJob(j)
    setActiveTab('overview')
    loadJobData(selectedJobId, j)
  }, [selectedJobId])

  async function loadJobData(jobId, jobObj) {
    setLoadingJob(true)
    setChangeOrders([]); setRfis([]); setRfiComments({}); setAiaApps([])
    setDrawRequests([]); setMilestones([]); setPhotos([]); setPmProfile(null)

    const [cosRes, rfisRes, aiaRes, drawRes, milestonesRes] = await Promise.all([
      supabase.from('change_orders').select('*').eq('job_id', jobId).order('co_number', { ascending: true }),
      supabase.from('rfis').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
      supabase.from('aia_applications').select('*').eq('job_id', jobId).order('application_number', { ascending: true }),
      supabase.from('draw_requests').select('*').eq('job_id', jobId).order('draw_number', { ascending: true }),
      supabase.from('milestones').select('*').eq('job_id', jobId).order('due_date', { ascending: true }),
    ])

    setChangeOrders(cosRes.data || [])
    const rfiList = rfisRes.data || []
    setRfis(rfiList)
    setAiaApps(aiaRes.data || [])
    setDrawRequests(drawRes.data || [])
    setMilestones(milestonesRes.data || [])

    // Load PM profile
    const pmEmail = jobObj?.pm_email
    if (pmEmail) {
      const { data: pm } = await supabase.from('profiles').select('full_name, phone').eq('invite_email', pmEmail).maybeSingle()
      setPmProfile(pm)
    }

    // Load RFI comments
    if (rfiList.length > 0) {
      const ids = rfiList.map(r => r.id)
      const { data: comments } = await supabase.from('rfi_comments').select('*').in('rfi_id', ids).order('created_at', { ascending: true })
      const byRfi = {}
      ;(comments || []).forEach(c => {
        if (!byRfi[c.rfi_id]) byRfi[c.rfi_id] = []
        byRfi[c.rfi_id].push(c)
      })
      setRfiComments(byRfi)
    }

    // Load photos
    try {
      const { data: files } = await supabase.storage.from('job-photos').list(jobId, { limit: 100 })
      if (files?.length) {
        const valid = files.filter(f => f.name !== '.emptyFolderPlaceholder' && !f.name.startsWith('.'))
        const signed = await Promise.all(valid.map(async f => {
          const { data } = await supabase.storage.from('job-photos').createSignedUrl(`${jobId}/${f.name}`, 3600)
          return data?.signedUrl ? { name: f.name, url: data.signedUrl } : null
        }))
        setPhotos(signed.filter(Boolean))
      }
    } catch { setPhotos([]) }

    setLoadingJob(false)
  }

  async function submitComment(rfiId) {
    const text = (commentDrafts[rfiId] || '').trim()
    if (!text) return
    setSubmittingComment(rfiId)
    try {
      await fetch('/api/rfi-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rfi_id: rfiId,
          job_id: selectedJobId,
          author_name: isDevPreview ? `${currentUserName} (Preview)` : currentUserName,
          author_role: 'owner',
          comment: text,
        }),
      })
      setCommentDrafts(d => ({ ...d, [rfiId]: '' }))
      const { data } = await supabase.from('rfi_comments').select('*').eq('rfi_id', rfiId).order('created_at', { ascending: true })
      setRfiComments(prev => ({ ...prev, [rfiId]: data || [] }))
    } finally {
      setSubmittingComment(null)
    }
  }

  // Budget numbers
  const baseContract = Number(job?.contract_value || 0)
  const approvedCOs = changeOrders.filter(c => c.status === 'approved').reduce((s, c) => s + Number(c.amount || 0), 0)
  const revised = baseContract + approvedCOs
  const aiaBilled = aiaApps.reduce((s, a) => s + Number(a.net_payment || a.amount || 0), 0)
  const drawBilled = drawRequests.reduce((s, d) => s + Number(d.total_amount || d.amount || 0), 0)
  const totalBilled = aiaBilled || drawBilled
  const pct = revised > 0 ? Math.min(100, Math.round(totalBilled / revised * 100)) : 0
  const openRfis = rfis.filter(r => !['closed', 'answered'].includes(r.status?.toLowerCase())).length
  const nextMilestone = milestones.find(m => !m.completed_at && m.status !== 'complete')
  const hasAia = aiaApps.length > 0
  const hasDraws = drawRequests.length > 0

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'budget', label: 'Budget' },
    ...(hasAia || !hasDraws ? [{ id: 'payapps', label: 'Pay Applications' }] : []),
    ...(hasDraws || !hasAia ? [{ id: 'draws', label: 'Draw Requests' }] : []),
    { id: 'modifications', label: 'Modifications' },
    { id: 'rfis', label: `RFIs${openRfis > 0 ? ` (${openRfis})` : ''}` },
    { id: 'photos', label: 'Photos' },
    { id: 'milestones', label: 'Schedule' },
  ]

  if (loading) return (
    <div style={{ ...s.root, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#6b7280', fontSize: '14px' }}>Loading...</div>
    </div>
  )

  return (
    <div style={s.root}>
      {/* Sidebar */}
      <aside style={s.sidebar}>
        {isDevPreview && <div style={s.devBanner}>Dev Preview — All Jobs</div>}
        <div style={s.logoWrap}>
          <img src="/logo.png" alt="NV Construction" style={{ height: '30px', objectFit: 'contain' }} />
        </div>
        <div style={s.sidebarLabel}>Your Projects</div>
        {jobs.map(j => (
          <button
            key={j.id}
            style={{ ...s.jobBtn, ...(j.id === selectedJobId ? s.jobBtnActive : {}) }}
            onClick={() => setSelectedJobId(j.id)}
          >
            <span style={s.jobBtnName}>{j.project_name}</span>
            <span style={s.jobBtnNum}>#{j.job_number}</span>
          </button>
        ))}
        {jobs.length === 0 && <div style={s.noJobs}>No projects linked to your account.</div>}
        <div style={{ flex: 1 }} />
        <button
          style={s.logoutBtn}
          onClick={async () => {
            await supabase.auth.signOut()
            if (typeof window !== 'undefined') localStorage.removeItem('nvc_dev_role')
            router.push('/login')
          }}
        >
          Sign out
        </button>
      </aside>

      {/* Main */}
      <main style={s.main}>
        {!job ? (
          <div style={s.emptyState}>Select a project from the left to get started.</div>
        ) : (
          <>
            {/* Header */}
            <div style={s.jobHeader}>
              <div>
                <h1 style={s.jobTitle}>{job.project_name}</h1>
                <div style={s.jobMeta}>{[job.location, job.job_number ? `Job #${job.job_number}` : null].filter(Boolean).join(' · ')}</div>
              </div>
              <span style={statusBadge(job.status)}>{(job.status || 'active').toUpperCase()}</span>
            </div>

            {/* Tabs */}
            <nav style={s.tabNav}>
              {TABS.map(t => (
                <button
                  key={t.id}
                  style={{ ...s.tabBtn, ...(activeTab === t.id ? s.tabBtnActive : {}) }}
                  onClick={() => setActiveTab(t.id)}
                >{t.label}</button>
              ))}
            </nav>

            {loadingJob ? (
              <div style={{ color: '#6b7280', fontSize: '13px', padding: '2rem 0' }}>Loading project data...</div>
            ) : (
              <div>

                {/* ── OVERVIEW ── */}
                {activeTab === 'overview' && (
                  <div>
                    <div style={s.statGrid}>
                      <div style={s.statCard}>
                        <div style={s.statLabel}>Contract Value</div>
                        <div style={s.statValue}>{fmt(revised)}</div>
                        {approvedCOs !== 0 && <div style={s.statSub}>{approvedCOs >= 0 ? '+' : ''}{fmt(approvedCOs)} in modifications</div>}
                      </div>
                      <div style={s.statCard}>
                        <div style={s.statLabel}>Billed to Date</div>
                        <div style={s.statValue}>{fmt(totalBilled)}</div>
                        <div style={s.statSub}>{pct}% of contract</div>
                      </div>
                      <div style={s.statCard}>
                        <div style={s.statLabel}>Open RFIs</div>
                        <div style={{ ...s.statValue, color: openRfis > 0 ? '#fbbf24' : '#4ade80' }}>{openRfis}</div>
                        <div style={s.statSub}>{rfis.length} total</div>
                      </div>
                      <div style={s.statCard}>
                        <div style={s.statLabel}>Next Milestone</div>
                        <div style={{ ...s.statValue, fontSize: '1rem', lineHeight: 1.3 }}>{nextMilestone?.title || nextMilestone?.name || '—'}</div>
                        {nextMilestone?.due_date && <div style={s.statSub}>Due {fmtDate(nextMilestone.due_date)}</div>}
                      </div>
                    </div>

                    <div style={s.card}>
                      <div style={s.cardTitle}>Project Details</div>
                      <div style={s.detailGrid}>
                        <div><div style={s.detailLabel}>Address</div><div style={s.detailValue}>{job.location || '—'}</div></div>
                        <div><div style={s.detailLabel}>Status</div><div style={s.detailValue}>{job.status || '—'}</div></div>
                        <div><div style={s.detailLabel}>Start Date</div><div style={s.detailValue}>{fmtDate(job.start_date)}</div></div>
                        <div><div style={s.detailLabel}>Expected Completion</div><div style={s.detailValue}>{fmtDate(job.end_date)}</div></div>
                        {job.owner_company && <div><div style={s.detailLabel}>Owner</div><div style={s.detailValue}>{job.owner_company}</div></div>}
                      </div>
                    </div>

                    <div style={s.card}>
                      <div style={s.cardTitle}>Your Project Manager</div>
                      <div style={s.detailGrid}>
                        <div><div style={s.detailLabel}>Name</div><div style={s.detailValue}>{pmProfile?.full_name || job.pm_email || '—'}</div></div>
                        <div><div style={s.detailLabel}>Phone</div><div style={s.detailValue}>{pmProfile?.phone || '—'}</div></div>
                        <div><div style={s.detailLabel}>Email</div><div style={s.detailValue}>{job.pm_email || '—'}</div></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── BUDGET ── */}
                {activeTab === 'budget' && (
                  <div style={s.card}>
                    <div style={s.cardTitle}>Budget Summary</div>
                    <div style={s.budgetRow}><span style={{ color: '#6b7280' }}>Original Contract Value</span><span>{fmt(baseContract)}</span></div>
                    <div style={s.budgetRow}>
                      <span style={{ color: '#6b7280' }}>Approved Modifications ({changeOrders.filter(c => c.status === 'approved').length})</span>
                      <span style={{ color: approvedCOs >= 0 ? '#4ade80' : '#f87171' }}>{approvedCOs >= 0 ? '+' : ''}{fmt(approvedCOs)}</span>
                    </div>
                    <div style={{ ...s.budgetRow, ...s.budgetRowTotal }}><span>Revised Contract Total</span><span>{fmt(revised)}</span></div>
                    <div style={{ ...s.budgetRow, marginTop: '1.5rem' }}><span style={{ color: '#6b7280' }}>Amount Billed to Date</span><span>{fmt(totalBilled)}</span></div>
                    <div style={s.budgetRow}><span style={{ color: '#6b7280' }}>Remaining Balance</span><span style={{ color: '#16a34a' }}>{fmt(Math.max(0, revised - totalBilled))}</span></div>
                    <div style={s.progressBarWrap}>
                      <div style={{ ...s.progressBar, width: `${pct}%` }} />
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', textAlign: 'right', marginTop: '6px' }}>{pct}% billed</div>
                  </div>
                )}

                {/* ── PAY APPLICATIONS ── */}
                {activeTab === 'payapps' && (
                  <div style={s.card}>
                    <div style={s.cardTitle}>Pay Applications ({aiaApps.length})</div>
                    {aiaApps.length === 0 ? <div style={s.emptyMsg}>No pay applications submitted yet.</div> : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={s.table}>
                          <thead>
                            <tr>
                              <th style={s.th}>App #</th>
                              <th style={s.th}>Period</th>
                              <th style={s.th}>Amount</th>
                              <th style={s.th}>Status</th>
                              <th style={s.th}>Submitted</th>
                            </tr>
                          </thead>
                          <tbody>
                            {aiaApps.map(a => (
                              <tr key={a.id}>
                                <td style={s.td}>{a.application_number || '—'}</td>
                                <td style={s.td}>{a.period_to ? new Date(a.period_to + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}</td>
                                <td style={{ ...s.td, fontVariantNumeric: 'tabular-nums' }}>{fmt(a.net_payment || a.amount)}</td>
                                <td style={s.td}><span style={statusBadge(a.status)}>{a.status || 'submitted'}</span></td>
                                <td style={s.td}>{fmtDate(a.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── DRAW REQUESTS ── */}
                {activeTab === 'draws' && (
                  <div style={s.card}>
                    <div style={s.cardTitle}>Draw Requests ({drawRequests.length})</div>
                    {drawRequests.length === 0 ? <div style={s.emptyMsg}>No draw requests submitted yet.</div> : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={s.table}>
                          <thead>
                            <tr>
                              <th style={s.th}>Draw #</th>
                              <th style={s.th}>Title</th>
                              <th style={s.th}>Amount</th>
                              <th style={s.th}>Status</th>
                              <th style={s.th}>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {drawRequests.map(d => (
                              <tr key={d.id}>
                                <td style={s.td}>{String(d.draw_number || '').padStart(3, '0')}</td>
                                <td style={s.td}>{d.title || '—'}</td>
                                <td style={{ ...s.td, fontVariantNumeric: 'tabular-nums' }}>{d.total_amount || d.amount ? fmt(d.total_amount || d.amount) : '—'}</td>
                                <td style={s.td}><span style={statusBadge(d.status)}>{d.status || 'open'}</span></td>
                                <td style={s.td}>{fmtDate(d.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── CONTRACT MODIFICATIONS ── */}
                {activeTab === 'modifications' && (
                  <div>
                    <div style={s.card}>
                      <div style={s.cardTitle}>Contract Modifications ({changeOrders.length})</div>
                      {changeOrders.length === 0 ? <div style={s.emptyMsg}>No contract modifications on this project.</div> : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={s.table}>
                            <thead>
                              <tr>
                                <th style={s.th}>Mod #</th>
                                <th style={s.th}>Description</th>
                                <th style={s.th}>Amount</th>
                                <th style={s.th}>Status</th>
                                <th style={s.th}>Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changeOrders.map(co => (
                                <tr key={co.id}>
                                  <td style={s.td}>{co.co_number || co.number || '—'}</td>
                                  <td style={s.td}>{co.description || co.title || '—'}</td>
                                  <td style={{ ...s.td, fontVariantNumeric: 'tabular-nums', color: Number(co.amount) >= 0 ? '#4ade80' : '#f87171' }}>
                                    {Number(co.amount) >= 0 ? '+' : ''}{fmt(co.amount)}
                                  </td>
                                  <td style={s.td}><span style={statusBadge(co.status)}>{co.status || 'pending'}</span></td>
                                  <td style={s.td}>{fmtDate(co.created_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    <div style={s.card}>
                      <div style={s.cardTitle}>Contract Summary</div>
                      <div style={s.budgetRow}><span style={{ color: '#6b7280' }}>Original Contract</span><span>{fmt(baseContract)}</span></div>
                      <div style={s.budgetRow}><span style={{ color: '#6b7280' }}>Total Approved Modifications</span><span style={{ color: approvedCOs >= 0 ? '#4ade80' : '#f87171' }}>{approvedCOs >= 0 ? '+' : ''}{fmt(approvedCOs)}</span></div>
                      <div style={{ ...s.budgetRow, ...s.budgetRowTotal }}><span>Revised Contract</span><span>{fmt(revised)}</span></div>
                    </div>
                  </div>
                )}

                {/* ── RFIs ── */}
                {activeTab === 'rfis' && (
                  <div style={s.card}>
                    <div style={s.cardTitle}>RFIs ({rfis.length})</div>
                    {rfis.length === 0 ? <div style={s.emptyMsg}>No RFIs on this project.</div> : (
                      <div style={{ borderRadius: '6px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                        {rfis.map((rfi, i) => {
                          const comments = rfiComments[rfi.id] || []
                          const isOpen = expandedRfi === rfi.id
                          const draft = commentDrafts[rfi.id] || ''
                          return (
                            <div key={rfi.id} style={{ borderBottom: i < rfis.length - 1 ? '1px solid #e5e7eb' : 'none', background: '#1a2332' }}>
                              <div style={s.rfiHeader} onClick={() => setExpandedRfi(isOpen ? null : rfi.id)}>
                                <span style={statusBadge(rfi.status || 'open')}>{rfi.status || 'open'}</span>
                                <span style={{ fontSize: '13px', fontWeight: '600', flex: 1, color: '#111827' }}>
                                  RFI #{rfi.rfi_number || rfi.number} — {rfi.question || rfi.title || 'Untitled'}
                                </span>
                                {comments.length > 0 && <span style={{ fontSize: '11px', color: '#6b7280' }}>{comments.length} comment{comments.length !== 1 ? 's' : ''}</span>}
                                <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '4px' }}>{isOpen ? '▲' : '▼'}</span>
                              </div>
                              {isOpen && (
                                <div style={s.rfiBody}>
                                  {rfi.question && <div style={{ marginBottom: '10px' }}><div style={s.detailLabel}>Question</div><div style={{ fontSize: '13px', color: '#374151', marginTop: '4px', lineHeight: 1.5 }}>{rfi.question}</div></div>}
                                  {rfi.answer && <div style={{ marginBottom: '12px', background: '#ffffff', borderRadius: '6px', padding: '10px 12px', borderLeft: '3px solid #4ade80' }}><div style={{ ...s.detailLabel, color: '#16a34a', marginBottom: '4px' }}>Response</div><div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5 }}>{rfi.answer}</div></div>}
                                  {rfi.submitted_by && <div style={{ ...s.detailLabel, marginBottom: '12px' }}>Submitted by {rfi.submitted_by} · {fmtDate(rfi.created_at)}</div>}

                                  {comments.length > 0 && (
                                    <div style={{ marginBottom: '12px' }}>
                                      <div style={{ ...s.detailLabel, marginBottom: '6px' }}>Comments</div>
                                      {comments.map(c => (
                                        <div key={c.id} style={s.commentBubble}>
                                          <div style={s.commentMeta}>
                                            <span style={s.commentAuthor}>{c.author_name}</span>
                                            <span style={s.commentDate}>{fmtDate(c.created_at)}</span>
                                          </div>
                                          <div style={s.commentText}>{c.comment}</div>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  <div>
                                    <div style={s.detailLabel}>Add a Comment</div>
                                    <textarea
                                      style={s.textarea}
                                      value={draft}
                                      onChange={e => setCommentDrafts(d => ({ ...d, [rfi.id]: e.target.value }))}
                                      placeholder="Type your comment or question for the PM..."
                                    />
                                    <button
                                      style={{ ...s.btn, marginTop: '8px', ...(submittingComment === rfi.id || !draft.trim() ? s.btnDisabled : {}) }}
                                      disabled={submittingComment === rfi.id || !draft.trim()}
                                      onClick={() => submitComment(rfi.id)}
                                    >
                                      {submittingComment === rfi.id ? 'Sending...' : 'Send Comment'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── PHOTOS ── */}
                {activeTab === 'photos' && (
                  <div style={s.card}>
                    <div style={s.cardTitle}>Progress Photos ({photos.length})</div>
                    {photos.length === 0 ? <div style={s.emptyMsg}>No photos uploaded for this project yet.</div> : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '8px' }}>
                        {photos.map(p => (
                          <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e5e7eb', aspectRatio: '4/3' }}>
                            <img src={p.url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── MILESTONES ── */}
                {activeTab === 'milestones' && (
                  <div style={s.card}>
                    <div style={s.cardTitle}>Project Schedule ({milestones.length})</div>
                    {milestones.length === 0 ? <div style={s.emptyMsg}>No milestones set for this project.</div> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        {milestones.map(m => {
                          const done = !!(m.completed_at || m.status === 'complete')
                          return (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 4px', borderBottom: '1px solid #e5e7eb' }}>
                              <div style={{ width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, background: done ? '#4ade80' : 'transparent', border: `2px solid ${done ? '#4ade80' : '#64748b'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {done && <span style={{ color: '#f4f6f8', fontSize: '10px', fontWeight: '900' }}>✓</span>}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '13px', fontWeight: '600', color: done ? '#6b7280' : '#e6e8f0', textDecoration: done ? 'line-through' : 'none' }}>{m.title || m.name}</div>
                                {m.due_date && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>Due {fmtDate(m.due_date)}</div>}
                              </div>
                              {done ? (
                                <span style={{ fontSize: '11px', fontWeight: '700', color: '#16a34a' }}>COMPLETE</span>
                              ) : m.due_date && new Date(m.due_date) < new Date() ? (
                                <span style={{ fontSize: '11px', fontWeight: '700', color: '#dc2626' }}>OVERDUE</span>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
