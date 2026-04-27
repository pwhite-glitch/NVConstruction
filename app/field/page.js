'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const WEATHER = ['Clear', 'Partly Cloudy', 'Overcast', 'Light Rain', 'Heavy Rain', 'Thunderstorm', 'Snow', 'Windy', 'Extreme Heat', 'Fog']

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
  cardTitle: { fontSize: '16px', fontWeight: '700', color: '#f1f1f1', marginTop: 0, marginBottom: '1.5rem' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' },
  btn: { padding: '11px 28px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSm: (c) => ({ padding: '7px 16px', background: c === 'red' ? '#2a0a0a' : c === 'green' ? '#0a1a0a' : c === 'orange' ? '#2a1200' : '#1a1a1a', color: c === 'red' ? '#ff6b6b' : c === 'green' ? '#4ade80' : c === 'orange' ? '#e8590c' : '#888', border: `1px solid ${c === 'red' ? '#5a1a1a' : c === 'green' ? '#1a4a1a' : c === 'orange' ? '#4a2200' : '#2a2a2a'}`, borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }),
  success: { background: '#0a1a0a', border: '1px solid #1a4a1a', color: '#4ade80', padding: '14px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '1.5rem' },
  empty: { background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: '#555', fontSize: '14px' },
  badge: (st) => ({
    padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: st === 'received' || st === 'complete' || st === 'answered' ? '#0a2a0a' : st === 'delayed' ? '#2a0a0a' : st === 'partial' ? '#2a1a00' : '#1a1200',
    color: st === 'received' || st === 'complete' || st === 'answered' ? '#4ade80' : st === 'delayed' ? '#ff6b6b' : st === 'partial' ? '#facc15' : '#e8590c',
    border: `1px solid ${st === 'received' || st === 'complete' || st === 'answered' ? '#1a4a1a' : st === 'delayed' ? '#5a1a1a' : st === 'partial' ? '#4a4a00' : '#4a2200'}`
  }),
  tabRow: { display: 'flex', marginBottom: '1.5rem', borderBottom: '1px solid #222', overflowX: 'auto' },
  tab: (active) => ({ padding: '10px 18px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', background: 'none', border: 'none', color: active ? '#f1f1f1' : '#555', borderBottom: active ? '2px solid #e8590c' : '2px solid transparent', letterSpacing: '0.5px', marginBottom: '-1px', whiteSpace: 'nowrap' }),
  row: { border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' },
  rowHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f', cursor: 'pointer' },
  rowBody: { borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' },
}

export default function Field() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [assignedJobs, setAssignedJobs] = useState([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [activeTab, setActiveTab] = useState('daily')

  const [dailyReports, setDailyReports] = useState([])
  const [dailyForm, setDailyForm] = useState({ report_date: new Date().toISOString().split('T')[0], weather: '', crew_count: '', work_performed: '', issues: '' })
  const [submittingDaily, setSubmittingDaily] = useState(false)
  const [dailySuccess, setDailySuccess] = useState(false)
  const [expandedReport, setExpandedReport] = useState(null)

  const [rfis, setRfis] = useState([])
  const [rfiForm, setRfiForm] = useState({ title: '', description: '' })
  const [submittingRfi, setSubmittingRfi] = useState(false)
  const [rfiSuccess, setRfiSuccess] = useState(false)
  const [expandedRfi, setExpandedRfi] = useState(null)

  const [deliveries, setDeliveries] = useState([])
  const [deliveryForm, setDeliveryForm] = useState({ material: '', vendor: '', expected_date: '', quantity: '', notes: '' })
  const [submittingDelivery, setSubmittingDelivery] = useState(false)
  const [deliverySuccess, setDeliverySuccess] = useState(false)
  const [showDeliveryForm, setShowDeliveryForm] = useState(false)
  const [updatingDelivery, setUpdatingDelivery] = useState(null)

  const [milestones, setMilestones] = useState([])
  const [completingMilestone, setCompletingMilestone] = useState(null)

  const [subContacts, setSubContacts] = useState([])

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (!prof || prof.role !== 'super') { router.push('/login'); return }
      setProfile(prof)
      const { data: assigns } = await supabase.from('pm_job_assignments').select('job_id, jobs(*)').eq('user_id', session.user.id)
      const jobs = (assigns || []).map(a => a.jobs).filter(Boolean)
      setAssignedJobs(jobs)
      if (jobs.length === 1) setSelectedJobId(jobs[0].id)
    }
    load()
  }, [router])

  useEffect(() => {
    if (!selectedJobId) return
    if (activeTab === 'daily') loadDailyReports()
    else if (activeTab === 'rfi') loadRfis()
    else if (activeTab === 'deliveries') loadDeliveries()
    else if (activeTab === 'schedule') loadMilestones()
    else if (activeTab === 'subs') loadSubContacts()
  }, [selectedJobId, activeTab])

  async function loadDailyReports() {
    const { data } = await supabase.from('daily_reports').select('*').eq('job_id', selectedJobId).order('report_date', { ascending: false })
    setDailyReports(data || [])
  }
  async function loadRfis() {
    const { data } = await supabase.from('rfis').select('*').eq('job_id', selectedJobId).order('created_at', { ascending: false })
    setRfis(data || [])
  }
  async function loadDeliveries() {
    const { data } = await supabase.from('deliveries').select('*').eq('job_id', selectedJobId).order('expected_date', { ascending: true })
    setDeliveries(data || [])
  }
  async function loadMilestones() {
    const { data } = await supabase.from('milestones').select('*').eq('job_id', selectedJobId).order('due_date', { ascending: true })
    setMilestones(data || [])
  }
  async function loadSubContacts() {
    const { data: assigns } = await supabase.from('job_assignments').select('sub_email').eq('job_id', selectedJobId)
    const emails = (assigns || []).map(a => a.sub_email).filter(Boolean)
    if (emails.length === 0) { setSubContacts([]); return }
    const { data } = await supabase.from('sub_directory').select('*').in('email', emails)
    setSubContacts(data || [])
  }

  async function submitDailyReport(e) {
    e.preventDefault()
    setSubmittingDaily(true)
    const { error } = await supabase.from('daily_reports').insert({
      job_id: selectedJobId, super_id: user.id,
      report_date: dailyForm.report_date,
      weather: dailyForm.weather || null,
      crew_count: dailyForm.crew_count ? parseInt(dailyForm.crew_count) : null,
      work_performed: dailyForm.work_performed,
      issues: dailyForm.issues || null,
    })
    if (!error) {
      setDailySuccess(true)
      setDailyForm({ report_date: new Date().toISOString().split('T')[0], weather: '', crew_count: '', work_performed: '', issues: '' })
      await loadDailyReports()
      setTimeout(() => setDailySuccess(false), 3000)
    }
    setSubmittingDaily(false)
  }

  async function submitRfi(e) {
    e.preventDefault()
    setSubmittingRfi(true)
    const { error } = await supabase.from('rfis').insert({
      job_id: selectedJobId, super_id: user.id,
      title: rfiForm.title, description: rfiForm.description || null,
    })
    if (!error) {
      setRfiSuccess(true)
      setRfiForm({ title: '', description: '' })
      await loadRfis()
      setTimeout(() => setRfiSuccess(false), 3000)
    }
    setSubmittingRfi(false)
  }

  async function submitDelivery(e) {
    e.preventDefault()
    setSubmittingDelivery(true)
    const { error } = await supabase.from('deliveries').insert({
      job_id: selectedJobId, super_id: user.id,
      material: deliveryForm.material,
      vendor: deliveryForm.vendor || null,
      expected_date: deliveryForm.expected_date || null,
      quantity: deliveryForm.quantity || null,
      notes: deliveryForm.notes || null,
      status: 'pending',
    })
    if (!error) {
      setDeliverySuccess(true)
      setDeliveryForm({ material: '', vendor: '', expected_date: '', quantity: '', notes: '' })
      setShowDeliveryForm(false)
      await loadDeliveries()
      setTimeout(() => setDeliverySuccess(false), 3000)
    }
    setSubmittingDelivery(false)
  }

  async function markDeliveryReceived(id) {
    setUpdatingDelivery(id)
    await supabase.from('deliveries').update({ status: 'received', received_date: new Date().toISOString().split('T')[0] }).eq('id', id)
    await loadDeliveries()
    setUpdatingDelivery(null)
  }

  async function completeMilestone(id) {
    setCompletingMilestone(id)
    await supabase.from('milestones').update({ status: 'complete', completed_date: new Date().toISOString().split('T')[0] }).eq('id', id)
    await loadMilestones()
    setCompletingMilestone(null)
  }

  const selectedJob = assignedJobs.find(j => j.id === selectedJobId)
  const answeredRfis = rfis.filter(r => r.status === 'answered').length

  if (!profile) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#555' }}>Loading...</div>

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
            <div>
              <div style={s.logoName}>NV Construction</div>
              <div style={s.logoSub}>{profile?.full_name || 'Field Portal'}</div>
            </div>
          </div>
          <button style={s.signOut} onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>Sign out</button>
        </div>
      </header>

      <main style={s.main}>
        {assignedJobs.length === 0 ? (
          <div style={s.empty}>You have not been assigned to any jobs yet.<br />Contact NV Construction to get started.</div>
        ) : (
          <>
            {assignedJobs.length > 1 && (
              <div style={{ background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <label style={{ ...s.label, margin: 0, whiteSpace: 'nowrap' }}>Active job</label>
                <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} style={s.input}>
                  <option value="">Select a job...</option>
                  {assignedJobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                </select>
              </div>
            )}

            {selectedJob && assignedJobs.length === 1 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ color: '#f1f1f1', margin: '0 0 4px', fontSize: '20px', fontWeight: '800' }}>#{selectedJob.job_number} — {selectedJob.project_name}</h2>
                {selectedJob.location && <p style={{ margin: 0, color: '#555', fontSize: '13px' }}>{selectedJob.location}</p>}
              </div>
            )}

            {!selectedJobId && <div style={s.empty}>Select a job above to get started.</div>}

            {selectedJobId && (
              <>
                <div style={s.tabRow}>
                  <button style={s.tab(activeTab === 'daily')} onClick={() => setActiveTab('daily')}>Daily Reports</button>
                  <button style={s.tab(activeTab === 'rfi')} onClick={() => setActiveTab('rfi')}>
                    RFIs{answeredRfis > 0 ? ` (${answeredRfis} new)` : ''}
                  </button>
                  <button style={s.tab(activeTab === 'deliveries')} onClick={() => setActiveTab('deliveries')}>Deliveries</button>
                  <button style={s.tab(activeTab === 'schedule')} onClick={() => setActiveTab('schedule')}>Schedule</button>
                  <button style={s.tab(activeTab === 'subs')} onClick={() => setActiveTab('subs')}>Sub Contacts</button>
                </div>

                {/* ── DAILY REPORTS ── */}
                {activeTab === 'daily' && (
                  <>
                    {dailySuccess && <div style={s.success}>Daily report submitted.</div>}
                    <div style={s.card}>
                      <h2 style={s.cardTitle}>Submit daily report</h2>
                      <form onSubmit={submitDailyReport}>
                        <div style={{ ...s.grid3, marginBottom: '1rem' }}>
                          <div><label style={s.label}>Date</label><input type="date" style={s.input} value={dailyForm.report_date} onChange={e => setDailyForm(f => ({ ...f, report_date: e.target.value }))} required /></div>
                          <div>
                            <label style={s.label}>Weather</label>
                            <select style={s.input} value={dailyForm.weather} onChange={e => setDailyForm(f => ({ ...f, weather: e.target.value }))}>
                              <option value="">—</option>
                              {WEATHER.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                          </div>
                          <div><label style={s.label}>Crew count</label><input type="number" min="0" style={s.input} value={dailyForm.crew_count} onChange={e => setDailyForm(f => ({ ...f, crew_count: e.target.value }))} placeholder="0" /></div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Work performed *</label>
                          <textarea required rows={4} style={{ ...s.input, resize: 'vertical' }} value={dailyForm.work_performed} onChange={e => setDailyForm(f => ({ ...f, work_performed: e.target.value }))} placeholder="Describe work completed today..." />
                        </div>
                        <div style={{ marginBottom: '1.5rem' }}>
                          <label style={s.label}>Issues / delays</label>
                          <textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={dailyForm.issues} onChange={e => setDailyForm(f => ({ ...f, issues: e.target.value }))} placeholder="Delays, safety incidents, problems..." />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button type="submit" disabled={submittingDaily} style={{ ...s.btn, opacity: submittingDaily ? 0.6 : 1 }}>{submittingDaily ? 'Submitting...' : 'Submit report'}</button>
                        </div>
                      </form>
                    </div>
                    {dailyReports.length > 0 && (
                      <>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 0.75rem' }}>Past reports ({dailyReports.length})</p>
                        {dailyReports.map(r => (
                          <div key={r.id} style={s.row}>
                            <div style={s.rowHead} onClick={() => setExpandedReport(expandedReport === r.id ? null : r.id)}>
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{new Date(r.report_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                                {r.weather && <span style={{ fontSize: '12px', color: '#555' }}>{r.weather}</span>}
                                {r.crew_count != null && <span style={{ fontSize: '12px', color: '#555' }}>{r.crew_count} crew</span>}
                              </div>
                              <span style={{ color: '#555' }}>{expandedReport === r.id ? '▲' : '▼'}</span>
                            </div>
                            {expandedReport === r.id && (
                              <div style={s.rowBody}>
                                <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Work performed</p>
                                <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>{r.work_performed}</p>
                                {r.issues && <>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Issues / delays</p>
                                  <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.issues}</p>
                                </>}
                              </div>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* ── RFIs ── */}
                {activeTab === 'rfi' && (
                  <>
                    {rfiSuccess && <div style={s.success}>RFI submitted. The PM will respond shortly.</div>}
                    <div style={s.card}>
                      <h2 style={s.cardTitle}>Submit RFI</h2>
                      <form onSubmit={submitRfi}>
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Subject *</label>
                          <input style={s.input} required value={rfiForm.title} onChange={e => setRfiForm(f => ({ ...f, title: e.target.value }))} placeholder="Question about electrical panel location..." />
                        </div>
                        <div style={{ marginBottom: '1.5rem' }}>
                          <label style={s.label}>Details</label>
                          <textarea rows={4} style={{ ...s.input, resize: 'vertical' }} value={rfiForm.description} onChange={e => setRfiForm(f => ({ ...f, description: e.target.value }))} placeholder="Provide details, reference drawings, etc..." />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button type="submit" disabled={submittingRfi} style={{ ...s.btn, opacity: submittingRfi ? 0.6 : 1 }}>{submittingRfi ? 'Submitting...' : 'Submit RFI'}</button>
                        </div>
                      </form>
                    </div>
                    {rfis.length > 0 && (
                      <>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 0.75rem' }}>My RFIs ({rfis.length})</p>
                        {rfis.map(rfi => (
                          <div key={rfi.id} style={s.row}>
                            <div style={s.rowHead} onClick={() => setExpandedRfi(expandedRfi === rfi.id ? null : rfi.id)}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{rfi.title}</span>
                                  <span style={s.badge(rfi.status)}>{rfi.status}</span>
                                </div>
                                <span style={{ fontSize: '12px', color: '#555' }}>{new Date(rfi.created_at).toLocaleDateString()}</span>
                              </div>
                              <span style={{ color: '#555' }}>{expandedRfi === rfi.id ? '▲' : '▼'}</span>
                            </div>
                            {expandedRfi === rfi.id && (
                              <div style={s.rowBody}>
                                {rfi.description && <>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Details</p>
                                  <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>{rfi.description}</p>
                                </>}
                                {rfi.response ? (
                                  <div style={{ background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '8px', padding: '1rem' }}>
                                    <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>PM Response</p>
                                    <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{rfi.response}</p>
                                    {rfi.responded_at && <p style={{ fontSize: '11px', color: '#1a4a1a', margin: '6px 0 0' }}>{new Date(rfi.responded_at).toLocaleDateString()}</p>}
                                  </div>
                                ) : (
                                  <p style={{ fontSize: '13px', color: '#555', fontStyle: 'italic' }}>Awaiting response from PM.</p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* ── DELIVERIES ── */}
                {activeTab === 'deliveries' && (
                  <>
                    {deliverySuccess && <div style={s.success}>Delivery logged.</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <p style={{ margin: 0, fontSize: '13px', color: '#555' }}>{deliveries.length} entr{deliveries.length !== 1 ? 'ies' : 'y'}</p>
                      <button style={s.btnSm('orange')} onClick={() => setShowDeliveryForm(v => !v)}>{showDeliveryForm ? 'Cancel' : '+ Log delivery'}</button>
                    </div>
                    {showDeliveryForm && (
                      <div style={s.card}>
                        <h2 style={s.cardTitle}>Log delivery</h2>
                        <form onSubmit={submitDelivery}>
                          <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                            <div><label style={s.label}>Material *</label><input style={s.input} required value={deliveryForm.material} onChange={e => setDeliveryForm(f => ({ ...f, material: e.target.value }))} placeholder="Lumber, rebar, concrete..." /></div>
                            <div><label style={s.label}>Vendor</label><input style={s.input} value={deliveryForm.vendor} onChange={e => setDeliveryForm(f => ({ ...f, vendor: e.target.value }))} placeholder="ABC Supply" /></div>
                          </div>
                          <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                            <div><label style={s.label}>Expected date</label><input type="date" style={s.input} value={deliveryForm.expected_date} onChange={e => setDeliveryForm(f => ({ ...f, expected_date: e.target.value }))} /></div>
                            <div><label style={s.label}>Quantity</label><input style={s.input} value={deliveryForm.quantity} onChange={e => setDeliveryForm(f => ({ ...f, quantity: e.target.value }))} placeholder="100 sheets, 5 tons..." /></div>
                          </div>
                          <div style={{ marginBottom: '1.5rem' }}>
                            <label style={s.label}>Notes</label>
                            <input style={s.input} value={deliveryForm.notes} onChange={e => setDeliveryForm(f => ({ ...f, notes: e.target.value }))} placeholder="Special instructions..." />
                          </div>
                          <button type="submit" disabled={submittingDelivery} style={{ ...s.btn, opacity: submittingDelivery ? 0.6 : 1 }}>{submittingDelivery ? 'Saving...' : 'Log delivery'}</button>
                        </form>
                      </div>
                    )}
                    {deliveries.length === 0 && !showDeliveryForm && <div style={s.empty}>No deliveries logged yet.</div>}
                    {deliveries.map(d => (
                      <div key={d.id} style={{ ...s.row, border: `1px solid ${d.status === 'received' ? '#1a4a1a' : '#1e1e1e'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                              <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{d.material}</span>
                              <span style={s.badge(d.status)}>{d.status}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#555' }}>
                              {d.vendor && `${d.vendor} · `}{d.quantity && `${d.quantity} · `}
                              {d.expected_date && `Expected ${new Date(d.expected_date + 'T12:00:00').toLocaleDateString()}`}
                              {d.received_date && ` · Received ${new Date(d.received_date + 'T12:00:00').toLocaleDateString()}`}
                            </div>
                            {d.notes && <div style={{ fontSize: '12px', color: '#444', marginTop: '2px' }}>{d.notes}</div>}
                          </div>
                          {d.status === 'pending' && (
                            <button style={{ ...s.btnSm('green'), opacity: updatingDelivery === d.id ? 0.6 : 1 }} disabled={updatingDelivery === d.id} onClick={() => markDeliveryReceived(d.id)}>
                              {updatingDelivery === d.id ? '...' : 'Mark received'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {/* ── SCHEDULE ── */}
                {activeTab === 'schedule' && (
                  milestones.length === 0 ? (
                    <div style={s.empty}>No milestones set yet.<br />The PM will add schedule milestones here.</div>
                  ) : milestones.map(m => (
                    <div key={m.id} style={{ ...s.row, border: `1px solid ${m.status === 'complete' ? '#1a4a1a' : m.status === 'delayed' ? '#5a1a1a' : '#1e1e1e'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                            <span style={{ fontSize: '14px', fontWeight: '700', color: m.status === 'complete' ? '#4ade80' : '#f1f1f1' }}>{m.title}</span>
                            <span style={s.badge(m.status)}>{m.status}</span>
                          </div>
                          <div style={{ fontSize: '12px', color: '#555' }}>
                            {m.due_date && `Due ${new Date(m.due_date + 'T12:00:00').toLocaleDateString()}`}
                            {m.completed_date && ` · Completed ${new Date(m.completed_date + 'T12:00:00').toLocaleDateString()}`}
                          </div>
                          {m.notes && <div style={{ fontSize: '12px', color: '#444', marginTop: '2px' }}>{m.notes}</div>}
                        </div>
                        {m.status !== 'complete' && (
                          <button style={{ ...s.btnSm('green'), opacity: completingMilestone === m.id ? 0.6 : 1 }} disabled={completingMilestone === m.id} onClick={() => completeMilestone(m.id)}>
                            {completingMilestone === m.id ? '...' : 'Mark complete'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {/* ── SUB CONTACTS ── */}
                {activeTab === 'subs' && (
                  subContacts.length === 0 ? (
                    <div style={s.empty}>No subcontractors assigned to this job yet.</div>
                  ) : subContacts.map(sub => (
                    <div key={sub.id} style={s.card}>
                      <p style={{ margin: '0 0 3px', fontSize: '15px', fontWeight: '700', color: '#f1f1f1' }}>{sub.company_name}</p>
                      {sub.contact_name && <p style={{ margin: '0 0 3px', fontSize: '13px', color: '#888' }}>{sub.contact_name}</p>}
                      {sub.trade && <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>{sub.trade}</p>}
                      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        {sub.phone && (
                          <div>
                            <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '3px' }}>Phone</div>
                            <a href={`tel:${sub.phone}`} style={{ fontSize: '14px', color: '#60a5fa', textDecoration: 'none' }}>{sub.phone}</a>
                          </div>
                        )}
                        {sub.email && (
                          <div>
                            <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '3px' }}>Email</div>
                            <a href={`mailto:${sub.email}`} style={{ fontSize: '14px', color: '#60a5fa', textDecoration: 'none' }}>{sub.email}</a>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
