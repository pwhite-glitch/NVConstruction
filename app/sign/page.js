'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function SignPageInner() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [request, setRequest] = useState(null)
  const [docHtml, setDocHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sigText, setSigText] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [signedAt, setSignedAt] = useState(null)

  useEffect(() => {
    if (!token) {
      setError('No signing token provided.')
      setLoading(false)
      return
    }
    async function fetchRequest() {
      try {
        const res = await fetch(`/api/signing-requests/${token}?html=1`)
        if (!res.ok) {
          setError('This signing link is invalid or has expired.')
          setLoading(false)
          return
        }
        const json = await res.json()
        if (!json.data) {
          setError('Signing request not found.')
          setLoading(false)
          return
        }
        setRequest(json.data)
        setDocHtml(json.data.document_html || '')
      } catch (e) {
        setError('Failed to load signing request. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    fetchRequest()
  }, [token])

  async function handleSign(e) {
    e.preventDefault()
    if (!sigText.trim() || !agreed) return
    setSubmitting(true)
    try {
      let signer_ip = ''
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json')
        const ipJson = await ipRes.json()
        signer_ip = ipJson.ip || ''
      } catch {}

      const res = await fetch(`/api/signing-requests/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature_text: sigText.trim(), signer_ip }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'Failed to submit signature. Please try again.')
        return
      }
      setSignedAt(new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }))
      setDone(true)
    } catch (e) {
      setError('Failed to submit signature. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const s = {
    page: {
      minHeight: '100vh',
      background: '#0a0a0a',
      color: '#f1f1f1',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '0 0 60px 0',
    },
    header: {
      background: '#111',
      borderBottom: '1px solid #222',
      padding: '18px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    },
    headerTitle: {
      margin: 0,
      fontSize: '15px',
      fontWeight: '700',
      color: '#f1f1f1',
      letterSpacing: '0.5px',
    },
    headerSub: {
      margin: 0,
      fontSize: '12px',
      color: '#555',
    },
    container: {
      maxWidth: '780px',
      margin: '0 auto',
      padding: '32px 20px 0',
    },
    card: {
      background: '#141414',
      border: '1px solid #222',
      borderRadius: '12px',
      padding: '28px 32px',
      marginBottom: '20px',
    },
    label: {
      display: 'block',
      fontSize: '11px',
      fontWeight: '700',
      color: '#555',
      textTransform: 'uppercase',
      letterSpacing: '1.5px',
      marginBottom: '8px',
    },
    input: {
      width: '100%',
      boxSizing: 'border-box',
      background: '#0f0f0f',
      border: '1px solid #2a2a2a',
      borderRadius: '8px',
      padding: '12px 14px',
      fontSize: '15px',
      color: '#f1f1f1',
      outline: 'none',
    },
    btn: {
      padding: '13px 32px',
      background: '#e8590c',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '15px',
      fontWeight: '700',
      cursor: 'pointer',
    },
    btnDisabled: {
      padding: '13px 32px',
      background: '#333',
      color: '#666',
      border: 'none',
      borderRadius: '8px',
      fontSize: '15px',
      fontWeight: '700',
      cursor: 'not-allowed',
    },
  }

  if (loading) {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <p style={s.headerTitle}>NV Construction — E-Signature Request</p>
          </div>
        </div>
        <div style={{ ...s.container, textAlign: 'center', paddingTop: '80px' }}>
          <p style={{ color: '#555', fontSize: '15px' }}>Loading document...</p>
        </div>
      </div>
    )
  }

  if (error && !request) {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <p style={s.headerTitle}>NV Construction — E-Signature Request</p>
          </div>
        </div>
        <div style={{ ...s.container, textAlign: 'center', paddingTop: '80px' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>&#8856;</div>
          <p style={{ color: '#ff6b6b', fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Invalid Link</p>
          <p style={{ color: '#555', fontSize: '14px' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <p style={s.headerTitle}>NV Construction — E-Signature Request</p>
          </div>
        </div>
        <div style={{ ...s.container, textAlign: 'center', paddingTop: '80px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '80px', height: '80px', background: '#0a2a0a', border: '2px solid #1a4a1a', borderRadius: '50%', fontSize: '36px', marginBottom: '24px' }}>
            &#10003;
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: '800', color: '#4ade80', margin: '0 0 12px' }}>Document Signed</h1>
          <p style={{ fontSize: '15px', color: '#888', marginBottom: '20px' }}>
            Signed by <strong style={{ color: '#f1f1f1' }}>{sigText}</strong>
          </p>
          <p style={{ fontSize: '14px', color: '#555', marginBottom: '24px' }}>
            {signedAt}
          </p>
          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: '10px', padding: '20px 24px', maxWidth: '420px', margin: '0 auto' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#888', lineHeight: '1.6' }}>
              You will receive a confirmation email shortly. Please keep it for your records.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (request?.status === 'signed') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <p style={s.headerTitle}>NV Construction — E-Signature Request</p>
          </div>
        </div>
        <div style={{ ...s.container, textAlign: 'center', paddingTop: '80px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '80px', height: '80px', background: '#0a2a0a', border: '2px solid #1a4a1a', borderRadius: '50%', fontSize: '36px', marginBottom: '24px' }}>
            &#10003;
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#4ade80', margin: '0 0 12px' }}>Already Signed</h1>
          <p style={{ fontSize: '15px', color: '#888', marginBottom: '8px' }}>
            This document has already been signed.
          </p>
          {request.signed_at && (
            <p style={{ fontSize: '13px', color: '#555' }}>
              Signed on {new Date(request.signed_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <p style={s.headerTitle}>NV Construction — E-Signature Request</p>
        </div>
      </div>

      <div style={s.container}>
        <div style={s.card}>
          <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#555' }}>You have been sent a document to sign:</p>
          <p style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#f1f1f1' }}>
            {request?.document_title || 'Subcontract Agreement'}
          </p>
        </div>

        {docHtml && (
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
              Contract Document
            </p>
            <iframe
              srcDoc={docHtml}
              style={{ width: '100%', height: '600px', border: '1px solid #2a2a2a', borderRadius: '8px', background: '#fff', display: 'block' }}
              title="Contract Document"
              sandbox="allow-same-origin"
            />
          </div>
        )}

        <div style={s.card}>
          <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#aaa', lineHeight: '1.6' }}>
            By typing your full legal name below and clicking Sign, you agree to electronically sign this document.
          </p>

          <form onSubmit={handleSign}>
            <div style={{ marginBottom: '20px' }}>
              <label style={s.label}>Full legal name *</label>
              <input
                type="text"
                style={s.input}
                placeholder="Type your full legal name"
                value={sigText}
                onChange={e => setSigText(e.target.value)}
                required
                autoComplete="name"
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '24px' }}>
              <input
                type="checkbox"
                id="agree-check"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                style={{ marginTop: '3px', width: '16px', height: '16px', accentColor: '#e8590c', flexShrink: 0 }}
              />
              <label htmlFor="agree-check" style={{ fontSize: '13px', color: '#aaa', lineHeight: '1.6', cursor: 'pointer' }}>
                I have read and understand this document and agree to sign it electronically.
              </label>
            </div>

            {error && (
              <p style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '16px' }}>{error}</p>
            )}

            <button
              type="submit"
              style={sigText.trim() && agreed ? s.btn : s.btnDisabled}
              disabled={!sigText.trim() || !agreed || submitting}
            >
              {submitting ? 'Signing...' : 'Sign Document'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function SignPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading...</p>
      </div>
    }>
      <SignPageInner />
    </Suspense>
  )
}
