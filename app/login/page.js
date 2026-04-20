'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const s = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', padding: '1rem' },
  card: { width: '100%', maxWidth: '420px', background: '#141414', border: '1px solid #222', borderRadius: '16px', padding: '2.5rem' },
  logo: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' },
  logoImg: { width: '80px', height: '80px', objectFit: 'contain', marginBottom: '12px' },
  logoText: { fontSize: '11px', fontWeight: '600', letterSpacing: '4px', color: '#666', textTransform: 'uppercase' },
  label: { display: 'block', fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px', letterSpacing: '1px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '12px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  btn: { width: '100%', padding: '13px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '8px' },
  err: { background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' },
  link: { color: '#e8590c', fontWeight: '600', textDecoration: 'none' },
  divider: { borderTop: '1px solid #1e1e1e', margin: '1.5rem 0' },
  footer: { textAlign: 'center', fontSize: '13px', color: '#555' },
}

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
    router.push(prof?.role === 'pm' ? '/dashboard' : '/submit')
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
          New subcontractor? <a href="/register" style={s.link}>Create account</a>
        </div>
      </div>
    </div>
  )
}
