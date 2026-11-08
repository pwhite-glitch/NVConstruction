'use client'
// Metal-building commission report (Owner: everything; metal rep: only their own
// dollars, forced server-side) and the Owner's payment-instructions settings.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCents } from '../../lib/mb-commission'

const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }
const inp = { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', background: '#fff' }
const btn = { padding: '8px 14px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }
const th = { textAlign: 'left', padding: '8px 10px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
const td = { padding: '8px 10px', fontSize: '13px', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }
const lbl = { fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }

export function MbCommissionReport({ authHeader, isOwner, staffList }) {
  const router = useRouter()
  const [f, setF] = useState({ salesperson_id: '', from: '', to: '', date_basis: 'deposit_received', stage: '', deposit: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params = new URLSearchParams({ mb: 'commission_report', page: String(page) })
      for (const [k, v] of Object.entries(f)) if (v && (isOwner || k !== 'salesperson_id')) params.set(k, v)
      const res = await fetch(`/api/sales-orders?${params}`, { headers: await authHeader() })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || `Could not load (${res.status})`); setData(null) } else setData(j)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }, [f, page, isOwner])

  useEffect(() => { load() }, [load])
  const set = (k, v) => { setPage(1); setF(x => ({ ...x, [k]: v })) }
  const owner = data?.scope === 'owner'
  const pages = data ? Math.max(1, Math.ceil(data.total_rows / data.page_size)) : 1

  return (
    <>
      <div style={{ ...card, fontSize: '12px', color: '#92400e', background: '#fffbeb', borderColor: '#fcd34d' }}>
        Metal buildings only. Commission base = deposit (counted once, only after it is recorded received) + concrete net (charge − cost, once both are entered). Split 40% salesman / 40% Nv / 20% marketing; the salesman 40% is divided by each order's sales-credit shares. {isOwner ? '' : 'You see only your own commission.'}
      </div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {isOwner && (
          <div><label style={lbl}>Salesperson</label>
            <select style={inp} value={f.salesperson_id} onChange={e => set('salesperson_id', e.target.value)}>
              <option value="">Everyone</option>
              {(staffList || []).map(s => <option key={s.id} value={s.id}>{s.full_name || s.id}</option>)}
            </select></div>
        )}
        <div><label style={lbl}>Date basis</label>
          <select style={inp} value={f.date_basis} onChange={e => set('date_basis', e.target.value)}>
            <option value="deposit_received">Deposit received date</option>
            <option value="created">Order created date</option>
          </select></div>
        <div><label style={lbl}>From</label><input type="date" style={inp} value={f.from} onChange={e => set('from', e.target.value)} /></div>
        <div><label style={lbl}>To</label><input type="date" style={inp} value={f.to} onChange={e => set('to', e.target.value)} /></div>
        <div><label style={lbl}>Stage</label>
          <select style={inp} value={f.stage} onChange={e => set('stage', e.target.value)}>
            <option value="">All</option>
            {['lead','quoted','contract_signed','order_placed','scheduled','installed','completed','cancelled','on_hold'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select></div>
        <div><label style={lbl}>Deposit</label>
          <select style={inp} value={f.deposit} onChange={e => set('deposit', e.target.value)}>
            <option value="">All</option><option value="received">Received</option><option value="not_received">Not received</option>
          </select></div>
      </div>
      {err && <p style={{ color: '#dc2626', fontSize: '13px' }}>{err}</p>}
      {loading && <p style={{ color: '#6b7280', fontSize: '13px' }}>Loading…</p>}
      {data && (
        <>
          <div style={{ ...card, display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '13px' }}>
            <div>Orders<br /><strong>{data.totals.orders}</strong></div>
            {owner ? (<>
              <div>Base<br /><strong>{formatCents(data.totals.base_cents)}</strong></div>
              <div>Salesman 40%<br /><strong>{formatCents(data.totals.salesman_pool_cents)}</strong></div>
              <div>Nv 40%<br /><strong>{formatCents(data.totals.nv_cents)}</strong></div>
              <div>Marketing 20%<br /><strong>{formatCents(data.totals.marketing_cents)}</strong></div>
              {data.totals.unassigned_pool_cents ? <div>Salesman pool held<br /><strong style={{ color: '#b45309' }}>{formatCents(data.totals.unassigned_pool_cents)}</strong></div> : null}
              {data.totals.rep_cents != null && <div>Selected rep<br /><strong>{formatCents(data.totals.rep_cents)}</strong></div>}
              {data.totals.flagged_orders ? <div>Need review<br /><strong style={{ color: '#b45309' }}>{data.totals.flagged_orders}</strong></div> : null}
            </>) : <div>Your commission<br /><strong>{formatCents(data.totals.my_commission_cents)}</strong></div>}
            <div style={{ color: '#6b7280' }}>Dates by: {data.date_basis_label}</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Order</th><th style={th}>Customer</th><th style={th}>Stage</th><th style={th}>Deposit</th>
                {owner ? (<><th style={th}>Concrete net</th><th style={th}>Base</th><th style={th}>Salesman</th><th style={th}>Nv</th><th style={th}>Marketing</th><th style={th}>Reps</th>{data.totals.rep_cents != null && <th style={th}>Selected rep</th>}<th style={th}>Notes</th></>)
                  : (<><th style={th}>Your commission</th><th style={th}>Notes</th></>)}
              </tr></thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.order_id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/sales/${r.order_id}`)}>
                    <td style={td}>{r.order_number}</td><td style={td}>{r.customer_name || '—'}</td><td style={td}>{(r.stage || '').replace(/_/g, ' ')}</td>
                    <td style={td}>{r.deposit_received ? `Received${r.deposit_received_date ? ' ' + r.deposit_received_date : ''}` : 'Not received'}</td>
                    {owner ? (<>
                      <td style={td}>{r.concrete_complete ? formatCents(r.concrete_net_cents) : 'Incomplete'}</td>
                      <td style={td}>{formatCents(r.base_cents)}</td><td style={td}>{formatCents(r.salesman_pool_cents)}</td>
                      <td style={td}>{formatCents(r.nv_cents)}</td><td style={td}>{formatCents(r.marketing_cents)}</td>
                      <td style={td}>{r.reps.map(x => `${x.salesperson_name || '?'} ${formatCents(x.cents)}`).join(', ') || '—'}</td>
                      {data.totals.rep_cents != null && <td style={td}>{formatCents(r.rep_cents)}</td>}
                      <td style={{ ...td, color: '#b45309' }}>{(r.flags || []).filter(x => x !== 'deposit_not_received').join(', ')}</td>
                    </>) : (<>
                      <td style={td}>{formatCents(r.my_commission_cents)}</td>
                      <td style={{ ...td, color: '#b45309' }}>{(r.pending || []).join(', ')}</td>
                    </>)}
                  </tr>
                ))}
                {!data.rows.length && <tr><td style={td} colSpan={12}>No metal-building orders match.</td></tr>}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', fontSize: '13px' }}>
              <button style={inp} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span>Page {page} of {pages} ({data.total_rows} orders; totals cover all pages)</span>
              <button style={inp} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </>
  )
}

export function MbPaymentSettings({ authHeader }) {
  const [text, setText] = useState('')
  const [meta, setMeta] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    const res = await fetch('/api/sales-orders?mb=settings', { headers: await authHeader() })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(j.error || `Could not load (${res.status})`); return }
    setText(j.payment_instructions || ''); setMeta(j)
  }, [])
  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true); setErr(''); setMsg('')
    try {
      const res = await fetch('/api/sales-orders', { method: 'POST', headers: await authHeader(), body: JSON.stringify({ action: 'mb_save_settings', payment_instructions: text }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || `Save failed (${res.status})`); return }
      setMsg('Saved.')
      await load()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div style={card}>
      <p style={{ margin: '0 0 6px', fontWeight: '700', fontSize: '14px' }}>Deposit payment instructions (Owner only)</p>
      <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#6b7280' }}>Included in the automatic deposit-request email a metal-building customer gets after signing their order form. Enter how to pay: check payee and mailing address, ACH details, etc. Only the Owner can see or edit this text.</p>
      <textarea style={{ ...inp, width: '100%', minHeight: '160px', boxSizing: 'border-box', fontFamily: 'inherit' }} value={text} maxLength={4000} onChange={e => setText(e.target.value)} />
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' }}>
        <button style={{ ...btn, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        {meta?.updated_at && <span style={{ fontSize: '12px', color: '#6b7280' }}>Last saved {new Date(meta.updated_at).toLocaleString()}{meta.updated_by_name ? ` by ${meta.updated_by_name}` : ''}</span>}
        {msg && <span style={{ fontSize: '12px', color: '#16a34a' }}>{msg}</span>}
        {err && <span style={{ fontSize: '12px', color: '#dc2626' }}>{err}</span>}
      </div>
    </div>
  )
}
