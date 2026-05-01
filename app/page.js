'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
export default function Home() {
  const router = useRouter()
  useEffect(() => {
    // Catch invite/recovery tokens that land on the homepage and redirect to set-password
    const hash = window.location.hash
    if (hash && (hash.includes('type=invite') || hash.includes('type=recovery'))) {
      router.push('/set-password' + hash)
      return
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        supabase.from('profiles').select('role').eq('id', session.user.id).single().then(({ data: prof }) => {
          router.push(prof?.role === 'pm' || prof?.role === 'apm' || prof?.role === 'super' || prof?.role === 'admin' ? '/dashboard' : '/submit')
        })
      } else {
        router.push('/login')
      }
    })
  }, [router])
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#f1f1f1' }}>Loading...</div>
}
