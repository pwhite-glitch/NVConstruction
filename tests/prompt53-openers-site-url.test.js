/**
 * Prompt 53 items 11 and 12 (mocked window/fetch/email/auth; nothing real sent).
 * 11. Sub portal + customer portal openers reserve the window in the click turn (before any
 *     auth/HTTP await), fetch inside the getter, close the window and report on failure,
 *     never navigate to an undefined token, keep the popup-blocked current-tab fallback,
 *     and the printable contract HTML still prints.
 * 12. One canonical site URL (default https://portal.nv.construction) handles unset/blank/
 *     trailing-slash/multi-slash env; portal/email/reset/invite/customer links use it; no
 *     stale doym / app.nvim.co / nvim.co portal fallbacks; business contact text untouched.
 *     (Unit tests cannot and do not verify the Supabase Auth redirect allow-list.)
 */
const fs = require('fs')
const path = require('path')

let mockGenerateLinkArgs = []
let mockSentEmails = []
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { generateLink: async args => { mockGenerateLinkArgs.push(args); return { data: { properties: { action_link: 'https://auth/link' } }, error: null } } } },
  }),
}))
jest.mock('resend', () => ({ Resend: function () { this.emails = { send: async m => { mockSentEmails.push(m); return { data: { id: 'e' }, error: null } } } } }))

const { normalizeSiteUrl, getSiteUrl, siteUrl, DEFAULT_SITE_URL } = require('../lib/site-url')
const openers = require('../lib/portal-openers')

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_SITE_URL
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_ENV
})

describe('item 12 — canonical site URL helper', () => {
  it('defaults to https://portal.nv.construction for unset/blank/garbage values', () => {
    expect(DEFAULT_SITE_URL).toBe('https://portal.nv.construction')
    for (const v of [undefined, null, '', '   ', 'undefined', '/relative', 'portal.nv.construction']) {
      expect(normalizeSiteUrl(v)).toBe(DEFAULT_SITE_URL)
    }
  })
  it('trims trailing slashes (one or many) and whitespace', () => {
    expect(normalizeSiteUrl('https://portal.nv.construction/')).toBe('https://portal.nv.construction')
    expect(normalizeSiteUrl(' https://preview.example.com/// ')).toBe('https://preview.example.com')
  })
  it('never produces //submit or //set-password, and reads env at call time', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://portal.nv.construction///'
    expect(siteUrl('/submit')).toBe('https://portal.nv.construction/submit')
    expect(siteUrl('//set-password')).toBe('https://portal.nv.construction/set-password')
    delete process.env.NEXT_PUBLIC_SITE_URL
    expect(getSiteUrl()).toBe(DEFAULT_SITE_URL)
    expect(siteUrl('submit')).toBe('https://portal.nv.construction/submit')
    expect(siteUrl()).toBe(DEFAULT_SITE_URL)
  })
  it('emailed portal link (billing-open email) uses the helper, no relative/undefined links', () => {
    const { billingOpenEmail } = require('../lib/email')
    process.env.NEXT_PUBLIC_SITE_URL = ''
    expect(billingOpenEmail({ firstName: 'A', projectName: 'P', contractAmt: 1 }).html).toContain('href="https://portal.nv.construction/submit"')
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.example.com//'
    const html = billingOpenEmail({ firstName: 'A', projectName: 'P', contractAmt: 1 }).html
    expect(html).toContain('href="https://x.example.com/submit"')
    expect(html).not.toMatch(/undefined\/submit|href="\/submit/)
  })
  it('password reset requests redirectTo <canonical>/set-password with no double slash', async () => {
    const reset = require('../app/api/reset-password/route')
    process.env.NEXT_PUBLIC_SITE_URL = 'https://portal.nv.construction/'
    mockGenerateLinkArgs = []
    await reset.POST(new Request('http://x/api/reset-password', { method: 'POST', body: JSON.stringify({ email: 'a@b.com' }) }))
    expect(mockGenerateLinkArgs[0].options.redirectTo).toBe('https://portal.nv.construction/set-password')
    expect(mockSentEmails.at(-1).html).toContain('https://portal.nv.construction/logo.png')
  })

  const ROUTES = [
    'lib/email.js', 'lib/rfi-notify.js', 'app/dashboard/page.js', 'app/jobdetail/page.js',
    'app/api/invite-sub/route.js', 'app/api/invite-team/route.js', 'app/api/invite-team-member/route.js',
    'app/api/reset-password/route.js', 'app/api/lookaheads/send/route.js', 'app/api/doc-request/route.js',
    'app/api/notify-sub/route.js', 'app/api/billing-reminders/route.js', 'app/api/coi-reminder/route.js',
    'app/api/lien-waiver/route.js', 'app/api/punch-list/route.js', 'app/api/messages/route.js',
    'app/api/billing-entry/route.js', 'app/api/customer-portal/route.js', 'app/api/sub-initiate-sign/route.js',
    'app/api/signing-requests/route.js', 'app/api/signing-requests/[token]/route.js', 'app/api/mileage-reminder/route.js',
    'app/api/sub-portal/billing/route.js',
  ]
  it.each(ROUTES)('%s imports the shared helper', f => {
    expect(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).toMatch(/from '[./]+(lib\/)?site-url'/)
  })

  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (p.endsWith('.js')) out.push(p)
    }
    return out
  }
  const SOURCES = [...walk(path.join(__dirname, '../app')), ...walk(path.join(__dirname, '../lib'))].filter(p => !p.endsWith('site-url.js'))
  it('no stale portal bases or direct SITE_URL/APP_URL env reads remain outside the helper', () => {
    const bad = []
    for (const p of SOURCES) {
      const src = fs.readFileSync(p, 'utf8')
      if (/nv-construction-doym|app\.nvim\.co|portal\.nvim\.co|https:\/\/nvim\.co|NEXT_PUBLIC_SITE_URL|NEXT_PUBLIC_APP_URL|process\.env\.APP_URL/.test(src)) bad.push(path.relative(path.join(__dirname, '..'), p))
    }
    expect(bad).toEqual([])
  })
  it('estimate PDF business contact text is untouched (management@nvim.co / nvim.co)', () => {
    const pdf = fs.readFileSync(path.join(__dirname, '../lib/generate-estimate-pdf.js'), 'utf8')
    expect(pdf).toMatch(/management@nvim\.co/)
    expect(pdf).toMatch(/nvim\.co<br>/)
  })
})

