'use client'
import { useState, useEffect, useRef } from 'react'
import { authFetch } from '../../../lib/client-fetch'
import {
  levelingKey, entryMap, nextIncluded, isExcluded, leveledTotal, hasLeveledAmounts,
  gapItems, groupByTrade, subsForTrade, levelingSubs, parseLevelingAmount,
} from '../../../lib/bid-leveling'
import { levelingCellOps } from '../../../lib/leveling-cell-saves'

// Load a package's leveling entries through the server (the table has no browser policies).
export async function loadLevelingEntries(bidPackageId) {
  const res = await authFetch(`/api/bid-leveling?bid_package_id=${encodeURIComponent(bidPackageId)}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json.error || `Could not load leveling (HTTP ${res.status}).` }
  return { entries: json.entries || [] }
}

async function saveCell(body) {
  const res = await authFetch('/api/bid-leveling', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.entry) return { error: json.error || `Not saved (HTTP ${res.status}).` }
  return { entry: json.entry }
}

const money = n => `$${Math.round(Number(n) || 0).toLocaleString()}`
const DEBOUNCE_MS = 700

// The bid leveling matrix used by the dashboard Compare step and the full bid page.
// Typed amounts live in local state and save on blur or after a short pause.
// props: bidPackageId, scopeItems, submissions, entries, onEntry(entry), canEdit, filterByTrade
export default function LevelingMatrix({ bidPackageId, scopeItems = [], submissions = [], entries = [], onEntry, canEdit = false, filterByTrade = true }) {
  const [drafts, setDrafts] = useState({}) // { key: string } while typing / saving
  const [saving, setSaving] = useState({}) // { key: true }
  const [errors, setErrors] = useState({}) // { key: message }
  const timers = useRef({})
  const reqSeq = useRef({}) // { key: n } latest save sent per cell; older responses are ignored
  const inFlight = useRef({}) // { key: n } saves for the cell still awaiting a response
  const chains = useRef({}) // { key: queue } one request per cell on the wire; newer saves wait their turn
  const draftsRef = useRef({})
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])
  const setDraft = (k, v) => { draftsRef.current = { ...draftsRef.current, [k]: v }; setDrafts(draftsRef.current) }
  const clearDraft = k => { const { [k]: _, ...rest } = draftsRef.current; draftsRef.current = rest; setDrafts(rest) }

  const subs = levelingSubs(submissions)
  const map = entryMap(entries)
  if (scopeItems.length === 0) return <p style={{ fontSize: '13px', color: '#6b7280' }}>Add scope items to start leveling.</p>
  if (subs.length === 0) return <p style={{ fontSize: '13px', color: '#6b7280' }}>No active bids to level.</p>

  const gaps = gapItems(scopeItems, subs, map)
  const groups = groupByTrade(scopeItems)
  const budgetTotal = scopeItems.reduce((a, i) => a + Number(i.budget_amount || 0), 0)
  const anySaving = Object.keys(saving).length > 0
  const anyError = Object.values(errors).find(Boolean)

  // Per-cell saves (lib/leveling-cell-saves): only the newest save's response for a
  // cell counts, saves for one cell go out one at a time (so the newest is written
  // last), and reverting a cell to its saved amount while an earlier save is still
  // pending sends a compensating save instead of a no-op.
  const { commit, flushAmount } = levelingCellOps(
    { reqSeq, inFlight, chains, draftsRef, entriesRef, timers },
    { saveCell, onEntry, setSaving, setErrors, clearDraft, bidPackageId },
  )

  function onType(sub, item, text) {
    const k = levelingKey(sub.id, item.id)
    setDraft(k, text)
    clearTimeout(timers.current[k])
    timers.current[k] = setTimeout(() => flushAmount(sub, item), DEBOUNCE_MS)
  }

  // Totals use what is on screen (drafts included) so they follow the typing.
  const liveMap = { ...map }
  for (const [k, text] of Object.entries(drafts)) {
    const p = parseLevelingAmount(text)
    if (!p.error) liveMap[k] = { ...(map[k] || { included: true }), amount: p.amount }
  }

  const th = { padding: '8px 10px', fontSize: '10px', fontWeight: 800, color: '#6b7280', letterSpacing: '1.2px', textTransform: 'uppercase' }
  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', minHeight: '18px', marginBottom: '6px' }}>
        {!canEdit && <span style={{ fontSize: '11px', color: '#6b7280' }}>View only</span>}
        {anySaving && <span style={{ fontSize: '11px', color: '#6b7280' }}>Saving…</span>}
        {anyError && <span style={{ fontSize: '11px', color: '#dc2626' }}>⚠ {anyError}</span>}
      </div>
      {gaps.length > 0 && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 14px', marginBottom: '10px', fontSize: '12px', color: '#dc2626' }}>⚠ {gaps.length} scope item{gaps.length !== 1 ? 's' : ''} excluded by all subs — potential gap in coverage</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: `${300 + subs.length * 120}px` }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ ...th, textAlign: 'left', minWidth: '200px' }}>Scope Item</th>
              <th style={{ ...th, textAlign: 'right', width: '90px' }}>Budget</th>
              {subs.map(sub => (
                <th key={sub.id} style={{ padding: '8px 10px', textAlign: 'center', width: '120px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: sub.status === 'awarded' ? '#16a34a' : '#111827' }}>{sub.company_name || sub.sub_email || 'Bidder'}</div>
                  <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500, marginTop: '2px' }}>{sub.amount != null && sub.amount !== '' ? `${money(sub.amount)} bid` : 'no quote'}{sub.trade ? ` · ${sub.trade}` : ''}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([trade, tradeItems]) => {
              const shown = new Set((filterByTrade ? subsForTrade(subs, trade) : subs).map(s => s.id))
              return [
                <tr key={`hdr-${trade}`}>
                  <td colSpan={2 + subs.length} style={{ padding: '8px 10px 3px', fontSize: '9px', fontWeight: 800, color: '#e8590c', letterSpacing: '2px', textTransform: 'uppercase', background: '#f3f4f6', borderTop: '1px solid #e5e7eb' }}>{trade}</td>
                </tr>,
                ...tradeItems.map(item => {
                  const isGap = gaps.includes(item)
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6', background: isGap ? '#fff5f5' : 'transparent' }}>
                      <td style={{ padding: '8px 10px', color: isGap ? '#dc2626' : '#374151' }}>{isGap && <span style={{ marginRight: '5px' }}>⚠</span>}{item.description || '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{Number(item.budget_amount) > 0 ? money(item.budget_amount) : '—'}</td>
                      {subs.map(sub => {
                        if (!shown.has(sub.id)) return <td key={sub.id} style={{ padding: '6px 8px', textAlign: 'center', color: '#d1d5db' }} title="Did not bid this trade">n/a</td>
                        const k = levelingKey(sub.id, item.id)
                        const entry = map[k]
                        const excluded = isExcluded(entry)
                        const hasEntry = !!entry
                        const value = k in drafts ? drafts[k] : (entry?.amount ?? '')
                        return (
                          <td key={sub.id} style={{ padding: '6px 8px', textAlign: 'center', background: excluded ? '#fef2f2' : hasEntry ? '#f0fdf4' : 'transparent' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                              <button type="button" disabled={!canEdit || !!saving[k]}
                                onClick={() => commit(sub, item, { included: nextIncluded(entry) })}
                                title={!canEdit ? (excluded ? 'Excluded' : hasEntry ? 'Included' : 'Not marked') : excluded ? 'Click to mark included' : hasEntry ? 'Click to mark excluded' : 'Click to mark included'}
                                aria-label={excluded ? 'Excluded' : hasEntry ? 'Included' : 'Not marked'}
                                style={{ width: '30px', height: '24px', border: `1px solid ${excluded ? '#fecaca' : hasEntry ? '#bbf7d0' : '#d1d5db'}`, borderRadius: '4px', background: excluded ? '#fee2e2' : hasEntry ? '#dcfce7' : '#fff', color: excluded ? '#dc2626' : hasEntry ? '#16a34a' : '#9ca3af', fontSize: '14px', cursor: canEdit ? 'pointer' : 'default', padding: 0 }}>
                                {excluded ? '✗' : hasEntry ? '✓' : '·'}
                              </button>
                              <input type="text" inputMode="decimal" value={value} placeholder="—" disabled={!canEdit || excluded}
                                onChange={e => onType(sub, item, e.target.value)}
                                onBlur={() => flushAmount(sub, item)}
                                title={errors[k] || (value === '' ? 'Blank = not quoted' : '')}
                                style={{ width: '96px', background: excluded || !canEdit ? '#f9fafb' : '#fff', border: `1px solid ${errors[k] ? '#fca5a5' : '#e5e7eb'}`, borderRadius: '4px', color: excluded ? '#d1d5db' : '#111827', padding: '3px 6px', fontSize: '11px', textAlign: 'right', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                }),
              ]
            })}
            <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f9fafb' }}>
              <td style={{ padding: '10px', fontSize: '11px', fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px' }}>Leveled Total</td>
              <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{budgetTotal > 0 ? money(budgetTotal) : '—'}</td>
              {subs.map(sub => {
                const lev = leveledTotal(sub, scopeItems, liveMap)
                const any = hasLeveledAmounts(sub, scopeItems, liveMap)
                const raw = Number(sub.amount)
                const diff = Math.round((lev - raw) * 100) / 100
                return (
                  <td key={sub.id} style={{ padding: '10px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: sub.status === 'awarded' ? '#16a34a' : '#111827', fontVariantNumeric: 'tabular-nums' }}>{any ? money(lev) : '—'}</div>
                    {any && Number.isFinite(raw) && raw > 0 && diff !== 0 && <div style={{ fontSize: '10px', color: diff > 0 ? '#d97706' : '#16a34a', marginTop: '2px' }}>{diff > 0 ? '+' : '-'}{money(Math.abs(diff))} vs bid</div>}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#9ca3af' }}>Blank = not quoted; $0 = quoted at zero. Excluded lines don&apos;t count toward the leveled total. Amounts save when you leave the box or pause typing.</p>
    </div>
  )
}
