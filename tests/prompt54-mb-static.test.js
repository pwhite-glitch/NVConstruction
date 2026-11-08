/**
 * Prompt 54: migration 050 shape (additive, private tables, no data writes), applied
 * migrations untouched, one canonical site-URL helper, iPhone-safe openFile use,
 * no e-sign provider in the new path, and preview mode blocks the new mutations.
 * Reads files and read-only git only; nothing is applied.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
jest.mock('next/server', () => ({ NextResponse: { next: () => ({ passed: true }), json: (body, init) => ({ body, status: init?.status }) } }))

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const SQL = read('migrations/050_metal_building_order_workflow.sql')
const NEW_FILES = ['lib/mb-commission.js', 'lib/mb-orders.js', 'lib/mb-server.js', 'lib/mb-actions.js', 'app/sales/[id]/MbWorkflowPanel.js', 'app/sales/MbCommissionTabs.js', 'app/api/signing-requests/[token]/document/route.js']
const sqlCode = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

describe('migration 050', () => {
  test('is the next unused number and the only new migration', () => {
    const files = fs.readdirSync(path.join(root, 'migrations')).filter(f => /^\d{3}_/.test(f)).sort()
    expect(files.filter(f => f.startsWith('050_'))).toEqual(['050_metal_building_order_workflow.sql'])
    // Later packages add higher numbers (053+ in prompt 58); 050 is still the last of its batch.
    const upTo050 = files.filter(f => f < '051_')
    expect(upTo050[upTo050.length - 1]).toBe('050_metal_building_order_workflow.sql')
  })
  test('extends doc categories keeping all seven old ones', () => {
    for (const c of ['contract', 'quote', 'photo', 'permit', 'completion', 'other', 'general', 'supplier_order_form', 'client_order_form']) expect(sqlCode).toContain(`'${c}'`)
  })
  test('adds the native signing association, pins and uniqueness, job_id nullable', () => {
    for (const col of ['sales_order_id', 'sales_doc_id', 'document_sha256', 'deposit_amount_snapshot', 'signed_doc_id']) expect(sqlCode).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`))
    expect(sqlCode).toMatch(/ALTER COLUMN job_id DROP NOT NULL/)
    expect(sqlCode).toMatch(/signing_requests_sales_order_shape[\s\S]*NOT VALID/)
    expect(sqlCode).toMatch(/UNIQUE INDEX IF NOT EXISTS signing_requests_one_pending_per_sales_order/)
  })
  test('private tables: RLS on, no policies, browser roles revoked', () => {
    for (const t of ['mb_order_workflow', 'mb_order_private', 'company_payment_settings']) {
      expect(sqlCode).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
      expect(sqlCode).toMatch(new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon, authenticated`))
    }
    expect(sqlCode).not.toMatch(/CREATE POLICY/i)
    expect(sqlCode).not.toMatch(/GRANT[^;]*TO (anon|authenticated)/i)
  })
  test('no data backfill or business-row writes, no seeded banking data', () => {
    expect(sqlCode).not.toMatch(/\bUPDATE\s+(public\.)?\w+\s+SET\b/i)
    expect(sqlCode).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(sqlCode).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(sqlCode).not.toMatch(/routing|account number|\b\d{9}\b/i)
  })
  test('applied/unused migrations 042 and 044-049 are byte-for-byte unchanged', () => {
    const files = ['042_drawings_aia_numbers_owner_draws.sql', '044_job_lifecycle_and_schedule_access.sql', '045_billing_integrity_co_numbers_lookahead.sql', '046_residential_access_and_bank_draws.sql', '047_cash_outlook_expected_payment_dates.sql', '048_estimate_tax_rate.sql', '049_prime_co_review_rpc.sql']
    const diff = execSync(`git diff --name-only HEAD -- ${files.map(f => `migrations/${f}`).join(' ')}`, { cwd: root }).toString().trim()
    expect(diff).toBe('')
    for (const f of files) {
      const head = execSync(`git show HEAD:migrations/${f}`, { cwd: root })
      expect(fs.readFileSync(path.join(root, 'migrations', f)).equals(head)).toBe(true)
    }
  })
})

describe('canonical URL + providers', () => {
  test('one site-URL helper; new code uses it and no old origins', () => {
    const libs = fs.readdirSync(path.join(root, 'lib')).filter(f => f.endsWith('.js'))
    const definers = libs.filter(f => /DEFAULT_SITE_URL\s*=/.test(read(`lib/${f}`)))
    expect(definers).toEqual(['site-url.js'])
    for (const f of NEW_FILES) {
      const src = read(f)
      expect(src).not.toMatch(/nvim\.co|doym|app\.nvim|window\.location\.origin/)
      expect(src).not.toMatch(/hellosign|docusign|ESIGN_PROVIDER/i)
    }
    expect(read('lib/mb-server.js')).toMatch(/from '.\/site-url'/)
    expect(read('lib/mb-actions.js')).toMatch(/from '.\/site-url'/)
  })
  test('the MB completion path sends no receipt/staff email (only the deposit request)', () => {
    const src = read('app/api/signing-requests/[token]/route.js')
    const mbFn = src.slice(src.indexOf('async function signMbRequest'), src.indexOf('export async function POST'))
    expect(mbFn).not.toMatch(/resend\.emails\.send|PM_EMAIL/)
    expect(mbFn).toMatch(/completeMbSigning/)
  })
  test('/sign shows the pinned PDF for MB requests', () => {
    const src = read('app/sign/page.js')
    expect(src).toMatch(/document_kind === 'pdf'/)
    expect(src).toMatch(/src=\{request\.document_url\}/)
  })
})

describe('openFile (iPhone-safe) behavior + usage', () => {
  const { openFile } = require('../lib/open-file')
  let win
  beforeEach(() => {
    win = { closed: false, close: jest.fn(), location: {} }
    global.window = { open: jest.fn(() => win), location: {} }
  })
  afterEach(() => { delete global.window })

  test('window reserved before any async work, then navigated', async () => {
    const order = []
    global.window.open = jest.fn(() => { order.push('open'); return win })
    const p = openFile(async () => { order.push('fetch'); await Promise.resolve(); return 'https://portal.nv.construction/sign?token=t' })
    expect(order[0]).toBe('open')
    await p
    expect(win.location.href).toBe('https://portal.nv.construction/sign?token=t')
  })
  test('failed URL / token / storage closes the placeholder; missing data is not navigated', async () => {
    await openFile(async () => { throw new Error('422 not ready') })
    expect(win.close).toHaveBeenCalled()
    win.close.mockClear()
    await openFile(async () => null)
    expect(win.close).toHaveBeenCalled()
    expect(win.location.href).toBeUndefined()
    expect(global.window.location.href).toBeUndefined()
  })
  test('blocked popup falls back to the current tab', async () => {
    global.window.open = jest.fn(() => null)
    await openFile(async () => 'https://signed/x')
    expect(global.window.location.href).toBe('https://signed/x')
  })
  test('MB panel and order page open files/links through openFile in the click turn', () => {
    const panel = read('app/sales/[id]/MbWorkflowPanel.js')
    const send = panel.slice(panel.indexOf('function sendForSignature()'), panel.indexOf('const commission'))
    expect(send.indexOf('openFile(')).toBeGreaterThan(-1)
    expect(send.slice(0, send.indexOf('openFile('))).not.toMatch(/await/)
    expect(send).toMatch(/finally \{[\s\S]*setBusy\(''\)/)
    const page = read('app/sales/[id]/page.js')
    expect(page).toMatch(/function downloadDoc\(doc\) \{\s*openFile\(/)
    expect(page).not.toMatch(/window\.open\(url/)
  })
})

describe('preview mode', () => {
  test('middleware blocks the new MB mutations while previewing; reads pass', () => {
    const { middleware, config } = require('../middleware')
    expect(config.matcher).toBe('/api/:path*')
    const req = (method, pathname = '/api/sales-orders') => ({ method, nextUrl: { pathname }, cookies: { get: k => (k === 'nvc_preview' ? { value: 's1' } : undefined) } })
    expect(middleware(req('POST')).status).toBe(403)
    expect(middleware(req('POST', '/api/sales-order-docs')).status).toBe(403)
    expect(middleware(req('GET')).passed).toBe(true)
  })
})
