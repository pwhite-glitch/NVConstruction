'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { fetchJson, jsonInit } from '../../lib/fetch-json'
import { uploadThenSend } from '../../lib/file-upload-client'
import { openFile } from '../../lib/open-file'
import { todayCentral } from '../../lib/central-date'
import {
  STATUS_LABELS, STATUS_COLORS, MIGRATION_082_SHORT, PO_PAYER_LABELS, defaultDueDate, invoiceRemaining,
  poPaymentStatus, effectivePOPayer, poPayerSource, invoicesTotal,
} from '../../lib/po-invoices'

// PO vendor invoices on the job page (prompt 99): add an invoice (number, date, amount, PDF),
// approve it onto the office Ready to pay list, send it back with a reason, or (owner-pays
// jobs) mark it paid by the owner. Every action is re-checked on the server
// (/api/po-invoices); the buttons shown here come from the server's `can` answer.

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = d => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

/** Loads every PO invoice on the job once; the PO cards read from it. */
export function usePOInvoices(jobId) {
  const [state, setState] = useState({ invoices: [], can: { approve: false, mark_paid: false }, jobPayer: null, migrationMissing: false, error: '', loaded: false })
  const reload = useCallback(async () => {
    if (!jobId) return
    const r = await fetchJson(authFetch, `/api/po-invoices?job_id=${encodeURIComponent(jobId)}`)
    if (!r.ok) { setState(s => ({ ...s, error: r.error, loaded: true })); return }
    setState({
      invoices: r.data?.invoices || [],
      can: r.data?.can || { approve: false, mark_paid: false },
      jobPayer: r.data?.job_payer || null,
      migrationMissing: !!r.data?.migration_required,
      error: '',
      loaded: true,
    })
  }, [jobId])
  useEffect(() => { reload() }, [reload])
  const byPO = {}
  for (const inv of state.invoices) (byPO[inv.po_id] = byPO[inv.po_id] || []).push(inv)
  return { ...state, byPO, reload }
}

export function PaymentBadge({ status, title }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.no_invoice
  return <span title={title} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', fontWeight: '700', background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>{STATUS_LABELS[status] || status}</span>
}

/** Payment status pill for a PO card header (separate from its order status). */
export function POPaymentBadge({ po, job, invoices }) {
  const payer = effectivePOPayer(po, job)
  return <PaymentBadge status={poPaymentStatus(invoices || [], payer)} title="Payment status (separate from the order status)" />
}

/** "NV pays" / "Owner pays", marked when it is a per-PO override. */
export function POPayerTag({ po, job }) {
  const payer = effectivePOPayer(po, job)
  const override = poPayerSource(po, job) === 'override'
  return (
    <span title={override ? 'Set on this PO (overrides the job setting)' : 'From the job setting'} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', fontWeight: '700', background: payer === 'owner' ? '#f5f3ff' : '#fff7ed', color: payer === 'owner' ? '#6d28d9' : '#c2410c', border: `1px solid ${payer === 'owner' ? '#ddd6fe' : '#fed7aa'}` }}>
      {payer === 'owner' ? 'Owner pays' : 'NV pays'}{override ? ' · this PO' : ''}
    </span>
  )
}

const EMPTY = () => ({ invoice_number: '', invoice_date: todayCentral(), amount: '', due_date: '' })

