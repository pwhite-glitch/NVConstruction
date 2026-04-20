'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function Submit() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [jobs, setJobs] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [form, setForm] = useState({ job_id: '', amount_billed: '', pct_complete: '', work_description: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const update = (f, v) => setForm(x => ({ ...x, [f]: v }))

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (prof?.role === 'pm') { router.push('/dashboard'); return }
      setProfile(prof)
      const { data: jobList } = await supabase.from('jobs').select('*').eq('status', 'active')
      setJobs(jobList || [])
      const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name)').eq('sub_id', session.user.id).order('submitted_at', { ascending: false })
      setSubmissions(subs || [])
    }
    load()
  }, [router])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.from('billing_submissions').insert({
      sub_id: user.id, job_id: form.job_id,
      company_name: profile?.company_name || 'Unknown',
      contact_name: profile?.full_name, contact_info: profile?.phone,
      amount_billed: parseFloat(form.amount_billed),
      pct_complete: parseInt(form.pct_complete) || null,
      work_description: form.work_description,
    })
    if (!error) {
      setSuccess(true)
      setForm({ job_id: '', amount_billed: '', pct_complete: '', work_description: '' })
      const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name)').eq('sub_id', user.id).order('submitted_at', { ascending: false })
      setSubmissions(subs || [])
    }
    setLoading(false)
  }

  const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: '500', color: '#4b5563', marginBottom: '4px' }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f6' }}>
      <header style={{ background: 'white', borderBottom: '1px solid #e5e7eb', padding: '1rem' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ fontWeight: '600', margin: 0 }}>NV Construction</p>
            <p style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>{profile?.company_name || 'Subcontractor Portal'}</p>
          </div>
          <button onClick={async () => { await supabase.auth.signOut(); router.push('/login') }} style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '13px' }}>Sign out</button>
        </div>
      </header>
      <main style={{ maxWidth: '720px', margin: '0 auto', padding: '2rem 1rem' }}>
        {success && <div style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', padding: '12px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '1.5rem' }}>Billing submitted! Peyton will be notified.</div>}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginTop: 0, marginBottom: '1.5rem' }}>Submit billing</h2>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Project</label>
              <select value={form.job_id} onChange={e => update('job_id', e.target.value)} required style={inputStyle}>
                <option value="">Select a project...</option>
                {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1rem' }}>
              <div><label style={labelStyle}>Amount billed</label><input type="number" style={inputStyle} value={form.amount_billed} onChange={e => update('amount_billed', e.target.value)} required placeholder="0.00" min="0" step="0.01" /></div>
              <div><label style={labelStyle}>% complete on scope</label><input type="number" style={inputStyle} value={form.pct_complete} onChange={e => update('pct_complete', e.target.value)} placeholder="0" min="0" max="100" /></div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Work description</label>
              <textarea value={form.work_description} onChange={e => update('work_description', e.target.value)} required rows={4} placeholder="Describe work completed this period..." style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={loading} style={{ padding: '10px 24px', background: '#1e3db5', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                {loading ? 'Submitting...' : 'Submit billing'}
              </button>
            </div>
          </form>
        </div>
        {submissions.length > 0 && (
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '1.5rem' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginTop: 0, marginBottom: '1rem' }}>Your submissions</h2>
            {submissions.map(s => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: '500' }}>#{s.jobs?.job_number} — {s.jobs?.project_name}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>{new Date(s.submitted_at).toLocaleDateString()} · {s.pct_complete}% complete</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontWeight: '600', fontSize: '14px' }}>${s.amount_billed?.toLocaleString()}</span>
                  <span style={{ padding: '2px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: '500', background: s.status === 'approved' ? '#dcfce7' : s.status === 'rejected' ? '#fee2e2' : '#fef3c7', color: s.status === 'approved' ? '#166534' : s.status === 'rejected' ? '#dc2626' : '#92400e' }}>{s.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
