'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import EstimateWorkspace from '../../components/estimating/EstimateWorkspace'
import { generateEstimatePDF } from '../../../lib/generate-estimate-pdf'

export default function EstimateDetailPage() {
  const { id } = useParams()
  const router = useRouter()

  const [profile, setProfile]   = useState(null)
  const [estimate, setEstimate] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    const [{ data: prof }, { data: est }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('estimates').select('*, estimate_line_items(*)').eq('id', id).maybeSingle(),
    ])

    if (!est) { setError('Estimate not found.'); setLoading(false); return }

    // Sort line items
    const sorted = { ...est, estimate_line_items: [...(est.estimate_line_items || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) }
    setEstimate(sorted)
    setProfile({ ...prof, id: session.user.id, email: session.user.email })
    setLoading(false)
  }, [id, router])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '14px', fontFamily: 'system-ui' }}>
        Loading estimate…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626', fontSize: '14px', fontFamily: 'system-ui' }}>
        {error}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <EstimateWorkspace
        estimate={estimate}
        profile={profile}
        generatePDF={generateEstimatePDF}
        onBack={() => router.push('/dashboard?tab=estimator')}
        onUpdated={(updated) => setEstimate(updated)}
        onDeleted={() => router.push('/dashboard?tab=estimator')}
      />
    </div>
  )
}
