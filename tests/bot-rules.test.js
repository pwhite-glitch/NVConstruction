import { describe, it, expect } from '@jest/globals'
import {
  validateSubcontract, validateBilling, validateJobCompany, validateAttachment, linkedBudgetItemIds,
  safeFileName, isBotEmail, MAX_ATTACHMENT_BYTES,
} from '../lib/bot-rules'
import { isPartner, PARTNER_IDS } from '../lib/partners'

const PEYTON = 'aac9f9d3-2dad-4c82-adc2-c9785d6b52c9'
const NISHIL = 'd212ce95-68eb-496a-b50a-b95c526ff18f'
const VIVEK = 'f0cb21f1-2bbf-446e-b79b-550c9ba9c375'

describe('partner check', () => {
  it('allows exactly the three partners', () => {
    expect(PARTNER_IDS.size).toBe(3)
    for (const id of [PEYTON, NISHIL, VIVEK]) expect(isPartner(id)).toBe(true)
  })
  it('refuses anyone else, and bad input', () => {
    expect(isPartner('00000000-0000-0000-0000-000000000000')).toBe(false)
    expect(isPartner(PEYTON.toUpperCase())).toBe(false)
    expect(isPartner(` ${PEYTON}`)).toBe(false)
    expect(isPartner(undefined)).toBe(false)
    expect(isPartner(null)).toBe(false)
  })
})

describe('subcontracts: only draft or active', () => {
  const base = { job_id: 'job1', vendor_name: 'J&J Masonry', contract_value: 25350 }

  it('defaults to draft', () => {
    const { row, error } = validateSubcontract(base)
    expect(error).toBeUndefined()
    expect(row.status).toBe('draft')
    expect(row.retainage_pct).toBe(10)
  })

  it('accepts active', () => {
    expect(validateSubcontract({ ...base, status: 'active' }).row.status).toBe('active')
  })

  it.each(['approved', 'executed', 'signed', 'complete', 'void', ''])('refuses status %p', (status) => {
    expect(validateSubcontract({ ...base, status }).error).toMatch(/draft' or 'active/)
  })

  it('refuses fields a bot must not set', () => {
    expect(validateSubcontract({ ...base, signed_contract_url: 'contracts/x.pdf' }).error).toMatch(/signed_contract_url/)
    expect(validateSubcontract({ ...base, created_by: 'someone' }).error).toMatch(/created_by/)
    expect(validateSubcontract({ ...base, activated_at: 'now' }).error).toMatch(/activated_at/)
  })

  it('requires job, vendor or company, and a valid value', () => {
    expect(validateSubcontract({ ...base, job_id: '' }).error).toMatch(/job_id/)
    expect(validateSubcontract({ job_id: 'j', contract_value: 1 }).error).toMatch(/company_id or vendor_name/)
    expect(validateSubcontract({ ...base, contract_value: 'abc' }).error).toMatch(/contract_value/)
    expect(validateSubcontract({ ...base, contract_value: -5 }).error).toMatch(/contract_value/)
    expect(validateSubcontract({ ...base, retainage_pct: 150 }).error).toMatch(/retainage_pct/)
    expect(validateSubcontract(null).error).toBeTruthy()
    expect(validateSubcontract([base]).error).toBeTruthy()
  })

  it('links budget lines like the job page (one allocation also sets budget_item_id)', () => {
    const one = validateSubcontract({ ...base, budget_allocations: [{ budget_item_id: 'b1', amount: '25350' }] }).row
    expect(one.budget_item_id).toBe('b1')
    expect(one.budget_allocations).toEqual([{ budget_item_id: 'b1', amount: 25350 }])
    const two = validateSubcontract({ ...base, budget_allocations: [{ budget_item_id: 'b1', amount: 1 }, { budget_item_id: 'b2', amount: 2 }] }).row
    expect(two.budget_item_id).toBeNull()
    expect(linkedBudgetItemIds(two)).toEqual(['b1', 'b2'])
    expect(linkedBudgetItemIds(validateSubcontract({ ...base, budget_item_id: 'b9' }).row)).toEqual(['b9'])
    expect(validateSubcontract({ ...base, budget_allocations: [{ budget_item_id: 'b1', amount: 0 }] }).error).toMatch(/amount/)
    expect(validateSubcontract({ ...base, budget_allocations: 'b1' }).error).toMatch(/array/)
  })
})

