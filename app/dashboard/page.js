'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function Dashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [jobs, setJobs] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterJob, setFilterJob] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (!prof || prof.role !== 'pm') { router.push('/submit'); return }
      setProfile(prof)
      const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name)').order('submitted_at', { ascending: false })
      setSubmissions(subs || [])
      const { data: jobList } = await supabase.from('jobs').select('*')
      setJobs(jobList || [])
      setLoading(false)
    }
    load()
  }, [router])

  async function updateStatus(id, status) {
    await supabase.from('billing_submissions').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name)').order('submitted_at', { ascending: false })
    setSubmissions(subs || [])
    setExpanded(null)
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>

  const filtered = submissions.filter(s =>
    (!filterStatus || s.status === filterStatus) &&
    (!filterJob || s.jobs?.job_number === filterJob)
  )
  const pending = submissions.filter(s => s.status === 'pending')
  const totalBilled = submissions.reduce((a, s) => a + (s.amount_billed || 0), 0)
  const totalThisWeek = submissions.filter(s => new Date(s.submitted_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).reduce((a, s) => a + (s.amount_billed || 0), 0)

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

        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '1.5rem' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginTop: 0, marginBottom: '1rem' }}>Billing submissions</h2>
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
        </div>
      </main>
    </div>
  )
}
