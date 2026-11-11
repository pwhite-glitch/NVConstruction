/**
 * Prompt 72: Commercial COI warning (badge + confirm, no hard block).
 * - lib/coi-warning: directory match (sameCompany, prefer approved), badge model,
 *   confirm only for missing / expired, wording per action.
 * - jobdetail approve / ready / create (auto-approve) / edit → approved, and admin
 *   Record payment / ready to pay, call the confirm helper; billing tab loads the directory.
 * - Server (billing-entry route) is untouched: no COI check there.
 * Pure helpers + source checks only; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { coiState } = require('../lib/coi-status')
const { findDirectoryEntry, coiBadgeModel, coiActionNeedsConfirm, coiConfirmMessage, confirmCoiOrProceed, coiBadgeForCompany, confirmCoiForCompany } = require('../lib/coi-warning')

// Noon UTC = morning in Chicago on that date
const at = d => new Date(d + 'T17:00:00Z')
const NOW = at('2026-11-09')
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const E = {
  missing: { company_name: 'Acme Drywall LLC', coi_url: null, coi_expiration: '2027-01-01' },
  noDate: { company_name: 'Acme', coi_url: 'coi/a.pdf', coi_expiration: null },
  expired: { company_name: 'Acme', coi_url: 'coi/a.pdf', coi_expiration: '2026-11-08' },
  expiring: { company_name: 'Acme', coi_url: 'coi/a.pdf', coi_expiration: '2026-11-20' },
  ok: { company_name: 'Acme', coi_url: 'coi/a.pdf', coi_expiration: '2027-03-04' },
}

describe('coiState semantics unchanged', () => {
  test('missing / no_date / expired / expiring / ok', () => {
    expect(coiState(E.missing, NOW)).toBe('missing')
    expect(coiState(null, NOW)).toBe('missing')
    expect(coiState(E.noDate, NOW)).toBe('no_date')
    expect(coiState(E.expired, NOW)).toBe('expired')
    expect(coiState({ ...E.ok, coi_expiration: '2026-11-09' }, NOW)).toBe('expiring') // today is not expired
    expect(coiState(E.expiring, NOW)).toBe('expiring')
    expect(coiState(E.ok, NOW)).toBe('ok')
  })
})

describe('findDirectoryEntry', () => {
  const dir = [
    { id: 'p', company_name: 'J2 Construction Services, LLC', status: 'pending' },
    { id: 'a', company_name: 'J2 Construction Services LLC.', status: 'approved' },
    { id: 'x', company_name: 'Other Co', status: 'rejected' },
  ]
  test('sameCompany match, prefers approved', () => {
    expect(findDirectoryEntry(dir, 'j2 construction services')?.id).toBe('a')
  })
  test('falls back to any row with that name', () => {
    expect(findDirectoryEntry(dir, 'Other Co, Inc.')?.id).toBe('x')
  })
  test('blank / null name or no match → null', () => {
    expect(findDirectoryEntry(dir, '')).toBeNull()
    expect(findDirectoryEntry(dir, '   ')).toBeNull()
    expect(findDirectoryEntry(dir, null)).toBeNull()
    expect(findDirectoryEntry(dir, 'Nobody')).toBeNull()
    expect(findDirectoryEntry(undefined, 'Acme')).toBeNull()
  })
})

describe('coiBadgeModel', () => {
  test('locked labels and tones', () => {
    expect(coiBadgeModel(null, NOW)).toMatchObject({ state: 'missing', label: 'COI missing', tone: 'red' })
    expect(coiBadgeModel(E.missing, NOW)).toMatchObject({ state: 'missing', label: 'COI missing', tone: 'red' })
    expect(coiBadgeModel(E.expired, NOW)).toMatchObject({ state: 'expired', label: 'COI expired Nov 8, 2026', tone: 'red' })
    expect(coiBadgeModel(E.expiring, NOW)).toMatchObject({ state: 'expiring', label: 'COI expiring Nov 20, 2026', tone: 'amber' })
    expect(coiBadgeModel(E.noDate, NOW)).toMatchObject({ state: 'no_date', label: 'COI on file · no expiration date', tone: 'amber' })
    expect(coiBadgeModel(E.ok, NOW)).toMatchObject({ state: 'ok', label: 'COI to Mar 4, 2027', tone: 'green' })
  })
})

describe('confirm rules', () => {
  test('coiActionNeedsConfirm only missing / expired (and no match)', () => {
    expect(coiActionNeedsConfirm(null, NOW)).toBe(true)
    expect(coiActionNeedsConfirm(E.missing, NOW)).toBe(true)
    expect(coiActionNeedsConfirm(E.expired, NOW)).toBe(true)
    expect(coiActionNeedsConfirm(E.expiring, NOW)).toBe(false)
    expect(coiActionNeedsConfirm(E.noDate, NOW)).toBe(false)
    expect(coiActionNeedsConfirm(E.ok, NOW)).toBe(false)
  })
  test('coiConfirmMessage wording: company, date, verb per action', () => {
    expect(coiConfirmMessage(null, { action: 'approve', company: 'Acme' }, NOW)).toBe('COI missing for Acme. Approve anyway?')
    expect(coiConfirmMessage(E.missing, { action: 'ready', company: 'Acme' }, NOW)).toBe('COI missing for Acme. Mark ready to pay anyway?')
    expect(coiConfirmMessage(E.expired, { action: 'pay', company: 'Acme' }, NOW)).toBe('COI expired Nov 8, 2026 for Acme. Record payment anyway?')
    expect(coiConfirmMessage(E.expired, { action: 'approve', company: 'Acme' }, NOW)).toBe('COI expired Nov 8, 2026 for Acme. Approve anyway?')
    expect(coiConfirmMessage(E.expiring, { action: 'approve', company: 'Acme' }, NOW)).toBeNull()
    expect(coiConfirmMessage(E.noDate, { action: 'pay', company: 'Acme' }, NOW)).toBeNull()
    expect(coiConfirmMessage(E.ok, { action: 'ready', company: 'Acme' }, NOW)).toBeNull()
  })
  test('confirmCoiOrProceed: no prompt when ok; cancel → false; OK → true', () => {
    const never = jest.fn(() => { throw new Error('should not prompt') })
    expect(confirmCoiOrProceed(E.ok, { action: 'approve', company: 'Acme' }, never, NOW)).toBe(true)
    expect(confirmCoiOrProceed(E.expiring, { action: 'approve', company: 'Acme' }, never, NOW)).toBe(true)
    expect(never).not.toHaveBeenCalled()
    const no = jest.fn(() => false)
    expect(confirmCoiOrProceed(null, { action: 'pay', company: 'Acme' }, no, NOW)).toBe(false)
    expect(no).toHaveBeenCalledWith('COI missing for Acme. Record payment anyway?')
    const yes = jest.fn(() => true)
    expect(confirmCoiOrProceed(E.expired, { action: 'ready', company: 'Acme' }, yes, NOW)).toBe(true)
  })
})

// Body of a named function in a source file, up to the next top-level `  async function` / `  function`.
function fnBody(src, name) {
  const start = src.indexOf(`async function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  const rest = src.slice(start + 10)
  const end = rest.search(/\n  (async )?function /)
  return rest.slice(0, end === -1 ? undefined : end)
}

describe('jobdetail source', () => {
  const src = read('app/jobdetail/page.js')
  test('imports the shared helper and renders badges', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/lib\/coi-warning'/)
    expect(src).toMatch(/coiBadgeModel\(/)
    expect((src.match(/renderCoiBadge\(/g) || []).length).toBeGreaterThanOrEqual(3) // subs, contracts, billing
  })
  test('billing tab loads the sub directory', () => {
    expect(src).toMatch(/activeTab === 'billing'\) \{[^}]*loadSubDirectory\(\)/)
  })
  test('approve / ready / create / edit paths confirm COI', () => {
    const approve = fnBody(src, 'approveBilling')
    expect(approve).toMatch(/!\(await confirmBillingCoi\([^\n]*'approve'\)\)\) return/)
    expect(approve.indexOf('confirmBillingCoi')).toBeLessThan(approve.indexOf('findDuplicateBillings'))
    expect(fnBody(src, 'toggleReadyToPay')).toMatch(/if \(!current && !\(await confirmBillingCoi\([^\n]*'ready'\)\)\) return/)
    expect(fnBody(src, 'createBilling')).toMatch(/createBillingForm\.auto_approve && !\(await confirmBillingCoi\([^\n]*'approve'\)\)\) return/)
    const edit = fnBody(src, 'updateBillingEntry')
    expect(edit).toMatch(/status === 'approved' && editBillingForm\.original_status !== 'approved'/)
    expect(edit).toMatch(/await confirmBillingCoi\([^\n]*'approve'\)/)
  })
  test('owner-reimbursement recordPayment is untouched', () => {
    const i = src.indexOf('async function recordPayment(')
    if (i > -1) expect(fnBody(src, 'recordPayment')).not.toMatch(/Coi/)
  })
})

describe('admin source', () => {
  const src = read('app/admin/page.js')
  test('Record payment confirms COI before the mismatch warning', () => {
    const body = fnBody(src, 'markPaid')
    expect(body).toMatch(/confirmBillingCoi\(row, 'pay'\)/)
    expect(body.indexOf("confirmBillingCoi(row, 'pay')")).toBeLessThan(body.indexOf('req.warning &&'))
  })
  test('ready to pay confirms only when turning on', () => {
    expect(fnBody(src, 'toggleReadyToPay')).toMatch(/if \(!current && !confirmBillingCoi\([^\n]*'ready'\)\) return/)
  })
  test('billing card shows a COI badge', () => {
    expect(src).toMatch(/coiBadgeModel\(findDirectoryEntry\(directory, sub\.company_name\)\)/)
  })
})

describe('no server block / no migration', () => {
  test('billing-entry route has no COI check', () => {
    const route = read('app/api/billing-entry/route.js')
    expect(route).not.toMatch(/coi_|coiState|coi-warning/)
  })
  test('no migrations/071_*', () => {
    // Prompt 78 owns the only 071 (unapplied sales-docs bucket cap removal).
    expect(fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => f.startsWith('071_'))).toEqual(['071_remove_sales_docs_file_cap.sql'])
  })
})

// ── Prompt 72 leftover: review fixes M1, L1, L2, L5 ──

describe('L2: duplicate directory rows pick the best COI', () => {
  test('valid latest COI beats an expired approved row listed first', () => {
    const dir = [
      { id: 'old', company_name: 'Acme Drywall, LLC', status: 'approved', coi_url: 'a.pdf', coi_expiration: '2026-01-01' },
      { id: 'new', company_name: 'Acme Drywall LLC', status: 'approved', coi_url: 'b.pdf', coi_expiration: '2027-06-01' },
      { id: 'mid', company_name: 'ACME DRYWALL', status: 'approved', coi_url: 'c.pdf', coi_expiration: '2027-02-01' },
    ]
    expect(findDirectoryEntry(dir, 'Acme Drywall', NOW)?.id).toBe('new')
    expect(coiBadgeForCompany(dir, 'Acme Drywall', NOW)).toMatchObject({ state: 'ok' })
    const never = jest.fn(() => false)
    expect(confirmCoiForCompany(dir, 'Acme Drywall', 'approve', never, NOW)).toBe(true)
    expect(never).not.toHaveBeenCalled()
  })
  test('order: valid (today counts) > no date > expired latest > no file', () => {
    const noFile = { id: 'nf', company_name: 'Acme', status: 'approved', coi_url: null, coi_expiration: '2030-01-01' }
    const exp1 = { id: 'e1', company_name: 'Acme', status: 'approved', coi_url: 'x', coi_expiration: '2025-01-01' }
    const exp2 = { id: 'e2', company_name: 'Acme', status: 'approved', coi_url: 'x', coi_expiration: '2026-05-01' }
    const noDate = { id: 'nd', company_name: 'Acme', status: 'approved', coi_url: 'x', coi_expiration: null }
    const today = { id: 't', company_name: 'Acme', status: 'approved', coi_url: 'x', coi_expiration: '2026-11-09' }
    expect(findDirectoryEntry([noFile, exp1], 'Acme', NOW).id).toBe('e1')
    expect(findDirectoryEntry([noFile, exp1, exp2], 'Acme', NOW).id).toBe('e2')
    expect(findDirectoryEntry([noFile, exp2, noDate], 'Acme', NOW).id).toBe('nd')
    expect(findDirectoryEntry([noDate, exp2, today, noFile], 'Acme', NOW).id).toBe('t')
    // deterministic: same input, any order of equal-rank rows keeps first
    const nd2 = { ...noDate, id: 'nd2' }
    expect(findDirectoryEntry([noDate, nd2], 'Acme', NOW).id).toBe('nd')
  })
  test('approved preferred over a better non-approved row; same ordering on the rest', () => {
    const pendingValid = { id: 'p', company_name: 'Acme', status: 'pending', coi_url: 'x', coi_expiration: '2027-06-01' }
    const approvedExpired = { id: 'a', company_name: 'Acme', status: 'approved', coi_url: 'x', coi_expiration: '2025-06-01' }
    expect(findDirectoryEntry([pendingValid, approvedExpired], 'Acme', NOW).id).toBe('a')
    const rejNoFile = { id: 'r', company_name: 'Acme', status: 'rejected', coi_url: null }
    expect(findDirectoryEntry([rejNoFile, pendingValid], 'Acme', NOW).id).toBe('p')
  })
})

describe('M1: unloaded / failed directory → no badge, no confirm', () => {
  test('pure helpers fail open for null / undefined directory', () => {
    expect(coiBadgeForCompany(null, 'Acme', NOW)).toBeNull()
    expect(coiBadgeForCompany(undefined, 'Acme', NOW)).toBeNull()
    const never = jest.fn(() => false)
    expect(confirmCoiForCompany(null, 'Acme', 'approve', never, NOW)).toBe(true)
    expect(confirmCoiForCompany(undefined, 'Acme', 'ready', never, NOW)).toBe(true)
    expect(never).not.toHaveBeenCalled()
    // a loaded-but-empty directory is a real "missing"
    expect(coiBadgeForCompany([], 'Acme', NOW)).toMatchObject({ label: 'COI missing' })
    const no = jest.fn(() => false)
    expect(confirmCoiForCompany([], 'Acme', 'approve', no, NOW)).toBe(false)
    expect(no).toHaveBeenCalledWith('COI missing for Acme. Approve anyway?')
  })
  const src = read('app/jobdetail/page.js')
  test('jobdetail tracks a loaded flag set only on success and returns fresh rows', () => {
    expect(src).toMatch(/const \[subDirectoryLoaded, setSubDirectoryLoaded\] = useState\(false\)/)
    const body = fnBody(src, 'loadSubDirectory')
    expect(body).toMatch(/if \(error\) \{ console\.warn\([^\n]*return null \}/)
    expect(body.indexOf('setSubDirectoryLoaded(true)')).toBeGreaterThan(body.indexOf('if (error)'))
    expect(body).toMatch(/return rows/)
  })
  test('jobdetail badge renders nothing until loaded; confirm loads once then fails open', () => {
    expect(src).toMatch(/const renderCoiBadge = \(name, entry\) => \{\n\s*if \(!subDirectoryLoaded \|\|/)
    expect(src).toMatch(/const rows = subDirectoryLoaded \? subDirectory : await loadSubDirectory\(\)\n\s*return confirmCoiForCompany\(rows, company, action\)/)
  })
  test('L5: billingCoiCompany has no dead profiles fallback', () => {
    const line = src.split('\n').find(l => l.includes('const billingCoiCompany ='))
    expect(line).toBeTruthy()
    expect(line).not.toMatch(/profiles/)
  })
})

describe('L1: dashboard billing approve confirms COI', () => {
  const src = read('app/dashboard/page.js')
  test('directory loaded flag; helper fails open and skips residential', () => {
    expect(src).toMatch(/const \[directoryLoaded, setDirectoryLoaded\] = useState\(false\)/)
    expect((src.match(/else setDirectoryLoaded\(true\)/g) || []).length).toBe(2)
    const helper = fnBody(src, 'confirmBillingCoiApprove')
    expect(helper).toMatch(/isResidentialJob\(job\)\) return true/)
    expect(helper).toMatch(/let rows = directoryLoaded \? directory : null/)
    expect(helper).toMatch(/confirmCoiForCompany\(rows, companyName, 'approve'\)/)
  })
  test('updateStatus approve: COI confirm before duplicate confirm and before any fetch', () => {
    const body = fnBody(src, 'updateStatus')
    const coi = body.indexOf('await confirmBillingCoiApprove(sub.job_id, sub.company_name)')
    expect(coi).toBeGreaterThan(-1)
    expect(body).toMatch(/if \(!\(await confirmBillingCoiApprove\(sub\.job_id, sub\.company_name\)\)\) return/)
    expect(coi).toBeLessThan(body.indexOf('findDuplicateBillings'))
    // prompt 78: requests go through fetchJson(authFetch, …) / uploadThenSend({ fetchFn: authFetch })
    const firstFetch = body.search(/authFetch\(|fetchJson\(|uploadThenSend\(/)
    expect(firstFetch).toBeGreaterThan(-1)
    expect(coi).toBeLessThan(firstFetch)
  })
  test('saveBillingEdit → approved: COI confirm before any write', () => {
    const body = fnBody(src, 'saveBillingEdit')
    const coi = body.indexOf('await confirmBillingCoiApprove(')
    expect(coi).toBeGreaterThan(-1)
    expect(body).toMatch(/editBillingForm\.status === 'approved' && savedForCoi\?\.status !== 'approved'/)
    const firstFetch = body.search(/authFetch\(|fetchJson\(|uploadThenSend\(/)
    expect(firstFetch).toBeGreaterThan(-1)
    expect(coi).toBeLessThan(firstFetch)
  })
})
