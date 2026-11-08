// Commercial job Closeout tab: readiness from punch items, sub billings, retainage
// releases and lien notices. Pure. `loads` = { punch, releases, notices, billing },
// each 'loading' | 'ok' | 'error' (anything else counts as not loaded).
//
//  • state 'checking' until every list has loaded; 'error' when any failed (never
//    "ready" on a failed load); else 'ready' / 'not_ready'.
//  • Ready needs: no open / sub-complete punch items, no pending sub billings,
//    retainage balance exactly settled (0 within a cent), no active lien notices.
//  • A negative balance (more released than held) is "check releases", not ✓.

export const CLOSEOUT_SOURCES = ['punch', 'releases', 'notices', 'billing']

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

// A Supabase list result as Closeout needs it: the array when it really loaded,
// else null. { data: null, error: null } (or any non-array) is a failed load,
// never an empty list.
export function closeoutList(result) {
  if (!result || result.error) return null
  return Array.isArray(result.data) ? result.data : null
}

const LIST_FOR = { punch: 'punchItems', releases: 'retainageReleases', notices: 'prelimNotices', billing: 'billingSubmissions' }

export function closeoutStatus(input = {}) {
  const { loads = {} } = input
  // A list passed as null / non-array is unknown, so that source counts as failed
  // even if its load was marked 'ok' (undefined = not passed = empty).
  const lists = {}
  const badList = new Set()
  for (const [k, name] of Object.entries(LIST_FOR)) {
    const v = input[name]
    if (v === undefined) lists[name] = []
    else if (Array.isArray(v)) lists[name] = v
    else { lists[name] = []; badList.add(k) }
  }
  const { punchItems, billingSubmissions, retainageReleases, prelimNotices } = lists
  const failed = CLOSEOUT_SOURCES.filter(k => loads[k] === 'error' || (loads[k] === 'ok' && badList.has(k)))
  const pending = CLOSEOUT_SOURCES.filter(k => loads[k] !== 'ok' && loads[k] !== 'error')
  const openItems = punchItems.filter(p => p.status === 'open')
  const subComplete = punchItems.filter(p => p.status === 'sub_complete')
  const approvedPunch = punchItems.filter(p => p.status === 'approved')
  const pendingBillings = billingSubmissions.filter(b => b.status === 'pending')
  const totalRetainageHeld = r2(billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.retainage_held || 0), 0))
  const totalReleased = r2(retainageReleases.reduce((a, r) => a + Number(r.amount || 0), 0))
  const retainageBalance = r2(totalRetainageHeld - totalReleased)
  const activeNotices = prelimNotices.filter(n => n.status === 'active')

  const retainage = retainageBalance > 0 ? 'held' : retainageBalance < 0 ? 'over_released' : 'released'
  const checks = {
    punch: openItems.length === 0 && subComplete.length === 0,
    retainage: retainage === 'released',
    notices: activeNotices.length === 0,
    billing: pendingBillings.length === 0,
  }
  const state = failed.length ? 'error' : pending.length ? 'checking' : Object.values(checks).every(Boolean) ? 'ready' : 'not_ready'
  return {
    state, failed, pending, checks, retainage,
    openItems, subComplete, approvedPunch, pendingBillings, activeNotices,
    totalRetainageHeld, totalReleased, retainageBalance,
  }
}

export const CLOSEOUT_SOURCE_LABELS = { punch: 'punch list', releases: 'retainage releases', notices: 'lien notices', billing: 'sub billings' }
