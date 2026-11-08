// Tool inventory rules shared by /api/tools and /api/tool-logs (and the pages).
// Tool status values: available, checked_out, repair, lost, retired.

export const TOOL_STATUSES = ['available', 'checked_out', 'repair', 'lost', 'retired']

// Who may add/edit/retire tools and log office-side actions (check out, repair, found).
export const TOOL_MANAGER_ROLES = new Set(['principal', 'pm', 'apm'])
export const canManageTools = role => TOOL_MANAGER_ROLES.has(role)

// Field-side actions a super may log on a tool assigned to them.
export const FIELD_TOOL_ACTIONS = ['checkin', 'damage', 'lost', 'maintenance']
// Every log type the API accepts.
export const TOOL_LOG_TYPES = ['checkin', 'checkout', 'damage', 'lost', 'maintenance', 'repair', 'found']

// Actions that tell the office something went wrong.
export const TOOL_ALERT_ACTIONS = new Set(['damage', 'lost'])

// Columns a client may set on a tool (status/assignee are derived; see toolStatusFor).
export const TOOL_FIELDS = ['name', 'brand', 'model', 'serial_number', 'category', 'purchase_date', 'purchase_cost', 'condition', 'assigned_to', 'job_site', 'notes', 'status']

export function pickToolFields(body) {
  const out = {}
  for (const k of TOOL_FIELDS) if (body && body[k] !== undefined) out[k] = body[k]
  if ('assigned_to' in out) out.assigned_to = out.assigned_to || null
  if ('purchase_date' in out) out.purchase_date = out.purchase_date || null
  if ('purchase_cost' in out) {
    const n = out.purchase_cost === '' || out.purchase_cost == null ? null : Number(out.purchase_cost)
    out.purchase_cost = Number.isFinite(n) ? n : null
  }
  if ('status' in out && !TOOL_STATUSES.includes(out.status)) delete out.status
  return out
}

// Status implied by an assignment. Assigning someone → checked_out (an assigned
// tool is never "available"). Clearing the assignee from a checked-out tool →
// available. Repair / lost stay as chosen (lost keeps who had it).
export function toolStatusFor(assignedTo, requestedStatus, currentStatus) {
  const status = requestedStatus || currentStatus || 'available'
  if (assignedTo) return status === 'repair' || status === 'lost' ? status : 'checked_out'
  if (status === 'checked_out') return 'available'
  return status
}

// The change to the tools row for a log action. Returns { updates } or { error }.
//   checkin      → assigned_to null, status available
//   checkout     → assigned_to <assignee>, status checked_out (assignee required)
//   lost         → status lost (stays on the assignee's record of who had it)
//   damage       → status repair, condition poor (existing good/fair/poor scale)
//   maintenance  → status repair
//   repair       → status repair
//   found        → status available, assigned_to null
export function toolUpdateForAction(action, { assignTo } = {}) {
  switch (action) {
    case 'checkin': return { updates: { assigned_to: null, status: 'available' } }
    case 'checkout':
      if (!assignTo) return { error: 'Choose who the tool is checked out to.' }
      return { updates: { assigned_to: assignTo, status: 'checked_out' } }
    case 'lost': return { updates: { status: 'lost' } }
    case 'damage': return { updates: { status: 'repair', condition: 'poor' } }
    case 'maintenance': return { updates: { status: 'repair' } }
    case 'repair': return { updates: { status: 'repair' } }
    case 'found': return { updates: { status: 'available', assigned_to: null } }
    default: return { error: 'Unknown tool action.' }
  }
}

// May this caller log `action` on `tool`? Returns null when allowed, else { status, error }.
// Managers (Owner/PM/APM) may log any action on any tool. Supers may only log
// field actions on a tool currently assigned to them. Everyone else: 403.
export function toolLogDenied(auth, tool, action) {
  if (!TOOL_LOG_TYPES.includes(action)) return { status: 400, error: 'Unknown tool action.' }
  if (!tool) return { status: 404, error: 'Tool not found.' }
  if (tool.status === 'retired') return { status: 409, error: 'This tool is retired.' }
  if (canManageTools(auth?.role)) return null
  if (auth?.role === 'super') {
    if (!FIELD_TOOL_ACTIONS.includes(action)) return { status: 403, error: 'Only the office can do that.' }
    if (!tool.assigned_to || tool.assigned_to !== auth.userId) return { status: 403, error: 'This tool is not assigned to you.' }
    return null
  }
  return { status: 403, error: 'Forbidden' }
}

// Conditions the tools UPDATE must still match, as [[column, value], ...]
// (value null → IS NULL). They pin the row to the snapshot toolLogDenied
// authorized, so a stale read can never change a tool that was reassigned or
// changed in between. A super's field action is pinned to assigned_to = the
// session user (the only assignee they were allowed to act for).
export function toolCasFilters(auth, tool) {
  const assignee = auth?.role === 'super' ? auth.userId : (tool?.assigned_to ?? null)
  return [['assigned_to', assignee], ['status', tool?.status ?? null]]
}

export const TOOL_ACTION_LABELS = { checkout: 'Checked Out', checkin: 'Checked In', repair: 'Sent for Repair', damage: 'Damage Reported', lost: 'Reported Lost', found: 'Found / Recovered', maintenance: 'Needs Maintenance' }
