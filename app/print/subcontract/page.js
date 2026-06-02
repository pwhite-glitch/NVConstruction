'use client'
import { useEffect, useRef } from 'react'

export default function PrintSubcontract() {
  const iframeRef = useRef(null)

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('key')
    if (!key) return
    const html = localStorage.getItem(key)
    if (!html) return
    localStorage.removeItem(key)

    const iframe = iframeRef.current
    if (!iframe) return
    const doc = iframe.contentDocument
    doc.open()
    doc.write(html)
    doc.close()

    setTimeout(() => iframe.contentWindow.print(), 800)
  }, [])

  return (
    <iframe
      ref={iframeRef}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', border: 'none' }}
    />
  )
}
