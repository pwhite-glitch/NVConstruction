import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isPrincipal } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Employees (pay / HR) is Owner-only (principal), like the hidden screen.
const OWNER_ONLY = () => Response.json({ error: 'Only Owners can manage employees.' }, { status: 403 })

// The only columns callers may write (what the Employees screen sends).
const WRITABLE = ['name', 'title', 'type', 'weekly_salary', 'weekly_truck', 'weekly_healthcare', 'weekly_taxes', 'active']
const MONEY = new Set(['weekly_salary', 'weekly_truck', 'weekly_healthcare', 'weekly_taxes'])

function employeeFields(body) {
  const out = {}
  for (const k of WRITABLE) {
    if (!body || !(k in body)) continue
    let v = body[k]
    if (MONEY.has(k)) {
      if (v === '' || v == null) v = null
      else {
        v = Number(v)
        if (!Number.isFinite(v) || v < 0) return { error: `${k} must be a number of 0 or more` }
      }
    } else if (k === 'active') {
      v = Boolean(v)
    } else if (v != null) {
      v = String(v)
    }
    out[k] = v
  }
  return { fields: out }
}

async function ownerAuth(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth
  if (!isPrincipal(auth.role)) return { error: OWNER_ONLY() }
  return auth
}

export async function GET(request) {
  const auth = await ownerAuth(request)
  if (auth.error) return auth.error
  const { data, error } = await adminSupabase
    .from('employees')
    .select('*')
    .order('name')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ employees: data || [] })
}

export async function POST(request) {
  const auth = await ownerAuth(request)
  if (auth.error) return auth.error
  const { fields, error: fieldErr } = employeeFields(await request.json())
  if (fieldErr) return Response.json({ error: fieldErr }, { status: 400 })
  if (!fields.name?.trim()) return Response.json({ error: 'name required' }, { status: 400 })
  const { data, error } = await adminSupabase
    .from('employees')
    .insert(fields)
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ employee: data })
}

async function update(request) {
  const auth = await ownerAuth(request)
  if (auth.error) return auth.error
  const body = await request.json()
  if (!body?.id) return Response.json({ error: 'id required' }, { status: 400 })
  const { fields, error: fieldErr } = employeeFields(body)
  if (fieldErr) return Response.json({ error: fieldErr }, { status: 400 })
  if ('name' in fields && !fields.name?.trim()) return Response.json({ error: 'name cannot be blank' }, { status: 400 })
  if (!Object.keys(fields).length) return Response.json({ error: 'Nothing to update' }, { status: 400 })
  const { data, error } = await adminSupabase
    .from('employees')
    .update(fields)
    .eq('id', body.id)
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ employee: data })
}

export async function PATCH(request) {
  return update(request)
}

export async function PUT(request) {
  return update(request)
}

export async function DELETE(request) {
  const auth = await ownerAuth(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await adminSupabase.from('employees').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
