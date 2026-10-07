'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const s = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: '1rem' },
  card: { width: '100%', maxWidth: '420px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '2.5rem', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' },
  logo: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' },
  logoImg: { width: '72px', height: '72px', objectFit: 'contain', marginBottom: '10px' },
  logoText: { fontSize: '11px', fontWeight: '600', letterSpacing: '3px', color: '#9ca3af', textTransform: 'uppercase' },
  label: { display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '5px' },
  input: { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none' },
  btn: { width: '100%', padding: '11px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' },
  err: { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 12px', borderRadius: '6px', fontSize: '13px', marginBottom: '1rem' },
  link: { color: '#e8590c', fontWeight: '600', textDecoration: 'none' },
  divider: { borderTop: '1px solid #f3f4f6', margin: '1.5rem 0' },
  footer: { textAlign: 'center', fontSize: '13px', color: '#6b7280' },
}

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function handleReset() {
    if (!email) { setError('Enter your email above first.'); return }
    setResetting(true)
    setError('')
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const json = await res.json()
    if (json.error) {
      setError(json.error)
      setResetting(false)
      return
    }
    setResetSent(true)
    setResetting(false)
  }

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
    const role = prof?.role
    if (role === 'admin') router.push('/admin')
    else if (role === 'pm' || role === 'apm' || role === 'super') router.push('/dashboard')
    else if (role === 'owner') router.push('/owner')
    else router.push('/submit')
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>
          <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
          <span style={s.logoText}>Subcontractor Portal</span>
        </div>
        {error && <div style={s.err}>{error}</div>}
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={s.label}>Email</label>
            <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={s.label}>Password</label>
            <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div style={s.divider} />
        <div style={s.footer}>
          {resetSent ? (
            <span style={{ color: '#16a34a' }}>Password reset email sent — check your inbox.</span>
          ) : (
            <span>Forgot password? <button onClick={handleReset} disabled={resetting} style={{ background: 'none', border: 'none', color: '#e8590c', fontWeight: '600', cursor: 'pointer', fontSize: '13px', padding: 0 }}>{resetting ? 'Sending...' : 'Reset it'}</button></span>
          )}
        </div>
        <div style={{ ...s.divider, marginTop: '1rem' }} />
        <div style={s.footer}>
          New subcontractor? <a href="/apply" style={s.link}>Create account</a>
        </div>
      </div>
    </div>
  )
}