describe('item 11 — tap-safe portal openers', () => {
  let popup
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  const deferred = () => { let resolve; const p = new Promise(r => { resolve = r }); return { p, resolve } }
  beforeEach(() => {
    popup = { closed: false, close: jest.fn(), location: { href: '' }, document: { open: jest.fn(), write: jest.fn(), close: jest.fn() } }
    global.window = { open: jest.fn(() => popup), location: { href: 'https://portal.nv.construction/submit', origin: 'https://portal.nv.construction' } }
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { delete global.window; jest.restoreAllMocks() })

  it('signed contract: window reserved before the auth/HTTP call resolves, then navigated', async () => {
    const d = deferred()
    const fetchFn = jest.fn(() => d.p)
    const pending = openers.openSignedContract(fetchFn, 'sub/c.pdf')
    expect(window.open).toHaveBeenCalledWith('', '_blank')
    d.resolve(resp(200, { url: 'https://signed/c.pdf' }))
    expect(await pending).toEqual({ ok: true })
    expect(popup.location.href).toBe('https://signed/c.pdf')
  })

  it('signed contract: server error closes the window and reports', async () => {
    const r = await openers.openSignedContract(async () => resp(403, { error: 'Forbidden' }), 'sub/c.pdf')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Forbidden/)
    expect(popup.close).toHaveBeenCalled()
    expect(popup.location.href).toBe('')
  })

  it('bid plan: missing URL closes the window; popup blocked falls back to current tab', async () => {
    const r = await openers.openBidPlan(async () => resp(200, {}), 'p.pdf')
    expect(r).toMatchObject({ ok: false, error: 'Plan not available.' })
    expect(popup.close).toHaveBeenCalled()
    window.open = jest.fn(() => null)
    const r2 = await openers.openBidPlan(async () => resp(200, { url: 'https://signed/p.pdf' }), 'p.pdf')
    expect(r2.ok).toBe(true)
    expect(window.location.href).toBe('https://signed/p.pdf')
  })

  it('start signing: opens /sign?token=<real token>; no token never navigates to undefined', async () => {
    const d = deferred()
    const pending = openers.startSigning(() => d.p, 'sc1', 'u1')
    expect(window.open).toHaveBeenCalledTimes(1)
    d.resolve(resp(200, { token: 'tok 1' }))
    const r = await pending
    expect(r).toEqual({ ok: true, token: 'tok 1' })
    expect(popup.location.href).toBe('https://portal.nv.construction/sign?token=tok%201')

    popup.location.href = ''
    popup.close.mockClear()
    const bad = await openers.startSigning(async () => resp(200, {}), 'sc1', 'u1')
    expect(bad.ok).toBe(false)
    expect(popup.close).toHaveBeenCalled()
    expect(popup.location.href).toBe('')
    const err = await openers.startSigning(async () => resp(409, { error: 'Already signed' }), 'sc1', 'u1')
    expect(err).toMatchObject({ ok: false, error: 'Error: Already signed' })
  })

  it('print contract: window reserved first; HTML written with a print trigger; signing list refreshed', async () => {
    const d = deferred()
    const onSR = jest.fn(async () => {})
    const plainFetch = jest.fn(async url => {
      expect(url).toBe('/api/signing-requests/t1?html=1')
      return resp(200, { data: { document_html: '<html><body><h1>Contract</h1></body></html>' } })
    })
    const pending = openers.printSubcontract(() => d.p, plainFetch, 'sc1', 'u1', onSR)
    expect(window.open).toHaveBeenCalledWith('', '_blank')
    expect(popup.document.write).not.toHaveBeenCalled()
    d.resolve(resp(200, { token: 't1' }))
    const r = await pending
    expect(r.ok).toBe(true)
    expect(onSR).toHaveBeenCalled()
    const html = popup.document.write.mock.calls[0][0]
    expect(html).toContain('<h1>Contract</h1>')
    expect(html).toMatch(/window\.print\(\)/)
    expect(html.indexOf('window.print')).toBeLessThan(html.indexOf('</body>'))
  })

  it('print contract: missing HTML closes the window and reports', async () => {
    const r = await openers.printSubcontract(async () => resp(200, { token: 't1' }), async () => resp(200, { data: {} }), 'sc1', 'u1')
    expect(r).toMatchObject({ ok: false, error: 'Contract document not available.' })
    expect(popup.close).toHaveBeenCalled()
  })

  it('customer download: reserved before fetch; non-ok closes the window with a message', async () => {
    const d = deferred()
    const pending = openers.openCustomerDoc(() => d.p, 'tok', 'doc1')
    expect(window.open).toHaveBeenCalledTimes(1)
    d.resolve(resp(404, {}))
    const r = await pending
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Unable to download/)
    expect(popup.close).toHaveBeenCalled()
  })

  it('withPrintTrigger appends to HTML without a body tag', () => {
    expect(openers.withPrintTrigger('<p>x</p>')).toMatch(/^<p>x<\/p><script>/)
  })
})

