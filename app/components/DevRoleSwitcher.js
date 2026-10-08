'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import supabase from '../../lib/supabase'

const ROLES = [
  { value: 'pm',            label: 'PM',          color: '#e8590c', portal: '/dashboard' },
  { value: 'apm',           label: 'APM',          color: '#f59e0b', portal: '/dashboard' },
  { value: 'admin',         label: 'Admin',        color: '#06b6d4', portal: '/admin' },
  { value: 'super',         label: 'Super',        color: '#3b82f6', portal: '/field' },
  { value: 'subcontractor', label: 'Sub',          color: '#22c55e', portal: '/submit' },
  { value: 'sub_pm',        label: 'Sub PM',       color: '#a78bfa', portal: '/submit' },
  { value: 'sub_admin',     label: 'Sub Admin',    color: '#ec4899', portal: '/submit' },
  { value: 'owner',         label: 'Owner',        color: '#10b981', portal: '/owner' },
]

const SUB_ROLES = new Set(['subcontractor', 'sub_pm', 'sub_admin'])

// Fixed staging companies seeded by migration 019_preview_seed.sql
const PREVIEW_COMPANIES = [
  { id: '11111111-1111-4111-8111-111111111111', name: '[PREVIEW] Acme Framing Co.' },
  { id: '22222222-2222-4222-8222-222222222222', name: '[PREVIEW] Precision Electric LLC' },
]

function getCookie(name) {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

export default function DevRoleSwitcher() {
  const router = useRouter()
  const [open, setOpen]               = useState(false)
  const [tab, setTab]                 = useState('local') // 'local' | 'server'
  const [devRole, setDevRole]         = useState(null)
  const [visible, setVisible]         = useState(false)
  const [previewActive, setPreviewActive] = useState(false)

  // Server preview form state
  const [spRole, setSpRole]           = useState('subcontractor')
  const [spCompany, setSpCompany]     = useState(PREVIEW_COMPANIES[0].id)
  const [starting, setStarting]       = useState(false)
  const [spError, setSpError]         = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('nvc_pm_session') === '1') setVisible(true)
    const r = localStorage.getItem('nvc_dev_role')
    if (r) setDevRole(r)
    if (getCookie('nvc_preview_role')) setPreviewActive(true)
  }, [])

  if (!visible) return null

  // When a server preview is running, defer to the PreviewBanner
  if (previewActive) return null

  const current = ROLES.find(r => r.value === (devRole || 'pm')) || ROLES[0]

  function switchRole(role) {
    if (role.value === 'pm') {
      localStorage.removeItem('nvc_dev_role')
      setDevRole(null)
    } else {
      localStorage.setItem('nvc_dev_role', role.value)
      setDevRole(role.value)
    }
    setOpen(false)
    router.push(role.portal)
    router.refresh()
  }

  async function startServerPreview() {
    setStarting(true)
    setSpError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setSpError('Not authenticated.'); return }

      const body = { previewRole: spRole }
      if (SUB_ROLES.has(spRole)) body.previewCompanyId = spCompany

      const res = await fetch('/api/preview-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSpError(err.error || `HTTP ${res.status}`)
        return
      }

      // Reload so the PreviewBanner cookie is read
      window.location.reload()
    } catch (e) {
      setSpError(e.message || 'Unknown error')
    } finally {
      setStarting(false)
    }
  }

  const panelBg = { background: '#111', border: '1px solid #333', borderRadius: '12px', padding: '12px', marginBottom: '8px', minWidth: '220px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }
  const labelStyle = { margin: '0 0 8px', fontSize: '10px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }
  const tabBtn = (active) => ({ padding: '4px 10px', borderRadius: '5px', border: 'none', background: active ? '#1e1e1e' : 'transparent', color: active ? '#fff' : '#666', cursor: 'pointer', fontSize: '11px', fontWeight: '600' })
  const selectStyle = { width: '100%', padding: '6px 8px', borderRadius: '6px', background: '#1e1e1e', border: '1px solid #333', color: '#ccc', fontSize: '12px', marginBottom: '6px', cursor: 'pointer' }

  return (
    <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999, fontFamily: 'system-ui, sans-serif' }}>
      {open && (
        <div style={panelBg}>
          {/* Tab strip */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
            <button style={tabBtn(tab === 'local')}  onClick={() => setTab('local')}>Local</button>
            <button style={tabBtn(tab === 'server')} onClick={() => setTab('server')}>Server Preview</button>
          </div>

          {tab === 'local' && (
            <>
              <p style={labelStyle}>View as role (localStorage only)</p>
              {ROLES.map(role => (
                <button
                  key={role.value}
                  onClick={() => switchRole(role)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                    padding: '7px 10px', marginBottom: '4px', borderRadius: '7px', border: 'none',
                    background: (devRole || 'pm') === role.value ? '#1e1e1e' : 'transparent',
                    color: (devRole || 'pm') === role.value ? '#fff' : '#999',
                    cursor: 'pointer', fontSize: '13px', fontWeight: '600', textAlign: 'left',
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: role.color, flexShrink: 0 }} />
                  {role.label}
                  {(devRole || 'pm') === role.value && <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#555' }}>active</span>}
                </button>
              ))}
            </>
          )}

          {tab === 'server' && (
            <>
              <p style={labelStyle}>Server-enforced preview</p>
              <p style={{ fontSize: '11px', color: '#666', margin: '0 0 10px', lineHeight: '1.4' }}>
                Sets a signed HttpOnly cookie. Mutations are blocked across all API routes until you exit.
              </p>

              <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Preview role</label>
              <select style={selectStyle} value={spRole} onChange={e => setSpRole(e.target.value)}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>

              {SUB_ROLES.has(spRole) && (
                <>
                  <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Preview company</label>
                  <select style={selectStyle} value={spCompany} onChange={e => setSpCompany(e.target.value)}>
                    {PREVIEW_COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </>
              )}

              {spError && <p style={{ fontSize: '11px', color: '#f87171', margin: '0 0 6px' }}>{spError}</p>}

              <button
                onClick={startServerPreview}
                disabled={starting}
                style={{
                  width: '100%', padding: '8px', borderRadius: '7px', border: 'none',
                  background: '#e8590c', color: '#fff', cursor: starting ? 'wait' : 'pointer',
                  fontSize: '12px', fontWeight: '700',
                }}
              >
                {starting ? 'Starting…' : 'Start Preview'}
              </button>

              <p style={{ fontSize: '10px', color: '#444', margin: '8px 0 0', lineHeight: '1.4' }}>
                Run <code style={{ color: '#888' }}>GET /api/preview-tests</code> to verify staging data boundaries.
              </p>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '7px 12px', borderRadius: '99px', border: `1px solid ${current.color}40`,
          background: '#111', color: current.color, cursor: 'pointer',
          fontSize: '11px', fontWeight: '800', letterSpacing: '1px', textTransform: 'uppercase',
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        }}
      >
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: current.color }} />
        DEV · {current.label}
      </button>
    </div>
  )
}
