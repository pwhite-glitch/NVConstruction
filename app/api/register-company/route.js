import { createClient } from '@supabase/supabase-js'
import { requireAuth, SUB_ROLES } from '../../../lib/server-auth'
import { sameCompany } from '../../../lib/company-name'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Accounts created this recently may finish registration without a session
// (with Supabase email confirmation on, signUp() returns no session).
const NEW_ACCOUNT_WINDOW_MS = 60 * 60 * 1000

// Who is registering: the session user when there is one, otherwise the body's
// user_id only if that auth user was created in the last hour with this email.
async function resolveRegistrant(request, user_id, email) {
  if (request.headers.get('authorization')) {
    const auth = await requireAuth(request)
    if (auth.error) return { error: auth.error }
    return { userId: auth.userId, email: auth.email }
  }
  if (!user_id || !email) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data, error } = await adminSupabase.auth.admin.getUserById(user_id)
  const user = data?.user
  const fresh = user && Date.now() - new Date(user.created_at).getTime() < NEW_ACCOUNT_WINDOW_MS
  if (error || !fresh || user.email?.toLowerCase() !== email.toLowerCase().trim()) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { userId: user.id, email: user.email }
}

// Self-registration from /register and /apply, right after supabase.auth.signUp().
// - Only fills in the caller's own profile, and never one that already has an
//   office role or a company link.
// - Joins a company only when it creates that company. If a company with this
//   name already exists, the profile keeps company_name but no company_id, and
//   office staff link it (Directory "repair company links" / fix-profile), so
//   nobody can join an existing company's jobs and billing by typing its name.
export async function POST(request) {
  try {
    const { user_id, company_name, contact_name, full_name, email, phone, address, trade, scope_description, coi_expiration, license_number, w9_url, coi_url } = await request.json()
    if (!company_name) return Response.json({ error: 'company_name required' }, { status: 400 })

    const who = await resolveRegistrant(request, user_id, email)
    if (who.error) return who.error
    const loginEmail = who.email?.toLowerCase().trim() || null

    const { data: existingProfile } = await adminSupabase.from('profiles').select('role, company_id').eq('id', who.userId).maybeSingle()
    if (existingProfile && ((existingProfile.role && !SUB_ROLES.has(existingProfile.role)) || existingProfile.company_id)) {
      return Response.json({ error: 'This account is already set up.' }, { status: 409 })
    }

    const { data: companies } = await adminSupabase.from('companies').select('id, name')
    const existingCo = (companies || []).find(c => sameCompany(c.name, company_name))

    let company_id = null
    if (!existingCo) {
      const { data: newCo, error: coErr } = await adminSupabase
        .from('companies')
        .insert({ name: company_name.trim(), email: loginEmail, phone: phone || null })
        .select('id')
        .single()
      if (coErr) return Response.json({ error: coErr.message }, { status: 500 })
      company_id = newCo.id
    }

    // Insert sub_directory entry
    const { error: dirErr } = await adminSupabase.from('sub_directory').insert({
      company_name: company_name.trim(),
      contact_name: contact_name || company_name.trim(),
      email: loginEmail,
      phone: phone || null,
      address: address || null,
      trade: trade || null,
      scope_description: scope_description || null,
      coi_expiration: coi_expiration || null,
      license_number: license_number || null,
      w9_url: w9_url || null,
      coi_url: coi_url || null,
      status: 'approved',
      applied_at: new Date().toISOString(),
    })
    if (dirErr && dirErr.code !== '23505') return Response.json({ error: dirErr.message }, { status: 500 })

    // Upsert profile — works whether or not a row exists yet
    const { error: profErr } = await adminSupabase
      .from('profiles')
      .upsert({
        id: who.userId,
        company_id,
        company_name: company_name.trim(),
        full_name: full_name || contact_name || null,
        phone: phone || null,
        role: 'subcontractor',
        invite_email: loginEmail,
      }, { onConflict: 'id', ignoreDuplicates: false })
    if (profErr) return Response.json({ error: profErr.message }, { status: 500 })

    return Response.json({ ok: true, company_id, pending_company_link: !!existingCo })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
