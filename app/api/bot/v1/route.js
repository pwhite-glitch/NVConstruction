import { withBot, refuse, refusedMethods, BOT_API_ENDPOINTS, REFUSED_ACTIONS } from '../../../../lib/bot-api'

// Discovery: what this bot can call
export const GET = withBot(async ({ bot }) => {
  return Response.json({
    bot: { id: bot.id, name: bot.full_name },
    base_url: '/api/bot/v1',
    endpoints: BOT_API_ENDPOINTS,
    refused: REFUSED_ACTIONS,
  })
})

export const POST = refuse
export const { PUT, PATCH, DELETE } = refusedMethods
