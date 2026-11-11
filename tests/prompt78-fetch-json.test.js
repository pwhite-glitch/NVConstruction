/**
 * Prompt 78 part C: lib/fetch-json (readJsonResponse / fetchJson / rawResponseError), the
 * shared signed PUT, uploadThenSend, and the submittal save flow (a failed save never
 * resets or closes the form). Fake Responses only; nothing live.
 */
const { readJsonResponse, fetchJson, rawResponseError, isJsonContentType, TOO_LARGE_MESSAGE } = require('../lib/fetch-json')
const { putToSignedUrl, uploadThenSend, uploadForTarget } = require('../lib/file-upload-client')
const { runSubmittalSave, createSubmittal } = require('../lib/submittal-client')

const jsonRes = (status, body, ct = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': ct } })

// A Response stand-in that counts body reads and never allows a second one.
function counted(status, text, ct) {
  const calls = { text: 0, json: 0 }
  return {
    calls,
    res: {
      status, ok: status >= 200 && status < 300,
      headers: new Headers(ct ? { 'Content-Type': ct } : {}),
      body: { cancel: () => {} },
      text: async () => { calls.text++; if (calls.text > 1) throw new Error('body used twice'); return text },
      json: async () => { calls.json++; throw new Error('json() must not be called') },
    },
  }
}

describe('isJsonContentType', () => {
  test.each([
    ['application/json', true], ['application/json; charset=utf-8', true], ['APPLICATION/JSON', true],
    ['application/problem+json', true], ['application/vnd.api+json; charset=UTF-8', true],
    ['text/html', false], ['text/plain', false], ['', false], [null, false], ['application/jsonp', false],
  ])('%s → %s', (ct, want) => expect(isJsonContentType(ct)).toBe(want))
})

describe('readJsonResponse', () => {
  test('JSON 2xx (charset / +json) is ok with data', async () => {
    expect(await readJsonResponse(jsonRes(200, { ok: true, id: 1 }, 'application/json; charset=utf-8'))).toEqual({ ok: true, status: 200, data: { ok: true, id: 1 }, error: null })
    expect((await readJsonResponse(jsonRes(201, { a: 1 }, 'application/problem+json'))).ok).toBe(true)
  })

  test.each([400, 401, 403, 404, 500])('JSON %i keeps the server error and payload', async status => {
    const r = await readJsonResponse(jsonRes(status, { error: 'Nope', extra: 1 }))
    expect(r).toMatchObject({ ok: false, status, error: 'Nope', data: { error: 'Nope', extra: 1 } })
  })

  test('409 duplicate: needs_confirm / duplicate data intact', async () => {
    const dup = { error: 'Invoice #1 was already entered…', needs_confirm: true, duplicate: { id: 'd1', invoice_number: '1' } }
    const r = await readJsonResponse(jsonRes(409, dup))
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
    expect(r.data).toEqual(dup)
    expect(r.error).toBe(dup.error)
  })

  test('413 JSON shows the server message; 413 plain / HTML shows the direct-upload message', async () => {
    expect((await readJsonResponse(jsonRes(413, { error: 'Use direct upload please' }))).error).toBe('Use direct upload please')
    const plain = counted(413, 'Request Entity Too Large', 'text/plain')
    const r = await readJsonResponse(plain.res)
    expect(r).toMatchObject({ ok: false, status: 413, data: null, error: TOO_LARGE_MESSAGE })
    expect(plain.calls.json).toBe(0)
    expect((await readJsonResponse(jsonRes(413, '<html>413</html>', 'text/html'))).error).toBe(TOO_LARGE_MESSAGE)
  })

  test('the reported failure: a platform 413 starting "Request En…" never becomes "Unexpected token"', async () => {
    const r = await readJsonResponse(new Response('Request Entity Too Large\nFUNCTION_PAYLOAD_TOO_LARGE', { status: 413, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
    expect(r.error).toBe(TOO_LARGE_MESSAGE)
    expect(r.error).not.toMatch(/Unexpected token|SyntaxError|JSON/)
  })

  test('text/html 502 from a proxy: generic message, body never shown or JSON-parsed', async () => {
    const html = counted(502, '<!DOCTYPE html><html>' + 'x'.repeat(10000) + '</html>', 'text/html')
    const r = await readJsonResponse(html.res)
    expect(r).toMatchObject({ ok: false, status: 502, data: null })
    expect(r.error).toMatch(/server had a problem \(502\)/)
    expect(r.error).not.toContain('<')
    expect(html.calls.json).toBe(0)
    expect(html.calls.text).toBe(0)
  })

  test('short plain-text errors are shown sanitized; long / markup / URL text is not', async () => {
    expect((await readJsonResponse(new Response('Gateway busy', { status: 503, headers: { 'Content-Type': 'text/plain' } }))).error).toBe('Gateway busy (503)')
    expect((await readJsonResponse(new Response('see https://x.example/a?token=abc', { status: 500, headers: { 'Content-Type': 'text/plain' } }))).error).not.toMatch(/https|token/)
    expect((await readJsonResponse(new Response('y'.repeat(500), { status: 500, headers: { 'Content-Type': 'text/plain' } }))).error).toMatch(/\(500\)/)
  })

  test('non-JSON / malformed / empty 200 from a JSON API is a failure, not {} success', async () => {
    expect((await readJsonResponse(new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } }))).ok).toBe(false)
    const bad = await readJsonResponse(jsonRes(200, '{"a":'))
    expect(bad).toMatchObject({ ok: false, status: 200, data: null })
    expect(bad.error).not.toMatch(/Unexpected|SyntaxError/)
    expect((await readJsonResponse(jsonRes(200, ''))).ok).toBe(false)
    expect((await readJsonResponse(new Response('', { status: 200 }))).ok).toBe(false)
  })

  test('a 2xx JSON payload with error is a failure; non-2xx never succeeds even with ok:true', async () => {
    expect((await readJsonResponse(jsonRes(200, { error: 'Soft failure' }))).ok).toBe(false)
    const r = await readJsonResponse(jsonRes(500, { ok: true }))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/500/)
    // business flags / warnings stay data
    expect(await readJsonResponse(jsonRes(200, { ok: true, po_link_saved: false, warning: 'w' }))).toMatchObject({ ok: true, data: { po_link_saved: false, warning: 'w' } })
  })

  test('reads the body exactly once and never calls json()', async () => {
    const c = counted(200, '{"ok":true}', 'application/json')
    expect((await readJsonResponse(c.res)).ok).toBe(true)
    expect(c.calls).toEqual({ text: 1, json: 0 })
  })

  test('body read rejection / abort → concise message', async () => {
    const res = { status: 200, ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), text: async () => { throw new Error('boom') } }
    expect((await readJsonResponse(res)).error).toMatch(/Could not read the server response/)
    const ab = { status: 200, ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), text: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e } }
    expect((await readJsonResponse(ab)).error).toBe('The request was cancelled.')
  })

  test('204 is success with no data', async () => {
    expect(await readJsonResponse(new Response(null, { status: 204 }))).toEqual({ ok: true, status: 204, data: null, error: null })
  })
})

