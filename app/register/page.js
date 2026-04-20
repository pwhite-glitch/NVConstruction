'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const s = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', padding: '1rem' },
  card: { width: '100%', maxWidth: '480px', background: '#141414', border: '1px solid #222', borderRadius: '16px', padding: '2.5rem' },
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
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
}

export default function Register() {
  const router = useRouter()
  const [form, setForm] = useState({ full_name: '', company_name: '', phone: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const update = (f, v) => setForm(x => ({ ...x, [f]: v }))

  async function handleRegister(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signUp({
      email: form.email, password: form.password,
      options: { data: { full_name: form.full_name, role: 'subcontractor' } }
    })
    if (error) { setError(error.message); setLoading(false); return }
    if (data.user) {
      await supabase.from('profiles').update({ company_name: form.company_name, phone: form.phone }).eq('id', data.user.id)
    }
    router.push('/submit')
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>
          <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
          <span style={s.logoText}>Create your account</span>
        </div>
        {error && <div style={s.err}>{error}</div>}
        <form onSubmit={handleRegister}>
          <div style={{ ...s.grid2, marginBottom: '1rem' }}>
            <div><label style={s.label}>Your name</label><input style={s.input} value={form.full_name} onChange={e => update('full_name', e.target.value)} required placeholder="John Smith" /></div>
            <div><label style={s.label}>Company</label><input style={s.input} value={form.company_name} onChange={e => update('company_name', e.target.value)} required placeholder="ABC Concrete" /></div>
          </div>
          <div style={{ marginBottom: '1rem' }}><label style={s.label}>Phone</label><input style={s.input} value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="(555) 555-5555" /></div>
          <div style={{ marginBottom: '1rem' }}><label style={s.label}>Email</label><input style={s.input} type="email" value={form.email} onChange={e => update('email', e.target.value)} required placeholder="you@company.com" /></div>
          <div style={{ marginBottom: '1.5rem' }}><label style={s.label}>Password</label><input style={s.input} type="password" value={form.password} onChange={e => update('password', e.target.value)} required minLength={6} placeholder="Min. 6 characters" /></div>
          <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>
        <div style={s.divider} />
        <div style={s.footer}>Already have an account? <a href="/login" style={s.link}>Sign in</a></div>
      </div>
    </div>
  )
}
