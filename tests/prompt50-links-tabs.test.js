/**
 * Prompt 50 items 1–3, 7: dashboard ?tab=, residential list scoping, type-aware
 * job links, wrong-page guards and the DEV badge. Helpers are tested directly;
 * page wiring is checked statically (source text only, nothing is run).
 */
import fs from 'fs'
import path from 'path'
import { jobHref, jobHrefById, mapJobTab, safePageTab, wrongPageHref, normJobType, isResidentialJob, RESIDENTIAL_TABS, COMMERCIAL_TABS } from '../lib/job-links'
import { resolveDashboardTab, tabFromSearch, dashboardUrlForTab } from '../lib/dashboard-tabs'

const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const RES = { id: '47a6759e-0a72-4929-9507-0660ded3853f', job_type: 'residential' }
const COM = { id: '8ae26b84-c4df-4a75-a466-48ee7bed9f0c', job_type: 'commercial' }

describe('job type (display only, tolerant)', () => {
  test('normalizes case/space; unknown is empty', () => {
    expect(normJobType({ job_type: ' Residential ' })).toBe('residential')
    expect(normJobType({ job_type: 'COMMERCIAL' })).toBe('commercial')
    expect(normJobType({ job_type: null })).toBe('')
    expect(normJobType({ job_type: 'house' })).toBe('')
    expect(isResidentialJob({ job_type: 'residential' })).toBe(true)
    expect(isResidentialJob({})).toBe(false)
  })
})

describe('jobHref', () => {
  test('residential → residential page, commercial and unknown → commercial page', () => {
    expect(jobHref(RES)).toBe(`/residentialjobdetail?id=${RES.id}`)
    expect(jobHref(COM)).toBe(`/jobdetail?id=${COM.id}`)
    expect(jobHref({ id: 'x1', job_type: null })).toBe('/jobdetail?id=x1')
    expect(jobHref(null)).toBe('/dashboard')
  })
  test('maps tabs across pages; unsupported tab → overview, never blank', () => {
    expect(jobHref(RES, 'costs')).toBe(`/residentialjobdetail?id=${RES.id}&tab=costs`)
    expect(jobHref(RES, 'punch')).toContain('tab=punchlist')
    expect(jobHref(RES, 'contracts')).toContain('tab=subs')
    expect(jobHref(RES, 'lookahead')).toContain('tab=field')
    expect(jobHref(RES, 'po')).toContain('tab=overview')
    expect(jobHref(COM, 'punchlist')).toContain('tab=punch')
    // prompt67d #9: the commercial page has its own Inspections tab now.
    expect(jobHref(COM, 'inspections')).toContain('tab=inspections')
    expect(jobHref(COM, 'nonsense')).toContain('tab=overview')
    for (const t of [...RESIDENTIAL_TABS, ...COMMERCIAL_TABS, 'bogus']) {
      expect(RESIDENTIAL_TABS).toContain(mapJobTab(t, true))
      expect(COMMERCIAL_TABS).toContain(mapJobTab(t, false))
    }
  })
  test('encodes params (no injection through id or extra)', () => {
    const h = jobHref({ id: 'a&tab=x', job_type: 'commercial' }, 'lookahead', { week: '2026-11-02&x=<y>' })
    expect(h).toBe('/jobdetail?id=a%26tab%3Dx&tab=lookahead&week=2026-11-02%26x%3D%3Cy%3E')
  })
  test('jobHrefById uses the list type, falls back to commercial page (its guard forwards)', () => {
    expect(jobHrefById(RES.id, [RES, COM], 'costs')).toBe(`/residentialjobdetail?id=${RES.id}&tab=costs`)
    expect(jobHrefById('foreign', [RES], 'costs')).toBe('/jobdetail?id=foreign&tab=costs')
  })
})

describe('wrong-page guard', () => {
  test('moves only a job of the other known type, keeping the mapped tab', () => {
    expect(wrongPageHref(COM, 'residential', 'punchlist')).toBe(`/jobdetail?id=${COM.id}&tab=punch`)
    expect(wrongPageHref(RES, 'commercial', 'contracts')).toBe(`/residentialjobdetail?id=${RES.id}&tab=subs`)
    expect(wrongPageHref(RES, 'residential', 'costs')).toBeNull()
    expect(wrongPageHref(COM, 'commercial')).toBeNull()
  })
  test('no redirect loop: unknown type stays on either page', () => {
    const u = { id: 'u', job_type: null }
    expect(wrongPageHref(u, 'residential')).toBeNull()
    expect(wrongPageHref(u, 'commercial')).toBeNull()
  })
  test('safePageTab falls back for unsupported keys', () => {
    expect(safePageTab('ownerdraw', true)).toBe('ownerdraw')
    expect(safePageTab('po', true)).toBe('overview')
    expect(safePageTab('lienWaivers', false)).toBe('overview')
    expect(safePageTab(null, true)).toBe('overview')
  })
})

