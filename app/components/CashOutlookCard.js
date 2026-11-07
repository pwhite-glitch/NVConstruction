'use client'
// Owner-only company cash outlook card (dashboard Overview). Data comes only
// from /api/cash-outlook, which refuses everyone but principals; the card is
// rendered only for principals too. Opening cash is a scenario kept in this
// component's state — never saved, never a bank balance.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { escapeHtml } from '../../lib/email'
import { bucketize, outlookSummaryText, outlookViewState, NOTE_TEXT, WEEK_OPTIONS, DEFAULT_WEEKS, PO_PAY_DAYS } from '../../lib/cash-outlook'
import ExpectedPayDateEditor from './ExpectedPayDateEditor'

const money = n => n === null || n === undefined ? '—' : (n < 0 ? '−' : '') + '$' + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const dayLabel = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const CATEGORY = { receivable: 'Receivable', unbilled: 'Unbilled (est.)', sub_billing: 'Sub billing', po: 'PO (est.)', payroll: 'Payroll (est.)' }

function ItemRow({ it, onDateSaved, showEditor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '6px 0', borderBottom: '1px solid #f3f4f6', flexWrap: 'wrap', fontSize: '12px' }}>
      <div style={{ minWidth: '220px', flex: 1 }}>
        <span style={{ fontWeight: 600, color: '#111827' }}>{it.label}</span>
        <span style={{ color: '#6b7280' }}> · {CATEGORY[it.category] || it.category}{it.job ? ` · #${it.job.job_number ?? ''} ${it.job.project_name ?? ''}` : ''}</span>
        {it.overdue && <span style={{ marginLeft: '6px', color: '#b91c1c', fontWeight: 700 }}>OVERDUE ({it.date})</span>}
        {it.date && !it.overdue && <span style={{ color: '#6b7280' }}> · {it.dateBasis === 'assumed' ? 'assumed' : 'expected'} {it.date}</span>}
        {(it.notes || []).filter(n => NOTE_TEXT[n]).map(n => <div key={n} style={{ color: '#b45309' }}>⚠ {NOTE_TEXT[n]}</div>)}
        {showEditor && it.ref && <div style={{ marginTop: '3px' }}><ExpectedPayDateEditor entity={it.ref.entity} id={it.ref.id} value={it.date && it.dateBasis === 'expected' ? it.date : ''} onSaved={onDateSaved} /></div>}
      </div>
      <div style={{ fontWeight: 700, color: it.kind === 'in' ? '#15803d' : '#b91c1c', whiteSpace: 'nowrap' }}>
        {it.kind === 'in' ? '+' : '−'}{it.amount === null ? `unknown${it.requested ? ` (requested ${money(it.requested)})` : ''}` : money(Math.abs(it.amount))}
        {it.amount !== null && it.amount < 0 && <span style={{ color: '#b45309' }}> (negative)</span>}
      </div>
    </div>
  )
}

function Section({ title, items, subtitle, children, defaultOpen = false }) {
  if (!items?.length && !children) return null
  return (
    <details open={defaultOpen} style={{ marginTop: '10px' }}>
      <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 700, color: '#111827' }}>{title}{items ? ` (${items.length})` : ''}{subtitle ? <span style={{ fontWeight: 400, color: '#6b7280' }}> — {subtitle}</span> : null}</summary>
      <div style={{ marginTop: '4px' }}>{children}</div>
    </details>
  )
}

