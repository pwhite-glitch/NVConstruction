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
  btnSm: (color) => ({ padding: '7px 16px', background: color === 'red' ? '#2a0a0a' : color === 'green' ? '#0a1a0a' : '#1a1a1a', color: color === 'red' ? '#ff6b6b' : color === 'green' ? '#4ade80' : '#888', border: `1px solid ${color === 'red' ? '#5a1a1a' : color === 'green' ? '#1a4a1a' : '#2a2a2a'}`, borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }),
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
  applyLink: { background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' },
  applyLinkText: { fontSize: '13px', color: '#888' },
  applyLinkUrl: { fontSize: '13px', color: '#e8590c', fontWeight: '600', cursor: 'pointer' },
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

  async function updateDirStatus(id, status) {
    await supabase.from('sub_directory').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    await loadAll()
  }

async function deleteDirEntry(id) {
    const { data: { session } } = await supabase.auth.getSession()
    console.log('Session user:', session?.user?.id)
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', session?.user?.id).single()
    console.log('Profile role:', prof?.role)
    const { error } = await supabase.from('sub_directory').delete().eq('id', id)
    console.log('Delete error:', error)
    console.log('Delete id:', id)
    if (error) { alert('Delete error: ' + error.message); return }
    setDirectory(prev => prev.filter(s => s.id !== id))
    setExpandedDir(null)
  }
  async function addJob(e) {
    e.preventDefault()
    const { error } = await supabase.from('jobs').insert({
      job_number: newJob.job_number, project_name: newJob.project_name,
      location: newJob.location || null, contract_value: newJob.contract_value ? parseFloat(newJob.contract_value) : null,
      start_date: newJob.start_date || null, status: newJob.status,
    })
    if (error) { setJobMsg('Error: ' + error.message); return }
    setJobMsg('Job added successfully.')
    setNewJob({ job_number: '', project_name: '', location: '', contract_value: '', start_date: '', status: 'active' })
    await loadAll()
    setTimeout(() => setJobMsg(''), 3000)
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

  async function getDocUrl(path) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#555' }}>Loading...</div>

  const filtered = submissions.filter(s => (!filterStatus || s.status === filterStatus) && (!filterJob || s.jobs?.job_number === filterJob))
  const pending = submissions.filter(s => s.status === 'pending')
  const totalBilled = submissions.reduce((a, s) => a + (s.amount_billed || 0), 0)
  const totalThisWeek = submissions.filter(s => new Date(s.submitted_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).reduce((a, s) => a + (s.amount_billed || 0), 0)
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const expiringCOIs = directory.filter(s => s.status === 'approved' && s.coi_expiration && new Date(s.coi_expiration) < thirtyDaysFromNow)
  const filteredDir = directory.filter(s =>
    (!filterDirStatus || s.status === filterDirStatus) &&
    (!filterTrade || s.trade === filterTrade) &&
    (!searchDir || s.company_name.toLowerCase().includes(searchDir.toLowerCase()) || s.contact_name.toLowerCase().includes(searchDir.toLowerCase()))
  )
  const pendingApps = directory.filter(s => s.status === 'pending').length

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
              Sub directory {pendingApps > 0 ? `(${pendingApps})` : ''}
            </button>
            <button style={s.tab(activeTab === 'jobs')} onClick={() => setActiveTab('jobs')}>Jobs</button>
            <button style={s.tab(activeTab === 'invite')} onClick={() => setActiveTab('invite')}>Invite subs</button>
          </div>

          <div style={s.cardBody}>

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
                        <div style={s.detailGrid}>
                          <div><div style={s.detailLabel}>Contact</div><div style={s.detailValue}>{sub.contact_name} · {sub.contact_info}</div></div>
                          <div><div style={s.detailLabel}>% complete</div><div style={s.detailValue}>{sub.pct_complete ?? '—'}%</div></div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                          <div style={s.detailLabel}>Work description</div>
                          <div style={{ ...s.detailValue, lineHeight: '1.7' }}>{sub.work_description}</div>
                        </div>
                        {sub.status === 'pending' && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => updateStatus(sub.id, 'approved')} style={s.btnSm('green')}>Approve</button>
                            <button onClick={() => updateStatus(sub.id, 'rejected')} style={s.btnSm('red')}>Reject</button>
                          </div>
                        )}
                        {sub.status !== 'pending' && <div style={s.meta}>Reviewed {sub.reviewed_at ? new Date(sub.reviewed_at).toLocaleDateString() : '—'}</div>}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {activeTab === 'directory' && (
              <>
                <div style={s.applyLink}>
                  <span style={s.applyLinkText}>Share this link with subs to apply to your network:</span>
                  <span style={s.applyLinkUrl} onClick={() => navigator.clipboard.writeText(window.location.origin + '/apply')} title="Click to copy">
                    {typeof window !== 'undefined' ? window.location.origin : ''}/apply ⧉
                  </span>
                </div>

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
                    )}
                  </div>
                ))}
              </>
            )}

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
                      {jobMsg && <span style={{ fontSize: '13px', color: '#4ade80' }}>{jobMsg}</span>}
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

            {activeTab === 'invite' && (
              <>
                <div style={s.formBox}>
                  <p style={s.formTitle}>Invite subcontractor to a job</p>
                  <form onSubmit={inviteSub}>
                    <div style={{ ...s.grid2, marginBottom: '1.25rem' }}>
                      <div><label style={s.label}>Sub's email address</label><input type="email" style={s.input} value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required placeholder="sub@company.com" /></div>
                      <div>
                        <label style={s.label}>Job</label>
                        <select style={s.input} value={inviteJobId} onChange={e => setInviteJobId(e.target.value)} required>
                          <option value="">Select a job...</option>
                          {jobs.filter(j => j.status === 'active').map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <button type="submit" style={s.btn}>Send invite</button>
                      <button type="button" onClick={syncAssignments} style={s.btnGray}>Sync all invites</button>
                      {inviteMsg && <span style={{ fontSize: '13px', color: '#4ade80' }}>{inviteMsg}</span>}
                    </div>
                  </form>
                </div>
                {assignments.length === 0 ? <div style={s.emptyMsg}>No invites sent yet.</div> : assignments.map(a => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1a1a1a' }}>
                    <div>
                      <p style={s.company}>{a.sub_email}</p>
                      <p style={s.meta}>#{a.jobs?.job_number} — {a.jobs?.project_name} · Invited {new Date(a.invited_at).toLocaleDateString()}</p>
                    </div>
                    <span style={s.badge(a.sub_id ? 'approved' : 'pending')}>{a.sub_id ? 'Registered' : 'Pending'}</span>
                  </div>
                ))}
              </>
            )}

          </div>
        </div>
      </main>
    </div>
  )
}
