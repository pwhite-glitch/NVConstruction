import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Bot API auth: `Authorization: Bearer nvb_<random>`.
//
// The service role is used ONLY to look up the key's hash in bot_api_keys and
// stamp last_used_at. Everything else (the bot's profile, all data reads and
// writes) goes through a client signed in as the bot user with a short-lived
// token we mint ourselves, so RLS applies exactly as it does in the browser.

export const KEY_PREFIX = 'nvb_'
export const TOKEN_TTL_SECONDS = 5 * 60
export const RATE_LIMIT_PER_MINUTE = 120

export function generateBotKey() {
  return KEY_PREFIX + crypto.randomBytes(32).toString('base64url')
}

export function hashBotKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey), 'utf8').digest('hex')
}

// First 8 characters, stored for display ("nvb_AbCd")
export const keyDisplayPrefix = (rawKey) => String(rawKey).slice(0, 8)

// Returns the raw key from the Authorization header, or null
export function parseBotKey(header) {
  const m = /^Bearer\s+(nvb_[A-Za-z0-9_-]{20,200})\s*$/.exec(header || '')
  return m ? m[1] : null
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

// HS256 Supabase access token for the bot user, signed with the project's JWT secret.
// No email claim: the office policies a bot (role pm) hits key off auth.uid() only.
export function mintAccessToken({ userId, secret, supabaseUrl, now = Date.now() }) {
  const iat = Math.floor(now / 1000)
  const payload = {
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    is_anonymous: false,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
  }
  if (supabaseUrl) payload.iss = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`
  const data = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

// Live key row for this raw key: matching hash, enabled, not revoked. Null if none.
export async function findActiveKey(adminClient, rawKey) {
  const { data, error } = await adminClient
    .from('bot_api_keys')
    .select('id, bot_user_id')
    .eq('key_hash', hashBotKey(rawKey))
    .eq('enabled', true)
    .is('revoked_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

// Fixed one-minute window per key, in memory (per server instance)
const rateWindows = new Map()
export function checkRateLimit(keyId, now = Date.now(), limit = RATE_LIMIT_PER_MINUTE) {
  const windowStart = now - (now % 60000)
  const w = rateWindows.get(keyId)
  if (!w || w.windowStart !== windowStart) {
    rateWindows.set(keyId, { windowStart, count: 1 })
    return { ok: true }
  }
  w.count += 1
  if (w.count > limit) return { ok: false, retryAfter: Math.ceil((windowStart + 60000 - now) / 1000) }
  return { ok: true }
}

export function botClient(token) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

let adminSupabase = null
function getAdmin() {
  if (!adminSupabase) adminSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  return adminSupabase
}

const fail = (status, error, headers) => ({ error: Response.json({ error }, { status, headers }) })

/**
 * Verify a Bot API key.
 * Returns { bot: { id, full_name, keyId }, supabase, error: null } on success,
 * where `supabase` is an RLS client acting as the bot user.
 * Returns { error: Response } on failure — caller should: if (auth.error) return auth.error
 */
export async function requireBotKey(request) {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) {
    return fail(503, 'Bot API is not configured: SUPABASE_JWT_SECRET is not set on the server.')
  }
  const rawKey = parseBotKey(request.headers.get('authorization'))
  if (!rawKey) return fail(401, 'Missing or malformed bot key. Send Authorization: Bearer nvb_...')

  let keyRow
  try {
    keyRow = await findActiveKey(getAdmin(), rawKey)
  } catch (e) {
    console.error('[bot-auth] key lookup', e?.message)
    return fail(503, 'Bot API key lookup failed')
  }
  if (!keyRow) return fail(401, 'Invalid, disabled or revoked bot key')

  const rl = checkRateLimit(keyRow.id)
  if (!rl.ok) return fail(429, `Rate limit: ${RATE_LIMIT_PER_MINUTE} requests per minute`, { 'Retry-After': String(rl.retryAfter) })

  const { error: touchErr } = await getAdmin().from('bot_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id)
  if (touchErr) console.error('[bot-auth] last_used_at', touchErr.message)

  // Read the bot's own profile as the bot (profiles_select_own)
  const token = mintAccessToken({ userId: keyRow.bot_user_id, secret, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL })
  const supabase = botClient(token)
  const { data: profile, error: profErr } = await supabase
    .from('profiles').select('id, full_name, role, is_bot').eq('id', keyRow.bot_user_id).maybeSingle()
  if (profErr) {
    console.error('[bot-auth] profile', profErr.message)
    return fail(503, 'Supabase rejected the bot session. Check that SUPABASE_JWT_SECRET is the project\'s legacy JWT secret and that it has not been revoked.')
  }
  if (!profile?.is_bot) return fail(403, 'This key is not linked to a bot user')

  return {
    bot: { id: profile.id, full_name: profile.full_name, keyId: keyRow.id },
    supabase,
    error: null,
  }
}
