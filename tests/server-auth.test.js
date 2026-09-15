/**
 * Tests for lib/server-auth.js
 * Uses fake Request objects — no network calls, no Supabase connection needed.
 * Supabase clients are mocked below.
 */

// ── Mock Supabase before importing server-auth ────────────────────────────────
const mockGetUser = jest.fn()
const mockProfileSelect = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((url, key) => {
    if (key === process.env.SUPABASE_SERVICE_ROLE_KEY || key === 'service-role-key') {
      // admin client
      return {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: mockProfileSelect,
            }),
          }),
        }),
      }
    }
    // anon client — used to verify the user's JWT
    return {
      auth: {
        getUser: mockGetUser,
      },
    }
  }),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.CRON_SECRET = 'test-cron-secret'

const { requireAuth, requirePM, verifyCronSecret, isPM, isSub } = require('../lib/server-auth')

function makeRequest(headers = {}) {
  return {
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
  }
}

describe('requireAuth', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockProfileSelect.mockReset()
  })

  it('returns 401 when no Authorization header', async () => {
    const result = await requireAuth(makeRequest({}))
    expect(result.error).toBeDefined()
    const json = await result.error.json()
    expect(result.error.status).toBe(401)
    expect(json.error).toMatch(/Unauthorized/)
  })

  it('returns 401 when token is invalid', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid JWT' } })
    const result = await requireAuth(makeRequest({ authorization: 'Bearer bad-token' }))
    expect(result.error).toBeDefined()
    expect(result.error.status).toBe(401)
  })

  it('returns userId and role on valid token', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockProfileSelect.mockResolvedValue({ data: { role: 'pm', company_id: null }, error: null })
    const result = await requireAuth(makeRequest({ authorization: 'Bearer valid-token' }))
    expect(result.error).toBeNull()
    expect(result.userId).toBe('user-123')
    expect(result.role).toBe('pm')
  })

  it('handles missing profile gracefully (no profile row)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-456' } }, error: null })
    mockProfileSelect.mockResolvedValue({ data: null, error: null })
    const result = await requireAuth(makeRequest({ authorization: 'Bearer valid-token' }))
    expect(result.error).toBeNull()
    expect(result.role).toBeNull()
  })
})

describe('requirePM', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockProfileSelect.mockReset()
  })

  it('allows pm role', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pm-user' } }, error: null })
    mockProfileSelect.mockResolvedValue({ data: { role: 'pm', company_id: null }, error: null })
    const result = await requirePM(makeRequest({ authorization: 'Bearer token' }))
    expect(result.error).toBeNull()
  })

  it('allows super role', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'super-user' } }, error: null })
    mockProfileSelect.mockResolvedValue({ data: { role: 'super', company_id: null }, error: null })
    const result = await requirePM(makeRequest({ authorization: 'Bearer token' }))
    expect(result.error).toBeNull()
  })

  it('blocks subcontractor role with 403', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'sub-user' } }, error: null })
    mockProfileSelect.mockResolvedValue({ data: { role: 'subcontractor', company_id: 'co-1' }, error: null })
    const result = await requirePM(makeRequest({ authorization: 'Bearer token' }))
    expect(result.error).toBeDefined()
    expect(result.error.status).toBe(403)
  })

  it('blocks null role (no profile) with 403', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'unknown-user' } }, error: null })
    mockProfileSelect.mockResolvedValue({ data: null, error: null })
    const result = await requirePM(makeRequest({ authorization: 'Bearer token' }))
    expect(result.error.status).toBe(403)
  })
})

describe('verifyCronSecret', () => {
  it('returns true with correct secret', () => {
    expect(verifyCronSecret(makeRequest({ 'x-cron-secret': 'test-cron-secret' }))).toBe(true)
  })

  it('returns false with wrong secret', () => {
    expect(verifyCronSecret(makeRequest({ 'x-cron-secret': 'wrong' }))).toBe(false)
  })

  it('returns false with no secret', () => {
    expect(verifyCronSecret(makeRequest({}))).toBe(false)
  })
})

describe('role helpers', () => {
  it('isPM identifies pm/apm/super', () => {
    expect(isPM('pm')).toBe(true)
    expect(isPM('apm')).toBe(true)
    expect(isPM('super')).toBe(true)
    expect(isPM('subcontractor')).toBe(false)
    expect(isPM(null)).toBe(false)
  })

  it('isSub identifies sub roles', () => {
    expect(isSub('subcontractor')).toBe(true)
    expect(isSub('sub_admin')).toBe(true)
    expect(isSub('pm')).toBe(false)
    expect(isSub(null)).toBe(false)
  })
})
