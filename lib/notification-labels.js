// Bell notification labels and link targets, shared by the dashboard, field app,
// /sales and the shared NotificationBell. No imports.

export const NOTIFICATION_LABELS = {
  billing_approved: 'Approved',
  billing_rejected: 'Returned',
  punch_assigned: 'Punch list',
  rfi_answered: 'RFI answered',
  rfi_comment: 'RFI comment',
  lookahead_submitted: 'Lookahead to review',
  lookahead_approved: 'Lookahead approved',
  lookahead_returned: 'Lookahead sent back',
  lookahead_sent: 'Lookahead',
  lookahead_sent_confirm: 'Lookahead sent to subs',
  dc_rejected: 'Cost entry rejected',
  sales_task: 'Sales task',
  sales_order: 'Sales order',
  tool_lost: 'Tool lost',
  tool_damage: 'Tool damaged',
}

// Readable label for any type; unknown types become "Some type" instead of some_type.
export function notificationLabel(type) {
  if (!type) return 'Notice'
  if (NOTIFICATION_LABELS[type]) return NOTIFICATION_LABELS[type]
  const t = String(type).replace(/_/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : 'Notice'
}

// Field-app tab names a link may use → the field app's own tab keys.
const FIELD_TAB_ALIASES = { rfis: 'rfi', rfi: 'rfi', costs: 'costs', lookahead: 'lookahead', punch: 'punch', daily: 'daily', photos: 'photos', deliveries: 'deliveries', docs: 'docs', schedule: 'schedule', tools: 'tools', vehicles: 'vehicles' }
export const fieldTabFromParam = tab => (tab ? FIELD_TAB_ALIASES[tab] || tab : null)

// Where a notification should open in the field app: { job, tab, week } or null.
// Accepts '/field?job=…&tab=…' links and the legacy bare 'rfis' link (+ n.job_id).
export function fieldTarget(n) {
  const link = n?.link || ''
  if (link === 'rfis' || link === 'rfi') return n?.job_id ? { job: n.job_id, tab: 'rfi', week: null } : null
  if (!link.startsWith('/field')) return null
  const q = new URLSearchParams(link.split('?')[1] || '')
  return { job: q.get('job') || n?.job_id || null, tab: fieldTabFromParam(q.get('tab')), week: q.get('week') || null }
}

// RFI-answered link for the person who filed it.
export const rfiAnsweredLink = (portal, jobId) => (portal === '/field' ? `/field?job=${jobId || ''}&tab=rfis` : '/submit')
