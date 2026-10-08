'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

// ── Section definitions ───────────────────────────────────────────────────────

const SECTIONS = [
  { key: 'overview',     label: 'Overview' },
  { key: 'documents',   label: 'Documents' },
  { key: 'scopes',      label: 'Trade Scopes' },
  { key: 'rfis',        label: 'RFIs' },
  { key: 'invitations', label: 'Invitations & Quotes' },
  { key: 'leveling',    label: 'Bid Leveling' },
  { key: 'proposal',    label: 'Proposal & Handoff' },
]

const BID_STATUS_LABELS = {
  open: 'Open', awarded: 'Awarded', won: 'Won', lost: 'Lost', closed: 'Closed',
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const s = {
  page:      { minHeight: '100vh', background: '#f4f6f8', fontFamily: "'Inter', system-ui, sans-serif", color: '#111827' },
  header:    { position: 'sticky', top: 0, zIndex: 100, background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem', height: '56px', display: 'flex', alignItems: 'center', gap: '12px' },
  back:      { display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#f9fafb', color: '#374151', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, textDecoration: 'none' },
  main:      { maxWidth: '1320px', margin: '0 auto', padding: '2rem 1.5rem' },
  metaRow:   { display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid #e5e7eb' },
  metaItem:  { display: 'flex', flexDirection: 'column', gap: '1px' },
  mLabel:    { fontSize: '10px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' },
  mValue:    { fontSize: '13px', fontWeight: '500', color: '#111827' },
  layout:    { display: 'flex', gap: '24px', alignItems: 'flex-start' },
  aside:     { width: '192px', flexShrink: 0, position: 'sticky', top: '72px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '8px' },
  content:   { flex: 1, minWidth: 0 },
  card:      { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1rem' },
  cardH:     { fontSize: '15px', fontWeight: '700', color: '#111827', margin: '0 0 1rem' },
  sectionLabel: { fontSize: '11px', fontWeight: '600', color: '#6b7280', letterSpacing: '0.5px', textTransform: 'uppercase', display: 'block', marginBottom: '4px' },
  input:     { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '14px', color: '#111827', background: '#fff', outline: 'none', boxSizing: 'border-box' },
  textarea:  { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '14px', color: '#111827', background: '#fff', outline: 'none', boxSizing: 'border-box', resize: 'vertical', minHeight: '80px' },
  btnPri:    { padding: '8px 16px', borderRadius: '6px', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', background: '#e8590c', color: '#fff' },
  btnSec:    { padding: '7px 14px', borderRadius: '6px', border: '1px solid #e5e7eb', fontSize: '13px', fontWeight: '600', cursor: 'pointer', background: '#f9fafb', color: '#374151' },
  btnDanger: { padding: '7px 14px', borderRadius: '6px', border: '1px solid #fecaca', fontSize: '13px', fontWeight: '600', cursor: 'pointer', background: '#fff5f5', color: '#dc2626' },
  empty:     { textAlign: 'center', color: '#9ca3af', fontSize: '13px', padding: '3rem 0' },
  badge:     (st) => {
    const m = { open: ['#eff6ff','#1d4ed8','#bfdbfe'], awarded: ['#dcfce7','#16a34a','#bbf7d0'], won: ['#dcfce7','#16a34a','#bbf7d0'], lost: ['#fee2e2','#dc2626','#fecaca'], closed: ['#f3f4f6','#6b7280','#e5e7eb'], draft: ['#f3f4f6','#374151','#e5e7eb'], open_rfi: ['#fefce8','#a16207','#fef08a'], answered: ['#f0fdf4','#16a34a','#bbf7d0'] }
    const [bg, color, border] = m[st] || m.closed
    return { padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', letterSpacing: '0.3px', textTransform: 'uppercase', background: bg, color, border: `1px solid ${border}`, display: 'inline-block' }
  },
  sideBtn:   (active) => ({
    display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px',
    borderRadius: '6px', border: 'none', fontSize: '13px', cursor: 'pointer', marginBottom: '2px',
    fontWeight: active ? '600' : '400',
    color: active ? '#c2410c' : '#374151',
    background: active ? 'rgba(232,89,12,0.08)' : 'transparent',
    borderLeft: active ? '3px solid #e8590c' : '3px solid transparent',
  }),
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtMoney(n) { return '$' + Math.round(n || 0).toLocaleString() }

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewSection({ pkg, scopeItems, plans, invitations, submissions }) {
  const due = pkg?.due_date
    ? Math.ceil((new Date(pkg.due_date + 'T23:59:59') - new Date()) / 86400000)
    : null

  const scopeReviewed  = scopeItems.filter(i => i.scope_review?.status === 'accepted').length
  const scopeQuestions = scopeItems.filter(i => i.scope_review?.status === 'question').length
  const submitCount    = submissions.length

  const tasks = []
  if (!pkg?.due_date)                                tasks.push('Set a bid deadline.')
  if (plans.length === 0)                            tasks.push('Upload current drawings and specifications before sending ITBs.')
  if (scopeItems.length === 0)                       tasks.push('Add scope items by trade.')
  if (scopeReviewed < scopeItems.length && scopeItems.length > 0)
    tasks.push(`${scopeItems.length - scopeReviewed} scope item${scopeItems.length - scopeReviewed !== 1 ? 's' : ''} pending review.`)
  if (scopeQuestions > 0)
    tasks.push(`${scopeQuestions} open scope question${scopeQuestions !== 1 ? 's' : ''} — resolve before sending ITBs.`)
  if (invitations.length === 0 && scopeItems.length > 0)
    tasks.push('No invitations sent yet — go to Invitations & Quotes when scope is ready.')
  if (submitCount === 0 && invitations.length > 0)
    tasks.push('Awaiting quotes from invited subcontractors.')

  const trades = [...new Set(scopeItems.map(i => i.trade).filter(Boolean))]
  const submissionsByTrade = {}
  submissions.forEach(s => {
    const t = s.trade || 'General'
    if (!submissionsByTrade[t]) submissionsByTrade[t] = []
    submissionsByTrade[t].push(s)
  })

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(156px, 1fr))', gap: '12px', marginBottom: '1rem' }}>
        {[
          { label: 'Bid Deadline', value: pkg?.due_date ? fmtDate(pkg.due_date) : 'Not set', sub: due !== null ? (due < 0 ? `${Math.abs(due)}d overdue` : due === 0 ? 'Today' : `${due} days`) : '', alert: due !== null && due < 3 },
          { label: 'Scope Items',  value: `${scopeReviewed}/${scopeItems.length}`, sub: 'reviewed' },
          { label: 'Documents',   value: plans.length,   sub: 'uploaded' },
          { label: 'Quotes',      value: submitCount,    sub: `from ${invitations.length} invited` },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', border: `1px solid ${c.alert ? '#fdba74' : '#e5e7eb'}`, borderRadius: '8px', padding: '1rem' }}>
            <p style={{ margin: '0 0 4px', ...s.mLabel }}>{c.label}</p>
            <p style={{ margin: '0 0 2px', fontSize: '22px', fontWeight: '700', color: c.alert ? '#c2410c' : '#111827' }}>{c.value}</p>
            {c.sub && <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>{c.sub}</p>}
          </div>
        ))}
      </div>

      {tasks.length > 0 && (
        <div style={{ ...s.card, borderColor: '#fdba74', background: '#fffbf5' }}>
          <h3 style={{ ...s.cardH, color: '#c2410c', marginBottom: '0.5rem', fontSize: '13px' }}>Outstanding</h3>
          <ul style={{ margin: 0, padding: '0 0 0 1.25rem', fontSize: '13px', color: '#374151', lineHeight: '1.8' }}>
            {tasks.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}

      {trades.length > 0 && (
        <div style={s.card}>
          <h3 style={s.cardH}>Quote Coverage by Trade</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>{['Trade','Scope Items','Quotes','Low Bid'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontWeight: '600', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', padding: '0 12px 8px 0' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {trades.map(trade => {
                const ti = scopeItems.filter(i => i.trade === trade)
                const ts = submissionsByTrade[trade] || []
                const low = ts.length > 0 ? Math.min(...ts.map(s => Number(s.amount || 0))) : null
                return (
                  <tr key={trade} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '7px 12px 7px 0', fontWeight: '500' }}>{trade}</td>
                    <td style={{ padding: '7px 12px 7px 0', color: '#6b7280' }}>{ti.length}</td>
                    <td style={{ padding: '7px 12px 7px 0' }}>
                      <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', background: ts.length > 0 ? '#dcfce7' : '#f3f4f6', color: ts.length > 0 ? '#16a34a' : '#9ca3af' }}>
                        {ts.length > 0 ? `${ts.length} received` : 'None'}
                      </span>
                    </td>
                    <td style={{ padding: '7px 0', fontWeight: '600', color: '#111827' }}>{low !== null ? fmtMoney(low) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tasks.length === 0 && (
        <div style={s.card}>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '13px' }}>This package is on track. Continue filling out scope, documents, and invitations.</p>
        </div>
      )}
    </>
  )
}

// ── Documents ─────────────────────────────────────────────────────────────────

function DocumentsSection({ bidId, plans, reload, canEdit }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef()

  async function upload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setErr('')
    try {
      const path = `${bidId}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('bid-plans').upload(path, file)
      if (upErr) throw upErr
      const { error: dbErr } = await supabase.from('bid_plans').insert({ bid_package_id: bidId, file_name: file.name, storage_path: path })
      if (dbErr) throw dbErr
      await reload()
    } catch (e) { setErr(e.message || 'Upload failed') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function openPlan(path) {
    const { data } = await supabase.storage.from('bid-plans').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deletePlan(plan) {
    if (!confirm(`Remove "${plan.file_name}"?`)) return
    await supabase.storage.from('bid-plans').remove([plan.storage_path])
    await supabase.from('bid_plans').delete().eq('id', plan.id)
    await reload()
  }

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ ...s.cardH, margin: 0 }}>Drawings, Specifications & Addenda</h3>
        {canEdit && (
          <label style={{ ...s.btnSec, display: 'inline-block', cursor: uploading ? 'wait' : 'pointer' }}>
            {uploading ? 'Uploading…' : '+ Upload'}
            <input ref={fileRef} type="file" accept=".pdf,.dwg,.dxf,.xlsx,.docx,.jpg,.png" style={{ display: 'none' }} onChange={upload} disabled={uploading} />
          </label>
        )}
      </div>
      {err && <p style={{ color: '#dc2626', fontSize: '13px', marginBottom: '0.5rem' }}>{err}</p>}

      {plans.length === 0 ? (
        <div style={s.empty}>No documents uploaded. Upload drawings and specs before sending ITBs.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr>{['File Name','Uploaded','Actions'].map(h => (
              <th key={h} style={{ textAlign: 'left', fontWeight: '600', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', padding: '0 12px 8px 0' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px 8px 0', fontWeight: '500', color: '#111827' }}>{p.file_name}</td>
                <td style={{ padding: '8px 12px 8px 0', color: '#6b7280' }}>{p.uploaded_at ? new Date(p.uploaded_at).toLocaleDateString() : '—'}</td>
                <td style={{ padding: '8px 0', display: 'flex', gap: '8px' }}>
                  <button style={{ ...s.btnSec, padding: '4px 10px', fontSize: '12px' }} onClick={() => openPlan(p.storage_path)}>Open</button>
                  {canEdit && <button style={{ ...s.btnDanger, padding: '4px 10px', fontSize: '12px' }} onClick={() => deletePlan(p)}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Trade Scopes ──────────────────────────────────────────────────────────────

function ScopesSection({ bidId, scopeItems, plans, reload, canEdit }) {
  const [selectedId, setSelectedId] = useState(null)
  const [addTrade, setAddTrade] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [adding, setAdding] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [filter, setFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const FILTER_OPTS = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Needs Review' },
    { key: 'question', label: 'Questions' },
    { key: 'accepted', label: 'Reviewed' },
  ]

  const COMMON_TRADES = ['Concrete','Framing','Roofing','Plumbing','Electrical','Mechanical','Drywall','Painting','Flooring','Glazing','Casework','Specialties']

  const visible = scopeItems.filter(i => {
    if (filter === 'all') return true
    return (i.scope_review?.status || 'draft') === filter
  })

  const selected = visible.find(i => i.id === selectedId) || visible[0]

  async function addItem() {
    if (!addTrade.trim()) return
    setAdding(true)
    const { error } = await supabase.from('bid_scope_items').insert({
      bid_package_id: bidId, trade: addTrade.trim(), description: addDesc.trim(),
      sort_order: scopeItems.length,
    })
    if (!error) { await reload(); setAddTrade(''); setAddDesc(''); setShowAdd(false) }
    setAdding(false)
  }

  async function saveItem(id, { description, scope_review }) {
    setSaving(true); setSaveMsg('')
    const { error } = await supabase.from('bid_scope_items').update({ description, scope_review }).eq('id', id)
    if (error) throw error
    await reload()
    setSaveMsg('Saved.')
    setSaving(false)
    setTimeout(() => setSaveMsg(''), 2000)
  }

  async function deleteItem(id) {
    await supabase.from('bid_scope_items').delete().eq('id', id)
    setSelectedId(null)
    await reload()
  }

  async function openPlan(path) {
    const { data } = await supabase.storage.from('bid-plans').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
      {/* Left: item list */}
      <div style={{ width: '220px', flexShrink: 0 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {FILTER_OPTS.map(o => (
              <button key={o.key} onClick={() => setFilter(o.key)} style={{ padding: '3px 8px', borderRadius: '4px', border: 'none', fontSize: '11px', fontWeight: filter === o.key ? '700' : '400', background: filter === o.key ? '#fef3ee' : 'transparent', color: filter === o.key ? '#c2410c' : '#6b7280', cursor: 'pointer' }}>
                {o.label}
              </button>
            ))}
          </div>
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            {visible.length === 0 && <p style={{ padding: '12px', fontSize: '12px', color: '#9ca3af', margin: 0 }}>No items match.</p>}
            {visible.map(item => {
              const st = item.scope_review?.status || 'draft'
              const dot = { accepted: '#16a34a', question: '#a16207', draft: '#9ca3af' }[st] || '#9ca3af'
              return (
                <button key={item.id} onClick={() => setSelectedId(item.id)} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid #f3f4f6', background: selected?.id === item.id ? '#fef3ee' : 'transparent', cursor: 'pointer' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: dot, flexShrink: 0, marginTop: '4px' }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: '600', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.trade || 'General'}</p>
                    <p style={{ margin: 0, fontSize: '11px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || 'No description'}</p>
                  </div>
                </button>
              )
            })}
          </div>
          {canEdit && (
            <div style={{ padding: '8px', borderTop: '1px solid #f3f4f6' }}>
              {showAdd ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <select value={addTrade} onChange={e => setAddTrade(e.target.value)} style={{ ...s.input, fontSize: '12px' }}>
                    <option value="">Select trade…</option>
                    {COMMON_TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                    <option value="Other">Other</option>
                  </select>
                  {addTrade === 'Other' && (
                    <input placeholder="Trade name" value={addTrade === 'Other' ? '' : addTrade} onChange={e => setAddTrade(e.target.value)} style={{ ...s.input, fontSize: '12px' }} />
                  )}
                  <textarea placeholder="Scope description (optional)" value={addDesc} onChange={e => setAddDesc(e.target.value)} style={{ ...s.textarea, fontSize: '12px', minHeight: '56px' }} />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button style={{ ...s.btnPri, padding: '5px 10px', fontSize: '12px', flex: 1 }} onClick={addItem} disabled={adding || !addTrade.trim()}>
                      {adding ? 'Adding…' : 'Add'}
                    </button>
                    <button style={{ ...s.btnSec, padding: '5px 10px', fontSize: '12px' }} onClick={() => setShowAdd(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button style={{ ...s.btnSec, width: '100%', padding: '6px', fontSize: '12px', textAlign: 'center' }} onClick={() => setShowAdd(true)}>
                  + Add scope item
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: editor */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {selected ? (
          <ScopeItemEditor
            item={selected}
            plans={plans}
            onSave={saveItem}
            onDelete={deleteItem}
            openPlan={openPlan}
            canEdit={canEdit}
            saving={saving}
            saveMsg={saveMsg}
          />
        ) : (
          <div style={{ ...s.card, ...s.empty }}>
            {scopeItems.length === 0 ? 'Add a scope item to get started.' : 'Select an item to review.'}
          </div>
        )}
      </div>
    </div>
  )
}

function ScopeItemEditor({ item, plans, onSave, onDelete, openPlan, canEdit, saving, saveMsg }) {
  const review = item.scope_review || {}
  const [description, setDescription] = useState(item.description || '')
  const [notes, setNotes] = useState(review.notes || '')
  const [planId, setPlanId] = useState(review.source_plan_id || '')
  const [page, setPage] = useState(review.page || '')
  const [revision, setRevision] = useState(review.revision || '')
  const [err, setErr] = useState('')
  const source = plans.find(p => p.id === planId)

  useEffect(() => {
    const r = item.scope_review || {}
    setDescription(item.description || '')
    setNotes(r.notes || '')
    setPlanId(r.source_plan_id || '')
    setPage(r.page || '')
    setRevision(r.revision || '')
    setErr('')
  }, [item.id])

  async function save(status) {
    if (!description.trim()) { setErr('Enter a scope description.'); return }
    if (status === 'question' && !notes.trim()) { setErr('Describe the question.'); return }
    setErr('')
    try {
      await onSave(item.id, {
        description: description.trim(),
        scope_review: { status, notes: notes.trim(), source_plan_id: source?.id || null, source_name: source?.file_name || null, page: source ? String(page) : '', revision: source ? revision.trim() : '', reviewed_at: status === 'accepted' ? new Date().toISOString() : null },
      })
    } catch (e) { setErr(e.message || 'Save failed.') }
  }

  const status = review.status || 'draft'
  const statusColors = { accepted: ['#dcfce7','#16a34a'], question: ['#fefce8','#a16207'], draft: ['#f3f4f6','#6b7280'] }
  const [sbg, scol] = statusColors[status] || statusColors.draft

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: '700', color: '#111827' }}>{item.trade || 'General Scope'}</h3>
          <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', background: sbg, color: scol }}>
            {status === 'accepted' ? 'Reviewed' : status === 'question' ? 'Question open' : 'Needs review'}
          </span>
        </div>
        {canEdit && (
          <button style={{ ...s.btnDanger, padding: '5px 10px', fontSize: '12px' }}
            onClick={() => { if (confirm('Remove this scope item?')) onDelete(item.id) }}>
            Remove
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={s.sectionLabel}>Scope wording</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={!canEdit || saving} style={s.textarea} placeholder="Inclusions, exclusions, allowances…" />
          </div>
          <div>
            <label style={s.sectionLabel}>Assumptions, exclusions, or open questions</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit || saving} style={{ ...s.textarea, minHeight: '64px' }} placeholder="Detail anything unconfirmed separately from the agreed scope." />
          </div>

          {canEdit && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button style={s.btnPri} onClick={() => save('accepted')} disabled={saving}>Accept scope</button>
              <button style={s.btnSec} onClick={() => save('draft')} disabled={saving}>Save draft</button>
              <button style={{ ...s.btnSec, color: '#a16207', borderColor: '#fef08a' }} onClick={() => save('question')} disabled={saving}>Flag question</button>
              {saving && <span style={{ fontSize: '12px', color: '#6b7280' }}>Saving…</span>}
              {saveMsg && <span style={{ fontSize: '12px', color: '#16a34a' }}>{saveMsg}</span>}
            </div>
          )}

          {err && <p style={{ color: '#dc2626', fontSize: '12px', margin: 0 }}>{err}</p>}
        </div>

        <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '8px', padding: '1rem' }}>
          <p style={{ ...s.sectionLabel, marginBottom: '8px' }}>Drawing evidence</p>
          <label style={{ ...s.sectionLabel, fontSize: '11px', marginBottom: '3px' }}>Source document</label>
          <select value={planId} onChange={e => { setPlanId(e.target.value); setPage(''); setRevision('') }} disabled={!canEdit || saving} style={{ ...s.input, fontSize: '12px', marginBottom: '8px' }}>
            <option value="">Manual scope / no source</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.file_name}</option>)}
          </select>
          {planId && !source && <p style={{ color: '#dc2626', fontSize: '11px' }}>Linked document no longer in package — select a replacement.</p>}
          {source && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                <div>
                  <label style={{ ...s.sectionLabel, fontSize: '10px' }}>PDF page</label>
                  <input type="number" min="1" value={page} onChange={e => setPage(e.target.value)} disabled={!canEdit} style={{ ...s.input, fontSize: '12px' }} />
                </div>
                <div>
                  <label style={{ ...s.sectionLabel, fontSize: '10px' }}>Sheet / revision</label>
                  <input value={revision} onChange={e => setRevision(e.target.value)} disabled={!canEdit} style={{ ...s.input, fontSize: '12px' }} placeholder="A-101 / Rev 2" />
                </div>
              </div>
              <button style={{ ...s.btnSec, fontSize: '12px', padding: '5px 10px', width: '100%' }} onClick={() => openPlan(source.storage_path)}>
                Open document ↗
              </button>
            </>
          )}
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af', lineHeight: '1.4' }}>
            Verify the current revision before accepting.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── RFIs ──────────────────────────────────────────────────────────────────────

function RFIsSection({ bidId, rfis, rfiTableExists, reload, canEdit, profile }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ subject: '', question: '', responsible_party: '', recipient_email: '', drawing_ref: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [selected, setSelected] = useState(null)
  const [answerText, setAnswerText] = useState('')
  const [answerSaving, setAnswerSaving] = useState(false)

  if (!rfiTableExists) {
    return (
      <div style={s.card}>
        <h3 style={s.cardH}>RFIs</h3>
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '1rem' }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#1d4ed8' }}>
            <strong>Run migration 020_estimate_job_link.sql</strong> at the Supabase dashboard to enable the RFI log.
            The migration creates the <code>bid_rfis</code> table and links estimates to the jobs they become.
          </p>
        </div>
      </div>
    )
  }

  async function submitRFI() {
    if (!form.subject.trim() || !form.question.trim()) { setErr('Subject and question are required.'); return }
    setSaving(true); setErr('')
    const nextNum = Math.max(0, ...rfis.map(r => r.rfi_number)) + 1
    const { error } = await supabase.from('bid_rfis').insert({
      bid_package_id: bidId, rfi_number: nextNum, ...form,
      status: 'open', submitted_at: new Date().toISOString(),
      created_by: profile?.id,
    })
    if (error) { setErr(error.message); setSaving(false); return }
    await reload()
    setForm({ subject: '', question: '', responsible_party: '', recipient_email: '', drawing_ref: '' })
    setShowForm(false)
    setSaving(false)
  }

  async function updateRFI(id, updates) {
    setAnswerSaving(true)
    await supabase.from('bid_rfis').update(updates).eq('id', id)
    await reload()
    setAnswerSaving(false)
  }

  const sel = rfis.find(r => r.id === selected)

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
      {/* List */}
      <div style={{ width: '240px', flexShrink: 0 }}>
        <div style={{ ...s.card, padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#111827' }}>{rfis.length} RFI{rfis.length !== 1 ? 's' : ''}</span>
            {canEdit && <button style={{ ...s.btnSec, padding: '4px 8px', fontSize: '12px' }} onClick={() => setShowForm(v => !v)}>+ New</button>}
          </div>
          {rfis.map(r => (
            <button key={r.id} onClick={() => { setSelected(r.id); setAnswerText(r.answer || '') }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid #f3f4f6', background: selected === r.id ? '#fef3ee' : 'transparent', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280' }}>RFI-{String(r.rfi_number).padStart(3,'0')}</span>
                <span style={s.badge(r.status === 'open' ? 'open_rfi' : r.status)}>{r.status}</span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: '600', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subject}</p>
              {r.responsible_party && <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#6b7280' }}>{r.responsible_party}</p>}
            </button>
          ))}
          {rfis.length === 0 && <p style={{ padding: '12px', fontSize: '12px', color: '#9ca3af', margin: 0 }}>No RFIs yet.</p>}
        </div>
      </div>

      {/* Detail / form */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {showForm && (
          <div style={{ ...s.card, marginBottom: '1rem' }}>
            <h3 style={{ ...s.cardH, marginBottom: '1rem' }}>New RFI</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              {[
                { label: 'Subject', key: 'subject', placeholder: 'Brief subject line' },
                { label: 'Responsible Party', key: 'responsible_party', placeholder: 'Architect, engineer, owner…' },
                { label: 'Recipient Email', key: 'recipient_email', placeholder: 'recipient@firm.com' },
                { label: 'Drawing Reference', key: 'drawing_ref', placeholder: 'Sheet A2.1, Rev B' },
              ].map(f => (
                <div key={f.key}>
                  <label style={s.sectionLabel}>{f.label}</label>
                  <input value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} style={s.input} />
                </div>
              ))}
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={s.sectionLabel}>Question</label>
              <textarea value={form.question} onChange={e => setForm(p => ({ ...p, question: e.target.value }))} style={s.textarea} placeholder="Full question text…" />
            </div>
            {err && <p style={{ color: '#dc2626', fontSize: '12px', margin: '0 0 8px' }}>{err}</p>}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={s.btnPri} onClick={submitRFI} disabled={saving}>{saving ? 'Submitting…' : 'Submit RFI'}</button>
              <button style={s.btnSec} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {sel ? (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: '700', color: '#6b7280' }}>RFI-{String(sel.rfi_number).padStart(3,'0')}</p>
                <h3 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: '700', color: '#111827' }}>{sel.subject}</h3>
                <span style={s.badge(sel.status === 'open' ? 'open_rfi' : sel.status)}>{sel.status}</span>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  {sel.status === 'open' && <button style={{ ...s.btnSec, padding: '5px 10px', fontSize: '12px' }} onClick={() => updateRFI(sel.id, { status: 'closed', closed_at: new Date().toISOString() })}>Close</button>}
                  {sel.status === 'answered' && <button style={{ ...s.btnSec, padding: '5px 10px', fontSize: '12px' }} onClick={() => updateRFI(sel.id, { status: 'closed', closed_at: new Date().toISOString() })}>Close</button>}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '1rem', fontSize: '13px' }}>
              {[['To', sel.responsible_party], ['Recipient', sel.recipient_email], ['Drawing Ref', sel.drawing_ref]].map(([l, v]) => (
                v ? <div key={l}><p style={{ ...s.mLabel, margin: '0 0 2px' }}>{l}</p><p style={{ margin: 0 }}>{v}</p></div> : null
              ))}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={s.sectionLabel}>Question</label>
              <p style={{ margin: 0, fontSize: '13px', color: '#374151', lineHeight: '1.6', background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '10px' }}>{sel.question}</p>
            </div>

            <div>
              <label style={s.sectionLabel}>Answer</label>
              <textarea value={answerText} onChange={e => setAnswerText(e.target.value)} disabled={!canEdit || answerSaving} style={s.textarea} placeholder="Record the response…" />
              {canEdit && (
                <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                  <button style={s.btnPri} disabled={answerSaving || !answerText.trim()}
                    onClick={() => updateRFI(sel.id, { answer: answerText, status: 'answered', answered_at: new Date().toISOString() })}>
                    {answerSaving ? 'Saving…' : 'Save Answer'}
                  </button>
                </div>
              )}
            </div>

            {sel.cost_impact !== null && sel.cost_impact !== undefined && (
              <div style={{ marginTop: '1rem', padding: '10px', background: '#fefce8', border: '1px solid #fef08a', borderRadius: '6px' }}>
                <p style={{ margin: 0, fontSize: '13px' }}><strong>Cost impact:</strong> {fmtMoney(sel.cost_impact)}</p>
              </div>
            )}
          </div>
        ) : !showForm && (
          <div style={{ ...s.card, ...s.empty }}>Select an RFI or create a new one.</div>
        )}
      </div>
    </div>
  )
}

// ── ITB HTML builder ──────────────────────────────────────────────────────────

function buildItbHtml(form, scopes, plans, logoSrc) {
  const esc = v => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')

  const byTrade = {}
  scopes.forEach(item => {
    const t = item.trade || 'General'
    if (!byTrade[t]) byTrade[t] = []
    byTrade[t].push(item)
  })

  const deadlineStr = form.deadlineDate
    ? new Date(form.deadlineDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : '—'
  const genDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const docRows = plans.map((p, i) => `
    <tr>
      <td class="center" style="color:#bbb;font-size:10px">${String(i + 1).padStart(2, '0')}</td>
      <td>${esc(p.file_name)}</td>
      <td>${p.uploaded_at ? new Date(p.uploaded_at).toLocaleDateString('en-US') : '—'}</td>
      <td class="center" style="color:#16a34a;font-weight:700">✓</td>
    </tr>`).join('')

  const scopeHtml = Object.entries(byTrade).map(([trade, items]) => `
    <div class="scope-trade">
      <div class="trade-label">${esc(trade)}</div>
      ${items.map(item => `
        <div class="scope-item">
          <div class="scope-text">${esc(item.description || '')}</div>
          ${item.scope_review?.notes ? `<div class="scope-note">${esc(item.scope_review.notes)}</div>` : ''}
        </div>`).join('')}
    </div>`).join('')

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>Invitation to Bid — ${esc(form.projectName)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { .no-print { display: none !important; } }
.no-print { padding: 12px 40px; background: #1a1a1a; display: flex; gap: 10px; align-items: center; }
.btn { padding: 8px 22px; background: #e8590c; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 700; }
.btn-outline { padding: 8px 18px; background: transparent; color: #888; border: 1px solid #333; border-radius: 4px; cursor: pointer; font-size: 12px; }
.page { max-width: 860px; margin: 0 auto; }
.header-band { background: #111; padding: 32px 52px 28px; display: flex; justify-content: space-between; align-items: flex-start; }
.brand { display: flex; align-items: center; gap: 16px; }
.brand-logo { width: 52px; height: 52px; object-fit: contain; filter: brightness(0) invert(1); }
.brand-divider { width: 1px; height: 44px; background: #333; }
.co-name { font-size: 16px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; color: #fff; }
.co-tagline { font-size: 9px; color: #555; letter-spacing: 3px; text-transform: uppercase; margin-top: 3px; }
.co-contact { font-size: 10px; color: #666; margin-top: 8px; line-height: 1.9; }
.doc-block { text-align: right; }
.doc-type { font-size: 9px; font-weight: 800; letter-spacing: 4px; text-transform: uppercase; color: #e8590c; }
.doc-project { font-size: 16px; font-weight: 800; color: #fff; margin-top: 6px; max-width: 280px; line-height: 1.25; text-align: right; }
.doc-meta { font-size: 10px; color: #555; margin-top: 8px; line-height: 1.8; }
.rule { height: 3px; background: #e8590c; }
.body { padding: 40px 52px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 28px; border: 1px solid #e8e8e8; }
.info-block { padding: 18px 22px; }
.info-block + .info-block { border-left: 1px solid #e8e8e8; }
.eyebrow { font-size: 8px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #e8590c; margin-bottom: 6px; }
.info-value { font-size: 13px; font-weight: 700; color: #111; margin-bottom: 2px; }
.info-detail { font-size: 11px; color: #666; line-height: 1.7; }
.section-head { font-size: 8px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #e8590c; margin-bottom: 8px; }
.box { border: 1px solid #e8e8e8; border-left: 3px solid #e8590c; padding: 14px 18px; font-size: 12px; color: #444; line-height: 1.8; white-space: pre-wrap; margin-bottom: 28px; }
.scopes-wrap { border: 1px solid #e8e8e8; padding: 16px 20px; margin-bottom: 28px; }
.scope-trade { margin-bottom: 16px; }
.scope-trade:last-child { margin-bottom: 0; }
.trade-label { font-size: 8px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #e8590c; border-bottom: 1px solid #f0f0f0; padding-bottom: 4px; margin-bottom: 6px; }
.scope-item { padding: 6px 0; border-bottom: 1px solid #f8f8f8; }
.scope-item:last-child { border-bottom: none; }
.scope-text { font-size: 12px; color: #333; line-height: 1.7; }
.scope-note { font-size: 10px; color: #888; margin-top: 2px; font-style: italic; }
table { width: 100%; border-collapse: collapse; }
thead tr { border-bottom: 2px solid #111; }
thead th { padding: 7px 12px; font-size: 8px; text-transform: uppercase; letter-spacing: 2px; color: #111; font-weight: 800; text-align: left; }
.center { text-align: center; }
tbody tr { border-bottom: 1px solid #efefef; }
tbody tr:last-child { border-bottom: none; }
tbody td { padding: 9px 12px; font-size: 11px; color: #333; }
.doc-note { font-size: 9px; color: #bbb; margin-top: 8px; letter-spacing: 0.3px; font-style: italic; }
.footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #efefef; display: flex; justify-content: space-between; }
.footer div { font-size: 9px; color: #bbb; line-height: 1.7; }
.footer div:last-child { text-align: right; }
</style></head><body>

<div class="no-print">
  <button class="btn" onclick="window.print()">Print / Save PDF</button>
  <button class="btn-outline" onclick="window.close()">Close</button>
</div>

<div class="page">
<div class="header-band">
  <div class="brand">
    ${logoSrc ? `<img src="${logoSrc}" class="brand-logo" alt="NV" /><div class="brand-divider"></div>` : ''}
    <div>
      <div class="co-name">NV Construction</div>
      <div class="co-tagline">General Contractor</div>
      <div class="co-contact">management@nvim.co<br>nvim.co<br>LA License #&nbsp;CL 10283</div>
    </div>
  </div>
  <div class="doc-block">
    <div class="doc-type">Invitation to Bid</div>
    <div class="doc-project">${esc(form.projectName)}</div>
    <div class="doc-meta">Issued: ${genDate}<br>${esc(form.projectType || 'Commercial')}</div>
  </div>
</div>
<div class="rule"></div>

<div class="body">
<div class="info-grid">
  <div class="info-block">
    <div class="eyebrow">Project</div>
    <div class="info-value">${esc(form.projectName)}</div>
    ${form.projectAddress ? `<div class="info-detail">${esc(form.projectAddress)}</div>` : ''}
    ${form.projectDesc ? `<div class="info-detail" style="margin-top:8px">${esc(form.projectDesc)}</div>` : ''}
  </div>
  <div class="info-block">
    <div class="eyebrow">Bid Deadline</div>
    <div class="info-value">${deadlineStr}</div>
    ${form.deadlineTime ? `<div class="info-detail">${esc(form.deadlineTime)} ${esc(form.timezone)}</div>` : ''}
    <div class="eyebrow" style="margin-top:16px">Estimator Contact</div>
    ${form.contactName ? `<div class="info-value">${esc(form.contactName)}</div>` : ''}
    <div class="info-detail">${[form.contactEmail, form.contactPhone].filter(Boolean).map(esc).join('<br>')}</div>
  </div>
</div>

${form.submissionInstructions ? `<div class="section-head">Submission Instructions</div><div class="box">${esc(form.submissionInstructions)}</div>` : ''}
${form.siteVisitInfo ? `<div class="section-head">Site Visit</div><div class="box">${esc(form.siteVisitInfo)}</div>` : ''}

${scopes.length > 0 ? `
<div class="section-head" style="margin-bottom:12px">Scope of Work — Trade Requirements</div>
<div class="scopes-wrap">${scopeHtml}</div>` : ''}

${plans.length > 0 ? `
<div class="section-head" style="margin-bottom:12px">Document Register</div>
<table>
  <thead><tr>
    <th class="center" style="width:36px">#</th>
    <th>Document</th>
    <th style="width:110px">Date</th>
    <th class="center" style="width:56px">Incl.</th>
  </tr></thead>
  <tbody>${docRows}</tbody>
</table>
<div class="doc-note">Original files are included in the complete ZIP package — this document is the invitation letter and register only.</div>` : ''}

<div class="footer">
  <div>NV Construction, LLC &nbsp;·&nbsp; General Contractor &nbsp;·&nbsp; LA License # CL 10283<br>management@nvim.co &nbsp;·&nbsp; nvim.co</div>
  <div>${esc(form.projectName)}<br>Issued ${genDate}</div>
</div>
</div></div>
</body></html>`
}

// ── ITB Preparation Screen ────────────────────────────────────────────────────

function ItbPrepScreen({ pkg, plans, scopeItems, profile, onClose }) {
  const [tab, setTab] = useState('prepare')
  const [form, setForm] = useState({
    projectName:             pkg.title || '',
    projectAddress:          pkg.project_address || '',
    projectType:             'Commercial',
    projectDesc:             pkg.description || pkg.scope_of_work || '',
    deadlineDate:            pkg.due_date || '',
    deadlineTime:            '2:00 PM',
    timezone:                'PT',
    contactName:             profile?.full_name || '',
    contactEmail:            profile?.email || '',
    contactPhone:            '',
    submissionInstructions:  pkg.bid_instructions || 'Submit your proposal by email to the estimator listed above. Include a completed scope acknowledgment and your lump-sum base bid. Itemize any unit prices or alternates requested.',
    siteVisitInfo:           '',
  })
  const [selectedScopeIds, setSelectedScopeIds] = useState(() =>
    new Set(scopeItems.filter(i => i.scope_review?.status === 'accepted').map(i => i.id))
  )
  const [selectedPlanIds, setSelectedPlanIds] = useState(() => new Set(plans.map(p => p.id)))
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState('')

  const f = (key, val) => setForm(p => ({ ...p, [key]: val }))
  const selectedScopes = scopeItems.filter(i => selectedScopeIds.has(i.id))
  const selectedPlans  = plans.filter(p => selectedPlanIds.has(p.id))

  async function getLogo() {
    try {
      const res  = await fetch('/logo.png')
      const blob = await res.blob()
      return await new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(blob)
      })
    } catch { return '' }
  }

  async function exportPDF() {
    const logo = await getLogo()
    const html = buildItbHtml(form, selectedScopes, selectedPlans, logo)
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
  }

  async function exportZip() {
    if (selectedPlanIds.size === 0) {
      setExportErr('Select at least one document to include in the ZIP.')
      return
    }
    setExporting(true); setExportErr('')
    try {
      const logo = await getLogo()
      const itbHtml = buildItbHtml(form, selectedScopes, selectedPlans, logo)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/itb-export', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidPackageId: pkg.id, selectedPlanIds: [...selectedPlanIds], itbHtml, projectName: form.projectName }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href     = url
      a.download = `ITB_${(form.projectName || 'bid').replace(/[^a-zA-Z0-9]+/g, '_')}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setExportErr(e.message) }
    setExporting(false)
  }

  const iSec = { padding: '10px 10px 10px 0', border: 'none', background: '#f9fafb', borderRadius: '6px', width: '100%', fontSize: '14px', color: '#111827', outline: 'none', boxSizing: 'border-box' }
  const label = { fontSize: '11px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '4px' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#f4f6f8', overflowY: 'auto', fontFamily: "'Inter', system-ui, sans-serif", color: '#111827' }}>
      {/* Sticky top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem', height: '56px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={onClose} style={s.back}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '15px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Invitation to Bid — {form.projectName || 'Untitled'}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          {exportErr && <span style={{ fontSize: '12px', color: '#dc2626', maxWidth: '300px' }}>{exportErr}</span>}
          <button style={s.btnSec} onClick={exportPDF}>Export PDF</button>
          <button style={s.btnPri} onClick={exportZip} disabled={exporting}>
            {exporting ? 'Preparing ZIP…' : `Export ZIP (${selectedPlanIds.size} doc${selectedPlanIds.size !== 1 ? 's' : ''})`}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Tab selector */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '1.5rem', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '4px', width: 'fit-content' }}>
          {[['prepare', 'Edit'], ['preview', 'Preview']].map(([key, lbl]) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: '6px 18px', borderRadius: '5px', border: 'none', fontSize: '13px', fontWeight: tab === key ? '600' : '400', background: tab === key ? '#111827' : 'transparent', color: tab === key ? '#fff' : '#6b7280', cursor: 'pointer' }}>
              {lbl}
            </button>
          ))}
        </div>

        {tab === 'prepare' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Project info */}
            <div style={s.card}>
              <h3 style={s.cardH}>Project Information</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={label}>Project Name</label>
                  <input value={form.projectName} onChange={e => f('projectName', e.target.value)} style={s.input} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={label}>Project Address</label>
                  <input value={form.projectAddress} onChange={e => f('projectAddress', e.target.value)} style={s.input} />
                </div>
                <div>
                  <label style={label}>Project Type</label>
                  <select value={form.projectType} onChange={e => f('projectType', e.target.value)} style={s.input}>
                    {['Commercial','Residential','Industrial','Civil'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={label}>Project Description</label>
                  <textarea value={form.projectDesc} onChange={e => f('projectDesc', e.target.value)} style={{ ...s.textarea, minHeight: '72px' }} placeholder="Brief scope summary visible to subcontractors" />
                </div>
              </div>
            </div>

            {/* Deadline & Contact */}
            <div style={s.card}>
              <h3 style={s.cardH}>Bid Deadline & Estimator Contact</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div>
                  <label style={label}>Deadline Date</label>
                  <input type="date" value={form.deadlineDate} onChange={e => f('deadlineDate', e.target.value)} style={s.input} />
                </div>
                <div>
                  <label style={label}>Deadline Time</label>
                  <input value={form.deadlineTime} onChange={e => f('deadlineTime', e.target.value)} style={s.input} placeholder="2:00 PM" />
                </div>
                <div>
                  <label style={label}>Timezone</label>
                  <select value={form.timezone} onChange={e => f('timezone', e.target.value)} style={s.input}>
                    {[['PT','PT — Pacific'],['MT','MT — Mountain'],['CT','CT — Central'],['ET','ET — Eastern']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Estimator Name</label>
                  <input value={form.contactName} onChange={e => f('contactName', e.target.value)} style={s.input} placeholder="Your name" />
                </div>
                <div>
                  <label style={label}>Email</label>
                  <input type="email" value={form.contactEmail} onChange={e => f('contactEmail', e.target.value)} style={s.input} />
                </div>
                <div>
                  <label style={label}>Phone</label>
                  <input type="tel" value={form.contactPhone} onChange={e => f('contactPhone', e.target.value)} style={s.input} placeholder="(555) 000-0000" />
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div style={s.card}>
              <h3 style={s.cardH}>Submission Instructions</h3>
              <textarea value={form.submissionInstructions} onChange={e => f('submissionInstructions', e.target.value)} style={{ ...s.textarea, minHeight: '100px' }} />
            </div>

            {/* Site visit */}
            <div style={s.card}>
              <h3 style={s.cardH}>Site Visit <span style={{ fontWeight: '400', color: '#9ca3af', fontSize: '13px' }}>— optional</span></h3>
              <textarea value={form.siteVisitInfo} onChange={e => f('siteVisitInfo', e.target.value)} style={s.textarea} placeholder="E.g. Site walk scheduled Thursday Jan 30 at 10:00 AM — meet at main entrance. RSVP by Jan 28." />
            </div>

            {/* Scope checklist */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ ...s.cardH, margin: 0 }}>Trade Scopes <span style={{ fontWeight: '400', color: '#6b7280', fontSize: '13px' }}>({selectedScopeIds.size} of {scopeItems.length} selected)</span></h3>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button style={{ ...s.btnSec, padding: '4px 10px', fontSize: '12px' }} onClick={() => setSelectedScopeIds(new Set(scopeItems.map(i => i.id)))}>All</button>
                  <button style={{ ...s.btnSec, padding: '4px 10px', fontSize: '12px' }} onClick={() => setSelectedScopeIds(new Set())}>None</button>
                </div>
              </div>
              {scopeItems.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>No scope items yet — add them in Trade Scopes.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {scopeItems.map(item => {
                    const checked = selectedScopeIds.has(item.id)
                    const st = item.scope_review?.status || 'draft'
                    return (
                      <label key={item.id} style={{ display: 'flex', gap: '10px', cursor: 'pointer', padding: '10px', borderRadius: '6px', background: checked ? '#fef3ee' : '#f9fafb', border: `1px solid ${checked ? '#fed7aa' : '#f3f4f6'}`, alignItems: 'flex-start' }}>
                        <input type="checkbox" checked={checked} onChange={e => {
                          const next = new Set(selectedScopeIds)
                          if (e.target.checked) next.add(item.id); else next.delete(item.id)
                          setSelectedScopeIds(next)
                        }} style={{ marginTop: '2px', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{item.trade || 'General'}</span>
                            {st !== 'accepted' && (
                              <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: '600', background: st === 'question' ? '#fefce8' : '#f3f4f6', color: st === 'question' ? '#a16207' : '#6b7280' }}>
                                {st === 'question' ? 'Open question' : 'Not reviewed'}
                              </span>
                            )}
                          </div>
                          <p style={{ margin: 0, fontSize: '13px', color: checked ? '#374151' : '#9ca3af' }}>{item.description || 'No description'}</p>
                          {item.scope_review?.notes && checked && (
                            <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#6b7280', fontStyle: 'italic' }}>{item.scope_review.notes}</p>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Document checklist */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ ...s.cardH, margin: 0 }}>Documents <span style={{ fontWeight: '400', color: '#6b7280', fontSize: '13px' }}>({selectedPlanIds.size} of {plans.length} selected)</span></h3>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button style={{ ...s.btnSec, padding: '4px 10px', fontSize: '12px' }} onClick={() => setSelectedPlanIds(new Set(plans.map(p => p.id)))}>All</button>
                  <button style={{ ...s.btnSec, padding: '4px 10px', fontSize: '12px' }} onClick={() => setSelectedPlanIds(new Set())}>None</button>
                </div>
              </div>
              {plans.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>No documents uploaded — upload drawings and specs in the Documents section first.</p>
              ) : (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '32px' }}></th>
                        {['Filename','Uploaded','Status'].map(h => (
                          <th key={h} style={{ textAlign: 'left', fontWeight: '600', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', padding: '0 12px 8px 0' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map(p => {
                        const inc = selectedPlanIds.has(p.id)
                        return (
                          <tr key={p.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 8px 8px 0' }}>
                              <input type="checkbox" checked={inc} onChange={e => {
                                const next = new Set(selectedPlanIds)
                                if (e.target.checked) next.add(p.id); else next.delete(p.id)
                                setSelectedPlanIds(next)
                              }} />
                            </td>
                            <td style={{ padding: '8px 12px 8px 0', fontWeight: '500', color: inc ? '#111827' : '#9ca3af' }}>{p.file_name}</td>
                            <td style={{ padding: '8px 12px 8px 0', color: '#6b7280' }}>{p.uploaded_at ? new Date(p.uploaded_at).toLocaleDateString() : '—'}</td>
                            <td style={{ padding: '8px 0' }}>
                              <span style={{ padding: '2px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: '600', background: inc ? '#dcfce7' : '#f3f4f6', color: inc ? '#16a34a' : '#9ca3af' }}>
                                {inc ? 'In ZIP' : 'Excluded'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p style={{ margin: '10px 0 0', fontSize: '12px', color: '#6b7280' }}>
                    Selected files are listed by filename in the PDF and included as original files in the ZIP.
                  </p>
                </>
              )}
            </div>

            {/* Export note */}
            <div style={{ ...s.card, background: '#fffbeb', border: '1px solid #fde68a' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#92400e', lineHeight: '1.7' }}>
                <strong>Export PDF</strong> — Opens a printable NV-branded invitation. The document register lists included filenames only; no source files are embedded in the PDF.<br/>
                <strong>Export ZIP</strong> — Downloads the ITB invitation plus the {selectedPlanIds.size} selected original file{selectedPlanIds.size !== 1 ? 's' : ''} in a Documents/ folder. Use this when distributing the full drawing set to bidders.
              </p>
            </div>
          </div>
        )}

        {tab === 'preview' && (
          <div style={s.card}>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 1rem' }}>
              Preview of what the subcontractor will see. Click <strong>Export PDF</strong> above for the full printable version with your logo embedded.
            </p>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
              <iframe
                srcDoc={buildItbHtml(form, selectedScopes, selectedPlans, '')}
                style={{ width: '100%', height: '720px', border: 'none' }}
                title="ITB Preview"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Invitations & Quotes ──────────────────────────────────────────────────────

function InvitationsSection({ bidId, pkg, plans, invitations, submissions, scopeItems, profile, reload, canEdit }) {
  const [itbOpen, setItbOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [newTrade, setNewTrade] = useState('')
  const [sending, setSending] = useState(false)
  const [subForm, setSubForm] = useState(null) // { inv_email }
  const [subData, setSubData] = useState({ company_name: '', amount: '', trade: '', notes: '' })
  const [savingSub, setSavingSub] = useState(false)
  const [err, setErr] = useState('')

  const trades = [...new Set(scopeItems.map(i => i.trade).filter(Boolean))]

  const invWithSubs = invitations.map(inv => ({
    ...inv,
    submission: submissions.find(s => s.sub_email === inv.sub_email),
  }))

  async function sendInvitation() {
    if (!newEmail.trim()) { setErr('Enter an email address.'); return }
    setSending(true); setErr('')
    const { error } = await supabase.from('bid_invitations').insert({
      bid_package_id: bidId, sub_email: newEmail.trim().toLowerCase(), sent_at: new Date().toISOString(),
      company_name: newCompany.trim() || null, trade: newTrade || null,
    })
    if (error) { setErr(error.message); setSending(false); return }
    await reload()
    setNewEmail(''); setNewCompany(''); setNewTrade('')
    setSending(false)
  }

  async function recordSubmission() {
    if (!subData.amount || isNaN(Number(subData.amount))) { setErr('Enter a valid amount.'); return }
    setSavingSub(true); setErr('')
    const { error } = await supabase.from('bid_submissions').insert({
      bid_package_id: bidId,
      sub_email: subForm.sub_email,
      company_name: subData.company_name || subForm.company_name || subForm.sub_email,
      amount: Number(subData.amount),
      trade: subData.trade || null,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    })
    if (error) { setErr(error.message); setSavingSub(false); return }
    await reload()
    setSubForm(null); setSubData({ company_name: '', amount: '', trade: '', notes: '' })
    setSavingSub(false)
  }

  async function setSubmissionStatus(subId, status) {
    await supabase.from('bid_submissions').update({ status }).eq('id', subId)
    await reload()
  }

  return (
    <div>
      {itbOpen && (
        <ItbPrepScreen
          pkg={pkg}
          plans={plans}
          scopeItems={scopeItems}
          profile={profile}
          onClose={() => setItbOpen(false)}
        />
      )}

      {/* ITB Prep card — always visible so PM can prepare the package */}
      <div style={{ ...s.card, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ ...s.cardH, margin: '0 0 4px' }}>Invitation to Bid Package</h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>
            Prepare the ITB document with scope, deadline, and contacts. Export as PDF or ZIP with the full drawing set.
          </p>
        </div>
        <button style={{ ...s.btnPri, whiteSpace: 'nowrap', flexShrink: 0, marginLeft: '16px' }} onClick={() => setItbOpen(true)}>
          Prepare ITB
        </button>
      </div>

      {canEdit && (
        <div style={{ ...s.card, marginBottom: '1rem' }}>
          <h3 style={{ ...s.cardH, marginBottom: '1rem' }}>Send Invitation to Bid</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
            <div>
              <label style={s.sectionLabel}>Email *</label>
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="sub@company.com" style={s.input} type="email" />
            </div>
            <div>
              <label style={s.sectionLabel}>Company</label>
              <input value={newCompany} onChange={e => setNewCompany(e.target.value)} placeholder="Company name" style={s.input} />
            </div>
            <div>
              <label style={s.sectionLabel}>Trade</label>
              <select value={newTrade} onChange={e => setNewTrade(e.target.value)} style={s.input}>
                <option value="">All trades</option>
                {trades.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button style={{ ...s.btnPri, whiteSpace: 'nowrap' }} onClick={sendInvitation} disabled={sending}>
              {sending ? 'Saving…' : 'Add Invitation'}
            </button>
          </div>
          {err && <p style={{ color: '#dc2626', fontSize: '12px', margin: '8px 0 0' }}>{err}</p>}
          <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#9ca3af' }}>
            Sending actual ITB emails from this portal is not yet wired. Record the invitation here; send documents through your email client.
          </p>
        </div>
      )}

      {/* Submission recording form */}
      {subForm && (
        <div style={{ ...s.card, border: '1px solid #bfdbfe', background: '#eff6ff', marginBottom: '1rem' }}>
          <h3 style={{ ...s.cardH, marginBottom: '0.75rem' }}>Record Quote — {subForm.sub_email}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={s.sectionLabel}>Company name</label>
              <input value={subData.company_name} onChange={e => setSubData(p => ({ ...p, company_name: e.target.value }))} style={s.input} placeholder="Company name" />
            </div>
            <div>
              <label style={s.sectionLabel}>Bid amount *</label>
              <input value={subData.amount} onChange={e => setSubData(p => ({ ...p, amount: e.target.value }))} style={s.input} type="number" placeholder="0.00" />
            </div>
            <div>
              <label style={s.sectionLabel}>Trade</label>
              <select value={subData.trade} onChange={e => setSubData(p => ({ ...p, trade: e.target.value }))} style={s.input}>
                <option value="">General</option>
                {trades.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {err && <p style={{ color: '#dc2626', fontSize: '12px', margin: '0 0 8px' }}>{err}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={s.btnPri} onClick={recordSubmission} disabled={savingSub}>{savingSub ? 'Saving…' : 'Record Quote'}</button>
            <button style={s.btnSec} onClick={() => { setSubForm(null); setErr('') }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={s.card}>
        <h3 style={{ ...s.cardH, marginBottom: '1rem' }}>Invitations ({invitations.length})</h3>
        {invWithSubs.length === 0 ? (
          <div style={s.empty}>No invitations recorded.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>{['Company / Email','Trade','Status','Quote','Actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontWeight: '600', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', padding: '0 12px 8px 0' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {invWithSubs.map(inv => {
                const sub = inv.submission
                const status = sub ? (sub.status === 'awarded' ? 'awarded' : 'submitted') : 'invited'
                const badgeMap = { invited: ['#f3f4f6','#6b7280'], submitted: ['#eff6ff','#1d4ed8'], awarded: ['#dcfce7','#16a34a'] }
                const [bg, col] = badgeMap[status] || badgeMap.invited
                return (
                  <tr key={inv.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px 8px 0' }}>
                      <p style={{ margin: '0 0 2px', fontWeight: '600', color: '#111827' }}>{inv.company_name || inv.sub_email}</p>
                      {inv.company_name && <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>{inv.sub_email}</p>}
                    </td>
                    <td style={{ padding: '8px 12px 8px 0', color: '#6b7280' }}>{inv.trade || 'All trades'}</td>
                    <td style={{ padding: '8px 12px 8px 0' }}>
                      <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', background: bg, color: col }}>{status}</span>
                    </td>
                    <td style={{ padding: '8px 12px 8px 0', fontWeight: sub ? '600' : '400', color: sub ? '#111827' : '#9ca3af' }}>
                      {sub ? fmtMoney(sub.amount) : '—'}
                    </td>
                    <td style={{ padding: '8px 0' }}>
                      {!sub && canEdit && (
                        <button style={{ ...s.btnSec, padding: '4px 10px', fontSize: '12px' }} onClick={() => { setSubForm(inv); setErr('') }}>Record quote</button>
                      )}
                      {sub && sub.status !== 'awarded' && canEdit && (
                        <button style={{ ...s.btnSec, padding: '4px 10px', fontSize: '12px', color: '#16a34a', borderColor: '#bbf7d0' }} onClick={() => setSubmissionStatus(sub.id, 'awarded')}>Award</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Bid Leveling ──────────────────────────────────────────────────────────────

function LevelingSection({ bidId, scopeItems, submissions, levelingEntries, reload }) {
  const [saving, setSaving] = useState(false)
  const [local, setLocal] = useState({}) // { [subId_scopeId]: { amount, included } }

  useEffect(() => {
    const m = {}
    levelingEntries.forEach(e => { m[`${e.bid_submission_id}_${e.bid_scope_item_id}`] = { amount: e.amount, included: e.included } })
    setLocal(m)
  }, [levelingEntries])

  const trades = [...new Set(scopeItems.map(i => i.trade).filter(Boolean))]
  const subList = submissions.filter(s => s.amount > 0)

  async function saveEntry(subId, scopeId, amount, included) {
    setSaving(true)
    await supabase.from('bid_leveling_entries').upsert({ bid_submission_id: subId, bid_scope_item_id: scopeId, amount: Number(amount) || 0, included: !!included }, { onConflict: 'bid_submission_id,bid_scope_item_id' })
    setSaving(false)
  }

  if (subList.length === 0) {
    return <div style={{ ...s.card, ...s.empty }}>Record quotes in Invitations & Quotes before leveling.</div>
  }
  if (scopeItems.length === 0) {
    return <div style={{ ...s.card, ...s.empty }}>Add trade scope items before leveling.</div>
  }

  const subTotals = {}
  subList.forEach(sub => {
    let t = 0
    scopeItems.forEach(sc => {
      const k = `${sub.id}_${sc.id}`
      t += Number(local[k]?.amount || 0)
    })
    subTotals[sub.id] = t
  })

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ ...s.cardH, margin: 0 }}>Bid Leveling Matrix</h3>
        {saving && <span style={{ fontSize: '12px', color: '#6b7280' }}>Saving…</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '600px' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 12px 6px 0', fontWeight: '600', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', minWidth: '180px' }}>Scope Item</th>
              {subList.map(sub => (
                <th key={sub.id} style={{ textAlign: 'center', padding: '6px 8px', fontWeight: '600', color: '#111827', minWidth: '120px', borderLeft: '1px solid #f3f4f6' }}>
                  <p style={{ margin: '0 0 2px', fontSize: '12px' }}>{sub.company_name || sub.sub_email}</p>
                  <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>{fmtMoney(sub.amount)}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map(trade => {
              const items = scopeItems.filter(i => i.trade === trade)
              return items.map((sc, idx) => (
                <tr key={sc.id} style={{ borderTop: '1px solid #f3f4f6', background: idx === 0 ? '#fafafa' : '#fff' }}>
                  <td style={{ padding: '7px 12px 7px 0', color: '#374151' }}>
                    {idx === 0 && <span style={{ fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', display: 'block', marginBottom: '1px' }}>{trade}</span>}
                    <span style={{ fontSize: '12px' }}>{sc.description || '—'}</span>
                  </td>
                  {subList.map(sub => {
                    const k = `${sub.id}_${sc.id}`
                    const entry = local[k] || {}
                    return (
                      <td key={sub.id} style={{ padding: '4px 8px', borderLeft: '1px solid #f3f4f6', textAlign: 'center' }}>
                        <input
                          type="number"
                          placeholder="—"
                          value={entry.amount ?? ''}
                          onChange={e => setLocal(p => ({ ...p, [k]: { ...entry, amount: e.target.value } }))}
                          onBlur={e => saveEntry(sub.id, sc.id, e.target.value, entry.included !== false)}
                          style={{ width: '90px', padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: '4px', fontSize: '12px', textAlign: 'right', outline: 'none' }}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))
            })}
            <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f9fafb', fontWeight: '700' }}>
              <td style={{ padding: '8px 12px 8px 0', fontSize: '13px' }}>Leveled Total</td>
              {subList.map(sub => (
                <td key={sub.id} style={{ padding: '8px', textAlign: 'center', borderLeft: '1px solid #f3f4f6', fontSize: '13px', color: '#111827' }}>
                  {fmtMoney(subTotals[sub.id])}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af' }}>Enter amounts per line item per bidder. Totals update as you type; values save on field blur.</p>
    </div>
  )
}

// ── Proposal & Handoff ────────────────────────────────────────────────────────

function ProposalSection({ pkg, bidId, scopeItems, submissions, profile, reload }) {
  const router = useRouter()
  const [showConvert, setShowConvert] = useState(false)
  const [jobType, setJobType] = useState('commercial')
  const [cvtForm, setCvtForm] = useState({ job_number: '', start_date: '', contract_value: '', pm_email: profile?.email || '' })
  const [converting, setConverting] = useState(false)
  const [cvtErr, setCvtErr] = useState('')
  const [linkedJob, setLinkedJob] = useState(null)
  const [showStatus, setShowStatus] = useState(false)
  const [newStatus, setNewStatus] = useState(pkg?.status || 'open')
  const [savingStatus, setSavingStatus] = useState(false)

  const canEdit = ['pm', 'apm'].includes(profile?.role)
  const isPM    = profile?.role === 'pm'
  const awarded = submissions.find(s => s.status === 'awarded')

  useEffect(() => {
    if (pkg?.job_id) {
      supabase.from('jobs').select('id, job_number, project_name').eq('id', pkg.job_id).maybeSingle()
        .then(({ data }) => { if (data) setLinkedJob(data) })
    }
  }, [pkg?.job_id])

  // Auto-fill contract value from awarded submission
  useEffect(() => {
    if (awarded && !cvtForm.contract_value) {
      setCvtForm(p => ({ ...p, contract_value: String(Math.round(awarded.amount || 0)) }))
    }
  }, [awarded])

  async function convertToJob() {
    if (!cvtForm.job_number.trim()) { setCvtErr('Job number is required.'); return }
    if (!cvtForm.contract_value || isNaN(Number(cvtForm.contract_value))) { setCvtErr('Enter a valid contract value.'); return }

    // Duplicate check
    const { data: existing } = await supabase.from('jobs').select('id').eq('source_bid_id', bidId).maybeSingle()
    if (existing) {
      setLinkedJob(existing)
      setCvtErr('A job linked to this bid package already exists.')
      return
    }

    setConverting(true); setCvtErr('')
    try {
      const jobFields = {
        job_number:   cvtForm.job_number.trim(),
        project_name: pkg.title,
        location:     pkg.project_address || '',
        contract_value: Number(cvtForm.contract_value),
        start_date:   cvtForm.start_date || null,
        status:       'active',
        job_type:     jobType,
        nv_role:      'gc',
        billing_type: 'aia',
        sub_billing_frequency: 'monthly',
        owner_billing_frequency: 'monthly',
        source_bid_id: bidId,
        pm_email:     cvtForm.pm_email || null,
      }
      if (jobType === 'residential') {
        jobFields.owner_name  = pkg.owner_name || ''
        jobFields.owner_email = null
        delete jobFields.job_type
      }

      const { data: job, error: jobErr } = await supabase.from('jobs').insert(jobFields).select('id').single()
      if (jobErr) throw jobErr

      // Copy scope items as budget items
      if (scopeItems.length > 0) {
        const budgetRows = scopeItems.map((sc, i) => ({
          job_id: job.id,
          description: `[${sc.trade || 'General'}] ${sc.description || sc.trade}`,
          budget_amount: Number(sc.budget_amount || 0),
          owner_amount:  Number(sc.budget_amount || 0),
          category: sc.trade || 'General',
          sort_order: i,
        }))
        await supabase.from('budget_items').insert(budgetRows)
      }

      // Link bid package to job
      await supabase.from('bid_packages').update({ job_id: job.id, status: 'awarded' }).eq('id', bidId)

      router.push(`/jobdetail?id=${job.id}`)
    } catch (e) {
      setCvtErr(e.message || 'Conversion failed.')
      setConverting(false)
    }
  }

  async function saveStatus() {
    setSavingStatus(true)
    await supabase.from('bid_packages').update({ status: newStatus }).eq('id', bidId)
    await reload()
    setSavingStatus(false)
    setShowStatus(false)
  }

  return (
    <>
      {/* Status */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ ...s.cardH, margin: '0 0 4px' }}>Package Status</h3>
            <span style={s.badge(pkg?.status)}>{BID_STATUS_LABELS[pkg?.status] || pkg?.status}</span>
          </div>
          {canEdit && (
            <button style={s.btnSec} onClick={() => setShowStatus(v => !v)}>Change Status</button>
          )}
        </div>
        {showStatus && (
          <div style={{ marginTop: '1rem', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ ...s.input, width: 'auto' }}>
              {['open','awarded','won','lost','closed'].map(st => <option key={st} value={st}>{st.charAt(0).toUpperCase() + st.slice(1)}</option>)}
            </select>
            <button style={s.btnPri} onClick={saveStatus} disabled={savingStatus}>{savingStatus ? 'Saving…' : 'Save'}</button>
            <button style={s.btnSec} onClick={() => setShowStatus(false)}>Cancel</button>
          </div>
        )}
      </div>

      {/* Linked job */}
      {linkedJob && (
        <div style={{ ...s.card, borderColor: '#bbf7d0', background: '#f0fdf4' }}>
          <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#15803d', fontWeight: '600' }}>Linked Job</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#111827' }}>{linkedJob.job_number} — {linkedJob.project_name}</p>
            <a href={`/jobdetail?id=${linkedJob.id}`} style={{ ...s.btnSec, textDecoration: 'none', padding: '5px 12px', fontSize: '12px' }}>Open Job →</a>
          </div>
        </div>
      )}

      {/* Convert to job */}
      {!linkedJob && canEdit && (
        <div style={s.card}>
          <h3 style={s.cardH}>Convert to Job</h3>

          {awarded && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '10px', marginBottom: '1rem' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#15803d' }}>
                <strong>Awarded sub:</strong> {awarded.company_name || awarded.sub_email} — {fmtMoney(awarded.amount)}
              </p>
            </div>
          )}

          {!showConvert ? (
            <button style={s.btnPri} onClick={() => setShowConvert(true)}>Convert to Job →</button>
          ) : (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <label style={s.sectionLabel}>Job type</label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {[['commercial','Commercial'],['residential','Residential']].map(([val, lbl]) => (
                    <label key={val} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: jobType === val ? '600' : '400' }}>
                      <input type="radio" name="jobType" value={val} checked={jobType === val} onChange={() => setJobType(val)} />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1rem' }}>
                {[
                  { label: 'Job Number *', key: 'job_number', placeholder: '2026-042' },
                  { label: 'Contract Value *', key: 'contract_value', placeholder: '0', type: 'number' },
                  { label: 'Start Date', key: 'start_date', type: 'date' },
                  { label: 'PM Email', key: 'pm_email', placeholder: 'pm@nvim.co' },
                ].map(f => (
                  <div key={f.key}>
                    <label style={s.sectionLabel}>{f.label}</label>
                    <input value={cvtForm[f.key]} onChange={e => setCvtForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder || ''} type={f.type || 'text'} style={s.input} />
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: '1rem', padding: '10px', background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '6px', fontSize: '13px', color: '#374151' }}>
                <p style={{ margin: '0 0 4px', fontWeight: '600' }}>What carries over:</p>
                <ul style={{ margin: 0, padding: '0 0 0 1.25rem', lineHeight: '1.7' }}>
                  <li>{scopeItems.length} scope item{scopeItems.length !== 1 ? 's' : ''} as budget line items</li>
                  <li>Project name: <strong>{pkg?.title}</strong></li>
                  <li>Address: {pkg?.project_address || '(not set)'}</li>
                  {awarded && <li>Awarded sub: {awarded.company_name || awarded.sub_email} ({fmtMoney(awarded.amount)})</li>}
                </ul>
                <p style={{ margin: '8px 0 0', color: '#9ca3af', fontSize: '12px' }}>Internal pricing notes and bid leveling data stay in this package and are not copied to the job.</p>
              </div>

              {cvtErr && <p style={{ color: '#dc2626', fontSize: '13px', margin: '0 0 10px' }}>{cvtErr}</p>}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={s.btnPri} onClick={convertToJob} disabled={converting}>{converting ? 'Creating job…' : 'Create Job'}</button>
                <button style={s.btnSec} onClick={() => { setShowConvert(false); setCvtErr('') }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Settings / delete */}
      {isPM && (
        <div style={{ ...s.card, borderColor: '#fecaca' }}>
          <h3 style={{ ...s.cardH, color: '#dc2626', marginBottom: '0.75rem', fontSize: '13px' }}>Danger Zone</h3>
          <button
            style={s.btnDanger}
            onClick={async () => {
              if (!confirm(`Delete bid package "${pkg?.title}"? This cannot be undone.`)) return
              await supabase.from('bid_packages').delete().eq('id', bidId)
              router.push('/dashboard?tab=estimator&inner=bids')
            }}
          >
            Delete Bid Package
          </button>
        </div>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BidWorkspacePage() {
  const { id } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const section = searchParams.get('section') || 'overview'

  const [profile, setProfile] = useState(null)
  const [pkg, setPkg] = useState(null)
  const [plans, setPlans] = useState([])
  const [scopeItems, setScopeItems] = useState([])
  const [invitations, setInvitations] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [levelingEntries, setLevelingEntries] = useState([])
  const [rfis, setRfis] = useState([])
  const [rfiTableExists, setRfiTableExists] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const canEdit = ['pm', 'apm'].includes(profile?.role)

  const loadAll = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    // Profile
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    setProfile({ ...prof, id: session.user.id, email: session.user.email })

    // Bid package
    const { data: bidPkg, error: bidErr } = await supabase.from('bid_packages').select('*').eq('id', id).maybeSingle()
    if (bidErr || !bidPkg) { setError('Bid package not found.'); setLoading(false); return }
    setPkg(bidPkg)

    // Parallel data loads
    const [plansRes, scopeRes, invRes, subRes, levelRes] = await Promise.all([
      supabase.from('bid_plans').select('*').eq('bid_package_id', id).order('uploaded_at'),
      supabase.from('bid_scope_items').select('*').eq('bid_package_id', id).order('sort_order'),
      supabase.from('bid_invitations').select('*').eq('bid_package_id', id).order('sent_at'),
      supabase.from('bid_submissions').select('*').eq('bid_package_id', id).order('submitted_at'),
      supabase.from('bid_leveling_entries').select('*').eq('bid_submission_id', 'dummy').then(() =>
        supabase.from('bid_leveling_entries').select('*').in('bid_submission_id',
          // Will be populated after submissions load
          ['00000000-0000-0000-0000-000000000000']
        )
      ),
    ])

    setPlans(plansRes.data || [])
    setScopeItems(scopeRes.data || [])
    setInvitations(invRes.data || [])
    const subs = subRes.data || []
    setSubmissions(subs)

    // Load leveling entries for actual submission IDs
    if (subs.length > 0) {
      const { data: lvl } = await supabase.from('bid_leveling_entries').select('*').in('bid_submission_id', subs.map(s => s.id))
      setLevelingEntries(lvl || [])
    }

    // Try to load RFIs (table may not exist yet)
    const { data: rfiData, error: rfiErr } = await supabase.from('bid_rfis').select('*').eq('bid_package_id', id).order('rfi_number')
    if (rfiErr?.message?.includes('relation') || rfiErr?.message?.includes('does not exist')) {
      setRfiTableExists(false)
    } else {
      setRfis(rfiData || [])
    }

    setLoading(false)
  }, [id, router])

  useEffect(() => { loadAll() }, [loadAll])

  function setSection(key) {
    router.replace(`/bid/${id}?section=${key}`, { scroll: false })
  }

  if (loading) {
    return (
      <div style={s.page}>
        <div style={{ padding: '4rem 2rem', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>Loading bid package…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={s.page}>
        <div style={{ padding: '4rem 2rem', textAlign: 'center', color: '#dc2626', fontSize: '14px' }}>{error}</div>
      </div>
    )
  }

  const daysUntilDue = pkg?.due_date
    ? Math.ceil((new Date(pkg.due_date + 'T23:59:59') - new Date()) / 86400000)
    : null

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={s.header}>
        <button onClick={() => router.push('/dashboard?tab=estimator&inner=bids')} style={s.back}>
          ← Estimating
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pkg.title}
          </h1>
        </div>
        <span style={s.badge(pkg.status)}>{BID_STATUS_LABELS[pkg.status] || pkg.status}</span>
        {daysUntilDue !== null && (
          <span style={{ fontSize: '12px', color: daysUntilDue < 3 ? '#c2410c' : '#6b7280', fontWeight: '600', whiteSpace: 'nowrap' }}>
            {daysUntilDue < 0 ? `${Math.abs(daysUntilDue)}d overdue` : daysUntilDue === 0 ? 'Due today' : `Due in ${daysUntilDue}d`}
          </span>
        )}
      </header>

      <main style={s.main}>
        {/* Meta row */}
        <div style={s.metaRow}>
          {[
            ['Owner', pkg.owner_name || '—'],
            ['Address', pkg.project_address || '—'],
            ['Deadline', fmtDate(pkg.due_date)],
            ['Status', BID_STATUS_LABELS[pkg.status] || pkg.status],
          ].map(([l, v]) => (
            <div key={l} style={s.metaItem}>
              <span style={s.mLabel}>{l}</span>
              <span style={s.mValue}>{v}</span>
            </div>
          ))}
          {pkg.description && (
            <div style={{ ...s.metaItem, flex: 1 }}>
              <span style={s.mLabel}>Description</span>
              <span style={{ ...s.mValue, fontSize: '12px', color: '#6b7280' }}>{pkg.description}</span>
            </div>
          )}
        </div>

        {/* Layout */}
        <div style={s.layout}>
          {/* Sidebar */}
          <aside style={s.aside}>
            {SECTIONS.map(sec => (
              <button key={sec.key} style={s.sideBtn(section === sec.key)} onClick={() => setSection(sec.key)}>
                {sec.label}
              </button>
            ))}
          </aside>

          {/* Content */}
          <div style={s.content}>
            {section === 'overview' && (
              <OverviewSection pkg={pkg} scopeItems={scopeItems} plans={plans} invitations={invitations} submissions={submissions} />
            )}
            {section === 'documents' && (
              <DocumentsSection bidId={id} plans={plans} reload={loadAll} canEdit={canEdit} />
            )}
            {section === 'scopes' && (
              <ScopesSection bidId={id} scopeItems={scopeItems} plans={plans} reload={loadAll} canEdit={canEdit} />
            )}
            {section === 'rfis' && (
              <RFIsSection bidId={id} rfis={rfis} rfiTableExists={rfiTableExists} reload={loadAll} canEdit={canEdit} profile={profile} />
            )}
            {section === 'invitations' && (
              <InvitationsSection bidId={id} pkg={pkg} plans={plans} invitations={invitations} submissions={submissions} scopeItems={scopeItems} profile={profile} reload={loadAll} canEdit={canEdit} />
            )}
            {section === 'leveling' && (
              <LevelingSection bidId={id} scopeItems={scopeItems} submissions={submissions} levelingEntries={levelingEntries} reload={loadAll} />
            )}
            {section === 'proposal' && (
              <ProposalSection pkg={pkg} bidId={id} scopeItems={scopeItems} submissions={submissions} profile={profile} reload={loadAll} />
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
