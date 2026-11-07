'use client'
// Staff-side RFI comment thread (commercial + residential job pages).
// Reads/writes through /api/rfi-comments, which scopes to the RFI's real job,
// stamps the author from the session and notifies nobody for staff replies.
import React, { useEffect, useState, useCallback } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { roleLabel } from '../../lib/roles'

export async function loadRfiComments(rfiId, fetchFn = authFetch) {
  try {
    const res = await fetchFn(`/api/rfi-comments?rfi_id=${encodeURIComponent(rfiId)}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { error: data?.error || `server returned ${res.status}` }
    const comments = [...(data?.comments || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    return { comments }
  } catch (e) {
    return { error: e?.message || 'network error' }
  }
}

export async function postRfiComment(rfiId, comment, fetchFn = authFetch) {
  try {
    const res = await fetchFn('/api/rfi-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfi_id: rfiId, comment }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.comment) return { error: data?.error || `server returned ${res.status}` }
    return { comment: data.comment }
  } catch (e) {
    return { error: e?.message || 'network error' }
  }
}

const fmt = d => (d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export default function RfiCommentThread({ rfiId, readOnly = false, readOnlyReason = 'Disabled in role preview' }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const r = await loadRfiComments(rfiId)
    if (r.error) setLoadError(r.error)
    else setComments(r.comments)
    setLoading(false)
  }, [rfiId])

  useEffect(() => { reload() }, [reload])

  async function send() {
    const text = draft.trim()
    if (!text || readOnly) return
    setSending(true)
    setSendError('')
    try {
      const r = await postRfiComment(rfiId, text)
      if (r.error) { setSendError(`Reply not sent: ${r.error}. Your text is kept — try again.`); return }
      setDraft('')
      setComments(prev => [...prev, r.comment])
      reload()
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Owner comments</div>
      {loading && comments.length === 0 ? (
        <div style={{ fontSize: '12px', color: '#6b7280' }}>Loading comments…</div>
      ) : loadError ? (
        <div role="alert" style={{ fontSize: '12px', color: '#dc2626' }}>Could not load comments: {loadError} <button type="button" onClick={reload} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '12px', padding: 0 }}>Retry</button></div>
      ) : comments.length === 0 ? (
        <div style={{ fontSize: '12px', color: '#9ca3af' }}>No comments yet.</div>
      ) : (
        comments.map(c => (
          <div key={c.id} style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: '#6b7280', marginBottom: '2px' }}>
              <span><strong style={{ color: '#111827' }}>{c.author_name || 'Unknown'}</strong>{c.author_role ? ` · ${c.author_role === 'owner' ? 'Owner (client)' : roleLabel(c.author_role)}` : ''}</span>
              <span>{fmt(c.created_at)}</span>
            </div>
            <div style={{ fontSize: '13px', color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.comment}</div>
          </div>
        ))
      )}
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        disabled={readOnly}
        placeholder={readOnly ? readOnlyReason : 'Reply to the owner…'}
        style={{ width: '100%', minHeight: '60px', marginTop: '6px', padding: '8px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', boxSizing: 'border-box', fontFamily: 'inherit' }}
      />
      {sendError && <div role="alert" style={{ fontSize: '12px', color: '#dc2626', marginTop: '4px' }}>{sendError}</div>}
      <button
        type="button"
        onClick={send}
        disabled={readOnly || sending || !draft.trim()}
        title={readOnly ? readOnlyReason : undefined}
        style={{ marginTop: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', cursor: readOnly || sending || !draft.trim() ? 'not-allowed' : 'pointer', opacity: readOnly || sending || !draft.trim() ? 0.6 : 1 }}
      >
        {sending ? 'Sending…' : 'Send reply'}
      </button>
    </div>
  )
}
