// AI estimate parsing limits (prompt 78). These are PROCESSING limits for the AI step, not
// storage or upload limits: the portal itself uploads large files directly to Storage.
// No imports: browser and server use it.
export const AI_PARSE_MAX_BYTES = 20 * 1024 * 1024
export const AI_PARSE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
export const AI_PARSE_LIMIT_MESSAGE = 'This file uploaded, but AI estimate parsing supports up to 20 MB; use a smaller estimate or enter items manually.'
export const AI_PARSE_LIMIT_PRECHECK_MESSAGE = 'AI estimate parsing supports files up to 20 MB; use a smaller estimate or enter items manually.'
export const AI_PARSE_TYPE_MESSAGE = 'Only PDF and image files are supported'
