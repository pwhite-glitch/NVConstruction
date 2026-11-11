/**
 * Prompt 78: direct-upload paths and receipts (lib/file-upload-server). Every target's server-
 * built path, the legacy-read exception, and every way a receipt or path can be wrong:
 * wrong user / bot key / job / record / order / vehicle / target / bucket, traversal, encoded
 * separators, backslashes, URLs, query / hash, control chars, empty segments, prefix collisions,
 * substituted random ids, tampering, expiry, sizes, unsafe names, and storage metadata checks.
 * Pure library tests; the storage client is a fake.
 */
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
const {
  UPLOAD_TARGETS, issueUpload, verifyAttachment, validateIssueRequest, objectPathError, verifyReceipt,
  signReceipt, makeContext, inlineFileContentError, isAttachmentShape, RECEIPT_TTL_MS,
} = require('../lib/file-upload-server')
const { safeFileName } = require('../lib/storage-path')

const J1 = '11111111-1111-4111-8111-111111111111'
const J2 = '22222222-2222-4222-8222-222222222222'
const R1 = '33333333-3333-4333-8333-333333333333'
const R2 = '44444444-4444-4444-8444-444444444444'
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = Date.UTC(2026, 10, 11, 15, 0, 0)

const signer = { storage: { from: () => ({ createSignedUploadUrl: async (p, o) => ({ data: { signedUrl: `https://s/upload/${p}?token=t`, token: 't' }, error: null }) }) } }
let seq = 0
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

// Fake storage for .info(): objects declared in `objs`.
function infoClient(objs = {}, { fail = false } = {}) {
  const calls = []
  return {
    calls,
    storage: { from: bucket => ({ info: async p => { calls.push(`${bucket}/${p}`); if (fail) throw new Error('down'); const o = objs[`${bucket}/${p}`]; return o ? { data: o, error: null } : { data: null, error: { message: 'Object not found' } } } }) },
  }
}

async function mint({ target = 'direct-cost-receipt', subject = U1, keyId = null, ctx = { job: J1 }, name = 'Receipt #1.pdf', ct = 'application/pdf', size = 1000, now = NOW } = {}) {
  const v = validateIssueRequest({ target, file_name: name, content_type: ct, size })
  if (v.error) throw new Error(v.error)
  const out = await issueUpload(signer, { meta: v.meta, subject, keyId, ctx, now, uuid })
  expect(out.status).toBe(200)
  return out.body
}
const stored = (up, size = 1000, contentType = 'application/pdf') => infoClient({ [`${up.bucket}/${up.path}`]: { size, contentType } })
const att = up => ({ path: up.path, uploadReceipt: up.uploadReceipt })
const verify = (client, up, opts) => verifyAttachment(client, att(up), { target: 'direct-cost-receipt', subject: U1, ctx: { job: J1 }, now: NOW + 1000, ...opts })

