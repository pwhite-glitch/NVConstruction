'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RoofingPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/sales?division=commercial_roofing') }, [router])
  return null
}
