'use client'

import { useEffect, useRef } from 'react'

// Phone-only top bar (hamburger + short title) for portals whose left sidebar
// becomes an off-canvas drawer under 640px (sales, submit, owner, admin).
// Hidden above 640px by .rx-mobile-topbar / .rx-drawer-backdrop in globals.css.
// Pure layout chrome: it only toggles the caller's open/closed state.
export default function MobileTopBar({ title, open, onToggle, onClose }) {
  // Callers pass an inline arrow; keep the latest one in a ref so the Escape
  // listener is only (re)attached when `open` changes, not on every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onCloseRef.current?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <div className="rx-mobile-topbar">
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={!!open}
          onClick={onToggle}
          style={{ width: '44px', height: '44px', minWidth: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: '#fff', fontSize: '22px', lineHeight: 1, cursor: 'pointer', padding: 0, flexShrink: 0 }}
        >
          {open ? '✕' : '☰'}
        </button>
        <span style={{ fontSize: '15px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {title}
        </span>
      </div>
      <div
        className={'rx-drawer-backdrop' + (open ? ' rx-open' : '')}
        aria-hidden="true"
        onClick={onClose}
      />
    </>
  )
}
