// Owner pay app (AIA G702/G703) line math — the ONE place for it. Pure, no imports:
// used by the job page (screen + PDF), lib/contract-cap.js, lib/cash-outlook.js
// (owner portal, cash outlook, aia-payments, Ask AI) and /api/aia-draw.
//
// Real AIA G703 columns:
//   A Item No. · B Description of Work · C Scheduled Value
//   D Work Completed From Previous Application · E Work Completed This Period
//   F Materials Presently Stored (not in D or E) · G Total Completed and Stored to Date (D+E+F)
//   % (G÷C) · H Balance to Finish (C−G) · I Retainage
//
// Stored materials (migration 063, aia_application_lines):
//   stored_this_period            new material stored on site / in a yard this period
//   stored_installed_this_period  previously stored material installed this period
// "Move to installed": installing stored material moves its value from F into E, so the
// page adds the installed amount to this period's completed (E) in the same edit and G
// does not change for that movement. Rows without the columns (063 not applied, or legacy
// lines) count 0, so their numbers are unchanged to the cent.

const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export const STORED_COLS = ['stored_this_period', 'stored_installed_this_period']

// True when a row read with select('*') carries the 063 columns.
export function hasStoredColumns(rows) {
  return (rows || []).some(r => r && 'stored_this_period' in r)
}

// Net stored movement on one saved line (stored − installed). Missing columns → 0.
export function storedNet(line) {
  return r2(num(line?.stored_this_period) - num(line?.stored_installed_this_period))
}

// Stored balance carried into an app from earlier apps' lines for the same budget item
// (prime) / line_description (NV-sub). Never below 0.
export function storedBalanceBefore(prevLines) {
  const total = (prevLines || []).reduce((a, l) => a + storedNet(l), 0)
  return Math.max(0, r2(total))
}

// { [key]: carried-in stored balance } for many lines at once. keyOf(line) → key or null.
export function storedBalanceByKey(prevLines, keyOf) {
  const groups = {}
  for (const l of prevLines || []) {
    const k = keyOf(l)
    if (k == null) continue
    ;(groups[k] = groups[k] || []).push(l)
  }
  return Object.fromEntries(Object.entries(groups).map(([k, ls]) => [k, storedBalanceBefore(ls)]))
}

// Error text when "installed from stored" exceeds what was stored before this app; else null.
export function storedInstalledError({ storedPrevBalance, storedInstalledThis, label }) {
  const inst = r2(num(storedInstalledThis))
  const bal = r2(num(storedPrevBalance))
  if (inst < 0) return `${label ? label + ': ' : ''}"Installed from stored" can't be negative.`
  if (inst > bal + 0.005) {
    return `${label ? label + ': ' : ''}"Installed from stored" ($${inst.toFixed(2)}) is more than the material stored on earlier pay apps ($${bal.toFixed(2)}).`
  }
  return null
}

// Column F for a line: carried-in balance + stored this period − installed this period.
export function storedToDate({ storedPrevBalance, storedThis, storedInstalledThis }) {
  return r2(num(storedPrevBalance) + num(storedThis) - num(storedInstalledThis))
}

// One G703 row. D and E are passed already computed (callers keep their own legacy
// dollar / percent rules so existing numbers don't move). retPct is a FRACTION (0.10).
// Retainage is left unrounded (same as the PDF and cash outlook always did).
export function g703Row({ scheduled, prevCompleted, thisCompleted, storedPrevBalance = 0, storedThis = 0, storedInstalledThis = 0, retPct = 0 }) {
  const C = num(scheduled)
  const D = num(prevCompleted)
  const E = num(thisCompleted)
  const F = storedToDate({ storedPrevBalance, storedThis, storedInstalledThis })
  const G = D + E + F
  const rate = num(retPct)
  const I_work = (D + E) * rate
  const I_stored = F * rate
  return { C, D, E, F, G, pct: C > 0 ? G / C * 100 : 0, H: C - G, I_work, I_stored, I: I_work + I_stored }
}

// The stored inputs of a SCREEN line (job page line objects).
export function screenStored(line) {
  return {
    storedPrevBalance: num(line?.stored_prev_balance),
    storedThis: num(line?.stored_this),
    storedInstalledThis: num(line?.stored_installed_this),
  }
}

// The stored inputs of a SAVED line (aia_application_lines row) given its carried-in balance.
export function savedStored(line, storedPrevBalance = 0) {
  return {
    storedPrevBalance: num(storedPrevBalance),
    storedThis: num(line?.stored_this_period),
    storedInstalledThis: num(line?.stored_installed_this_period),
  }
}
