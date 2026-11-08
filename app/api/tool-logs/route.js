import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requirePM } from '../../../lib/server-auth'
import { notify } from '../../../lib/notify'
import { escapeHtml } from '../../../lib/email'
import { siteUrl } from '../../../lib/site-url'
import { isBotEmail } from '../../../lib/bot-rules'
import { toolLogDenied, toolCasFilters, toolUpdateForAction, TOOL_ALERT_ACTIONS, TOOL_ACTION_LABELS, TOOL_MANAGER_ROLES } from '../../../lib/tool-actions'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LOG_SELECT = '*, logged_by_profile:logged_by(full_name), assigned_profile:assigned_to(full_name)'
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const tool_id = searchParams.get('tool_id')
    const assigned_to = searchParams.get('assigned_to')

    let query = adminSupabase
      .from('tool_logs')
      .select(LOG_SELECT)
      .order('log_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (tool_id) query = query.eq('tool_id', tool_id)
    if (assigned_to) query = query.eq('assigned_to', assigned_to)

    const { data, error } = await query
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST { tool_id, log_type, log_date?, notes?, assigned_to? (checkout only) }
// Writes the history row AND applies the change to the tool in the same request
// (see toolUpdateForAction). logged_by is the caller. Supers may only log field
// actions on a tool assigned to them. Lost / damage notify the office.
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const action = body?.log_type
    const { data: tool, error: toolErr } = body?.tool_id
      ? await adminSupabase.from('tools').select('*').eq('id', body.tool_id).maybeSingle()
      : { data: null, error: null }
    if (toolErr) return Response.json({ error: toolErr.message }, { status: 500 })
    const denied = toolLogDenied(auth, tool, action)
    if (denied) return Response.json({ error: denied.error }, { status: denied.status })

    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    if (action !== 'checkin' && action !== 'checkout' && action !== 'found' && !notes && !TOOL_MANAGER_ROLES.has(auth.role)) {
      return Response.json({ error: 'Add a short description.' }, { status: 400 })
    }
    const change = toolUpdateForAction(action, { assignTo: body.assigned_to || null })
    if (change.error) return Response.json({ error: change.error }, { status: 400 })

    const row = {
      tool_id: tool.id,
      log_type: action,
      log_date: isDate(body.log_date) ? body.log_date : new Date().toISOString().slice(0, 10),
      notes,
      logged_by: auth.userId,
      // Who had it: the new assignee on a checkout, else whoever held it.
      assigned_to: action === 'checkout' ? change.updates.assigned_to : tool.assigned_to || null,
    }
    // 1) Compare-and-set the inventory row FIRST: only change the tool if it is
    //    still in the state the caller was authorized against (toolCasFilters).
    //    A tool reassigned or changed in between matches zero rows → 409, and
    //    no history row is ever written for an action that did not happen.
    let upd = adminSupabase.from('tools').update(change.updates).eq('id', tool.id)
    for (const [col, val] of toolCasFilters(auth, tool)) upd = val === null ? upd.is(col, null) : upd.eq(col, val)
    const { data: updated, error: updErr } = await upd
      .select('*, assigned_profile:assigned_to(id, full_name)').maybeSingle()
    if (updErr) return Response.json({ error: `Tool was not updated: ${updErr.message}` }, { status: 500 })
    if (!updated) return Response.json({ error: 'This tool changed since you opened it (it may have been reassigned). Reload and try again.' }, { status: 409 })

    // 2) History row only after the inventory change applied.
    const { data: log, error: logErr } = await adminSupabase.from('tool_logs').insert(row).select(LOG_SELECT).single()
    if (logErr || !log) {
      // Keep history and inventory in step: put the tool back, but only if it is
      // still exactly what we just wrote (never clobber a newer change).
      const undone = await revertToolUpdate(tool, change.updates)
      const why = logErr?.message || 'no row returned'
      if (!undone) return Response.json({ error: `Tool history could not be saved (${why}) and the tool change could not be undone. Reload and check this tool.` }, { status: 500 })
      return Response.json({ error: `Tool history could not be saved (${why}). Nothing was changed.` }, { status: 500 })
    }

    if (TOOL_ALERT_ACTIONS.has(action)) await alertOffice({ auth, tool, action, notes })
    return Response.json({ ok: true, data: log, tool: updated })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Undo a tools update: set the changed columns back to the snapshot values,
// compare-and-set on the values we wrote. True only when exactly that row was restored.
async function revertToolUpdate(tool, updates) {
  try {
    const back = {}
    for (const col of Object.keys(updates)) back[col] = tool[col] === undefined ? null : tool[col]
    let q = adminSupabase.from('tools').update(back).eq('id', tool.id)
    for (const [col, val] of Object.entries(updates)) q = val === null ? q.is(col, null) : q.eq(col, val)
    const { data, error } = await q.select('id').maybeSingle()
    return !error && !!data
  } catch {
    return false
  }
}

// Bell + email to the people who manage tools (Owner/PM/APM). Never throws.
export async function alertOffice({ auth, tool, action, notes }) {
  try {
    const { data: who } = await adminSupabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle()
    const by = who?.full_name || auth.email || 'A superintendent'
    const label = TOOL_ACTION_LABELS[action] || action
    const name = [tool.name, tool.brand, tool.model].filter(Boolean).join(' · ')
    // profiles has no email column: addresses come from auth.users (admin API).
    const { data: staff } = await adminSupabase.from('profiles').select('id, role').in('role', [...TOOL_MANAGER_ROLES])
    const withEmail = await Promise.all((staff || []).filter(p => p.id !== auth.userId).map(async p => {
      const { data } = await adminSupabase.auth.admin.getUserById(p.id).catch(() => ({ data: null }))
      return { ...p, email: data?.user?.email || null }
    }))
    const recipients = withEmail.filter(p => !isBotEmail(p.email))
    const title = `Tool ${action === 'lost' ? 'reported lost' : 'damage reported'}: ${tool.name}`
    const text = `${by}: ${label} — ${name}${tool.serial_number ? ` (SN ${tool.serial_number})` : ''}${notes ? `. ${notes}` : ''}`
    await Promise.all(recipients.map(p => notify({
      recipient_id: p.id, type: `tool_${action}`, title, body: text, link: '/dashboard?tab=tools',
      entity_type: 'tool', entity_id: tool.id,
    })))
    const to = recipients.map(p => p.email).filter(Boolean)
    if (!to.length) return
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'NV Construction <noreply@nvim.co>',
      to,
      subject: title,
      html: `<p><strong>${escapeHtml(by)}</strong> logged <strong>${escapeHtml(label)}</strong> on <strong>${escapeHtml(name)}</strong>${tool.serial_number ? ` (SN ${escapeHtml(tool.serial_number)})` : ''}.</p>${notes ? `<p>${escapeHtml(notes)}</p>` : ''}<p><a href="${siteUrl('/dashboard?tab=tools')}">Open Tools inventory</a></p>`,
    })
  } catch (e) {
    console.error('[tool-logs alert]', e?.message)
  }
}
