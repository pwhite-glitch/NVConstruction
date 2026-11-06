// Clean up a chat history sent by the browser before it goes to the model.
// Only 'user' / 'assistant' turns with string content are kept (no 'system' or
// tool turns from the caller), the history is cut to the newest `maxCount`
// turns and `maxTotalChars` characters, and it must end with a user turn.
export const AI_MAX_MESSAGES = 20
export const AI_MAX_MESSAGE_CHARS = 4000
export const AI_MAX_TOTAL_CHARS = 16000

export function sanitizeChatMessages(messages, {
  maxCount = AI_MAX_MESSAGES,
  maxMessageChars = AI_MAX_MESSAGE_CHARS,
  maxTotalChars = AI_MAX_TOTAL_CHARS,
} = {}) {
  if (!Array.isArray(messages)) return { error: 'messages must be an array' }
  const cleaned = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, maxMessageChars) }))
  const kept = []
  let total = 0
  for (let i = cleaned.length - 1; i >= 0 && kept.length < maxCount; i--) {
    total += cleaned[i].content.length
    if (total > maxTotalChars) break
    kept.unshift(cleaned[i])
  }
  if (!kept.length || kept[kept.length - 1].role !== 'user') return { error: 'The last message must be a question from you.' }
  return { messages: kept }
}
