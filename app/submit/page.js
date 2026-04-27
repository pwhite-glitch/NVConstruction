'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { sendEmail, emailWrap } from '../../lib/email'

const PM_EMAIL = 'pwhite@nvim.co'

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

  // Bid invitations state
  const [bidInvitations, setBidInvitations] = useState([])
  const [expandedBidInv, setExpandedBidInv] = useState(null)
  const [bidPackageDetails, setBidPackageDetails] = useState({})
  const [bidSubmitForm, setBidSubmitForm] = useState({ amount: '', notes: '' })
  const [submittingBidFor, setSubmittingBidFor] = useState(null)
  const [billingFile, setBillingFile] = useState(null)
  const [bidFile, setBidFile] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (prof?.role === 'pm' || prof?.role === 'apm') { router.push('/dashboard'); return }
      if (prof?.role === 'super') { router.push('/field'); return }
      setProfile(prof)
      const { data: assignments } = await supabase.from('job_assignments').select('job_id, jobs(id, job_number, project_name, status)').eq('sub_id', session.user.id)
      setJobs((assignments || []).map(a => a.jobs).filter(j => j && j.status === 'active'))
      const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name)').eq('sub_id', session.user.id).order('submitted_at', { ascending: false })
      setSubmissions(subs || [])
      await loadMyContracts(session.user.id)
      await loadBidInvitations(session.user.email)
    }
    load()
  }, [router])

  async function loadBidInvitations(email) {
    const { data } = await supabase.from('bid_invitations').select('*, bid_packages(*)').eq('sub_email', email).order('sent_at', { ascending: false })
    setBidInvitations(data || [])
  }

  async function loadBidPackageDetail(bidPackageId) {
    const { data: plans } = await supabase.from('bid_plans').select('*').eq('bid_package_id', bidPackageId).order('uploaded_at')
    const { data: myBid } = await supabase.from('bid_submissions').select('*').eq('bid_package_id', bidPackageId).eq('sub_id', user.id).maybeSingle()
    setBidPackageDetails(prev => ({ ...prev, [bidPackageId]: { plans: plans || [], myBid } }))
    // mark as viewed if still 'invited'
    await supabase.from('bid_invitations').update({ status: 'viewed' }).eq('bid_package_id', bidPackageId).eq('sub_email', user.email).eq('status', 'invited')
  }

  async function openPlan(storagePath) {
    const { data } = await supabase.storage.from('bid-plans').createSignedUrl(storagePath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function openBidDoc(storagePath) {
    const { data } = await supabase.storage.from('bid-docs').createSignedUrl(storagePath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function openBillingDoc(storagePath) {
    const { data } = await supabase.storage.from('billing-docs').createSignedUrl(storagePath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function submitBid(bidPackageId) {
    if (!bidSubmitForm.amount) return
    setSubmittingBidFor(bidPackageId)
    let doc_url = null
    if (bidFile) {
      const path = `${bidPackageId}/${user.id}-${Date.now()}-${bidFile.name}`
      const { error: upErr } = await supabase.storage.from('bid-docs').upload(path, bidFile)
      if (!upErr) doc_url = path
    }
    const { error } = await supabase.from('bid_submissions').insert({
      bid_package_id: bidPackageId,
      sub_id: user.id,
      sub_email: user.email,
      company_name: profile?.company_name || 'Unknown',
      amount: parseFloat(bidSubmitForm.amount),
      notes: bidSubmitForm.notes || null,
      doc_url,
    })
    if (!error) {
      await supabase.from('bid_invitations').update({ status: 'submitted' }).eq('bid_package_id', bidPackageId).eq('sub_email', user.email)
      const inv = bidInvitations.find(i => i.bid_packages?.id === bidPackageId)
      const pkgTitle = inv?.bid_packages?.title || 'Bid Package'
      sendEmail(PM_EMAIL, `Bid received — ${profile?.company_name || user.email}`,
        emailWrap(`
          <h2 style="color:#f1f1f1;margin:0 0 1rem">New bid submitted</h2>
          <p style="color:#aaa;margin:0 0 6px"><strong style="color:#f1f1f1">${profile?.company_name || user.email}</strong> submitted a bid for <strong style="color:#f1f1f1">${pkgTitle}</strong>.</p>
          <p style="font-size:28px;font-weight:800;color:#e8590c;margin:1rem 0">$${parseFloat(bidSubmitForm.amount).toLocaleString()}</p>
          ${bidSubmitForm.notes ? `<p style="color:#888;font-size:13px">${bidSubmitForm.notes}</p>` : ''}
          ${doc_url ? `<p style="color:#888;font-size:13px">📎 Estimate attached</p>` : ''}
        `)
      )
      await loadBidPackageDetail(bidPackageId)
      await loadBidInvitations(user.email)
      setBidSubmitForm({ amount: '', notes: '' })
      setBidFile(null)
    }
    setSubmittingBidFor(null)
  }

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
    let doc_url = null
    if (billingFile) {
      const path = `${user.id}/${Date.now()}-${billingFile.name}`
      const { error: upErr } = await supabase.storage.from('billing-docs').upload(path, billingFile)
      if (!upErr) doc_url = path
    }
    const selectedJob = jobs.find(j => j.id === form.job_id)
    const { error } = await supabase.from('billing_submissions').insert({
      sub_id: user.id, job_id: form.job_id,
      sub_email: user.email,
      company_name: profile?.company_name || 'Unknown',
      contact_name: profile?.full_name, contact_info: profile?.phone,
      amount_billed: parseFloat(form.amount_billed),
      pct_complete: parseInt(form.pct_complete) || null,
      work_description: form.work_description,
      doc_url,
    })
    if (!error) {
      sendEmail(PM_EMAIL, `Billing submitted — ${profile?.company_name || user.email}`,
        emailWrap(`
          <h2 style="color:#f1f1f1;margin:0 0 1rem">New billing submission</h2>
          <p style="color:#aaa;margin:0 0 6px"><strong style="color:#f1f1f1">${profile?.company_name || user.email}</strong> submitted billing for <strong style="color:#f1f1f1">#${selectedJob?.job_number} — ${selectedJob?.project_name}</strong>.</p>
          <p style="font-size:28px;font-weight:800;color:#e8590c;margin:1rem 0">$${parseFloat(form.amount_billed).toLocaleString()}</p>
          ${form.pct_complete ? `<p style="color:#888;font-size:13px">${form.pct_complete}% complete on scope</p>` : ''}
          <p style="color:#888;font-size:13px;line-height:1.6">${form.work_description}</p>
          ${doc_url ? `<p style="color:#888;font-size:13px">📎 Attachment included</p>` : ''}
        `)
      )
      setSuccess(true)
      setForm({ job_id: '', amount_billed: '', pct_complete: '', work_description: '' })
      setBillingFile(null)
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
          <button style={s.tab(activeTab === 'bids')} onClick={() => setActiveTab('bids')}>
            Bid Invites{bidInvitations.length > 0 ? ` (${bidInvitations.length})` : ''}
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
                <div style={{ marginBottom: '1rem' }}>
                  <label style={s.label}>Work description</label>
                  <textarea value={form.work_description} onChange={e => update('work_description', e.target.value)} required rows={4} placeholder="Describe work completed this billing period..." style={{ ...s.input, resize: 'vertical' }} />
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={s.label}>Attach document (optional)</label>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx" onChange={e => setBillingFile(e.target.files[0] || null)} style={{ ...s.input, padding: '8px 14px', cursor: 'pointer', color: '#888' }} />
                  {billingFile && <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>📎 {billingFile.name}</div>}
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
        {/* ── BID INVITATIONS TAB ── */}
        {activeTab === 'bids' && (
          bidInvitations.length === 0 ? (
            <div style={s.empty}>No bid invitations yet.<br />NV Construction will notify you when plans are ready for bidding.</div>
          ) : (
            <>
              {bidInvitations.map(inv => {
                const pkg = inv.bid_packages
                if (!pkg) return null
                const isExp = expandedBidInv === pkg.id
                const det = bidPackageDetails[pkg.id] || {}
                const plans = det.plans || []
                const myBid = det.myBid
                const isClosed = pkg.status === 'closed' || pkg.status === 'awarded'
                const badgeStatus = inv.status === 'submitted' ? 'approved' : inv.status === 'declined' ? 'rejected' : 'pending'

                return (
                  <div key={inv.id} style={s.contractRow}>
                    <div style={s.contractRowHeader} onClick={() => {
                      if (isExp) { setExpandedBidInv(null) }
                      else { setExpandedBidInv(pkg.id); loadBidPackageDetail(pkg.id) }
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                          <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{pkg.title}</span>
                          <span style={s.coBadge(badgeStatus)}>{inv.status}</span>
                          {isClosed && <span style={{ fontSize: '11px', color: '#555' }}>Bidding closed</span>}
                        </div>
                        <div style={{ fontSize: '12px', color: '#555' }}>
                          {pkg.due_date ? `Bids due ${new Date(pkg.due_date + 'T00:00:00').toLocaleDateString()}` : 'No due date'}
                          {myBid && ` · Your bid: $${Number(myBid.amount).toLocaleString()}`}
                        </div>
                      </div>
                      <span style={{ color: '#555', fontSize: '16px' }}>{isExp ? '▲' : '▼'}</span>
                    </div>

                    {isExp && (
                      <div style={s.contractRowExpanded}>
                        {pkg.description && <p style={{ fontSize: '13px', color: '#888', margin: '0 0 1rem' }}>{pkg.description}</p>}

                        {pkg.scope_of_work && (
                          <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '1rem', marginBottom: '1.25rem' }}>
                            <div style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px' }}>Scope of work</div>
                            <div style={{ fontSize: '13px', color: '#aaa', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>{pkg.scope_of_work}</div>
                          </div>
                        )}

                        {/* Plans */}
                        <div style={{ marginBottom: '1.25rem' }}>
                          <div style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Plans & documents ({plans.length})</div>
                          {plans.length === 0 ? <p style={{ fontSize: '13px', color: '#444' }}>No plans uploaded yet.</p> : plans.map(plan => (
                            <div key={plan.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#111', borderRadius: '6px', marginBottom: '4px' }}>
                              <span style={{ fontSize: '13px', color: '#ccc' }}>📄 {plan.file_name}</span>
                              <button style={{ padding: '6px 14px', background: '#1a1a1a', color: '#aaa', border: '1px solid #2a2a2a', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }} onClick={() => openPlan(plan.storage_path)}>Open</button>
                            </div>
                          ))}
                        </div>

                        {/* Bid form or existing bid */}
                        {myBid ? (
                          <div style={{ background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '8px', padding: '1rem' }}>
                            <div style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px' }}>Your submitted bid</div>
                            <div style={{ fontSize: '24px', fontWeight: '800', color: '#4ade80' }}>${Number(myBid.amount).toLocaleString()}</div>
                            {myBid.notes && <p style={{ fontSize: '13px', color: '#4ade80', opacity: 0.7, margin: '6px 0 0' }}>{myBid.notes}</p>}
                            <p style={{ fontSize: '11px', color: '#1a4a1a', margin: '6px 0 0' }}>Submitted {new Date(myBid.submitted_at).toLocaleDateString()}{myBid.status === 'awarded' ? ' · AWARDED' : ''}</p>
                            {myBid.doc_url && (
                              <button onClick={() => openBidDoc(myBid.doc_url)} style={{ marginTop: '10px', fontSize: '12px', color: '#4ade80', background: 'none', border: '1px solid #1a4a1a', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer' }}>
                                📎 View attached estimate
                              </button>
                            )}
                          </div>
                        ) : isClosed ? (
                          <p style={{ fontSize: '13px', color: '#555' }}>Bidding is closed for this package.</p>
                        ) : (
                          <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '1rem' }}>
                            <div style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '1rem' }}>Submit your bid</div>
                            <div style={{ ...s.grid2, marginBottom: '12px' }}>
                              <div>
                                <label style={s.label}>Bid amount ($) *</label>
                                <input type="number" step="0.01" style={s.input} value={bidSubmitForm.amount} onChange={e => setBidSubmitForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                              </div>
                              <div>
                                <label style={s.label}>Notes / qualifications</label>
                                <input style={s.input} value={bidSubmitForm.notes} onChange={e => setBidSubmitForm(f => ({ ...f, notes: e.target.value }))} placeholder="Lead time, exclusions, etc." />
                              </div>
                            </div>
                            <div style={{ marginBottom: '12px' }}>
                              <label style={s.label}>Attach estimate (optional)</label>
                              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx" onChange={e => setBidFile(e.target.files[0] || null)} style={{ ...s.input, padding: '8px 14px', cursor: 'pointer', color: '#888' }} />
                              {bidFile && <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>📎 {bidFile.name}</div>}
                            </div>
                            <button
                              style={{ ...s.btn, opacity: submittingBidFor === pkg.id || !bidSubmitForm.amount ? 0.6 : 1 }}
                              disabled={submittingBidFor === pkg.id || !bidSubmitForm.amount}
                              onClick={() => submitBid(pkg.id)}>
                              {submittingBidFor === pkg.id ? 'Submitting...' : 'Submit bid'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )
        )}

      </main>
    </div>
  )
}
