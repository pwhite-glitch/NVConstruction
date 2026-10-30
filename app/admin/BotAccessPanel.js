'use client'
import { useState, useEffect } from 'react'
import { authFetch } from '../../lib/client-fetch'

// Bot Access tab on /admin. Shown only to partners (lib/partners.js);
// /api/admin/bot-keys checks the same list on the server.

const st = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' },
  name: { fontSize: '14px', fontWeight: '700', color: '#111827', margin: 0 },
  sub: { fontSize: '12px', color: '#6b7280', margin: '2px 0 0' },
  mono: { fontFamily: 'monospace', fontSize: '13px', color: '#111827' },
  btn: { padding: '7px 14px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnGray: { padding: '7px 14px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' },
  btnRed: { padding: '7px 14px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  pill: (on) => ({ padding: '2px 9px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', background: on ? '#dcfce7' : '#f3f4f6', color: on ? '#15803d' : '#6b7280', border: `1px solid ${on ? '#bbf7d0' : '#e5e7eb'}` }),
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' },
  modal: { background: '#fff', borderRadius: '10px', padding: '1.5rem', width: '100%', maxWidth: '560px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  warn: { background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: '6px', padding: '10px 12px', fontSize: '13px', margin: '12px 0' },
  keyBox: { fontFamily: 'monospace', fontSize: '13px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px 12px', wordBreak: 'break-all', userSelect: 'all' },
  err: { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 12px', borderRadius: '6px', fontSize: '13px', marginBottom: '1rem' },
}

const fmtWhen = (ts) => ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'

export default function BotAccessPanel() {
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [newKey, setNewKey] = useState(null) // { botName, key }
  const [copied, setCopied] = useState(false)

  async function load() {
    setLoading(true)
    const res = await authFetch('/api/admin/bot-keys')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setError(json.error || 'Failed to load bots')
    else { setBots(json.bots || []); setError('') }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function post(body) {
    const res = await authFetch('/api/admin/bot-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Request failed')
    return json
  }

  async function rotate(bot) {
    const verb = bot.key ? 'Rotate' : 'Generate'
    if (bot.key && !window.confirm(`Rotate the key for ${bot.full_name}?\n\nThe current key (${bot.key.key_prefix}…) stops working immediately.`)) return
    setBusy(bot.id); setError('')
    try {
      const json = await post({ action: 'rotate', bot_user_id: bot.id })
      setCopied(false)
      setNewKey({ botName: bot.full_name, key: json.key })
      await load()
    } catch (e) { setError(`${verb} failed: ${e.message}`) }
    setBusy(null)
  }

  async function setEnabled(bot, enabled) {
    setBusy(bot.id); setError('')
    try { await post({ action: 'set_enabled', key_id: bot.key.id, enabled }); await load() } catch (e) { setError(e.message) }
    setBusy(null)
  }

  async function revoke(bot) {
    if (!window.confirm(`Revoke the key for ${bot.full_name}?\n\n${bot.key.key_prefix}… stops working immediately. Generate a new key to restore access.`)) return
    setBusy(bot.id); setError('')
    try { await post({ action: 'revoke', key_id: bot.key.id }); await load() } catch (e) { setError(e.message) }
    setBusy(null)
  }

  async function copyKey() {
    try { await navigator.clipboard.writeText(newKey.key); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#111827' }}>Bot Access</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
          API keys for the portal bots (docs/bot-api.md). Each bot's changes show in history under its own name. Partners only.
        </p>
      </div>
      {error && <div style={st.err}>{error}</div>}
      {loading ? <p style={{ color: '#9ca3af', fontSize: '14px' }}>Loading...</p>
        : bots.length === 0 ? <p style={{ color: '#9ca3af', fontSize: '14px' }}>No bot users yet. Run scripts/create-bot-users.js.</p>
        : bots.map(bot => (
          <div key={bot.id} style={st.card}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <p style={st.name}>{bot.full_name}</p>
              <p style={st.sub}>{bot.email}</p>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              {bot.key ? (
                <>
                  <span style={st.pill(bot.key.enabled)}>{bot.key.enabled ? 'Enabled' : 'Disabled'}</span>
                  <span style={{ ...st.mono, marginLeft: '10px' }}>{bot.key.key_prefix}…</span>
                  <p style={st.sub}>Last used: {fmtWhen(bot.key.last_used_at)}</p>
                </>
              ) : <span style={st.pill(false)}>No key</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {bot.key && (
                <button style={st.btnGray} disabled={busy === bot.id} onClick={() => setEnabled(bot, !bot.key.enabled)}>
                  {bot.key.enabled ? 'Turn off' : 'Turn on'}
                </button>
              )}
              {bot.key && <button style={st.btnRed} disabled={busy === bot.id} onClick={() => revoke(bot)}>Revoke</button>}
              <button style={{ ...st.btn, opacity: busy === bot.id ? 0.6 : 1 }} disabled={busy === bot.id} onClick={() => rotate(bot)}>
                {bot.key ? 'Rotate key' : 'Generate key'}
              </button>
            </div>
          </div>
        ))}

      {newKey && (
        <div style={st.overlay}>
          <div style={st.modal}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#111827' }}>New key for {newKey.botName}</h3>
            <div style={st.warn}>
              Copy this key now. It is shown only once and can't be recovered. Anyone with it can act as this bot, so store it in a secret manager and never paste it into chat or code.
            </div>
            <div style={st.keyBox}>{newKey.key}</div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button style={st.btnGray} onClick={copyKey}>{copied ? 'Copied ✓' : 'Copy'}</button>
              <button style={st.btn} onClick={() => { setNewKey(null); setCopied(false) }}>I've saved it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
