/**
 * Prompt 66: Owner reimbursement "Export ZIP + Receipts" package.
 * - Every invoice line appears in INDEX.txt (NO RECEIPT when there is no backup).
 * - Receipt files are named line#_date_vendor_billed.ext.
 * - README is owner-facing (no confidential/internal wording) and its contents list is honest.
 * - Invoice.html is required; the client builds it without the print popup.
 * DB/auth/roles/zip are mocked; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => (mockState.auth ? mockState.auth : { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }),
    isPM: r => PM.has(r),
  }
})
const mockDeny = { response: null }
jest.mock('../lib/roles', () => ({ denyJob: jest.fn(async () => mockDeny.response) }))
const mockZip = { calls: [] }
jest.mock('../lib/zip-builder', () => ({
  buildZip: jest.fn(files => { mockZip.calls.push(files); return Buffer.from('PK-mock') }),
}))

const { POST } = require('../app/api/owner-reimb-export/route')
const { denyJob } = require('../lib/roles')

const INV = 'inv-0001'
const JOB = 'job-0001'
const HTML = '<!DOCTYPE html><html><body>Reimbursement Invoice RI-2026-001</body></html>'

const req = body => new Request('http://x/api/owner-reimb-export', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})
const files = () => mockZip.calls[mockZip.calls.length - 1]
const file = name => files().find(f => f.name === name)
const text = name => file(name).data.toString('utf8')

function seedInvoice(lines) {
  resetMockState({
    owner_reimb_invoices: [{
      id: INV, invoice_number: 'RI-2026-001', job_id: JOB, status: 'issued',
      owner_reimb_invoice_lines: lines,
    }],
  })
}

const LINE_RECEIPT = {
  id: 'line-b', sort_order: 0, description: 'Lumber for repair', direct_cost_id: 'dc-1',
  expense_date: '2026-03-15', vendor: 'Home Depot', billed_amount: 123.45,
  direct_costs: { id: 'dc-1', receipt_url: 'job-0001/abc123.PDF', description: 'Lumber' },
}
const LINE_NONE = {
  id: 'line-a', sort_order: 1, description: 'Dumpster swap', direct_cost_id: 'dc-2',
  expense_date: '2026-03-20', vendor: 'Waste Co.', billed_amount: 400,
  direct_costs: { id: 'dc-2', receipt_url: null, description: 'Dumpster' },
}

beforeEach(() => {
  seedInvoice([LINE_NONE, LINE_RECEIPT]) // stored out of order; sort_order decides
  mockState.files['receipts/job-0001/abc123.PDF'] = Buffer.from('%PDF-receipt-bytes')
  mockState.auth = { userId: 'u-pm', email: 'pm@nv.test', role: 'pm', error: null }
  mockDeny.response = null
  mockZip.calls = []
  denyJob.mockClear()
})

describe('owner-reimb-export route', () => {
  test('no session → 401, no ZIP', async () => {
    mockState.auth = null
    const res = await POST(req({ invoiceId: INV, invoiceHtml: HTML }))
    expect(res.status).toBe(401)
    expect(mockZip.calls).toHaveLength(0)
  })

  test('non-PM role → 403, no ZIP', async () => {
    mockState.auth = { userId: 'u-sub', role: 'subcontractor', error: null }
    const res = await POST(req({ invoiceId: INV, invoiceHtml: HTML }))
    expect(res.status).toBe(403)
    expect(mockZip.calls).toHaveLength(0)
  })

  test('denyJob response is returned, no ZIP', async () => {
    mockDeny.response = Response.json({ error: 'Not on this job' }, { status: 403 })
    const res = await POST(req({ invoiceId: INV, invoiceHtml: HTML }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Not on this job')
    expect(denyJob).toHaveBeenCalledWith(expect.anything(), mockState.auth, JOB)
    expect(mockZip.calls).toHaveLength(0)
  })

  test('missing invoiceId → 400', async () => {
    const res = await POST(req({ invoiceHtml: HTML }))
    expect(res.status).toBe(400)
    expect(mockZip.calls).toHaveLength(0)
  })

  test.each([
    ['missing', {}],
    ['blank', { invoiceHtml: '   \n ' }],
    ['non-string', { invoiceHtml: { html: HTML } }],
    ['null', { invoiceHtml: null }],
  ])('%s invoiceHtml → 400, no ZIP', async (_, extra) => {
    const res = await POST(req({ invoiceId: INV, ...extra }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invoiceHtml required/)
    expect(mockZip.calls).toHaveLength(0)
  })

  test('unknown invoice → 404', async () => {
    const res = await POST(req({ invoiceId: 'nope', invoiceHtml: HTML }))
    expect(res.status).toBe(404)
    expect(mockZip.calls).toHaveLength(0)
  })

  test('happy path: every line indexed, NO RECEIPT line kept, owner-facing README', async () => {
    const res = await POST(req({ invoiceId: INV, invoiceHtml: HTML }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Reimb_RI_2026_001.zip"')

    const names = files().map(f => f.name)
    expect(names).toEqual(expect.arrayContaining(['README.txt', 'Invoice.html', 'INDEX.txt']))
    expect(text('Invoice.html')).toBe(HTML)

    const receipts = names.filter(n => n.startsWith('Receipts/'))
    expect(receipts).toEqual(['Receipts/01_2026-03-15_Home_Depot_123.45.pdf'])
    expect(receipts[0]).not.toContain('$')
    expect(file(receipts[0]).data.toString('utf8')).toBe('%PDF-receipt-bytes')

    const index = text('INDEX.txt')
    const rows = index.split('\n')
    const row1 = rows.find(l => /^01\s/.test(l))
    const row2 = rows.find(l => /^02\s/.test(l))
    expect(row1).toContain('2026-03-15')
    expect(row1).toContain('Home Depot')
    expect(row1).toContain('123.45')
    expect(row1).toContain('Receipts/01_2026-03-15_Home_Depot_123.45.pdf')
    expect(row2).toContain('2026-03-20')
    expect(row2).toContain('Waste Co.')
    expect(row2).toContain('400.00')
    expect(row2).toContain('NO RECEIPT')

    const readme = text('README.txt')
    expect(readme).not.toMatch(/confidential|internal document|do not distribute/i)
    expect(readme).toContain('Invoice.html')
    expect(readme).toContain('INDEX.txt')
    expect(readme).toMatch(/Receipts\/\s+—\s+1 receipt file/)
    expect(readme).not.toMatch(/2 receipt file/)
  })

  test('line with no direct cost at all and missing date/vendor still listed', async () => {
    seedInvoice([
      { id: 'l1', sort_order: 0, description: 'Misc', direct_cost_id: null, expense_date: null, vendor: null, billed_amount: 10, direct_costs: null },
      { ...LINE_RECEIPT, id: 'l2', sort_order: 1, expense_date: null, vendor: '  ' },
    ])
    mockState.files['receipts/job-0001/abc123.PDF'] = Buffer.from('x')
    const res = await POST(req({ invoiceId: INV, invoiceHtml: HTML }))
    expect(res.status).toBe(200)
    expect(files().map(f => f.name)).toContain('Receipts/02_nodate_novendor_123.45.pdf')
    expect(text('INDEX.txt').split('\n').find(l => /^01\s/.test(l))).toContain('NO RECEIPT')
  })

  test('equal sort_order falls back to id order; same receipt on two lines gets distinct names', async () => {
    seedInvoice([
      { ...LINE_RECEIPT, id: 'l2', sort_order: 0, billed_amount: 2 },
      { ...LINE_RECEIPT, id: 'l1', sort_order: 0, billed_amount: 1 },
    ])
    mockState.files['receipts/job-0001/abc123.PDF'] = Buffer.from('x')
    const res = await POST(req({ invoiceId: INV, invoiceHtml: HTML }))
    expect(res.status).toBe(200)
    const receipts = files().map(f => f.name).filter(n => n.startsWith('Receipts/'))
    expect(receipts).toEqual(['Receipts/01_2026-03-15_Home_Depot_1.00.pdf', 'Receipts/02_2026-03-15_Home_Depot_2.00.pdf'])
  })

  test('linked receipt that fails to download → 422, no ZIP', async () => {
    delete mockState.files['receipts/job-0001/abc123.PDF']
    const res = await POST(req({ invoiceId: INV, invoiceHtml: HTML }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/Export aborted/)
    expect(mockZip.calls).toHaveLength(0)
  })

  test('successful ZIP always contains Invoice.html when invoiceHtml was sent', async () => {
    seedInvoice([LINE_NONE])
    const res = await POST(req({ invoiceId: INV, invoiceHtml: HTML }))
    expect(res.status).toBe(200)
    expect(text('Invoice.html')).toBe(HTML)
    expect(files().filter(f => f.name.startsWith('Receipts/'))).toHaveLength(0)
    expect(text('README.txt')).toMatch(/0 receipt file/)
  })
})

describe('jobdetail reimb export (page source)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/jobdetail/page.js'), 'utf8')
  const fnBody = name => {
    const start = src.search(new RegExp(`(async )?function ${name}\\(inv\\) \\{`))
    expect(start).toBeGreaterThan(-1)
    const rest = src.slice(start)
    const next = rest.slice(1).search(/\n {10}(async )?function |\n {10}return \(/)
    return rest.slice(0, next + 1)
  }

  test('buildReimbInvoiceHtml holds the invoice markup and never opens a window', () => {
    const b = fnBody('buildReimbInvoiceHtml')
    expect(b).toContain('Reimbursement Invoice')
    expect(b).toContain('Bill To')
    expect(b).toContain('<!DOCTYPE html>')
    expect(b).not.toContain('window.open')
  })

  test('generateReimbPDF still opens the print tab using the helper', () => {
    const b = fnBody('generateReimbPDF')
    expect(b).toContain('buildReimbInvoiceHtml(inv)')
    expect(b).toContain("window.open('', '_blank')")
    expect(b).toContain('Allow popups to generate PDF.')
    expect(b).not.toMatch(/window\.confirm/)
  })

  test('exportReimbZip needs no popup and warns about missing receipts', () => {
    const b = fnBody('exportReimbZip')
    expect(b).not.toContain('window.open')
    expect(b).not.toContain('generateReimbPDF(')
    expect(b).toContain('buildReimbInvoiceHtml(inv)')
    expect(b).toContain('window.confirm')
    expect(b).toMatch(/receipt/i)
    expect(b).toContain('NO RECEIPT')
    expect(b).toContain('directCosts')
    expect(b).toMatch(/if \(!ok\) return/)
    expect(b.indexOf('window.confirm')).toBeLessThan(b.indexOf("fetch('/api/owner-reimb-export'"))
    expect(b).toContain('invoiceHtml: invHtml')
    expect(b).toContain('setReimbErr')
  })

  test('export buttons still call the two functions', () => {
    expect(src).toContain('onClick={() => generateReimbPDF(inv)}>Export PDF</button>')
    expect(src).toContain('onClick={() => exportReimbZip(inv)}>Export ZIP + Receipts</button>')
  })

  // M1: Invoice.html / on-screen rows must follow the route's INDEX.txt order.
  const fnSrc = (name, arg) => {
    const start = src.indexOf(`function ${name}(${arg}) {`)
    expect(start).toBeGreaterThan(-1)
    const rest = src.slice(start)
    const next = rest.slice(1).search(/\n {10}(async )?function |\n {10}return \(/)
    return rest.slice(0, next + 1)
  }
  const load = () => new Function('esc', 'fmtC', 'fmtD', 'job',
    `${fnSrc('sortReimbInvoiceLines', 'arr')}\n${fnSrc('buildReimbInvoiceHtml', 'inv')}\n` +
    'return { sortReimbInvoiceLines, buildReimbInvoiceHtml }',
  )(v => String(v ?? ''), v => Number(v || 0).toFixed(2), v => String(v ?? ''), { project_name: 'P', job_number: 1 })
  const OUT_OF_ORDER = () => [
    { id: 'lp', sort_order: 1, description: 'Porta potty', billed_amount: 100, expense_amount: 100 },
    { id: 'lm', sort_order: 2, description: 'Misc', billed_amount: 10, expense_amount: 10 },
    { id: 'lr', sort_order: 0, description: 'Rebar & ties', billed_amount: 50, expense_amount: 50 },
  ]

  test('sortReimbInvoiceLines matches the export route order and does not mutate', () => {
    const { sortReimbInvoiceLines } = load()
    const orig = OUT_OF_ORDER()
    const before = orig.map(l => l.id)
    const sorted = sortReimbInvoiceLines(orig)
    expect(sorted.map(l => l.description)).toEqual(['Rebar & ties', 'Porta potty', 'Misc'])
    expect(orig.map(l => l.id)).toEqual(before)
    expect(sorted).not.toBe(orig)

    expect(sortReimbInvoiceLines([{ id: 'l2', sort_order: 0 }, { id: 'l1', sort_order: 0 }]).map(l => l.id)).toEqual(['l1', 'l2'])
    expect(sortReimbInvoiceLines([{ id: 'a', sort_order: null }, { id: 'b', sort_order: 5 }, { id: 'c' }]).map(l => l.id)).toEqual(['b', 'a', 'c'])
    expect(sortReimbInvoiceLines(undefined)).toEqual([])
  })

  test('buildReimbInvoiceHtml renders rows in sort_order (same as INDEX.txt)', () => {
    const { buildReimbInvoiceHtml } = load()
    const html = buildReimbInvoiceHtml({ invoice_number: 'RI-1', bill_to_name: 'Owner', owner_reimb_invoice_lines: OUT_OF_ORDER(), owner_reimb_payments: [] })
    const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'))
    const descs = [...tbody.matchAll(/<tr>\s*<td[^>]*>[^<]*<\/td>\s*<td>([^<]*)<\/td>/g)].map(m => m[1])
    expect(descs).toEqual(['Rebar & ties', 'Porta potty', 'Misc'])
    expect(html).toContain('160.00') // total unaffected by sort
  })

  test('builder and expanded invoice list both use sortReimbInvoiceLines', () => {
    const b = fnBody('buildReimbInvoiceHtml')
    expect(b).toContain('const lines = sortReimbInvoiceLines(inv.owner_reimb_invoice_lines)')
    expect(b).not.toMatch(/const lines = inv\.owner_reimb_invoice_lines \|\| \[\]/)
    const exp = src.slice(src.indexOf('const isExpanded = expandedInvoiceId'))
    expect(exp.slice(0, 400)).toContain('const lines = sortReimbInvoiceLines(inv.owner_reimb_invoice_lines)')
  })
})