describe('dashboard ?tab=', () => {
  const allowed = ['overview', 'my-work', 'notifications', 'jobs', 'residential', 'lookahead', 'billing']
  test('accepts role-authorized keys, falls back for invalid / not allowed', () => {
    expect(resolveDashboardTab('residential', allowed)).toBe('residential')
    expect(resolveDashboardTab('my-work', new Set(allowed))).toBe('my-work')
    expect(resolveDashboardTab('permissions', allowed)).toBe('overview') // Owner-only, not in an APM nav
    expect(resolveDashboardTab('<script>', allowed)).toBe('overview')
    expect(resolveDashboardTab('', allowed)).toBe('overview')
  })
  test('URL keeps other args and hash; default tab drops ?tab=', () => {
    expect(dashboardUrlForTab({ pathname: '/dashboard', search: '?x=1', hash: '#h' }, 'residential')).toBe('/dashboard?x=1&tab=residential#h')
    expect(dashboardUrlForTab({ pathname: '/dashboard', search: '?tab=residential&x=1' }, 'overview')).toBe('/dashboard?x=1')
    expect(dashboardUrlForTab({ pathname: '/dashboard', search: '?tab=jobs' }, 'billing')).toBe('/dashboard?tab=billing')
    expect(tabFromSearch('?tab=residential&x=1')).toBe('residential')
    expect(tabFromSearch('')).toBe('')
  })
  test('Back to Residential lands on the list: dashboard resolves its ?tab= against nav keys', () => {
    const res = src('app/residentialjobdetail/page.js')
    expect(res).toContain("router.push('/dashboard?tab=residential')")
    const dash = src('app/dashboard/page.js')
    expect(dash).not.toMatch(/urlTab === 'lookahead' \|\| urlTab === 'direct-costs'/)
    expect(dash).toContain('inboundTabRef.current = tabFromSearch(window.location.search)')
    expect(dash).toContain('navKeysRef.current = navItems.map(i => i.tab)')
    expect(dash).toContain("window.addEventListener('popstate', onPop)")
    expect(dash).toMatch(/pushState\(window\.history\.state, '', want\)/)
  })
})

describe('residential list scoping (item 2)', () => {
  const dash = src('app/dashboard/page.js')
  test('returning to Owner clears the old assignment filter; scoped loads reload on focus', () => {
    expect(dash).not.toContain('if (jobIds) setAssignedJobIds(jobIds)')
    expect(dash).toContain('setAssignedJobIds(jobIds)')
    expect(dash).toContain('if (isJobLimited(role) || scopedLoadRef.current)')
  })
  test('APM scoping kept: limited roles still load through accessibleJobIds', () => {
    expect(dash).toMatch(/async function myJobIds\(role, session\) \{\s+if \(!isJobLimited\(role\)\) return null\s+const \{ ids \} = await accessibleJobIds/)
  })
  test('tolerant type filter, load error distinct from empty, counts shown', () => {
    expect(dash).not.toMatch(/job_type [!=]== 'residential'/)
    expect(dash).toContain('Could not load jobs: {jobsLoadError}')
    expect(dash).toMatch(/commercial · \$\{activeJobs\.filter\(isResidentialJob\)\.length\} residential/)
  })
  test('role switch does a full navigation (remount), keeping query/hash on the same page', () => {
    const sw = src('app/components/DevRoleSwitcher.js')
    expect(sw).toContain('window.location.replace(pathname + search + hash)')
    expect(sw).toContain('window.location.assign(role.portal)')
    expect(sw).not.toContain('router.push(role.portal)')
  })
})

describe('links on the named dashboard surfaces (item 3)', () => {
  const dash = src('app/dashboard/page.js')
  test('Costs to Approve, Notifications, My Work, calendar, Pipeline and Business Dev use jobHref', () => {
    expect(dash).toContain("jobHrefById(c.job_id, jobs, 'costs')")
    expect(dash).toContain("jobHrefById(c.job_id, jobs, 'budget')")
    expect(dash).toContain('router.push(jobHrefById(n.job_id, jobs))')
    expect(dash).toContain('router.push(jobHrefById(item.jobs.id, jobs, navTab || null))')
    expect(dash).toContain('onClick={() => router.push(jobHref(j))} style={{ background: \'#eff6ff\'')
    expect(dash).toContain('onClick={() => router.push(jobHref(job))}>')
    expect(dash).toContain("router.push(jobHrefById(item.id, jobs))}>Open Job")
    // Only job-creation redirects (type known at insert) still hard-code a page.
    const hard = dash.match(/\/(residential)?jobdetail\?id=/g) || []
    expect(hard.length).toBe(4)
  })
  test('both job pages guard type after load; server auth untouched (client links only)', () => {
    expect(src('app/jobdetail/page.js')).toContain("wrongPageHref(jobData, 'commercial'")
    expect(src('app/residentialjobdetail/page.js')).toContain("wrongPageHref(jobRes.data, 'residential'")
  })
})

describe('DEV badge vs Ask AI (item 7)', () => {
  test('badge bottom-left, lifted above the phone bottom nav; Ask AI still bottom-right with auth header', () => {
    const sw = src('app/components/DevRoleSwitcher.js')
    expect(sw).toMatch(/className="nv-dev-badge" style=\{\{ position: 'fixed', bottom: [^}]*left: '16px'/)
    expect(sw).not.toMatch(/right: '20px'/)
    expect(src('app/globals.css')).toMatch(/\.nv-dev-badge \{ bottom: calc\(72px/)
    for (const f of ['app/residentialjobdetail/page.js', 'app/jobdetail/page.js']) {
      const p = src(f)
      expect(p).toMatch(/position: 'fixed', bottom: '24px', right: '24px', zIndex: 1100/)
      expect(p).toContain("'/api/ask-ai'")
    }
  })
})