describe('every target: server-built path, fixed bucket, verifies', () => {
  const cases = [
    ['direct-cost-receipt', 'receipts', { job: J1 }, new RegExp(`^${J1}/[0-9a-f-]{36}_Receipt_1\\.pdf$`)],
    ['dc-resubmit-receipt', 'receipts', { job: J1, rec: R1 }, new RegExp(`^${J1}/[0-9a-f-]{36}_Receipt_1\\.pdf$`)],
    ['gc-doc', 'receipts', { job: J1, rec: R1 }, new RegExp(`^${J1}/`)],
    ['submittal-doc', 'submittal-docs', { job: J1 }, new RegExp(`^${J1}/`)],
    ['po-attachment', 'purchase-order-docs', { job: J1, rec: R1 }, new RegExp(`^${J1}/`)],
    ['billing-doc', 'billing-docs', { job: J1 }, new RegExp(`^${J1}/`)],
    ['vehicle-photo', 'vehicle-photos', { vehicle: R1 }, new RegExp(`^${R1}/[0-9a-f-]{36}_`)],
    ['sales-doc', 'sales-docs', { order: R1, cat: 'client_order_form' }, new RegExp(`^${R1}/[0-9a-f-]{36}_`)],
    ['parse-estimate', 'estimate-docs', { user: U1 }, new RegExp(`^parse/${U1}/[0-9a-f-]{36}_`)],
    ['bot-attachment', 'job-documents', { job: J1, cat: 'plans' }, new RegExp(`^${J1}/plans/\\d{13}-[0-9a-f-]{36}-Receipt_1\\.pdf$`)],
  ]
  test.each(cases)('%s → %s', async (target, bucket, ctx, re) => {
    const up = await mint({ target, ctx })
    expect(up.bucket).toBe(bucket)
    expect(UPLOAD_TARGETS[target].bucket).toBe(bucket)
    expect(up.path).toMatch(re)
    expect(up.path.split('/').length).toBeLessThanOrEqual(3)
    expect(up.signedUrl).toContain(up.path)
    expect(up.expires_at).toBe(NOW + RECEIPT_TTL_MS)
    const v = await verifyAttachment(stored(up), att(up), { target, subject: U1, ctx, now: NOW + 1000 })
    expect(v).toEqual({ ok: true, path: up.path, fileName: 'Receipt #1.pdf', contentType: 'application/pdf', size: 1000 })
  })

  test('generated contract + signing HTML: fixed html content type and layouts', async () => {
    const g = await mint({ target: 'generated-contract', ctx: { job: J1, rec: R1 }, name: 'contract.html', ct: 'text/html' })
    expect(g.path).toMatch(new RegExp(`^subcontracts/${R1}/generated-2026-11-11T15-00-00-000Z-[0-9a-f-]{36}\\.html$`))
    const sgn = await mint({ target: 'signing-html', ctx: { job: J1, user: U1 }, name: 'x.html', ct: 'text/html' })
    expect(sgn.path).toMatch(new RegExp(`^signing-drafts/${J1}/${U1}/[0-9a-f-]{36}\\.html$`))
    expect(validateIssueRequest({ target: 'generated-contract', file_name: 'c.html', content_type: 'application/pdf', size: 5 }).error).toMatch(/text\/html/)
  })

  test('issuance asks Storage for upsert:false on exactly the built path', async () => {
    const seen = []
    const client = { storage: { from: b => ({ createSignedUploadUrl: async (p, o) => { seen.push([b, p, o]); return { data: { signedUrl: 'https://s/x' }, error: null } } }) } }
    const v = validateIssueRequest({ target: 'po-attachment', file_name: 'q.pdf', content_type: 'application/pdf', size: 9 })
    const out = await issueUpload(client, { meta: v.meta, subject: U1, ctx: { job: J1 }, now: NOW, uuid })
    expect(seen).toEqual([['purchase-order-docs', out.body.path, { upsert: false }]])
  })
})

describe('issuance request validation', () => {
  const base = { target: 'direct-cost-receipt', file_name: 'r.pdf', content_type: 'application/pdf', size: 10 }
  test.each(['bucket', 'url', 'signedUrl', 'path', 'storage_path', 'role', 'created_by', 'uploadReceipt'])('client-chosen %s refused', k => {
    expect(validateIssueRequest({ ...base, [k]: 'x' }).error).toMatch(/cannot be chosen/)
  })
  test.each([
    ['unknown target', { target: 'anything' }],
    ['zero size', { size: 0 }], ['negative size', { size: -5 }], ['fractional size', { size: 1.5 }], ['string size', { size: '10' }],
    ['unsafe-integer size', { size: 2 ** 60 }], ['NaN', { size: NaN }],
    ['missing name', { file_name: '' }], ['control char name', { file_name: 'a\u0000.pdf' }], ['overlong name', { file_name: 'a'.repeat(300) }],
    ['bad content type', { content_type: 'not a type' }],
  ])('%s refused', (_l, patch) => expect(validateIssueRequest({ ...base, ...patch }).error).toBeTruthy())
  test('12 MiB declared size is fine (no portal cap), content type normalized', () => {
    expect(validateIssueRequest({ ...base, size: 12 * 1024 * 1024, content_type: 'APPLICATION/PDF' }).meta).toMatchObject({ size: 12 * 1024 * 1024, contentType: 'application/pdf' })
    expect(validateIssueRequest({ ...base, content_type: '' }).meta.contentType).toBe('application/octet-stream')
  })
})

