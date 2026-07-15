'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const ROLES = [
  { value: 'pm',            label: 'PM',          color: '#e8590c', portal: '/dashboard' },
  { value: 'apm',           label: 'APM',          color: '#f59e0b', portal: '/dashboard' },
  { value: 'admin',         label: 'Admin',        color: '#06b6d4', portal: '/admin' },
  { value: 'super',         label: 'Super',        color: '#3b82f6', portal: '/field' },
  { value: 'subcontractor', label: 'Sub',          color: '#22c55e', portal: '/submit' },
  { value: 'sub_pm',        label: 'Sub PM',       color: '#a78bfa', portal: '/submit' },
  { value: 'sub_admin',     label: 'Sub Admin',    color: '#ec4899', portal: '/submit' },
]

export default function DevRoleSwitcher() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [devRole, setDevRole] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('nvc_pm_session') === '1') setVisible(true)
    const r = localStorage.getItem('nvc_dev_role')
    if (r) setDevRole(r)
  }, [])

  if (!visible) return null

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

  return (
    <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999, fontFamily: 'system-ui, sans-serif' }}>
      {open && (
        <div style={{ background: '#111', border: '1px solid #333', borderRadius: '12px', padding: '12px', marginBottom: '8px', minWidth: '180px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          <p style={{ margin: '0 0 10px', fontSize: '10px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>View as role</p>
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
