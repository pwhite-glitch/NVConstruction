// The three partner accounts. Only they may see or manage Bot API keys
// (the Bot Access tab on /admin and /api/admin/bot-keys).
export const PARTNER_IDS = new Set([
  'aac9f9d3-2dad-4c82-adc2-c9785d6b52c9', // Peyton
  'd212ce95-68eb-496a-b50a-b95c526ff18f', // Nishil
  'f0cb21f1-2bbf-446e-b79b-550c9ba9c375', // Vivek
])

export const isPartner = (userId) => typeof userId === 'string' && PARTNER_IDS.has(userId)
