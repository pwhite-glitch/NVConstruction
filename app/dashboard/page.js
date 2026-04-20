'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function Dashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [filter, setFilter] = useState({ status: '', job: '' })
  const [jobs, setJobs] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/login'); return }

      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      setProfile(prof)

      if (prof?.role !== 'pm') { router.push('/submit'); return }

      await loadSubmissions()
      const { data: jobList } = await supabase.from('jobs').select('*')
      setJobs(jobList || [])
      setLoading(false)
    })
  }, [router])

  async function loadSubmissions() {
    const { data } = await supabase
      .from('billing_submissions')
      .select('*, jobs(job_number, project_name)')
      .order('submitted_at', { ascending: false })
    setSubmissions(data || [])
  }

  async function updateStatus(id, status) {
    await supabase.from('billing_submissions').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    await loadSubmissions()
    setExpanded(null)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const filtered = submissions.filter(s =>
    (!filter.status || s.status === filter.status) &&
    (!filter.job || s.jobs?.job_number === filter.job)
  )

  const pending = submissions.filter(s => s.status === 'pending')
  const totalBilled = submissions.reduce((a, s) => a + (s.amount_billed || 0), 0)
  const totalThisWeek = submissions
    .filter(s => new Date(s.submitted_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    .reduce((a, s) => a + (s.amount_billed || 0), 0)

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="text-steel-400 text-sm">Loading...</p></div>

  return (
    <div className="min-h-screen bg-steel-50">
      <header className="bg-white border-b border-steel-100">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-steel-900 text-sm">NV Construction</p>
              <p className="text-xs text-steel-400">PM Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-steel-500">{profile?.full_name}</span>
            <button onClick={handleSignOut} className="btn-secondary text-xs">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <p className="text-xs text-steel-500 mb-1">Pending review</p>
            <p className="text-3xl font-bold text-amber-600">{pending.length}</p>
          </div>
          <div className="card">
            <p className="text-xs text-steel-500 mb-1">Billed this week</p>
            <p className="text-3xl font-bold text-steel-900">${totalThisWeek.toLocaleString()}</p>
          </div>
          <div className="card">
            <p className="text-xs text-steel-500 mb-1">Total billed all time</p>
            <p className="text-3xl font-bold text-steel-900">${totalBilled.toLocaleString()}</p>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-steel-900">Billing submissions</h2>
          </div>

          <div className="flex gap-3 mb-4">
            <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="w-auto">
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={filter.job} onChange={e => setFilter(f => ({ ...f, job: e.target.value }))} className="w-auto">
              <option value="">All jobs</option>
              {jobs.map(j => <option key={j.id} value={j.job_number}>#{j.job_number} — {j.project_name}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-steel-400 py-4 text-center">No submissions found.</p>
          ) : (
            <div className="divide-y divide-steel-100">
              <div className="grid grid-cols-5 gap-4 pb-2 text-xs font-medium text-steel-500 uppercase tracking-wide">
                <span className="col-span-2">Company / Date</span>
                <span>Project</span>
                <span>Amount</span>
                <span>Status</span>
              </div>
              {filtered.map(s => (
                <div key={s.id}>
                  <div
                    className="grid grid-cols-5 gap-4 py-3 cursor-pointer hover:bg-steel-50 rounded-lg px-2 -mx-2 transition"
                    onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                  >
                    <div className="col-span-2">
                      <p className="text-sm font-medium text-steel-900">{s.company_name}</p>
                      <p className="text-xs text-steel-400">{new Date(s.submitted_at).toLocaleDateString()} · {s.contact_name}</p>
                    </div>
                    <div className="flex items-center">
                      <span className="text-sm text-steel-600">#{s.jobs?.job_number}</span>
                    </div>
                    <div className="flex items-center">
                      <span className="text-sm font-semibold text-steel-900">${s.amount_billed?.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center">
                      <span className={`badge-${s.status}`}>{s.status}</span>
                    </div>
                  </div>

                  {expanded === s.id && (
                    <div className="bg-steel-50 rounded-lg p-4 mb-2 mx-0">
                      <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                        <div>
                          <p className="text-xs text-steel-500 mb-1">Contact</p>
                          <p className="text-steel-900">{s.contact_name} · {s.contact_info}</p>
                        </div>
                        <div>
                          <p className="text-xs text-steel-500 mb-1">% complete on scope</p>
                          <p className="text-steel-900">{s.pct_complete ?? '—'}%</p>
                        </div>
                      </div>
                      <div className="mb-4">
                        <p className="text-xs text-steel-500 mb-1">Work description</p>
                        <p className="text-sm text-steel-700 leading-relaxed">{s.work_description}</p>
                      </div>
                      {s.status === 'pending' && (
                        <div className="flex gap-2">
                          <button onClick={() => updateStatus(s.id, 'approved')} className="btn-primary text-xs py-1.5 px-3">Approve</button>
                          <button onClick={() => updateStatus(s.id, 'rejected')} className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-medium px-3 py-1.5 rounded-lg text-xs transition">Reject</button>
                        </div>
                      )}
                      {s.status !== 'pending' && (
                        <p className="text-xs text-steel-400">Reviewed {new Date(s.reviewed_at).toLocaleDateString()}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
