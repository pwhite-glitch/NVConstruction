'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MetalBuildingsPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/sales?division=metal_buildings') }, [router])
  return null
}
