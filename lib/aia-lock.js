// Owner pay apps (AIA G702/G703, aia_applications): when an app is locked and
// how the next app number is picked. No imports: used by the job page and tests.

// Locked once it has left draft (submitted / certified) or payment is recorded.
export function isAiaLocked(app) {
  if (!app) return false
  return app.status === 'submitted' || app.status === 'certified' || !!app.payment_received
}

export function aiaLockReason(app) {
  if (!app) return ''
  if (app.payment_received) return 'payment has been recorded'
  if (app.status === 'certified') return 'it is certified'
  if (app.status === 'submitted') return 'it has been submitted'
  return ''
}

// Apps in one numbering sequence: the job's prime apps (no nv_subcontract_id),
// or one NV-sub contract's apps.
export function sameAiaSequence(app, nvSubcontractId = null) {
  return nvSubcontractId ? app?.nv_subcontract_id === nvSubcontractId : !app?.nv_subcontract_id
}

// max(app_number) + 1 within the sequence (never count + 1, which repeats a
// number after a delete).
export function nextAiaAppNumber(apps, nvSubcontractId = null) {
  let max = 0
  for (const a of apps || []) {
    if (!sameAiaSequence(a, nvSubcontractId)) continue
    const n = parseInt(a.app_number, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

// Owner override on a locked app: they must type the app number.
export function overrideConfirmed(typed, app) {
  return String(typed ?? '').trim() !== '' && String(typed).trim().replace(/^#/, '') === String(app?.app_number)
}
