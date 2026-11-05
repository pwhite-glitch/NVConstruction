// Look up a Supabase auth user by email. auth.admin.listUsers() is paginated
// (default 50 per page), so an unpaged call misses users past the first page.
// Throws if listUsers returns an error. Returns the user or null.
export async function findAuthUserByEmail(adminSupabase, email, { perPage = 1000 } = {}) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return null
  for (let page = 1; ; page++) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`Could not look up existing user: ${error.message || error}`)
    const users = data?.users || []
    const found = users.find(u => u.email?.toLowerCase() === target)
    if (found) return found
    if (users.length < perPage) return null
  }
}
