/**
 * Prompt 78 leftover (review MEDIUM-1, LOW-1, LOW-3, LOW-4, LOW-7):
 * - jobdetail office billing edit / create: in-flight guards set before any confirm or upload,
 *   reset in finally; Save button disabled with "Saving…".
 * - submitCsvImport always resets importingCsv.
 * - admin billing edit and dashboard bid-status / delete-sub use the shared fetch-json reader.
 * Source-level assertions for the page code, plus reader behavior for the request shapes used.
 */
const fs = require('fs')
const path = require('path')
const { fetchJson, jsonInit, TOO_LARGE_MESSAGE } = require('../lib/fetch-json')

const src = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')

// Body of `async function name(...) { ... }` up to the next top-level (2-space) function.
function fnBody(source, name) {
  const start = source.indexOf(`async function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  const rest = source.slice(start + 1)
  const next = rest.search(/\n  (async )?function \w+\(/)
  return source.slice(start, next === -1 ? undefined : start + 1 + next)
}

const jobdetail = src('app/jobdetail/page.js')
const admin = src('app/admin/page.js')
const dashboard = src('app/dashboard/page.js')

describe('MEDIUM-1 jobdetail updateBillingEntry in-flight guard', () => {
  const body = fnBody(jobdetail, 'updateBillingEntry')

  test('guard is checked and set at the very start, before any confirm, upload or PATCH', () => {
    const guard = body.indexOf('if (savingBilling || savingBillingRef.current) return')
    const set = body.indexOf('savingBillingRef.current = true')
    expect(guard).toBeGreaterThan(-1)
    expect(set).toBeGreaterThan(guard)
    expect(body.indexOf('setSavingBilling(true)')).toBeGreaterThan(guard)
    for (const later of ['confirmBillingCoi(', 'window.confirm(', 'uploadThenSend(', 'patchBilling(patchData)']) {
      expect(body.indexOf(later)).toBeGreaterThan(set)
    }
    // Nothing but comments before the guard.
    const head = body.slice(body.indexOf('{') + 1, guard).replace(/\/\/.*$/gm, '').trim()
    expect(head).toBe('')
  })

  test('flag is reset in finally (errors and early returns cannot leave it stuck)', () => {
    expect(body).toMatch(/finally \{\s*savingBillingRef\.current = false\s*setSavingBilling\(false\)\s*\}/)
    expect(body.indexOf('try {')).toBeLessThan(body.indexOf("alert('Enter a rejection reason"))
  })

  test('state + ref are declared', () => {
    expect(jobdetail).toMatch(/const \[savingBilling, setSavingBilling\] = useState\(false\)/)
    expect(jobdetail).toMatch(/const savingBillingRef = useRef\(false\)/)
  })

  test("Save button is disabled while saving and shows 'Saving…'", () => {
    expect(jobdetail).toContain("disabled={savingBilling} onClick={updateBillingEntry}>{savingBilling ? 'Saving…' : 'Save changes'}</button>")
    expect(jobdetail).not.toContain('<button style={s.btnSmallOrange} onClick={updateBillingEntry}>Save changes</button>')
  })
})

describe('LOW-1 jobdetail createBilling guard set before the COI confirm', () => {
  const body = fnBody(jobdetail, 'createBilling')

  test('check + set happen before confirmBillingCoi; cancel and errors reset via finally', () => {
    const guard = body.indexOf('if (creatingBilling || creatingBillingRef.current) return')
    const setRef = body.indexOf('creatingBillingRef.current = true')
    const setState = body.indexOf('setCreatingBilling(true)')
    const tryAt = body.indexOf('try {')
    const confirmAt = body.indexOf('confirmBillingCoi(')
    expect(guard).toBeGreaterThan(-1)
    expect(setRef).toBeGreaterThan(guard)
    expect(setState).toBeGreaterThan(guard)
    expect(tryAt).toBeGreaterThan(setState)
    expect(confirmAt).toBeGreaterThan(tryAt) // a cancelled confirm returns inside try → finally clears
    expect(body).toMatch(/finally \{\s*creatingBillingRef\.current = false\s*setCreatingBilling\(false\)\s*\}/)
    expect(jobdetail).toMatch(/const creatingBillingRef = useRef\(false\)/)
  })
})

describe('LOW-7 jobdetail submitCsvImport always resets importingCsv', () => {
  const body = fnBody(jobdetail, 'submitCsvImport')
  test('getSession / POST are inside try; finally resets the flag', () => {
    expect(body.indexOf('try {')).toBeLessThan(body.indexOf('supabase.auth.getSession()'))
    expect(body).toMatch(/finally \{\s*setImportingCsv\(false\)\s*\}/)
  })
})

describe('LOW-3 admin billing edit uses the shared reader', () => {
  const body = fnBody(admin, 'saveBillEdit')

  test('fetchJson + jsonInit, no res.json(), error from the reader', () => {
    expect(body).toContain("fetchJson(fetch, '/api/billing-entry', jsonInit('PATCH', payload")
    expect(body).not.toMatch(/res\.json\(\)/)
    expect(body).toContain("setPayMsg('Error saving billing: ' + res.error)")
    expect(body).toContain('res.status === 409 && data?.needs_confirm')
    expect(body).toContain('confirm_duplicate: true')
  })
})

describe('LOW-4 dashboard bid status / delete sub use the shared reader', () => {
  test('setBidStatus', () => {
    const body = fnBody(dashboard, 'setBidStatus')
    expect(body).toContain("fetchJson(fetch, '/api/bid-packages', jsonInit('PATCH', { id: bidId, status }")
    expect(body).not.toMatch(/\.json\(\)/)
    expect(body).toContain("alert('Could not update bid status: ' + res.error)")
  })
  test('deleteDirEntry', () => {
    const body = fnBody(dashboard, 'deleteDirEntry')
    expect(body).toContain("fetchJson(authFetch, '/api/delete-sub', jsonInit('POST', { directory_id: id }))")
    expect(body).not.toMatch(/\.json\(\)/)
    expect(body).toContain("alert('Delete error: ' + res.error)")
  })
})

describe('reader behavior for these request shapes', () => {
  const reply = (status, body, ct = 'application/json') => async () => new Response(body, { status, headers: { 'Content-Type': ct } })

  test('jsonInit keeps the Authorization header and sets JSON content type', () => {
    const init = jsonInit('PATCH', { id: 1 }, { headers: { Authorization: 'Bearer t' } })
    expect(init).toEqual({ method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: '{"id":1}' })
  })

  test('plain-text 413 → friendly message, not "HTTP 413"', async () => {
    const r = await fetchJson(reply(413, 'Request Entity Too Large', 'text/plain'), '/api/billing-entry', jsonInit('PATCH', {}))
    expect(r.ok).toBe(false)
    expect(r.error).toBe(TOO_LARGE_MESSAGE)
  })

  test('empty or HTML 2xx is not treated as saved', async () => {
    expect((await fetchJson(reply(200, ''), '/x', {})).ok).toBe(false)
    expect((await fetchJson(reply(200, '<html></html>', 'text/html'), '/x', {})).ok).toBe(false)
  })

  test('non-JSON error gives a plain message instead of throwing', async () => {
    const r = await fetchJson(reply(502, '<html>Bad gateway</html>', 'text/html'), '/api/bid-packages', {})
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/server had a problem \(502\)/)
  })

  test('409 needs_confirm data survives; JSON ok:true success passes', async () => {
    const dup = await fetchJson(reply(409, JSON.stringify({ error: 'dup', needs_confirm: true, duplicate: { invoice_number: '7' } })), '/x', {})
    expect(dup.ok).toBe(false)
    expect(dup.data.needs_confirm).toBe(true)
    expect(dup.data.duplicate.invoice_number).toBe('7')
    expect((await fetchJson(reply(200, '{"ok":true}'), '/x', {})).ok).toBe(true)
  })
})
