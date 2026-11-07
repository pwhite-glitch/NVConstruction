/**
 * Finding 13: shared job-number suggestion + duplicate warning for every
 * new-job screen, and the minimal staff-only inventory endpoint behind it.
 */
const fs = require('fs')
const path = require('path')

let mockAuth
let mockJobs
let mockRangeCalls
let mockSelectCols
let mockError

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q = {
        select: cols => { mockSelectCols = cols; return q },
        order: () => q,
        range: (a, b) => {
          mockRangeCalls.push([a, b])
          if (mockError) return Promise.resolve({ data: null, error: mockError })
          return Promise.resolve({ data: mockJobs.slice(a, b + 1), error: null })
        },
      }
      return q
    },
  }),
}))
jest.mock('../lib/server-auth', () => ({ requireAuth: async () => mockAuth }))

// Minimal React stand-ins so useJobNumbers can run outside a renderer.
jest.mock('react', () => ({
  useState: init => [init, () => {}],
  useRef: init => ({ current: init }),
  useCallback: fn => fn,
}))

const {
  parseJobNumber, seriesPrefixFor, suggestNextJobNumber, countDuplicateJobNumbers,
  jobNumberWarning, applyJobNumberSuggestion, jobNumberSaveError, JOB_NUMBER_ROLES,
} = require('../lib/job-numbers')
const { confirmJobNumberFree, fetchJobNumbers, useJobNumbers } = require('../lib/use-job-numbers')
const route = require('../app/api/jobs/numbers/route')

const C = n => ({ job_number: n, job_type: 'commercial' })
const R = n => ({ job_number: n, job_type: 'residential' })
const req = () => new Request('http://x/api/jobs/numbers')

beforeEach(() => {
  mockAuth = { userId: 'u1', role: 'pm', error: null }
  mockJobs = []
  mockRangeCalls = []
  mockSelectCols = null
  mockError = null
})

describe('parseJobNumber / series', () => {
  test('plain, letter-prefixed and year-prefixed numbers parse; others do not', () => {
    expect(parseJobNumber('7469')).toMatchObject({ prefix: '', n: 7469 })
    expect(parseJobNumber(' r-101 ')).toMatchObject({ prefix: 'R-', rawPrefix: 'r-', n: 101 })
    expect(parseJobNumber('2026-042')).toMatchObject({ prefix: '2026-', digits: '042', n: 42 })
    expect(parseJobNumber(7469)).toMatchObject({ n: 7469 })
    for (const bad of ['', '  ', null, undefined, '7469A', '12-34-56', 'abc', 'R-', '74.5', 'ABCDE-1']) expect(parseJobNumber(bad)).toBeNull()
  })

  test('unrelated prefixes are not concatenated into one integer', () => {
    expect(suggestNextJobNumber([C('12-34'), C('100')], 'commercial')).toBe('101')
  })
})

describe('suggestNextJobNumber', () => {
  test('numeric, not lexicographic: 9 and 10 -> 11', () => {
    expect(suggestNextJobNumber([C('9'), C('10'), C('2')], 'commercial')).toBe('11')
  })

  test('numeric strings and numbers both count; completed/archived numbers are in the inventory', () => {
    expect(suggestNextJobNumber([C(7469), C('7470'), { job_number: '7480', job_type: 'commercial', status: 'completed', archived: true }])).toBe('7481')
  })

  test('empty inventory or empty series gives no suggestion', () => {
    expect(suggestNextJobNumber([], 'commercial')).toBe('')
    expect(suggestNextJobNumber(null, 'residential')).toBe('')
    expect(suggestNextJobNumber([C('abc'), C('')], 'commercial')).toBe('')
    // Residential defaults to the R- series; commercial plain numbers are not borrowed.
    expect(suggestNextJobNumber([C('7469')], 'residential')).toBe('')
  })

  test('blank / non-numeric values are ignored', () => {
    expect(suggestNextJobNumber([C(''), C(null), C('TBD'), C('7469A'), C('15')])).toBe('16')
  })

  test('residential R- series keeps prefix; max across all job types', () => {
    expect(suggestNextJobNumber([R('R-101'), R('R-109'), R('R-99'), C('7469')], 'residential')).toBe('R-110')
    // A commercial job that happens to use R-120 still blocks R-110..R-120 reuse.
    expect(suggestNextJobNumber([R('R-101'), C('R-120')], 'residential')).toBe('R-121')
  })

  test('zero padding preserved in a year series and widened on rollover', () => {
    expect(suggestNextJobNumber([C('2026-041'), C('2026-042')])).toBe('2026-043')
    expect(suggestNextJobNumber([C('2026-099'), C('2026-007')])).toBe('2026-100')
    expect(suggestNextJobNumber([C('007')])).toBe('008')
  })

  test('series follows what existing jobs of that type mostly use', () => {
    expect(seriesPrefixFor([R('101'), R('102'), R('R-5')], 'residential')).toBe('')
    expect(suggestNextJobNumber([R('101'), R('102'), R('R-5')], 'residential')).toBe('103')
    expect(seriesPrefixFor([C('2025-010'), C('2026-003'), C('7469')], 'commercial')).toBe('2026-')
    expect(suggestNextJobNumber([C('2025-010'), C('2026-003'), C('7469')], 'commercial')).toBe('2026-004')
    // A tie prefers the type default.
    expect(seriesPrefixFor([R('101'), R('R-5')], 'residential')).toBe('R-')
  })
})

