import { requireBotKey } from './bot-auth'
import { logChange } from './change-log'

// Shared pieces for /api/bot/v1 routes. Docs: docs/bot-api.md
// These routes never send email, notifications or e-signature requests, and
// never call those helpers.

export const BOT_API_ENDPOINTS = [
  { method: 'GET',  path: '/api/bot/v1',                        description: 'This list' },
  { method: 'GET',  path: '/api/bot/v1/jobs',                   description: 'Jobs. ?q=search &limit= &offset=' },
  { method: 'GET',  path: '/api/bot/v1/jobs/{id}',              description: 'One job with its budget lines' },
  { method: 'GET',  path: '/api/bot/v1/budgets?job_id=',        description: 'Budget lines and totals for a job' },
  { method: 'GET',  path: '/api/bot/v1/contracts?job_id=',      description: 'Subcontracts on a job, each with its SOV lines' },
  { method: 'GET',  path: '/api/bot/v1/change-orders?job_id=',  description: 'Sub and prime change orders on a job' },
  { method: 'GET',  path: '/api/bot/v1/billings?job_id=',       description: 'Billings on a job. &limit= &offset=' },
  { method: 'POST', path: '/api/bot/v1/subcontracts',           description: "Create a subcontract (status 'draft' or 'active')" },
  { method: 'POST', path: '/api/bot/v1/job-companies',          description: 'Put a company on a job (billing off, no email)' },
  { method: 'POST', path: '/api/bot/v1/billings',               description: 'Create a pending billing (no draw)' },
  { method: 'POST', path: '/api/bot/v1/attachments',            description: 'Upload a job document (multipart, max 4 MB)' },
]

export const REFUSED_ACTIONS = [
  'Any DELETE',
  'Approvals, and status changes to approved / executed',
  'Adding billings to draws',
  'Anything that sends email, notifications, e-signature, notify-sub or Send to subs',
]

export function refuse() {
  return Response.json({
    error: 'Not allowed through the Bot API. Use the portal for this action.',
    refused: REFUSED_ACTIONS,
  }, { status: 403 })
}

// Methods a route doesn't support: spread into the route module's exports
export const refusedMethods = { PUT: refuse, PATCH: refuse, DELETE: refuse }

const json = (body, status = 200) => Response.json(body, { status })
export const badRequest = (error) => json({ error }, 400)
export const notFound = (error = 'Not found') => json({ error }, 404)
export const dbError = (error) => json({ error: error?.message || String(error) }, 500)

// Runs a handler with an authenticated bot: handler({ bot, supabase, request, params })
export function withBot(handler) {
  return async (request, ctx) => {
    const auth = await requireBotKey(request)
    if (auth.error) return auth.error
    try {
      return await handler({ bot: auth.bot, supabase: auth.supabase, request, params: ctx?.params || {} })
    } catch (e) {
      console.error('[bot-api]', e?.message)
      return json({ error: e?.message || 'Server error' }, 500)
    }
  }
}

// ?limit= (default 50, max 200) &offset= → { limit, offset, from, to } for .range()
export function pageParams(searchParams) {
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit'), 10) || 50, 1), 200)
  const offset = Math.max(parseInt(searchParams.get('offset'), 10) || 0, 0)
  // One extra row tells us whether there's another page
  return { limit, offset, from: offset, to: offset + limit }
}

export function paged(rows, { limit, offset }) {
  const list = rows || []
  return { data: list.slice(0, limit), next_offset: list.length > limit ? offset + limit : null }
}

export function requireJobId(searchParams) {
  const jobId = searchParams.get('job_id')
  return jobId && jobId.trim() ? jobId.trim() : null
}

// Audit entry written as the bot, so history shows which bot made the change
export function logBotChange(bot, supabase, entry) {
  return logChange({
    ...entry,
    changed_by: bot.id,
    changed_by_name: bot.full_name,
    note: entry.note ? `${entry.note} · via Bot API` : 'via Bot API',
    client: supabase,
  })
}

export const fmtAmt = (v) => v != null ? '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
