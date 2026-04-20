'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

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

  const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: '500', color: '#4b5563', marginBottom: '4px' }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: '48px', height: '48px', background: '#1e3db5', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <svg width="24" height="24" fill="none" stroke="white" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 4px' }}>NV Construction</h1>
          <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>Create your subcontractor account</p>
        </div>
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '1.5rem' }}>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '12px', borderRadius: '8px', fontSize: '14px', marginBottom: '1rem' }}>{error}</div>}
          <form onSubmit={handleRegister}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1rem' }}>
              <div><label style={labelStyle}>Your name</label><input style={inputStyle} value={form.full_name} onChange={e => update('full_name', e.target.value)} required placeholder="John Smith" /></div>
              <div><label style={labelStyle}>Company</label><input style={inputStyle} value={form.company_name} onChange={e => update('company_name', e.target.value)} required placeholder="ABC Concrete" /></div>
            </div>
            <div style={{ marginBottom: '1rem' }}><label style={labelStyle}>Phone</label><input style={inputStyle} value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="(555) 555-5555" /></div>
            <div style={{ marginBottom: '1rem' }}><label style={labelStyle}>Email</label><input type="email" style={inputStyle} value={form.email} onChange={e => update('email', e.target.value)} required placeholder="you@company.com" /></div>
            <div style={{ marginBottom: '1.5rem' }}><label style={labelStyle}>Password</label><input type="password" style={inputStyle} value={form.password} onChange={e => update('password', e.target.value)} required minLength={6} placeholder="Min. 6 characters" /></div>
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '10px', background: '#1e3db5', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>
          <p style={{ textAlign: 'center', fontSize: '14px', color: '#6b7280', marginTop: '1rem', marginBottom: 0 }}>
            Already have an account? <a href="/login" style={{ color: '#1e3db5', fontWeight: '500' }}>Sign in</a>
          </p>
        </div>
      </div>
    </div>
  )
}
