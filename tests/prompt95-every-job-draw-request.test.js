/**
 * Prompt 95 — every job bills through a linked draw request (AIA / Draw request choice removed).
 * Peyton 11/20: "Let's make it to where you have to link it to a draw! I like the draw request better."
 * Code only: no migration, no update to jobs.billing_type. Old 'aia' jobs behave as draw-request jobs;
 * old unlinked apps keep working (month fallback) and can be relinked. No DB access.
 */
const fs = require('fs')
const path = require('path')
const B = require('../lib/billing-type')

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const job = read('app/jobdetail/page.js')
const dash = read('app/dashboard/page.js')
const bid = read('app/bid/[id]/page.js')

function fnBody(src, decl) {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error('not found: ' + decl)
  let i = src.indexOf(') {', start) + 2, depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}
// The "+ New draw request" form block on the Prime Contract tab.
const newForm = job.slice(job.indexOf('{showNewAia && (() => {'), job.indexOf("{savingAia ? 'Creating...' : 'Create draw request'}"))

describe('prompt 95 — lib/billing-type helper', () => {
  test('every job is a draw-request job, whatever billing_type says', () => {
    expect(B.DEFAULT_BILLING_TYPE).toBe('draw_request')
    for (const j of [{ billing_type: 'aia' }, { billing_type: 'draw_request' }, { billing_type: null }, {}, null, undefined]) {
      expect(B.isDrawBilling(j)).toBe(true)
    }
  })
  test('labels: "Draw #N" and "Draw Requests"', () => {
    expect(B.primeAppLabel({ app_number: 4 })).toBe('Draw #4')
    expect(B.primeAppsHeading(3)).toBe('Draw Requests (3)')
    expect(B.primeAppsHeading()).toBe('Draw Requests')
  })
  test('create needs a linked sub draw, at least one draw, budget lines, and not saving', () => {
    const ok = { linkedDrawId: 'd1', drawCount: 1, budgetCount: 5, saving: false }
    expect(B.canCreatePrimeDraw(ok)).toBe(true)
    expect(B.canCreatePrimeDraw({ ...ok, linkedDrawId: '' })).toBe(false)
    expect(B.canCreatePrimeDraw({ ...ok, drawCount: 0 })).toBe(false)
    expect(B.canCreatePrimeDraw({ ...ok, budgetCount: 0 })).toBe(false)
    expect(B.canCreatePrimeDraw({ ...ok, saving: true })).toBe(false)
    expect(B.canCreatePrimeDraw()).toBe(false)
  })
  test('bills source: linked draw first; month only as fallback for old unlinked apps', () => {
    expect(B.primeBillsSource({ linked_draw_request_id: 'd9', period_to: '2026-10-31' })).toEqual({ by: 'draw', drawId: 'd9' })
    expect(B.primeBillsSource({ linked_draw_request_id: null, period_to: '2026-10-31' })).toEqual({ by: 'month', month: '2026-10-01' })
    expect(B.primeBillsSource({ period_to: null })).toBeNull()
    expect(B.primeBillsSource({})).toBeNull()
  })
})

describe('prompt 95 — billing type choice removed; new jobs write draw_request', () => {
  test('Job Details has no billing type select and the save does not send billing_type', () => {
    expect(job).not.toContain('Prime billing type')
    expect(job).not.toContain('<option value="aia">')
    const save = job.slice(job.indexOf('async function saveJob(e)'), job.indexOf('// Owner-only Archive / Unarchive'))
    expect(save).not.toMatch(/billing_type:/)
    expect(save).not.toContain("'aia'")
  })
  test('no scattered billing_type === checks remain on the job page', () => {
    expect(job).not.toMatch(/billing_type\s*===/)
  })
  test('dashboard new-job form has no select; creates write DEFAULT_BILLING_TYPE', () => {
    expect(dash).not.toContain('Prime billing type')
    expect(dash).not.toContain('GC billing type')
    expect(dash).not.toContain("billing_type: 'aia'")
    expect(dash).not.toContain("billing_type || 'aia'")
    expect(dash).toContain("import { DEFAULT_BILLING_TYPE } from '../../lib/billing-type'")
    expect((dash.match(/billing_type: DEFAULT_BILLING_TYPE/g) || []).length).toBe(3)
  })
  test('bid → job conversion writes DEFAULT_BILLING_TYPE', () => {
    expect(bid).not.toContain("billing_type: 'aia'")
    expect(bid).toContain('billing_type: DEFAULT_BILLING_TYPE')
  })
  test('no migration touches billing_type in this change', () => {
    const migDir = path.join(root, 'migrations')
    if (!fs.existsSync(migDir)) return
    for (const f of fs.readdirSync(migDir).filter(f => /prompt ?95|095_/.test(f))) {
      expect(fs.readFileSync(path.join(migDir, f), 'utf8')).not.toMatch(/billing_type/)
    }
  })
})

