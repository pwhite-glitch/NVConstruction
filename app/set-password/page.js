'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const s = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', padding: '1rem' },
  card: { width: '100%', maxWidth: '420px', background: '#141414', border: '1px solid #222', borderRadius: '16px', padding: '2.5rem' },
  logo: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' },
  logoImg: { width: '80px', height: '80px', objectFit: 'contain', marginBottom: '12px' },
  logoText: { fontSize: '11px', fontWeight: '600', letterSpacing: '4px', color: '#666', textTransform: 'uppercase' },
  title: { fontSize: '20px', fontWeight: '800', color: '#f1f1f1', marginBottom: '8px', textAlign: 'center' },
  sub: { fontSize: '13px', color: '#555', textAlign: 'center', marginBottom: '2rem' },
  label: { display: 'block', fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px', letterSpacing: '1px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '12px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  btn: { width: '100%', padding: '13px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '8px' },
  err: { background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' },
  success: { background: '#0a2a0a', border: '1px solid #1a4a1a', color: '#4ade80', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' },
}

export default function SetPassword() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session) {
        setReady(true)
      }
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })
  }, [])

  async function handleSetPassword(e) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false); return }
    const { data: { session } } = await supabase.auth.getSession()
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
    const role = prof?.role
    router.push(role === 'pm' || role === 'apm' || role === 'super' || role === 'admin' ? '/dashboard' : '/submit')
  }

  if (!ready) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>
            <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
          </div>
          <p style={{ textAlign: 'center', color: '#555', fontSize: '14px' }}>Loading your account...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>
          <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
          <span style={s.logoText}>NV Construction</span>
        </div>
        <p style={s.title}>Set your password</p>
        <p style={s.sub}>Choose a password to secure your account.</p>
        {error && <div style={s.err}>{error}</div>}
        <form onSubmit={handleSetPassword}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={s.label}>New password</label>
            <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Minimum 8 characters" />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={s.label}>Confirm password</label>
            <input style={s.input} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="Repeat password" />
          </div>
          <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Set password & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
