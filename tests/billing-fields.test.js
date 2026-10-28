import { describe, it, expect } from '@jest/globals'
import { PM_INSERT_FIELDS, PM_PATCH_FIELDS, SUB_INSERT_FIELDS, SUB_PATCH_FIELDS, pickFields, withoutNew032 } from '../lib/billing-fields'
import { pickSignerContact } from '../lib/signer-contact'

// What the job page sends when a PM creates or edits a billing (J&J Masonry, $25,350 on #7545)
const pmRow = {
  job_id: 'job7545', sub_id: null, company_name: 'J&J Masonry', contact_name: 'Jim J', contact_info: '479-555-0100',
  amount_billed: 25350, retainage_pct: 10, retainage_held: 2535, pct_complete: 50,
  work_description: 'Block walls to roof deck', invoice_number: 'INV-1042', invoice_date: '2026-10-20',
  billing_period: '2026-10-01', draw_request_id: 'draw1', status: 'pending', submitted_at: 'now', reviewed_at: null,
}

describe('billing field whitelists', () => {
  it('keeps everything the PM create form sends', () => {
    expect(pickFields(pmRow, PM_INSERT_FIELDS)).toEqual(pmRow)
  })

  it('keeps everything the PM edit form sends', () => {
    const { job_id, sub_id, submitted_at, draw_request_id, ...patch } = pmRow
    expect(pickFields(patch, PM_PATCH_FIELDS)).toEqual(patch)
  })

  it('PM patch without doc_url leaves the attachment alone', () => {
    expect('doc_url' in pickFields({ work_description: 'x' }, PM_PATCH_FIELDS)).toBe(false)
  })

  it('subs still cannot set status, company or contact fields', () => {
    const picked = { ...pickFields(pmRow, SUB_INSERT_FIELDS), ...pickFields(pmRow, SUB_PATCH_FIELDS) }
    for (const k of ['status', 'company_name', 'contact_name', 'sub_id', 'reviewed_at']) expect(k in picked).toBe(false)
  })

  it('drops columns from migration 032 for the pre-migration retry', () => {
    expect(withoutNew032({ invoice_number: 'INV-1', invoice_date: '2026-10-20' })).toEqual({ invoice_number: 'INV-1' })
  })
})

describe('pickSignerContact', () => {
  const contract = { id: 'c1', vendor_name: 'J&J Masonry LLC', sub_id: null, company_id: 'co1' }
  const directory = [{ company_name: 'J & J Masonry', contact_name: 'Jim Jones', email: 'jim@jjmasonry.com' }]

  it('uses the sub user on the contract first', () => {
    const assignments = [{ sub_id: 'u1', sub_email: 'office@jjmasonry.com', profiles: { full_name: 'Jane Jones' } }]
    expect(pickSignerContact({ contract: { ...contract, sub_id: 'u1' }, assignments, company: { email: 'co@jj.com' }, directory }))
      .toEqual({ name: 'Jane Jones', email: 'office@jjmasonry.com' })
  })

  it('then the company email on file, with the directory contact name', () => {
    expect(pickSignerContact({ contract, company: { name: 'J&J Masonry', email: 'co@jj.com' }, directory }))
      .toEqual({ name: 'Jim Jones', email: 'co@jj.com' })
  })

  it('then the sub directory contact', () => {
    expect(pickSignerContact({ contract, company: { name: 'J&J Masonry', email: null }, directory }))
      .toEqual({ name: 'Jim Jones', email: 'jim@jjmasonry.com' })
  })

  it('returns blanks when nothing is on file', () => {
    expect(pickSignerContact({ contract: { vendor_name: 'Nobody' } })).toEqual({ name: '', email: '' })
  })
})
