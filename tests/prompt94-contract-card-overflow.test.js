/**
 * Prompt 94 — subcontract card overflow from a long budget tag (Chicken Salad Chick #7555, Fernando Concrete).
 * A budget allocation tag with a long line description didn't wrap, so the card grew past the viewport and
 * pushed the figures and Move to draft / SOV / Gen Contract / Edit / Delete off-screen.
 * Layout/CSS only plus amounts normalized to numbers on save. No DB access.
 */
const fs = require('fs')
const path = require('path')
const L = require('../lib/budget-label')

const src = fs.readFileSync(path.join(__dirname, '..', 'app/jobdetail/page.js'), 'utf8')
function fnBody(decl) {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error('not found: ' + decl)
  let i = src.indexOf(') {', start) + 2, depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}

const LONG = 'Site utilities: storm drain (inlets, JB, RCP) + water tap/service + sanitary sewer lateral, cleanouts, tie-in to city main and restoration'
const item = { id: 'b1', cost_code: '22/33', description: LONG, budget_amount: 50000 }

describe('budget label helper', () => {
  test('budgetLineLabel joins cost code and description', () => {
    expect(L.budgetLineLabel(item)).toBe(`22/33 · ${LONG}`)
    expect(L.budgetLineLabel({ description: 'Paving' })).toBe('Paving')
    expect(L.budgetLineLabel({ cost_code: '03' })).toBe('03')
    expect(L.budgetLineLabel(null)).toBe('')
  })

  test('truncateBudgetLabel caps length with an ellipsis, leaves short text alone', () => {
    const t = L.truncateBudgetLabel(L.budgetLineLabel(item))
    expect(t.length).toBeLessThanOrEqual(80)
    expect(t.endsWith('…')).toBe(true)
    expect(t.startsWith('22/33 · Site utilities')).toBe(true)
    expect(L.truncateBudgetLabel('Concrete', 80)).toBe('Concrete')
    expect(L.truncateBudgetLabel('a   b\n c', 80)).toBe('a b c')
    expect(L.truncateBudgetLabel('abcdefghij', 5)).toBe('abcd…')
  })

  test('budgetTagText keeps the full label (and amount) in the title', () => {
    const tag = L.budgetTagText(item, 4223)
    expect(tag.text.length).toBeLessThanOrEqual(80)
    expect(tag.title).toBe(`22/33 · ${LONG} — $4,223`)
    expect(L.budgetTagText(item).title).toBe(`22/33 · ${LONG}`)
  })

  test('tag styles shrink inside a flex row', () => {
    expect(L.budgetTagStyle.minWidth).toBe(0)
    expect(L.budgetTagStyle.maxWidth).toMatch(/100%/)
    expect(L.budgetTagStyle.maxWidth).toMatch(/420px/)
    expect(L.budgetTagTextStyle).toMatchObject({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
    expect(L.budgetSelectStyle).toMatchObject({ minWidth: 0, maxWidth: '100%' })
  })

  test('normalizeBudgetAllocations: numbers out, invalid rows dropped, budget_item_id kept', () => {
    const out = L.normalizeBudgetAllocations([
      { budget_item_id: 'b1', amount: '4223' },
      { budget_item_id: 'b2', amount: '1500.50', note: 'x' },
      { budget_item_id: '', amount: '10' },
      { budget_item_id: 'b3', amount: '' },
      { budget_item_id: 'b4', amount: 'abc' },
      { budget_item_id: 'b5', amount: 7 },
    ])
    expect(out).toEqual([
      { budget_item_id: 'b1', amount: 4223 },
      { budget_item_id: 'b2', amount: 1500.5, note: 'x' },
      { budget_item_id: 'b5', amount: 7 },
    ])
    out.forEach(a => expect(typeof a.amount).toBe('number'))
    expect(L.normalizeBudgetAllocations(null)).toEqual([])
  })
})

describe('job page source', () => {
  test('contract card allocation tags use the shrinkable tag style + title', () => {
    const start = src.indexOf('const allocations = (c.budget_allocations || []).filter(a => a.budget_item_id)')
    const card = src.slice(start, src.indexOf('{isDraft && !isEditing && (', start))
    expect(card).toMatch(/title=\{tag\.title\}[^>]*\.\.\.budgetTagStyle/)
    expect(card).toContain('<span style={budgetTagTextStyle}>{tag.text}</span>')
    expect(card).toMatch(/title=\{budgetLineLabel\(budgetLine\)\}/)
    expect(card).not.toMatch(/padding: '2px 8px', whiteSpace: 'nowrap'/)
    // tag row, figures row and actions row wrap and can shrink
    expect(card).toMatch(/flex: '1 1 260px', flexWrap: 'wrap', minWidth: 0, maxWidth: '100%'/)
    expect(card).toMatch(/gap: '10px 20px', flexWrap: 'wrap'[^}]*minWidth: 0, maxWidth: '100%'/)
    expect(card).toMatch(/gap: '6px', flexWrap: 'wrap', alignItems: 'center', minWidth: 0, maxWidth: '100%'/)
  })

  test('card container and header never exceed the container', () => {
    expect(src).toMatch(/contractRow: \{[^}]*minWidth: 0, maxWidth: '100%'/)
    expect(src).toMatch(/contractRowHeader: \{[^}]*flexWrap: 'wrap'[^}]*minWidth: 0/)
  })

  test('new/edit contract allocation rows: grid column and select can shrink', () => {
    const rows = src.match(/gridTemplateColumns: 'minmax\(0, 1fr\) minmax\(90px, 130px\) 28px'/g) || []
    expect(rows.length).toBe(2)
    const selects = src.match(/<select style=\{\{ \.\.\.s\.input, \.\.\.budgetSelectStyle/g) || []
    expect(selects.length).toBe(3)
  })

  test('PO card budget tag truncates with a title', () => {
    expect(src).toContain('{bi && <span title={budgetLineLabel(bi)} style={{ ...budgetTagStyle')
  })

  test('both save paths normalize allocation amounts to numbers', () => {
    for (const decl of ['async function addContract(', 'async function updateContract(']) {
      const body = fnBody(decl)
      expect(body).toMatch(/const validAllocs = normalizeBudgetAllocations\((editC|c)ontractForm\.budget_allocations\)/)
      expect(body).toContain('budget_allocations: validAllocs.length > 0 ? validAllocs : null')
      expect(body).toContain('const singleBudgetId = validAllocs.length === 1 ? validAllocs[0].budget_item_id')
    }
  })
})
