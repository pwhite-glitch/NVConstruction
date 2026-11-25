'use client'
// Prompt 109: small "Actions" dropdown (plain React + inline styles, no packages).
// Controlled: the parent owns `open` so only one menu on the page is open at a time.
// Rendered in a portal on document.body with fixed positioning, so a card with overflow: hidden can't clip it.
//
// groups: [{ key, label, items: [{ id, label, onSelect, disabled, danger, title }] }]
// The menu closes BEFORE an item's onSelect runs (flushSync), so confirm()/alert() never sit over an open menu,
// and onSelect still runs synchronously inside the click (needed for input.click() on a file picker).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'

const GAP = 4
const EDGE = 12
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

const triggerBase = {
  padding: '5px 12px', background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '5px',
  fontSize: '12px', fontWeight: '600', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
}

export default function ActionsMenu({ open, onOpenChange, groups = [], label = 'Actions', triggerStyle, menuLabel }) {
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const itemRefs = useRef([])
  const focusOnOpen = useRef(null) // 'first' | 'last' | null
  const keyOpenedAt = useRef(0)
  const [pos, setPos] = useState(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [isPhone, setIsPhone] = useState(false)

  const visibleGroups = groups.filter(g => g.items && g.items.length > 0)
  const flat = visibleGroups.flatMap(g => g.items)
  const enabledIdx = flat.map((it, i) => (it.disabled ? -1 : i)).filter(i => i >= 0)

  const close = (returnFocus) => {
    onOpenChange(false)
    if (returnFocus && triggerRef.current) triggerRef.current.focus()
  }

  const focusItem = i => {
    setActiveIndex(i)
    const el = itemRefs.current[i]
    if (el) el.focus()
  }

  // Measure and place: right-aligned under the trigger; upward when there isn't room below; clamped to the viewport.
  useIsoLayoutEffect(() => {
    if (!open) { setPos(null); setActiveIndex(-1); return }
    const t = triggerRef.current, m = menuRef.current
    if (!t || !m) return
    const r = t.getBoundingClientRect()
    const vh = window.innerHeight, vw = window.innerWidth
    const menuH = m.offsetHeight, menuW = m.offsetWidth
    const roomBelow = vh - EDGE - r.bottom - GAP
    const roomAbove = r.top - GAP - EDGE
    const upward = r.bottom + GAP + menuH > vh - EDGE && roomAbove > roomBelow
    let left = r.right - menuW
    if (left + menuW > vw - EDGE) left = vw - EDGE - menuW
    if (left < EDGE) left = EDGE
    setPos(upward
      ? { left, bottom: vh - r.top + GAP, maxHeight: Math.max(120, Math.min(vh * 0.6, roomAbove)) }
      : { left, top: r.bottom + GAP, maxHeight: Math.max(120, Math.min(vh * 0.6, roomBelow)) })
    setIsPhone(!!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches))
  }, [open])

  // Focus the first/last enabled item after a keyboard open.
  useEffect(() => {
    if (!open || !pos || !focusOnOpen.current) return
    const which = focusOnOpen.current
    focusOnOpen.current = null
    if (enabledIdx.length) focusItem(which === 'last' ? enabledIdx[enabledIdx.length - 1] : enabledIdx[0])
  }, [open, pos]) // eslint-disable-line react-hooks/exhaustive-deps

  // Outside pointer → close; scroll (outside the menu) / resize → close (the menu is position: fixed).
  useEffect(() => {
    if (!open) return
    const inside = node => (menuRef.current && menuRef.current.contains(node)) || (triggerRef.current && triggerRef.current.contains(node))
    const onPointerDown = e => { if (!inside(e.target)) onOpenChange(false) }
    const onScroll = e => { if (!(menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target))) onOpenChange(false) }
    const onResize = () => onOpenChange(false)
    // Escape anywhere (e.g. opened with the mouse, focus still on the page) closes and returns focus to the trigger.
    const onDocKeyDown = e => { if (e.key === 'Escape') { onOpenChange(false); if (triggerRef.current) triggerRef.current.focus() } }
    document.addEventListener('keydown', onDocKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onDocKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, onOpenChange])

  const onTriggerClick = e => {
    // A keyboard Enter/Space that already opened the menu can also fire a click (detail 0): ignore that one.
    if (e.detail === 0 && Date.now() - keyOpenedAt.current < 500) return
    onOpenChange(!open)
  }

  const onTriggerKeyDown = e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      keyOpenedAt.current = Date.now()
      focusOnOpen.current = e.key === 'ArrowUp' ? 'last' : 'first'
      if (open) { // already open: just move into it
        const which = focusOnOpen.current
        focusOnOpen.current = null
        if (enabledIdx.length) focusItem(which === 'last' ? enabledIdx[enabledIdx.length - 1] : enabledIdx[0])
      } else onOpenChange(true)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      close(true)
    }
  }

  const move = delta => {
    if (!enabledIdx.length) return
    const cur = enabledIdx.indexOf(activeIndex)
    const next = cur < 0 ? (delta > 0 ? 0 : enabledIdx.length - 1) : (cur + delta + enabledIdx.length) % enabledIdx.length
    focusItem(enabledIdx[next])
  }

  const onMenuKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Home') { e.preventDefault(); if (enabledIdx.length) focusItem(enabledIdx[0]) }
    else if (e.key === 'End') { e.preventDefault(); if (enabledIdx.length) focusItem(enabledIdx[enabledIdx.length - 1]) }
    else if (e.key === 'Escape') { e.preventDefault(); close(true) }
    else if (e.key === 'Tab') { close(true) } // focus goes back to the trigger, then Tab moves on from there
  }

  const choose = item => {
    if (item.disabled) return
    // Close first (synchronously), then run the action inside the same user gesture.
    flushSync(() => onOpenChange(false))
    if (triggerRef.current) triggerRef.current.focus()
    item.onSelect && item.onSelect()
  }

  let n = -1
  const menu = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={menuLabel || label}
      onKeyDown={onMenuKeyDown}
      style={{
        position: 'fixed', zIndex: 50, ...(pos || { top: 0, left: 0, visibility: 'hidden' }),
        minWidth: '220px', maxWidth: 'calc(100vw - 24px)', overflowY: 'auto', ...(pos ? {} : { maxHeight: '60vh' }),
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 8px 24px rgba(17,24,39,0.12)',
        padding: '4px 0', boxSizing: 'border-box',
      }}>
      {visibleGroups.map((g, gi) => (
        <div key={g.key} role="presentation">
          {gi > 0 && <div role="presentation" aria-hidden="true" style={{ height: '1px', background: '#e5e7eb', margin: '4px 0' }} />}
          {g.label ? (
            <div role="presentation" aria-hidden="true" style={{ padding: '6px 12px 2px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.6px', textTransform: 'uppercase', color: '#9ca3af' }}>
              {g.label}
            </div>
          ) : null}
          {g.items.map(item => {
            n += 1
            const i = n
            const active = i === activeIndex && !item.disabled
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                ref={el => { itemRefs.current[i] = el }}
                aria-disabled={item.disabled ? 'true' : undefined}
                title={item.title}
                onClick={() => choose(item)}
                onMouseEnter={() => { if (!item.disabled) focusItem(i) }}
                onFocus={() => setActiveIndex(i)}
                style={{
                  display: 'flex', alignItems: 'center', width: '100%', minHeight: isPhone ? '44px' : '40px',
                  padding: '8px 12px', border: 'none', outline: 'none', textAlign: 'left', fontSize: '13px', fontWeight: '500',
                  lineHeight: '1.3', boxSizing: 'border-box',
                  color: item.disabled ? '#9ca3af' : item.danger ? '#dc2626' : '#111827',
                  background: active ? (item.danger ? '#fef2f2' : '#f9fafb') : 'transparent',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                }}>
                {item.label}
              </button>
            )
          })}
        </div>
      ))}
    </div>,
    document.body
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        style={{ ...triggerBase, ...(triggerStyle || {}) }}>
        {label}
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menu}
    </>
  )
}
