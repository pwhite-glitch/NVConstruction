'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
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
  const [form, setForm] = useState({ job_id: '', amount_billed: '', pct_complete: '', work_description: '', billing_period: new Date().toISOString().slice(0, 7), draw_request_id: '' })
  const [jobDrawRequests, setJobDrawRequests] = useState([])
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
  const [dirEntry, setDirEntry] = useState(null)
  const [docsW9File, setDocsW9File] = useState(null)
  const [docsCoiFile, setDocsCoiFile] = useState(null)
  const [docsCoiExpiry, setDocsCoiExpiry] = useState('')
  const [savingDocs, setSavingDocs] = useState(false)
  const [docsSaved, setDocsSaved] = useState(false)
  const [jobSovContracts, setJobSovContracts] = useState([])
  const [sovForm, setSovForm] = useState([])
  const [sovRetainageMap, setSovRetainageMap] = useState({})
  const [sovError, setSovError] = useState('')
  const [noContract, setNoContract] = useState(false)
  const [sovDraftLines, setSovDraftLines] = useState([{ description: '', amount: '' }])
  const [savingSov, setSavingSov] = useState(false)

  // Lien waiver state
  const [lienWaiverSub, setLienWaiverSub] = useState(null)
  const [signerName, setSignerName] = useState('')
  const [savingWaiver, setSavingWaiver] = useState(false)
  const [waiverMsg, setWaiverMsg] = useState('')
  const canvasRef = useRef(null)
  const isDrawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (prof?.role === 'pm' || prof?.role === 'apm') { router.push('/dashboard'); return }
      if (prof?.role === 'super') { router.push('/field'); return }
      setProfile(prof)
      // Link any unmatched contracts where vendor_name matches this sub's company
      if (prof?.company_name) {
        await fetch('/api/link-sub-contracts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: session.user.id, company_name: prof.company_name }),
        })
      }
      const [{ data: assignments }, { data: contractJobs }] = await Promise.all([
        supabase.from('job_assignments').select('job_id, jobs(id, job_number, project_name, status, pm_email)').eq('sub_id', session.user.id),
        supabase.from('subcontracts').select('job_id, jobs(id, job_number, project_name, status, pm_email)').eq('sub_id', session.user.id),
      ])
      const assignedJobs = (assignments || []).map(a => a.jobs).filter(j => j && j.status === 'active')
      const contractedJobs = (contractJobs || []).map(c => c.jobs).filter(j => j && j.status === 'active')
      const allJobIds = new Set(assignedJobs.map(j => j.id))
      const mergedJobs = [...assignedJobs, ...contractedJobs.filter(j => !allJobIds.has(j.id))]
      setJobs(mergedJobs)
      const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name, location, owner_name, owner_company)').eq('sub_id', session.user.id).order('submitted_at', { ascending: false })
      setSubmissions(subs || [])
      await loadMyContracts(session.user.id)
      await loadBidInvitations(session.user.email)
      const { data: dir } = await supabase.from('sub_directory').select('*').eq('email', session.user.email).maybeSingle()
      if (dir) { setDirEntry(dir); setDocsCoiExpiry(dir.coi_expiration?.split('T')[0] || '') }
    }
    load()
  }, [router])

  async function loadBidInvitations(email) {
    const { data } = await supabase.from('bid_invitations').select('*, bid_packages(*)').eq('sub_email', email).order('sent_at', { ascending: false })
    setBidInvitations(data || [])
  }

  async function uploadDocFile(file, folder) {
    const ext = file.name.split('.').pop()
    const path = `${dirEntry.id}/${folder}-${Date.now()}.${ext}`
    const res = await fetch('/api/sub-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upload-url', path }),
    })
    const { signedUrl, error } = await res.json()
    if (error || !signedUrl) throw new Error(error || 'Could not get upload URL')
    const up = await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
    if (!up.ok) throw new Error('Upload failed')
    return path
  }

  async function saveDocs() {
    if (!dirEntry) return
    setSavingDocs(true)
    let w9_url = dirEntry.w9_url || null
    let coi_url = dirEntry.coi_url || null
    try {
      if (docsW9File) w9_url = await uploadDocFile(docsW9File, 'w9')
      if (docsCoiFile) coi_url = await uploadDocFile(docsCoiFile, 'coi')
    } catch (err) {
      alert('Upload failed: ' + err.message)
      setSavingDocs(false)
      return
    }
    await fetch('/api/sub-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory_id: dirEntry.id, w9_url, coi_url, coi_expiration: docsCoiExpiry || null }) })
    setDirEntry(prev => ({ ...prev, w9_url, coi_url, coi_expiration: docsCoiExpiry }))
    setDocsW9File(null)
    setDocsCoiFile(null)
    setSavingDocs(false)
    setDocsSaved(true)
    setTimeout(() => setDocsSaved(false), 3000)
  }

  async function loadBidPackageDetail(bidPackageId) {
    const { data: plans } = await supabase.from('bid_plans').select('*').eq('bid_package_id', bidPackageId).order('uploaded_at')
    const { data: myBid } = await supabase.from('bid_submissions').select('*').eq('bid_package_id', bidPackageId).eq('sub_id', user.id).maybeSingle()
    setBidPackageDetails(prev => ({ ...prev, [bidPackageId]: { plans: plans || [], myBid } }))
    // mark as viewed if still 'invited'
    await supabase.from('bid_invitations').update({ status: 'viewed' }).eq('bid_package_id', bidPackageId).eq('sub_email', user.email).eq('status', 'invited')
  }

  async function openPlan(storagePath) {
    const res = await fetch('/api/bid-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signed-url', path: storagePath }),
    })
    const { url } = await res.json()
    if (url) window.open(url, '_blank')
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

  async function loadJobSov(jobId) {
    if (!jobId || !user) { setJobSovContracts([]); setSovForm([]); setNoContract(false); setJobDrawRequests([]); return }
    const drRes = await fetch(`/api/draw-requests?job_id=${jobId}`)
    const { draws } = await drRes.json()
    const openDraws = (draws || []).filter(d => d.status === 'open')
    setJobDrawRequests(openDraws)
    const { data: contracts } = await supabase.from('subcontracts').select('id, description, retainage_pct, contract_value').eq('sub_id', user.id).eq('job_id', jobId)
    if (!contracts || contracts.length === 0) { setJobSovContracts([]); setSovForm([]); setSovRetainageMap({}); setNoContract(true); setSovDraftLines([{ description: '', amount: '' }]); return }
    setNoContract(false)
    setSovDraftLines([{ description: '', amount: '' }])
    const contractIds = contracts.map(c => c.id)
    const retMap = Object.fromEntries(contracts.map(c => [c.id, parseFloat(c.retainage_pct) || 0]))
    setSovRetainageMap(retMap)
    const { data: lines } = await supabase.from('subcontract_sov_lines').select('*, subcontracts(description, retainage_pct)').in('subcontract_id', contractIds).order('sort_order').order('created_at')
    const lineIds = (lines || []).map(l => l.id)
    const prevPctMap = {}
    if (lineIds.length > 0) {
      const { data: prevBilled } = await supabase
        .from('billing_sov_lines')
        .select('sov_line_id, pct_this_period, billing_submissions(status)')
        .in('sov_line_id', lineIds)
      for (const pl of (prevBilled || [])) {
        if (pl.billing_submissions?.status !== 'rejected') {
          prevPctMap[pl.sov_line_id] = (prevPctMap[pl.sov_line_id] || 0) + (parseFloat(pl.pct_this_period) || 0)
        }
      }
    }
    setJobSovContracts(contracts)
    setSovError('')
    setSovForm((lines || []).map(l => ({
      sov_line_id: l.id,
      subcontract_id: l.subcontract_id,
      description: l.description,
      scheduled_value: Number(l.scheduled_value || 0),
      retainage_pct: parseFloat(l.subcontracts?.retainage_pct) || 0,
      contract_description: l.subcontracts?.description || '',
      pct_prev: Math.min(100, Math.round((prevPctMap[l.id] || 0) * 100) / 100),
      pct_this: '',
      amount_this: 0,
    })))
  }

  async function saveSovLines() {
    const valid = sovDraftLines.filter(l => l.description.trim() && l.amount)
    if (valid.length === 0) return
    setSavingSov(true)
    for (const contract of jobSovContracts) {
      await supabase.from('subcontract_sov_lines').insert(
        valid.map((l, idx) => ({
          subcontract_id: contract.id,
          description: l.description.trim(),
          scheduled_value: parseFloat(l.amount),
          sort_order: idx + 1,
        }))
      )
    }
    setSavingSov(false)
    await loadJobSov(form.job_id)
  }

  function printLienWaiver(sub) {
    const amt = parseFloat(sub.amount_billed || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const period = sub.billing_period
      ? new Date(sub.billing_period + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const owner = sub.jobs?.owner_company || sub.jobs?.owner_name || 'Project Owner'
    const signedAt = sub.lien_waiver_signed_at ? new Date(sub.lien_waiver_signed_at).toLocaleDateString() : null
    const w = window.open('', '_blank')
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lien Waiver</title>
<style>
  body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; padding: 0 24px; color: #000; }
  h1 { font-size: 16px; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 4px; }
  .sub { font-size: 11px; color: #555; font-style: italic; margin: 0 0 24px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #ccc; margin-bottom: 16px; }
  .cell { padding: 10px 12px; border-bottom: 1px solid #ddd; }
  .cell:nth-child(odd) { border-right: 1px solid #ddd; }
  .cell label { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: #888; margin-bottom: 3px; }
  .cell span { font-size: 13px; font-weight: 600; }
  .body { font-size: 12px; line-height: 1.8; color: #333; margin-bottom: 24px; border: 1px solid #ccc; padding: 16px; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
  .sig-line { border-bottom: 1px solid #000; margin-top: 40px; }
  .sig-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-top: 4px; }
  .sig-img { max-width: 200px; max-height: 60px; margin-top: 4px; }
  @media print { .no-print { display: none; } }
</style></head><body>
<button class="no-print" onclick="window.print()" style="margin-bottom:24px;padding:10px 20px;background:#000;color:#fff;border:none;cursor:pointer;font-size:13px;">Print / Save as PDF</button>
<p style="text-align:center;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#888;margin-bottom:8px;">Conditional Waiver and Release on Progress Payment</p>
<h1 style="text-align:center;">Lien Waiver</h1>
<p class="sub" style="text-align:center;">Effective upon receipt of payment in good funds</p>
<div class="grid">
  <div class="cell"><label>Claimant (Subcontractor)</label><span>${sub.company_name || ''}</span></div>
  <div class="cell"><label>Hiring Party</label><span>NV Construction</span></div>
  <div class="cell"><label>Project</label><span>#${sub.jobs?.job_number} — ${sub.jobs?.project_name}</span></div>
  <div class="cell"><label>Owner</label><span>${owner}</span></div>
  <div class="cell"><label>Conditional Payment Amount</label><span style="font-size:16px;font-weight:800;">${amt}</span></div>
  <div class="cell"><label>Through Date</label><span>${period}</span></div>
</div>
<div class="body">
  <strong>Conditional Waiver and Release.</strong> This document, when signed, conditionally waives and releases any mechanic's lien, stop payment notice, or payment bond right the Claimant has for labor, services, equipment, or material furnished through the Through Date on the Project. The rights are waived and released only to the extent of the Conditional Payment Amount actually received in good funds, and this waiver is conditioned on receipt of such payment. Claimant retains all rights for amounts not covered by this payment.
</div>
<div class="sig-grid">
  <div>
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 6px;">Authorized Signature</p>
    ${sub.lien_waiver_signature ? `<img src="${sub.lien_waiver_signature}" class="sig-img" />` : '<div class="sig-line"></div>'}
    <div class="sig-label">Signature</div>
  </div>
  <div>
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 6px;">Printed Name &amp; Title</p>
    ${sub.lien_waiver_signer_name ? `<p style="margin:4px 0;font-size:14px;font-weight:600;">${sub.lien_waiver_signer_name}</p>` : '<div class="sig-line"></div>'}
    <div class="sig-label">Name / Title</div>
  </div>
  <div>
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 6px;">Date Signed</p>
    <p style="margin:4px 0;font-size:13px;">${signedAt || '_________________'}</p>
    <div class="sig-label">Date</div>
  </div>
  <div>
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 6px;">Company</p>
    <p style="margin:4px 0;font-size:13px;">${sub.company_name || '_________________'}</p>
    <div class="sig-label">Company Name</div>
  </div>
</div>
</body></html>`)
    w.document.close()
  }

  async function submitLienWaiver() {
    if (!signerName.trim()) return
    const canvas = canvasRef.current
    const signature = canvas ? canvas.toDataURL('image/png') : null
    setSavingWaiver(true)
    const res = await fetch('/api/lien-waiver-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submission_id: lienWaiverSub.id, signer_name: signerName.trim(), signature }),
    })
    const result = await res.json()
    if (result.error) { setWaiverMsg('Error: ' + result.error) }
    else {
      setLienWaiverSub(null)
      setSignerName('')
      setWaiverMsg('')
      const { data: subs } = await supabase.from('billing_submissions').select('*, jobs(job_number, project_name, location, owner_name, owner_company)').eq('sub_id', user.id).order('submitted_at', { ascending: false })
      setSubmissions(subs || [])
    }
    setSavingWaiver(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (noContract) return
    if (sovForm.length > 0) {
      const overBilled = sovForm.filter(l => (l.pct_prev || 0) + (parseFloat(l.pct_this) || 0) > 100)
      if (overBilled.length > 0) {
        setSovError(`Over-billing on: ${overBilled.map(l => l.description).join(', ')}. Cumulative % would exceed 100%.`)
        return
      }
    }
    setSovError('')
    setLoading(true)
    let doc_url = null
    if (billingFile) {
      const path = `${user.id}/${Date.now()}-${billingFile.name}`
      const { error: upErr } = await supabase.storage.from('billing-docs').upload(path, billingFile)
      if (!upErr) doc_url = path
    }
    const selectedJob = jobs.find(j => j.id === form.job_id)
    const totalAmtBilled = parseFloat(form.amount_billed) || 0
    const retainageHeld = sovForm.length > 0
      ? Math.round(sovForm.reduce((a, l) => a + l.amount_this * (l.retainage_pct || 0) / 100, 0) * 100) / 100
      : 0
    const weightedRetPct = totalAmtBilled > 0 && retainageHeld > 0
      ? Math.round(retainageHeld / totalAmtBilled * 100 * 100) / 100
      : 0
    const { data: newSub, error } = await supabase.from('billing_submissions').insert({
      sub_id: user.id, job_id: form.job_id,
      sub_email: user.email,
      company_name: profile?.company_name || 'Unknown',
      contact_name: profile?.full_name, contact_info: profile?.phone,
      amount_billed: totalAmtBilled,
      retainage_pct: weightedRetPct,
      retainage_held: retainageHeld,
      pct_complete: parseInt(form.pct_complete) || null,
      work_description: form.work_description,
      billing_period: form.billing_period ? form.billing_period + '-01' : null,
      draw_request_id: form.draw_request_id || null,
      doc_url,
    }).select().single()
    if (!error) {
      const sovInserts = sovForm.filter(l => l.amount_this > 0).map(l => ({
        billing_submission_id: newSub.id,
        sov_line_id: l.sov_line_id,
        amount: l.amount_this,
        pct_this_period: parseFloat(l.pct_this) || 0,
      }))
      if (sovInserts.length > 0) {
        await supabase.from('billing_sov_lines').insert(sovInserts)
      }
      sendEmail(selectedJob?.pm_email || PM_EMAIL, `Billing submitted — ${profile?.company_name || user.email}`,
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
      setForm({ job_id: '', amount_billed: '', pct_complete: '', work_description: '', billing_period: new Date().toISOString().slice(0, 7), draw_request_id: '' })
      setSovForm([])
      setJobSovContracts([])
      setSovRetainageMap({})
      setJobDrawRequests([])
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

      <main style={s.main} className="rx-main">
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
          <button style={s.tab(activeTab === 'docs')} onClick={() => setActiveTab('docs')}>My Documents</button>
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
                  <select value={form.job_id} onChange={e => { update('job_id', e.target.value); loadJobSov(e.target.value) }} required style={s.input}>
                    <option value="">Select a project...</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                  </select>
                </div>
                {sovForm.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={s.label}>Schedule of values</label>
                    <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Line item</th>
                            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Scheduled</th>
                            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Ret %</th>
                            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Prev %</th>
                            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', width: '120px' }}>% This period</th>
                            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Amount ($)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sovForm.map((line, idx) => {
                            const lineRetHeld = Math.round(line.amount_this * (line.retainage_pct || 0) / 100 * 100) / 100
                            const lineNet = line.amount_this - lineRetHeld
                            const remaining = Math.max(0, 100 - (line.pct_prev || 0))
                            const isOver = (line.pct_prev || 0) + (parseFloat(line.pct_this) || 0) > 100
                            return (
                              <tr key={line.sov_line_id} style={{ borderBottom: '1px solid #111', background: isOver ? 'rgba(255,50,50,0.05)' : 'transparent' }}>
                                <td style={{ padding: '8px 12px', color: '#ccc' }}>
                                  {line.description}
                                  {line.contract_description && <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>{line.contract_description}</div>}
                                </td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', color: '#888' }}>${line.scheduled_value.toLocaleString()}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', color: line.retainage_pct > 0 ? '#facc15' : '#444' }}>
                                  {line.retainage_pct > 0 ? `${line.retainage_pct}%` : '—'}
                                </td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                  {(line.pct_prev || 0) > 0 ? (
                                    <div>
                                      <span style={{ color: '#888', fontSize: '13px' }}>{line.pct_prev}%</span>
                                      <div style={{ fontSize: '11px', color: remaining > 0 ? '#555' : '#ff6b6b', marginTop: '2px' }}>{remaining}% left</div>
                                    </div>
                                  ) : <span style={{ color: '#333' }}>—</span>}
                                </td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                  <input
                                    type="number" min="0" max={remaining} step="1"
                                    value={line.pct_this}
                                    placeholder="0"
                                    onChange={e => {
                                      const pct = parseFloat(e.target.value) || 0
                                      const amt = Math.round(line.scheduled_value * pct / 100 * 100) / 100
                                      const next = sovForm.map((l, i) => i === idx ? { ...l, pct_this: e.target.value, amount_this: amt } : l)
                                      setSovForm(next)
                                      setSovError('')
                                      const total = next.reduce((a, l) => a + l.amount_this, 0)
                                      update('amount_billed', total.toFixed(2))
                                    }}
                                    style={{ ...s.input, width: '80px', padding: '6px 10px', textAlign: 'right', borderColor: isOver ? '#ff6b6b' : '#2a2a2a' }}
                                  />
                                </td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                  <input
                                    type="number" min="0" max={line.scheduled_value} step="0.01"
                                    value={line.amount_this || ''}
                                    placeholder="0.00"
                                    onChange={e => {
                                      const amt = parseFloat(e.target.value) || 0
                                      const pct = line.scheduled_value > 0 ? Math.round(amt / line.scheduled_value * 100 * 10000) / 10000 : 0
                                      const next = sovForm.map((l, i) => i === idx ? { ...l, pct_this: pct.toString(), amount_this: amt } : l)
                                      setSovForm(next)
                                      setSovError('')
                                      const total = next.reduce((a, l) => a + l.amount_this, 0)
                                      update('amount_billed', total.toFixed(2))
                                    }}
                                    style={{ ...s.input, width: '100px', padding: '6px 10px', textAlign: 'right' }}
                                  />
                                  {line.retainage_pct > 0 && line.amount_this > 0 && (
                                    <div style={{ fontSize: '11px', marginTop: '2px' }}>
                                      <span style={{ color: '#facc15' }}>−${lineRetHeld.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                      <span style={{ color: '#4ade80', marginLeft: '6px' }}>=${lineNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                          {(() => {
                            const totalGross = sovForm.reduce((a, l) => a + l.amount_this, 0)
                            const totalRetHeld = Math.round(sovForm.reduce((a, l) => a + l.amount_this * (l.retainage_pct || 0) / 100, 0) * 100) / 100
                            const totalNet = totalGross - totalRetHeld
                            return (
                              <>
                                <tr style={{ background: '#111' }}>
                                  <td colSpan={5} style={{ padding: '8px 12px', color: '#888', fontSize: '12px', textAlign: 'right', fontWeight: '700' }}>Gross this period:</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', color: '#e8590c', fontWeight: '800', fontSize: '14px' }}>
                                    ${totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                </tr>
                                {totalRetHeld > 0 && (
                                  <>
                                    <tr style={{ background: '#0f0f0f' }}>
                                      <td colSpan={5} style={{ padding: '6px 12px', color: '#facc15', fontSize: '12px', textAlign: 'right', fontWeight: '700' }}>Retainage held:</td>
                                      <td style={{ padding: '6px 12px', textAlign: 'right', color: '#facc15', fontWeight: '700' }}>
                                        −${totalRetHeld.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                    <tr style={{ background: '#0a0a0a' }}>
                                      <td colSpan={5} style={{ padding: '6px 12px', color: '#4ade80', fontSize: '12px', textAlign: 'right', fontWeight: '700' }}>Net payment due:</td>
                                      <td style={{ padding: '6px 12px', textAlign: 'right', color: '#4ade80', fontWeight: '800', fontSize: '14px' }}>
                                        ${totalNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  </>
                                )}
                              </>
                            )
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {form.job_id && noContract && (
                  <div style={{ background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '14px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' }}>
                    No subcontract on file for this project. Contact NV Construction to have your subcontract issued before submitting billing.
                  </div>
                )}

                {/* ── SOV builder: contracts exist but no lines yet ── */}
                {form.job_id && !noContract && jobSovContracts.length > 0 && sovForm.length === 0 && (() => {
                  const contractMax = jobSovContracts.reduce((a, c) => a + Number(c.contract_value || 0), 0)
                  const totalDraft = sovDraftLines.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0)
                  const remaining = contractMax - totalDraft
                  const isBalanced = Math.round(totalDraft * 100) === Math.round(contractMax * 100)
                  return (
                    <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                        <div>
                          <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: '700', color: '#f1f1f1' }}>Create your Schedule of Values</p>
                          <p style={{ margin: 0, fontSize: '12px', color: '#555', lineHeight: '1.6' }}>Break your contract into billing line items. Total must match your contract value.</p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '16px' }}>
                          <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px', letterSpacing: '1px', textTransform: 'uppercase' }}>Contract value</div>
                          <div style={{ fontSize: '22px', fontWeight: '800', color: '#e8590c' }}>${contractMax.toLocaleString()}</div>
                        </div>
                      </div>

                      {sovDraftLines.map((line, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 32px', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                          <input
                            style={s.input}
                            value={line.description}
                            onChange={e => setSovDraftLines(lines => lines.map((l, i) => i === idx ? { ...l, description: e.target.value } : l))}
                            placeholder={`Line item ${idx + 1} (e.g. Mobilization, Rough-in, Finishes...)`}
                          />
                          <input
                            type="number" step="0.01" min="0"
                            style={{ ...s.input, textAlign: 'right' }}
                            value={line.amount}
                            onChange={e => setSovDraftLines(lines => lines.map((l, i) => i === idx ? { ...l, amount: e.target.value } : l))}
                            placeholder="0.00"
                          />
                          {sovDraftLines.length > 1 && (
                            <button
                              type="button"
                              style={{ padding: '10px', background: '#2a0a0a', color: '#ff6b6b', border: '1px solid #5a1a1a', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}
                              onClick={() => setSovDraftLines(lines => lines.filter((_, i) => i !== idx))}
                            >✕</button>
                          )}
                        </div>
                      ))}

                      <button
                        type="button"
                        style={{ fontSize: '12px', color: '#888', background: 'none', border: '1px dashed #2a2a2a', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', marginBottom: '1rem', width: '100%' }}
                        onClick={() => setSovDraftLines(lines => [...lines, { description: '', amount: '' }])}
                      >+ Add line item</button>

                      {contractMax > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '10px 14px', background: '#080808', border: `1px solid ${isBalanced ? '#1a4a1a' : remaining < 0 ? '#5a1a1a' : '#2a2a2a'}`, borderRadius: '8px', marginBottom: '1rem' }}>
                          <span style={{ color: '#888' }}>Total: <strong style={{ color: '#f1f1f1' }}>${totalDraft.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></span>
                          <span style={{ fontWeight: '700', color: isBalanced ? '#4ade80' : remaining < 0 ? '#ff6b6b' : '#e8590c' }}>
                            {isBalanced ? '✓ Matches contract' : remaining > 0 ? `$${remaining.toLocaleString('en-US', { minimumFractionDigits: 2 })} remaining` : `$${Math.abs(remaining).toLocaleString('en-US', { minimumFractionDigits: 2 })} over contract`}
                          </span>
                        </div>
                      )}

                      <button
                        type="button"
                        style={{ ...s.btn, opacity: (savingSov || !isBalanced || sovDraftLines.every(l => !l.description.trim() || !l.amount)) ? 0.5 : 1 }}
                        disabled={savingSov || !isBalanced || sovDraftLines.every(l => !l.description.trim() || !l.amount)}
                        onClick={saveSovLines}
                      >{savingSov ? 'Saving...' : 'Submit Schedule of Values'}</button>
                    </div>
                  )
                })()}

                {/* ── Billing form: SOV exists ── */}
                {!noContract && sovForm.length > 0 && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '1rem' }} className="rx-grid-3">
                      <div>
                        <label style={s.label}>Amount billed</label>
                        <div style={{ ...s.input, color: '#e8590c', fontWeight: '700', cursor: 'default' }}>
                          ${parseFloat(form.amount_billed || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div><label style={s.label}>% complete on scope</label><input type="number" style={s.input} value={form.pct_complete} onChange={e => update('pct_complete', e.target.value)} placeholder="0" min="0" max="100" /></div>
                      <div>
                        <label style={s.label}>Billing period</label>
                        {jobDrawRequests.length > 0 ? (
                          <select style={s.input} value={form.draw_request_id} onChange={e => update('draw_request_id', e.target.value)} required>
                            <option value="">— Select a draw —</option>
                            {jobDrawRequests.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                          </select>
                        ) : (
                          <input type="month" style={s.input} value={form.billing_period} onChange={e => update('billing_period', e.target.value)} />
                        )}
                      </div>
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
                    {sovError && <div style={{ background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' }}>{sovError}</div>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="submit" disabled={loading} style={{ ...s.btn, opacity: loading ? 0.6 : 1 }}>{loading ? 'Submitting...' : 'Submit billing'}</button>
                    </div>
                  </>
                )}
              </form>
            </div>
          )
        )}

        {/* ── MY CONTRACTS TAB ── */}
        {activeTab === 'contracts' && (
          <>
            {myContracts.length > 0 && (
              <div style={s.statRow} className="rx-stats">
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
                <div key={s2.id} style={{ padding: '14px 0', borderBottom: '1px solid #1e1e1e' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>#{s2.jobs?.job_number} — {s2.jobs?.project_name}</p>
                      <p style={{ margin: 0, fontSize: '12px', color: '#555', marginTop: '3px' }}>
                        {new Date(s2.submitted_at).toLocaleDateString()} · {s2.pct_complete ?? '—'}% complete
                        {s2.draw_request_id
                          ? <span style={{ background: '#2a1200', color: '#e8590c', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', marginLeft: '6px', fontWeight: '700' }}>Draw #{s2.draw_request_id.slice(-4)}</span>
                          : s2.billing_period && <span style={{ background: '#1a2a1a', color: '#4ade80', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', marginLeft: '6px' }}>{new Date(s2.billing_period + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                        }
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '700', fontSize: '15px', color: '#f1f1f1' }}>${s2.amount_billed?.toLocaleString()}</div>
                        {s2.retainage_held > 0 && (
                          <div style={{ fontSize: '11px', marginTop: '2px' }}>
                            <span style={{ color: '#facc15' }}>Ret: ${Number(s2.retainage_held).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            <span style={{ color: '#4ade80', marginLeft: '6px' }}>Net: ${(Number(s2.amount_billed) - Number(s2.retainage_held)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                      </div>
                      <span style={s.badge(s2.status)}>{s2.status}</span>
                      {s2.status === 'approved' && (
                        <button
                          onClick={() => printLienWaiver(s2)}
                          style={{ padding: '5px 12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#aaa', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '0.5px' }}
                        >🖨 Print Waiver</button>
                      )}
                      {s2.status === 'approved' && !s2.lien_waiver_signed_at && (
                        <button
                          onClick={() => { setLienWaiverSub(s2); setSignerName(profile?.full_name || '') }}
                          style={{ padding: '5px 12px', background: '#2a1200', border: '1px solid #4a2200', borderRadius: '6px', color: '#e8590c', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '0.5px' }}
                        >✍ Sign Waiver</button>
                      )}
                      {s2.lien_waiver_signed_at && (
                        <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: '700' }}>✓ Signed {new Date(s2.lien_waiver_signed_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  {s2.status === 'rejected' && s2.rejection_reason && (
                    <div style={{ background: '#1a0a0a', border: '1px solid #3a1a1a', borderRadius: '6px', padding: '10px 14px', marginTop: '10px' }}>
                      <p style={{ margin: 0, fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: '700', marginBottom: '4px' }}>Rejection reason</p>
                      <p style={{ margin: 0, fontSize: '13px', color: '#ff6b6b', lineHeight: '1.5' }}>{s2.rejection_reason}</p>
                    </div>
                  )}
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
                            <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
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

        {/* ── MY DOCUMENTS ── */}
        {activeTab === 'docs' && (
          <div style={s.card}>
            <h2 style={s.cardTitle}>My Documents & Compliance</h2>
            {!dirEntry ? (
              <p style={{ color: '#555', fontSize: '14px' }}>No directory record found for your account. Contact NV Construction to get set up.</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }} className="rx-grid-2">
                  <div>
                    <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' }}>W-9</p>
                    {dirEntry.w9_url
                      ? <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#4ade80' }}>✓ On file</p>
                      : <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#e8590c' }}>Not on file</p>}
                    <label style={{ ...s.label, cursor: 'pointer', display: 'inline-block', padding: '8px 14px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', marginBottom: 0 }}>
                      {docsW9File ? `📎 ${docsW9File.name}` : dirEntry.w9_url ? 'Replace W-9' : 'Upload W-9'}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setDocsW9File(e.target.files[0] || null)} />
                    </label>
                  </div>
                  <div>
                    <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' }}>Certificate of Insurance (COI)</p>
                    {dirEntry.coi_url
                      ? <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#4ade80' }}>✓ On file</p>
                      : <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#e8590c' }}>Not on file</p>}
                    <label style={{ ...s.label, cursor: 'pointer', display: 'inline-block', padding: '8px 14px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', marginBottom: 0 }}>
                      {docsCoiFile ? `📎 ${docsCoiFile.name}` : dirEntry.coi_url ? 'Replace COI' : 'Upload COI'}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setDocsCoiFile(e.target.files[0] || null)} />
                    </label>
                  </div>
                </div>
                <div style={{ marginBottom: '1.5rem', maxWidth: '280px' }}>
                  <label style={s.label}>COI expiration date</label>
                  <input type="date" style={s.input} value={docsCoiExpiry} onChange={e => setDocsCoiExpiry(e.target.value)} />
                  {dirEntry.coi_expiration && !docsCoiExpiry && (
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#555' }}>Current: {new Date(dirEntry.coi_expiration).toLocaleDateString()}</p>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button style={{ ...s.btn, opacity: savingDocs ? 0.6 : 1 }} disabled={savingDocs} onClick={saveDocs}>
                    {savingDocs ? 'Saving...' : 'Save documents'}
                  </button>
                  {docsSaved && <span style={{ fontSize: '13px', color: '#4ade80' }}>✓ Saved — NV Construction can now view your documents.</span>}
                </div>
              </>
            )}
          </div>
        )}

      </main>

      {/* ── LIEN WAIVER SIGNATURE MODAL ── */}
      {lienWaiverSub && (() => {
        const sub = lienWaiverSub
        const amt = parseFloat(sub.amount_billed || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        const period = sub.billing_period
          ? new Date(sub.billing_period + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
          : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        const owner = sub.jobs?.owner_company || sub.jobs?.owner_name || 'Project Owner'

        function getPos(e, canvas) {
          const r = canvas.getBoundingClientRect()
          const src = e.touches ? e.touches[0] : e
          return { x: src.clientX - r.left, y: src.clientY - r.top }
        }

        function startDraw(e) {
          e.preventDefault()
          const canvas = canvasRef.current
          if (!canvas) return
          isDrawing.current = true
          lastPos.current = getPos(e, canvas)
        }

        function draw(e) {
          e.preventDefault()
          if (!isDrawing.current) return
          const canvas = canvasRef.current
          const ctx = canvas.getContext('2d')
          const pos = getPos(e, canvas)
          ctx.strokeStyle = '#f1f1f1'
          ctx.lineWidth = 2
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.beginPath()
          ctx.moveTo(lastPos.current.x, lastPos.current.y)
          ctx.lineTo(pos.x, pos.y)
          ctx.stroke()
          lastPos.current = pos
        }

        function endDraw(e) {
          e.preventDefault()
          isDrawing.current = false
        }

        function clearCanvas() {
          const canvas = canvasRef.current
          if (!canvas) return
          canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
        }

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, overflowY: 'auto', padding: '20px' }}>
            <div style={{ maxWidth: '600px', margin: '0 auto', background: '#141414', border: '1px solid #222', borderRadius: '16px', overflow: 'hidden' }}>
              <div style={{ padding: '24px 28px', borderBottom: '1px solid #222' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: '800', color: '#f1f1f1' }}>Sign Lien Waiver</p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#555' }}>Conditional Waiver and Release on Progress Payment</p>
                  </div>
                  <button onClick={() => { setLienWaiverSub(null); setSignerName(''); setWaiverMsg('') }} style={{ background: 'none', border: 'none', color: '#555', fontSize: '22px', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>
              </div>

              <div style={{ padding: '20px 28px' }}>
                {/* Waiver details */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', border: '1px solid #222', borderRadius: '8px', overflow: 'hidden', marginBottom: '20px', fontSize: '13px' }}>
                  {[
                    ['Claimant', sub.company_name],
                    ['Hiring Party', 'NV Construction'],
                    ['Project', `#${sub.jobs?.job_number} — ${sub.jobs?.project_name}`],
                    ['Owner', owner],
                    ['Payment Amount', amt],
                    ['Through Date', period],
                  ].map(([label, val], i) => (
                    <div key={label} style={{ padding: '10px 14px', borderBottom: i < 4 ? '1px solid #1e1e1e' : 'none', borderRight: i % 2 === 0 ? '1px solid #1e1e1e' : 'none' }}>
                      <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '3px' }}>{label}</div>
                      <div style={{ color: label === 'Payment Amount' ? '#e8590c' : '#f1f1f1', fontWeight: label === 'Payment Amount' ? '800' : '600' }}>{val}</div>
                    </div>
                  ))}
                </div>

                <p style={{ fontSize: '11px', color: '#555', lineHeight: '1.7', marginBottom: '20px', padding: '12px 14px', background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px' }}>
                  By signing below, I conditionally waive and release any mechanic's lien, stop payment notice, or payment bond right for labor, services, equipment, or materials furnished through the above Through Date, conditioned upon receipt of the above payment amount in good funds.
                </p>

                {/* Signer name */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Your full name & title *</label>
                  <input
                    style={{ width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' }}
                    value={signerName}
                    onChange={e => setSignerName(e.target.value)}
                    placeholder="John Smith, Owner"
                  />
                </div>

                {/* Signature pad */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: '#666', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Draw your signature *</label>
                    <button type="button" onClick={clearCanvas} style={{ fontSize: '11px', color: '#888', background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>Clear</button>
                  </div>
                  <canvas
                    ref={canvasRef}
                    width={540}
                    height={120}
                    style={{ width: '100%', height: '120px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
                    onMouseDown={startDraw}
                    onMouseMove={draw}
                    onMouseUp={endDraw}
                    onMouseLeave={endDraw}
                    onTouchStart={startDraw}
                    onTouchMove={draw}
                    onTouchEnd={endDraw}
                  />
                  <p style={{ fontSize: '11px', color: '#444', marginTop: '5px' }}>Use your mouse or finger to draw your signature above</p>
                </div>

                {waiverMsg && <p style={{ fontSize: '13px', color: '#ff6b6b', marginBottom: '12px' }}>{waiverMsg}</p>}

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '4px' }}>
                  <button
                    type="button"
                    onClick={() => printLienWaiver(sub)}
                    style={{ padding: '10px 20px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#aaa', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' }}
                  >🖨 Print blank form</button>
                  <button
                    type="button"
                    disabled={savingWaiver || !signerName.trim()}
                    onClick={submitLienWaiver}
                    style={{ padding: '10px 24px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: savingWaiver || !signerName.trim() ? 'not-allowed' : 'pointer', opacity: savingWaiver || !signerName.trim() ? 0.5 : 1, letterSpacing: '1px', textTransform: 'uppercase' }}
                  >{savingWaiver ? 'Submitting...' : 'Submit signed waiver'}</button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
