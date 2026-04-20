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
  const [filter, setFilter] = useState({ status: '', job: '' })

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

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-gray-400">Loading dashboard...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900">NV Construction</p>
            <p className="text-xs text-gray-400">PM Dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{profile?.full_name}</span>
            <button onClick={handleSignOut} className="text-sm border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <p className="text-xs text-gray-500 mb-1">Pending review</p>
            <p className="text-3xl font-bold text-amber-600">{pending.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <p className="text-xs text-gray-500 mb-1">Billed this week</p>
            <p className="text-3xl font-bold text-gray-900">${totalThisWeek.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <p className="text-xs text-gray-500 mb-1">Total billed all time</p>
            <p className="text-3xl font-bold text-gray-900">${totalBilled.toLocaleString()}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Billing submissions</h2>

          <div className="flex gap-3 mb-4">
            <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={filter.job} onChange={e => setFilter(f => ({ ...f, job: e.target.value }))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">All jobs</option>
              {jobs.map(j => <option key={j.id} value={j.job_number}>#{j.job_number} — {j.project_name}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No submissions found.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map(s => (
                <div key={s.id}>
                  <div className="grid grid-cols-5 gap-4 py-3 cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2 transition" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                    <div className="col-span-2">
                      <p className="text-sm font-medium text-gray-900">{s.company_name}</p>
                      <p className="text-xs text-gray-400">{new Date(s.submitted_at).toLocaleDateString()} · {s.contact_name}</p>
                    </div>
                    <div className="flex items-center">
                      <span className="text-sm text-gray-600">#{s.jobs?.job_number}</span>
                    </div>
                    <div className="flex items-center">
                      <span className="text-sm font-semibold text-gray-900">${s.amount_billed?.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.status === 'pending' ? 'bg-amber-100 text-amber-800' : s.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{s.status}</span>
                    </div>
                  </div>
                  {expanded === s.id && (
                    <div className="bg-gray-50 rounded-lg p-4 mb-2">
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Contact</p>
                          <p className="text-sm text-gray-900">{s.contact_name} · {s.contact_info}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">% complete</p>
                          <p className="text-sm text-gray-900">{s.pct_complete ?? '—'}%</p>
                        </div>
                      </div>
                      <div className="mb-4">
                        <p className="text-xs text-gray-500 mb-1">Work description</p>
                        <p className="text-sm text-gray-700">{s.work_description}</p>
                      </div>
                      {s.status === 'pending' && (
                        <div className="flex gap-2">
                          <button onClick={() => updateStatus(s.id, 'approved')} className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700">Approve</button>
                          <button onClick={() => updateStatus(s.id, 'rejected')} className="bg-red-50 text-red-700 border border-red-200 text-xs px-3 py-1.5 rounded-lg hover:bg-red-100">Reject</button>
                        </div>
                      )}
                      {s.status !== 'pending' && (
                        <p className="text-xs text-gray-400">Reviewed {s.reviewed_at ? new Date(s.reviewed_at).toLocaleDateString() : '—'}</p>
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