describe('duplicates', () => {
  test('exact (case/space-insensitive) and same-series integer matches', () => {
    const jobs = [C('7469'), R('R-101'), C('2026-042'), C('TBD')]
    expect(countDuplicateJobNumbers(jobs, ' 7469 ')).toBe(1)
    expect(countDuplicateJobNumbers(jobs, 'r-101')).toBe(1)
    expect(countDuplicateJobNumbers(jobs, '2026-42')).toBe(1)
    expect(countDuplicateJobNumbers(jobs, 'tbd')).toBe(1)
    expect(countDuplicateJobNumbers(jobs, '7470')).toBe(0)
    expect(countDuplicateJobNumbers(jobs, 'R101')).toBe(0)
    expect(countDuplicateJobNumbers(jobs, '')).toBe(0)
  })

  test('warning text appears for an edited number that exists, not for the suggestion', () => {
    const jobs = [C('9'), C('10')]
    expect(jobNumberWarning(jobs, suggestNextJobNumber(jobs))).toBe('')
    expect(jobNumberWarning(jobs, '10')).toMatch(/already used/)
    expect(jobNumberWarning(null, '10')).toBe('')
  })
})

describe('applyJobNumberSuggestion (never overwrite typing)', () => {
  test('fills blank, replaces untouched old suggestion, keeps typed value', () => {
    expect(applyJobNumberSuggestion('', undefined, '7470')).toBe('7470')
    expect(applyJobNumberSuggestion('7470', '7470', '7471')).toBe('7471')
    expect(applyJobNumberSuggestion('8000', '7470', '7471')).toBe('8000')
    expect(applyJobNumberSuggestion('80', undefined, '7470')).toBe('80')
    expect(applyJobNumberSuggestion('', '7470', '')).toBe('')
  })

  test('useJobNumbers.seed: a late lookup does not overwrite what the user typed', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ jobs: [C('9'), C('10')] }) }))
    const jn = useJobNumbers()
    let form = { job_number: '', start_date: '' }
    const setForm = fn => { form = typeof fn === 'function' ? fn(form) : fn }
    const pending = jn.seed('k', 'commercial', setForm)
    form = { ...form, job_number: '5555' } // typed before the lookup returned
    await pending
    expect(form.job_number).toBe('5555')

    form = { job_number: '' }
    await jn.seed('k2', 'commercial', setForm)
    expect(form.job_number).toBe('11')
  })

  test('useJobNumbers.seed: a failed lookup leaves the field alone', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }))
    const jn = useJobNumbers()
    let form = { job_number: '' }
    await jn.seed('k', 'commercial', fn => { form = fn(form) })
    expect(form.job_number).toBe('')
  })
})