export default function POInvoicesPanel({ s, po, job, invoices = [], can = {}, isOwner = false, migrationMissing = false, onChanged }) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const payer = effectivePOPayer(po, job)
  const total = invoicesTotal(invoices)

  if (migrationMissing) {
    return <div style={{ marginTop: '12px', padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '12px', color: '#92400e' }}>{MIGRATION_082_SHORT}</div>
  }

  const done = async text => { setMsg(text || ''); await onChanged?.() }

  // Over the PO amount: an Owner is asked for an override note and the save is resent.
  async function sendWithOverride(send) {
    let r = await send({})
    if (!r.ok && r.data?.needs_owner_override) {
      if (!isOwner) return { ...r, error: r.error + ' Ask an Owner to enter it.' }
      const note = window.prompt(r.error + '\n\nOwner override — enter a note explaining why:')
      if (!note || !note.trim()) return { ok: false, error: 'Not saved — an override note is required.' }
      r = await send({ override_note: note.trim() })
    }
    return r
  }

  async function saveInvoice() {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const fields = { invoice_number: form.invoice_number, invoice_date: form.invoice_date, amount: form.amount, due_date: form.due_date || null }
      const r = await uploadThenSend({
        fetchFn: authFetch, putFn: fetch, file, target: 'po-invoice', context: { job_id: po.job_id, record_id: po.id },
        send: attachment => sendWithOverride(extra => fetchJson(authFetch, '/api/po-invoices', editingId
          ? jsonInit('PATCH', { id: editingId, action: 'edit', ...fields, ...extra, ...(attachment ? { attachment } : {}) })
          : jsonInit('POST', { po_id: po.id, ...fields, ...extra, ...(attachment ? { attachment } : {}) }))),
      })
      if (!r.ok) { setMsg((r.stage === 'upload' ? 'Invoice file upload failed: ' : 'Invoice not saved: ') + r.error); return }
      setAdding(false); setEditingId(null); setForm(EMPTY()); setFile(null)
      await done('')
    } finally { setBusy(false) }
  }

  async function act(inv, action, extra = {}) {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const r = action === 'approve'
        ? await sendWithOverride(o => fetchJson(authFetch, '/api/po-invoices', jsonInit('PATCH', { id: inv.id, action, ...extra, ...o })))
        : await fetchJson(authFetch, '/api/po-invoices', jsonInit('PATCH', { id: inv.id, action, ...extra }))
      if (!r.ok) { setMsg(r.error); return }
      // The approval stands even when the office email failed; say so (kept after the refresh).
      const emailError = action === 'approve' ? r.data?.email_error : null
      await done(emailError ? `Approved. The office email did not send: ${emailError}` : '')
    } finally { setBusy(false) }
  }

  async function sendBack(inv) {
    const reason = window.prompt(`Send back invoice ${inv.invoice_number}? Enter the reason (required):`)
    if (reason === null) return
    if (!reason.trim()) { setMsg('A reason is required to send an invoice back.'); return }
    await act(inv, 'send_back', { reason: reason.trim() })
  }

  async function markPaid(inv) {
    const check = window.prompt(`Check # for invoice ${inv.invoice_number}:`)
    if (check === null) return
    const amount = window.prompt(`Amount of this check (remaining ${fmt(invoiceRemaining(inv))}; partial is OK):`, invoiceRemaining(inv).toFixed(2))
    if (amount === null) return
    const paid_on = window.prompt('Check date (YYYY-MM-DD):', todayCentral())
    if (paid_on === null) return
    await act(inv, 'mark_paid', { check_number: check, amount, paid_on })
  }

  async function markPaidByOwner(inv) {
    const paid_on = window.prompt(`Mark invoice ${inv.invoice_number} paid by the owner. Date paid (YYYY-MM-DD):`, todayCentral())
    if (paid_on === null) return
    await act(inv, 'mark_paid_by_owner', { paid_on })
  }

  async function remove(inv) {
    if (!window.confirm(`Remove invoice ${inv.invoice_number} (${fmt(inv.amount)})?`)) return
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const r = await fetchJson(authFetch, '/api/po-invoices', jsonInit('DELETE', { id: inv.id }))
      if (!r.ok) { setMsg(r.error); return }
      await done('')
    } finally { setBusy(false) }
  }

  const openInvoiceFile = inv => openFile(async () => {
    const r = await fetchJson(authFetch, `/api/po-invoices?sign=${encodeURIComponent(inv.id)}`)
    if (!r.ok || !r.data?.signedUrl) { alert('Could not open the invoice: ' + (r.ok ? 'no link returned' : r.error)); return null }
    return r.data.signedUrl
  })

  const label = { display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', marginBottom: '4px' }
  const input = s?.input || { width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }
  const btn = (bg, color, border) => ({ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer', background: bg, color, border: `1px solid ${border}`, opacity: busy ? 0.6 : 1 })
  const canEdit = inv => !inv.approved_at && !inv.ready_to_pay && !(Number(inv.paid_amount) > 0) && !inv.paid_at && !inv.paid_by_owner

  const form_ = (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', marginTop: '8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '10px' }}>
        <div><label style={label}>Invoice # *</label><input style={input} value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} /></div>
        <div><label style={label}>Invoice date *</label><input type="date" style={input} value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} /></div>
        <div><label style={label}>Amount ($) *</label><input type="number" step="0.01" min="0.01" style={input} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
        <div><label style={label}>Due date</label><input type="date" style={input} value={form.due_date} placeholder={defaultDueDate(form.invoice_date) || ''} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          {!form.due_date && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '3px' }}>Default: {fmtDate(defaultDueDate(form.invoice_date))} (invoice date + 30)</div>}</div>
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label style={{ ...label, display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '6px 12px', background: '#fff', border: '1px dashed #d1d5db', borderRadius: '6px', color: '#374151' }}>
          {file ? file.name : editingId ? '+ Replace invoice PDF (optional)' : '+ Attach invoice PDF'}
          <input type="file" style={{ display: 'none' }} accept=".pdf,.png,.jpg,.jpeg" onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
        {file && <button type="button" onClick={() => setFile(null)} style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '12px' }}>Remove</button>}
      </div>
      {(() => {
        const amt = Number(form.amount) || 0
        const newTotal = invoicesTotal(invoices, editingId) + amt
        return amt > 0 && newTotal > Number(po.amount || 0) + 0.005
          ? <div style={{ fontSize: '12px', color: '#b45309', marginBottom: '8px' }}>⚠ Invoices would total {fmt(newTotal)}, over the PO amount of {fmt(po.amount)}. {isOwner ? 'You will be asked for an Owner override note.' : 'An Owner must override this.'}</div>
          : null
      })()}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" disabled={busy || !form.invoice_number || !form.amount || !form.invoice_date} onClick={saveInvoice} style={btn('#16a34a', '#fff', '#16a34a')}>{busy ? 'Saving…' : editingId ? 'Save invoice' : 'Add invoice'}</button>
        <button type="button" onClick={() => { setAdding(false); setEditingId(null); setForm(EMPTY()); setFile(null) }} style={btn('#fff', '#374151', '#d1d5db')}>Cancel</button>
      </div>
    </div>
  )

  return (
    <div style={{ marginTop: '14px', borderTop: '1px solid #f3f4f6', paddingTop: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280', letterSpacing: '1px', textTransform: 'uppercase' }}>Vendor invoices</span>
        <POPayerTag po={po} job={job} />
        {invoices.length > 0 && <span style={{ fontSize: '12px', color: total > Number(po.amount || 0) + 0.005 ? '#b45309' : '#6b7280' }}>{fmt(total)} invoiced of {fmt(po.amount)}</span>}
        {po.status !== 'draft' && !adding && !editingId && <button type="button" onClick={() => { setAdding(true); setForm(EMPTY()); setFile(null) }} style={{ ...btn('#fff7ed', '#c2410c', '#fdba74'), marginLeft: 'auto' }}>+ Add invoice</button>}
      </div>
      {po.status === 'draft' && <p style={{ fontSize: '12px', color: '#6b7280', margin: '4px 0' }}>Issue the PO before adding a vendor invoice.</p>}
      {payer === 'owner' && <p style={{ fontSize: '12px', color: '#6d28d9', margin: '4px 0' }}>{PO_PAYER_LABELS.owner}: these invoices are tracked here and never go on the office check list.</p>}
      {msg && <div style={{ fontSize: '12px', color: '#dc2626', margin: '6px 0' }}>{msg}</div>}
      {adding && form_}
      {invoices.length === 0 && !adding && po.status !== 'draft' && <p style={{ fontSize: '12px', color: '#9ca3af', margin: '4px 0' }}>No invoice logged yet.</p>}
      {invoices.map(inv => (
        <div key={inv.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', marginTop: '8px', background: inv.overdue ? '#fffbeb' : '#fff' }}>
          {editingId === inv.id ? form_ : <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>Inv {inv.invoice_number}</span>
              <PaymentBadge status={inv.status} />
              {inv.overdue && <span style={{ fontSize: '11px', fontWeight: '700', color: '#dc2626' }}>OVERDUE</span>}
              <span style={{ fontSize: '12px', color: '#6b7280' }}>dated {fmtDate(inv.invoice_date)} · due {fmtDate(inv.due_date)}</span>
              <span style={{ marginLeft: 'auto', fontSize: '14px', fontWeight: '800', color: '#111827', fontFamily: 'monospace' }}>{fmt(inv.amount)}</span>
            </div>
            {inv.payer_kept && <div style={{ fontSize: '11px', color: '#6b7280' }}>{inv.payer === 'owner' ? 'Owner pays' : 'NV pays'} (kept — approved/paid before the payer changed)</div>}
            {Number(inv.paid_amount) > 0 && inv.status !== 'paid' && <div style={{ fontSize: '12px', color: '#b45309', marginTop: '4px' }}>Partially paid {fmt(inv.paid_amount)} · {fmt(inv.remaining)} remaining</div>}
            {inv.check_number && <div style={{ fontSize: '12px', color: '#374151', marginTop: '4px' }}>Check # {inv.check_number}{inv.last_payment_date ? ` · ${fmtDate(inv.last_payment_date)}` : ''}</div>}
            {inv.sent_back_reason && !inv.approved_at && <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '4px' }}>Sent back {fmtDate(inv.sent_back_at)}: {inv.sent_back_reason}</div>}
            {inv.over_po_override_note && <div style={{ fontSize: '12px', color: '#92400e', marginTop: '4px' }}>Owner override (over PO amount): {inv.over_po_override_note}</div>}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
              {inv.file_url && <button type="button" onClick={() => openInvoiceFile(inv)} style={btn('#eff6ff', '#1d4ed8', '#bfdbfe')}>View invoice</button>}
              {inv.status === 'needs_approval' && can.approve && <button type="button" disabled={busy} onClick={() => act(inv, 'approve')} style={btn('#f0fdf4', '#16a34a', '#bbf7d0')}>Approve → Ready to pay</button>}
              {inv.status === 'owner_to_pay' && can.approve && <button type="button" disabled={busy} onClick={() => markPaidByOwner(inv)} style={btn('#f5f3ff', '#6d28d9', '#ddd6fe')}>Mark paid by owner</button>}
              {inv.status === 'ready_to_pay' && can.mark_paid && <button type="button" disabled={busy} onClick={() => markPaid(inv)} style={btn('#f0fdf4', '#16a34a', '#bbf7d0')}>Mark paid</button>}
              {(inv.status === 'needs_approval' || inv.status === 'ready_to_pay' || inv.status === 'owner_to_pay') && !(Number(inv.paid_amount) > 0) && (can.approve || can.mark_paid) && <button type="button" disabled={busy} onClick={() => sendBack(inv)} style={btn('#fef2f2', '#dc2626', '#fecaca')}>Send back</button>}
              {canEdit(inv) && <button type="button" disabled={busy} onClick={() => { setEditingId(inv.id); setAdding(false); setFile(null); setForm({ invoice_number: inv.invoice_number || '', invoice_date: String(inv.invoice_date || '').slice(0, 10), amount: String(inv.amount ?? ''), due_date: String(inv.due_date || '').slice(0, 10) }) }} style={btn('#fff', '#374151', '#d1d5db')}>Edit</button>}
              {canEdit(inv) && <button type="button" disabled={busy} onClick={() => remove(inv)} style={btn('#fff', '#dc2626', '#fecaca')}>Remove</button>}
            </div>
          </>}
        </div>
      ))}
    </div>
  )
}
