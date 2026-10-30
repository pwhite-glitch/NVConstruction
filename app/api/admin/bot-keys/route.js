import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { isPartner } from '../../../../lib/partners'
import { generateBotKey, hashBotKey, keyDisplayPrefix } from '../../../../lib/bot-auth'
import { logChange } from '../../../../lib/change-log'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const NO_STORE = { 'Cache-Control': 'no-store' }

// Partners only (lib/partners.js), checked here on the server, not just in the UI.
async function requirePartner(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth
  if (!isPartner(auth.userId)) return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  return auth
}

// GET → { bots: [{ id, full_name, email, key: { id, key_prefix, enabled, created_at, rotated_at, last_used_at } | null }] }
export async function GET(request) {
  const auth = await requirePartner(request)
  if (auth.error) return auth.error
  const { data: profiles, error } = await adminSupabase.from('profiles').select('id, full_name').eq('is_bot', true).order('full_name')
  if (error) return Response.json({ error: `${error.message} (has migration 036 been applied?)` }, { status: 500 })
  // profiles has no email column; the login email lives in auth
  const bots = await Promise.all((profiles || []).map(async (p) => {
    const { data } = await adminSupabase.auth.admin.getUserById(p.id)
    return { ...p, email: data?.user?.email || null }
  }))
  const ids = bots.map(b => b.id)
  let keys = []
  if (ids.length) {
    const { data, error: keyErr } = await adminSupabase.from('bot_api_keys')
      .select('id, bot_user_id, label, key_prefix, enabled, created_at, rotated_at, last_used_at')
      .in('bot_user_id', ids).is('revoked_at', null)
    if (keyErr) return Response.json({ error: keyErr.message }, { status: 500 })
    keys = data || []
  }
  return Response.json({
    bots: bots.map(b => ({ ...b, key: keys.find(k => k.bot_user_id === b.id) || null })),
  }, { headers: NO_STORE })
}

// POST { action: 'rotate', bot_user_id }        → revoke the live key, issue a new one; the raw key is returned ONCE
// POST { action: 'set_enabled', key_id, enabled } → turn the live key on/off
// POST { action: 'revoke', key_id }               → revoke the key (no replacement)
export async function POST(request) {
  const auth = await requirePartner(request)
  if (auth.error) return auth.error
  try {
    const { action, bot_user_id, key_id, enabled } = await request.json()
    const now = new Date().toISOString()

    if (action === 'rotate') {
      if (!bot_user_id) return Response.json({ error: 'bot_user_id required' }, { status: 400 })
      const { data: bot } = await adminSupabase.from('profiles').select('id, full_name, is_bot').eq('id', bot_user_id).maybeSingle()
      if (!bot?.is_bot) return Response.json({ error: 'Not a bot user' }, { status: 400 })

      const { data: revoked, error: revErr } = await adminSupabase.from('bot_api_keys')
        .update({ revoked_at: now, enabled: false }).eq('bot_user_id', bot.id).is('revoked_at', null).select('id')
      if (revErr) return Response.json({ error: revErr.message }, { status: 500 })

      const rawKey = generateBotKey()
      const { data: row, error } = await adminSupabase.from('bot_api_keys').insert({
        bot_user_id: bot.id,
        label: `${bot.full_name || 'Bot'} key`,
        key_prefix: keyDisplayPrefix(rawKey),
        key_hash: hashBotKey(rawKey),
        enabled: true,
        created_by: auth.userId,
        rotated_at: revoked?.length ? now : null,
      }).select('id, key_prefix').single()
      if (error) return Response.json({ error: error.message }, { status: 500 })

      logChange({ entity_type: 'bot_api_key', entity_id: row.id, field_name: 'key', new_value: row.key_prefix, changed_by: auth.userId, note: `Bot API key ${revoked?.length ? 'rotated' : 'generated'} — ${bot.full_name}` })
      return Response.json({ ok: true, key: rawKey, key_prefix: row.key_prefix, key_id: row.id }, { headers: NO_STORE })
    }

    if (action === 'set_enabled' || action === 'revoke') {
      if (!key_id) return Response.json({ error: 'key_id required' }, { status: 400 })
      if (action === 'set_enabled' && typeof enabled !== 'boolean') return Response.json({ error: 'enabled must be true or false' }, { status: 400 })
      const update = action === 'revoke' ? { revoked_at: now, enabled: false } : { enabled }
      const { data: row, error } = await adminSupabase.from('bot_api_keys').update(update)
        .eq('id', key_id).is('revoked_at', null).select('id, key_prefix, bot_user_id').maybeSingle()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      if (!row) return Response.json({ error: 'Key not found or already revoked' }, { status: 404 })
      const { data: bot } = await adminSupabase.from('profiles').select('full_name').eq('id', row.bot_user_id).maybeSingle()
      const what = action === 'revoke' ? 'revoked' : enabled ? 'enabled' : 'disabled'
      logChange({ entity_type: 'bot_api_key', entity_id: row.id, field_name: 'key', new_value: what, changed_by: auth.userId, note: `Bot API key ${row.key_prefix} ${what} — ${bot?.full_name || ''}` })
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
