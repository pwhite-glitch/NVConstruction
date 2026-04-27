'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function Field() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (!prof || prof.role !== 'super') { router.push('/login'); return }
      setProfile(prof)
    }
    load()
  }, [router])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      <header style={{ background: '#141414', borderBottom: '1px solid #222', padding: '0 1.5rem' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img src="/logo.png" alt="NV Construction" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
            <div>
              <div style={{ fontWeight: '700', fontSize: '15px', color: '#f1f1f1', letterSpacing: '1px' }}>NV Construction</div>
              <div style={{ fontSize: '11px', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' }}>Field Portal</div>
            </div>
          </div>
          <button
            style={{ padding: '7px 16px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#888', cursor: 'pointer', fontSize: '13px' }}
            onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>
            Sign out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '760px', margin: '0 auto', padding: '4rem 1.5rem', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '1rem' }}>🏗️</div>
        <h2 style={{ color: '#f1f1f1', margin: '0 0 0.75rem', fontSize: '22px' }}>
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}
        </h2>
        <p style={{ color: '#555', fontSize: '14px', margin: 0 }}>
          The superintendent portal is coming soon.
        </p>
      </main>
    </div>
  )
}
