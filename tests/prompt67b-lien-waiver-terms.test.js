/**
 * Prompt 67B #6: a signed lien waiver stayed "signed" after the billing amount, retainage or
 * period changed, and printouts stamped the old signature on the new numbers.
 * - lien-waiver-sign: approved only, stores the signed amount / through date, compare-and-set,
 *   expected_amount / expected_period check, works before migration 062.
 * - billing-entry PATCH: a term change on a signed billing voids the signature (history once
 *   062 is applied), logs it, returns waiverVoided; re-approval then sends a fresh waiver.
 * - signedWaiverTerms + printouts (job page, sub portal, residential) print what was signed.
 * mock-db stands in for Supabase; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  const unauth = () => ({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
  return {
    requireAuth: async () => mockState.auth || unauth(),
    requirePM: async () => (mockState.auth && PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
  }
})
jest.mock('../lib/roles', () => ({ denyJob: jest.fn(async () => null), denyJobOf: jest.fn(async () => null) }))
jest.mock('resend', () => ({
  Resend: function Resend() {
    this.emails = { send: async msg => { require('./helpers/mock-db').mockState.calls.push({ table: 'email', op: 'send', payload: msg }); return { data: {}, error: null } } }
  },
}))

const signRoute = require('../app/api/lien-waiver-sign/route')
const billingEntry = require('../app/api/billing-entry/route')
const { signedWaiverTerms, waiverTermChanges, safeSignatureSrc, LEGACY_WAIVER_NOTE } = require('../lib/lien-waiver-terms')
const { buildBillingWaiverHtml } = require('../lib/residential-print')

const J1 = 'job-1'
const SIG = 'data:image/png;base64,iVBORw0KGgo='
const BILL = {
  id: 'b1', job_id: J1, sub_id: 'u1', sub_email: 'me@acme.test', contact_name: 'Sam Sub', company_name: 'Acme Electric',
  status: 'approved', amount_billed: 1000, retainage_pct: 10, retainage_held: 100, billing_period: '2026-10-01',
  draw_request_id: null, paid_at: null, payment_amount: null, invoice_number: 'INV-1',
  lien_waiver_sent_at: '2026-11-01T12:00:00Z', lien_waiver_signed_at: null, lien_waiver_signer_name: null, lien_waiver_signature: null,
  lien_waiver_amount: null, lien_waiver_through: null, lien_waiver_history: [],
}
const SIGNED = { ...BILL, lien_waiver_signed_at: '2026-11-03T15:00:00Z', lien_waiver_signer_name: 'Sam Sub', lien_waiver_signature: SIG, lien_waiver_amount: 1000, lien_waiver_through: '2026-10-01' }

function seed(bill = BILL) {
  resetMockState({
    billing_submissions: [{ ...bill }],
    jobs: [{ id: J1, job_number: '100', project_name: 'Job One', owner_name: 'Owner' }],
    profiles: [{ id: 'u1', full_name: 'Sam Sub', company_id: 'c1' }, { id: 'pm1', full_name: 'Pat PM' }],
    change_log: [],
    draw_requests: [],
  })
}
const json = (url, method, body) => new Request(`http://x${url}`, {
  method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: JSON.stringify(body),
})
const asSub = () => { mockState.auth = { userId: 'u1', email: 'me@acme.test', role: 'subcontractor', error: null } }
const asPM = () => { mockState.auth = { userId: 'pm1', email: 'pm@nv.test', role: 'pm', error: null } }
const row = () => mockState.db.billing_submissions[0]
const sign = extra => signRoute.POST(json('/api/lien-waiver-sign', 'POST', { submission_id: 'b1', signer_name: 'Sam Sub', signature: SIG, ...extra }))
const patch = body => billingEntry.PATCH(json('/api/billing-entry', 'PATCH', { id: 'b1', ...body }))

beforeEach(() => { seed(); mockState.auth = null })

describe('lien-waiver-sign', () => {
  test('stores the signed amount and through date with the signature', async () => {
    asSub()
    const res = await sign({ expected_amount: 1000, expected_period: '2026-10-01' })
    expect(res.status).toBe(200)
    expect(row()).toMatchObject({ lien_waiver_signer_name: 'Sam Sub', lien_waiver_signature: SIG, lien_waiver_amount: 1000, lien_waiver_through: '2026-10-01' })
    expect(row().lien_waiver_signed_at).toBeTruthy()
    const upd = mockState.calls.filter(c => c.table === 'billing_submissions' && c.op === 'update')
    expect(upd).toHaveLength(1) // one write: signature + terms together
  })

  test('no billing period → through = the signing date (Central)', async () => {
    seed({ ...BILL, billing_period: null })
    asSub()
    expect((await sign()).status).toBe(200)
    expect(row().lien_waiver_through).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('refuses a billing that is not approved (422), nothing written', async () => {
    seed({ ...BILL, status: 'pending' })
    asSub()
    const res = await sign()
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('This billing is not approved, so there is no waiver to sign.')
    expect(mockState.calls.filter(c => c.op === 'update')).toHaveLength(0)
  })

  test('expected_amount / expected_period mismatch → 409', async () => {
    asSub()
    let res = await sign({ expected_amount: 900 })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('This billing was changed after the waiver was sent. Reload and review the new amount before signing.')
    res = await sign({ expected_amount: '1000.00', expected_period: '2026-09-01' })
    expect(res.status).toBe(409)
    expect(row().lien_waiver_signed_at).toBeNull()
  })

  test('a second concurrent sign → 409 (compare-and-set)', async () => {
    asSub()
    // Another tab signs between our read and our write.
    mockState.beforeWrite = (table, op) => {
      if (table === 'billing_submissions' && op === 'update' && !row().lien_waiver_signed_at) {
        Object.assign(row(), { lien_waiver_signed_at: '2026-11-09T10:00:00Z', lien_waiver_signer_name: 'Other Tab' })
      }
    }
    const res = await sign()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Already signed or changed — reload.')
    expect(row().lien_waiver_signer_name).toBe('Other Tab')
    expect(mockState.calls.filter(c => c.table === 'email')).toHaveLength(0)
  })

  test('amount edited between read and write → 409', async () => {
    asSub()
    mockState.beforeWrite = (table, op) => { if (table === 'billing_submissions' && op === 'update') row().amount_billed = 1200 }
    expect((await sign()).status).toBe(409)
    expect(row().lien_waiver_signed_at).toBeNull()
  })

  test('062 not applied → still signs (legacy, no terms)', async () => {
    mockState.missingCols.billing_submissions = ['lien_waiver_amount', 'lien_waiver_through']
    asSub()
    const res = await sign()
    expect(res.status).toBe(200)
    expect(row().lien_waiver_signed_at).toBeTruthy()
    expect(row().lien_waiver_amount).toBeNull()
  })

  test('PM email escapes the company and job fields', async () => {
    seed({ ...BILL, company_name: '<b>Acme</b>' })
    mockState.db.jobs[0].project_name = '<script>x</script>'
    asSub()
    await sign()
    const html = mockState.calls.find(c => c.table === 'email').payload.html
    expect(html).not.toContain('<b>Acme</b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;b&gt;Acme&lt;/b&gt;')
  })
})

describe('billing-entry PATCH voids a signed waiver when its terms change', () => {
  beforeEach(() => { seed(SIGNED); asPM() })

  test('reopen + amount change: clears signature + sent_at, appends history, logs, waiverVoided', async () => {
    const res = await patch({ status: 'pending', amount_billed: 1200 })
    expect(res.status).toBe(200)
    expect((await res.json()).waiverVoided).toBe(true)
    expect(row()).toMatchObject({
      status: 'pending', amount_billed: 1200,
      lien_waiver_signed_at: null, lien_waiver_signer_name: null, lien_waiver_signature: null, lien_waiver_sent_at: null,
      lien_waiver_amount: null, lien_waiver_through: null,
    })
    expect(row().lien_waiver_history).toHaveLength(1)
    expect(row().lien_waiver_history[0]).toMatchObject({
      voided_by: 'pm1', reason: 'amount_changed', signed_at: '2026-11-03T15:00:00Z', signer_name: 'Sam Sub', amount: 1000, through: '2026-10-01', signature: SIG,
    })
    expect(row().lien_waiver_history[0].voided_at).toBeTruthy()
    const log = mockState.db.change_log.find(l => l.field_name === 'lien_waiver')
    expect(log).toMatchObject({ old_value: 'signed 2026-11-03 by Sam Sub for $1,000.00', new_value: 'voided', note: 'Lien waiver voided — billing amount/retainage/period changed; a new waiver is sent to the sub now if the billing stays approved, or when it is approved again.' })
    // Paper waiver flags untouched
    const upd = mockState.calls.find(c => c.table === 'billing_submissions' && c.op === 'update')
    expect(upd.payload).not.toHaveProperty('lien_waiver_received')
    expect(upd.payload).not.toHaveProperty('lien_waiver_received_at')
  })

  test('then pending → approved sends a fresh waiver (not skipped)', async () => {
    await patch({ status: 'pending', amount_billed: 1200 })
    mockState.calls = []
    const res = await patch({ status: 'approved' })
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.waiverSent).toBe(true)
    expect(out.waiverError).toBeNull()
    const sent = mockState.calls.filter(c => c.table === 'email' && /Lien Waiver Required/.test(c.payload.subject))
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.html).toContain('$1,200.00')
    expect(row().lien_waiver_sent_at).toBeTruthy()
  })

  test('retainage change on an approved billing (no reopen) also voids, reason retainage_changed', async () => {
    const res = await patch({ retainage_pct: 5, retainage_held: 50 })
    expect((await res.json()).waiverVoided).toBe(true)
    expect(row().lien_waiver_history[0].reason).toBe('retainage_changed')
  })

  test('period change voids, reason period_changed', async () => {
    const res = await patch({ billing_period: '2026-11-01' })
    expect((await res.json()).waiverVoided).toBe(true)
    expect(row().lien_waiver_history[0].reason).toBe('period_changed')
  })

  test('same-value resend (amount / retainage / period) → not voided', async () => {
    const res = await patch({ status: 'approved', amount_billed: '1000.00', retainage_pct: 10, retainage_held: 100, billing_period: '2026-10-01', contact_name: 'New' })
    expect(res.status).toBe(200)
    expect((await res.json()).waiverVoided).toBeUndefined()
    expect(row().lien_waiver_signed_at).toBe('2026-11-03T15:00:00Z')
    expect(mockState.db.change_log.find(l => l.field_name === 'lien_waiver')).toBeUndefined()
  })

  test('recording a payment on a signed billing → not voided', async () => {
    const res = await patch({ record_payment_amount: 900 })
    expect(res.status).toBe(200)
    expect((await res.json()).waiverVoided).toBeUndefined()
    expect(row().lien_waiver_signed_at).toBe('2026-11-03T15:00:00Z')
  })

  test('a signature landing mid-edit on an unsigned billing → 409, not silently kept', async () => {
    seed(BILL)
    mockState.beforeWrite = (table, op) => { if (table === 'billing_submissions' && op === 'update') row().lien_waiver_signed_at = '2026-11-09T10:00:00Z' }
    const res = await patch({ status: 'pending', amount_billed: 1200 })
    expect(res.status).toBe(409)
    expect(row().amount_billed).toBe(1000)
  })

  test('062 not applied: voids without history / terms columns (change log is the record)', async () => {
    mockState.missingSelectCols.billing_submissions = ['lien_waiver_amount', 'lien_waiver_through', 'lien_waiver_history']
    mockState.missingCols.billing_submissions = ['lien_waiver_amount', 'lien_waiver_through', 'lien_waiver_history']
    const res = await patch({ status: 'pending', amount_billed: 1200 })
    expect(res.status).toBe(200)
    expect((await res.json()).waiverVoided).toBe(true)
    const upd = mockState.calls.find(c => c.table === 'billing_submissions' && c.op === 'update')
    expect(upd.payload).toMatchObject({ lien_waiver_signed_at: null, lien_waiver_signer_name: null, lien_waiver_signature: null, lien_waiver_sent_at: null })
    expect(upd.payload).not.toHaveProperty('lien_waiver_history')
    expect(row().lien_waiver_signed_at).toBeNull()
    expect(mockState.db.change_log.find(l => l.field_name === 'lien_waiver')).toBeTruthy()
  })

  test('history column missing only on write → retried without the 062 columns', async () => {
    mockState.missingCols.billing_submissions = ['lien_waiver_history']
    const res = await patch({ status: 'pending', amount_billed: 1200 })
    expect(res.status).toBe(200)
    expect(row().lien_waiver_signed_at).toBeNull()
  })
})

describe('signedWaiverTerms', () => {
  test('signed terms win over live values', () => {
    expect(signedWaiverTerms({ ...SIGNED, amount_billed: 5 , billing_period: '2027-01-01' })).toEqual({ amount: 1000, through: '2026-10-01', legacy: false })
  })
  test('legacy: live amount / period, flagged', () => {
    expect(signedWaiverTerms({ ...SIGNED, lien_waiver_amount: null, lien_waiver_through: null })).toEqual({ amount: 1000, through: '2026-10-01', legacy: true })
  })
  test('legacy without a period → signed date', () => {
    expect(signedWaiverTerms({ amount_billed: 10, billing_period: null, lien_waiver_signed_at: '2026-11-03T15:00:00Z' })).toEqual({ amount: 10, through: '2026-11-03', legacy: true })
  })
  test('zero signed amount is not legacy', () => {
    expect(signedWaiverTerms({ amount_billed: 10, lien_waiver_amount: 0, lien_waiver_through: '2026-10-01' })).toEqual({ amount: 0, through: '2026-10-01', legacy: false })
  })
  test('waiverTermChanges ignores same values and non-term fields', () => {
    expect(waiverTermChanges(SIGNED, { amount_billed: '1000', contact_name: 'x', status: 'pending' })).toEqual([])
    expect(waiverTermChanges(SIGNED, { amount_billed: 1000.01 })).toEqual(['amount_billed'])
  })
  test('safeSignatureSrc only allows image data URLs', () => {
    expect(safeSignatureSrc(SIG)).toBe(SIG)
    expect(safeSignatureSrc('javascript:alert(1)')).toBe('')
    expect(safeSignatureSrc('https://evil.test/x.png')).toBe('')
    expect(safeSignatureSrc('x" onerror="alert(1)')).toBe('')
  })
})

describe('printouts', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

  test('residential buildBillingWaiverHtml prints the signed amount; legacy note; escapes', () => {
    const html = buildBillingWaiverHtml({ billing: { ...SIGNED, amount_billed: 5000, company_name: '<b>Acme</b>', lien_waiver_signer_name: '<i>Sam</i>' }, job: { job_number: '1', project_name: 'P' } })
    expect(html).toContain('$1,000.00')
    expect(html).not.toContain('$5,000.00')
    expect(html).toContain('October 2026')
    expect(html).not.toContain(LEGACY_WAIVER_NOTE)
    expect(html).not.toContain('<b>Acme</b>')
    expect(html).not.toContain('<i>Sam</i>')
    const legacy = buildBillingWaiverHtml({ billing: { ...SIGNED, lien_waiver_amount: null, lien_waiver_through: null }, job: {} })
    expect(legacy).toContain(LEGACY_WAIVER_NOTE)
  })

  test('job page View Waiver uses signedWaiverTerms, escapes company/signer, data:image-only signature', () => {
    const src = read('app/jobdetail/page.js')
    const start = src.indexOf('{b.lien_waiver_signed_at && (\n                            <button style={s.btnSmall}')
    const body = src.slice(start, src.indexOf('}}>View Waiver</button>', start))
    expect(start).toBeGreaterThan(0)
    expect(body).toContain('signedWaiverTerms(b)')
    expect(body).toContain('LEGACY_WAIVER_NOTE')
    expect(body).toContain('safeSignatureSrc(b.lien_waiver_signature)')
    expect(body).toContain('${esc(b.company_name)}')
    expect(body).toContain("${esc(b.lien_waiver_signer_name || '')}")
    expect(body).toContain('${esc(job?.owner_company')
    expect(body).not.toMatch(/\$\{b\.company_name\}|\$\{b\.lien_waiver_signer_name|src="\$\{b\.lien_waiver_signature\}"/)
  })

  test('sub portal printLienWaiver uses signedWaiverTerms for the signed case, escapes', () => {
    const src = read('app/submit/page.js')
    const body = src.slice(src.indexOf('function printLienWaiver('), src.indexOf('async function submitLienWaiver('))
    expect(body).toContain('signedWaiverTerms(sub)')
    expect(body).toContain('LEGACY_WAIVER_NOTE')
    expect(body).toContain('safeSignatureSrc(sub.lien_waiver_signature)')
    expect(body).toContain('${esc(sub.company_name')
    expect(body).toContain('${esc(sub.lien_waiver_signer_name)}')
    expect(body).not.toMatch(/\$\{sub\.company_name|\$\{sub\.lien_waiver_signer_name\}|src="\$\{sub\.lien_waiver_signature\}"/)
  })

  test('residential print source uses signedWaiverTerms', () => {
    const src = read('lib/residential-print.js')
    const body = src.slice(src.indexOf('export function buildBillingWaiverHtml('), src.indexOf('export function buildCompletionReportHtml('))
    expect(body).toContain('signedWaiverTerms(b)')
    expect(body).toContain('safeImageSrc(b?.lien_waiver_signature, origin)')
  })

  test('sub portal sign call sends expected_amount / expected_period and handles 409', () => {
    const src = read('app/submit/page.js')
    const body = src.slice(src.indexOf('async function submitLienWaiver('), src.indexOf('async function handleSubmit('))
    expect(body).toMatch(/expected_amount: lienWaiverSub\.amount_billed, expected_period: lienWaiverSub\.billing_period \|\| null/)
    expect(body).toMatch(/res\.status === 409[\s\S]*loadSubmissions\(\)/)
  })

  test('job page and dashboard edit warn before voiding and show "Lien waiver voided"', () => {
    const jd = read('app/jobdetail/page.js')
    const upd = jd.slice(jd.indexOf('async function updateBillingEntry('), jd.indexOf('function billingToEditForm('))
    expect(upd).toMatch(/lien_waiver_signed_at && waiverTermChanges\(savedRow, patchData\)\.length/)
    expect(upd).toContain('This billing has a signed lien waiver for ${signedAmt}. Changing it voids that signature; a new waiver is sent to the sub now if the billing stays approved, or when it is approved again. Continue?')
    expect(upd).toMatch(/result\.waiverVoided[\s\S]*Lien waiver voided/)
    expect(upd).toMatch(/result\.waiverError[\s\S]*new lien waiver was not sent[\s\S]*result\.waiverSent \? 'A new waiver was sent to the sub now\.'/)
    expect(upd).not.toContain('will be sent when it is approved again')
    const db = read('app/dashboard/page.js')
    const save = db.slice(db.indexOf('async function saveBillingEdit('), db.indexOf('async function updateDirStatus('))
    // The dashboard edit never sends amount / retainage / period, so it has no waiver confirm.
    expect(save).not.toMatch(/window\.confirm/)
    expect(save).not.toContain('amount_billed')
    expect(save).toMatch(/out\.waiverVoided[\s\S]*Lien waiver voided/)
  })

  test('admin billing edit: waiver confirm, duplicate confirm + resend, voided notice', () => {
    const ad = read('app/admin/page.js')
    const save = ad.slice(ad.indexOf('async function saveBillEdit('), ad.indexOf('async function toggleReadyToPay('))
    expect(save).toMatch(/savedRow\?\.lien_waiver_signed_at[\s\S]*waiverTermChanges\(savedRow, termFields\)\.length[\s\S]*window\.confirm\(`This billing has a signed lien waiver for \$\{signedAmt\}\. Changing it voids that signature; a new waiver is sent to the sub now if the billing stays approved, or when it is approved again\. Continue\?`\)/)
    expect(save).toMatch(/res\.status === 409 && data\?\.needs_confirm[\s\S]*window\.confirm\(`This looks like a duplicate of Invoice #[\s\S]*send\(\{ \.\.\.body, confirm_duplicate: true \}\)/)
    expect(save).toMatch(/data\?\.waiverVoided[\s\S]*Lien waiver voided[\s\S]*data\.waiverError[\s\S]*data\.waiverSent/)
  })
})

describe('billing-entry PATCH: voided waiver on a billing that stays approved is re-sent now', () => {
  const lienWaiver = require('../lib/lien-waiver')
  let spy
  beforeEach(() => { seed(SIGNED); asPM(); spy = jest.spyOn(lienWaiver, 'sendLienWaiver') })
  afterEach(() => spy.mockRestore())
  const waiverEmails = () => mockState.calls.filter(c => c.table === 'email' && /Lien Waiver Required/.test(c.payload.subject))

  test('amount edit (job page sends status approved) → voided, sendLienWaiver once, waiverSent', async () => {
    const res = await patch({ status: 'approved', amount_billed: 1500 })
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out).toMatchObject({ waiverVoided: true, waiverSent: true, waiverError: null })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatchObject({ submissionId: 'b1' })
    expect(row()).toMatchObject({ status: 'approved', amount_billed: 1500, lien_waiver_signed_at: null, lien_waiver_signature: null })
    expect(row().lien_waiver_sent_at).toBeTruthy() // set by lib/lien-waiver.js only
    const sent = waiverEmails()
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.html).toContain('$1,500.00')
  })

  test('retainage edit (no status sent) → voided, sendLienWaiver once, waiverSent', async () => {
    const res = await patch({ retainage_pct: 5, retainage_held: 50 })
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out).toMatchObject({ waiverVoided: true, waiverSent: true, waiverError: null })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(row()).toMatchObject({ status: 'approved', retainage_pct: 5, retainage_held: 50, lien_waiver_signed_at: null })
    expect(waiverEmails()).toHaveLength(1)
  })

  test('send failure → 200 with waiverError, edit still saved and voided', async () => {
    spy.mockResolvedValueOnce({ ok: false, status: 400, error: 'No email on file for this sub' })
    const res = await patch({ status: 'approved', amount_billed: 1500 })
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out).toMatchObject({ ok: true, waiverVoided: true, waiverSent: false, waiverError: 'No email on file for this sub' })
    expect(row()).toMatchObject({ amount_billed: 1500, lien_waiver_signed_at: null, lien_waiver_sent_at: null })
  })

  test('send throws → 200 with waiverError, edit still saved', async () => {
    spy.mockRejectedValueOnce(new Error('resend down'))
    const res = await patch({ retainage_pct: 5, retainage_held: 50 })
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out).toMatchObject({ waiverVoided: true, waiverSent: false, waiverError: 'resend down' })
    expect(row()).toMatchObject({ retainage_pct: 5, lien_waiver_signed_at: null })
  })

  test('edit that reopens to pending → voided, no send', async () => {
    const res = await patch({ status: 'pending', amount_billed: 1500 })
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.waiverVoided).toBe(true)
    expect(out).not.toHaveProperty('waiverSent')
    expect(spy).not.toHaveBeenCalled()
    expect(waiverEmails()).toHaveLength(0)
    expect(row()).toMatchObject({ status: 'pending', lien_waiver_signed_at: null, lien_waiver_sent_at: null })
  })

  test('same values → no void, no send', async () => {
    const res = await patch({ status: 'approved', amount_billed: '1000.00', retainage_pct: 10, retainage_held: 100, billing_period: '2026-10-01' })
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.waiverVoided).toBeUndefined()
    expect(out).not.toHaveProperty('waiverSent')
    expect(spy).not.toHaveBeenCalled()
    expect(waiverEmails()).toHaveLength(0)
    expect(row().lien_waiver_signed_at).toBe('2026-11-03T15:00:00Z')
  })
})

describe('migration 062', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '062_lien_waiver_signed_terms.sql'), 'utf8')
  const body = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  test('idempotent ADD COLUMN IF NOT EXISTS, no backfill, rollback commented', () => {
    expect(body).toMatch(/ADD COLUMN IF NOT EXISTS lien_waiver_amount numeric\(12,2\)/)
    expect(body).toMatch(/ADD COLUMN IF NOT EXISTS lien_waiver_through date/)
    expect(body).toMatch(/ADD COLUMN IF NOT EXISTS lien_waiver_history jsonb NOT NULL DEFAULT '\[\]'::jsonb/)
    expect(body).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i)
    expect(sql).toMatch(/ROLLBACK:[\s\S]*--\s+ALTER TABLE public\.billing_submissions DROP COLUMN IF EXISTS lien_waiver_amount;/)
  })
})
