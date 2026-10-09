'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const STAGES = ['lead', 'quoted', 'contract_signed', 'order_placed', 'scheduled', 'installed', 'completed']

const STAGE_LABELS = {
  lead: 'Lead',
  quoted: 'Quoted',
  contract_signed: 'Contract Signed',
  order_placed: 'Order Placed',
  scheduled: 'Scheduled',
  installed: 'Installed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  on_hold: 'On Hold',
}

const STAGE_NEXT_LABEL = {
  lead: 'Mark as Quoted',
  quoted: 'Record Contract Signed',
  contract_signed: 'Mark Order Placed',
  order_placed: 'Mark Scheduled',
  scheduled: 'Mark as Installed',
  installed: 'Mark as Completed',
}

const STAGE_NEXT = {
  lead: 'quoted',
  quoted: 'contract_signed',
  contract_signed: 'order_placed',
  order_placed: 'scheduled',
  scheduled: 'installed',
  installed: 'completed',
}

const NEXT_ACTION = {
  lead: { text: 'Send a quote to the customer', responsible: 'salesperson' },
  quoted: { text: 'Obtain signed contract', responsible: 'salesperson' },
  contract_signed: { text: 'Place order with supplier', responsible: 'ops' },
  order_placed: { text: 'Confirm delivery date and schedule installation', responsible: 'ops' },
  scheduled: { text: 'Complete installation and confirm punch list', responsible: 'crew' },
  installed: { text: 'Final walkthrough and close out the order', responsible: 'ops' },
  completed: { text: 'Order is complete', responsible: '' },
  cancelled: { text: 'Order cancelled', responsible: '' },
  on_hold: { text: 'Resolve hold reason and reactivate', responsible: 'ops' },
}

const TABS = [
  'Overview', 'Scope & Products', 'Documents', 'Photos',
  'Schedule', 'Tasks', 'Updates', 'Customer Portal', 'History',
]

