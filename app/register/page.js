'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import Link from 'next/link'

export default function Register() {
  const router = useRouter()
  const [form, setForm] = useState({ full_name: '', company_name: '', phone: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleRegister(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          full_name: form.full_name,
          role: 'subcontractor',
        }
      }
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({
        company_name: form.company_name,
        phone: form.phone,
      }).eq('id', user.id)
    }

    router.push('/submit')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-steel-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-600 rounded-xl mb-4">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-steel-900">NV Construction</h1>
          <p className="text-steel-500 text-sm mt-1">Create your subcontractor account</p>
        </div>

        <div className="card">
          <form onSubmit={handleRegister} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Your name</label>
                <input type="text" value={form.full_name} onChange={e => update('full_name', e.target.value)} required placeholder="John Smith" />
              </div>
              <div>
                <label>Company name</label>
                <input type="text" value={form.company_name} onChange={e => update('company_name', e.target.value)} required placeholder="ABC Concrete Co." />
              </div>
            </div>
            <div>
              <label>Phone number</label>
              <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="(555) 555-5555" />
            </div>
            <div>
              <label>Email address</label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)} required placeholder="you@company.com" />
            </div>
            <div>
              <label>Password</label>
              <input type="password" value={form.password} onChange={e => update('password', e.target.value)} required placeholder="Min. 6 characters" minLength={6} />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>
          <p className="text-center text-sm text-steel-500 mt-4">
            Already have an account?{' '}
            <Link href="/login" className="text-brand-600 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
