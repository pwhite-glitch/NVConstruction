// SignWell status helpers (prompt 98). No imports, no secrets: shared by the server
// (lib/signwell.js, routes) and the job page.

// ── Status ───────────────────────────────────────────────────────────────────
// SignWell document status (TitleCase) → what we store in subcontracts.signwell_status.
const STATUS_MAP = {
  draft: 'draft', created: 'created', sending: 'sending', sent: 'sent', pending: 'pending', viewed: 'viewed',
  completed: 'completed', 'manually completed': 'manually_completed', declined: 'declined', canceled: 'canceled',
  cancelled: 'canceled', bounced: 'bounced', blocked: 'blocked', error: 'error', expired: 'expired',
}
export const mapSignwellStatus = s => STATUS_MAP[String(s ?? '').trim().toLowerCase()] || null

// Still out for signature: a reminder or a void makes sense.
export const SIGNWELL_OPEN_STATUSES = new Set(['draft', 'created', 'sending', 'sent', 'pending', 'viewed'])
export const isSignwellOpen = s => SIGNWELL_OPEN_STATUSES.has(s)

const LABELS = {
  draft: 'Draft', created: 'Created', sending: 'Sending', sent: 'Sent', pending: 'In progress', viewed: 'Viewed',
  completed: 'Completed', manually_completed: 'Manually completed', declined: 'Declined', canceled: 'Voided',
  bounced: 'Email bounced', blocked: 'Blocked', error: 'Error', expired: 'Expired',
}
export const signwellStatusLabel = s => LABELS[s] || (s ? String(s) : '')
