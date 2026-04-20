'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a' },
  header: { background: '#141414', borderBottom: '1px solid #222', padding: '0 1.5rem' },
  headerInner: { maxWidth: '760px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoImg: { width: '40px', height: '40px', objectFit: 'contain' },
  logoName: { fontWeight: '700', fontSize: '15px', color: '#f1f1f1', letterSpacing: '1px' },
  logoSub: { fontSize: '11px', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' },
  signOut: { padding: '7px 16px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#888', cursor: 'pointer', fontSize: '13px' },
  main: { maxWidth: '760px', margin: '0 auto', padding: '2rem 1.5rem' },
  card: { background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '1.75rem', marginBottom: '1.5rem' },
  cardTitle: { fontSize: '16px', fontWeight: '700', color: '#f1f1f1', marginTop: 0, marginBottom: '1.5rem', letterSpacing: '0.5px' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  btn: { padding: '11px 28px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  success: { background: '#0a1a0a', border: '1px solid #1a4a1a', color: '#4ade80', padding: '14px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '1.5rem' },
  empty: { background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: '#555', fontSize: '14px' },
  badge: (status) => ({
    padding: '3px 12px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'approved' ? '#0a2a0a' : status === 'rejected' ? '#2a0a0a' : '#2a1a00',
    color: status === 'approved' ? '#4ade80' : status === 'rejected' ? '#ff6b6b' : '#e8590c',
    border: `1px solid ${status === 'approved' ? '#1a4a1a' : status === 'rejected' ? '#5a1a1a' : '#4a2a00'}`
  }),
}

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
      const { data: assignments } = await supabase.from('job_assignments').select('job_id, jobs(id, job_number, project_name, status)').eq('sub_id', session.user.id)
      setJobs((assignments || []).map(a => a.jobs).filter(j => j && j.status === 'active'))
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

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
            <div>
              <div style={s.logoName}>NV Construction</div>
              <div style={s.logoSub}>{profile?.company_name || 'Subcontractor Portal'}</div>
            </div>
          </div>
          <button style={s.signOut} onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>Sign out</button>
        </div>
      </header>
      <main style={s.main}>
        {success && <div style={s.success}>Billing submitted successfully. Peyton will be notified.</div>}
        {jobs.length === 0 ? (
          <div style={s.empty}>You have not been assigned to any active jobs yet.<br />Contact Peyton at NV Construction.</div>
        ) : (
          <div style={s.card}>
            <h2 style={s.cardTitle}>Submit billing</h2>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={s.label}>Project</label>
                <select value={form.job_id} onChange={e => update('job_id', e.target.value)} required style={s.input}>
                  <option value="">Select a project...</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                </select>
              </div>
              <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                <div><label style={s.label}>Amount billed</label><input type="number" style={s.input} value={form.amount_billed} onChange={e => update('amount_billed', e.target.value)} required placeholder="0.00" min="0" step="0.01" /></div>
                <div><label style={s.label}>% complete on scope</label><input type="number" style={s.input} value={form.pct_complete} onChange={e => update('pct_complete', e.target.value)} placeholder="0" min="0" max="100" /></div>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={s.label}>Work description</label>
                <textarea value={form.work_description} onChange={e => update('work_description', e.target.value)} required rows={4} placeholder="Describe work completed this billing period..." style={{ ...s.input, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" disabled={loading} style={{ ...s.btn, opacity: loading ? 0.6 : 1 }}>{loading ? 'Submitting...' : 'Submit billing'}</button>
              </div>
            </form>
          </div>
        )}
        {submissions.length > 0 && (
          <div style={s.card}>
            <h2 style={s.cardTitle}>Your submissions</h2>
            {submissions.map(s2 => (
              <div key={s2.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1e1e1e' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>#{s2.jobs?.job_number} — {s2.jobs?.project_name}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#555', marginTop: '3px' }}>{new Date(s2.submitted_at).toLocaleDateString()} · {s2.pct_complete}% complete</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <span style={{ fontWeight: '700', fontSize: '15px', color: '#f1f1f1' }}>${s2.amount_billed?.toLocaleString()}</span>
                  <span style={s.badge(s2.status)}>{s2.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