describe('receipt binding', () => {
  test('wrong user / record / job / target (DC vs GC, same job + bucket) / bot key all refused', async () => {
    const up = await mint()
    const s = stored(up)
    expect((await verify(s, up, { subject: U2 })).error).toMatch(/different user/)
    expect((await verify(s, up, { ctx: { job: J2 } })).error).toMatch(/different record or job/)
    expect((await verify(s, up, { ctx: { job: J1, rec: R1 } })).error).toMatch(/different record or job/)
    expect((await verify(s, up, { target: 'gc-doc' })).error).toMatch(/different kind of file/)
    expect((await verify(s, up, { target: 'dc-resubmit-receipt', ctx: { job: J1 } })).error).toMatch(/different kind of file/)
    expect(s.calls).toEqual([]) // storage is only asked after every binding check passes
  })

  test('cannot cross records within the same job', async () => {
    const up = await mint({ target: 'gc-doc', ctx: { job: J1, rec: R1 } })
    expect((await verifyAttachment(stored(up), att(up), { target: 'gc-doc', subject: U1, ctx: { job: J1, rec: R2 }, now: NOW })).ok).toBe(false)
  })

  test('bot proof is bound to bot id AND key id', async () => {
    const up = await mint({ target: 'bot-attachment', subject: U1, keyId: 'key-1', ctx: { job: J1, cat: 'plans' } })
    const s = stored(up)
    const opts = { target: 'bot-attachment', subject: U1, ctx: { job: J1, cat: 'plans' }, now: NOW }
    expect((await verifyAttachment(s, att(up), { ...opts, keyId: 'key-2' })).ok).toBe(false)
    expect((await verifyAttachment(s, att(up), { ...opts, keyId: null })).ok).toBe(false)
    expect((await verifyAttachment(s, att(up), { ...opts, ctx: { job: J1, cat: 'specs' } })).ok).toBe(false)
    expect((await verifyAttachment(s, att(up), { ...opts, keyId: 'key-1' })).ok).toBe(true)
  })

  test('order / vehicle / category bindings', async () => {
    const sales = await mint({ target: 'sales-doc', ctx: { order: R1, cat: 'general' } })
    expect((await verifyAttachment(stored(sales), att(sales), { target: 'sales-doc', subject: U1, ctx: { order: R2, cat: 'general' }, now: NOW })).ok).toBe(false)
    expect((await verifyAttachment(stored(sales), att(sales), { target: 'sales-doc', subject: U1, ctx: { order: R1, cat: 'client_order_form' }, now: NOW })).ok).toBe(false)
    const veh = await mint({ target: 'vehicle-photo', ctx: { vehicle: R1 } })
    expect((await verifyAttachment(stored(veh), att(veh), { target: 'vehicle-photo', subject: U1, ctx: { vehicle: R2 }, now: NOW })).ok).toBe(false)
    const parse = await mint({ target: 'parse-estimate', ctx: { user: U1 } })
    expect((await verifyAttachment(stored(parse), att(parse), { target: 'parse-estimate', subject: U2, ctx: { user: U2 }, now: NOW })).ok).toBe(false)
  })

  test('UUIDs compare case-insensitively (context normalized), paths are never rewritten', async () => {
    const up = await mint({ ctx: { job: J1.toUpperCase() } })
    expect(up.path.startsWith(`${J1}/`)).toBe(true)
    expect((await verify(stored(up), up, { ctx: { job: J1.toUpperCase() } })).ok).toBe(true)
    expect(makeContext({ job: J1.toUpperCase(), cat: 'plans' })).toEqual({ job: J1, rec: null, order: null, vehicle: null, cat: 'plans', user: null })
  })

  test('random-id substitution, prefix collision and path swap refused', async () => {
    const up = await mint()
    const s = stored(up)
    const other = await mint()
    expect((await verifyAttachment(s, { path: other.path, uploadReceipt: up.uploadReceipt }, { target: 'direct-cost-receipt', subject: U1, ctx: { job: J1 }, now: NOW })).error).toMatch(/does not match/)
    const swapped = up.path.replace(/^[^/]+\/[0-9a-f-]{8}/, m => m.slice(0, -1) + (m.endsWith('0') ? '1' : '0'))
    expect((await verifyAttachment(s, { path: swapped, uploadReceipt: up.uploadReceipt }, { target: 'direct-cost-receipt', subject: U1, ctx: { job: J1 }, now: NOW })).ok).toBe(false)
    // a job id that merely starts with the right job id is a different folder
    expect((await verifyAttachment(s, { path: `${J1}x/${up.path.split('/')[1]}`, uploadReceipt: up.uploadReceipt }, { target: 'direct-cost-receipt', subject: U1, ctx: { job: J1 }, now: NOW })).ok).toBe(false)
  })

  test('tampered, truncated, foreign-key, wrong-version and missing receipts refused', async () => {
    const up = await mint()
    const s = stored(up)
    const [v, payload, mac] = up.uploadReceipt.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: U2 })).toString('base64url')
    for (const r of [`${v}.${forged}.${mac}`, `${v}.${payload}.${mac.slice(0, -2)}`, `v2.${payload}.${mac}`, `${v}.${payload}`, '', 'x'.repeat(5000)]) {
      expect((await verifyAttachment(s, { path: up.path, uploadReceipt: r }, { target: 'direct-cost-receipt', subject: U1, ctx: { job: J1 }, now: NOW })).ok).toBe(false)
    }
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-different-key'
    expect(verifyReceipt(up.uploadReceipt, NOW).error).toBeTruthy()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    expect(verifyReceipt(up.uploadReceipt, NOW).claims.sub).toBe(U1)
    for (const a of [null, {}, { path: up.path }, { uploadReceipt: up.uploadReceipt }, { ...att(up), bucket: 'receipts' }, [att(up)], 'x']) {
      expect((await verifyAttachment(s, a, { target: 'direct-cost-receipt', subject: U1, ctx: { job: J1 }, now: NOW })).ok).toBe(false)
    }
  })

  test('a validly signed receipt with bad values (negative size, too-long life, bad bucket) is refused', () => {
    const base = verifyReceipt(signReceipt({ v: 1, sub: U1, kid: null, t: 'gc-doc', b: 'receipts', p: `${J1}/x_a.pdf`, ctx: makeContext({ job: J1 }), n: 'a.pdf', ct: 'application/pdf', sz: 5, iat: NOW, exp: NOW + 1000 }), NOW)
    expect(base.claims).toBeTruthy()
    const bad = patch => verifyReceipt(signReceipt({ v: 1, sub: U1, kid: null, t: 'gc-doc', b: 'receipts', p: `${J1}/x_a.pdf`, ctx: makeContext({ job: J1 }), n: 'a.pdf', ct: 'application/pdf', sz: 5, iat: NOW, exp: NOW + 1000, ...patch }), NOW).error
    expect(bad({ sz: -1 })).toBeTruthy()
    expect(bad({ sz: 1.5 })).toBeTruthy()
    expect(bad({ exp: NOW + RECEIPT_TTL_MS + 1 })).toBeTruthy()
    expect(bad({ b: 'billing-docs' })).toBeTruthy()
    expect(bad({ p: `${J1}/../x` })).toBeTruthy()
    expect(bad({ extra: 1 })).toBeTruthy()
    expect(bad({ ctx: { job: J1 } })).toBeTruthy()
  })

  test('expired receipts give upload_expired; future-issued ones are refused', async () => {
    const up = await mint()
    const late = await verify(stored(up), up, { now: NOW + RECEIPT_TTL_MS + 1 })
    expect(late).toMatchObject({ ok: false, code: 'upload_expired' })
    expect(verifyReceipt(up.uploadReceipt, NOW - 10 * 60 * 1000).error).toBeTruthy()
  })
})