describe('fetchJson', () => {
  test('network rejection and abort give human messages, never throw', async () => {
    expect(await fetchJson(async () => { throw new TypeError('Failed to fetch') }, '/api/x')).toMatchObject({ ok: false, status: 0, error: expect.stringMatching(/Could not reach the server/) })
    expect((await fetchJson(async () => { const e = new Error(); e.name = 'AbortError'; throw e }, '/api/x')).error).toBe('The request was cancelled.')
  })
})

describe('storage PUT / raw responses', () => {
  test('empty 200 PUT stays success; failures carry status (+ JSON message when the type says JSON)', async () => {
    const put = jest.fn(async () => new Response(null, { status: 200 }))
    expect(await putToSignedUrl(put, 'https://storage/x', new Blob(['a'], { type: 'text/plain' }))).toEqual({ ok: true, status: 200 })
    expect(put).toHaveBeenCalledWith('https://storage/x', expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'text/plain' } }))
    // PUT never carries the portal Authorization header
    expect(put.mock.calls[0][1].headers.Authorization).toBeUndefined()
    const bad = await putToSignedUrl(async () => jsonRes(400, { message: 'mime type not supported' }), 'u', new Blob(['a']))
    expect(bad).toMatchObject({ ok: false, status: 400 })
    expect(bad.error).toMatch(/mime type not supported/)
    expect((await putToSignedUrl(async () => new Response('<html>', { status: 413, headers: { 'Content-Type': 'text/html' } }), 'u', new Blob(['a']))).error).toMatch(/larger than storage allows/)
    expect((await putToSignedUrl(async () => { throw new TypeError('x') }, 'u', new Blob(['a']))).error).toMatch(/Could not reach/)
  })

  test('rawResponseError ignores a giant HTML body and never echoes URLs', async () => {
    expect(await rawResponseError(new Response('x', { status: 200 }))).toBeNull()
    const err = await rawResponseError(jsonRes(403, { message: 'signature verification failed for https://s/x?token=abc' }), 'Download')
    expect(err).toBe('Download failed (403).')
  })

  test('a failed PUT never reaches the business route', async () => {
    const send = jest.fn()
    const fetchFn = jest.fn(async () => jsonRes(200, { bucket: 'receipts', path: 'j/p', signedUrl: 'https://upload/j/p', uploadReceipt: 'v1.a.b', expires_at: Date.now() + 7200000 }))
    const r = await uploadThenSend({ fetchFn, putFn: async () => new Response('denied', { status: 403, headers: { 'Content-Type': 'text/plain' } }), file: new File(['x'], 'r.pdf', { type: 'application/pdf' }), target: 'direct-cost-receipt', context: { job_id: 'j' }, send })
    expect(r).toMatchObject({ ok: false, stage: 'upload' })
    expect(send).not.toHaveBeenCalled()
  })

  test('issuance request carries only metadata (never the file) and the receipt is reused on retry', async () => {
    const bodies = []
    const fetchFn = jest.fn(async (url, init) => { bodies.push(JSON.parse(init.body)); return jsonRes(200, { bucket: 'b', path: 'j/p', signedUrl: 'https://upload/j/p', uploadReceipt: 'v1.a.b', expires_at: Date.now() + 7200000 }) })
    const putFn = jest.fn(async () => new Response(null, { status: 200 }))
    const file = new File(['%PDF-1.4'], 'Big Plan.pdf', { type: 'application/pdf' })
    const send = jest.fn(async att => ({ ok: false, status: 409, data: { needs_confirm: true }, error: 'dup' }))
    await uploadThenSend({ fetchFn, putFn, file, target: 'billing-doc', context: { job_id: 'j' }, send })
    await uploadThenSend({ fetchFn, putFn, file, target: 'billing-doc', context: { job_id: 'j' }, send })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(putFn).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[1][0]).toEqual({ path: 'j/p', uploadReceipt: 'v1.a.b' })
    expect(bodies[0]).toEqual({ job_id: 'j', target: 'billing-doc', file_name: 'Big Plan.pdf', content_type: 'application/pdf', size: 8 })
    // a refused receipt is forgotten → the next try uploads again
    const send2 = jest.fn(async () => ({ ok: false, status: 422, data: { code: 'upload_expired' }, error: 'expired' }))
    await uploadThenSend({ fetchFn, putFn, file, target: 'billing-doc', context: { job_id: 'j' }, send: send2 })
    await uploadThenSend({ fetchFn, putFn, file, target: 'billing-doc', context: { job_id: 'j' }, send: send2 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  test('upload URL refused → stage url, with the server error', async () => {
    const r = await uploadForTarget({ fetchFn: async () => jsonRes(403, { error: "You're not assigned to this job." }), putFn: jest.fn(), target: 'po-attachment', file: new File(['x'], 'a.pdf'), context: {} })
    expect(r).toMatchObject({ ok: false, stage: 'url', error: "You're not assigned to this job." })
  })
})

describe('submittal save never resets / closes on failure', () => {
  const harness = () => {
    const state = { busy: false, error: '', reset: 0, reloads: 0 }
    return {
      state,
      setBusy: v => { state.busy = v },
      setError: v => { state.error = v },
      onSaved: () => { state.reset++ },
      reload: async () => { state.reloads++ },
    }
  }

  test.each([
    ['server 500', { ok: false, stage: 'save', error: 'db down' }, /Submittal not saved: db down/],
    ['upload failure', { ok: false, stage: 'upload', error: 'Upload failed (403).' }, /File upload failed/],
  ])('%s → error shown, form kept, busy cleared', async (_l, result, msg) => {
    const h = harness()
    const r = await runSubmittalSave({ busy: false, ...h, save: async () => result })
    expect(r.ok).toBe(false)
    expect(h.state).toMatchObject({ busy: false, reset: 0, reloads: 0 })
    expect(h.state.error).toMatch(msg)
  })

  test('thrown save → error, form kept; success → reset + reload once; repeated click while busy ignored', async () => {
    const h = harness()
    await runSubmittalSave({ busy: false, ...h, save: async () => { throw new Error('offline') } })
    expect(h.state).toMatchObject({ busy: false, reset: 0 })
    expect(h.state.error).toMatch(/offline/)
    const save = jest.fn(async () => ({ ok: true, data: { submittal: { id: 's1' } } }))
    expect((await runSubmittalSave({ busy: true, ...h, save })).skipped).toBe(true)
    expect(save).not.toHaveBeenCalled()
    await runSubmittalSave({ busy: false, ...h, save })
    expect(h.state).toMatchObject({ busy: false, reset: 1, reloads: 1, error: '' })
  })

  test('createSubmittal: files upload directly, then JSON with attachments; a non-JSON 413 reply is a failure', async () => {
    const calls = []
    const fetchFn = jest.fn(async (url, init) => {
      const body = JSON.parse(init.body)
      calls.push({ url, body })
      if (url === '/api/file-upload') return jsonRes(200, { bucket: 'submittal-docs', path: `j1/${calls.length}_a.pdf`, signedUrl: 'https://upload/x', uploadReceipt: `v1.r${calls.length}.s`, expires_at: Date.now() + 7200000 })
      return new Response('Request Entity Too Large', { status: 413, headers: { 'Content-Type': 'text/plain' } })
    })
    const putFn = jest.fn(async () => new Response(null, { status: 200 }))
    const r = await createSubmittal({ fetchFn, putFn, jobId: 'j1', files: [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')], payload: { job_id: 'j1', title: 'Shop' } })
    expect(r).toMatchObject({ ok: false, stage: 'save', status: 413, error: TOO_LARGE_MESSAGE })
    const post = calls.find(c => c.url === '/api/submittals')
    expect(post.body.attachments).toHaveLength(2)
    expect(post.body.attachments.every(a => Object.keys(a).sort().join() === 'path,uploadReceipt')).toBe(true)
    expect(JSON.stringify(post.body)).not.toMatch(/base64|data:/)
  })
})