export default function CashOutlookCard() {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' })
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS)
  const [openingText, setOpeningText] = useState('')
  const [includePO, setIncludePO] = useState(true)
  const [includeUnbilled, setIncludeUnbilled] = useState(false)
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    setState(s => ({ ...s, status: 'loading', error: '' }))
    try {
      const res = await authFetch('/api/cash-outlook', { cache: 'no-store' })
      let body = null
      try { body = await res.json() } catch {}
      if (!res.ok) { setState({ status: 'error', data: null, error: body?.error || `Could not load the cash outlook (${res.status}).` }); return }
      setState({ status: 'ready', data: body, error: '' })
    } catch (e) {
      setState({ status: 'error', data: null, error: e?.message || 'Could not load the cash outlook.' })
    }
  }, [])
  useEffect(() => { load() }, [load])

  const opening = useMemo(() => {
    const t = openingText.replace(/[$,\s]/g, '')
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : NaN
  }, [openingText])
  const openingInvalid = Number.isNaN(opening)

  const d = state.data
  const result = useMemo(() => d ? bucketize(d.items || [], { today: d.as_of, weeks, opening: openingInvalid ? null : opening, includePO, includeUnbilled }) : null,
    [d, weeks, opening, openingInvalid, includePO, includeUnbilled])

  const card = { background: 'var(--nv-surface, #fff)', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', margin: '0 0 1.5rem' }
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
      <div>
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#111827' }}>Cash outlook — all jobs <span style={{ fontSize: '11px', fontWeight: 700, color: '#a16207', background: '#fefce8', border: '1px solid #fde047', borderRadius: '4px', padding: '1px 6px', marginLeft: '6px' }}>OWNER ONLY</span></p>
        {d && <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6b7280' }}>As of {d.as_of} (Central) · weeks start Monday · payroll assumed Fridays · {d.jobs_count} jobs{d.preview_jobs_excluded ? ` (${d.preview_jobs_excluded} preview jobs excluded)` : ''}</p>}
      </div>
      <button type="button" onClick={load} disabled={state.status === 'loading'} style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', cursor: 'pointer' }}>{state.status === 'loading' ? 'Loading…' : 'Refresh'}</button>
    </div>
  )

  const view = outlookViewState(state)
  if (view === 'loading') return <div style={card}>{header}<p style={{ fontSize: '13px', color: '#6b7280' }}>Loading cash outlook…</p></div>
  if (view === 'error') return <div style={card}>{header}<p role="alert" style={{ fontSize: '13px', color: '#dc2626' }}>{state.error} Nothing is shown because a partial outlook could be wrong.</p></div>
  if (!d || !result) return null

  const empty = view === 'empty'
  const summaryText = () => outlookSummaryText(result, { today: d.as_of, generatedAt: new Date(d.generated_at).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CT', opening, payroll: d.payroll })
  async function copySummary() {
    try { await navigator.clipboard.writeText(summaryText()); setCopied('Copied') } catch { setCopied('Copy failed — use Print') }
    setTimeout(() => setCopied(''), 3000)
  }
  function printSummary() {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!doctype html><title>Cash outlook ${escapeHtml(d.as_of)}</title><pre style="font:12px ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(summaryText())}</pre>`)
    w.document.close()
    w.focus(); w.print()
  }
  const onDateSaved = () => load()
  const th = { padding: '6px 8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#6b7280', textAlign: 'right', fontWeight: 700 }
  const td = { padding: '6px 8px', textAlign: 'right', fontSize: '13px', whiteSpace: 'nowrap' }

  return (
    <div style={card}>
      {header}

      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', margin: '12px 0', fontSize: '12px', color: '#374151' }}>
        <label>Opening cash (scenario):{' '}
          <input inputMode="decimal" placeholder="unknown — type an amount" value={openingText} onChange={e => setOpeningText(e.target.value)}
            style={{ width: '170px', fontSize: '12px', padding: '3px 6px', border: `1px solid ${openingInvalid ? '#dc2626' : '#d1d5db'}`, borderRadius: '5px' }} />
        </label>
        <label>Weeks:{' '}
          <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} style={{ fontSize: '12px' }}>{WEEK_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <label><input type="checkbox" checked={includePO} onChange={e => setIncludePO(e.target.checked)} /> Include estimated PO commitments</label>
        <label><input type="checkbox" checked={includeUnbilled} onChange={e => setIncludeUnbilled(e.target.checked)} /> Include estimated unbilled work (dated only)</label>
        <button type="button" onClick={copySummary} style={{ fontSize: '12px', padding: '3px 8px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', cursor: 'pointer' }}>Copy summary</button>
        <button type="button" onClick={printSummary} style={{ fontSize: '12px', padding: '3px 8px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', cursor: 'pointer' }}>Print</button>
        {copied && <span>{copied}</span>}
      </div>
      {openingInvalid && <p role="alert" style={{ fontSize: '12px', color: '#dc2626', margin: '0 0 8px' }}>Opening cash isn't a number — ignored.</p>}

      <p style={{ fontSize: '12px', margin: '0 0 8px', color: result.openingKnown ? '#374151' : '#92400e', fontWeight: 600 }}>
        {result.openingKnown
          ? `Running balance = your scenario opening cash ${money(opening)} + money in − money out. Not a bank feed.`
          : 'Cumulative net movement from $0 — not bank balance. Enter opening cash to see a running balance scenario; a negative figure here is not a cash shortfall.'}
      </p>

      {!d.migration?.expected_payment_dates && (
        <p style={{ fontSize: '12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '6px', padding: '6px 10px', color: '#9a3412' }}>
          Expected-payment dates need database migration 047 (written, not applied). Until then pay apps and sub billings sit under “Needs expected date” and date edits are refused.
        </p>
      )}

      {empty ? (
        <p style={{ fontSize: '13px', color: '#6b7280' }}>No open receivables, approved unpaid billings, open POs or payroll found.</p>
      ) : (
        <>
          <p style={{ fontSize: '13px', margin: '4px 0 8px', color: '#111827' }}>
            Lowest {result.openingKnown ? 'balance' : 'cumulative movement'}: <strong style={{ color: result.lowest?.ending < 0 ? '#b91c1c' : '#15803d' }}>{money(result.lowest?.ending)}</strong> (week of {result.lowest && dayLabel(result.lowest.start)}) ·{' '}
            {result.negativeWeeks ? <strong style={{ color: '#b91c1c' }}>{result.negativeWeeks} week{result.negativeWeeks === 1 ? '' : 's'} below $0{result.openingKnown ? '' : ' (movement, not balance)'}</strong> : 'no weeks below $0'}
          </p>
          <div className="rx-scroll-x">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ ...th, textAlign: 'left' }}>Week of (Mon)</th><th style={th}>Opening</th><th style={th}>In</th><th style={th}>Out</th><th style={th}>Net</th><th style={th}>{result.openingKnown ? 'Ending' : 'Cumulative'}</th><th style={{ ...th, textAlign: 'left' }}>Flags</th>
              </tr></thead>
              <tbody>
                {result.weeks.map(w => (
                  <tr key={w.start} style={{ borderBottom: '1px solid #f3f4f6', background: w.negative ? '#fef2f2' : undefined }}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{dayLabel(w.start)}–{dayLabel(w.end)}</td>
                    <td style={td}>{money(w.opening)}</td>
                    <td style={{ ...td, color: '#15803d' }}>{money(w.in)}</td>
                    <td style={{ ...td, color: '#b91c1c' }}>{money(w.out)}</td>
                    <td style={td}>{money(w.net)}</td>
                    <td style={{ ...td, fontWeight: 700, color: w.negative ? '#b91c1c' : '#111827' }}>{money(w.ending)}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      {w.negative && <span style={{ fontSize: '10px', fontWeight: 800, color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: '4px', padding: '1px 5px', marginRight: '4px' }}>{result.openingKnown ? 'NEGATIVE' : 'BELOW $0 (movement)'}</span>}
                      {w.overdueCount > 0 && <span style={{ fontSize: '10px', fontWeight: 700, color: '#92400e' }}>{w.overdueCount} overdue</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Section title="Needs expected date" items={result.unscheduled} subtitle={`in ${money(result.totals.unscheduledIn)} · out ${money(result.totals.unscheduledOut)} — not in any week`} defaultOpen={result.unscheduled.length > 0 && result.unscheduled.length <= 15}>
            {result.unscheduled.map(it => <ItemRow key={it.id} it={it} showEditor={!!d.migration?.expected_payment_dates} onDateSaved={onDateSaved} />)}
          </Section>
          <Section title="Needs reconciliation — not counted" items={result.uncertain}>
            {result.uncertain.map(it => <ItemRow key={it.id} it={it} showEditor={false} />)}
          </Section>
          <Section title="Beyond this window" items={result.outOfWindow} subtitle={`in ${money(result.totals.outOfWindowIn)} · out ${money(result.totals.outOfWindowOut)}`}>
            {result.outOfWindow.map(it => <ItemRow key={it.id} it={it} showEditor={!!d.migration?.expected_payment_dates} onDateSaved={onDateSaved} />)}
          </Section>
          <Section title="Estimates left out of the balance" items={result.excluded} subtitle="tick the boxes above to include">
            {result.excluded.map(it => <ItemRow key={it.id} it={it} showEditor={!!d.migration?.expected_payment_dates} onDateSaved={onDateSaved} />)}
          </Section>
          <Section title="Items in the weeks (payroll not listed)" items={result.weeks.flatMap(w => w.items).filter(it => !it.recurring)}>
            {result.weeks.flatMap(w => w.items).filter(it => !it.recurring).map(it => <ItemRow key={it.id} it={it} showEditor={!!d.migration?.expected_payment_dates} onDateSaved={onDateSaved} />)}
          </Section>
        </>
      )}

      <Section title="Assumptions and what is not included">
        <ul style={{ fontSize: '12px', color: '#374151', paddingLeft: '18px', margin: '4px 0' }}>
          <li>Opening cash is your scenario number; no bank balance source exists in the app.</li>
          <li>Money in: submitted/certified AIA pay apps at G702 current payment due less amount received; residential lender draws submitted/approved at amount requested (less amount funded when recorded). Internal draw requests carry no receivable amount and are never counted.</li>
          <li>Money out: approved sub billings not yet paid, net of retainage held and any partial payment. Retainage held on those billings ({money(d.sub_retainage_held)}) is not scheduled.</li>
          <li>Owner-pays-direct sub billings excluded: {d.owner_paid_billings?.count || 0} ({money(d.owner_paid_billings?.total)}). Client-owner check POs excluded: {d.owner_check_pos?.count || 0} ({money(d.owner_check_pos?.total)}).</li>
          <li>Open POs (issued/received, paid by NV) are ESTIMATED commitments, assumed paid issued date + {PO_PAY_DAYS} days; no vendor invoice or due date exists and they may overlap direct costs or billings already recorded.</li>
          <li>Payroll: {money(d.payroll?.weekly)}/week every Friday from today on — {d.payroll?.active_employees || 0} active employees counted once each (salary {money(d.payroll?.components?.salary)}, truck {money(d.payroll?.components?.truck)}, healthcare {money(d.payroll?.components?.healthcare)}, taxes {money(d.payroll?.components?.taxes)}). No payroll ledger: past Fridays are not assumed unpaid.{d.payroll?.missing_pay_data ? ` ⚠ ${d.payroll.missing_pay_data} active employee(s) have no pay data.` : ''}{d.payroll?.active_flag_unknown ? ` ⚠ ${d.payroll.active_flag_unknown} employee(s) have no active flag and were counted.` : ''}</li>
          <li>Unbilled work: only a single draft pay app / lender draw per sequence ({money(result.totals.unbilled)}). {d.unquantified_unbilled_jobs} active job(s) have no draft, so their unbilled work is not quantified (not $0). Remaining contract backlog is not cash.</li>
          <li>Not included: direct costs / credit cards, general conditions, owner reimbursement invoices, retainage releases, taxes other than payroll, loans or other bank activity.</li>
          {!d.migration?.amount_funded && <li>Funded amounts on lender draws need migration 046 (not applied): funded draws are listed as unknown, never assumed paid in full.</li>}
          {(d.disclosures || []).map((x, i) => <li key={i} style={{ color: '#92400e' }}>{x.message}</li>)}
        </ul>
      </Section>
    </div>
  )
}
