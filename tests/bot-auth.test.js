import crypto from 'crypto'
import { describe, it, expect, afterEach } from '@jest/globals'
import {
  generateBotKey, hashBotKey, keyDisplayPrefix, parseBotKey, mintAccessToken,
  findActiveKey, checkRateLimit, requireBotKey, TOKEN_TTL_SECONDS,
} from '../lib/bot-auth'

const SECRET = 'test-jwt-secret-at-least-32-characters-long'

function decode(token) {
  const [h, p, sig] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
    sig,
    signed: `${h}.${p}`,
  }
}

// Records the query a route would send, returns `result` from maybeSingle()
function fakeAdmin(result) {
  const calls = []
  const q = {
    select: (...a) => { calls.push(['select', ...a]); return q },
    eq: (...a) => { calls.push(['eq', ...a]); return q },
    is: (...a) => { calls.push(['is', ...a]); return q },
    maybeSingle: async () => result,
  }
  return { calls, client: { from: (t) => { calls.push(['from', t]); return q } } }
}

describe('bot keys', () => {
  it('generates nvb_ keys with 32 random bytes, all different', () => {
    const a = generateBotKey()
    const b = generateBotKey()
    expect(a).toMatch(/^nvb_[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })

  it('hashes to sha256 hex, deterministically', () => {
    const key = 'nvb_example_key_0123456789abcdef'
    expect(hashBotKey(key)).toBe(crypto.createHash('sha256').update(key).digest('hex'))
    expect(hashBotKey(key)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashBotKey(key)).toBe(hashBotKey(key))
    expect(hashBotKey(key + 'x')).not.toBe(hashBotKey(key))
  })

  it('display prefix is the first 8 characters only', () => {
    expect(keyDisplayPrefix('nvb_AbCdEfGh12345')).toBe('nvb_AbCd')
  })

  it('parses only well-formed Bearer nvb_ headers', () => {
    const key = generateBotKey()
    expect(parseBotKey(`Bearer ${key}`)).toBe(key)
    expect(parseBotKey(`Bearer ${key}  `)).toBe(key)
    expect(parseBotKey(key)).toBeNull()
    expect(parseBotKey('Bearer eyJhbGciOiJIUzI1NiJ9.e30.x')).toBeNull() // a normal session JWT
    expect(parseBotKey('Bearer nvb_short')).toBeNull()
    expect(parseBotKey('')).toBeNull()
    expect(parseBotKey(null)).toBeNull()
  })
})

describe('key lookup', () => {
  it('looks up by hash, enabled and not revoked — never by the raw key', async () => {
    const key = generateBotKey()
    const { calls, client } = fakeAdmin({ data: { id: 'k1', bot_user_id: 'u1' }, error: null })
    expect(await findActiveKey(client, key)).toEqual({ id: 'k1', bot_user_id: 'u1' })
    expect(calls).toContainEqual(['from', 'bot_api_keys'])
    expect(calls).toContainEqual(['eq', 'key_hash', hashBotKey(key)])
    expect(calls).toContainEqual(['eq', 'enabled', true])
    expect(calls).toContainEqual(['is', 'revoked_at', null])
    expect(JSON.stringify(calls)).not.toContain(key)
  })

  it('returns null when no live key matches', async () => {
    const { client } = fakeAdmin({ data: null, error: null })
    expect(await findActiveKey(client, generateBotKey())).toBeNull()
  })

  it('throws on a database error', async () => {
    const { client } = fakeAdmin({ data: null, error: { message: 'boom' } })
    await expect(findActiveKey(client, generateBotKey())).rejects.toThrow('boom')
  })
})

describe('minted access token', () => {
  const now = Date.UTC(2026, 9, 30, 15, 0, 0)
  const token = mintAccessToken({ userId: 'bot-uuid', secret: SECRET, supabaseUrl: 'https://abc.supabase.co/', now })
  const { header, payload, sig, signed } = decode(token)

  it('is HS256 and verifies with the JWT secret', () => {
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(sig).toBe(crypto.createHmac('sha256', SECRET).update(signed).digest('base64url'))
    expect(sig).not.toBe(crypto.createHmac('sha256', 'wrong-secret').update(signed).digest('base64url'))
  })

  it('has the Supabase authenticated-user claims', () => {
    expect(payload.sub).toBe('bot-uuid')
    expect(payload.role).toBe('authenticated')
    expect(payload.aud).toBe('authenticated')
    expect('email' in payload).toBe(false)
    expect(payload.iss).toBe('https://abc.supabase.co/auth/v1')
  })

  it('expires after 5 minutes', () => {
    expect(TOKEN_TTL_SECONDS).toBe(300)
    expect(payload.iat).toBe(now / 1000)
    expect(payload.exp - payload.iat).toBe(300)
  })
})

describe('rate limit', () => {
  it('allows 120 per minute per key, then refuses until the next minute', () => {
    const t = Date.UTC(2026, 9, 30, 15, 0, 10)
    for (let i = 0; i < 120; i++) expect(checkRateLimit('rl-key', t).ok).toBe(true)
    const over = checkRateLimit('rl-key', t)
    expect(over.ok).toBe(false)
    expect(over.retryAfter).toBe(50)
    expect(checkRateLimit('other-key', t).ok).toBe(true)
    expect(checkRateLimit('rl-key', t + 60000).ok).toBe(true)
  })
})

describe('requireBotKey', () => {
  const saved = process.env.SUPABASE_JWT_SECRET
  afterEach(() => { if (saved === undefined) delete process.env.SUPABASE_JWT_SECRET; else process.env.SUPABASE_JWT_SECRET = saved })
  const req = (auth) => ({ headers: { get: (k) => (k.toLowerCase() === 'authorization' ? auth : null) } })

  it('returns 503 with a clear message when SUPABASE_JWT_SECRET is missing', async () => {
    delete process.env.SUPABASE_JWT_SECRET
    const { error } = await requireBotKey(req(`Bearer ${generateBotKey()}`))
    expect(error.status).toBe(503)
    expect((await error.json()).error).toMatch(/SUPABASE_JWT_SECRET/)
  })

  it('returns 401 without a bot key (before touching the database)', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    expect((await requireBotKey(req(null))).error.status).toBe(401)
    expect((await requireBotKey(req('Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'))).error.status).toBe(401)
  })
})
