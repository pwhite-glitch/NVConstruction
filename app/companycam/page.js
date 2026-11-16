'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { authFetch } from '../../lib/client-fetch'
import { photoDateCentral } from '../../lib/photo-taken-at'
import { siteUrl } from '../../lib/site-url'

// Owner-only: CompanyCam photos that did not land in a job (project not linked, or the import
// failed). Assign one to a job (optionally linking its CompanyCam project) or dismiss it.
// Also registers / updates the CompanyCam webhook (token comes from Vercel env, never shown).
const s = {
  page: { minHeight: '100vh', background: '#f4f6f8', padding: '1.5rem 1rem' },
  wrap: { maxWidth: '1000px', margin: '0 auto' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 4px 24px rgba(0,0,0,0.05)', marginBottom: '1rem' },
  h1: { fontSize: '20px', fontWeight: '700', color: '#111827', margin: '0 0 4px' },
  h2: { fontSize: '14px', fontWeight: '700', color: '#111827', margin: '0 0 8px' },
  sub: { fontSize: '13px', color: '#6b7280', margin: 0 },
  input: { padding: '7px 10px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#111827', boxSizing: 'border-box', maxWidth: '100%' },
  btn: { padding: '7px 12px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnGray: { padding: '7px 12px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  err: { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 10px', borderRadius: '6px', fontSize: '13px', marginTop: '8px' },
  ok: { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', padding: '8px 10px', borderRadius: '6px', fontSize: '13px', marginTop: '8px' },
  link: { color: '#e8590c', fontWeight: '600', textDecoration: 'none', fontSize: '13px' },
  code: { fontFamily: 'monospace', fontSize: '12px', background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px', wordBreak: 'break-all' },
}

async function api(url, opts = {}) {
  const res = await authFetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } })
  let data = null
  try { data = await res.json() } catch { data = null }
  return { ok: res.ok, status: res.status, data: data || {} }
}

export default function CompanyCamInbox() {
  const router = useRouter()
  const [role, setRole] = useState(null)
  const [ready, setReady] = useState(false)
  const [rows, setRows] = useState([])
  const [jobs, setJobs] = useState([])
  const [loadErr, setLoadErr] = useState('')
  const [needs074, setNeeds074] = useState(false)
  const [pick, setPick] = useState({}) // inbox id → job id
  const [linkProject, setLinkProject] = useState({}) // inbox id → bool (default on)
  const [busy, setBusy] = useState(null)
  const [rowMsg, setRowMsg] = useState({}) // inbox id → { ok, text }
  const [hookBusy, setHookBusy] = useState(false)
  const [hookMsg, setHookMsg] = useState(null)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
    setRole(profile?.role || null)
    setReady(true)
    if (profile?.role !== 'principal') return
    await Promise.all([loadRows(), loadJobs()])
  }

  async function loadRows() {
    const r = await api('/api/companycam/unmatched')
    if (!r.ok) { setLoadErr(r.data.error || `Error ${r.status}`); return }
    setLoadErr('')
    setNeeds074(r.data.migration_required === '074')
    setRows(r.data.rows || [])
  }

  async function loadJobs() {
    const { data, error } = await supabase.from('jobs').select('id, project_name, job_number, job_type, archived').order('project_name', { ascending: true })
    if (error) { setLoadErr(error.message); return }
    setJobs((data || []).filter(j => !j.archived))
  }

  async function assign(row) {
    const jobId = pick[row.id]
    if (!jobId) { setRowMsg(m => ({ ...m, [row.id]: { ok: false, text: 'Pick a job first.' } })); return }
    setBusy(row.id)
    const r = await api('/api/companycam/unmatched', { method: 'POST', body: JSON.stringify({ inbox_id: row.id, action: 'assign', job_id: jobId, link_project: linkProject[row.id] !== false }) })
    setBusy(null)
    if (!r.ok) { setRowMsg(m => ({ ...m, [row.id]: { ok: false, text: r.data.error || `Error ${r.status}` } })); return }
    const extra = r.data.linked ? ` Project linked${r.data.also_imported ? `; ${r.data.also_imported} more photo(s) imported` : ''}${r.data.remaining_for_project ? `; ${r.data.remaining_for_project} still waiting` : ''}.` : ''
    setRowMsg(m => ({ ...m, [row.id]: { ok: true, text: `Imported.${extra}${r.data.note ? ' ' + r.data.note : ''}` } }))
    await loadRows()
  }

  async function dismiss(row) {
    if (!window.confirm('Dismiss this photo? It stays in CompanyCam; it just leaves this list.')) return
    setBusy(row.id)
    const r = await api('/api/companycam/unmatched', { method: 'POST', body: JSON.stringify({ inbox_id: row.id, action: 'dismiss' }) })
    setBusy(null)
    if (!r.ok) { setRowMsg(m => ({ ...m, [row.id]: { ok: false, text: r.data.error || `Error ${r.status}` } })); return }
    await loadRows()
  }

  async function registerHook() {
    setHookBusy(true); setHookMsg(null)
    const r = await api('/api/companycam/register-webhook', { method: 'POST', body: '{}' })
    setHookBusy(false)
    if (!r.ok) { setHookMsg({ ok: false, text: r.data.error || `Error ${r.status}` }); return }
    const d = r.data
    setHookMsg({ ok: true, text: `Webhook ${d.action} (id ${d.webhook_id}) → ${d.url} · ${(d.scopes || []).join(', ')} · ${d.enabled ? 'enabled' : 'disabled'}${d.deleted?.length ? ` · replaced old webhook(s): ${d.deleted.join(', ')}` : ''}` })
  }

  if (!ready) return <div style={s.page}><div style={s.wrap}><p style={s.sub}>Loading…</p></div></div>
  if (role !== 'principal') return <div style={s.page}><div style={s.wrap}><div style={s.card}><p style={s.h1}>Owners only</p><p style={s.sub}>This page is for company Owners.</p></div></div></div>

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <div style={{ marginBottom: '1rem' }}>
          <a href="/dashboard" style={s.link}>← Dashboard</a>
          <p style={{ ...s.h1, marginTop: '8px' }}>Unmatched CompanyCam photos</p>
          <p style={s.sub}>Photos from CompanyCam projects not linked to a portal job (or whose import failed). Assigned photos go in the job's Photos as internal only.</p>
        </div>

        <div style={s.card}>
          <p style={s.h2}>CompanyCam webhook</p>
          <p style={s.sub}>Receiver URL: <span style={s.code}>{siteUrl('/api/companycam/webhook')}</span></p>
          <p style={{ ...s.sub, marginTop: '6px' }}>Needs COMPANYCAM_API_TOKEN and COMPANYCAM_WEBHOOK_TOKEN set in Vercel. Registering creates the photo.created webhook, or updates the existing one with the current token.</p>
          <div style={{ marginTop: '10px' }}><button type="button" style={s.btn} disabled={hookBusy} onClick={registerHook}>{hookBusy ? 'Working…' : 'Register / update webhook'}</button></div>
          {hookMsg && <div style={hookMsg.ok ? s.ok : s.err}>{hookMsg.text}</div>}
        </div>

        {needs074 && <div style={s.err}>Needs database migration 074 before CompanyCam photos can be stored.</div>}
        {loadErr && <div style={s.err}>{loadErr}</div>}

        {!needs074 && rows.length === 0 && !loadErr && <div style={s.card}><p style={s.sub}>Nothing waiting. Every CompanyCam photo has a job.</p></div>}

        {rows.map(row => (
          <div key={row.id} style={{ ...s.card, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {row.thumbnail_url
              ? <img src={row.thumbnail_url} alt={row.caption || 'CompanyCam photo'} loading="lazy" style={{ width: '120px', height: '90px', objectFit: 'cover', borderRadius: '6px', background: '#f3f4f6' }} />
              : <div style={{ width: '120px', height: '90px', borderRadius: '6px', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#9ca3af' }}>No preview</div>}
            <div style={{ flex: '1 1 260px', minWidth: 0, fontSize: '13px', color: '#374151' }}>
              <div style={{ fontWeight: 600 }}>Project {row.companycam_project_id || '—'}{row.project_name ? ` — ${row.project_name}` : ''}</div>
              <div style={{ color: '#6b7280' }}>{row.creator_name || 'Unknown'}{row.captured_at ? ` · ${photoDateCentral(row.captured_at)}` : ''}{row.caption ? ` · ${row.caption}` : ''}</div>
              <div style={{ color: row.status === 'failed' ? '#dc2626' : '#a16207', fontSize: '12px' }}>{row.status}{row.last_error ? ` — ${row.last_error}` : ''}{row.attempts > 1 ? ` (${row.attempts} attempts)` : ''}</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
                <select style={s.input} value={pick[row.id] || ''} onChange={e => setPick(p => ({ ...p, [row.id]: e.target.value }))}>
                  <option value="">Choose a job…</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number ? `#${j.job_number} ` : ''}{j.project_name || j.id}{j.job_type === 'residential' ? ' (Residential)' : ''}</option>)}
                </select>
                {row.companycam_project_id && (
                  <label style={{ fontSize: '12px', display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                    <input type="checkbox" checked={linkProject[row.id] !== false} onChange={e => setLinkProject(m => ({ ...m, [row.id]: e.target.checked }))} />
                    Also link this CompanyCam project to the job
                  </label>
                )}
                <button type="button" style={s.btn} disabled={busy === row.id} onClick={() => assign(row)}>{busy === row.id ? 'Working…' : 'Assign'}</button>
                <button type="button" style={s.btnGray} disabled={busy === row.id} onClick={() => dismiss(row)}>Dismiss</button>
              </div>
              {rowMsg[row.id] && <div style={rowMsg[row.id].ok ? s.ok : s.err}>{rowMsg[row.id].text}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
