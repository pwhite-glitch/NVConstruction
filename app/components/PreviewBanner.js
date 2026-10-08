'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const ROLE_LABELS = {
  pm:            'PM (Project Manager)',
  apm:           'APM (Asst. Project Manager)',
  super:         'Superintendent',
  admin:         'Admin',
  subcontractor: 'Subcontractor',
  sub_pm:        'Sub PM',
  sub_admin:     'Sub Admin',
  owner:         'Owner',
}

const ROLE_COLORS = {
  pm: '#e8590c', apm: '#f59e0b', admin: '#06b6d4', super: '#3b82f6',
  subcontractor: '#22c55e', sub_pm: '#a78bfa', sub_admin: '#ec4899', owner: '#10b981',
}

function getCookie(name) {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

export default function PreviewBanner() {
  const [preview, setPreview] = useState(null)  // null=loading, false=off, object=active
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const role    = getCookie('nvc_preview_role')
    const company = getCookie('nvc_preview_company')
    if (role) {
      setPreview({ role, company })
      // Sync to localStorage so existing pages pick up the override
      localStorage.setItem('nvc_dev_role', role === 'pm' ? '' : role)
      if (role !== 'pm') localStorage.setItem('nvc_pm_session', '1')
      document.body.style.paddingTop = '40px'
    } else {
      setPreview(false)
    }
    return () => { document.body.style.paddingTop = '' }
  }, [])

  async function exitPreview() {
    setExiting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        await fetch('/api/preview-session', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      }
    } catch (e) {
      console.error('[PreviewBanner] exit error:', e)
    }
    localStorage.removeItem('nvc_dev_role')
    window.location.href = '/dashboard'
  }

  if (!preview) return null

  const color = ROLE_COLORS[preview.role] || '#6b7280'

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
      height: '40px',
      background: '#111827',
      borderBottom: `3px solid ${color}`,
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '0 20px',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <span style={{
        width: '7px', height: '7px', borderRadius: '50%',
        background: color, flexShrink: 0,
      }} />
      <span style={{
        fontSize: '11px', fontWeight: '700', color,
        letterSpacing: '0.5px', textTransform: 'uppercase',
      }}>
        Preview Mode
      </span>
      <span style={{ fontSize: '13px', color: '#d1d5db' }}>
        Viewing as{' '}
        <strong style={{ color: '#fff' }}>
          {ROLE_LABELS[preview.role] || preview.role}
        </strong>
        {preview.company
          ? <span style={{ color: '#6b7280', fontSize: '12px' }}> · company {preview.company.slice(0, 8)}…</span>
          : null}
      </span>
      <span style={{ fontSize: '11px', color: '#4b5563', marginLeft: '4px' }}>
        Record changes are blocked.
      </span>
      <button
        onClick={exitPreview}
        disabled={exiting}
        style={{
          marginLeft: 'auto',
          padding: '4px 14px',
          background: '#1f2937',
          color: '#d1d5db',
          border: '1px solid #374151',
          borderRadius: '5px',
          fontSize: '12px',
          fontWeight: '600',
          cursor: exiting ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {exiting ? 'Exiting…' : 'Exit Preview'}
      </button>
    </div>
  )
}