describe('save-time recheck', () => {
  test('free number proceeds without asking', async () => {
    const confirm = jest.fn()
    expect(await confirmJobNumberFree('11', { load: async () => [C('9'), C('10')], confirm })).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  test('number taken since the form opened (another tab) asks; cancel stops the save', async () => {
    const confirm = jest.fn(() => false)
    expect(await confirmJobNumberFree('11', { load: async () => [C('10'), C('11')], confirm })).toBe(false)
    expect(confirm.mock.calls[0][0]).toMatch(/11 is already used/)
    expect(await confirmJobNumberFree('11', { load: async () => [C('11')], confirm: () => true })).toBe(true)
  })

  test('blank never proceeds; recheck failure leaves the DB as authority', async () => {
    expect(await confirmJobNumberFree('  ', { load: async () => [] })).toBe(false)
    expect(await confirmJobNumberFree('12', { load: async () => { throw new Error('offline') }, confirm: jest.fn() })).toBe(true)
  })

  test('server duplicate errors read clearly; other errors pass through', () => {
    expect(jobNumberSaveError({ code: '23505', message: 'duplicate key value violates unique constraint "jobs_job_number_key"' }, ' 7469 ')).toBe('Job number 7469 already exists. Choose a different number.')
    expect(jobNumberSaveError({ message: 'permission denied' }, '1')).toBe('permission denied')
  })

  test('fetchJobNumbers rejects on HTTP error or a malformed body', async () => {
    await expect(fetchJobNumbers(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }))).rejects.toThrow('Forbidden')
    await expect(fetchJobNumbers(async () => ({ ok: true, status: 200, json: async () => ({}) }))).rejects.toThrow()
  })
})

describe('GET /api/jobs/numbers', () => {
  test.each(['super', 'owner', 'subcontractor', 'sub_admin', null])('%s is refused', async role => {
    mockAuth = { userId: 'u1', role, error: null }
    mockJobs = [C('1')]
    const res = await route.GET(req())
    expect(res.status).toBe(403)
    expect(mockRangeCalls).toEqual([])
  })

  test('unauthenticated is refused', async () => {
    mockAuth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
    expect((await route.GET(req())).status).toBe(401)
  })

  test.each([...JOB_NUMBER_ROLES])('%s gets only distinct number/type pairs, every status, past 1000 rows', async role => {
    mockAuth = { userId: 'u1', role, error: null }
    mockJobs = Array.from({ length: 2300 }, (_, i) => ({
      id: `j${i}`, job_number: String(i + 1), job_type: i % 7 === 0 ? 'residential' : null,
      project_name: 'Secret', contract_value: 999, status: i % 3 ? 'active' : 'completed', archived: i % 5 === 0,
    }))
    mockJobs.push({ id: 'dup', job_number: ' 5 ', job_type: 'commercial' }, { id: 'blank', job_number: '  ', job_type: null })
    const res = await route.GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(mockRangeCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(mockSelectCols).toBe('id, job_number, job_type')
    expect(body.jobs.length).toBe(2300)
    for (const j of body.jobs) expect(Object.keys(j).sort()).toEqual(['job_number', 'job_type'])
    expect(body.jobs.find(j => j.job_number === '2300')).toBeTruthy()
    expect(suggestNextJobNumber(body.jobs, 'commercial')).toBe('2301')
  })

  test('DB error fails instead of returning a partial list', async () => {
    mockError = { message: 'db down' }
    const res = await route.GET(req())
    expect(res.status).toBe(500)
  })
})

describe('all six new-job surfaces use the shared helper', () => {
  const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const dash = src('app/dashboard/page.js')
  const ws = src('app/components/estimating/EstimateWorkspace.js')
  const bid = src('app/bid/[id]/page.js')

  test('dashboard: new commercial, new residential, bid create, legacy estimate convert', () => {
    for (const [key, type, setter] of [['newJob', 'commercial', 'setNewJob'], ['newResJob', 'residential', 'setNewResJob'], ['createJobFromBid', 'commercial', 'setCreateJobFromBidForm'], ['convertJob', 'commercial', 'setConvertJobForm']]) {
      expect(dash).toContain(`jobNums.seed('${key}', '${type}', ${setter})`)
    }
    for (const v of ['newJob.job_number', 'newResJob.job_number', 'createJobFromBidForm.job_number', 'convertJobForm.job_number']) {
      expect(dash).toContain(`confirmJobNumberFree(${v})`)
      expect(dash).toContain(`<JobNumberHint jn={jobNums} value={${v}} />`)
    }
  })

  test('estimate workspace convert and bid detail convert', () => {
    expect(ws).toContain("jobNums.seed('convert', 'commercial', setCvtForm)")
    expect(ws).toContain('confirmJobNumberFree(cvtForm.job_number)')
    expect(ws).toContain('<JobNumberHint jn={jobNums} value={cvtForm.job_number} />')
    expect(bid).toContain("jobNums.seed('convert', jobType, setCvtForm)")
    expect(bid).toContain("jobNums.seed('convert', val, setCvtForm)")
    expect(bid).toContain('confirmJobNumberFree(cvtForm.job_number)')
    expect(bid).toContain('<JobNumberHint jn={jobNums} value={cvtForm.job_number} />')
  })
})
