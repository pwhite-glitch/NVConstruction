'use client'
// Metal-building order workflow on the sales order page: supplier + the two order
// forms, native e-signature, deposit request status, deposit receipt, supplier
// turn-in, and commission (Owner: full split; rep: own dollars only).
// Every change goes through a dedicated server action; nothing is marked done here
// unless the server said so.
import { useEffect, useState } from 'react'
import { openFile } from '../../../lib/open-file'
import { formatCents } from '../../../lib/mb-commission'

const box = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }
const sec = { margin: '0 0 0.875rem', fontSize: '11px', fontWeight: '700', color: '#6b7280', letterSpacing: '0.8px', textTransform: 'uppercase' }
const btn = { padding: '8px 14px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }
const btnGray = { padding: '7px 12px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }
const inp = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }
const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 0', borderBottom: '1px solid #f3f4f6', flexWrap: 'wrap' }
const fmtDT = d => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

const FLAG_TEXT = {
  deposit_not_received: 'Deposit not received yet (deposit portion is $0 until it is).',
  deposit_amount_missing: 'No deposit amount saved.',
  concrete_incomplete: 'Concrete charge and/or cost not entered (no concrete portion yet).',
  concrete_negative_net: 'Concrete cost is more than the charge (negative concrete net).',
  concrete_invalid: 'A saved concrete amount is not a valid number.',
  negative_base: 'Commission base is negative; buckets are shown as negative, not zero.',
  no_assignee: 'No salesperson assigned: the salesman 40% is not awarded to anyone.',
  attribution_missing_rep: 'A sales-credit row has no rep: the salesman 40% is held for review.',
  attribution_duplicate_rep: 'A rep appears twice in the sales credit: the salesman 40% is held for review.',
  attribution_bad_share: 'A sales-credit share is out of range: the salesman 40% is held for review.',
  attribution_total_not_100: 'Sales-credit shares do not total exactly 100%: the salesman 40% is held for review.',
  split_under_review: 'The split for this order is being reviewed by the Owner.',
}
const EMAIL_STATUS = { queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'FAILED', not_needed: 'Not needed (deposit already received)' }

export default function MbWorkflowPanel({ order, mb, docs, authHeader, reload, onUpload, profile }) {
  const [suppliers, setSuppliers] = useState([])
  const [supplierSel, setSupplierSel] = useState(order.supplier_id || '')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [deposit, setDeposit] = useState(order.deposit_amount ?? '')
  const [concrete, setConcrete] = useState({ charge: mb?.concrete?.concrete_charge ?? '', cost: mb?.concrete?.concrete_cost ?? '' })

  useEffect(() => { setSupplierSel(order.supplier_id || ''); setDeposit(order.deposit_amount ?? '') }, [order.supplier_id, order.deposit_amount])
  useEffect(() => { setConcrete({ charge: mb?.concrete?.concrete_charge ?? '', cost: mb?.concrete?.concrete_cost ?? '' }) }, [mb?.concrete?.concrete_charge, mb?.concrete?.concrete_cost])
  useEffect(() => {
    if (!mb?.can_work) return
    ;(async () => {
      const headers = await authHeader()
      const res = await fetch('/api/sales-orders?list=mb_suppliers', { headers })
      const j = await res.json().catch(() => ({}))
      if (res.ok) setSuppliers(j.data || [])
    })()
  }, [mb?.can_work])

  if (!mb) return null
  const signing = mb.signing
  const locked = signing && (signing.status === 'pending' || signing.status === 'signed')
  const wf = mb.workflow
  const missing = (mb.prerequisites?.items || []).filter(i => !i.ok)

  async function act(label, body) {
    setBusy(label); setErr(''); setMsg('')
    try {
      const headers = await authHeader()
      const res = await fetch('/api/sales-orders', { method: 'POST', headers, body: JSON.stringify(body) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || `Failed (${res.status})`); return null }
      if (j.warning) setMsg(j.warning)
      return j
    } catch (e) {
      setErr(e.message || 'Request failed'); return null
    } finally {
      setBusy('')
      reload()
    }
  }

  // openFile is called right in the tap (window reserved before any network work).
  function openDoc(docId) {
    setErr('')
    openFile(async () => {
      const headers = await authHeader()
      const res = await fetch(`/api/sales-order-docs?doc_id=${encodeURIComponent(docId)}`, { headers })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) { setErr(j.error || 'Could not open the file.'); return null }
      return j.url
    })
  }

  function sendForSignature() {
    setBusy('send'); setErr(''); setMsg('')
    openFile(async () => {
      try {
        const headers = await authHeader()
        const res = await fetch('/api/sales-orders', { method: 'POST', headers, body: JSON.stringify({ action: 'mb_send_for_signature', id: order.id }) })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j.sign_url) { setErr(j.error || `Could not create the signing link (${res.status}).`); return null }
        setMsg(j.reused ? 'Opened the existing signing link.' : 'Signing link created. Hand the device to the customer or share the link with them.')
        return j.sign_url
      } catch (e) {
        setErr(e.message || 'Could not create the signing link.'); return null
      } finally {
        setBusy('')
        reload()
      }
    })
  }

  const commission = mb.commission

  return (
    <>
      {mb.schema_missing && (
        <div style={{ ...box, background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b', fontSize: '13px' }}>
          The metal-building workflow storage is not set up yet (migration 050 has not been applied). Signing, deposit requests, turn-in and commissions are unavailable until it is.
        </div>
      )}
      {err && <div style={{ ...box, background: '#fef2f2', borderColor: '#fecaca', color: '#dc2626', fontSize: '13px' }}>{err}</div>}
      {msg && <div style={{ ...box, background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534', fontSize: '13px' }}>{msg}</div>}

      {/* Supplier + forms */}
      <div style={box}>
        <p style={sec}>Supplier & Order Forms</p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
          <select style={{ ...inp, width: 'auto', minWidth: '220px' }} value={supplierSel} disabled={!mb.can_work || locked || !!busy} onChange={e => setSupplierSel(e.target.value)}>
            <option value="">— Choose supplier —</option>
            {mb.supplier && !suppliers.some(s => s.id === mb.supplier.id) && <option value={mb.supplier.id}>{mb.supplier.name}</option>}
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {mb.can_work && !locked && (
            <button style={btnGray} disabled={!!busy || supplierSel === (order.supplier_id || '')} onClick={() => act('supplier', { action: 'mb_set_supplier', id: order.id, supplier_id: supplierSel || null })}>
              {busy === 'supplier' ? 'Saving…' : 'Save supplier'}
            </button>
          )}
          {locked && <span style={{ fontSize: '12px', color: '#6b7280' }}>Locked while the order form is out for signature or signed.</span>}
        </div>
        {[['supplier_order_form', "Supplier's order form", mb.forms?.supplier], ['client_order_form', 'Nv client order form (PDF — what the customer signs)', mb.forms?.client]].map(([cat, label, d]) => (
          <div key={cat} style={row}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827' }}>{label}</div>
              <div style={{ fontSize: '12px', color: d ? '#374151' : '#dc2626' }}>{d ? `${d.file_name} · v${d.version_number} · ${fmtDT(d.created_at)}` : 'Not uploaded'}</div>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {d && <button style={btnGray} onClick={() => openDoc(d.id)}>Open ↗</button>}
              {mb.can_work && <button style={btnGray} onClick={() => onUpload(cat)}>{d ? 'Upload new version' : 'Upload'}</button>}
            </div>
          </div>
        ))}
        {mb.can_work && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '12px', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#374151', marginBottom: '4px' }}>Deposit amount ($)</label>
              <input type="number" min="0.01" step="0.01" style={{ ...inp, width: '160px' }} value={deposit} disabled={locked || !!busy} onChange={e => setDeposit(e.target.value)} />
            </div>
            {!locked && (
              <button style={btnGray} disabled={!!busy || String(deposit) === String(order.deposit_amount ?? '')}
                onClick={() => act('deposit_amt', { action: 'update', id: order.id, fields: { deposit_amount: deposit === '' ? null : deposit } })}>
                {busy === 'deposit_amt' ? 'Saving…' : 'Save deposit amount'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Signature */}
      <div style={box}>
        <p style={sec}>Customer Signature</p>
        {!signing || signing.status === 'voided' ? (
          <>
            {missing.length > 0 ? (
              <div style={{ fontSize: '13px', color: '#374151' }}>
                <div style={{ fontWeight: '600', marginBottom: '6px' }}>Before sending for signature:</div>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  {missing.map(i => <li key={i.key} style={{ marginBottom: '4px' }}><span style={{ color: '#dc2626' }}>{i.label}</span> — {i.fix}</li>)}
                </ul>
              </div>
            ) : <p style={{ fontSize: '13px', color: '#16a34a', margin: 0 }}>Ready to send.</p>}
            {mb.can_work && (
              <button style={{ ...btn, marginTop: '12px', opacity: missing.length || busy ? 0.5 : 1 }} disabled={missing.length > 0 || !!busy} onClick={sendForSignature}>
                {busy === 'send' ? 'Creating link…' : 'Send for signature'}
              </button>
            )}
            <p style={{ fontSize: '11px', color: '#9ca3af', margin: '8px 0 0' }}>Opens the customer's signing page. No email is sent at this step; once the customer signs, they are emailed the deposit request automatically.</p>
          </>
        ) : (
          <>
            <div style={row}>
              <div style={{ fontSize: '13px' }}>
                <strong style={{ textTransform: 'capitalize' }}>{signing.status}</strong> · {signing.file_name || 'Client order form'}
                <div style={{ fontSize: '12px', color: '#6b7280' }}>Sent {fmtDT(signing.created_at)}{signing.signed_at ? ` · Signed ${fmtDT(signing.signed_at)}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {signing.sign_url && <button style={btnGray} onClick={() => openFile(async () => signing.sign_url)}>Open signing link ↗</button>}
                {signing.signed_doc_id && <button style={btnGray} onClick={() => openDoc(signing.signed_doc_id)}>Open signed copy ↗</button>}
                {signing.status === 'pending' && mb.can_work && (
                  <button style={{ ...btnGray, color: '#dc2626' }} disabled={!!busy} onClick={() => { if (window.confirm('Cancel this signature request? The link will stop working.')) act('void', { action: 'mb_void_signature', id: order.id }) }}>Cancel request</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Deposit request + receipt */}
      {(wf || signing?.status === 'signed' || mb.is_office) && (
        <div style={box}>
          <p style={sec}>Deposit</p>
          <div style={row}>
            <div style={{ fontSize: '13px' }}>
              Deposit request email: <strong style={{ color: wf?.deposit_email_status === 'failed' ? '#dc2626' : '#111827' }}>{wf?.deposit_email_status ? EMAIL_STATUS[wf.deposit_email_status] : (signing?.status === 'signed' ? 'Not queued' : 'Waits for signature')}</strong>
              {wf?.deposit_email_sent_at && <span style={{ color: '#6b7280' }}> · {fmtDT(wf.deposit_email_sent_at)}</span>}
              {wf?.deposit_email_last_error && <div style={{ fontSize: '12px', color: '#dc2626' }}>{wf.deposit_email_last_error}</div>}
            </div>
            {mb.is_office && mb.recovery_needed && (
              <button style={btnGray} disabled={!!busy} onClick={() => act('retry', { action: 'mb_retry_completion', id: order.id })}>{busy === 'retry' ? 'Retrying…' : 'Retry deposit request'}</button>
            )}
            {mb.is_office && wf?.deposit_email_status === 'sending' && (
              <button style={btnGray} disabled={!!busy} onClick={() => act('retry', { action: 'mb_retry_completion', id: order.id })}>Check / retry</button>
            )}
          </div>
          <div style={row}>
            <div style={{ fontSize: '13px' }}>
              Deposit received: <strong>{order.deposit_received ? 'Yes' : 'No'}</strong>
              {order.deposit_received_date && <span style={{ color: '#6b7280' }}> · {order.deposit_received_date}</span>}
              {wf?.deposit_receipt_marked_by_name && <span style={{ color: '#6b7280' }}> · marked by {wf.deposit_receipt_marked_by_name}</span>}
              <div style={{ fontSize: '11px', color: '#9ca3af' }}>Received means the full deposit is in (checkbox, or recorded deposit payments minus refunds covering the amount due).</div>
            </div>
            {mb.is_office && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!order.deposit_received} disabled={!!busy}
                  onChange={e => act('receipt', { action: 'mb_record_deposit', id: order.id, received: e.target.checked })} />
                Deposit received
              </label>
            )}
          </div>
        </div>
      )}

      {/* Supplier turn-in */}
      {(mb.is_office || wf?.supplier_turned_in_at) && (
        <div style={box}>
          <p style={sec}>Supplier Order Form Turn-In</p>
          {wf?.supplier_turned_in_at ? (
            <p style={{ fontSize: '13px', margin: 0 }}>Turned in by <strong>{wf.supplier_turned_in_by_name || 'Staff'}</strong> on {fmtDT(wf.supplier_turned_in_at)}.</p>
          ) : (
            <>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 8px' }}>Available after the customer signs and the deposit request is queued or sent. This records who turned it in and when; nothing is emailed or sent to the supplier.</p>
              <button style={{ ...btn, opacity: signing?.status === 'signed' && !busy ? 1 : 0.5 }} disabled={signing?.status !== 'signed' || !!busy}
                onClick={() => act('turnin', { action: 'mb_turn_in_supplier_form', id: order.id })}>
                {busy === 'turnin' ? 'Saving…' : 'Turn in supplier order form'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Commission */}
      {commission?.scope === 'owner' && (
        <div style={{ ...box, borderColor: '#fde047', background: '#fefce8' }}>
          <p style={{ ...sec, color: '#a16207' }}>Commission (Owner only)</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', fontSize: '13px', marginBottom: '10px' }}>
            <div>Deposit portion<br /><strong>{formatCents(commission.deposit_leg_cents)}</strong></div>
            <div>Concrete net<br /><strong>{commission.concrete_complete ? formatCents(commission.concrete_net_cents) : 'Incomplete'}</strong></div>
            <div>Base<br /><strong>{formatCents(commission.base_cents)}</strong></div>
            <div>Salesman 40%<br /><strong>{formatCents(commission.salesman_pool_cents)}</strong></div>
            <div>Nv 40%<br /><strong>{formatCents(commission.nv_cents)}</strong></div>
            <div>Marketing 20%<br /><strong>{formatCents(commission.marketing_cents)}</strong></div>
          </div>
          {commission.reps.map(r => (
            <div key={r.salesperson_id} style={{ fontSize: '13px' }}>{r.salesperson_name || r.salesperson_id} · {r.share_pct}% → <strong>{formatCents(r.cents)}</strong></div>
          ))}
          {commission.flags.map(f => <div key={f} style={{ fontSize: '12px', color: '#b45309' }}>⚠ {FLAG_TEXT[f] || f}</div>)}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '12px', flexWrap: 'wrap' }}>
            <div><label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Concrete charge to customer ($)</label>
              <input type="number" min="0" step="0.01" style={{ ...inp, width: '170px' }} value={concrete.charge} onChange={e => setConcrete(c => ({ ...c, charge: e.target.value }))} /></div>
            <div><label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Nv concrete cost ($)</label>
              <input type="number" min="0" step="0.01" style={{ ...inp, width: '170px' }} value={concrete.cost} onChange={e => setConcrete(c => ({ ...c, cost: e.target.value }))} /></div>
            <button style={btnGray} disabled={!!busy} onClick={() => act('concrete', { action: 'mb_save_concrete', id: order.id, concrete_charge: concrete.charge === '' ? null : concrete.charge, concrete_cost: concrete.cost === '' ? null : concrete.cost })}>
              {busy === 'concrete' ? 'Saving…' : 'Save concrete'}
            </button>
          </div>
          <p style={{ fontSize: '11px', color: '#9ca3af', margin: '6px 0 0' }}>Net = charge − cost (can be negative). Leave a field blank if not known yet; $0 counts as entered.</p>
        </div>
      )}
      {commission?.scope === 'rep' && (
        <div style={box}>
          <p style={sec}>Your Commission</p>
          <p style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 6px' }}>{formatCents(commission.my_commission_cents)}</p>
          {commission.pending.map(f => <div key={f} style={{ fontSize: '12px', color: '#b45309' }}>{FLAG_TEXT[f] || f}</div>)}
        </div>
      )}
    </>
  )
}