describe('billings: no draw, pending only', () => {
  const base = { job_id: 'job1', company_name: 'J&J Masonry', amount_billed: 25350, retainage_held: 2535 }

  it('creates a pending billing', () => {
    const { row, error } = validateBilling(base)
    expect(error).toBeUndefined()
    expect(row).toEqual({ ...base, status: 'pending' })
  })

  it.each(['draw_request_id', 'draw_id', 'draw_request', 'draw', 'DrawRequestId'])('refuses %p', (field) => {
    expect(validateBilling({ ...base, [field]: 'draw1' }).error).toMatch(/draw/)
  })

  it('refuses a draw field even when null', () => {
    expect(validateBilling({ ...base, draw_request_id: null }).error).toMatch(/draw/)
  })

  it.each(['approved', 'rejected', 'paid'])('refuses status %p', (status) => {
    expect(validateBilling({ ...base, status }).error).toMatch(/pending/)
  })

  it('refuses approval / payment fields', () => {
    for (const k of ['reviewed_at', 'ready_to_pay', 'paid_at', 'lien_waiver_signed_at', 'doc_url']) {
      expect(validateBilling({ ...base, [k]: 'x' }).error).toMatch(k)
    }
  })

  it('requires job_id and a numeric amount', () => {
    expect(validateBilling({ ...base, job_id: undefined }).error).toMatch(/job_id/)
    expect(validateBilling({ ...base, amount_billed: 'lots' }).error).toMatch(/amount_billed/)
    expect(validateBilling({ ...base, pct_complete: 'half' }).error).toMatch(/pct_complete/)
  })
})

describe('job companies and attachments', () => {
  it('job-companies takes job_id and company_id only', () => {
    expect(validateJobCompany({ job_id: 'j', company_id: 'c' }).row).toEqual({ job_id: 'j', company_id: 'c' })
    expect(validateJobCompany({ job_id: 'j' }).error).toBeTruthy()
    expect(validateJobCompany({ job_id: 'j', company_id: 'c', billing_enabled: true }).error).toMatch(/billing_enabled/)
    expect(validateJobCompany({ job_id: 'j', company_id: 'c', notify: true }).error).toMatch(/notify/)
  })

  it('attachments: category, size limit, safe file name', () => {
    expect(validateAttachment({ job_id: 'j', fileName: 'a.pdf', size: 10 }).row.category).toBe('other')
    expect(validateAttachment({ job_id: 'j', category: 'bogus', fileName: 'a.pdf', size: 10 }).error).toMatch(/category/)
    const big = validateAttachment({ job_id: 'j', category: 'plans', fileName: 'a.pdf', size: MAX_ATTACHMENT_BYTES + 1 })
    expect(big.status).toBe(413)
    expect(validateAttachment({ job_id: 'j', fileName: 'a.pdf', size: 0 }).error).toMatch(/file required/)
    expect(safeFileName('../../etc/passwd')).not.toMatch(/\.\.|\//)
    expect(safeFileName('Plans Rev 3 (final).pdf')).toBe('Plans Rev 3 _final_.pdf')
  })

  it('recognises bot emails', () => {
    expect(isBotEmail('bot-peyton@bots.nv.construction')).toBe(true)
    expect(isBotEmail('BOT-VIVEK@BOTS.NV.CONSTRUCTION')).toBe(true)
    expect(isBotEmail('peyton@nvim.co')).toBe(false)
    expect(isBotEmail('x@notbots.nv.construction')).toBe(false)
    expect(isBotEmail(null)).toBe(false)
  })
})
