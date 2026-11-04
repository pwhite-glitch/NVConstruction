'use client'
import { useState, useEffect, useRef, useReducer } from 'react'
import { supabase } from '../../../lib/supabase'
import { openStorageFile } from '../../../lib/open-file'
import {
  estimateSavePayload, shouldOfferDraft, initialSaveState, saveStateReducer, shouldAutoSave, STALE_MESSAGE,
} from '../../../lib/estimate-save'
import { JOB_LINK_ROLES } from '../../../lib/estimate-to-job'
import LinkToJobPanel from './LinkToJobPanel'

const STAGE_OPTS = [
  { key: 'lead',        label: 'Lead' },
  { key: 'estimating',  label: 'Estimating' },
  { key: 'bid_out',     label: 'Bid Out' },
  { key: 'negotiating', label: 'Negotiating' },
  // Won here only sets estimates.status — it never creates a job. Use
  // "Convert to Job" when a new job is needed.
  { key: 'won',         label: 'Won' },
]

const PROJECT_TYPES = ['Office TI','Retail TI','Restaurant','Medical','Industrial','Warehouse','Multifamily','Ground-up','Renovation','Other']

const STAGE_MAP = {
  lead:        { label: 'Lead',        color: '#374151', bg: '#f3f4f6', border: '#e5e7eb' },
  estimating:  { label: 'Estimating',  color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  bid_out:     { label: 'Bid Out',     color: '#c2410c', bg: '#fff7ed', border: '#fdba74' },
  sent:        { label: 'Bid Out',     color: '#c2410c', bg: '#fff7ed', border: '#fdba74' },
  negotiating: { label: 'Negotiating', color: '#854d0e', bg: '#fefce8', border: '#fef08a' },
  draft:       { label: 'Estimating',  color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  won:         { label: 'Won',         color: '#15803d', bg: '#dcfce7', border: '#bbf7d0' },
  lost:        { label: 'Lost',        color: '#dc2626', bg: '#fee2e2', border: '#fecaca' },
}

function fmt$(n, d = 2) {
  const v = parseFloat(n)
  if (isNaN(v)) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

const s = {
  page: { display: 'flex', flexDirection: 'column', minHeight: '100%' },

  header:   { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 10 },
  backBtn:  { background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 0', fontWeight: '500' },
  hdivider: { width: '1px', height: '20px', background: '#e5e7eb', flexShrink: 0 },
  htitle:   { fontSize: '15px', fontWeight: '700', color: '#111827', margin: 0 },
  hmeta:    { fontSize: '12px', color: '#6b7280', margin: '2px 0 0' },
  hright:   { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  sbadge:   (st) => {
    const c = STAGE_MAP[st] || { color: '#374151', bg: '#f3f4f6', border: '#e5e7eb' }
    return { padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', letterSpacing: '0.3px', textTransform: 'uppercase', background: c.bg, color: c.color, border: `1px solid ${c.border}` }
  },

  tabNav: { display: 'flex', borderBottom: '1px solid #e5e7eb', background: '#fff', padding: '0 1.5rem' },
  tab:    (a) => ({ padding: '10px 16px', borderBottom: a ? '2px solid #e8590c' : '2px solid transparent', color: a ? '#e8590c' : '#6b7280', fontSize: '13px', fontWeight: a ? '600' : '400', background: 'none', border: 'none', borderBottom: a ? '2px solid #e8590c' : '2px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap' }),

  body: { flex: 1, padding: '1.5rem' },
  box:  { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' },
  sec:  { fontSize: '11px', fontWeight: '700', color: '#6b7280', letterSpacing: '0.8px', textTransform: 'uppercase', margin: '0 0 0.875rem' },
  g2:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' },
  lbl:  { display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '4px' },
  inp:  { width: '100%', padding: '8px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none' },
  sel:  { width: '100%', padding: '8px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none' },
  ta:   { width: '100%', padding: '8px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none', minHeight: '80px', resize: 'vertical' },

  btn:    { padding: '8px 18px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnGr:  { padding: '8px 18px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  btnSm:  (c) => ({
    padding: '5px 12px', borderRadius: '5px', fontSize: '12px', fontWeight: '500', cursor: 'pointer',
    background: c === 'red' ? '#fef2f2' : c === 'green' ? '#f0fdf4' : '#f9fafb',
    color:      c === 'red' ? '#dc2626' : c === 'green' ? '#16a34a' : '#374151',
    border:     `1px solid ${c === 'red' ? '#fecaca' : c === 'green' ? '#bbf7d0' : '#e5e7eb'}`,
  }),

  sovHdr: { display: 'grid', gridTemplateColumns: '1fr 130px 90px 90px 36px', padding: '8px 12px', fontSize: '11px', fontWeight: '700', color: '#6b7280', letterSpacing: '1px', textTransform: 'uppercase', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' },
  sovRow: { borderBottom: '1px solid #f3f4f6' },

  totals: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem', position: 'sticky', top: '58px' },
  tRow:   (bold) => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: '13px', color: bold ? '#111827' : '#6b7280', fontWeight: bold ? '700' : '400' }),
  tDiv:   { borderBottom: '1px solid #e5e7eb', margin: '6px 0' },
  tGrand: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#111827', borderRadius: '6px', color: '#fff', marginTop: '10px' },

  docRow:  { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid #f3f4f6' },
  empty:   { textAlign: 'center', color: '#9ca3af', fontSize: '13px', padding: '2.5rem 0' },
}

export default function EstimateWorkspace({ estimate, profile, generatePDF, onBack, onUpdated, onDeleted }) {
  const [tab,         setTab]         = useState('pricing')
  const [form,        setForm]        = useState({ ...estimate })
  const [lines,       setLines]       = useState((estimate.estimate_line_items || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)))
  const [saving,      setSaving]      = useState(false)
  const [saveMsg,     setSaveMsg]     = useState('')
  const [docs,        setDocs]        = useState([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [showConvert, setShowConvert] = useState(false)
  const [cvtForm,     setCvtForm]     = useState({ job_number: '', start_date: '' })
  const [converting,  setConverting]  = useState(false)
  const [cvtErr,      setCvtErr]      = useState('')
  const [showLink,    setShowLink]    = useState(false)
  const [draftMsg,    setDraftMsg]    = useState('')
  const [hasDraft,    setHasDraft]    = useState(false)
  const [draftSnap,   setDraftSnap]   = useState(null)
  const [restoredMsg, setRestoredMsg] = useState(false)

  // dirty is set ONLY by markEdited() from user input handlers. Loads, refetches,
  // draft restores and saves never mark dirty, so a save can't re-trigger itself.
  const [saveState, dispatchSave] = useReducer(saveStateReducer, estimate.updated_at, initialSaveState)
  const saveStateRef = useRef(saveState)
  saveStateRef.current = saveState
  const { dirty, conflict } = saveState

  const DRAFT_KEY    = `estimate_draft_${estimate.id}`
  const autoSaveTimer = useRef(null)
  const savingRef     = useRef(false)
  const dbLineCount   = useRef((estimate.estimate_line_items || []).length)

  const canEdit = ['pm', 'apm'].includes(profile?.role)
  const isPM    = profile?.role === 'pm'
  const canLink = JOB_LINK_ROLES.has(profile?.role)

  function markEdited() {
    setRestoredMsg(false)
    dispatchSave({ type: 'edit' })
  }
  function editForm(patch) {
    setForm(f => ({ ...f, ...patch }))
    markEdited()
  }
  function editLines(updater) {
    setLines(updater)
    markEdited()
  }

  useEffect(() => { if (tab === 'docs') loadDocs() }, [tab])

  // Offer a local draft only if it was made on top of the version the DB has
  // now and contains real unsaved edits; otherwise drop it silently.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      let draft = null
      try { draft = JSON.parse(raw) } catch {}
      if (shouldOfferDraft(draft, estimate)) {
        setHasDraft(true)
        setDraftSnap(draft)
      } else {
        localStorage.removeItem(DRAFT_KEY)
      }
    } catch {}
  }, [])

  // Write draft to localStorage ~1.5s after the last real edit
  useEffect(() => {
    if (!dirty || conflict) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, lines, savedAt: Date.now(), base_updated_at: saveStateRef.current.base }))
        setDraftMsg('Draft saved locally')
        setTimeout(() => setDraftMsg(''), 2500)
      } catch {}
    }, 1500)
    return () => clearTimeout(t)
  }, [form, lines, dirty, conflict])

  async function loadDocs() {
    setLoadingDocs(true)
    const { data } = await supabase.from('estimate_docs').select('*').eq('estimate_id', estimate.id).order('uploaded_at', { ascending: false })
    setDocs(data || [])
    setLoadingDocs(false)
  }

  async function save(auto = false, statusOverride) {
    // Never overlap saves, and never write once we know we're stale.
    if (savingRef.current || saveStateRef.current.conflict) return
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
    savingRef.current = true
    if (!auto) setSaving(true)
    setSaveMsg('')
    try {
      const { fields, line_items: lineItems } = estimateSavePayload(form, lines, estimate.id, statusOverride)
      // Guard: if we have no lines now but the DB had some, confirm before wiping.
      // Auto-save never wipes; the user has to confirm with a manual save.
      const dbItemCount = dbLineCount.current
      if (lineItems.length === 0 && dbItemCount > 0) {
        if (auto) { setSaveMsg('Error — not auto-saved: all line items removed. Click Save to confirm.'); return }
        const ok = window.confirm(`This will remove all ${dbItemCount} line item(s) from the estimate. Continue?`)
        if (!ok) return
      }
      const seqAtStart = saveStateRef.current.editSeq
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({
          action: 'update',
          id: estimate.id,
          expected_updated_at: saveStateRef.current.base ?? null,
          fields,
          line_items: lineItems,
        }),
      })
      let result = null
      try { result = await res.json() } catch {}
      if (res.status === 409) {
        dispatchSave({ type: 'conflict' })
        return
      }
      if (!res.ok) throw new Error(result?.error || 'Save failed')

      // Saved. From here on the server's updated_at is our base.
      dispatchSave({ type: 'saved', updated_at: result?.updated_at ?? null, seqAtStart })
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
      setHasDraft(false)
      setRestoredMsg(false)
      dbLineCount.current = lineItems.length
      setSaveMsg(auto ? 'Auto-saved' : 'Saved')
      setTimeout(() => setSaveMsg(m => (m === 'Saved' || m === 'Auto-saved' ? '' : m)), 2500)

      // Refresh from the DB. This does NOT mark dirty. If the user typed while
      // the save was in flight, keep their newer edits on screen instead.
      const { data: fresh } = await supabase
        .from('estimates').select('*, estimate_line_items(*)').eq('id', estimate.id).single()
      if (fresh) {
        const updated = { ...fresh, estimate_line_items: (fresh.estimate_line_items || []).sort((a, b) => a.sort_order - b.sort_order) }
        if (saveStateRef.current.editSeq === seqAtStart) {
          setForm({ ...updated })
          setLines(updated.estimate_line_items)
        }
        onUpdated(updated)
      }
      if (statusOverride) setForm(f => ({ ...f, status: statusOverride }))
    } catch (err) {
      setSaveMsg('Error — ' + (auto ? 'auto-save failed: ' : '') + (err?.message || 'check connection'))
    } finally {
      savingRef.current = false
      if (!auto) setSaving(false)
    }
  }

  async function uploadDoc(file) {
    if (!file) return
    setUploading(true)
    const path = `${estimate.id}/${Date.now()}_${file.name}`
    await supabase.storage.from('estimate-docs').upload(path, file)
    await supabase.from('estimate_docs').insert({ estimate_id: estimate.id, file_name: file.name, storage_path: path })
    await loadDocs()
    setUploading(false)
  }

  function openDoc(path) {
    return openStorageFile(supabase, 'estimate-docs', path)
  }

  async function deleteDoc(doc) {
    if (!window.confirm(`Delete "${doc.file_name}"?`)) return
    await supabase.storage.from('estimate-docs').remove([doc.storage_path])
    await supabase.from('estimate_docs').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  // Mark Won without creating a job (e.g. revised estimate on an existing job).
  // Goes through the normal save path so pending edits are saved with it.
  async function markWon() {
    if (!window.confirm('Mark as Won without creating a job? It will move to Archive.')) return
    await save(false, 'won')
  }

  async function setStage(status) {
    if (status === 'won') return markWon()
    await supabase.from('estimates').update({ status }).eq('id', estimate.id)
    setForm(f => ({ ...f, status }))
    onUpdated({ ...estimate, ...form, status, estimate_line_items: lines })
  }

  async function postToJob(payload) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/estimates/to-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(payload),
    })
    let result = null
    try { result = await res.json() } catch {}
    return { res, result }
  }

  function goToJobBudget(jobId) {
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    onDeleted(estimate.id)
    window.location.href = `/jobdetail?id=${jobId}&tab=budget`
  }

  // Server-side, one transaction: job + budget lines + contract value + links.
  // Uses the saved estimate, so unsaved edits must be saved first.
  async function convertToJob() {
    if (!cvtForm.job_number.trim()) return
    if (dirty) { setCvtErr('Save your changes first. Convert uses the saved estimate.'); return }
    setConverting(true)
    setCvtErr('')
    try {
      const { res, result } = await postToJob({
        action: 'convert',
        id: estimate.id,
        expected_updated_at: saveStateRef.current.base ?? null,
        job_number: cvtForm.job_number.trim(),
        start_date: cvtForm.start_date || null,
      })
      if (!res.ok || !result?.job_id) {
        if (result?.code === 'stale') dispatchSave({ type: 'conflict' })
        setCvtErr(result?.error || `Convert failed (${res.status})`)
        setConverting(false)
        return
      }
      goToJobBudget(result.job_id)
    } catch (e) {
      setCvtErr(e?.message || 'Convert failed — check connection')
      setConverting(false)
    }
  }

  // Live totals
  const globalPct = Number(form.markup_pct || 0)
  const raw       = lines.reduce((a, l) => a + Number(l.amount || 0), 0)
  const billed    = lines.reduce((a, l) => {
    const pct  = l.markup_pct  != null && l.markup_pct  !== '' ? Number(l.markup_pct)  : globalPct
    const flat = l.markup_flat != null && l.markup_flat !== '' ? Number(l.markup_flat) : 0
    return a + Number(l.amount || 0) * (1 + pct / 100) + flat
  }, 0)
  const gFlat     = Number(form.markup_flat || 0)
  const taxAmt    = form.taxable ? raw * 0.0825 : 0
  const grandTotal = billed + gFlat + taxAmt
  const markupAmt  = billed - raw + gFlat
  const sqftRate   = form.square_footage > 0 ? grandTotal / Number(form.square_footage) : null

  const stageCfg = STAGE_MAP[form.status] || { label: form.status, color: '#374151', bg: '#f3f4f6', border: '#e5e7eb' }
  const isArchived = ['won','lost','accepted','declined'].includes(form.status)

  // Auto-save to DB 30s after the last real edit (resets on each keystroke).
  // Never runs from loads/refetches/saves (those don't mark dirty) or after a conflict.
  useEffect(() => {
    if (!shouldAutoSave(saveState, { canEdit, isArchived })) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => save(true), 30000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [saveState, form, lines, canEdit, isArchived])

  function updateLine(idx, key, val) {
    editLines(l => l.map((x, i) => i === idx ? { ...x, [key]: val } : x))
  }

  // Restoring a draft does not mark dirty or start auto-save; the user saves it
  // explicitly (or makes another edit, which then auto-saves as usual).
  function restoreDraft() {
    if (!draftSnap) return
    setForm(draftSnap.form)
    setLines(draftSnap.lines || [])
    setHasDraft(false)
    setRestoredMsg(true)
  }

  function dismissDraft() {
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    setHasDraft(false)
  }

  return (
    <div style={s.page}>

      {/* ── Stale / conflict banner ── */}
      {conflict && (
        <div role="alert" style={{ background: '#fef2f2', borderBottom: '1px solid #fca5a5', padding: '10px 1.5rem', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', color: '#991b1b' }}>
          <span style={{ flex: 1, fontWeight: '500' }}>{STALE_MESSAGE}</span>
          <button onClick={() => window.location.reload()} style={{ padding: '5px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Reload</button>
        </div>
      )}

      {/* ── Draft restored notice ── */}
      {restoredMsg && !conflict && (
        <div style={{ background: '#fffbeb', borderBottom: '1px solid #fcd34d', padding: '10px 1.5rem', fontSize: '13px', color: '#92400e' }}>
          Draft restored. It is not saved yet. Click Save to keep it.
        </div>
      )}

      {/* ── Draft restore banner ── */}
      {hasDraft && !conflict && (
        <div style={{ background: '#fffbeb', borderBottom: '1px solid #fcd34d', padding: '10px 1.5rem', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', color: '#92400e' }}>
          <span style={{ flex: 1 }}>A locally-saved draft from your last session was found. Restore it to pick up where you left off.</span>
          <button onClick={restoreDraft} style={{ padding: '5px 14px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Restore draft</button>
          <button onClick={dismissDraft} style={{ padding: '5px 12px', background: 'none', border: '1px solid #d97706', color: '#92400e', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' }}>Discard</button>
        </div>
      )}

      {/* ── Header ── */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={onBack}>← Estimates</button>
        <div style={s.hdivider} />
        <div>
          <p style={s.htitle}>{form.project_name || 'Untitled estimate'}</p>
          <p style={s.hmeta}>
            {estimate.estimate_number}
            {form.owner_name ? ' · ' + form.owner_name : ''}
            {form.address    ? ' · ' + form.address    : ''}
          </p>
        </div>
        <div style={s.hright}>
          <span style={s.sbadge(form.status)}>{stageCfg.label}</span>
          {saving   && <span style={{ fontSize: '12px', color: '#6b7280' }}>Saving…</span>}
          {saveMsg  && !saving && <span style={{ fontSize: '12px', color: saveMsg.startsWith('Error') ? '#dc2626' : '#16a34a', fontWeight: '500' }}>{saveMsg}</span>}
          {draftMsg && !saving && !saveMsg && <span style={{ fontSize: '12px', color: '#6b7280' }}>{draftMsg}</span>}
          {dirty    && !saving && !saveMsg && !draftMsg && <span style={{ fontSize: '12px', color: '#9ca3af' }}>Unsaved changes</span>}
          {canEdit && !isArchived && (
            <button style={{ ...s.btn, padding: '6px 14px', fontSize: '13px' }} onClick={() => save()} disabled={saving || conflict}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* ── Tab nav ── */}
      <div style={s.tabNav}>
        <button style={s.tab(tab === 'pricing')}  onClick={() => setTab('pricing')}>Scope &amp; Pricing</button>
        <button style={s.tab(tab === 'docs')}     onClick={() => setTab('docs')}>Documents</button>
        <button style={s.tab(tab === 'proposal')} onClick={() => setTab('proposal')}>Proposal &amp; Export</button>
      </div>

      {/* ── SCOPE & PRICING ── */}
      {tab === 'pricing' && (
        <div style={{ ...s.body, display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* Left: form */}
          <div style={{ flex: 1, minWidth: '340px' }}>

            {/* Project info */}
            <div style={s.box}>
              <p style={s.sec}>Project Info</p>
              <div style={s.g2} className="rx-grid-2">
                <div>
                  <label style={s.lbl}>Project name</label>
                  <input style={s.inp} value={form.project_name || ''} onChange={e => editForm({ project_name: e.target.value })} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Address</label>
                  <input style={s.inp} value={form.address || ''} onChange={e => editForm({ address: e.target.value })} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Owner / Contact</label>
                  <input style={s.inp} value={form.owner_name || ''} onChange={e => editForm({ owner_name: e.target.value })} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Company</label>
                  <input style={s.inp} value={form.owner_company || ''} onChange={e => editForm({ owner_company: e.target.value })} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Email</label>
                  <input type="email" style={s.inp} value={form.owner_email || ''} onChange={e => editForm({ owner_email: e.target.value })} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Phone</label>
                  <input style={s.inp} value={form.owner_phone || ''} onChange={e => editForm({ owner_phone: e.target.value })} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Project type</label>
                  <select style={s.sel} value={form.project_type || ''} onChange={e => editForm({ project_type: e.target.value })} disabled={!canEdit || isArchived}>
                    <option value="">— Select —</option>
                    {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={s.lbl}>Square footage</label>
                  <input type="number" min="0" style={s.inp} value={form.square_footage || ''} onChange={e => editForm({ square_footage: e.target.value })} disabled={!canEdit || isArchived} />
                </div>
              </div>
              <div>
                <label style={s.lbl}>Scope of work / notes</label>
                <textarea style={s.ta} value={form.notes || ''} onChange={e => editForm({ notes: e.target.value })} disabled={!canEdit || isArchived} />
              </div>
            </div>

            {/* Schedule of values */}
            <div style={s.box}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
                <p style={{ ...s.sec, margin: 0 }}>Schedule of Values</p>
                {canEdit && !isArchived && (
                  <button style={s.btnSm('green')} onClick={() => editLines(l => [...l, { description: '', amount: '', scope: '', markup_pct: '', markup_flat: '' }])}>
                    + Add line
                  </button>
                )}
              </div>

              <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={s.sovHdr}>
                  <div>Description</div>
                  <div style={{ textAlign: 'right' }}>Cost</div>
                  <div style={{ textAlign: 'right' }}>Markup %</div>
                  <div style={{ textAlign: 'right' }}>Markup $</div>
                  <div />
                </div>

                {lines.map((line, idx) => (
                  <div key={idx} style={s.sovRow}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px 90px 36px', alignItems: 'center' }}>
                      <input
                        style={{ ...s.inp, border: 'none', borderRadius: 0, borderRight: '1px solid #f3f4f6', background: 'transparent', padding: '9px 12px' }}
                        value={line.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)}
                        placeholder={`Line ${idx + 1}`}
                        disabled={!canEdit || isArchived}
                      />
                      <input
                        type="number" step="0.01"
                        style={{ ...s.inp, border: 'none', borderRadius: 0, textAlign: 'right', borderRight: '1px solid #f3f4f6', background: 'transparent', padding: '9px 10px' }}
                        value={line.amount ?? ''}
                        onChange={e => updateLine(idx, 'amount', e.target.value)}
                        placeholder="0.00"
                        disabled={!canEdit || isArchived}
                      />
                      <input
                        type="number" step="0.1" min="0"
                        style={{ ...s.inp, border: 'none', borderRadius: 0, textAlign: 'right', borderRight: '1px solid #f3f4f6', background: 'transparent', fontSize: '12px', padding: '9px 8px' }}
                        value={line.markup_pct ?? ''}
                        onChange={e => updateLine(idx, 'markup_pct', e.target.value)}
                        placeholder={`${globalPct || 0}%`}
                        disabled={!canEdit || isArchived}
                      />
                      <input
                        type="number" step="1" min="0"
                        style={{ ...s.inp, border: 'none', borderRadius: 0, textAlign: 'right', borderRight: '1px solid #f3f4f6', background: 'transparent', fontSize: '12px', padding: '9px 8px' }}
                        value={line.markup_flat ?? ''}
                        onChange={e => updateLine(idx, 'markup_flat', e.target.value)}
                        placeholder="$0"
                        disabled={!canEdit || isArchived}
                      />
                      {canEdit && !isArchived
                        ? <button style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '18px', padding: 0, width: '36px', textAlign: 'center' }} onClick={() => editLines(l => l.filter((_, i) => i !== idx))}>×</button>
                        : <div />
                      }
                    </div>
                    {(line.scope || (canEdit && !isArchived)) && (
                      <textarea
                        rows={1}
                        value={line.scope || ''}
                        onChange={e => { updateLine(idx, 'scope', e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                        placeholder="Scope notes (optional)"
                        disabled={!canEdit || isArchived}
                        style={{ display: 'block', width: '100%', padding: '5px 12px', background: '#fafafa', border: 'none', borderTop: '1px solid #f3f4f6', color: '#6b7280', fontSize: '12px', resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5, minHeight: '28px', overflow: 'hidden' }}
                      />
                    )}
                  </div>
                ))}
                {lines.length === 0 && <div style={{ padding: '1.5rem', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>No line items yet. Add a line to start pricing.</div>}
              </div>

              {/* Global markup controls */}
              {canEdit && !isArchived && (
                <div style={{ marginTop: '1rem', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label style={{ ...s.lbl, marginBottom: 0, whiteSpace: 'nowrap' }}>Global markup %</label>
                    <input type="number" step="0.1" min="0" style={{ ...s.inp, width: '75px' }} value={form.markup_pct ?? ''} onChange={e => editForm({ markup_pct: e.target.value })} placeholder="0" />
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>default for lines without a per-line %</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label style={{ ...s.lbl, marginBottom: 0, whiteSpace: 'nowrap' }}>Global markup $</label>
                    <input type="number" step="1" min="0" style={{ ...s.inp, width: '95px' }} value={form.markup_flat ?? ''} onChange={e => editForm({ markup_flat: e.target.value })} placeholder="0" />
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>added to total</span>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '12px', color: '#374151' }}>
                    <input type="checkbox" checked={!!form.taxable} onChange={e => editForm({ taxable: e.target.checked })} />
                    Sales tax (8.25%)
                  </label>
                </div>
              )}
            </div>

            {/* Stage + save (bottom of form) */}
            {canEdit && !isArchived && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ ...s.lbl, marginBottom: 0 }}>Stage</label>
                  <select style={{ ...s.sel, width: 'auto' }} value={form.status || 'lead'} onChange={e => { const v = e.target.value; if (v === 'won') markWon(); else editForm({ status: v }) }}>
                    {STAGE_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </div>
                <button style={s.btn} onClick={() => save()} disabled={saving || conflict}>{saving ? 'Saving…' : 'Save changes'}</button>
              </div>
            )}
          </div>

          {/* Right: totals panel */}
          <div style={{ width: '220px', flexShrink: 0 }}>
            <div style={s.totals}>
              <p style={s.sec}>Proposal Total</p>
              <div style={s.tRow(false)}>
                <span>Cost subtotal</span>
                <span>{fmt$(raw)}</span>
              </div>
              {markupAmt !== 0 && (
                <div style={s.tRow(false)}>
                  <span>Markup</span>
                  <span style={{ color: '#e8590c' }}>{fmt$(markupAmt)}</span>
                </div>
              )}
              {taxAmt > 0 && (
                <div style={s.tRow(false)}>
                  <span>Sales tax (8.25%)</span>
                  <span>{fmt$(taxAmt)}</span>
                </div>
              )}
              <div style={s.tDiv} />
              <div style={s.tGrand}>
                <span style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase', color: '#e8590c' }}>Total</span>
                <span style={{ fontSize: '17px', fontWeight: '700' }}>{fmt$(grandTotal)}</span>
              </div>
              {sqftRate != null && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af', textAlign: 'right' }}>
                  {fmt$(sqftRate)} / sq ft
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── DOCUMENTS ── */}
      {tab === 'docs' && (
        <div style={{ ...s.body, maxWidth: '700px' }}>
          <div style={s.box}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
              <p style={{ ...s.sec, margin: 0 }}>Attached Documents</p>
              {canEdit && (
                <label style={{ ...s.btnSm(), cursor: 'pointer' }}>
                  <input type="file" style={{ display: 'none' }} onChange={e => e.target.files[0] && uploadDoc(e.target.files[0])} />
                  {uploading ? 'Uploading…' : '+ Upload'}
                </label>
              )}
            </div>
            {loadingDocs && <p style={s.empty}>Loading…</p>}
            {!loadingDocs && docs.length === 0 && <p style={s.empty}>No documents attached yet.</p>}
            {docs.map(doc => (
              <div key={doc.id} style={s.docRow}>
                <svg width="14" height="14" fill="none" stroke="#9ca3af" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span style={{ flex: 1, fontSize: '13px', color: '#374151' }}>{doc.file_name}</span>
                <button style={s.btnSm()} onClick={() => openDoc(doc.storage_path)}>Open ↗</button>
                {canEdit && <button style={s.btnSm('red')} onClick={() => deleteDoc(doc)}>Delete</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PROPOSAL & EXPORT ── */}
      {tab === 'proposal' && (
        <div style={{ ...s.body, maxWidth: '700px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          <div style={s.box}>
            <p style={s.sec}>Export Proposal</p>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 1rem' }}>
              Generates a formatted Cost Proposal PDF for {form.owner_name || form.owner_company || 'the client'}, including the schedule of values, markup, and signature block.
            </p>
            <button style={s.btn} onClick={() => generatePDF({ ...estimate, ...form, estimate_line_items: lines })}>
              Export PDF
            </button>
          </div>

          {form.job_id && (
            <div style={s.box}>
              <p style={s.sec}>Job</p>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 0.875rem' }}>
                This estimate is linked to a job. Later edits here do not change the job&apos;s budget.
              </p>
              <a href={`/jobdetail?id=${form.job_id}&tab=budget`} style={{ ...s.btnSm(), textDecoration: 'none' }}>Open job budget →</a>
            </div>
          )}

          {/* Also offered on a Won estimate that has no job yet (e.g. a revised
              estimate for an existing job), so it can still be linked. */}
          {canLink && !form.job_id && (!isArchived || form.status === 'won') && (
            <div style={s.box}>
              <p style={s.sec}>Convert to Job</p>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 0.875rem' }}>
                Creates a commercial job from this estimate (or links it to an existing job), copies line items into the job budget
                (cost as budget, price with markup as owner amount), sets the contract value, and marks the estimate as Won.
                Later edits to this estimate won&apos;t flow to the job.
              </p>
              {showLink ? (
                <LinkToJobPanel
                  estimateId={estimate.id}
                  getBase={() => saveStateRef.current.base}
                  dirty={dirty}
                  postToJob={postToJob}
                  onConflict={() => dispatchSave({ type: 'conflict' })}
                  onLinked={goToJobBudget}
                  onCancel={() => setShowLink(false)}
                />
              ) : !showConvert
                ? (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button style={s.btnSm('green')} onClick={() => { setCvtErr(''); setShowConvert(true) }}>Convert to job →</button>
                    <button style={s.btnSm()} onClick={() => setShowLink(true)}>Link to existing job →</button>
                  </div>
                )
                : (
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <label style={s.lbl}>Job number</label>
                      <input style={{ ...s.inp, width: '130px' }} value={cvtForm.job_number} onChange={e => setCvtForm(f => ({ ...f, job_number: e.target.value }))} placeholder="2026-042" />
                    </div>
                    <div>
                      <label style={s.lbl}>Start date</label>
                      <input type="date" style={{ ...s.inp, width: '155px' }} value={cvtForm.start_date} onChange={e => setCvtForm(f => ({ ...f, start_date: e.target.value }))} />
                    </div>
                    <button style={{ ...s.btn, opacity: converting || dirty || !cvtForm.job_number.trim() ? 0.6 : 1 }} disabled={converting || dirty || conflict || !cvtForm.job_number.trim()} onClick={convertToJob}>
                      {converting ? 'Creating…' : 'Create job'}
                    </button>
                    <button style={s.btnGr} onClick={() => setShowConvert(false)} disabled={converting}>Cancel</button>
                    {dirty && <p style={{ flexBasis: '100%', fontSize: '12px', color: '#92400e', margin: 0 }}>Save your changes first. Convert uses the saved estimate.</p>}
                    {cvtErr && <p role="alert" style={{ flexBasis: '100%', fontSize: '12px', color: '#dc2626', margin: 0 }}>{cvtErr}</p>}
                  </div>
                )
              }
            </div>
          )}

          {canEdit && !isArchived && (
            <div style={s.box}>
              <p style={s.sec}>Stage</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[...STAGE_OPTS, { key: 'lost', label: 'Lost' }].map(o => (
                  <button
                    key={o.key}
                    style={{ ...s.btnSm(o.key === 'lost' ? 'red' : o.key === form.status ? 'green' : ''), fontWeight: o.key === form.status ? '700' : '400' }}
                    onClick={() => setStage(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isPM && (
            <div style={s.box}>
              <p style={{ ...s.sec, color: '#dc2626' }}>Delete Estimate</p>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 0.875rem' }}>
                Permanently removes this estimate and all line items. This cannot be undone.
              </p>
              <button style={s.btnSm('red')} onClick={async () => {
                if (!window.confirm(`Delete ${estimate.estimate_number}? This cannot be undone.`)) return
                await supabase.from('estimates').delete().eq('id', estimate.id)
                onDeleted(estimate.id)
              }}>
                Delete estimate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
