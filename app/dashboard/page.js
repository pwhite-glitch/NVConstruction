'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function Dashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('billing')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterJob, setFilterJob] = useState('')
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
  }

  async function updateStatus(id, status) {
    await supabase.from('billing_submissions').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    await loadAll()
    setExpanded(null)
  }

  async function addJob(e) {
    e.preventDefault()
    const { error } = await supabase.from('jobs').insert({
      job_number: newJob.job_number,
      project_name: newJob.project_name,
      location: newJob.location || null,
      contract_value: newJob.contract_value ? parseFloat(newJob.contract_value) : null,
      start_date: newJob.start_date || null,
      status: newJob.status,
    })
    if (error) { setJobMsg('Error: ' + error.message); return }
    setJobMsg('Job added!')
    setNewJob({ job_number: '', project_name: '', location: '', contract_value: '', start_date: '', status: 'active' })
    await loadAll()
    setTimeout(() => setJobMsg(''), 3000)
  }

  async function inviteSub(e) {
    e.preventDefault()
    const { error } = await supabase.from('job_assignments').insert({
      job_id: inviteJobId,
      sub_email: inviteEmail.toLowerCase().trim(),
    })
    if (error) { setInviteMsg(error.code === '23505' ? 'Already invited to this job.' : 'Error: ' + error.message); return }
    setInviteMsg('Invited! Share your app URL with them to register.')
    setInviteEmail('')
    await loadAll()
    setTimeout(() => setInviteMsg(''), 4000)
  }

  async function updateJobStatus(id, status) {
    await supabase.from('jobs').update({ status }).eq('id', id)
    await loadAll()
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>

  const filtered = submissions.filter(s =>
    (!filterStatus || s.status === filterStatus) &&
    (!filterJob || s.jobs?.job_number === filterJob)
  )
  const pending = submissions.filter(s => s.status === 'pending')
  const totalBilled = submissions.reduce((a, s) => a + (s.amount_billed || 0), 0)
  const totalThisWeek = submissions.filter(s => new Date(s.submitted_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).reduce((a, s) => a + (s.amount_billed || 0), 0)

  const tabStyle = (t) => ({ padding: '8px 20px', border: 'none', borderBottom: activeTab === t ? '2px solid #1e3db5' : '2px solid transparent', background: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: activeTab === t ? '600' : '400', color: activeTab === t ? '#1e3db5' : '#6b7280' })
  const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: '500', color: '#4b5563', marginBottom: '4px' }
  const selectStyle = { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', background: 'white' }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f6' }}>
      <header style={{ background: 'white', borderBottom: '1px solid #e5e7eb', padding: '1rem' }}>
        <div style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ fontWeight: '600', margin: 0 }}>NV Construction</p>
            <p style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>PM Dashboard</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>{profile?.full_name}</span>
            <button onClick={async () => { await supabase.auth.signOut(); router.push('/login') }} style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '13px' }}>Sign out</button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'Pending review', value: pending.length, color: '#d97706' },
            { label: 'Billed this week', value: '$' + totalThisWeek.toLocaleString(), color: '#111827' },
            { label: 'Total billed', value: '$' + totalBilled.toLocaleString(), color: '#111827' },
          ].map(card => (
            <div key={card.label} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '1.5rem' }}>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px' }}>{card.label}</p>
              <p style={{ fontSize: '28px', fontWeight: '700', margin: 0, color: card.color }}>{card.value}</p>
            </div>
          ))}
        </div>

        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
          <div style={{ borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem', display: 'flex', gap: '8px' }}>
            <button style={tabStyle('billing')} onClick={() => setActiveTab('billing')}>Billing submissions</button>
            <button style={tabStyle('jobs')} onClick={() => setActiveTab('jobs')}>Jobs</button>
            <button style={tabStyle('invite')} onClick={() => setActiveTab('invite')}>Invite subs</button>
          </div>

          <div style={{ padding: '1.5rem' }}>

            {activeTab === 'billing' && (
              <>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '1rem' }}>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <select value={filterJob} onChange={e => setFilterJob(e.target.value)} style={selectStyle}>
                    <option value="">All jobs</option>
                    {jobs.map(j => <option key={j.id} value={j.job_number}>#{j.job_number} — {j.project_name}</option>)}
                  </select>
                </div>
                {filtered.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '14px', padding: '2rem 0' }}>No submissions found.</p>
                ) : filtered.map(s => (
                  <div key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <div onClick={() => setExpanded(expanded === s.id ? null : s.id)} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '1rem', padding: '12px 8px', cursor: 'pointer', borderRadius: '8px' }}>
                      <div>
                        <p style={{ margin: 0, fontSize: '14px', fontWeight: '500' }}>{s.company_name}</p>
                        <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>{new Date(s.submitted_at).toLocaleDateString()} · {s.contact_name}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', fontSize: '14px', color: '#4b5563' }}>#{s.jobs?.job_number}</div>
                      <div style={{ display: 'flex', alignItems: 'center', fontSize: '14px', fontWeight: '600' }}>${s.amount_billed?.toLocaleString()}</div>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ padding: '2px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: '500', background: s.status === 'approved' ? '#dcfce7' : s.status === 'rejected' ? '#fee2e2' : '#fef3c7', color: s.status === 'approved' ? '#166534' : s.status === 'rejected' ? '#dc2626' : '#92400e' }}>{s.status}</span>
                      </div>
                    </div>
                    {expanded === s.id && (
                      <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '1rem', marginBottom: '8px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                          <div><p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 2px' }}>Contact</p><p style={{ fontSize: '14px', margin: 0 }}>{s.contact_name} · {s.contact_info}</p></div>
                          <div><p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 2px' }}>% complete</p><p style={{ fontSize: '14px', margin: 0 }}>{s.pct_complete ?? '—'}%</p></div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                          <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 2px' }}>Work description</p>
                          <p style={{ fontSize: '14px', margin: 0, lineHeight: '1.6' }}>{s.work_description}</p>
                        </div>
                        {s.status === 'pending' && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => updateStatus(s.id, 'approved')} style={{ padding: '6px 16px', background: '#1e3db5', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Approve</button>
                            <button onClick={() => updateStatus(s.id, 'rejected')} style={{ padding: '6px 16px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Reject</button>
                          </div>
                        )}
                        {s.status !== 'pending' && <p style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>Reviewed {s.reviewed_at ? new Date(s.reviewed_at).toLocaleDateString() : '—'}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {activeTab === 'jobs' && (
              <>
                <form onSubmit={addJob} style={{ background: '#f9fafb', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
                  <p style={{ fontWeight: '600', fontSize: '14px', margin: '0 0 1rem' }}>Add new job</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div><label style={labelStyle}>Job number</label><input style={inputStyle} value={newJob.job_number} onChange={e => setNewJob(j => ({ ...j, job_number: e.target.value }))} required placeholder="7469" /></div>
                    <div><label style={labelStyle}>Project name</label><input style={inputStyle} value={newJob.project_name} onChange={e => setNewJob(j => ({ ...j, project_name: e.target.value }))} required placeholder="Braum's Lubbock" /></div>
                    <div><label style={labelStyle}>Location</label><input style={inputStyle} value={newJob.location} onChange={e => setNewJob(j => ({ ...j, location: e.target.value }))} placeholder="Lubbock, TX" /></div>
                    <div><label style={labelStyle}>Contract value</label><input type="number" style={inputStyle} value={newJob.contract_value} onChange={e => setNewJob(j => ({ ...j, contract_value: e.target.value }))} placeholder="0.00" /></div>
                    <div><label style={labelStyle}>Start date</label><input type="date" style={inputStyle} value={newJob.start_date} onChange={e => setNewJob(j => ({ ...j, start_date: e.target.value }))} /></div>
                    <div><label style={labelStyle}>Status</label>
                      <select style={inputStyle} value={newJob.status} onChange={e => setNewJob(j => ({ ...j, status: e.target.value }))}>
                        <option value="active">Active</option>
                        <option value="on_hold">On hold</option>
                        <option value="complete">Complete</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button type="submit" style={{ padding: '8px 20px', background: '#1e3db5', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Add job</button>
                    {jobMsg && <span style={{ fontSize: '13px', color: '#166534' }}>{jobMsg}</span>}
                  </div>
                </form>

                {jobs.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '14px', padding: '2rem 0' }}>No jobs yet.</p>
                ) : jobs.map(j => (
                  <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>#{j.job_number} — {j.project_name}</p>
                      <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>{j.location}{j.contract_value ? ' · $' + parseFloat(j.contract_value).toLocaleString() : ''}{j.start_date ? ' · ' + new Date(j.start_date).toLocaleDateString() : ''}</p>
                    </div>
                    <select value={j.status} onChange={e => updateJobStatus(j.id, e.target.value)} style={{ ...selectStyle, fontSize: '12px', padding: '4px 8px' }}>
                      <option value="active">Active</option>
                      <option value="on_hold">On hold</option>
                      <option value="complete">Complete</option>
                    </select>
                  </div>
                ))}
              </>
            )}

            {activeTab === 'invite' && (
              <>
                <form onSubmit={inviteSub} style={{ background: '#f9fafb', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
                  <p style={{ fontWeight: '600', fontSize: '14px', margin: '0 0 1rem' }}>Invite subcontractor to a job</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label style={labelStyle}>Sub's email address</label>
                      <input type="email" style={inputStyle} value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required placeholder="sub@company.com" />
                    </div>
                    <div>
                      <label style={labelStyle}>Job</label>
                      <select style={inputStyle} value={inviteJobId} onChange={e => setInviteJobId(e.target.value)} required>
                        <option value="">Select a job...</option>
                        {jobs.filter(j => j.status === 'active').map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button type="submit" style={{ padding: '8px 20px', background: '#1e3db5', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Send invite</button>
                    {inviteMsg && <span style={{ fontSize: '13px', color: '#166534' }}>{inviteMsg}</span>}
                  </div>
                </form>

                {assignments.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '14px', padding: '2rem 0' }}>No invites sent yet.</p>
                ) : assignments.map(a => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: '14px', fontWeight: '500' }}>{a.sub_email}</p>
                      <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>#{a.jobs?.job_number} — {a.jobs?.project_name} · Invited {new Date(a.invited_at).toLocaleDateString()}</p>
                    </div>
                    <span style={{ padding: '2px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: '500', background: a.sub_id ? '#dcfce7' : '#fef3c7', color: a.sub_id ? '#166534' : '#92400e' }}>{a.sub_id ? 'Registered' : 'Pending'}</span>
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
