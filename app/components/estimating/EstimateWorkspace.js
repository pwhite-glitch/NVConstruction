'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'

const STAGE_OPTS = [
  { key: 'lead',        label: 'Lead' },
  { key: 'estimating',  label: 'Estimating' },
  { key: 'bid_out',     label: 'Bid Out' },
  { key: 'negotiating', label: 'Negotiating' },
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
  const [dirty,       setDirty]       = useState(false)
  const [draftMsg,    setDraftMsg]    = useState('')
  const [hasDraft,    setHasDraft]    = useState(false)
  const [draftSnap,   setDraftSnap]   = useState(null)

  const DRAFT_KEY    = `estimate_draft_${estimate.id}`
  const isFirstRender = useRef(true)
  const autoSaveTimer = useRef(null)

  const canEdit = ['pm', 'apm'].includes(profile?.role)
  const isPM    = profile?.role === 'pm'

  useEffect(() => { if (tab === 'docs') loadDocs() }, [tab])

  // Check for a locally-saved draft newer than the DB on first load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw)
      const dbTime = new Date(estimate.updated_at || 0).getTime()
      if (draft.savedAt > dbTime + 5000) {
        setHasDraft(true)
        setDraftSnap(draft)
      } else {
        localStorage.removeItem(DRAFT_KEY)
      }
    } catch {}
  }, [])

  // Mark dirty on any form/lines change after initial mount
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setDirty(true)
  }, [form, lines])

  // Write draft to localStorage ~2s after last change
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, lines, savedAt: Date.now() }))
        setDraftMsg('Draft saved locally')
        setTimeout(() => setDraftMsg(''), 2500)
      } catch {}
    }, 1500)
    return () => clearTimeout(t)
  }, [form, lines, dirty])

  // Auto-save to DB 30s after last change (resets on each keystroke)
  useEffect(() => {
    if (!dirty || !canEdit || isArchived) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => save(true), 30000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [dirty, form, lines])

  async function loadDocs() {
    setLoadingDocs(true)
    const { data } = await supabase.from('estimate_docs').select('*').eq('estimate_id', estimate.id).order('uploaded_at', { ascending: false })
    setDocs(data || [])
    setLoadingDocs(false)
  }

  async function save(auto = false) {
    if (!auto) setSaving(true)
    if (!auto) setSaveMsg('')
    try {
      const fields = {
        project_name:   form.project_name,
        address:        form.address        || null,
        owner_name:     form.owner_name     || null,
        owner_company:  form.owner_company  || null,
        owner_email:    form.owner_email    || null,
        owner_phone:    form.owner_phone    || null,
        notes:          form.notes          || null,
        markup_pct:     form.markup_pct  !== '' && form.markup_pct  != null ? Number(form.markup_pct)  : 0,
        markup_flat:    form.markup_flat !== '' && form.markup_flat != null ? Number(form.markup_flat) : 0,
        taxable:        !!form.taxable,
        square_footage: form.square_footage !== '' && form.square_footage != null ? Number(form.square_footage) : null,
        project_type:   form.project_type || null,
        status:         form.status,
        updated_at:     new Date().toISOString(),
      }
      const validLines = lines.filter(l => l.description)
      const lineItems = validLines.map((l, i) => ({
        estimate_id: estimate.id,
        description: l.description || '',
        amount:      l.amount !== '' ? Number(l.amount) : 0,
        scope:       l.scope || null,
        sort_order:  i,
        markup_pct:  l.markup_pct  !== '' && l.markup_pct  != null ? Number(l.markup_pct)  : null,
        markup_flat: l.markup_flat !== '' && l.markup_flat != null ? Number(l.markup_flat) : null,
      }))
      // Guard: if we have no lines now but the DB had some, confirm before wiping
      const dbItemCount = (estimate.estimate_line_items || []).length
      if (lineItems.length === 0 && dbItemCount > 0) {
        const ok = window.confirm(`This will remove all ${dbItemCount} line item(s) from the estimate. Continue?`)
        if (!ok) { setSaving(false); return }
      }
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ action: 'update', id: estimate.id, fields, line_items: lineItems }),
      })
      if (!res.ok) {
        let msg = 'Save failed'
        try { const j = await res.json(); if (j?.error) msg = j.error } catch {}
        throw new Error(msg)
      }
      const { data: fresh } = await supabase
        .from('estimates').select('*, estimate_line_items(*)').eq('id', estimate.id).single()
      if (fresh) {
        const updated = { ...fresh, estimate_line_items: (fresh.estimate_line_items || []).sort((a, b) => a.sort_order - b.sort_order) }
        setForm({ ...updated })
        setLines(updated.estimate_line_items)
        onUpdated(updated)
        try { localStorage.removeItem(DRAFT_KEY) } catch {}
        setDirty(false)
        setHasDraft(false)
        setSaveMsg(auto ? 'Auto-saved' : 'Saved')
        setTimeout(() => setSaveMsg(''), 2500)
      }
    } catch (err) {
      if (!auto) setSaveMsg('Error — ' + (err?.message || 'check connection'))
    }
    if (!auto) setSaving(false)
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

  async function openDoc(path) {
    const { data } = await supabase.storage.from('estimate-docs').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteDoc(doc) {
    if (!window.confirm(`Delete "${doc.file_name}"?`)) return
    await supabase.storage.from('estimate-docs').remove([doc.storage_path])
    await supabase.from('estimate_docs').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  async function setStage(status) {
    await supabase.from('estimates').update({ status }).eq('id', estimate.id)
    setForm(f => ({ ...f, status }))
    onUpdated({ ...estimate, ...form, status, estimate_line_items: lines })
  }

  async function convertToJob() {
    if (!cvtForm.job_number.trim()) return
    setConverting(true)
    try {
      const { data: job, error } = await supabase.from('jobs').insert({
        job_number:   cvtForm.job_number.trim(),
        project_name: form.project_name,
        owner_name:   form.owner_name   || null,
        start_date:   cvtForm.start_date || null,
        status:       'active',
        billing_type: 'aia',
        nv_role:      'gc',
        job_type:     'commercial',
      }).select().single()
      if (error) throw error
      const budgetItems = lines
        .filter(l => l.description)
        .map((l, i) => ({ job_id: job.id, description: l.description, amount: Number(l.amount || 0), category: 'estimate', sort_order: i }))
      if (budgetItems.length) await supabase.from('budget_items').insert(budgetItems)
      await supabase.from('estimates').update({ status: 'won' }).eq('id', estimate.id)
      onDeleted(estimate.id)
      window.location.href = `/jobdetail?id=${job.id}&tab=budget`
    } catch (e) {
      console.error(e)
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

  function updateLine(idx, key, val) {
    setLines(l => l.map((x, i) => i === idx ? { ...x, [key]: val } : x))
  }

  function restoreDraft() {
    if (!draftSnap) return
    setForm(draftSnap.form)
    setLines(draftSnap.lines || [])
    setHasDraft(false)
    setDirty(true)
  }

  function dismissDraft() {
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    setHasDraft(false)
  }

  return (
    <div style={s.page}>

      {/* ── Draft restore banner ── */}
      {hasDraft && (
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
            <button style={{ ...s.btn, padding: '6px 14px', fontSize: '13px' }} onClick={() => save()} disabled={saving}>
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
                  <input style={s.inp} value={form.project_name || ''} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Address</label>
                  <input style={s.inp} value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Owner / Contact</label>
                  <input style={s.inp} value={form.owner_name || ''} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Company</label>
                  <input style={s.inp} value={form.owner_company || ''} onChange={e => setForm(f => ({ ...f, owner_company: e.target.value }))} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Email</label>
                  <input type="email" style={s.inp} value={form.owner_email || ''} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Phone</label>
                  <input style={s.inp} value={form.owner_phone || ''} onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))} disabled={!canEdit || isArchived} />
                </div>
                <div>
                  <label style={s.lbl}>Project type</label>
                  <select style={s.sel} value={form.project_type || ''} onChange={e => setForm(f => ({ ...f, project_type: e.target.value }))} disabled={!canEdit || isArchived}>
                    <option value="">— Select —</option>
                    {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={s.lbl}>Square footage</label>
                  <input type="number" min="0" style={s.inp} value={form.square_footage || ''} onChange={e => setForm(f => ({ ...f, square_footage: e.target.value }))} disabled={!canEdit || isArchived} />
                </div>
              </div>
              <div>
                <label style={s.lbl}>Scope of work / notes</label>
                <textarea style={s.ta} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} disabled={!canEdit || isArchived} />
              </div>
            </div>

            {/* Schedule of values */}
            <div style={s.box}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
                <p style={{ ...s.sec, margin: 0 }}>Schedule of Values</p>
                {canEdit && !isArchived && (
                  <button style={s.btnSm('green')} onClick={() => setLines(l => [...l, { description: '', amount: '', scope: '', markup_pct: '', markup_flat: '' }])}>
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
                        ? <button style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '18px', padding: 0, width: '36px', textAlign: 'center' }} onClick={() => setLines(l => l.filter((_, i) => i !== idx))}>×</button>
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
                    <input type="number" step="0.1" min="0" style={{ ...s.inp, width: '75px' }} value={form.markup_pct ?? ''} onChange={e => setForm(f => ({ ...f, markup_pct: e.target.value }))} placeholder="0" />
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>default for lines without a per-line %</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label style={{ ...s.lbl, marginBottom: 0, whiteSpace: 'nowrap' }}>Global markup $</label>
                    <input type="number" step="1" min="0" style={{ ...s.inp, width: '95px' }} value={form.markup_flat ?? ''} onChange={e => setForm(f => ({ ...f, markup_flat: e.target.value }))} placeholder="0" />
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>added to total</span>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '12px', color: '#374151' }}>
                    <input type="checkbox" checked={!!form.taxable} onChange={e => setForm(f => ({ ...f, taxable: e.target.checked }))} />
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
                  <select style={{ ...s.sel, width: 'auto' }} value={form.status || 'lead'} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {STAGE_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </div>
                <button style={s.btn} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
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

          {canEdit && !isArchived && (
            <div style={s.box}>
              <p style={s.sec}>Convert to Job</p>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 0.875rem' }}>
                Creates a commercial job from this estimate, copies line items as budget items, and marks the estimate as Won.
              </p>
              {!showConvert
                ? <button style={s.btnSm('green')} onClick={() => setShowConvert(true)}>Convert to job →</button>
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
                    <button style={{ ...s.btn, opacity: converting || !cvtForm.job_number.trim() ? 0.6 : 1 }} disabled={converting || !cvtForm.job_number.trim()} onClick={convertToJob}>
                      {converting ? 'Creating…' : 'Create job'}
                    </button>
                    <button style={s.btnGr} onClick={() => setShowConvert(false)}>Cancel</button>
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
