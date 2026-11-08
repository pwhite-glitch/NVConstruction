/**
 * Prompt 50 items 5, 10, 13: every residential print escapes dynamic text and
 * attributes; URLs are checked separately. Builders return strings only.
 */
import fs from 'fs'
import path from 'path'
import { buildDrawPackageHtml, buildOwnerDrawHtml, buildChangeOrderHtml, buildBillingWaiverHtml, buildCompletionReportHtml, safeImageSrc } from '../lib/residential-print'
import { buildDrawSchedule } from '../lib/owner-draws'
import { coNumberLabel } from '../lib/co-number'

const EVIL = '<img src=x onerror="alert(document.cookie)">'
const job = { job_number: 'R-101', project_name: `NoLo ${EVIL}`, location: 'Lot 2 & "Blk 4"', owner_name: `O'Brien ${EVIL}`, owner_company: 'Bank & Trust' }
// No raw hostile tag anywhere; only the builders' own static markup
const noRaw = html => {
  expect(html).not.toContain('<img src=x')
  expect(html).not.toMatch(/onerror="alert/)
  expect(html).not.toContain('<script>alert')
}

describe('draw package print (item 5 — sub-typed text)', () => {
  const html = buildDrawPackageHtml({
    job, draw: { draw_number: 3, title: `Draw ${EVIL}` },
    costs: [{ description: `Lumber ${EVIL}`, amount: 100, cost_date: '2026-11-02' }, { description: 'Return', amount: 20, is_credit: true }],
    billings: [{ company_name: `ACME "&" ${EVIL}`, work_description: '</td><script>alert(1)</script>', amount_billed: 50, status: 'approved' }], // approved: only approved billings are in the totals (prompt61)
    logoUrl: 'javascript:alert(1)',
  })
  test('hostile text renders literally; quotes/ampersands escaped', () => {
    noRaw(html)
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(document.cookie)&quot;&gt;')
    expect(html).toContain('ACME &quot;&amp;&quot;')
    expect(html).toContain('&lt;/td&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Lot 2 &amp; &quot;Blk 4&quot;')
  })
  test('javascript: logo dropped; totals net credits and stay readable', () => {
    expect(html).not.toContain('javascript:')
    expect(html).toContain('Draw #003')
    expect(html).toContain('$80.00')
    expect(html).toContain('$130.00')
  })
  test('the residential page no longer builds print HTML inline', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app/residentialjobdetail/page.js'), 'utf8')
    expect(src).not.toContain('document.write(html)')
    expect(src).toContain('buildDrawPackageHtml({')
  })
})

describe('lender draw sheet (item 10)', () => {
  test('escaped schedule rows, legacy funded shown as unknown, signature lines', () => {
    const schedule = buildDrawSchedule([{ id: 'b1', description: `Frame ${EVIL}`, owner_amount: 1000 }], { b1: 200 }, { b1: 300 })
    const html = buildOwnerDrawHtml({ job, draw: { draw_number: 2, title: 'Draw 2', status: 'funded', amount_requested: 300, amount_funded: null, notes: EVIL }, schedule, revised: 1000 })
    noRaw(html)
    expect(html).toContain('Funded — amount received not recorded')
    expect(html).toContain('$500.00') // total to date
    expect(html).toContain('Owner / Lender · Date')
  })
})

describe('homeowner change order print (item 13)', () => {
  test('stable label, base + approved convention, signature lines, escaped', () => {
    const co = { id: '0f3a-11aa-bbcc-ddeeff001122', co_number: 4, description: `Add deck ${EVIL}`, amount: 2500, status: 'pending', notes: 'a & b' }
    const label = coNumberLabel(co, 'prime')
    const html = buildChangeOrderHtml({ job, co, coLabel: label, baseContract: 100000, approvedBefore: 5000 })
    noRaw(html)
    expect(html).toContain(`Change Order ${label}`)
    expect(html).toContain('$100,000.00') // original
    expect(html).toContain('$105,000.00') // prior to this CO
    expect(html).toContain('$107,500.00') // including this CO
    expect(html).toContain('Homeowner signature · Date')
    expect(html).toContain('Contractor — NV Construction · Date')
    expect(html).not.toContain('window.onload') // no auto print
  })
  test('printing changes nothing: printCO only builds and opens HTML', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app/residentialjobdetail/page.js'), 'utf8')
    const body = src.slice(src.indexOf('  function printCO(co) {'), src.indexOf('  async function addSub(e) {'))
    expect(body).not.toMatch(/supabase|budget-items|fetch\(/)
  })
})

describe('waiver view and completion report', () => {
  test('signature image must be a png/jpeg data URL or https; hostile src dropped', () => {
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(safeImageSrc('javascript:alert(1)')).toBe('')
    expect(safeImageSrc('data:text/html;base64,PHNjcmlwdD4=')).toBe('')
    expect(safeImageSrc('http://evil.example/x.png')).toBe('')
    const html = buildBillingWaiverHtml({ billing: { company_name: EVIL, lien_waiver_signer_name: EVIL, lien_waiver_signature: 'x" onerror="alert(1)', lien_waiver_signed_at: '2026-11-01T10:00:00Z', amount_billed: 10 }, job })
    noRaw(html)
    expect(html).not.toContain('onerror="alert(1)')
  })
  test('completion report shows unknown funding honestly', () => {
    const html = buildCompletionReportHtml({ job, s: { baseContract: 1, approvedCOs: 0, revised: 1, bankTotal: null, costBudget: null, committed: 0, approvedDc: 0, approvedBilling: 0, requested: 0, fundedKnown: 0, unknownFunded: 2 } })
    noRaw(html)
    expect(html).toContain('2 funded draw(s) have no recorded amount')
  })
})
