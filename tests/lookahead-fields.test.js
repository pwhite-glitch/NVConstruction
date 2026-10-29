import { describe, it, expect } from '@jest/globals'
import { cleanActivity, withoutNew033, uniqueSubOptions } from '../lib/lookahead-fields'

// What the Add Activity form sends before anything is picked
const blank = {
  lookahead_id: 'la1', planned_date: '2026-11-02', description: 'Grade pad', location: '',
  responsible_type: 'own_crew', sub_id: '', other_company_name: '', manpower: '',
  equipment: '', company_equipment_ids: [], additional_companies: [], materials_status: 'needed',
  inspection_required: false, inspection_scheduled: false, preceding_work_complete: false,
  committed: false, constraints: '', constraints_notes: '',
}

describe('cleanActivity', () => {
  it('Own Crew: empty sub_id and manpower become null', () => {
    const row = cleanActivity(blank)
    expect(row.sub_id).toBeNull()
    expect(row.manpower).toBeNull()
    expect(row.other_company_name).toBeNull()
  })

  it('Other Company keeps the company name and drops any sub', () => {
    const row = cleanActivity({ ...blank, responsible_type: 'other', other_company_name: ' Xcel Energy ', sub_id: 'c1', manpower: 3 })
    expect(row).toMatchObject({ other_company_name: 'Xcel Energy', sub_id: null, manpower: 3 })
  })

  it('Subcontractor with no sub picked saves with sub_id null', () => {
    expect(cleanActivity({ ...blank, responsible_type: 'sub' }).sub_id).toBeNull()
  })

  it('Subcontractor with a sub keeps it; manpower text becomes a number', () => {
    expect(cleanActivity({ ...blank, responsible_type: 'sub', sub_id: 'c1', manpower: '4' })).toMatchObject({ sub_id: 'c1', manpower: 4 })
  })

  it('drops columns that are not on the table (edit form sends the whole row)', () => {
    const row = cleanActivity({ ...blank, id: 'a1', created_at: 'x', lookaheads: {} })
    for (const k of ['id', 'created_at', 'lookaheads']) expect(k in row).toBe(false)
  })

  it('a partial update without responsible_type leaves sub_id alone', () => {
    expect(cleanActivity({ committed: true })).toEqual({ committed: true })
  })

  it('drops the migration 033 column for the pre-migration retry', () => {
    expect(withoutNew033({ constraints: 'x', constraints_notes: 'y' })).toEqual({ constraints_notes: 'y' })
  })
})

describe('uniqueSubOptions', () => {
  const ab1 = { id: 'c1', vendor_name: 'A&B Dirt Movers' }
  const ab2 = { id: 'c2', vendor_name: 'A&B Dirt Movers ' }
  const jj = { id: 'c3', vendor_name: 'J&J Masonry' }

  it('removes repeated ids and repeated names', () => {
    expect(uniqueSubOptions([ab1, jj, ab1, ab2])).toEqual([ab1, jj])
  })

  it('keeps the duplicate that is already selected on the activity', () => {
    expect(uniqueSubOptions([ab1, jj, ab2], 'c2')).toEqual([ab2, jj])
  })
})
