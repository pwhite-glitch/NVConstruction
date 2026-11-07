/**
 * Stable stored PCO- / SCO- numbers (prompt 49, item 1).
 *
 * Incident: CO numbers were derived from list position (job page Print / Send used the
 * index in the on-screen list, the owner portal used i + 1), so rejecting, filtering,
 * sorting or deleting a CO renumbered the others. Numbers are now stored on the row by the
 * database (migration 045, PROPOSED), immutable, never reused; unnumbered rows show a
 * stable "Legacy CO <id suffix>" label instead of a made-up number.
 */
import fs from 'fs'
import path from 'path'
import { coNumberLabel, legacyCoSuffix, hasStoredCoNumber, coNumberMissingMessage, coDeleteBlock, coDbErrorMessage } from '../lib/co-number'

const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

describe('coNumberLabel', () => {
  test('uses the stored number with the right prefix', () => {
    expect(coNumberLabel({ id: 'a', co_number: 7 }, 'prime')).toBe('PCO-007')
    expect(coNumberLabel({ id: 'a', co_number: 12 }, 'sub')).toBe('SCO-012')
    expect(coNumberLabel({ id: 'a', co_number: 1234 }, 'prime')).toBe('PCO-1234')
  })

  test('unnumbered (legacy) rows get a stable label from their id, never a PCO number', () => {
    const co = { id: '8ae26b84-c4df-4a75-a466-48ee7bed9f0c' }
    expect(legacyCoSuffix(co.id)).toBe('ED9F0C')
    expect(coNumberLabel(co, 'prime')).toBe('Legacy CO ED9F0C')
    expect(coNumberLabel(co, 'prime')).toMatch(/^Legacy CO [0-9A-F]{6}$/)
    expect(coNumberLabel(co, 'prime')).not.toMatch(/PCO/)
    expect(coNumberLabel(co)).toBe(coNumberLabel({ ...co }))
  })

  test('reject / filter / sort never renumber: the label depends only on the row', () => {
    const cos = [
      { id: 'c1', co_number: 1, status: 'approved' },
      { id: 'c2', co_number: 2, status: 'rejected' },
      { id: 'c3', co_number: 3, status: 'pending' },
      { id: 'legacy-aaaaaa', status: 'approved' },
    ]
    const labels = new Map(cos.map(c => [c.id, coNumberLabel(c)]))
    const shown = cos.filter(c => c.status !== 'rejected').reverse()
    for (const c of shown) expect(coNumberLabel(c)).toBe(labels.get(c.id))
    const rejected = { ...cos[2], status: 'rejected' }
    expect(coNumberLabel(rejected)).toBe('PCO-003')
    const sorted = [...cos].sort((a, b) => String(b.id).localeCompare(String(a.id)))
    for (const c of sorted) expect(coNumberLabel(c)).toBe(labels.get(c.id))
  })

  test('bad stored values are treated as unnumbered, not printed', () => {
    expect(hasStoredCoNumber({ co_number: 0 })).toBe(false)
    expect(hasStoredCoNumber({ co_number: -1 })).toBe(false)
    expect(hasStoredCoNumber({ co_number: 'x' })).toBe(false)
    expect(hasStoredCoNumber({ co_number: null })).toBe(false)
    expect(hasStoredCoNumber({ co_number: '4' })).toBe(true)
  })
})

describe('without the deployed column the app says so (no list-position fallback)', () => {
  test('column missing on the returned row → names migration 045', () => {
    const msg = coNumberMissingMessage({ id: 'abc123', description: 'x' })
    expect(msg).toMatch(/migration 045/)
    expect(msg).toMatch(/Legacy CO ABC123/)
    expect(msg).toMatch(/No number was guessed/)
  })
  test('column present but null → still flagged', () => {
    expect(coNumberMissingMessage({ id: 'abc123', co_number: null })).toMatch(/did not assign/)
  })
  test('numbered row → no message', () => {
    expect(coNumberMissingMessage({ id: 'a', co_number: 3 })).toBeNull()
  })
})

describe('numbers are never reused', () => {
  test('a numbered CO cannot be deleted (reject instead); legacy rows still can', () => {
    expect(coDeleteBlock({ id: 'a', co_number: 5 })).toMatch(/PCO-005.*can't be deleted.*Reject/)
    expect(coDeleteBlock({ id: 'a', subcontract_id: 's', co_number: 2 })).toMatch(/SCO-002/)
    expect(coDeleteBlock({ id: 'legacy' })).toBeNull()
  })

  // Model of the 045 allocation: max(stored)+1 per scope; deletes of numbered rows refused.
  test('deleting the latest number cannot free it for the next CO', () => {
    const rows = [{ id: 'a', job_id: 'J', co_number: 1 }, { id: 'b', job_id: 'J', co_number: 2 }]
    const alloc = job => rows.filter(r => r.job_id === job).reduce((m, r) => Math.max(m, r.co_number || 0), 0) + 1
    const tryDelete = id => { const r = rows.find(x => x.id === id); if (coDeleteBlock(r)) return false; rows.splice(rows.indexOf(r), 1); return true }
    expect(tryDelete('b')).toBe(false)
    expect(alloc('J')).toBe(3)
  })

  test('trigger errors are shown in words', () => {
    expect(coDbErrorMessage('ERROR: co_numbered_no_delete: PCO-002 ...')).toMatch(/Reject it instead/)
    expect(coDbErrorMessage('co_number_immutable: ...')).toMatch(/can’t be changed/)
  })
})

describe('every surface uses the stored identifier', () => {
  test('job page: no CO number derived from list position', () => {
    const src = read('app/jobdetail/page.js')
    expect(src).not.toMatch(/findIndex\(c => c\.id === co\.id\) \+ 1/)
    expect(src).not.toMatch(/allCOs\.length - coIdx/)
    expect(src).not.toMatch(/`PCO-\$\{String\(coNum/)
    expect(src).not.toMatch(/`SCO-\$\{String\(coNum/)
    expect(src).toMatch(/coNumberLabel\(co, 'prime'\)/)
    expect(src).toMatch(/coNumberLabel\(co, 'sub'\)/)
  })
  test('owner portal: no i + 1 numbering, uses the stored label', () => {
    const src = read('app/owner/page.js')
    expect(src).not.toMatch(/co_number: i \+ 1/)
    expect(src).toMatch(/coNumberLabel\(co, 'prime'\)/)
  })
  test('residential page shows the stored label', () => {
    expect(read('app/residentialjobdetail/page.js')).toMatch(/coNumberLabel\(co, 'prime'\)/)
  })
  test('no create path sends a co_number from the browser or a route', () => {
    for (const f of ['app/jobdetail/page.js', 'app/residentialjobdetail/page.js', 'app/api/sub-co-request/route.js']) {
      expect(read(f)).not.toMatch(/co_number\s*:/)
    }
  })
})
