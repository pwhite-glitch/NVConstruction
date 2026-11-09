/**
 * Prompt 67A #3: a 0% retainage stays 0% (Bid Leveling subcontract save + PDF, G702 label).
 */
const fs = require('fs')
const path = require('path')
const { retainagePctOrDefault } = require('../lib/retainage-pct')

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
// Body of a top-level-in-component function: from its declaration to the next one.
function fnBody(src, decl) {
  const i = src.indexOf(decl)
  if (i < 0) throw new Error(`not found: ${decl}`)
  const rest = src.slice(i + decl.length)
  const m = rest.search(/\n  (async )?function \w+\(/)
  return decl + (m < 0 ? rest : rest.slice(0, m))
}

describe('retainagePctOrDefault', () => {
  test.each([
    ['0', 0], [0, 0], ['', 10], [null, 10], [undefined, 10], ['abc', 10],
    ['5.5', 5.5], ['150', 100], ['-3', 0], ['10', 10],
  ])('%p → %p', (v, want) => {
    expect(retainagePctOrDefault(v)).toBe(want)
  })
  test('custom default', () => {
    expect(retainagePctOrDefault('', 5)).toBe(5)
    expect(retainagePctOrDefault('0', 5)).toBe(0)
  })
})

describe('page source', () => {
  const dash = read('app/dashboard/page.js')
  const job = read('app/jobdetail/page.js')

  test('dashboard saveSubcontract keeps a typed 0', () => {
    const body = fnBody(dash, 'async function saveSubcontract(')
    expect(body).not.toContain('retainage_pct) || 10')
    expect(body).toContain('retainage_pct: retainagePctOrDefault(subcontractForm.retainage_pct)')
  })

  test('dashboard generateSubcontractPDF prints a typed 0', () => {
    const body = fnBody(dash, 'async function generateSubcontractPDF(')
    expect(body).not.toContain('retainage_pct) || 10')
    expect(body).toContain('retainagePctOrDefault(formData.retainage_pct)')
  })

  test('generateAIAFromApp prints the rate the math uses', () => {
    const body = fnBody(job, 'function generateAIAFromApp(')
    expect(body).not.toContain('app.retainage_pct || 10')
    // math unchanged
    expect(body).toContain('const retPct = Math.max(0, Math.min(100, isNaN(parseFloat(app.retainage_pct)) ? 10 : parseFloat(app.retainage_pct))) / 100')
    expect(body).toContain('const retPctLabel = +(retPct * 100).toFixed(2)')
    expect(body).toContain('Retainage: ${retPctLabel}%</div>')
    expect(body).toContain('Retainage: ${retPctLabel}% of Completed Work (Column I of G703)')
    // The label for a 0% release is 0, not 10
    const retPct = Math.max(0, Math.min(100, isNaN(parseFloat(0)) ? 10 : parseFloat(0))) / 100
    expect(+(retPct * 100).toFixed(2)).toBe(0)
  })

  test("job page's own contract form still uses || 0 (untouched)", () => {
    expect(job).toContain('retainage_pct: parseFloat(contractForm.retainage_pct) || 0')
  })
})
