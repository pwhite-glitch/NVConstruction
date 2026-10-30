import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeAll } from '@jest/globals'

// Route modules create Supabase clients at import time; they only need a URL and key shape.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'service'

const ROOT = path.join(__dirname, '..', 'app', 'api', 'bot', 'v1')
const routeFiles = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name === 'route.js') routeFiles.push(p)
  }
})(ROOT)

const rel = (p) => path.relative(ROOT, p) || 'route.js'
const mods = {}
beforeAll(async () => {
  for (const f of routeFiles) mods[f] = await import(f)
})

describe('Bot API routes', () => {
  it('finds all the routes', () => {
    expect(routeFiles.map(rel).sort()).toEqual([
      '[...path]/route.js', 'attachments/route.js', 'billings/route.js', 'budgets/route.js',
      'change-orders/route.js', 'contracts/route.js', 'job-companies/route.js', 'jobs/[id]/route.js',
      'jobs/route.js', 'route.js', 'subcontracts/route.js',
    ].sort())
  })

  it('refuses DELETE, PUT and PATCH everywhere with 403', async () => {
    for (const f of routeFiles) {
      for (const m of ['DELETE', 'PUT', 'PATCH']) {
        expect(typeof mods[f][m]).toBe('function')
        const res = await mods[f][m]({ headers: { get: () => null } })
        expect([rel(f), m, res.status]).toEqual([rel(f), m, 403])
      }
    }
  })

  it('POST exists only on the four write endpoints; elsewhere it is refused', async () => {
    const writes = ['attachments/route.js', 'billings/route.js', 'job-companies/route.js', 'subcontracts/route.js']
    for (const f of routeFiles) {
      if (writes.includes(rel(f))) continue
      const res = await mods[f].POST({ headers: { get: () => null } })
      expect([rel(f), res.status]).toEqual([rel(f), 403])
    }
  })

  it('never imports email, notification or e-signature code', () => {
    const bannedImport = /email|notify|notification|resend|sign|invite|draw/i
    const bannedCall = /\bnotify\(|\bsendEmail\(|resend\.|\/api\/(send-email|notify-sub|invite-sub|sub-initiate-sign|signing-requests|draw-requests)/i
    const sources = [...routeFiles, path.join(__dirname, '..', 'lib', 'bot-api.js'), path.join(__dirname, '..', 'lib', 'bot-auth.js')]
    for (const f of sources) {
      const src = fs.readFileSync(f, 'utf8')
      const imports = [...src.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m => m[1])
      expect([f, imports.filter(i => bannedImport.test(i))]).toEqual([f, []])
      expect([f, bannedCall.test(src)]).toEqual([f, false])
    }
  })

  // public.profiles has no email column (only invite_email); the login email lives in auth.users
  it('never selects or writes profiles.email', () => {
    const repo = path.join(__dirname, '..')
    const files = [
      ...routeFiles,
      ...['lib/bot-auth.js', 'lib/bot-api.js', 'lib/bot-rules.js', 'app/api/admin/bot-keys/route.js', 'scripts/create-bot-users.js']
        .map(f => path.join(repo, f)),
    ]
    const hasEmail = (text) => /(^|[^\w])email\b/.test(text.replace(/\b\w+_email\b/g, ''))
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      const selects = [...src.matchAll(/from\(['"]profiles['"]\)\s*\.select\(\s*['"`]([^'"`]*)['"`]/g)].map(m => m[1])
      const writes = [...src.matchAll(/from\(['"]profiles['"]\)\s*\.(?:upsert|insert|update)\(\s*\{([\s\S]*?)\}/g)].map(m => m[1])
      expect([rel(f), [...selects, ...writes].filter(hasEmail)]).toEqual([rel(f), []])
    }
    // The check itself catches what it should
    expect(hasEmail('id, full_name, email')).toBe(true)
    expect(hasEmail('\n id: user.id,\n email: bot.email,\n')).toBe(true)
    expect(hasEmail('id, invite_email')).toBe(false)
  })

  it('every write route requires a bot key', async () => {
    for (const name of ['attachments', 'billings', 'job-companies', 'subcontracts']) {
      const f = routeFiles.find(p => rel(p) === `${name}/route.js`)
      process.env.SUPABASE_JWT_SECRET = 'x'.repeat(40)
      const res = await mods[f].POST({ headers: { get: () => null } })
      expect([name, res.status]).toEqual([name, 401])
    }
  })
})