describe('object paths', () => {
  test.each([
    ['traversal', `${J1}/../${J2}/a.pdf`], ['dot segment', `${J1}/./a.pdf`], ['empty segment', `${J1}//a.pdf`],
    ['leading slash', `/${J1}/a.pdf`], ['backslash', `${J1}\\a.pdf`], ['encoded slash', `${J1}%2Fa.pdf`], ['encoded dot', `${J1}/%2e%2e/a`],
    ['URL', `https://evil.example/${J1}/a.pdf`], ['scheme', 'data:text/html,x'], ['query', `${J1}/a.pdf?x=1`], ['hash', `${J1}/a.pdf#x`],
    ['control char', `${J1}/a\u0007.pdf`], ['newline', `${J1}/a\n.pdf`], ['empty', ''], ['not a string', 42], ['huge', 'a/'.repeat(600)],
  ])('%s refused', (_l, p) => expect(objectPathError(p)).toBeTruthy())
  test('normal path accepted', () => expect(objectPathError(`${J1}/${uuid()}_a.pdf`)).toBeNull())
})

describe('storage metadata', () => {
  test('missing object / lookup error / size or type mismatch / empty all fail closed', async () => {
    const up = await mint()
    expect(await verify(infoClient({}), up)).toMatchObject({ ok: false, code: 'upload_missing' })
    expect(await verify(infoClient({}, { fail: true }), up)).toMatchObject({ ok: false, code: 'upload_missing' })
    expect(await verify(stored(up, 999), up)).toMatchObject({ ok: false, code: 'upload_mismatch' })
    expect(await verify(stored(up, 1000, 'text/html'), up)).toMatchObject({ ok: false, code: 'upload_mismatch' })
    expect(await verify(infoClient({ [`${up.bucket}/${up.path}`]: { size: 0 } }), up)).toMatchObject({ ok: false })
    expect(await verify(infoClient({ [`${up.bucket}/${up.path}`]: { metadata: { size: 1000, mimetype: 'application/pdf' } } }), up)).toMatchObject({ ok: true, size: 1000 })
  })
  test('a large declared upload (12 MiB) verifies from metadata without any bytes', async () => {
    const up = await mint({ size: 12 * 1024 * 1024 })
    expect(await verify(stored(up, 12 * 1024 * 1024), up)).toMatchObject({ ok: true, size: 12 * 1024 * 1024 })
  })
  test('a function info source runs only after the receipt checks (bot fallback)', async () => {
    const up = await mint({ target: 'bot-attachment', keyId: 'k', ctx: { job: J1, cat: 'plans' } })
    const info = jest.fn(async () => ({ data: { size: 1000, contentType: 'application/pdf' }, error: null }))
    expect((await verifyAttachment(info, att(up), { target: 'bot-attachment', subject: U1, keyId: 'other', ctx: { job: J1, cat: 'plans' }, now: NOW })).ok).toBe(false)
    expect(info).not.toHaveBeenCalled()
    expect((await verifyAttachment(info, att(up), { target: 'bot-attachment', subject: U1, keyId: 'k', ctx: { job: J1, cat: 'plans' }, now: NOW })).ok).toBe(true)
    expect(info).toHaveBeenCalledWith('job-documents', up.path)
  })
})

