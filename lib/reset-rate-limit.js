// Server-only. Rate limit for the public "Forgot password" route (POST /api/reset-password).
//
// Limits are counted in public.auth_rate_limits through the auth_rate_limit_hit RPC
// (migration 060). Only a SHA-256 hex of the normalized email / client IP is sent, never
// the raw value. Until 060 is applied (RPC missing) — or if the RPC errors — an in-memory,
// per-instance limiter with the same limits is used, so the route is never unlimited and
// never 500s because of the limiter.
import { createHash } from 'crypto'

// Tune here. window = seconds, limit = max requests allowed in that window.
export const RESET_EMAIL_LIMITS = [
  { bucket: 'reset_email_1m', windowSeconds: 60, limit: 1 },
  { bucket: 'reset_email_1h', windowSeconds: 60 * 60, limit: 5 },
]
export const RESET_IP_LIMITS = [
  { bucket: 'reset_ip_15m', windowSeconds: 15 * 60, limit: 10 },
  { bucket: 'reset_ip_1d', windowSeconds: 24 * 60 * 60, limit: 30 },
]

export function normalizeResetEmail(v) {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (s.length < 3 || s.length > 254) return null
  if (/\s/.test(s)) return null
  const parts = s.split('@')
  if (parts.length !== 2) return null
  const [local, domain] = parts
  if (!local || !domain) return null
  const dot = domain.indexOf('.')
  if (dot <= 0 || dot === domain.length - 1) return null
  return s
}

export function clientIp(request) {
  const h = request?.headers
  const xff = h?.get?.('x-forwarded-for')
  const first = xff ? String(xff).split(',')[0].trim() : ''
  if (first) return first
  const real = h?.get?.('x-real-ip')
  if (real && String(real).trim()) return String(real).trim()
  return 'unknown'
}

export function hashKey(v) {
  return createHash('sha256').update(String(v)).digest('hex')
}

// ── In-memory fallback (per server instance, like lib/bot-auth.js checkRateLimit) ──
const memWindows = new Map()
let memOps = 0
function memoryHit(bucket, keyHash, windowSeconds, limit, now) {
  const ms = windowSeconds * 1000
  const windowStart = now - (now % ms)
  const k = `${bucket}|${keyHash}`
  const w = memWindows.get(k)
  let hits
  if (!w || w.windowStart !== windowStart) {
    memWindows.set(k, { windowStart, windowMs: ms, hits: 1 })
    hits = 1
  } else {
    w.hits += 1
    hits = w.hits
  }
  // Occasional cleanup so the Map can't grow without bound.
  if (++memOps % 500 === 0) {
    for (const [key, val] of memWindows) if (val.windowStart + val.windowMs <= now) memWindows.delete(key)
  }
  return { allowed: hits <= limit, hits }
}
export function _resetMemoryLimiter() { memWindows.clear(); memOps = 0 }

function isMissingRpc(error) {
  const msg = String(error?.message || '')
  return error?.code === 'PGRST202' || error?.code === '42883' || /could not find the function/i.test(msg)
}

/**
 * Count one reset request against every email + IP bucket.
 * Returns { allowed, blocked: [bucket…], source: 'db' | 'memory' }.
 * Allowed only if every bucket allows.
 */
export async function checkResetLimits(adminSupabase, { email, ip }, now = Date.now()) {
  const emailHash = hashKey(`email:${email}`)
  const ipHash = hashKey(`ip:${ip || 'unknown'}`)
  const checks = [
    ...RESET_EMAIL_LIMITS.map(l => ({ ...l, keyHash: emailHash })),
    ...RESET_IP_LIMITS.map(l => ({ ...l, keyHash: ipHash })),
  ]
  const blocked = []
  let useMemory = false
  let source = 'db'
  for (const c of checks) {
    let res = null
    if (!useMemory) {
      try {
        const { data, error } = await adminSupabase.rpc('auth_rate_limit_hit', {
          p_bucket: c.bucket, p_key_hash: c.keyHash, p_window_seconds: c.windowSeconds, p_limit: c.limit,
        })
        if (error) {
          if (!isMissingRpc(error)) console.error('[reset-password] rate limit RPC failed; using in-memory limiter', error.message)
          useMemory = true
        } else if (!data || typeof data.allowed !== 'boolean') {
          console.error('[reset-password] rate limit RPC returned an unexpected result; using in-memory limiter')
          useMemory = true
        } else {
          res = data
        }
      } catch (e) {
        console.error('[reset-password] rate limit RPC threw; using in-memory limiter', e?.message)
        useMemory = true
      }
    }
    if (!res) {
      source = 'memory'
      res = memoryHit(c.bucket, c.keyHash, c.windowSeconds, c.limit, now)
    }
    if (!res.allowed) blocked.push(c.bucket)
  }
  return { allowed: blocked.length === 0, blocked, source }
}
