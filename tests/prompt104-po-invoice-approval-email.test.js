/**
 * Prompt 104: PO invoice approval emails + bell notices to the admin team, and the
 * sub-billing "Check ready to pay" email to the same people.
 * - lib/ap-recipients.js: parseApEmails, apRecipients (AP_EMAILS → admin profiles),
 *   sendApEmail, poInvoiceReadyEmail.
 * - /api/po-invoices PATCH approve: email + bell only after the guarded update landed;
 *   a failed email never undoes the approval (email_error).
 * - /api/billing-entry PATCH ready_to_pay false → true: email to the admin list,
 *   failure surfaces as readyToPayEmailError.
 * - notification label, admin ?tab= / bell link parsing, page wiring.
 * All data is in memory (tests/helpers/mock-db.js); no email is really sent.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState, supabaseModule } = require('./helpers/mock-db')

const mockSend = jest.fn()
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({ Resend: function () { this.emails = { send: (...a) => mockSend(...a) } } }))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
    PM_ROLES: PM,
    SUB_ROLES: SUB,
  }
})

const ap = require('../lib/ap-recipients')
const { notificationLabel, adminTarget } = require('../lib/notification-labels')
const { invalidateCache } = require('../lib/permissions')
const poRoute = require('../app/api/po-invoices/route')
const billingRoute = require('../app/api/billing-entry/route')

const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const client = supabaseModule.createClient()
const origGetUserById = client.auth.admin.getUserById

// Login emails by profile id; 'fail' makes getUserById reject for that id.
let authEmails = {}
const ADMIN_PROFILES = [
  { id: 'u-ad1', role: 'admin', full_name: 'Ann Admin', is_bot: false, invite_email: null },
  { id: 'u-ad2', role: 'admin', full_name: 'Bo Books', is_bot: false, invite_email: 'Bo@NV.test' },
  { id: 'u-bot', role: 'admin', full_name: 'Portal Bot', is_bot: true, invite_email: null },
  { id: 'u-pm', role: 'pm', full_name: 'Pat PM', is_bot: false, invite_email: null },
  { id: 'u-owner', role: 'principal', full_name: 'Olive Owner', is_bot: false, invite_email: null },
]

const savedEnv = { AP_EMAILS: process.env.AP_EMAILS }
beforeEach(() => {
  delete process.env.AP_EMAILS
  mockSend.mockReset()
  mockSend.mockResolvedValue({ data: { id: 'e1' }, error: null })
  authEmails = { 'u-ad1': 'ann@nv.test', 'u-ad2': null, 'u-bot': 'bot1@bots.nv.construction', 'u-pm': 'pm@nv.test', 'u-owner': 'owner@nv.test' }
  client.auth.admin.getUserById = async id => {
    if (authEmails[id] === 'fail') throw new Error('auth down')
    return { data: { user: { id, email: authEmails[id] ?? null } }, error: null }
  }
})
afterAll(() => {
  client.auth.admin.getUserById = origGetUserById
  if (savedEnv.AP_EMAILS === undefined) delete process.env.AP_EMAILS
  else process.env.AP_EMAILS = savedEnv.AP_EMAILS
})
jest.spyOn(console, 'error').mockImplementation(() => {})

// ── Pure helpers ─────────────────────────────────────────────────────────────
describe('parseApEmails', () => {
  test('commas / semicolons / spaces, trims, lowercases, de-dupes, drops junk, keeps order', () => {
    expect(ap.parseApEmails(' AP@NV.test, b@x.co;c@y.org  d@z.io\na@nv.test ; junk, @no.com, x@y, two@@x.com ')).toEqual(['ap@nv.test', 'b@x.co', 'c@y.org', 'd@z.io', 'a@nv.test'])
    expect(ap.parseApEmails('a@b.com,A@B.COM')).toEqual(['a@b.com'])
  })
  test('empty / missing → []', () => {
    for (const v of ['', '   ', undefined, null, ' ,; ', 42]) expect(ap.parseApEmails(v)).toEqual([])
  })
})

describe('apRecipients', () => {
  beforeEach(() => resetMockState({ profiles: ADMIN_PROFILES.map(p => ({ ...p })) }))

  test('admin profiles → auth emails with invite_email fallback; bots and non-admins skipped', async () => {
    const r = await ap.apRecipients(client, { env: {} })
    expect(r).toEqual({ emails: ['ann@nv.test', 'bo@nv.test'], userIds: ['u-ad1', 'u-ad2'], source: 'admins', error: null })
  })
  test('de-duped; a bot-domain login email is skipped even when is_bot is false', async () => {
    mockState.db.profiles.push({ id: 'u-ad3', role: 'admin', is_bot: false, invite_email: null }, { id: 'u-bot2', role: 'admin', is_bot: false, invite_email: null })
    authEmails['u-ad3'] = 'ANN@nv.test'
    authEmails['u-bot2'] = 'bot2@bots.nv.construction'
    const r = await ap.apRecipients(client, { env: {} })
    expect(r.emails).toEqual(['ann@nv.test', 'bo@nv.test'])
    expect(r.userIds).toEqual(['u-ad1', 'u-ad2', 'u-ad3'])
  })
  test('AP_EMAILS set → emails from env (source env); bell ids are still the admin profiles', async () => {
    const r = await ap.apRecipients(client, { env: { AP_EMAILS: 'ap@nv.test; books@nv.test' } })
    expect(r).toEqual({ emails: ['ap@nv.test', 'books@nv.test'], userIds: ['u-ad1', 'u-ad2'], source: 'env', error: null })
  })
  test('AP_EMAILS with only junk falls back to the admins', async () => {
    expect((await ap.apRecipients(client, { env: { AP_EMAILS: 'nope, ;' } })).source).toBe('admins')
  })
  test('defaults to process.env', async () => {
    process.env.AP_EMAILS = 'env@nv.test'
    expect((await ap.apRecipients(client)).emails).toEqual(['env@nv.test'])
  })
  test('no admins and no env → error text, no throw', async () => {
    resetMockState({ profiles: [{ id: 'u-pm', role: 'pm' }] })
    const r = await ap.apRecipients(client, { env: {} })
    expect(r).toEqual({ emails: [], userIds: [], source: 'admins', error: ap.NO_AP_EMAIL_MESSAGE })
  })
  test('profiles query error → error text, no throw', async () => {
    mockState.failSelect.profiles = 'boom'
    const r = await ap.apRecipients(client, { env: {} })
    expect(r.emails).toEqual([])
    expect(r.error).toMatch(/boom/)
  })
  test('one getUserById failure skips only that person\'s email', async () => {
    authEmails['u-ad1'] = 'fail'
    const r = await ap.apRecipients(client, { env: {} })
    expect(r.emails).toEqual(['bo@nv.test'])
    expect(r.error).toBe(null)
    expect(r.userIds).toEqual(['u-ad1', 'u-ad2']) // the bell does not need the email
  })
})

describe('sendApEmail', () => {
  const resend = { emails: { send: (...a) => mockSend(...a) } }
  test('one send to the whole list; null on success', async () => {
    expect(await ap.sendApEmail(resend, { to: ['a@x.com', 'b@x.com'], subject: 'S', html: '<p>h</p>' })).toBe(null)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0]).toMatchObject({ to: ['a@x.com', 'b@x.com'], subject: 'S', html: '<p>h</p>' })
    expect(mockSend.mock.calls[0][0].from).toBeTruthy()
  })
  test('{ error } and throws become text; empty to → no send', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'Domain not verified' } })
    expect(await ap.sendApEmail(resend, { to: ['a@x.com'], subject: 'S', html: '' })).toBe('Domain not verified')
    mockSend.mockRejectedValueOnce(new Error('network'))
    expect(await ap.sendApEmail(resend, { to: ['a@x.com'], subject: 'S', html: '' })).toBe('network')
    mockSend.mockClear()
    expect(await ap.sendApEmail(resend, { to: [], subject: 'S', html: '' })).toBe(ap.NO_AP_EMAIL_MESSAGE)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('poInvoiceReadyEmail', () => {
  const po = { po_number: 'PO-101-001', vendor_name: 'Lumber Co', job_id: 'J1' }
  const job = { job_number: '101', project_name: 'NV Job' }
  const inv = { id: 'i1', invoice_number: 'INV-9', amount: 1250.5, invoice_date: '2026-11-01', due_date: null }
  test('subject + every line; due date defaults to invoice date + 30; link to admin Ready to pay', () => {
    const { subject, html } = ap.poInvoiceReadyEmail({ po, job, inv, approverName: 'Pat PM' })
    expect(subject).toBe('PO invoice ready to pay — Lumber Co · #101')
    for (const s of ['Lumber Co', '#101 NV Job', 'PO-101-001', 'INV-9', '$1,250.50', '12/01/2026', 'Pat PM', 'Open Ready to pay']) expect(html).toContain(s)
    expect(ap.READY_TO_PAY_LINK_PATH).toBe('/admin?tab=orders&view=ready_to_pay')
    expect(html).toContain(ap.adminReadyToPayUrl().replace(/&/g, '&amp;'))
    expect(ap.adminReadyToPayUrl()).toMatch(/^https?:\/\/[^/]+\/admin\?tab=orders&view=ready_to_pay$/)
  })
  test('a set due date wins; no approver line when unknown', () => {
    const { html } = ap.poInvoiceReadyEmail({ po, job, inv: { ...inv, due_date: '2026-11-15' } })
    expect(html).toContain('11/15/2026')
    expect(html).not.toContain('Approved by')
  })
  test('escapes user values', () => {
    const { html } = ap.poInvoiceReadyEmail({ po: { ...po, vendor_name: '<script>alert(1)</script>' }, job, inv })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

// ── /api/po-invoices approve ─────────────────────────────────────────────────
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const json = async res => ({ status: res.status, body: await res.json() })
const PM = { userId: 'u-pm', role: 'pm', email: 'pm@nv.test' }
const ADMIN = { userId: 'u-ad1', role: 'admin', email: 'ann@nv.test' }
const as = a => { mockState.auth = a }
const add = body => poRoute.POST(req('/api/po-invoices', 'POST', body)).then(json)
const patch = body => poRoute.PATCH(req('/api/po-invoices', 'PATCH', body)).then(json)
const NEW = { po_id: 'P1', invoice_number: 'INV-9', invoice_date: '2026-11-01', amount: 400 }
const readyNotices = () => (mockState.db.notifications || []).filter(n => n.type === 'po_invoice_ready')

function seedPO() {
  resetMockState({
    jobs: [{ id: 'J1', job_number: '101', project_name: 'NV Job', po_payer: 'nv', pm_email: null }],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'u-pm' }],
    purchase_orders: [{ id: 'P1', job_id: 'J1', po_number: 'PO-101-001', vendor_name: 'Lumber Co', amount: 1000, status: 'issued', payment_type: 'check', payer_override: null }],
    po_invoices: [],
    change_log: [],
    notifications: [],
    profiles: ADMIN_PROFILES.map(p => ({ ...p })),
    role_permissions: [{ role: 'admin', feature_key: 'po.mark_paid', enabled: true }],
  })
  mockState.defaults.po_invoices = () => ({ paid_amount: 0, ready_to_pay: false, paid_by_owner: false, approved_at: null, approved_by: null, paid_at: null, source: 'app', check_number: null, payment_notes: null })
  invalidateCache()
}

describe('PATCH /api/po-invoices approve → email + bell to the admin team', () => {
  let id
  beforeEach(async () => { seedPO(); as(PM); id = (await add(NEW)).body.invoice.id })

  test('success: one email to the admins, one bell per admin, email_error null', async () => {
    const r = await patch({ id, action: 'approve' })
    expect(r.status).toBe(200)
    expect(r.body.invoice).toMatchObject({ ready_to_pay: true, status: 'ready_to_pay' })
    expect(r.body.email_error).toBe(null)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const msg = mockSend.mock.calls[0][0]
    expect(msg.to).toEqual(['ann@nv.test', 'bo@nv.test'])
    expect(msg.subject).toBe('PO invoice ready to pay — Lumber Co · #101')
    expect(msg.html).toContain('Pat PM') // approver name from profiles
    const n = readyNotices()
    expect(n.map(x => x.recipient_id).sort()).toEqual(['u-ad1', 'u-ad2'])
    for (const x of n) {
      expect(x).toMatchObject({ type: 'po_invoice_ready', entity_type: 'po_invoice', entity_id: id, dedup_key: `po_invoice_ready:${id}`, job_id: 'J1', link: '/admin?tab=orders&view=ready_to_pay' })
      expect(x.title).toBe('PO invoice ready to pay — Lumber Co · $400.00')
      expect(x.body).toBe('Job #101 · PO PO-101-001 · Inv INV-9 · due 12/01/2026')
    }
  })

  test('Resend returns { error } → still 200 and approved, email_error is the message', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'Domain not verified' } })
    const r = await patch({ id, action: 'approve' })
    expect(r.status).toBe(200)
    expect(r.body.email_error).toBe('Domain not verified')
    expect(mockState.db.po_invoices.find(i => i.id === id).ready_to_pay).toBe(true)
    expect(readyNotices()).toHaveLength(2) // the bell still goes out
  })

  test('Resend throws → still 200 and approved, email_error is the message', async () => {
    mockSend.mockRejectedValueOnce(new Error('socket hang up'))
    const r = await patch({ id, action: 'approve' })
    expect(r.status).toBe(200)
    expect(r.body.email_error).toBe('socket hang up')
    expect(mockState.db.po_invoices.find(i => i.id === id).ready_to_pay).toBe(true)
  })

  test('no admin email on file → approved, email_error says so, no send', async () => {
    mockState.db.profiles = mockState.db.profiles.filter(p => p.role !== 'admin')
    const r = await patch({ id, action: 'approve' })
    expect(r.status).toBe(200)
    expect(r.body.email_error).toBe(ap.NO_AP_EMAIL_MESSAGE)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('already approved (409) → no email, no bell', async () => {
    await patch({ id, action: 'approve' })
    mockSend.mockClear()
    mockState.db.notifications = []
    const r = await patch({ id, action: 'approve' })
    expect(r.status).toBe(409)
    expect(mockSend).not.toHaveBeenCalled()
    expect(readyNotices()).toHaveLength(0)
  })

  test('guarded update returns 0 rows (approved by someone else meanwhile) → 409, no email, no bell', async () => {
    mockState.beforeWrite = (table, op) => {
      if (table === 'po_invoices' && op === 'update') { mockState.beforeWrite = null; mockState.db.po_invoices.find(i => i.id === id).ready_to_pay = true }
    }
    const r = await patch({ id, action: 'approve' })
    expect(r.status).toBe(409)
    expect(r.body.email_error).toBeUndefined()
    expect(mockSend).not.toHaveBeenCalled()
    expect(readyNotices()).toHaveLength(0)
  })

  test('send back then approve again is a new transition: emails again', async () => {
    await patch({ id, action: 'approve' })
    as(ADMIN)
    await patch({ id, action: 'send_back', reason: 'Wrong amount' })
    as(PM)
    const r = await patch({ id, action: 'approve' })
    expect(r.status).toBe(200)
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  test('AP_EMAILS override → the email goes to the env list; the bell still to admin profile ids', async () => {
    process.env.AP_EMAILS = 'ap@nv.test, books@nv.test'
    const r = await patch({ id, action: 'approve' })
    expect(r.body.email_error).toBe(null)
    expect(mockSend.mock.calls[0][0].to).toEqual(['ap@nv.test', 'books@nv.test'])
    expect(readyNotices().map(x => x.recipient_id).sort()).toEqual(['u-ad1', 'u-ad2'])
  })
})

// ── /api/billing-entry ready_to_pay ──────────────────────────────────────────
describe('PATCH /api/billing-entry ready_to_pay → admin email', () => {
  const bpatch = body => billingRoute.PATCH(req('/api/billing-entry', 'PATCH', body)).then(json)
  beforeEach(() => {
    resetMockState({
      jobs: [{ id: 'J1', job_number: '101', project_name: 'Main <b>', payment_type: 'nv_pays' }],
      pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }],
      billing_submissions: [
        { id: 'b1', job_id: 'J1', status: 'approved', amount_billed: 1000, retainage_held: 100, retainage_pct: 10, paid_at: null, payment_amount: null, draw_request_id: null, company_name: 'Acme <i>', sub_id: null, ready_to_pay: false },
        { id: 'b2', job_id: 'J1', status: 'approved', amount_billed: 500, retainage_held: 0, retainage_pct: 0, paid_at: null, payment_amount: null, draw_request_id: null, company_name: 'Beta', sub_id: null, ready_to_pay: true },
      ],
      notifications: [],
      change_log: [],
      profiles: ADMIN_PROFILES.map(p => ({ ...p })),
    })
    mockState.auth = { userId: 'pm1', role: 'pm', email: 'pm1@x.com', error: null }
  })

  test('false → true: one email to the admin list, escaped, linked to admin Ready to pay', async () => {
    const r = await bpatch({ id: 'b1', ready_to_pay: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, emailError: null, readyToPayEmailError: null })
    expect(mockSend).toHaveBeenCalledTimes(1)
    const msg = mockSend.mock.calls[0][0]
    expect(msg.to).toEqual(['ann@nv.test', 'bo@nv.test'])
    expect(msg.subject).toBe('Check ready to pay — Acme <i> · #101')
    expect(msg.html).toContain('Acme &lt;i&gt;')
    expect(msg.html).toContain('Main &lt;b&gt;')
    expect(msg.html).not.toContain('<i>')
    expect(msg.html).toContain('/admin?tab=orders&amp;view=ready_to_pay')
    expect(msg.html).not.toMatch(/management@nvim\.co|\/dashboard/)
    expect(msg.html).toContain('$900.00')
  })

  test('send failure → 200 ok, readyToPayEmailError set, the flag is saved', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'Rate limited' } })
    const r = await bpatch({ id: 'b1', ready_to_pay: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, emailError: null, readyToPayEmailError: 'Rate limited' })
    expect(mockState.db.billing_submissions.find(b => b.id === 'b1').ready_to_pay).toBe(true)
  })

  test('AP_EMAILS override is used', async () => {
    process.env.AP_EMAILS = 'ap@nv.test'
    await bpatch({ id: 'b1', ready_to_pay: true })
    expect(mockSend.mock.calls[0][0].to).toEqual(['ap@nv.test'])
  })

  test('already ready to pay → no email and no readyToPayEmailError key', async () => {
    const r = await bpatch({ id: 'b2', ready_to_pay: true })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect('readyToPayEmailError' in r.body).toBe(false)
    expect(r.body.emailError).toBe(null)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('unmarking (true → false) sends nothing', async () => {
    const r = await bpatch({ id: 'b2', ready_to_pay: false })
    expect(r.status).toBe(200)
    expect('readyToPayEmailError' in r.body).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('the route no longer reads PM_EMAIL / management@nvim.co for this email', () => {
    const src = read('app/api/billing-entry/route.js')
    expect(src).not.toMatch(/PM_EMAIL|management@nvim\.co/)
    expect(src).toMatch(/current\.ready_to_pay !== true/)
    expect(src).not.toMatch(/\.catch\(\(\) => \{\}\)/)
  })
})

// ── Labels, admin link parsing, page wiring ─────────────────────────────────
describe('notification label + admin link parsing', () => {
  test('po_invoice_ready label', () => {
    expect(notificationLabel('po_invoice_ready')).toBe('PO invoice ready to pay')
  })
  test('adminTarget: allowed tab / view only', () => {
    const tabs = ['calendar', 'orders', 'billing']
    const views = ['ready_to_pay', 'needs_approval', 'paid']
    expect(adminTarget('/admin?tab=orders&view=ready_to_pay', tabs, views)).toEqual({ tab: 'orders', view: 'ready_to_pay' })
    expect(adminTarget('?tab=orders&view=paid', tabs, views)).toEqual({ tab: 'orders', view: 'paid' })
    expect(adminTarget('?tab=orders&view=bogus', tabs, views)).toEqual({ tab: 'orders', view: null })
    expect(adminTarget('?tab=billing&view=paid', tabs, views)).toEqual({ tab: 'billing', view: null })
    expect(adminTarget('?tab=bots', tabs, views)).toEqual({ tab: null, view: null })
    expect(adminTarget('', tabs, views)).toEqual({ tab: null, view: null })
    expect(adminTarget('/admin', tabs, views)).toEqual({ tab: null, view: null })
    expect(adminTarget(null)).toEqual({ tab: null, view: null })
  })
})

describe('page wiring (source checks)', () => {
  test('admin page reads ?tab/?view and shows the bell in the sidebar header', () => {
    const src = read('app/admin/page.js')
    expect(src).toMatch(/import NotificationBell from '\.\.\/components\/NotificationBell'/)
    expect(src).toMatch(/openAdminTarget\(window\.location\.search\)/)
    expect(src).toMatch(/<NotificationBell dark onOpen=/)
    expect(src).toMatch(/link\.startsWith\('\/admin'\)\) openAdminTarget\(link\)/)
    expect(src).toMatch(/data-drawer-keep/)
    expect(src).toMatch(/const PO_VIEW_KEYS = \['ready_to_pay', 'needs_approval', 'paid', 'owner', 'all_pos'\]/)
    // Every PO chip key on the page is a key ?view= accepts.
    for (const k of ['ready_to_pay', 'needs_approval', 'paid', 'owner', 'all_pos']) expect(src).toMatch(new RegExp(`\\{ key: '${k}', label:`))
  })
  test('job page panel + ready-to-pay toggle surface the email error without undoing the change', () => {
    expect(read('app/jobdetail/POInvoicesPanel.js')).toMatch(/Approved\. The office email did not send: \$\{emailError\}/)
    expect(read('app/jobdetail/page.js')).toMatch(/Marked ready to pay\. The office email did not send: \$\{r\.data\.readyToPayEmailError\}/)
  })
})
