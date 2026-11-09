/**
 * Prompt 67A #1: public "Forgot password" route is rate limited, normalizes the email, and
 * gives the same answer whether throttled, unknown, or the email send failed.
 * Supabase (mock-db + a generateLink stub) and Resend are mocked; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

const mockGenerateLink = jest.fn()
const mockSend = jest.fn()

jest.mock('@supabase/supabase-js', () => {
  const real = require('./helpers/mock-db').supabaseModule.createClient()
  return {
    createClient: () => ({
      ...real,
      auth: { admin: { ...real.auth.admin, generateLink: (...a) => mockGenerateLink(...a) } },
    }),
  }
})
jest.mock('resend', () => ({
  Resend: function Resend() { this.emails = { send: (...a) => mockSend(...a) } },
}))

const { POST } = require('../app/api/reset-password/route')
const { _resetMemoryLimiter, normalizeResetEmail, clientIp, RESET_EMAIL_LIMITS, RESET_IP_LIMITS } = require('../lib/reset-rate-limit')

// Stand-in for migration 060 auth_rate_limit_hit, on a fake clock the test moves.
let clock
let windows
function rateLimitRpc({ p_bucket, p_key_hash, p_window_seconds, p_limit }) {
  const w = Math.floor(clock / 1000 / p_window_seconds)
  const k = `${p_bucket}|${p_key_hash}|${w}`
  windows.set(k, (windows.get(k) || 0) + 1)
  const hits = windows.get(k)
  return { data: { allowed: hits <= p_limit, hits }, error: null }
}

const req = (body, ip = '203.0.113.7') => new Request('http://x/api/reset-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

beforeEach(() => {
  resetMockState({})
  windows = new Map()
  clock = Date.UTC(2026, 10, 9, 15, 0, 0) // on an hour (and day) boundary
  mockState.rpc.auth_rate_limit_hit = rateLimitRpc
  _resetMemoryLimiter()
  mockGenerateLink.mockReset()
  mockGenerateLink.mockImplementation(async ({ email }) => ({ data: { properties: { action_link: `https://link/${email}` } }, error: null }))
  mockSend.mockReset()
  mockSend.mockResolvedValue({ data: { id: 'e1' }, error: null })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { console.error.mockRestore(); console.warn.mockRestore() })

describe('helpers', () => {
  test('normalizeResetEmail', () => {
    expect(normalizeResetEmail('  Foo@Example.COM ')).toBe('foo@example.com')
    for (const bad of [null, 5, '', 'a', 'nope', 'a@b', 'a@@b.co', 'a b@c.co', '@x.co', 'x@.co', 'x@co.', 'a@b.c@d.co', 'x'.repeat(250) + '@a.co']) {
      expect(normalizeResetEmail(bad)).toBeNull()
    }
  })
  test('clientIp: first x-forwarded-for, else x-real-ip, else unknown', () => {
    expect(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' } }))).toBe('1.2.3.4')
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } }))).toBe('9.9.9.9')
    expect(clientIp(new Request('http://x'))).toBe('unknown')
  })
  test('limits are the agreed ones', () => {
    expect(RESET_EMAIL_LIMITS.map(l => [l.windowSeconds, l.limit])).toEqual([[60, 1], [3600, 5]])
    expect(RESET_IP_LIMITS.map(l => [l.windowSeconds, l.limit])).toEqual([[900, 10], [86400, 30]])
  })
})

describe('POST /api/reset-password', () => {
  test('email is trimmed + lowercased for generateLink and the Resend "to"', async () => {
    const res = await POST(req({ email: '  Foo@Example.COM ' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockGenerateLink).toHaveBeenCalledTimes(1)
    expect(mockGenerateLink.mock.calls[0][0]).toMatchObject({ type: 'recovery', email: 'foo@example.com' })
    expect(mockGenerateLink.mock.calls[0][0].options.redirectTo).toMatch(/\/set-password$/)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0].to).toBe('foo@example.com')
  })

  test('only hashes reach the rate-limit RPC (no raw email or IP)', async () => {
    await POST(req({ email: 'foo@example.com' }))
    const rpcCalls = mockState.calls.filter(c => c.table === 'rpc:auth_rate_limit_hit')
    expect(rpcCalls).toHaveLength(4)
    for (const c of rpcCalls) {
      expect(c.payload.p_key_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(c.payload)).not.toMatch(/foo@example\.com|203\.0\.113\.7/)
    }
  })

  test('2nd request for the same email inside 60 s → 200 ok, generateLink not called again', async () => {
    await POST(req({ email: 'foo@example.com' }))
    clock += 30 * 1000
    const res = await POST(req({ email: 'FOO@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockGenerateLink).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalled()
    expect(console.warn.mock.calls.flat().join(' ')).not.toMatch(/foo@example\.com/)
  })

  test('6th request in an hour (a minute apart) is blocked', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await POST(req({ email: 'foo@example.com' }))).status).toBe(200)
      clock += 61 * 1000
    }
    expect(mockGenerateLink).toHaveBeenCalledTimes(5)
    const res = await POST(req({ email: 'foo@example.com' }))
    expect(await res.json()).toEqual({ ok: true })
    expect(mockGenerateLink).toHaveBeenCalledTimes(5)
  })

  test('per-IP limit blocks different emails from one IP (11th in 15 min)', async () => {
    for (let i = 0; i < 10; i++) await POST(req({ email: `user${i}@example.com` }))
    expect(mockGenerateLink).toHaveBeenCalledTimes(10)
    const res = await POST(req({ email: 'other@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockGenerateLink).toHaveBeenCalledTimes(10)
    // A different IP still works (fresh email: the blocked attempt counted against 'other@' too)
    await POST(req({ email: 'third@example.com' }, '198.51.100.2'))
    expect(mockGenerateLink).toHaveBeenCalledTimes(11)
  })

  test('unknown email → ok, no email sent', async () => {
    mockGenerateLink.mockResolvedValue({ data: null, error: { message: 'User not found' } })
    const res = await POST(req({ email: 'ghost@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('Resend failure → 200 ok (same answer), error logged', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'resend down' } })
    const res = await POST(req({ email: 'foo@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(console.error).toHaveBeenCalledWith('[reset-password] email failed', 'resend down')
  })

  test.each([
    ['invalid JSON', '{not json'],
    ['missing email', {}],
    ['invalid email', { email: 'nope' }],
    ['non-string email', { email: ['a@b.co'] }],
  ])('%s → 400, no generateLink', async (_, body) => {
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Enter a valid email address.')
    expect(mockGenerateLink).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('RPC missing (060 not applied) → in-memory limiter still blocks the 2nd request', async () => {
    mockState.rpc = {}
    expect((await POST(req({ email: 'foo@example.com' }))).status).toBe(200)
    const res = await POST(req({ email: 'foo@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockGenerateLink).toHaveBeenCalledTimes(1)
    expect(console.error).not.toHaveBeenCalled() // missing function is expected, not an error
  })

  test('RPC failing for another reason → in-memory limiter + console.error, never 500', async () => {
    mockState.rpc.auth_rate_limit_hit = () => ({ data: null, error: { message: 'connection reset', code: 'XX000' } })
    expect((await POST(req({ email: 'foo@example.com' }))).status).toBe(200)
    expect((await POST(req({ email: 'foo@example.com' }))).status).toBe(200)
    expect(mockGenerateLink).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalled()
  })
})

describe('migration 060', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '060_auth_reset_rate_limit.sql'), 'utf8')
  const body = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  test('table, RLS, function, revokes, grant', () => {
    expect(body).toMatch(/CREATE TABLE IF NOT EXISTS public\.auth_rate_limits/)
    expect(body).toMatch(/PRIMARY KEY \(bucket, key_hash, window_start\)/)
    expect(body).toMatch(/CREATE INDEX IF NOT EXISTS \w+\s+ON public\.auth_rate_limits \(window_start\)/)
    expect(body).toMatch(/ALTER TABLE public\.auth_rate_limits ENABLE ROW LEVEL SECURITY/)
    expect(body).not.toMatch(/CREATE POLICY/i)
    expect(body).toMatch(/REVOKE ALL ON TABLE public\.auth_rate_limits FROM anon, authenticated/)
    expect(body).toMatch(/CREATE OR REPLACE FUNCTION public\.auth_rate_limit_hit\(/)
    expect(body).toMatch(/SECURITY DEFINER/)
    expect(body).toMatch(/SET search_path = public/)
    expect(body).toMatch(/ON CONFLICT \(bucket, key_hash, window_start\)\s+DO UPDATE SET hits = t\.hits \+ 1/)
    expect(body).toMatch(/REVOKE EXECUTE ON FUNCTION public\.auth_rate_limit_hit\(text, text, int, int\) FROM anon, authenticated/)
    expect(body).toMatch(/GRANT EXECUTE ON FUNCTION public\.auth_rate_limit_hit\(text, text, int, int\) TO service_role/)
    expect(sql).toMatch(/ROLLBACK/)
  })
  test('no raw email / IP column', () => {
    const table = body.match(/CREATE TABLE IF NOT EXISTS public\.auth_rate_limits \(([\s\S]*?)\);/)[1]
    expect(table).not.toMatch(/\bemail\b|\bip\b|ip_address/i)
    expect(table).toMatch(/key_hash\s+text/)
  })
})
