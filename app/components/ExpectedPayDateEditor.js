'use client'
// Compact Owner-only "Expected pay" date editor for a pay app, lender draw or
// sub billing. Saves only expected_payment_date via /api/expected-payment-date
// (server re-checks Owner). Render it only for principals; the server refuses
// everyone else anyway. Planning date only — never unlocks or changes money.
import { useState, useEffect } from 'react'
import { authFetch } from '../../lib/client-fetch'

export default function ExpectedPayDateEditor({ entity, id, value, onSaved, label = 'Expected pay', compact = false }) {
  const [draft, setDraft] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState(null)
  useEffect(() => { setDraft(value || '') }, [value])
  const dirty = (draft || '') !== (value || '')

  async function save(next) {
    setSaving(true); setError(''); setSavedAt(null)
    try {
      const res = await authFetch('/api/expected-payment-date', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id, expected_payment_date: next || null }),
      })
      let body = null
      try { body = await res.json() } catch {}
      if (!res.ok || !body?.ok) { setError(body?.error || `Save failed (${res.status}).`); return }
      setDraft(body.expected_payment_date || '')
      setSavedAt(Date.now())
      onSaved?.(body.expected_payment_date || null)
    } catch (e) {
      setError(e?.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const btn = { fontSize: '11px', padding: '2px 8px', borderRadius: '5px', border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px', color: '#6b7280' }} onClick={e => e.stopPropagation()}>
      {!compact && <span>{label}:</span>}
      <input type="date" aria-label={label} value={draft} disabled={saving} onChange={e => { setDraft(e.target.value); setError(''); setSavedAt(null) }}
        style={{ fontSize: '11px', padding: '2px 4px', border: `1px solid ${dirty ? '#f59e0b' : '#d1d5db'}`, borderRadius: '5px', color: '#111827', background: '#fff' }} />
      {dirty && <button type="button" style={{ ...btn, background: '#111827', color: '#fff', borderColor: '#111827' }} disabled={saving} onClick={() => save(draft)}>{saving ? 'Saving…' : 'Save'}</button>}
      {dirty && !saving && <button type="button" style={btn} onClick={() => { setDraft(value || ''); setError('') }}>Cancel</button>}
      {!dirty && value && <button type="button" style={btn} disabled={saving} onClick={() => save(null)} title="Clear the expected date">{saving ? 'Clearing…' : 'Clear'}</button>}
      {dirty && !saving && <span style={{ color: '#b45309' }}>unsaved</span>}
      {savedAt && !dirty && <span style={{ color: '#16a34a' }}>saved</span>}
      {error && <span role="alert" style={{ color: '#dc2626', maxWidth: '360px' }}>{error}</span>}
    </span>
  )
}
