import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import {
  getPreviewSession,
  buildPreviewCookies,
  clearPreviewCookies,
  endAllPreviewSessions,
  PREVIEW_ADMIN_ROLES,
  PREVIEWABLE_ROLES,
  SUB_PREVIEW_ROLES,
} from '../../../lib/preview-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET — return the caller's current preview status (no auth required for client polling)
export async function GET(request) {
  const session = await getPreviewSession(request)
  if (!session) return NextResponse.json({ active: false })
  return NextResponse.json({
    active: true,
    previewRole: session.preview_role,
    previewCompanyId: session.preview_company_id,
    sessionId: session.id,
  })
}

// POST — start a new preview session (requires PM or Admin role)
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  if (!PREVIEW_ADMIN_ROLES.has(auth.role)) {
    return NextResponse.json(
      { error: 'Only PM and Admin users may start a role preview.' },
      { status: 403 }
    )
  }

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }) }

  const { previewRole, previewCompanyId } = body

  if (!PREVIEWABLE_ROLES.includes(previewRole)) {
    return NextResponse.json({ error: `Invalid preview role "${previewRole}".` }, { status: 400 })
  }
  if (SUB_PREVIEW_ROLES.has(previewRole) && !previewCompanyId) {
    return NextResponse.json(
      { error: 'A company must be selected when previewing a sub role.' },
      { status: 400 }
    )
  }

  // End any existing sessions for this user before creating a new one
  await endAllPreviewSessions(auth.userId)

  const { data: session, error } = await adminSupabase
    .from('preview_sessions')
    .insert({
      started_by:        auth.userId,
      preview_role:      previewRole,
      preview_company_id: previewCompanyId ?? null,
      user_agent:  request.headers.get('user-agent') ?? null,
      ip_address:  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[preview-session] insert error:', error)
    return NextResponse.json({ error: 'Failed to create preview session.' }, { status: 500 })
  }

  const res = NextResponse.json({ ok: true, sessionId: session.id, previewRole })
  for (const c of buildPreviewCookies(session.id, previewRole, previewCompanyId)) {
    res.headers.append('Set-Cookie', c)
  }
  return res
}

// DELETE — end the active preview session and clear cookies
export async function DELETE(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  const preview = await getPreviewSession(request)
  if (preview) {
    await adminSupabase
      .from('preview_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', preview.id)
      .eq('started_by', auth.userId)
  }

  const res = NextResponse.json({ ok: true })
  for (const c of clearPreviewCookies()) res.headers.append('Set-Cookie', c)
  return res
}
