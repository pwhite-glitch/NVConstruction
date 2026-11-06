// Customer order portal (/portal/<token>) rules shared by the API route and tests.

// Office roles that may manage portal access on any sales order.
export const PORTAL_ANY_ORDER_ROLES = new Set(['principal', 'pm', 'apm', 'admin'])
// Sales reps: only on orders where they are the salesperson or ops owner.
export const PORTAL_REP_ROLES = new Set(['metal_rep', 'roofing_rep'])

export const QUESTION_MAX_CHARS = 2000
export const QUESTION_MIN_GAP_MS = 60 * 1000

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/
export const isValidEmail = e => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e.trim())

// May this staff user invite / list / revoke portal access on `order`?
export function canManageOrderPortal(role, userId, order) {
  if (!order) return false
  if (PORTAL_ANY_ORDER_ROLES.has(role)) return true
  if (PORTAL_REP_ROLES.has(role)) return !!userId && (order.salesperson_id === userId || order.ops_owner_id === userId)
  return false
}

// Find the customer-visible doc a portal user asked for, by id or by storage path,
// limited to the token's own order. Returns { doc } or { status, error }.
export async function findPortalDoc(db, orderId, { docId, path }) {
  if (!docId && !path) return { status: 400, error: 'doc_id or doc_url required' }
  let q = db.from('sales_order_docs').select('id, storage_path')
    .eq('order_id', orderId)
    .eq('visible_to_customer', true)
  q = docId ? q.eq('id', docId) : q.eq('storage_path', path)
  const { data, error } = await q.limit(1).maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!data || !data.storage_path) return { status: 404, error: 'Document not found' }
  if (path && data.storage_path !== path) return { status: 404, error: 'Document not found' }
  return { doc: data }
}
