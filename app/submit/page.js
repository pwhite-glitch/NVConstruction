'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function Submit() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [jobs, setJobs] = useState([])
  const [form, setForm] = useState({ job_id: '', amount_billed: '', pct_complete: '', work_description: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [submissions, setSubmissions] = useState([])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setUser(session.user)

      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      setProfile(prof)

      if (prof?.role === 'pm') { router.push('/dashboard'); return }

      const { data: jobList } = await supabase.from('jobs').select('*').eq('status', 'active')
      setJobs(jobList || [])

      const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name)').eq('sub_id', session.user.id).order('submitted_at', { ascending: false })
      setSubmissions(subs || [])
    })
  }, [router])

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.from('billing_submissions').insert({
      sub_id: user.id,
      job_id: form.job_id,
      company_name: profile?.company_name || 'Unknown',
      contact_name: profile?.full_name,
      contact_info: profile?.phone,
      amount_billed: parseFloat(form.amount_billed),
      pct_complete: parseInt(form.pct_complete) || null,
      work_description: form.work_description,
    })

    if (!error) {
      setSuccess(true)
      setForm({ job_id: '', amount_billed: '', pct_complete: '', work_description: '' })
      const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name)').eq('sub_id', session.user.id).order('submitted_at', { ascending: false })
      setSubmissions(subs || [])
    }
    setLoading(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-steel-50">
      <header className="bg-white border-b border-steel-100">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-steel-900 text-sm">NV Construction</p>
              <p className="text-xs text-steel-400">{profile?.company_name || 'Subcontractor Portal'}</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="btn-secondary text-xs">Sign out</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3 rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
            Billing submitted successfully. Peyton will be notified.
          </div>
        )}

        <div className="card">
          <h2 className="text-lg font-semibold text-steel-900 mb-5">Submit billing</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label>Project</label>
              <select value={form.job_id} onChange={e => update('job_id', e.target.value)} required>
                <option value="">Select a project...</option>
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Amount billed this period</label>
                <input type="number" value={form.amount_billed} onChange={e => update('amount_billed', e.target.value)} required placeholder="0.00" min="0" step="0.01" />
              </div>
              <div>
                <label>% complete on your scope</label>
                <input type="number" value={form.pct_complete} onChange={e => update('pct_complete', e.target.value)} placeholder="0" min="0" max="100" />
              </div>
            </div>
            <div>
              <label>Description of work completed</label>
              <textarea value={form.work_description} onChange={e => update('work_description', e.target.value)} rows={4} placeholder="Describe the work completed this billing period..." required />
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Submitting...' : 'Submit billing'}
              </button>
            </div>
          </form>
        </div>

        {submissions.length > 0 && (
          <div className="card">
            <h2 className="text-lg font-semibold text-steel-900 mb-4">Your submissions</h2>
            <div className="space-y-3">
              {submissions.map(s => (
                <div key={s.id} className="flex items-center justify-between py-3 border-b border-steel-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-steel-900">#{s.jobs?.job_number} — {s.jobs?.project_name}</p>
                    <p className="text-xs text-steel-400 mt-0.5">{new Date(s.submitted_at).toLocaleDateString()} · {s.pct_complete}% complete</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <sp
