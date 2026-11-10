/**
 * Prompt 77: Estimator > Pipeline estimate cards open the estimate page directly.
 *  - lib/estimate-nav.js: ?sub= parsing, pipeline estimate href, back target + label.
 *  - Dashboard: card onClick navigates (behind leaveScope), stage-button row still stops propagation,
 *    ?sub= captured with ?tab= on arrival and applied only for Estimator.
 *  - Estimate page / EstimateWorkspace: ?from=pipeline back target + backLabel prop.
 */
const fs = require('fs')
const path = require('path')
const {
  ESTIMATOR_SUB_TABS, estimatorSubFromSearch, estimateHrefFromPipeline, estimateBackTarget,
} = require('../lib/estimate-nav')
const { dashboardUrlForTab } = require('../lib/dashboard-tabs')

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')

describe('estimatorSubFromSearch', () => {
  test('accepts every existing inner tab key', () => {
    expect(ESTIMATOR_SUB_TABS).toEqual(['estimates', 'bids', 'overview', 'archive'])
    for (const k of ESTIMATOR_SUB_TABS) expect(estimatorSubFromSearch(`?tab=estimator&sub=${k}`)).toBe(k)
  })
  test('ignores missing, empty and unknown values', () => {
    expect(estimatorSubFromSearch('')).toBeNull()
    expect(estimatorSubFromSearch(undefined)).toBeNull()
    expect(estimatorSubFromSearch('?tab=estimator')).toBeNull()
    expect(estimatorSubFromSearch('?tab=estimator&sub=')).toBeNull()
    expect(estimatorSubFromSearch('?tab=estimator&sub=pipeline')).toBeNull()
    expect(estimatorSubFromSearch('?tab=estimator&sub=OVERVIEW')).toBeNull()
    expect(estimatorSubFromSearch('?sub=constructor')).toBeNull()
  })
})

describe('estimate links and back target', () => {
  test('pipeline card href', () => {
    expect(estimateHrefFromPipeline('abc-123')).toBe('/estimate/abc-123?from=pipeline')
  })
  test('from=pipeline goes back to the Pipeline sub-tab', () => {
    expect(estimateBackTarget('pipeline')).toEqual({ href: '/dashboard?tab=estimator&sub=overview', label: '← Back to Pipeline' })
    expect(estimatorSubFromSearch('?tab=estimator&sub=overview')).toBe('overview')
  })
  test('anything else keeps the old behavior', () => {
    for (const f of [undefined, null, '', 'other', 'PIPELINE']) {
      expect(estimateBackTarget(f)).toEqual({ href: '/dashboard?tab=estimator', label: '← Estimates' })
    }
  })
  test('dropping sub then syncing tab leaves a clean estimator URL', () => {
    const params = new URLSearchParams('?tab=estimator&sub=overview&x=1')
    params.delete('sub')
    expect(dashboardUrlForTab({ pathname: '/dashboard', search: '?' + params.toString(), hash: '' }, 'estimator'))
      .toBe('/dashboard?tab=estimator&x=1')
  })
})

describe('dashboard source', () => {
  const src = read('app/dashboard/page.js')

  test('pipeline estimate card opens the estimate (behind leaveScope), not the dead expandable list', () => {
    expect(src).toContain("onClick={() => { if (!leaveScope()) return; router.push(estimateHrefFromPipeline(est.id)) }}>")
    expect(src).not.toContain("onClick={() => { setEstimatorInnerTab('estimates'); setExpandedEstimate(est.id) }}")
  })

  test('stage button row still stops propagation (Back / Next / Won / Lost do not navigate)', () => {
    const card = src.indexOf('router.push(estimateHrefFromPipeline(est.id))')
    const row = src.indexOf('onClick={e => e.stopPropagation()}', card)
    expect(card).toBeGreaterThan(-1)
    expect(row).toBeGreaterThan(card)
    const between = src.slice(row, src.indexOf("moveEstimateStage(est.id, 'lost')", row))
    expect(between).toContain('moveEstimateStage(est.id, PREV[stage.key])')
    expect(between).toContain('moveEstimateStage(est.id, NEXT[stage.key])')
    expect(between).toContain("moveEstimateStage(est.id, 'won')")
  })

  test('job cards are unchanged', () => {
    expect((src.match(/onClick=\{\(\) => router\.push\(jobHref\(job\)\)\}/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  test('?sub= is captured alongside ?tab= and applied only for Estimator, before the URL is rewritten', () => {
    const capTab = src.indexOf('inboundTabRef.current = tabFromSearch(window.location.search)')
    const capSub = src.indexOf('inboundSubRef.current = estimatorSubFromSearch(window.location.search)')
    expect(capTab).toBeGreaterThan(-1)
    expect(capSub).toBeGreaterThan(capTab)
    const apply = src.indexOf("if (t === 'estimator' && sub) setEstimatorInnerTab(sub)")
    const replace = src.indexOf("window.history.replaceState(window.history.state, '', dashboardUrlForTab(", apply)
    expect(apply).toBeGreaterThan(-1)
    expect(replace).toBeGreaterThan(apply)
    expect(src.slice(apply, replace)).toContain("params.delete('sub')")
  })
})

describe('estimate page + workspace source', () => {
  test('estimate page reads ?from= and passes back target + label; onDeleted unchanged', () => {
    const src = read('app/estimate/[id]/page.js')
    expect(src).toContain("new URLSearchParams(window.location.search).get('from')")
    expect(src).toContain('const back = estimateBackTarget(from)')
    expect(src).toContain('onBack={() => router.push(back.href)}')
    expect(src).toContain('backLabel={back.label}')
    expect(src).toContain("onDeleted={() => router.push('/dashboard?tab=estimator')}")
  })
  test('EstimateWorkspace back label is a prop defaulting to "← Estimates"', () => {
    const src = read('app/components/estimating/EstimateWorkspace.js')
    expect(src).toContain("backLabel = '← Estimates'")
    expect(src).toContain('<button style={s.backBtn} onClick={onBack}>{backLabel}</button>')
    expect(src).not.toContain('onClick={onBack}>← Estimates</button>')
  })
})
