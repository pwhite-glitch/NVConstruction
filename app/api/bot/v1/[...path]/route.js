import { refuse, BOT_API_ENDPOINTS } from '../../../../../lib/bot-api'

// Anything not listed in BOT_API_ENDPOINTS: unknown GETs are 404, every other method is refused.
export function GET() {
  return Response.json({ error: 'Unknown Bot API endpoint', endpoints: BOT_API_ENDPOINTS }, { status: 404 })
}

export const POST = refuse
export const PUT = refuse
export const PATCH = refuse
export const DELETE = refuse