describe('item 11 — handlers call the openers in the click turn (no await first)', () => {
  const submit = fs.readFileSync(path.join(__dirname, '../app/submit/page.js'), 'utf8')
  const portal = fs.readFileSync(path.join(__dirname, '../app/portal/[token]/page.js'), 'utf8')
  const body = (src, sig, len = 700) => { const i = src.indexOf(sig); expect(i).toBeGreaterThan(-1); return src.slice(i, i + len) }

  it.each([
    ['function viewSignedContract(', 'openSignedContract('],
    ['function openPlan(', 'openBidPlan('],
    ['function printContract(', 'printSubcontract('],
    ['function initiateSign(', 'startSigning('],
  ])('%s → %s before any await', (sig, helper) => {
    const b = body(submit, sig)
    expect(submit).not.toMatch(new RegExp(`async ${sig.replace('(', '\\(')}`))
    const call = b.indexOf(helper)
    expect(call).toBeGreaterThan(-1)
    const firstAwait = b.indexOf('await ')
    expect(firstAwait === -1 || firstAwait > call).toBe(true)
  })

  it('submit imports the openers; old popup-required alert and raw window.open removed from these handlers', () => {
    expect(submit).toMatch(/import \{ openSignedContract, openBidPlan, startSigning, printSubcontract \} from '\.\.\/\.\.\/lib\/portal-openers'/)
    expect(submit).not.toMatch(/Please allow popups for this site to view your contract/)
    expect(submit).not.toMatch(/window\.open\(`\/sign\?token=/)
  })

  it('loading flags reset in finally', () => {
    expect(body(submit, 'function printContract(')).toMatch(/\.finally\(\(\) => setPrintingContractFor\(null\)\)/)
    expect(body(submit, 'function initiateSign(')).toMatch(/\.finally\(\(\) => setInitiatingSignFor\(null\)\)/)
    expect(body(portal, 'const handleDownload')).toMatch(/\.finally\(\(\) => setDownloadingDoc\(null\)\)/)
  })

  it('customer portal handleDownload uses openCustomerDoc before any await', () => {
    const full = body(portal, 'const handleDownload')
    const b = full.slice(0, full.indexOf('}, [token, downloadingDoc])'))
    expect(b).toMatch(/useCallback\(\(doc\) =>/)
    expect(b).toMatch(/openCustomerDoc\(fetch, token, doc\.id\)/)
    expect(b).not.toMatch(/await /)
    expect(portal).toMatch(/import \{ openCustomerDoc \} from '\.\.\/\.\.\/\.\.\/lib\/portal-openers'/)
  })
})
