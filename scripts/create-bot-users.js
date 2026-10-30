// One-time setup: create the three Bot API users. Run locally AFTER migration 036:
//
//   node --env-file=.env.local scripts/create-bot-users.js
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Idempotent: an
// existing bot user is left in place and its profile is re-applied.
//
// Each bot gets a random password that is never printed or stored, a confirmed
// email, and an auth ban so password sign-in is refused by Supabase itself (the
// Bot API mints its own short-lived tokens, which the ban doesn't affect).
// Profiles get role 'pm' (office RLS policies apply) and is_bot = true.
// This script prints no keys: generate them on /admin → Bot Access.

const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

const BOTS = [
  { email: 'bot-peyton@bots.nv.construction', full_name: 'Portal Bot (Peyton)' },
  { email: 'bot-nishil@bots.nv.construction', full_name: 'Portal Bot (Nishil)' },
  { email: 'bot-vivek@bots.nv.construction',  full_name: 'Portal Bot (Vivek)' },
]
const BAN_DURATION = '876000h' // ~100 years

async function findUserByEmail(admin, email) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const hit = data.users.find(u => u.email?.toLowerCase() === email)
    if (hit) return hit
    if (data.users.length < 1000) return null
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. node --env-file=.env.local ...)')
    process.exit(1)
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Fails clearly if migration 036 hasn't been applied yet
  const { error: colErr } = await admin.from('profiles').select('is_bot').limit(1)
  if (colErr) {
    console.error(`profiles.is_bot is missing — apply migrations/036_bot_api_keys.sql first. (${colErr.message})`)
    process.exit(1)
  }

  let failed = false
  for (const bot of BOTS) {
    try {
      let user = await findUserByEmail(admin, bot.email)
      let created = false
      if (!user) {
        const { data, error } = await admin.auth.admin.createUser({
          email: bot.email,
          password: crypto.randomBytes(32).toString('base64url'),
          email_confirm: true,
          user_metadata: { full_name: bot.full_name },
          ban_duration: BAN_DURATION,
        })
        if (error) throw new Error(`createUser: ${error.message}`)
        user = data.user
        created = true
      } else {
        const { error } = await admin.auth.admin.updateUserById(user.id, { email_confirm: true, ban_duration: BAN_DURATION })
        if (error) throw new Error(`updateUserById: ${error.message}`)
      }

      // The signup trigger creates the profile as 'subcontractor' (migration 029); set the real values
      const { error: profErr } = await admin.from('profiles').upsert({
        id: user.id,
        full_name: bot.full_name,
        role: 'pm',
        is_bot: true,
      }, { onConflict: 'id' })
      if (profErr) throw new Error(`profile: ${profErr.message}`)

      console.log(`${created ? 'created ' : 'exists  '} ${bot.full_name}  ${bot.email}  ${user.id}`)
    } catch (e) {
      failed = true
      console.error(`FAILED   ${bot.full_name}  ${bot.email}: ${e.message}`)
    }
  }
  if (failed) process.exit(1)
  console.log('\nDone. Generate keys on /admin → Bot Access.')
}

main()
