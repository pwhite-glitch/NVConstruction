// Genuinely streamed responses (prompt 78). Vercel caps BUFFERED function responses at 4.5 MB;
// a streamed body (ReadableStream, no Content-Length) is exempt from that cap (duration limits
// still apply). These helpers emit an already-authorized, already-checked body in bounded
// chunks without building another full copy of it. SERVER use (also safe in tests).

export const STREAM_CHUNK_BYTES = 256 * 1024

// Bytes (Buffer / Uint8Array) → stream of subarray views (no copies).
export function bytesStream(bytes, chunk = STREAM_CHUNK_BYTES) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= view.byteLength) { controller.close(); return }
      const end = Math.min(offset + chunk, view.byteLength)
      controller.enqueue(view.subarray(offset, end))
      offset = end
    },
  })
}

// A string → stream of UTF-8 chunks (encoded piece by piece, never all at once).
export function textStream(text, chunkChars = 64 * 1024) {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= text.length) { controller.close(); return }
      let end = Math.min(i + chunkChars, text.length)
      // Don't split a surrogate pair across chunks.
      const c = text.charCodeAt(end - 1)
      if (end < text.length && c >= 0xd800 && c <= 0xdbff) end -= 1
      controller.enqueue(enc.encode(text.slice(i, end)))
      i = end
    },
  })
}

export function streamedBytesResponse(bytes, headers = {}, status = 200) {
  const h = new Headers(headers)
  h.delete('Content-Length')
  return new Response(bytesStream(bytes), { status, headers: h })
}

// JSON.stringify escapes the payload (HTML included) safely; the result is streamed.
export function streamedJsonResponse(value, status = 200, headers = {}) {
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', ...headers })
  h.delete('Content-Length')
  return new Response(textStream(JSON.stringify(value)), { status, headers: h })
}