describe('names and inline content', () => {
  test.each([
    ['../../etc/passwd', 'etc_passwd'], ['Plans Rev 3 (final).pdf', 'Plans_Rev_3_final_.pdf'], ['..', 'file'], ['', 'file'],
    ['<script>.html', 'script_.html'], ['a/b\\c.pdf', 'a_b_c.pdf'], ['Résumé.pdf', 'Re_sume_.pdf'],
  ])('safeFileName(%j) → %j', (raw, want) => expect(safeFileName(raw)).toBe(want))
  test('long names keep the extension and stay bounded', () => {
    const n = safeFileName('x'.repeat(500) + '.pdf')
    expect(n.length).toBeLessThanOrEqual(120)
    expect(n.endsWith('.pdf')).toBe(true)
  })
  test('the original name is kept (bounded) in the receipt; the path uses the safe name', async () => {
    const up = await mint({ name: '../Weird name <1>.PDF' })
    expect(up.path).toMatch(/_Weird_name_1_\.PDF$/)
    expect(verifyReceipt(up.uploadReceipt, NOW).claims.n).toBe('../Weird name <1>.PDF')
  })
  test('inline file content is detected; normal fields and long prose pass', () => {
    expect(inlineFileContentError({ file: 'abc' })).toMatch(/file/)
    expect(inlineFileContentError({ notes: 'data:application/pdf;base64,JVBERi0=' })).toMatch(/inline file content/)
    expect(inlineFileContentError([{ a: 1 }, { receipt: 'A'.repeat(5000) }])).toBeTruthy()
    expect(inlineFileContentError({ notes: 'word '.repeat(2000) })).toBeNull()
    expect(inlineFileContentError({ document_html: 'data:image/png;base64,AAAA' }, { except: ['document_html'] })).toBeNull()
    expect(isAttachmentShape({ path: 'a', uploadReceipt: 'b' })).toBe(true)
    expect(isAttachmentShape({ path: 'a', uploadReceipt: 'b', x: 1 })).toBe(false)
  })
})

describe('legacy reads', () => {
  test('saved legacy paths are not run through the new-upload validator (readers sign stored paths)', () => {
    // Old layouts like <job>/<timestamp>.pdf and billing-docs/<user>/… are only ever READ from the
    // stored row; the validator applies to NEW attachments, which always carry a receipt.
    expect(objectPathError(`${J1}/1700000000000.pdf`)).toBeNull()
    expect(objectPathError(`${U1}/1700000000000-invoice.pdf`)).toBeNull()
  })
})
