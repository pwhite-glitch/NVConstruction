import { describe, it, expect } from '@jest/globals'
import { buildAttributionRows } from '../lib/sales-attribution'
import { winAnsiSafe, wrapLines } from '../lib/pdf-text'
import { ratingScoresError, rollupRatingsByCompany, averageStars } from '../lib/sub-ratings'
import { canManageOrderPortal, isValidEmail } from '../lib/customer-portal'
import { companyKey } from '../lib/company-name'
import { PDFDocument, StandardFonts } from 'pdf-lib'

describe('buildAttributionRows (set_attribution)', () => {
  const staff = [{ id: 'a', full_name: 'Ann' }, { id: 'b', full_name: 'Bob' }]
  it('builds rows from allowed fields only, names from staff', () => {
    const { rows } = buildAttributionRows('o1', [{ salesperson_id: 'a', share_pct: 60, salesperson_name: 'Hacker', id: 'x', order_id: 'other' }, { salesperson_id: 'b', share_pct: '40' }], staff, 'me')
    expect(rows).toEqual([
      { order_id: 'o1', salesperson_id: 'a', salesperson_name: 'Ann', share_pct: 60, recorded_by: 'me' },
      { order_id: 'o1', salesperson_id: 'b', salesperson_name: 'Bob', share_pct: 40, recorded_by: 'me' },
    ])
  })
  it('rejects empty, duplicate, unknown, out of range, and totals != 100', () => {
    expect(buildAttributionRows('o1', [], staff, 'me').error).toBeTruthy()
    expect(buildAttributionRows('o1', [{ salesperson_id: 'a', share_pct: 50 }, { salesperson_id: 'a', share_pct: 50 }], staff, 'me').error).toMatch(/twice/)
    expect(buildAttributionRows('o1', [{ salesperson_id: 'z', share_pct: 100 }], staff, 'me').error).toMatch(/Unknown/)
    expect(buildAttributionRows('o1', [{ salesperson_id: 'a', share_pct: 0 }, { salesperson_id: 'b', share_pct: 100 }], staff, 'me').error).toBeTruthy()
    expect(buildAttributionRows('o1', [{ salesperson_id: 'a', share_pct: 0.6 }, { salesperson_id: 'b', share_pct: 0.4 }], staff, 'me').error).toMatch(/100%/)
    expect(buildAttributionRows('o1', [{ salesperson_id: 'a', share_pct: 101 }], staff, 'me').error).toBeTruthy()
    expect(buildAttributionRows('o1', [{ salesperson_id: 'a', share_pct: 33.33 }, { salesperson_id: 'b', share_pct: 66.67 }], staff, 'me').rows).toHaveLength(2)
  })
})

describe('PDF text for Helvetica', () => {
  it('replaces tabs, maps ≥ and friends, drops emoji', () => {
    expect(winAnsiSafe('a\tb')).toBe('a    b')
    expect(winAnsiSafe('psi ≥ 30 ✓ 🔧 done')).toBe('psi >= 30 v  done')
    expect(winAnsiSafe('café “quoted” – €5\r\nnext')).toBe('café “quoted” – €5\nnext')
  })
  it('draws without throwing and breaks long words', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage()
    const lines = wrapLines('Fixed 🛠️ pump ≥ 3000 psi\there https://example.com/' + 'a'.repeat(300), font, 10, 200)
    expect(lines.every(l => font.widthOfTextAtSize(l, 10) <= 200)).toBe(true)
    for (const l of lines) page.drawText(l, { x: 10, y: 10, size: 10, font })
  })
})

describe('sub ratings helpers', () => {
  it('ratingScoresError needs all three integers 1–5', () => {
    expect(ratingScoresError({ quality: 5, timeliness: 1, communication: 3 })).toBeNull()
    expect(ratingScoresError({ quality: 5 })).toMatch(/timeliness, communication/)
    expect(ratingScoresError({ quality: 0, timeliness: 1, communication: 3 })).toMatch(/quality/)
  })
  it('rolls up by company, not by person', () => {
    const ratings = [
      { quality: 5, timeliness: 5, communication: 5, profiles: { company_id: 'c1', company_name: 'old name', invite_email: 'a@x.co' } },
      { quality: 3, timeliness: 3, communication: 3, profiles: { company_id: 'c1', company_name: 'Acme', invite_email: 'b@x.co' } },
      { quality: 4, timeliness: 4, communication: 4, profiles: { company_id: null, company_name: null, invite_email: 'Solo@x.co' } },
    ]
    const map = rollupRatingsByCompany(ratings, [{ id: 'c1', name: 'Acme Concrete, LLC' }], companyKey)
    expect(map[companyKey('Acme Concrete LLC')]).toHaveLength(2)
    expect(map['email:solo@x.co']).toHaveLength(1)
    expect(averageStars(map[companyKey('Acme Concrete')])).toBe(4)
    expect(averageStars([{ quality: 0, timeliness: 0, communication: 5 }])).toBe(0)
  })
})

describe('customer portal scope', () => {
  const order = { salesperson_id: 'r1', ops_owner_id: 'o1' }
  it('office roles: any order; reps: only their own; others: never', () => {
    for (const role of ['principal', 'pm', 'apm', 'admin']) expect(canManageOrderPortal(role, 'x', order)).toBe(true)
    expect(canManageOrderPortal('metal_rep', 'r1', order)).toBe(true)
    expect(canManageOrderPortal('roofing_rep', 'o1', order)).toBe(true)
    expect(canManageOrderPortal('metal_rep', 'r2', order)).toBe(false)
    expect(canManageOrderPortal('super', 'r1', order)).toBe(false)
    expect(canManageOrderPortal('pm', 'x', null)).toBe(false)
  })
  it('email format', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('a b@c.co')).toBe(false)
  })
})
