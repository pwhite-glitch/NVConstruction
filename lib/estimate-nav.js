// Estimator navigation helpers: the dashboard Estimator sub-tab (?sub=) and the
// estimate page's back target (?from=pipeline). No imports: browser and tests.

export const ESTIMATOR_SUB_TABS = ['estimates', 'bids', 'overview', 'archive']

// The ?sub= Estimator inner tab in a search string, or null when missing/unknown.
export function estimatorSubFromSearch(search) {
  let sub = ''
  try { sub = new URLSearchParams(search || '').get('sub') || '' } catch { return null }
  return ESTIMATOR_SUB_TABS.includes(sub) ? sub : null
}

// Estimate page URL opened from a Pipeline card.
export function estimateHrefFromPipeline(id) {
  return '/estimate/' + encodeURIComponent(id) + '?from=pipeline'
}

// Where the estimate page's back button goes, and its label, for a ?from= value.
export function estimateBackTarget(from) {
  if (from === 'pipeline') return { href: '/dashboard?tab=estimator&sub=overview', label: '← Back to Pipeline' }
  return { href: '/dashboard?tab=estimator', label: '← Estimates' }
}
