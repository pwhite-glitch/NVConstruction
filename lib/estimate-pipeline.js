// Estimator Pipeline helpers.
//
// A won estimate that has already become a job shows in the pipeline as that
// job (Under Construction / Completed), so it must not also sit in the WON
// column. Won YTD and win rate still count every won estimate — that's history.

export function isWonStatus(est) {
  const s = String(est?.status || '').toLowerCase()
  return s === 'won' || s === 'accepted'
}

// Converted = estimate points at a job, or any loaded job points back at it.
export function isConverted(est, jobs) {
  if (!est) return false
  if (est.job_id) return true
  return (jobs || []).some(j => j && j.source_estimate_id != null && j.source_estimate_id === est.id)
}

// Every won estimate, converted or not (Won YTD, win rate).
export function wonEstimates(estimates) {
  return (estimates || []).filter(isWonStatus)
}

// Won estimates that still belong in the WON column / Won report section.
export function wonColumnEstimates(estimates, jobs) {
  return wonEstimates(estimates).filter(e => !isConverted(e, jobs))
}
