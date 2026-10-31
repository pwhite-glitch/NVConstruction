import { describe, it, expect } from '@jest/globals'
import { rollupGeneralConditions, GC_ROLLUP_LABEL } from '../lib/gc-rollup'

// G703 rows as generateAIAFromApp computes them (10% retainage)
const row = (id, code, description, scheduled, prevAmt, thisAmt) => {
  const totalAmt = prevAmt + thisAmt
  return {
    budget_item_id: id, cost_code: code, description, scheduled, prevAmt, thisAmt, totalAmt,
    totalPct: scheduled > 0 ? totalAmt / scheduled * 100 : 0,
    isOverbilled: totalAmt > scheduled + 0.01, balance: scheduled - totalAmt, retainage: totalAmt * 0.1,
  }
}

const lines = [
  row('site', '02-000', 'Sitework', 50000, 20000, 10000),
  row('pm', '01-100', 'Project Manager', 12000, 4000, 2000),
  row('conc', '03-000', 'Concrete', 80000, 0, 40000),
  row('car', '01-200', 'Car Expense', 3000, 1000, 500),
  // Braum's-style: final cleaning ran a few hundred over its line
  row('clean', '01-900', 'Final Cleaning', 1500, 0, 1800.55),
]
const gcIds = new Set(['pm', 'car', 'clean'])
const sumOf = (rows, key) => rows.reduce((a, l) => a + l[key], 0)

describe('rollupGeneralConditions', () => {
  it('returns lines untouched when nothing is flagged', () => {
    expect(rollupGeneralConditions(lines, new Set())).toBe(lines)
  })

  it('combines flagged lines into one row where the first one sat, renumbered', () => {
    const out = rollupGeneralConditions(lines, gcIds)
    expect(out.map(l => l.description)).toEqual(['Sitework', GC_ROLLUP_LABEL, 'Concrete'])
    expect(out.map(l => l.idx)).toEqual([1, 2, 3])
    expect(out[1].cost_code).toBe('')
  })

  it('sums every column and recomputes % from the sums', () => {
    const gc = rollupGeneralConditions(lines, gcIds)[1]
    expect(gc.scheduled).toBe(16500)
    expect(gc.prevAmt).toBe(5000)
    expect(gc.thisAmt).toBe(4300.55)
    expect(gc.totalAmt).toBe(9300.55)
    expect(gc.balance).toBe(7199.45)
    expect(gc.retainage).toBe(930.06)
    expect(gc.totalPct).toBeCloseTo(9300.55 / 16500 * 100, 6)
  })

  it('does not flag the combined row when only one GC line is over', () => {
    expect(rollupGeneralConditions(lines, gcIds)[1].isOverbilled).toBe(false)
  })

  it('flags the combined row when GC as a whole is over', () => {
    const over = [row('pm', '01-100', 'Project Manager', 1000, 900, 300)]
    expect(rollupGeneralConditions(over, new Set(['pm']))[0].isOverbilled).toBe(true)
  })

  it('keeps G702 totals identical', () => {
    const out = rollupGeneralConditions(lines, gcIds)
    for (const key of ['scheduled', 'prevAmt', 'thisAmt', 'totalAmt']) {
      expect(sumOf(out, key)).toBeCloseTo(sumOf(lines, key), 2)
    }
    expect(sumOf(out, 'retainage')).toBeCloseTo(sumOf(lines, 'retainage'), 1)
  })
})
