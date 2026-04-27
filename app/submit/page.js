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
  tabRow: { display: 'flex', marginBottom: '1.5rem', borderBottom: '1px solid #222' },
  tab: (active) => ({
    padding: '10px 20px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', background: 'none', border: 'none',
    color: active ? '#f1f1f1' : '#555', borderBottom: active ? '2px solid #e8590c' : '2px solid transparent',
    letterSpacing: '0.5px', marginBottom: '-1px'
  }),
  contractRow: { border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' },
  contractRowHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', cursor: 'pointer', background: '#0f0f0f' },
  contractRowExpanded: { borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' },
  coRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #1a1a1a' },
  coBadge: (status) => ({
    padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'approved' ? '#0a2a0a' : status === 'rejected' ? '#2a0a0a' : '#2a1200',
    color: status === 'approved' ? '#4ade80' : status === 'rejected' ? '#ff6b6b' : '#e8590c',
    border: `1px solid ${status === 'approved' ? '#1a4a1a' : status === 'rejected' ? '#5a1a1a' : '#4a2200'}`
  }),
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' },
  statCard: { background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem' },
  statLabel: { fontSize: '11px', fontWeight: '600', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '6px' },
  statValue: (accent) => ({ fontSize: '22px', fontWeight: '800', color: accent || '#f1f1f1', margin: 0 }),
}

export default function Submit() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [jobs, setJobs] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [myContracts, setMyContracts] = useState([])
  const [myCOs, setMyCOs] = useState({})
  const [expandedContract, setExpandedContract] = useState(null)
  const [form, setForm] = useState({ job_id: '', amount_billed: '', pct_complete: '', work_description: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [activeTab, setActiveTab] = useState('billing')
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
      await loadMyContracts(session.user.id)
    }
    load()
  }, [router])

  async function loadMyContracts(userId) {
    const { data: contractData } = await supabase
      .from('subcontract_summary')
      .select('*')
      .eq('sub_id', userId)
      .order('created_at', { ascending: false })
    if (!contractData || contractData.length === 0) { setMyContracts([]); return }
    const jobIds = [...new Set(contractData.map(c => c.job_id))]
    const { data: jobData } = await supabase.from('jobs').select('id, job_number, project_name').in('id', jobIds)
    const jobMap = Object.fromEntries((jobData || []).map(j => [j.id, j]))
    setMyContracts(contractData.map(c => ({ ...c, job: jobMap[c.job_id] })))
  }

  async function loadMyCOs(subcontractId) {
    const { data } = await supabase.from('change_orders').select('*').eq('subcontract_id', subcontractId).order('created_at', { ascending: false })
    setMyCOs(prev => ({ ...prev, [subcontractId]: data || [] }))
  }

  function toggleContract(id) {
    if (expandedContract === id) { setExpandedContract(null); return }
    setExpandedContract(id)
    loadMyCOs(id)
  }

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

  const totalContractValue = myContracts.reduce((a, c) => a + Number(c.contract_value || 0), 0)
  const totalRevised = myContracts.reduce((a, c) => a + Number(c.adjusted_contract_value || 0), 0)
  const totalApprovedBilling = submissions.filter(sub => sub.status === 'approved').reduce((a, sub) => a + (sub.amount_billed || 0), 0)

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

        <div style={s.tabRow}>
          <button style={s.tab(activeTab === 'billing')} onClick={() => setActiveTab('billing')}>Submit Billing</button>
          <button style={s.tab(activeTab === 'contracts')} onClick={() => setActiveTab('contracts')}>
            My Contracts{myContracts.length > 0 ? ` (${myContracts.length})` : ''}
          </button>
          <button style={s.tab(activeTab === 'history')} onClick={() => setActiveTab('history')}>
            Billing History{submissions.length > 0 ? ` (${submissions.length})` : ''}
          </button>
        </div>

        {/* ── SUBMIT BILLING TAB ── */}
        {activeTab === 'billing' && (
          jobs.length === 0 ? (
            <div style={s.empty}>You have not been assigned to any active jobs yet.<br />Contact NV Construction to get started.</div>
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
          )
        )}

        {/* ── MY CONTRACTS TAB ── */}
        {activeTab === 'contracts' && (
          <>
            {myContracts.length > 0 && (
              <div style={s.statRow}>
                <div style={s.statCard}>
                  <div style={s.statLabel}>Contract value</div>
                  <div style={s.statValue()}>${totalContractValue.toLocaleString()}</div>
                </div>
                <div style={s.statCard}>
                  <div style={s.statLabel}>Revised total</div>
                  <div style={s.statValue('#e8590c')}>${totalRevised.toLocaleString()}</div>
                </div>
                <div style={s.statCard}>
                  <div style={s.statLabel}>Approved billing</div>
                  <div style={s.statValue('#4ade80')}>${totalApprovedBilling.toLocaleString()}</div>
                </div>
              </div>
            )}

            {myContracts.length === 0 ? (
              <div style={s.empty}>No subcontracts on file yet.<br />Contact NV Construction for details.</div>
            ) : myContracts.map(c => {
              const cos = myCOs[c.id] || []
              const isExpanded = expandedContract === c.id
              return (
                <div key={c.id} style={s.contractRow}>
                  <div style={s.contractRowHeader} onClick={() => toggleContract(c.id)}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>
                        #{c.job?.job_number} — {c.job?.project_name}
                      </div>
                      {c.description && <div style={{ fontSize: '12px', color: '#555', marginTop: '3px' }}>{c.description}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Contract</div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#f1f1f1' }}>${Number(c.contract_value).toLocaleString()}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>COs</div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: Number(c.approved_change_orders) !== 0 ? '#4ade80' : '#333' }}>
                          {Number(c.approved_change_orders) >= 0 ? '+' : ''}${Number(c.approved_change_orders).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Revised</div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#e8590c' }}>${Number(c.adjusted_contract_value).toLocaleString()}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Remaining</div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: Number(c.remaining_balance) < 0 ? '#ff6b6b' : '#aaa' }}>
                          ${Number(c.remaining_balance).toLocaleString()}
                        </div>
                      </div>
                      <span style={{ color: '#555', fontSize: '16px' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={s.contractRowExpanded}>
                      {c.onedrive_url && (
                        <div style={{ marginBottom: '1rem' }}>
                          <a href={c.onedrive_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#60a5fa' }}>
                            📄 View contract document ↗
                          </a>
                        </div>
                      )}
                      <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginTop: 0, marginBottom: '0.75rem' }}>
                        Change orders ({cos.length})
                      </p>
                      {cos.length === 0 ? (
                        <p style={{ fontSize: '13px', color: '#444' }}>No change orders.</p>
                      ) : cos.map(co => (
                        <div key={co.id} style={s.coRow}>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: '13px', color: '#aaa' }}>{co.description}</span>
                            <span style={{ fontSize: '11px', color: '#555', marginLeft: '10px' }}>
                              {co.direction === 'pm_to_sub' ? 'PM → Sub' : 'Sub → PM'} · {new Date(co.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '13px', fontWeight: '700', color: Number(co.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>
                              {Number(co.amount) >= 0 ? '+' : ''}${Number(co.amount).toLocaleString()}
                            </span>
                            <span style={s.coBadge(co.status)}>{co.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* ── BILLING HISTORY TAB ── */}
        {activeTab === 'history' && (
          submissions.length === 0 ? (
            <div style={s.empty}>No billing submissions yet.</div>
          ) : (
            <div style={s.card}>
              <h2 style={s.cardTitle}>Billing history</h2>
              {submissions.map(s2 => (
                <div key={s2.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1e1e1e' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>#{s2.jobs?.job_number} — {s2.jobs?.project_name}</p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#555', marginTop: '3px' }}>{new Date(s2.submitted_at).toLocaleDateString()} · {s2.pct_complete ?? '—'}% complete</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <span style={{ fontWeight: '700', fontSize: '15px', color: '#f1f1f1' }}>${s2.amount_billed?.toLocaleString()}</span>
                    <span style={s.badge(s2.status)}>{s2.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </main>
    </div>
  )
}