describe('prompt 95 — "+ New draw request" requires a linked sub draw request', () => {
  test('button and form are always the draw-request version', () => {
    expect(job).toContain('}}>+ New draw request</button>')
    expect(job).not.toContain("'+ New application'}")
    expect(newForm).toContain('New Draw Request')
    expect(newForm).not.toContain('New AIA Application')
  })
  test('form: link select + editable Period from/to defaulting to the Central month; no biweekly/month picker', () => {
    expect(newForm).toContain('Link to sub draw request')
    expect(newForm).toContain('Period from')
    expect(newForm).toContain('Period to')
    expect(newForm).not.toContain('isBiweekly')
    expect(newForm).not.toContain('Select month...')
    expect(job).toContain('const drawPeriod = monthPeriod(todayCentral().slice(0, 7))')
  })
  test('Create is gated by canCreatePrimeDraw (link required)', () => {
    expect(newForm).toContain('canCreatePrimeDraw({ linkedDrawId: newAiaForm.linked_draw_request_id, drawCount: drawRequests.length, budgetCount: budgetItems.length, saving: savingAia })')
    expect(job).toContain('disabled={!canCreate}')
  })
  test('createAiaApplication refuses without a linked draw and always inserts the link', () => {
    const create = fnBody(job, 'async function createAiaApplication(')
    expect(create).toContain('const isDrawType = isDrawBilling(job)')
    expect(create).toContain('const linkedDraw = drawRequests.find(d => d.id === newAiaForm.linked_draw_request_id)')
    expect(create).toContain("if (!linkedDraw) { alert('Link a sub draw request first.'); return }")
    expect(create.indexOf('if (!linkedDraw)')).toBeLessThan(create.indexOf('setSavingAia(true)'))
    expect(create).toContain('linked_draw_request_id: linkedDraw?.id || null')
    expect(create).not.toContain('billing_type')
  })
  test('no sub draw requests: inline hint + button to the Billing tab, select disabled', () => {
    expect(B.NO_SUB_DRAWS_HINT).toMatch(/^No sub draw requests yet — create one on the Billing tab/)
    expect(newForm).toContain('const noSubDraws = drawRequests.length === 0')
    expect(newForm).toContain('{NO_SUB_DRAWS_HINT}')
    expect(newForm).toContain("setActiveTab('billing')")
    expect(newForm).toContain('disabled={noSubDraws}')
  })
})

describe('prompt 95 — labels', () => {
  test('Prime Contract and Payments tabs use Draw labels', () => {
    expect(job).toContain('{primeAppsHeading(aiaApplications.length)}')
    expect(job).toContain('{primeAppLabel(app)}')
    expect(job).toContain('{primeAppLabel(activeAia)}')
    expect(job).toContain('{primeAppLabel(a)}')
    expect(job).toContain('{primeAppsHeading()} — Payment Status')
    expect(job).toContain('record payments received on each draw request.')
    expect(job).toContain('No draw requests yet. Create your first draw request above.')
    expect(job).not.toContain('AIA Applications — Payment Status')
    expect(job).not.toContain('No AIA applications yet')
  })
  test('G702/G703 form names are not renamed', () => {
    expect(job).toContain('G703 &nbsp;·&nbsp; Continuation Sheet')
  })
})

describe('prompt 95 — existing apps keep working', () => {
  test('open app pulls bills via primeBillsSource: linked draw, else month fallback', () => {
    const open = job.slice(job.indexOf('const billsSource = primeBillsSource(app)'), job.indexOf("supabase.from('direct_costs').select('*').eq('job_id', id).eq('status', 'approved').order('cost_date'"))
    expect(open).toContain(".eq('draw_request_id', billsSource.drawId)")
    expect(open).toContain(".eq('billing_period', billsSource.month)")
    expect(open.indexOf("billsSource?.by === 'draw'")).toBeLessThan(open.indexOf("billsSource?.by === 'month'"))
  })
  test('relink control is not gated on billing type; unlinked apps get a relink note', () => {
    const relink = job.slice(job.indexOf('relinkDrawOpen ? ('), job.indexOf('>Relink draw</button>'))
    expect(relink).not.toContain('billing_type')
    expect(relink).not.toContain('isDrawBilling')
    expect(job).toContain('Not linked to a sub draw request — sub bills come from the billing month. Use Relink draw to link it.')
  })
  test('relinkAiaDraw still only updates linked_draw_request_id', () => {
    const relink = fnBody(job, 'async function relinkAiaDraw(')
    expect(relink).toContain(".update({ linked_draw_request_id: relinkDrawId || null })")
  })
})
