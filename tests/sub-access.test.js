/**
 * Tests for the sub contract-access rules in lib/sub-access.js.
 * Supabase is replaced by a tiny in-memory query builder that understands the
 * filters sub-access uses (eq, in, is, ilike, or, order, maybeSingle).
 */

let db

function parseOrPart(part) {
  const [col, op, ...rest] = part.split('.')
  const val = rest.join('.')
  if (op === 'is') return r => r[col] == null
  if (op === 'eq') return r => String(r[col]) === val
  if (op === 'neq') return r => String(r[col]) !== val
  if (op === 'ilike') return r => (r[col] || '').toLowerCase() === val.toLowerCase()
  if (op === 'in') {
    const vals = val.replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, ''))
    return r => vals.includes(String(r[col]))
  }
  throw new Error(`unsupported or() op ${op}`)
}

function mockQuery(table) {
  const filters = []
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    ilike: (c, v) => { filters.push(r => (r[c] || '').toLowerCase() === String(v).toLowerCase()); return q },
    or: expr => {
      const parts = expr.split(/,(?![^(]*\))/).map(parseOrPart)
      filters.push(r => parts.some(p => p(r)))
      return q
    },
    maybeSingle: () => Promise.resolve({ data: rows()[0] || null }),
    then: (res, rej) => Promise.resolve({ data: rows() }).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: table => mockQuery(table) }),
}))

const { getSubContracts, canAccessSubcontract, subCanSeeJob } = require('../lib/sub-access')

const me = { id: 'u1', role: 'subcontractor', company_id: 'c1', company_name: 'Evil Co', invite_email: 'me@acme.test', job_access: 'company', can_bill: true }

function seed(overrides = {}) {
  db = {
    companies: [{ id: 'c1', name: 'Acme Electric' }, { id: 'c2', name: 'Other Co' }],
    profiles: [
      { ...me, ...overrides },
      { id: 'u2', role: 'sub_pm', company_id: 'c1', company_name: 'Acme Electric', invite_email: 'mate@acme.test', job_access: 'company', can_bill: true },
      { id: 'u3', role: 'subcontractor', company_id: 'c2', company_name: 'Other Co', invite_email: 'x@other.test', job_access: 'company', can_bill: true },
    ],
    jobs: ['J1', 'J2', 'J3', 'J4'].map(id => ({ id, status: 'active', project_name: id })),
    job_assignments: [{ id: 'a1', job_id: 'J1', company_id: 'c1', sub_id: null, sub_email: null, billing_enabled: true }],
    subcontracts: [
      { id: 'k1', job_id: 'J1', company_id: 'c1', sub_id: null, vendor_name: 'Acme Electric', status: 'active' },
      { id: 'k2', job_id: 'J2', company_id: 'c2', sub_id: 'u3', vendor_name: 'Other Co', status: 'active' },
      { id: 'k3', job_id: 'J3', company_id: null, sub_id: null, vendor_name: 'Acme Electric', status: 'active' },
      { id: 'k4', job_id: 'J1', company_id: null, sub_id: null, vendor_name: 'acme electric', status: null },
      { id: 'k5', job_id: 'J1', company_id: null, sub_id: null, vendor_name: 'Evil Co', status: 'active' },
      { id: 'k6', job_id: 'J2', company_id: 'c1', sub_id: null, vendor_name: 'Acme Electric', status: 'draft' },
      { id: 'k7', job_id: 'J4', company_id: null, sub_id: 'u2', vendor_name: 'Acme Electric', status: 'active' },
      { id: 'k8', job_id: 'J2', company_id: 'c2', sub_id: 'u1', vendor_name: 'Other Co', status: 'active' },
    ],
  }
}

const auth = { userId: 'u1', email: 'me@acme.test', role: 'subcontractor', companyId: 'c1' }
const ids = async () => (await getSubContracts(auth)).map(c => c.id).sort()

describe('getSubContracts', () => {
  beforeEach(() => seed())

  it('includes own, company, teammate, and name matches on visible jobs only', async () => {
    // k1 company · k4 name match on visible J1 · k7 teammate's · k8 linked to me directly
    expect(await ids()).toEqual(['k1', 'k4', 'k7', 'k8'])
  })

  it('never matches on the user-editable profiles.company_name', async () => {
    // profile says "Evil Co" but the company is "Acme Electric": k5 (vendor "Evil Co") stays out
    expect(await ids()).not.toContain('k5')
  })

  it('excludes other companies, drafts, and name matches on jobs the user cannot see', async () => {
    const got = await ids()
    expect(got).not.toContain('k2')
    expect(got).not.toContain('k6')
    expect(got).not.toContain('k3')
  })

  it("limits a person with job_access 'assigned' to their own contracts and jobs they see", async () => {
    seed({ job_access: 'assigned' })
    // Not assigned by name anywhere, so only the contract linked to them directly
    expect(await ids()).toEqual(['k8'])
  })

  it('canAccessSubcontract agrees with the list', async () => {
    expect(await canAccessSubcontract(auth, 'k1')).toBe(true)
    expect(await canAccessSubcontract(auth, 'k2')).toBe(false)
    expect(await canAccessSubcontract(auth, null)).toBe(false)
  })
})

describe('subCanSeeJob', () => {
  beforeEach(() => seed())

  it('sees jobs the company is on, not other jobs', async () => {
    expect(await subCanSeeJob(auth, 'J1')).toBe(true)
    expect(await subCanSeeJob(auth, 'J3')).toBe(false)
    expect(await subCanSeeJob(auth, null)).toBe(false)
  })
})