const CATEGORY_COLORS = {
  contract: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  quote:    { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  permit:   { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  photo:    { bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' },
  general:  { bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb' },
  other:    { bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb' },
}

const TASK_STATUS_STYLE = {
  open:        { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' },
  in_progress: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  done:        { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  cancelled:   { bg: '#f9fafb', color: '#9ca3af', border: '#e5e7eb' },
}

const TASK_STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled' }
const PRIORITY_COLORS = { low: '#9ca3af', normal: '#374151', high: '#dc2626' }

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function stageBadgeStyle(stage) {
  const map = {
    lead:             { bg: '#ede9fe', color: '#6366f1', border: '#c4b5fd' },
    quoted:           { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
    contract_signed:  { bg: '#eff6ff', color: '#0369a1', border: '#bfdbfe' },
    order_placed:     { bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' },
    scheduled:        { bg: '#f0fdfa', color: '#0f766e', border: '#99f6e4' },
    installed:        { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
    completed:        { bg: '#dcfce7', color: '#16a34a', border: '#86efac' },
    cancelled:        { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
    on_hold:          { bg: '#f9fafb', color: '#9ca3af', border: '#e5e7eb' },
  }
  const c = map[stage] || map.on_hold
  return {
    padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: '0.5px',
    background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    display: 'inline-block',
  }
}

function fmt(date) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(date) {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function currency(val) {
  if (val == null || val === '') return '—'
  const n = Number(val)
  if (isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

function stageIndex(s) {
  return STAGES.indexOf(s)
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const S = {
  page: { minHeight: '100vh', background: '#f4f6f8', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#111827' },

  // Header
  header: { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '56px', gap: '1rem' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 },
  headerRight: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  backBtn: { display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#6b7280', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', padding: '4px 8px', borderRadius: '4px', flexShrink: 0 },
  orderTitle: { fontSize: '15px', fontWeight: '700', color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  orderSub: { fontSize: '12px', color: '#6b7280', whiteSpace: 'nowrap' },
  unsavedBadge: { fontSize: '11px', fontWeight: '600', color: '#d97706', background: '#fffbeb', border: '1px solid #fcd34d', padding: '2px 8px', borderRadius: '4px', flexShrink: 0 },
  saveBtn: { padding: '7px 18px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', flexShrink: 0 },
  saveBtnDisabled: { padding: '7px 18px', background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'not-allowed', flexShrink: 0 },

  // Tab bar
  tabBar: { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem', position: 'sticky', top: '56px', zIndex: 90, overflowX: 'auto' },
  tabBarInner: { maxWidth: '1400px', margin: '0 auto', display: 'flex' },
  tab: (active) => ({
    padding: '12px 16px', fontSize: '13px', fontWeight: active ? '600' : '400', cursor: 'pointer',
    background: 'none', border: 'none', color: active ? '#111827' : '#6b7280',
    borderBottom: active ? '2px solid #e8590c' : '2px solid transparent',
    whiteSpace: 'nowrap', marginBottom: '-1px',
  }),

  // Layout
  main: { maxWidth: '1400px', margin: '0 auto', padding: '1.5rem' },

  // Cards
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  cardTitle: { fontSize: '11px', fontWeight: '600', color: '#6b7280', letterSpacing: '0.5px', textTransform: 'uppercase', marginTop: 0, marginBottom: '1rem' },

  // Grids
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' },
  grid4: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' },

  // Form
  label: { display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '5px' },
  input: { width: '100%', padding: '8px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui, -apple-system, sans-serif' },
  textarea: { width: '100%', padding: '8px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none', resize: 'vertical', minHeight: '80px', fontFamily: 'system-ui, -apple-system, sans-serif' },
  select: { width: '100%', padding: '8px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui, -apple-system, sans-serif' },

  // Buttons
  btn: { padding: '8px 18px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' },
  btnGray: { padding: '8px 18px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' },
  btnSmall: { padding: '5px 12px', background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' },
  btnSmallRed: { padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' },
  btnSmallGreen: { padding: '5px 12px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' },
  btnSmallBlue: { padding: '5px 12px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' },

  // Alerts
  successMsg: { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '1rem' },
  errorMsg: { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '1rem' },
  warnMsg: { background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '1rem' },

  // Misc
  emptyMsg: { fontSize: '13px', color: '#9ca3af', textAlign: 'center', padding: '2.5rem 1rem' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6' },
  divider: { height: '1px', background: '#f3f4f6', margin: '1rem 0' },
}

// ─────────────────────────────────────────────────────────────
// Micro-components
// ─────────────────────────────────────────────────────────────

function KVRow({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6', gap: '1rem' }}>
      <span style={{ fontSize: '13px', color: '#6b7280', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: '500', color: accent || '#111827', textAlign: 'right' }}>{value || '—'}</span>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  )
}

function CategoryBadge({ cat }) {
  const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.other
  return (
    <span style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '4px', background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>
      {cat}
    </span>
  )
}

function TaskStatusBadge({ status }) {
  const c = TASK_STATUS_STYLE[status] || TASK_STATUS_STYLE.open
  return (
    <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px', background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>
      {TASK_STATUS_LABELS[status] || status}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// Documents Panel
// ─────────────────────────────────────────────────────────────

function DocumentsPanel({ docs, orderId, authHeader, onRefresh, canEdit }) {
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const [category, setCategory] = useState('general')
  const [docNotes, setDocNotes] = useState('')
  const [visibleToCustomer, setVisibleToCustomer] = useState(false)
  const [sigModal, setSigModal] = useState(false)
  const [sigDocId, setSigDocId] = useState('')
  const [sigEmail, setSigEmail] = useState('')
  const [sigName, setSigName] = useState('')
  const [sigBusy, setSigBusy] = useState(false)
  const [sigErr, setSigErr] = useState('')
  const [sigSuccess, setSigSuccess] = useState('')
  const fileRef = useRef(null)

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setUploadErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('json', JSON.stringify({
        action: 'upload', order_id: orderId,
        category, notes: docNotes, visible_to_customer: visibleToCustomer,
      }))
      const headers = { ...authHeader() }
      delete headers['Content-Type']
      const res = await fetch('/api/sales-order-docs', { method: 'POST', headers, body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Upload failed')
      await onRefresh()
      setDocNotes('')
    } catch (err) {
      setUploadErr(err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function toggleVisibility(doc) {
    await fetch('/api/sales-order-docs', {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ action: 'toggle_customer_visibility', id: doc.id, visible_to_customer: !doc.visible_to_customer }),
    })
    await onRefresh()
  }

  async function openDoc(path) {
    const res = await fetch(`/api/sales-order-docs?signed_url=${encodeURIComponent(path)}`, { headers: authHeader() })
    const data = await res.json()
    if (data.url) window.open(data.url, '_blank')
  }

  async function submitSigRequest() {
    if (!sigDocId || !sigEmail.trim()) { setSigErr('Select a document and enter the signer email.'); return }
    setSigBusy(true)
    setSigErr('')
    try {
      const res = await fetch('/api/sales-order-docs', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'request_signature', order_id: orderId, doc_id: sigDocId, signer_email: sigEmail.trim(), signer_name: sigName.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to send signature request')
      setSigSuccess('Signature request sent.')
      setSigDocId('')
      setSigEmail('')
      setSigName('')
      setTimeout(() => { setSigModal(false); setSigSuccess('') }, 1500)
    } catch (e) {
      setSigErr(e.message)
    } finally {
      setSigBusy(false)
    }
  }

  return (
    <div>
      {canEdit && (
        <div style={{ ...S.card, background: '#f9fafb' }}>
          <div style={S.cardTitle}>Upload Document</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={S.label}>Category</label>
              <select style={{ ...S.select, width: '140px' }} value={category} onChange={e => setCategory(e.target.value)}>
                {['contract', 'quote', 'permit', 'general', 'other'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={S.label}>Notes (optional)</label>
              <input style={S.input} value={docNotes} onChange={e => setDocNotes(e.target.value)} placeholder="Version, description…" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '2px' }}>
              <input type="checkbox" id="vis_cust_doc" checked={visibleToCustomer} onChange={e => setVisibleToCustomer(e.target.checked)} />
              <label htmlFor="vis_cust_doc" style={{ fontSize: '13px', color: '#374151', cursor: 'pointer' }}>Customer visible</label>
            </div>
            <div>
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
              <button style={S.btn} onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Choose File'}
              </button>
            </div>
          </div>
          {uploadErr && <div style={{ ...S.errorMsg, marginTop: '10px', marginBottom: 0 }}>{uploadErr}</div>}
        </div>
      )}

      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ ...S.cardTitle, marginBottom: 0 }}>Documents ({docs.length})</div>
          {canEdit && (
            <button style={S.btnSmall} onClick={() => setSigModal(true)}>Request Signature</button>
          )}
        </div>
        {docs.length === 0 && <div style={S.emptyMsg}>No documents attached.</div>}
        {docs.map(doc => (
          <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
              <CategoryBadge cat={doc.category} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '14px', color: '#111827', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {doc.file_name}
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                  {doc.uploaded_by_name}{doc.uploaded_by_name && ' · '}{fmt(doc.created_at)}{doc.notes ? ` · ${doc.notes}` : ''}
                  {doc.version_number > 1 && ` · v${doc.version_number}`}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              {doc.visible_to_customer && (
                <span style={{ fontSize: '11px', fontWeight: '600', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '4px' }}>
                  Customer
                </span>
              )}
              {canEdit && (
                <button style={S.btnSmall} onClick={() => toggleVisibility(doc)}>
                  {doc.visible_to_customer ? 'Hide' : 'Share'}
                </button>
              )}
              <button style={S.btnSmallBlue} onClick={() => openDoc(doc.storage_path)}>Open</button>
            </div>
          </div>
        ))}
      </div>

      {/* Signature request modal */}
      {sigModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: '10px', padding: '1.75rem', width: '460px', maxWidth: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#111827', marginBottom: '1.25rem' }}>Request Signature</div>
            <div style={{ marginBottom: '12px' }}>
              <label style={S.label}>Document</label>
              <select style={S.select} value={sigDocId} onChange={e => setSigDocId(e.target.value)}>
                <option value="">Choose document…</option>
                {docs.map(d => <option key={d.id} value={d.id}>{d.file_name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={S.label}>Signer Name</label>
              <input style={S.input} value={sigName} onChange={e => setSigName(e.target.value)} placeholder="Customer Name" />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={S.label}>Signer Email</label>
              <input style={S.input} type="email" value={sigEmail} onChange={e => setSigEmail(e.target.value)} placeholder="signer@email.com" />
            </div>
            {sigErr && <div style={{ ...S.errorMsg, marginBottom: '12px' }}>{sigErr}</div>}
            {sigSuccess && <div style={{ ...S.successMsg, marginBottom: '12px' }}>{sigSuccess}</div>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button style={S.btnGray} onClick={() => { setSigModal(false); setSigErr(''); setSigSuccess('') }}>Cancel</button>
              <button style={S.btn} onClick={submitSigRequest} disabled={sigBusy || !sigDocId || !sigEmail.trim()}>
                {sigBusy ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Photos Panel
// ─────────────────────────────────────────────────────────────

function PhotosPanel({ docs, orderId, authHeader, onRefresh, canEdit }) {
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const [visibleToCustomer, setVisibleToCustomer] = useState(false)
  const fileRef = useRef(null)

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setUploadErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('json', JSON.stringify({ action: 'upload', order_id: orderId, category: 'photo', visible_to_customer: visibleToCustomer }))
      const headers = { ...authHeader() }
      delete headers['Content-Type']
      const res = await fetch('/api/sales-order-docs', { method: 'POST', headers, body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Upload failed')
      await onRefresh()
    } catch (err) {
      setUploadErr(err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function toggleVisibility(doc) {
    await fetch('/api/sales-order-docs', {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ action: 'toggle_customer_visibility', id: doc.id, visible_to_customer: !doc.visible_to_customer }),
    })
    await onRefresh()
  }

  async function openPhoto(path) {
    const res = await fetch(`/api/sales-order-docs?signed_url=${encodeURIComponent(path)}`, { headers: authHeader() })
    const data = await res.json()
    if (data.url) window.open(data.url, '_blank')
  }

  return (
    <div>
      {canEdit && (
        <div style={{ ...S.card, background: '#f9fafb', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" id="photo_vis" checked={visibleToCustomer} onChange={e => setVisibleToCustomer(e.target.checked)} />
              <label htmlFor="photo_vis" style={{ fontSize: '13px', color: '#374151', cursor: 'pointer' }}>Share with customer</label>
            </div>
            <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleUpload} />
            <button style={S.btn} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : '+ Upload Photo'}
            </button>
          </div>
          {uploadErr && <div style={{ ...S.errorMsg, marginTop: '10px', marginBottom: 0 }}>{uploadErr}</div>}
        </div>
      )}

      {docs.length === 0 && (
        <div style={{ ...S.card, ...S.emptyMsg }}>No photos yet. Upload the first one above.</div>
      )}

      {docs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {docs.map(doc => (
            <div key={doc.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div
                style={{ height: '150px', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '40px', userSelect: 'none' }}
                onClick={() => openPhoto(doc.storage_path)}
                title="Click to open"
              >
                🖼
              </div>
              <div style={{ padding: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: '500', color: '#111827', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {doc.file_name}
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>{fmt(doc.created_at)}</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {doc.visible_to_customer && (
                    <span style={{ fontSize: '10px', fontWeight: '600', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', padding: '2px 6px', borderRadius: '3px' }}>
                      Customer
                    </span>
                  )}
                  {canEdit && (
                    <button style={{ ...S.btnSmall, fontSize: '11px', padding: '3px 8px' }} onClick={() => toggleVisibility(doc)}>
                      {doc.visible_to_customer ? 'Hide' : 'Share'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Tasks Panel
// ─────────────────────────────────────────────────────────────

function TasksPanel({ tasks, orderId, authHeader, onRefresh, canEdit }) {
  const [adding, setAdding] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', assignee_name: '', due_date: '', priority: 'normal' })
  const [busyIds, setBusyIds] = useState(new Set())
  const [err, setErr] = useState('')

  const today = new Date().toISOString().slice(0, 10)

  async function createTask() {
    if (!newTask.title.trim()) { setErr('Task title is required.'); return }
    setErr('')
    try {
      const res = await fetch('/api/sales-order-tasks', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'create', order_id: orderId, ...newTask, title: newTask.title.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to create task')
      await onRefresh()
      setNewTask({ title: '', assignee_name: '', due_date: '', priority: 'normal' })
      setAdding(false)
    } catch (e) {
      setErr(e.message)
    }
  }

  async function updateTaskStatus(task, status) {
    setBusyIds(prev => new Set([...prev, task.id]))
    try {
      await fetch('/api/sales-order-tasks', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          action: 'update', id: task.id,
          fields: { status, completed_at: status === 'done' ? new Date().toISOString() : null },
        }),
      })
      await onRefresh()
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(task.id); return n })
    }
  }

  const grouped = {
    open: tasks.filter(t => t.status === 'open'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    done: tasks.filter(t => t.status === 'done'),
    cancelled: tasks.filter(t => t.status === 'cancelled'),
  }

  function TaskRow({ task }) {
    const overdue = task.due_date && task.due_date < today && task.status !== 'done' && task.status !== 'cancelled'
    const busy = busyIds.has(task.id)
    const isDone = task.status === 'done' || task.status === 'cancelled'

    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #f3f4f6', background: overdue ? '#fff8f8' : '#fff', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0, flex: 1 }}>
          {canEdit && !isDone && (
            <input
              type="checkbox"
              checked={false}
              onChange={() => updateTaskStatus(task, 'done')}
              disabled={busy}
              style={{ marginTop: '3px', cursor: 'pointer', width: '15px', height: '15px', flexShrink: 0 }}
            />
          )}
          {isDone && <span style={{ fontSize: '15px', flexShrink: 0, marginTop: '1px' }}>✓</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '14px', color: isDone ? '#9ca3af' : '#111827', fontWeight: '500', textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
              {task.title}
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {task.assignee_name && <span>{task.assignee_name}</span>}
              {task.due_date && (
                <span style={{ color: overdue ? '#dc2626' : '#9ca3af' }}>
                  Due {fmt(task.due_date + 'T00:00:00')}
                  {overdue && ' — Overdue'}
                </span>
              )}
              {task.priority !== 'normal' && (
                <span style={{ color: PRIORITY_COLORS[task.priority], fontWeight: '600', textTransform: 'capitalize' }}>
                  {task.priority} priority
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <TaskStatusBadge status={task.status} />
          {canEdit && task.status === 'open' && (
            <button style={S.btnSmall} onClick={() => updateTaskStatus(task, 'in_progress')} disabled={busy}>
              Start
            </button>
          )}
          {canEdit && task.status === 'in_progress' && (
            <button style={S.btnSmallGreen} onClick={() => updateTaskStatus(task, 'done')} disabled={busy}>
              Done
            </button>
          )}
        </div>
      </div>
    )
  }

  const GROUP_LABELS = { open: 'Open', in_progress: 'In Progress', done: 'Completed', cancelled: 'Cancelled' }

  return (
    <div>
      {canEdit && (
        <div style={{ marginBottom: '1rem' }}>
          {!adding ? (
            <button style={S.btn} onClick={() => setAdding(true)}>+ Add Task</button>
          ) : (
            <div style={{ ...S.card, background: '#f9fafb' }}>
              <div style={S.cardTitle}>New Task</div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <Field label="Title *">
                  <input style={S.input} value={newTask.title} onChange={e => setNewTask(t => ({ ...t, title: e.target.value }))} placeholder="What needs to be done?" />
                </Field>
                <Field label="Assigned To">
                  <input style={S.input} value={newTask.assignee_name} onChange={e => setNewTask(t => ({ ...t, assignee_name: e.target.value }))} placeholder="Name" />
                </Field>
                <Field label="Due Date">
                  <input style={S.input} type="date" value={newTask.due_date} onChange={e => setNewTask(t => ({ ...t, due_date: e.target.value }))} />
                </Field>
                <Field label="Priority">
                  <select style={S.select} value={newTask.priority} onChange={e => setNewTask(t => ({ ...t, priority: e.target.value }))}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </Field>
              </div>
              {err && <div style={{ ...S.errorMsg, marginBottom: '10px' }}>{err}</div>}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={S.btn} onClick={createTask}>Create Task</button>
                <button style={S.btnGray} onClick={() => { setAdding(false); setErr('') }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tasks.length === 0 && (
        <div style={{ ...S.card, ...S.emptyMsg }}>No tasks yet. Add one above to track action items.</div>
      )}

      {['open', 'in_progress', 'done', 'cancelled'].map(status => {
        const group = grouped[status]
        if (group.length === 0) return null
        return (
          <div key={status} style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '9px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              {GROUP_LABELS[status]} ({group.length})
            </div>
            {group.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Updates Panel
// ─────────────────────────────────────────────────────────────

function UpdatesPanel({ updates, orderId, authHeader, onRefresh, canEdit }) {
  const [body, setBody] = useState('')
  const [shareWithCustomer, setShareWithCustomer] = useState(false)
  const [posting, setPosting] = useState(false)
  const [err, setErr] = useState('')

  async function postUpdate() {
    if (!body.trim()) return
    setPosting(true)
    setErr('')
    try {
      const res = await fetch('/api/sales-order-updates', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'create', order_id: orderId, body: body.trim(), visible_to_customer: shareWithCustomer }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to post update')
      await onRefresh()
      setBody('')
      setShareWithCustomer(false)
    } catch (e) {
      setErr(e.message)
    } finally {
      setPosting(false)
    }
  }

  const sorted = [...updates].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  return (
    <div>
      {canEdit && (
        <div style={S.card}>
          <div style={S.cardTitle}>Post Update</div>
          <textarea
            style={{ ...S.textarea, marginBottom: '10px', minHeight: '90px' }}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write a note, milestone update, or message…"
          />
          {err && <div style={{ ...S.errorMsg, marginBottom: '10px' }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={shareWithCustomer} onChange={e => setShareWithCustomer(e.target.checked)} />
              Share with customer
            </label>
            <button style={S.btn} onClick={postUpdate} disabled={posting || !body.trim()}>
              {posting ? 'Posting…' : 'Post Update'}
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 && (
        <div style={{ ...S.card, ...S.emptyMsg }}>No updates yet.</div>
      )}

      {sorted.map(u => (
        <div key={u.id} style={{
          ...S.card,
          background: u.visible_to_customer ? '#fff' : '#f9fafb',
          border: `1px solid ${u.visible_to_customer ? '#e5e7eb' : '#f3f4f6'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#111827' }}>{u.author_name || 'Team'}</span>
              {u.visible_to_customer ? (
                <span style={{ fontSize: '11px', fontWeight: '600', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '4px' }}>
                  Customer visible
                </span>
              ) : (
                <span style={{ fontSize: '11px', fontWeight: '600', background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb', padding: '2px 8px', borderRadius: '4px' }}>
                  Internal
                </span>
              )}
              {u.update_type && u.update_type !== 'note' && (
                <span style={{ fontSize: '11px', color: '#9ca3af', background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px', textTransform: 'capitalize' }}>
                  {u.update_type.replace('_', ' ')}
                </span>
              )}
            </div>
            <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtTime(u.created_at)}</span>
          </div>
          <div style={{ fontSize: '14px', color: '#374151', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{u.body}</div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Customer Portal Panel
// ─────────────────────────────────────────────────────────────

function CustomerPortalPanel({ accesses, orderId, authHeader, onRefresh, canEdit }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [inviting, setInviting] = useState(false)
  const [err, setErr] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function invite() {
    if (!email.trim()) { setErr('Email is required.'); return }
    setInviting(true)
    setErr('')
    setSuccessMsg('')
    try {
      const res = await fetch('/api/customer-portal', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'invite', order_id: orderId, email: email.trim(), name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to send invitation')
      await onRefresh()
      setEmail('')
      setName('')
      setSuccessMsg('Invitation sent successfully.')
      setTimeout(() => setSuccessMsg(''), 4000)
    } catch (e) {
      setErr(e.message)
    } finally {
      setInviting(false)
    }
  }

  async function revoke(a) {
    if (!window.confirm(`Revoke portal access for ${a.email}?`)) return
    await fetch('/api/customer-portal', {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ action: 'revoke', id: a.id }),
    })
    await onRefresh()
  }

  const active = accesses.filter(a => !a.revoked_at)
  const revoked = accesses.filter(a => !!a.revoked_at)

  return (
    <div>
      <div style={{ ...S.card, background: '#eff6ff', border: '1px solid #bfdbfe', marginBottom: '1rem' }}>
        <div style={{ fontSize: '13px', color: '#1e40af', lineHeight: '1.6' }}>
          Customers receive a private link to view their order details, documents you've shared with them, and updates marked as customer-visible. They do not log into the main portal.
        </div>
      </div>

      {canEdit && (
        <div style={S.card}>
          <div style={S.cardTitle}>Invite Customer</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '12px', alignItems: 'flex-end' }}>
            <Field label="Email *">
              <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@email.com" />
            </Field>
            <Field label="Name">
              <input style={S.input} value={name} onChange={e => setName(e.target.value)} placeholder="Customer Name" />
            </Field>
            <button style={S.btn} onClick={invite} disabled={inviting || !email.trim()}>
              {inviting ? 'Sending…' : 'Send Invitation'}
            </button>
          </div>
          {err && <div style={{ ...S.errorMsg, marginTop: '10px', marginBottom: 0 }}>{err}</div>}
          {successMsg && <div style={{ ...S.successMsg, marginTop: '10px', marginBottom: 0 }}>{successMsg}</div>}
        </div>
      )}

      <div style={S.card}>
        <div style={{ ...S.cardTitle, marginBottom: active.length === 0 ? '0' : '0.5rem' }}>Active Access ({active.length})</div>
        {active.length === 0 && <div style={{ ...S.emptyMsg, padding: '1.5rem 0 0' }}>No active portal access.</div>}
        {active.map(a => (
          <div key={a.id} style={{ ...S.row }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '500', color: '#111827' }}>{a.name || '(no name)'}</div>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                {a.email} · Invited {fmt(a.invited_at)}
                {a.last_accessed_at && <> · Last accessed {fmt(a.last_accessed_at)}</>}
              </div>
            </div>
            {canEdit && (
              <button style={S.btnSmallRed} onClick={() => revoke(a)}>Revoke</button>
            )}
          </div>
        ))}
      </div>

      {revoked.length > 0 && (
        <div style={{ ...S.card }}>
          <div style={S.cardTitle}>Revoked Access</div>
          {revoked.map(a => (
            <div key={a.id} style={{ ...S.row, opacity: 0.55 }}>
              <div>
                <div style={{ fontSize: '14px', color: '#374151' }}>{a.name || '(no name)'} — {a.email}</div>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>Revoked {fmt(a.revoked_at)}</div>
              </div>
              <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '600' }}>Revoked</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────

export default function SalesOrderDetailPage() {
  const { id } = useParams()
  const router = useRouter()

  const [profile, setProfile] = useState(null)
  const [order, setOrder] = useState(null)
  const [docs, setDocs] = useState([])
  const [tasks, setTasks] = useState([])
  const [updates, setUpdates] = useState([])
  const [portalAccesses, setPortalAccesses] = useState([])

  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [activeTab, setActiveTab] = useState('Overview')
  const [unsaved, setUnsaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')

  // Draft mirrors all editable fields
  const [draft, setDraft] = useState({})

  const tokenRef = useRef(null)

  const authHeader = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenRef.current}`,
  }), [])

  // ── Load ──────────────────────────────────────────────────

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    tokenRef.current = session.access_token

    const [
      { data: prof },
      orderRes,
      docsRes,
      tasksRes,
      updatesRes,
      portalRes,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      fetch(`/api/sales-orders?id=${id}`).then(r => r.json()).catch(() => ({ data: null })),
      fetch(`/api/sales-order-docs?order_id=${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } }).then(r => r.json()).catch(() => ({ docs: [] })),
      fetch(`/api/sales-order-tasks?order_id=${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } }).then(r => r.json()).catch(() => ({ tasks: [] })),
      fetch(`/api/sales-order-updates?order_id=${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } }).then(r => r.json()).catch(() => ({ updates: [] })),
      fetch(`/api/customer-portal?order_id=${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } }).then(r => r.json()).catch(() => ({ accesses: [] })),
    ])

    if (!orderRes.data) {
      setPageError('Order not found.')
      setLoading(false)
      return
    }

    const o = orderRes.data

    setOrder(o)
    setDraft({
      // Customer info
      customer_name: o.customer_name || '',
      customer_company: o.customer_company || '',
      customer_email: o.customer_email || '',
      customer_phone: o.customer_phone || '',
      site_address: o.site_address || '',
      city: o.city || '',
      state: o.state || '',
      zip: o.zip || '',
      // Scope
      scope_description: o.scope_description || '',
      exclusions: o.exclusions || '',
      products: Array.isArray(o.products) ? o.products : [],
      options: Array.isArray(o.options) ? o.options : [],
      // Metal buildings
      width_ft: o.width_ft ?? '',
      length_ft: o.length_ft ?? '',
      height_ft: o.height_ft ?? '',
      building_use: o.building_use || '',
      // Roofing
      roof_type: o.roof_type || '',
      roof_size_sqft: o.roof_size_sqft ?? '',
      building_type: o.building_type || '',
      // Financials
      quoted_amount: o.quoted_amount ?? '',
      contract_value: o.contract_value ?? '',
      internal_cost: o.internal_cost ?? '',
      estimated_profit: o.estimated_profit ?? '',
      deposit_amount: o.deposit_amount ?? '',
      deposit_received: !!o.deposit_received,
      deposit_received_date: o.deposit_received_date || '',
      // Schedule
      supplier_ref: o.supplier_ref || '',
      supplier_order_confirmation: o.supplier_order_confirmation || '',
      supplier_order_placed_at: o.supplier_order_placed_at ? o.supplier_order_placed_at.slice(0, 10) : '',
      expected_delivery_date: o.expected_delivery_date || '',
      confirmed_delivery_date: o.confirmed_delivery_date || '',
      delivery_notes: o.delivery_notes || '',
      expected_install_date: o.expected_install_date || '',
      confirmed_install_date: o.confirmed_install_date || '',
      install_notes: o.install_notes || '',
      install_crew: o.install_crew || '',
      // Internal notes (overview)
      internal_notes: o.internal_notes || '',
    })

    setDocs(docsRes.docs || [])
    setTasks(tasksRes.tasks || [])
    setUpdates(updatesRes.updates || [])
    setPortalAccesses(portalRes.accesses || [])
    setProfile({ ...(prof || {}), id: session.user.id, email: session.user.email })
    setLoading(false)
    setUnsaved(false)
  }, [id, router])

  useEffect(() => { load() }, [load])

  // ── Permissions ───────────────────────────────────────────

  const canEdit = Boolean(profile && ['pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'].includes(profile.role))
  const showFinancials = Boolean(profile && ['pm', 'apm', 'admin'].includes(profile.role))

  // ── Draft helpers ─────────────────────────────────────────

  function setField(key, val) {
    setDraft(d => ({ ...d, [key]: val }))
    setUnsaved(true)
  }

  // ── Save ──────────────────────────────────────────────────

  async function save() {
    if (!canEdit) return
    setSaving(true)
    setSaveMsg('')
    setSaveErr('')
    try {
      const res = await fetch('/api/sales-orders', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'update', id, fields: draft }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed')
      await load()
      setSaveMsg('Saved')
      setUnsaved(false)
      setTimeout(() => setSaveMsg(''), 2500)
    } catch (e) {
      setSaveErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Stage advance ─────────────────────────────────────────

  async function advanceStage() {
    if (!order) return
    const next = STAGE_NEXT[order.stage]
    if (!next) return
    if (!window.confirm(`Move this order to "${STAGE_LABELS[next]}"?`)) return
    setSaveErr('')
    try {
      const res = await fetch('/api/sales-orders', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'set_stage', id, stage: next }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Stage update failed')
      await load()
    } catch (e) {
      setSaveErr(e.message)
    }
  }

  // ── Loading / error ───────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ color: '#9ca3af', fontSize: '14px' }}>Loading order…</div>
      </div>
    )
  }

  if (pageError) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ color: '#dc2626', fontSize: '14px' }}>{pageError}</div>
        <button style={S.btnGray} onClick={() => router.push('/sales')}>← Back to Sales</button>
      </div>
    )
  }

  // ── Tab renderers ─────────────────────────────────────────

  function renderOverview() {
    const si = stageIndex(order.stage)
    const na = NEXT_ACTION[order.stage] || {}
    const responsibleName =
      na.responsible === 'salesperson' ? (order.salesperson_name || 'Salesperson') :
      na.responsible === 'ops' ? (order.ops_owner_name || 'Ops Owner') :
      na.responsible === 'crew' ? (order.install_crew || 'Install Crew') : ''

    const warnings = []
    if (si >= stageIndex('contract_signed') && !order.contract_value) warnings.push('No contract value recorded')
    if (si >= stageIndex('order_placed') && !order.expected_delivery_date) warnings.push('No expected delivery date set')
    if (si >= stageIndex('scheduled') && !order.confirmed_install_date) warnings.push('No confirmed install date')
    if (!order.customer_email) warnings.push('No customer email on file')
    if (si >= stageIndex('contract_signed') && !order.contract_signed_at) warnings.push('Contract signed date not recorded')

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
        <div>
          {/* Next Action */}
          {order.stage !== 'completed' && order.stage !== 'cancelled' && (
            <div style={{ ...S.card, borderLeft: '4px solid #e8590c' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#e8590c', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '8px' }}>
                Next Action
              </div>
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>{na.text}</div>
              {responsibleName && (
                <div style={{ fontSize: '13px', color: '#6b7280' }}>Responsible: <strong style={{ color: '#374151' }}>{responsibleName}</strong></div>
              )}
              {canEdit && STAGE_NEXT[order.stage] && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #f3f4f6' }}>
                  <button style={S.btn} onClick={advanceStage}>{STAGE_NEXT_LABEL[order.stage]}</button>
                </div>
              )}
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div style={{ ...S.card, background: '#fffbeb', border: '1px solid #fcd34d' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#d97706', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '10px' }}>
                Missing Information
              </div>
              {warnings.map(w => (
                <div key={w} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '13px', color: '#92400e' }}>
                  <span style={{ flexShrink: 0 }}>⚠</span>
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Key Info */}
          <div style={S.card}>
            <div style={S.cardTitle}>Key Information</div>
            <div style={S.grid2}>
              <div>
                <KVRow label="Stage" value={<span style={stageBadgeStyle(order.stage)}>{STAGE_LABELS[order.stage] || order.stage}</span>} />
                <KVRow label="Division" value={order.division === 'metal_buildings' ? 'Metal Buildings' : order.division === 'commercial_roofing' ? 'Commercial Roofing' : order.division} />
                <KVRow label="Salesperson" value={order.salesperson_name} />
                <KVRow label="Ops Owner" value={order.ops_owner_name} />
              </div>
              <div>
                <KVRow label="Quoted Amount" value={currency(order.quoted_amount)} accent="#0369a1" />
                <KVRow label="Contract Value" value={currency(order.contract_value)} accent="#15803d" />
                {showFinancials && <KVRow label="Internal Cost" value={currency(order.internal_cost)} />}
                {showFinancials && (
                  <KVRow
                    label="Est. Profit"
                    value={currency(order.estimated_profit)}
                    accent={Number(order.estimated_profit) > 0 ? '#15803d' : '#dc2626'}
                  />
                )}
                {showFinancials && order.deposit_amount && (
                  <KVRow
                    label="Deposit"
                    value={`${currency(order.deposit_amount)}${order.deposit_received ? ' ✓' : ' (pending)'}`}
                    accent={order.deposit_received ? '#15803d' : '#d97706'}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div style={S.card}>
            <div style={S.cardTitle}>Timeline</div>
            <KVRow label="Created" value={fmt(order.created_at)} />
            <KVRow label="Won" value={fmt(order.won_at)} />
            <KVRow label="Contract Signed" value={fmt(order.contract_signed_at)} />
            {order.contract_signed_by && <KVRow label="Signed By" value={order.contract_signed_by} />}
            <KVRow label="Supplier Order Placed" value={fmt(order.supplier_order_placed_at)} />
            {order.supplier_order_confirmation && <KVRow label="Supplier Confirmation" value={order.supplier_order_confirmation} />}
            <KVRow label="Expected Delivery" value={fmt(order.expected_delivery_date)} />
            <KVRow label="Confirmed Delivery" value={fmt(order.confirmed_delivery_date)} />
            <KVRow label="Expected Install" value={fmt(order.expected_install_date)} />
            <KVRow label="Confirmed Install" value={fmt(order.confirmed_install_date)} />
            {order.completed_at && <KVRow label="Completed" value={fmt(order.completed_at)} />}
            {order.cancelled_at && <KVRow label="Cancelled" value={fmt(order.cancelled_at)} />}
          </div>
        </div>

        {/* Right column */}
        <div>
          {/* Customer */}
          <div style={S.card}>
            <div style={S.cardTitle}>Customer</div>
            <KVRow label="Name" value={order.customer_name} />
            {order.customer_company && <KVRow label="Company" value={order.customer_company} />}
            {order.customer_email && (
              <KVRow label="Email" value={<a href={`mailto:${order.customer_email}`} style={{ color: '#0369a1', textDecoration: 'none', fontSize: '13px' }}>{order.customer_email}</a>} />
            )}
            {order.customer_phone && (
              <KVRow label="Phone" value={<a href={`tel:${order.customer_phone}`} style={{ color: '#0369a1', textDecoration: 'none', fontSize: '13px' }}>{order.customer_phone}</a>} />
            )}
            {(order.site_address || order.city) && (
              <>
                <div style={S.divider} />
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Site Address</div>
                <div style={{ fontSize: '13px', color: '#111827', lineHeight: '1.5' }}>
                  {[order.site_address, [order.city, order.state].filter(Boolean).join(', '), order.zip].filter(Boolean).join('\n')}
                </div>
              </>
            )}
          </div>

          {/* Internal Notes */}
          {canEdit && (
            <div style={S.card}>
              <div style={S.cardTitle}>Internal Notes</div>
              <textarea
                style={{ ...S.textarea, minHeight: '120px' }}
                value={draft.internal_notes}
                onChange={e => setField('internal_notes', e.target.value)}
                placeholder="Notes visible only to your team…"
              />
            </div>
          )}

          {/* Cancelled reason */}
          {order.stage === 'cancelled' && order.cancelled_reason && (
            <div style={{ ...S.card, background: '#fef2f2', border: '1px solid #fecaca' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#dc2626', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '8px' }}>
                Cancellation Reason
              </div>
              <div style={{ fontSize: '13px', color: '#374151' }}>{order.cancelled_reason}</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderScopeProducts() {
    const isMetal = order.division === 'metal_buildings'
    const isRoofing = order.division === 'commercial_roofing'

    function addProduct() {
      setField('products', [...draft.products, { name: '', qty: 1, unit: 'ea', unit_price: '', description: '' }])
    }
    function removeProduct(i) {
      const p = [...draft.products]
      p.splice(i, 1)
      setField('products', p)
    }
    function updateProduct(i, key, val) {
      const p = draft.products.map((row, idx) => idx === i ? { ...row, [key]: val } : row)
      setField('products', p)
    }
    function addOption() {
      setField('options', [...draft.options, { name: '', included: false, notes: '' }])
    }
    function removeOption(i) {
      const o = [...draft.options]
      o.splice(i, 1)
      setField('options', o)
    }
    function updateOption(i, key, val) {
      const o = draft.options.map((row, idx) => idx === i ? { ...row, [key]: val } : row)
      setField('options', o)
    }

    const productTotal = (draft.products || []).reduce((sum, p) => sum + (Number(p.qty || 0) * Number(p.unit_price || 0)), 0)

    return (
      <div>
        {/* Customer Info */}
        <div style={S.card}>
          <div style={S.cardTitle}>Customer Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Customer Name">
              <input style={S.input} value={draft.customer_name} onChange={e => setField('customer_name', e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Company">
              <input style={S.input} value={draft.customer_company} onChange={e => setField('customer_company', e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Email">
              <input style={S.input} type="email" value={draft.customer_email} onChange={e => setField('customer_email', e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Phone">
              <input style={S.input} type="tel" value={draft.customer_phone} onChange={e => setField('customer_phone', e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Site Address">
              <input style={S.input} value={draft.site_address} onChange={e => setField('site_address', e.target.value)} disabled={!canEdit} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
              <Field label="City">
                <input style={S.input} value={draft.city} onChange={e => setField('city', e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="State">
                <input style={S.input} value={draft.state} onChange={e => setField('state', e.target.value)} disabled={!canEdit} maxLength={2} />
              </Field>
              <Field label="ZIP">
                <input style={S.input} value={draft.zip} onChange={e => setField('zip', e.target.value)} disabled={!canEdit} />
              </Field>
            </div>
          </div>
        </div>

        {/* Scope */}
        <div style={S.card}>
          <div style={S.cardTitle}>Scope of Work</div>
          <Field label="Scope Description">
            <textarea style={{ ...S.textarea, minHeight: '120px' }} value={draft.scope_description} onChange={e => setField('scope_description', e.target.value)} disabled={!canEdit} placeholder="Describe the full scope of work…" />
          </Field>
          <div style={{ marginTop: '12px' }}>
            <Field label="Exclusions">
              <textarea style={{ ...S.textarea, minHeight: '60px' }} value={draft.exclusions} onChange={e => setField('exclusions', e.target.value)} disabled={!canEdit} placeholder="List any items excluded from this scope…" />
            </Field>
          </div>
        </div>

        {/* Division-specific specs */}
        {isMetal && (
          <div style={S.card}>
            <div style={S.cardTitle}>Building Specifications</div>
            <div style={S.grid4}>
              <Field label="Width (ft)">
                <input style={S.input} type="number" step="0.5" value={draft.width_ft} onChange={e => setField('width_ft', e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Length (ft)">
                <input style={S.input} type="number" step="0.5" value={draft.length_ft} onChange={e => setField('length_ft', e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Height (ft)">
                <input style={S.input} type="number" step="0.5" value={draft.height_ft} onChange={e => setField('height_ft', e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Building Use">
                <input style={S.input} value={draft.building_use} onChange={e => setField('building_use', e.target.value)} disabled={!canEdit} placeholder="Storage, shop, garage…" />
              </Field>
            </div>
            {draft.width_ft && draft.length_ft && (
              <div style={{ marginTop: '10px', fontSize: '13px', color: '#6b7280' }}>
                Footprint: {Number(draft.width_ft) * Number(draft.length_ft)} sq ft
              </div>
            )}
          </div>
        )}

        {isRoofing && (
          <div style={S.card}>
            <div style={S.cardTitle}>Roofing Specifications</div>
            <div style={S.grid3}>
              <Field label="Roof Type">
                <input style={S.input} value={draft.roof_type} onChange={e => setField('roof_type', e.target.value)} disabled={!canEdit} placeholder="TPO, metal, modified bitumen…" />
              </Field>
              <Field label="Roof Size (sqft)">
                <input style={S.input} type="number" value={draft.roof_size_sqft} onChange={e => setField('roof_size_sqft', e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Building Type">
                <input style={S.input} value={draft.building_type} onChange={e => setField('building_type', e.target.value)} disabled={!canEdit} placeholder="Warehouse, office, retail…" />
              </Field>
            </div>
          </div>
        )}

        {/* Products */}
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={S.cardTitle}>Products / Line Items</div>
            {canEdit && <button style={S.btnSmall} onClick={addProduct}>+ Add Item</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 60px 80px 110px 2fr 36px', gap: '6px', padding: '6px 8px', background: '#f9fafb', borderRadius: '4px', marginBottom: '4px' }}>
            {['Name', 'Qty', 'Unit', 'Unit Price', 'Description', ''].map((h, i) => (
              <span key={i} style={{ fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</span>
            ))}
          </div>
          {draft.products.length === 0 && <div style={S.emptyMsg}>No products added.</div>}
          {draft.products.map((prod, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 60px 80px 110px 2fr 36px', gap: '6px', marginBottom: '4px', alignItems: 'center' }}>
              <input style={S.input} value={prod.name} onChange={e => updateProduct(i, 'name', e.target.value)} disabled={!canEdit} placeholder="Item name" />
              <input style={S.input} type="number" min="0" value={prod.qty} onChange={e => updateProduct(i, 'qty', e.target.value)} disabled={!canEdit} />
              <input style={S.input} value={prod.unit} onChange={e => updateProduct(i, 'unit', e.target.value)} disabled={!canEdit} placeholder="ea" />
              <input style={S.input} type="number" min="0" step="0.01" value={prod.unit_price} onChange={e => updateProduct(i, 'unit_price', e.target.value)} disabled={!canEdit} placeholder="0.00" />
              <input style={S.input} value={prod.description || ''} onChange={e => updateProduct(i, 'description', e.target.value)} disabled={!canEdit} placeholder="Description" />
              {canEdit
                ? <button style={{ ...S.btnSmallRed, padding: '5px 8px' }} onClick={() => removeProduct(i)}>✕</button>
                : <div />
              }
            </div>
          ))}
          {draft.products.length > 0 && (
            <div style={{ marginTop: '10px', textAlign: 'right', fontSize: '14px', fontWeight: '700', color: '#111827', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
              Total: {currency(productTotal)}
            </div>
          )}
        </div>

        {/* Options */}
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={S.cardTitle}>Options / Upgrades</div>
            {canEdit && <button style={S.btnSmall} onClick={addOption}>+ Add Option</button>}
          </div>
          {draft.options.length === 0 && <div style={S.emptyMsg}>No options added.</div>}
          {draft.options.map((opt, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 110px 3fr 36px', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
              <input style={S.input} value={opt.name} onChange={e => updateOption(i, 'name', e.target.value)} disabled={!canEdit} placeholder="Option name" />
              <select style={S.select} value={opt.included ? 'yes' : 'no'} onChange={e => updateOption(i, 'included', e.target.value === 'yes')} disabled={!canEdit}>
                <option value="yes">Included</option>
                <option value="no">Not included</option>
              </select>
              <input style={S.input} value={opt.notes || ''} onChange={e => updateOption(i, 'notes', e.target.value)} disabled={!canEdit} placeholder="Notes, price delta…" />
              {canEdit
                ? <button style={{ ...S.btnSmallRed, padding: '5px 8px' }} onClick={() => removeOption(i)}>✕</button>
                : <div />
              }
            </div>
          ))}
        </div>

        {/* Financials — internal only */}
        {showFinancials && (
          <div style={S.card}>
            <div style={S.cardTitle}>Financials (Internal)</div>
            <div style={S.grid3}>
              <Field label="Quoted Amount">
                <input style={S.input} type="number" min="0" step="0.01" value={draft.quoted_amount} onChange={e => setField('quoted_amount', e.target.value)} disabled={!canEdit} placeholder="0.00" />
              </Field>
              <Field label="Contract Value">
                <input style={S.input} type="number" min="0" step="0.01" value={draft.contract_value} onChange={e => setField('contract_value', e.target.value)} disabled={!canEdit} placeholder="0.00" />
              </Field>
              <Field label="Internal Cost">
                <input style={S.input} type="number" min="0" step="0.01" value={draft.internal_cost} onChange={e => setField('internal_cost', e.target.value)} disabled={!canEdit} placeholder="0.00" />
              </Field>
              <Field label="Est. Profit">
                <input style={S.input} type="number" step="0.01" value={draft.estimated_profit} onChange={e => setField('estimated_profit', e.target.value)} disabled={!canEdit} placeholder="0.00" />
              </Field>
              <Field label="Deposit Amount">
                <input style={S.input} type="number" min="0" step="0.01" value={draft.deposit_amount} onChange={e => setField('deposit_amount', e.target.value)} disabled={!canEdit} placeholder="0.00" />
              </Field>
              <Field label="Deposit Received Date">
                <input style={S.input} type="date" value={draft.deposit_received_date} onChange={e => setField('deposit_received_date', e.target.value)} disabled={!canEdit} />
              </Field>
            </div>
            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" id="dep_recv" checked={draft.deposit_received} onChange={e => setField('deposit_received', e.target.checked)} disabled={!canEdit} />
              <label htmlFor="dep_recv" style={{ fontSize: '13px', color: '#374151', cursor: canEdit ? 'pointer' : 'default' }}>Deposit received</label>
            </div>
            {draft.contract_value && draft.internal_cost && (
              <div style={{ marginTop: '12px', padding: '10px 14px', background: '#f9fafb', borderRadius: '6px', fontSize: '13px', color: '#374151' }}>
                Margin: {currency(Number(draft.contract_value) - Number(draft.internal_cost))}
                {Number(draft.contract_value) > 0 && (
                  <span style={{ marginLeft: '8px', color: '#6b7280' }}>
                    ({((Number(draft.contract_value) - Number(draft.internal_cost)) / Number(draft.contract_value) * 100).toFixed(1)}%)
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  function renderDocuments() {
    return (
      <DocumentsPanel
        docs={docs.filter(d => d.category !== 'photo')}
        orderId={id}
        authHeader={authHeader}
        onRefresh={load}
        canEdit={canEdit}
      />
    )
  }

  function renderPhotos() {
    return (
      <PhotosPanel
        docs={docs.filter(d => d.category === 'photo')}
        orderId={id}
        authHeader={authHeader}
        onRefresh={load}
        canEdit={canEdit}
      />
    )
  }

  function renderSchedule() {
    return (
      <div>
        <div style={S.card}>
          <div style={S.cardTitle}>Supplier</div>
          <div style={S.grid3}>
            <Field label="Supplier Ref #">
              <input style={S.input} value={draft.supplier_ref} onChange={e => setField('supplier_ref', e.target.value)} disabled={!canEdit} placeholder="Supplier order reference" />
            </Field>
            <Field label="Order Confirmation #">
              <input style={S.input} value={draft.supplier_order_confirmation} onChange={e => setField('supplier_order_confirmation', e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Order Placed Date">
              <input style={S.input} type="date" value={draft.supplier_order_placed_at} onChange={e => setField('supplier_order_placed_at', e.target.value)} disabled={!canEdit} />
            </Field>
          </div>
        </div>

        <div style={S.card}>
          <div style={S.cardTitle}>Delivery</div>
          <div style={S.grid2}>
            <Field label="Expected Delivery Date">
              <input style={S.input} type="date" value={draft.expected_delivery_date} onChange={e => setField('expected_delivery_date', e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Confirmed Delivery Date">
              <input style={S.input} type="date" value={draft.confirmed_delivery_date} onChange={e => setField('confirmed_delivery_date', e.target.value)} disabled={!canEdit} />
            </Field>
          </div>
          <div style={{ marginTop: '12px' }}>
            <Field label="Delivery Notes">
              <textarea style={S.textarea} value={draft.delivery_notes} onChange={e => setField('delivery_notes', e.target.value)} disabled={!canEdit} placeholder="Access instructions, site contacts, special requirements…" />
            </Field>
          </div>
        </div>

        <div style={S.card}>
          <div style={S.cardTitle}>Installation</div>
          <div style={S.grid3}>
            <Field label="Expected Install Date">
              <input style={S.input} type="date" value={draft.expected_install_date} onChange={e => setField('expected_install_date', e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Confirmed Install Date">
              <input style={S.input} type="date" value={draft.confirmed_install_date} onChange={e => setField('confirmed_install_date', e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Install Crew">
              <input style={S.input} value={draft.install_crew} onChange={e => setField('install_crew', e.target.value)} disabled={!canEdit} placeholder="Crew name or assignment" />
            </Field>
          </div>
          <div style={{ marginTop: '12px' }}>
            <Field label="Install Notes">
              <textarea style={S.textarea} value={draft.install_notes} onChange={e => setField('install_notes', e.target.value)} disabled={!canEdit} placeholder="Pre-site requirements, staging, special instructions…" />
            </Field>
          </div>
        </div>
      </div>
    )
  }

  function renderTasks() {
    return (
      <TasksPanel
        tasks={tasks}
        orderId={id}
        authHeader={authHeader}
        onRefresh={load}
        canEdit={canEdit}
      />
    )
  }

  function renderUpdates() {
    return (
      <UpdatesPanel
        updates={updates}
        orderId={id}
        authHeader={authHeader}
        onRefresh={load}
        canEdit={canEdit}
      />
    )
  }

  function renderCustomerPortal() {
    return (
      <CustomerPortalPanel
        accesses={portalAccesses}
        orderId={id}
        authHeader={authHeader}
        onRefresh={load}
        canEdit={canEdit}
      />
    )
  }

  function renderHistory() {
    // Build history entries from updates + synthesized stage events
    const historyEntries = [...updates].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    // Add synthesized milestone entries from order timestamps
    const milestones = [
      { ts: order.won_at, label: 'Order marked as Won' },
      { ts: order.contract_signed_at, label: 'Contract signed' },
      { ts: order.supplier_order_placed_at, label: 'Supplier order placed' },
      { ts: order.completed_at, label: 'Order completed' },
      { ts: order.cancelled_at, label: `Order cancelled${order.cancelled_reason ? ': ' + order.cancelled_reason : ''}` },
    ].filter(m => m.ts)

    const allEntries = [
      ...historyEntries.map(u => ({
        id: u.id,
        ts: u.created_at,
        label: u.body,
        actor: u.author_name || 'Team',
        type: u.update_type || 'note',
        isUpdate: true,
        visibleToCustomer: u.visible_to_customer,
      })),
      ...milestones.map(m => ({
        id: m.ts + m.label,
        ts: m.ts,
        label: m.label,
        actor: '',
        type: 'status_change',
        isUpdate: false,
      })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts))

    return (
      <div style={S.card}>
        <div style={S.cardTitle}>Activity History ({allEntries.length} entries)</div>
        {allEntries.length === 0 && <div style={S.emptyMsg}>No history recorded yet.</div>}
        {allEntries.map(h => (
          <div key={h.id} style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', color: '#111827' }}>{h.label}</span>
                  {h.type && h.type !== 'note' && (
                    <span style={{ fontSize: '11px', color: '#9ca3af', background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px', textTransform: 'capitalize' }}>
                      {h.type.replace(/_/g, ' ')}
                    </span>
                  )}
                  {h.isUpdate && h.visibleToCustomer && (
                    <span style={{ fontSize: '11px', fontWeight: '600', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', padding: '2px 6px', borderRadius: '4px' }}>
                      Customer visible
                    </span>
                  )}
                </div>
                {h.actor && (
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>by {h.actor}</div>
                )}
              </div>
              <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtTime(h.ts)}</span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Tabs that touch draft fields (show Save button)
  const DRAFT_TABS = new Set(['Overview', 'Scope & Products', 'Schedule'])
  const showSave = canEdit && DRAFT_TABS.has(activeTab)

  const TAB_RENDERERS = {
    'Overview': renderOverview,
    'Scope & Products': renderScopeProducts,
    'Documents': renderDocuments,
    'Photos': renderPhotos,
    'Schedule': renderSchedule,
    'Tasks': renderTasks,
    'Updates': renderUpdates,
    'Customer Portal': renderCustomerPortal,
    'History': renderHistory,
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={S.page}>
      {/* Sticky Header */}
      <div style={S.header}>
        <div style={S.headerInner}>
          <div style={S.headerLeft}>
            <button style={S.backBtn} onClick={() => router.push('/sales')}>
              ← Sales
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={S.orderTitle}>
                {order.order_number ? `${order.order_number} · ` : ''}{order.customer_name || 'Untitled Order'}
              </div>
              <div style={S.orderSub}>
                {order.division === 'metal_buildings'
                  ? 'Metal Buildings'
                  : order.division === 'commercial_roofing'
                  ? 'Commercial Roofing'
                  : order.division || 'Sales Order'}
              </div>
            </div>
            <span style={stageBadgeStyle(order.stage)}>
              {STAGE_LABELS[order.stage] || order.stage}
            </span>
          </div>
          <div style={S.headerRight}>
            {saveMsg && <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: '500' }}>{saveMsg}</span>}
            {saveErr && <span style={{ fontSize: '12px', color: '#dc2626' }}>{saveErr}</span>}
            {unsaved && !saving && <span style={S.unsavedBadge}>Unsaved</span>}
            {showSave && (
              <button
                style={saving ? S.saveBtnDisabled : S.saveBtn}
                onClick={save}
                disabled={saving || !unsaved}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={S.tabBar}>
        <div style={S.tabBarInner}>
          {TABS.map(tab => (
            <button key={tab} style={S.tab(activeTab === tab)} onClick={() => setActiveTab(tab)}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div style={S.main}>
        {TAB_RENDERERS[activeTab]?.()}
      </div>
    </div>
  )
}
