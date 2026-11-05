/**
 * Tests for findAuthUserByEmail in lib/auth-users.js (paged auth user lookup).
 */
import { describe, it, expect, jest } from '@jest/globals'
import { findAuthUserByEmail } from '../lib/auth-users'

function mockAdmin(pages, error = null) {
  const listUsers = jest.fn(async ({ page }) => {
    if (error) return { data: { users: [] }, error }
    return { data: { users: pages[page - 1] || [] }, error: null }
  })
  return { client: { auth: { admin: { listUsers } } }, listUsers }
}

const makeUsers = (n, prefix) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, email: `${prefix}${i}@example.com` }))

describe('findAuthUserByEmail', () => {
  it('finds a user on page 2', async () => {
    const page1 = makeUsers(3, 'a')
    const page2 = [...makeUsers(1, 'b'), { id: 'target', email: 'sub@example.com' }]
    const { client, listUsers } = mockAdmin([page1, page2])
    const user = await findAuthUserByEmail(client, 'sub@example.com', { perPage: 3 })
    expect(user?.id).toBe('target')
    expect(listUsers).toHaveBeenCalledTimes(2)
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 3 })
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 3 })
  })

  it('returns null when not found and stops at a short page', async () => {
    const { client, listUsers } = mockAdmin([makeUsers(3, 'a'), makeUsers(3, 'b'), makeUsers(1, 'c')])
    expect(await findAuthUserByEmail(client, 'nobody@example.com', { perPage: 3 })).toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(3)
  })

  it('stops on an empty page when the last full page is exactly perPage', async () => {
    const { client, listUsers } = mockAdmin([makeUsers(3, 'a')])
    expect(await findAuthUserByEmail(client, 'nobody@example.com', { perPage: 3 })).toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(2)
  })

  it('matches email case-insensitively', async () => {
    const { client } = mockAdmin([[{ id: 'x', email: 'Mixed.Case@Example.com' }]])
    const user = await findAuthUserByEmail(client, '  mixed.CASE@example.COM ')
    expect(user?.id).toBe('x')
  })

  it('defaults to perPage 1000', async () => {
    const { client, listUsers } = mockAdmin([[]])
    await findAuthUserByEmail(client, 'a@b.com')
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1000 })
  })

  it('throws when listUsers returns an error', async () => {
    const { client } = mockAdmin([], { message: 'boom' })
    await expect(findAuthUserByEmail(client, 'a@b.com')).rejects.toThrow('boom')
  })
})
