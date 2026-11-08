'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { notificationLabel } from '../../lib/notification-labels'

const ago = ts => {
  const d = Math.floor((Date.now() - new Date(ts)) / 60000)
  if (d < 1) return 'just now'
  if (d < 60) return `${d}m ago`
  if (d < 1440) return `${Math.floor(d / 60)}h ago`
  return `${Math.floor(d / 1440)}d ago`
}

const REFRESH_MS = 3 * 60 * 1000

// Header bell + dropdown list for /field and /sales (same API as the sub portal and
// dashboard: GET /api/notifications, PATCH { id } / { mark_all_read }). Loads on mount,
// every few minutes and when the window regains focus. onOpen(n) handles a click.
export default function NotificationBell({ onOpen, dark = false, dropUp = false }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const ref = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/notifications')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(Array.isArray(data?.notifications) ? data.notifications : [])
      setUnread(data?.unread || 0)
      setError(null)
    } catch (e) {
      setError('Could not load notifications.')
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [load])

  useEffect(() => {
    if (!open) return
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close) }
  }, [open])

  async function markRead(id) {
    setItems(prev => prev.map(n => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)))
    setUnread(u => Math.max(0, u - 1))
    try { await authFetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }) } catch {}
  }

  async function markAll() {
    setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
    setUnread(0)
    try { await authFetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mark_all_read: true }) }) } catch {}
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" onClick={() => { setOpen(o => !o); if (!open) load() }} aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        style={{ position: 'relative', background: 'transparent', border: `1px solid ${dark ? '#333' : '#e5e7eb'}`, borderRadius: '8px', width: '36px', height: '36px', cursor: 'pointer', fontSize: '16px', color: dark ? '#f1f1f1' : '#111827', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        🔔
        {unread > 0 && <span style={{ position: 'absolute', top: '-6px', right: '-6px', minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: '99px', background: '#dc2626', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', ...(dropUp ? { left: 0, bottom: '42px' } : { right: 0, top: '42px' }), width: 'min(340px, calc(100vw - 32px))', maxHeight: '70vh', overflowY: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', zIndex: 1000, color: '#111827', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f3f4f6' }}>
            <strong style={{ fontSize: '13px' }}>Notifications</strong>
            {items.some(n => !n.read_at) && <button type="button" onClick={markAll} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '12px', cursor: 'pointer' }}>Mark all read</button>}
          </div>
          {error && <div style={{ padding: '12px 14px', fontSize: '12px', color: '#dc2626' }}>{error}</div>}
          {!error && !loaded && <div style={{ padding: '12px 14px', fontSize: '12px', color: '#6b7280' }}>Loading…</div>}
          {!error && loaded && items.length === 0 && <div style={{ padding: '16px 14px', fontSize: '12px', color: '#6b7280', textAlign: 'center' }}>No notifications yet.</div>}
          {items.map(n => {
            const isUnread = !n.read_at
            return (
              <div key={n.id} role="button" tabIndex={0}
                onClick={() => { if (isUnread) markRead(n.id); setOpen(false); onOpen?.(n) }}
                onKeyDown={e => { if (e.key === 'Enter') { if (isUnread) markRead(n.id); setOpen(false); onOpen?.(n) } }}
                style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', opacity: isUnread ? 1 : 0.6, display: 'flex', gap: '10px' }}>
                <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: isUnread ? '#e8590c' : 'transparent', marginTop: '6px', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: isUnread ? 700 : 500 }}>{n.title}</span>
                    <span style={{ fontSize: '11px', color: '#9ca3af', whiteSpace: 'nowrap' }}>{ago(n.created_at)}</span>
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{notificationLabel(n.type)}</div>
                  {n.body && <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px', lineHeight: 1.4 }}>{n.body}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
