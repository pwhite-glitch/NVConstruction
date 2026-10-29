import { describe, it, expect } from '@jest/globals'
import {
  cleanActivity, uniqueSubOptions, activityProblem, validateActivity, writeWithFallback, droppedWarning, missingColumn,
  subName, responsibleLabel, hasOpenConstraint, copyableActivity, lookaheadStage, stageHistory,
} from '../lib/lookahead-fields'

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

  it('trims the description', () => {
    expect(cleanActivity({ ...blank, description: '  Grade pad  ' }).description).toBe('Grade pad')
  })

  it('a one-day activity keeps end_date null', () => {
    expect(cleanActivity({ ...blank, end_date: '' }).end_date).toBeNull()
    expect(cleanActivity({ ...blank, end_date: '2026-11-02' }).end_date).toBeNull()
    expect(cleanActivity({ ...blank, end_date: '2026-11-04' }).end_date).toBe('2026-11-04')
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

describe('activityProblem (form hint) and validateActivity (server)', () => {
  it('a description of only spaces is blank', () => {
    expect(activityProblem({ ...blank, description: '   ' })).toMatch(/description/i)
    expect(validateActivity(cleanActivity({ ...blank, description: '   ' }))).toMatch(/description/i)
  })

  it('Subcontractor needs a sub picked', () => {
    expect(activityProblem({ ...blank, responsible_type: 'sub' })).toMatch(/subcontractor/i)
    expect(validateActivity(cleanActivity({ ...blank, responsible_type: 'sub' }))).toMatch(/subcontractor/i)
    expect(validateActivity(cleanActivity({ ...blank, responsible_type: 'sub', sub_id: 'c1' }))).toBeNull()
  })

  it('end date before start is rejected', () => {
    expect(activityProblem({ ...blank, end_date: '2026-11-01' })).toMatch(/end date/i)
    expect(validateActivity(cleanActivity({ ...blank, end_date: '2026-11-01' }))).toMatch(/end date/i)
  })

  it('a valid form has no problem', () => {
    expect(activityProblem(blank)).toBeNull()
    expect(validateActivity(cleanActivity(blank))).toBeNull()
  })

  it('partial updates (status tap, move) only check what is sent', () => {
    expect(validateActivity({ status: 'done' }, { partial: true })).toBeNull()
    expect(validateActivity({ status: 'finished' }, { partial: true })).toMatch(/status/i)
    expect(validateActivity({ planned_date: '2026-11-03', end_date: null }, { partial: true })).toBeNull()
    expect(validateActivity({ description: '' }, { partial: true })).toMatch(/description/i)
  })
})

describe('sub names and labels', () => {
  const contracts = [{ id: 'c1', vendor_name: 'SFS ' }, { id: 'c2', vendor_name: 'Paladino-Nash Inc. ' }]
  it('trims trailing spaces', () => {
    expect(contracts.map(subName)).toEqual(['SFS', 'Paladino-Nash Inc.'])
    expect(responsibleLabel({ responsible_type: 'sub', sub_id: 'c2' }, contracts)).toBe('Paladino-Nash Inc.')
  })
  it('legacy sub activity with no sub says so', () => {
    expect(responsibleLabel({ responsible_type: 'sub', sub_id: null }, contracts)).toBe('Sub (not picked)')
  })
})

describe('open constraints', () => {
  it('a constraint is open until the activity is Done', () => {
    expect(hasOpenConstraint({ constraints: 'Waiting on permit', status: 'in_progress' })).toBe(true)
    expect(hasOpenConstraint({ constraints: 'Waiting on permit', status: 'done' })).toBe(false)
    expect(hasOpenConstraint({ constraints: '  ' })).toBe(false)
  })
})

describe('copyableActivity (Duplicate)', () => {
  it('drops id and lookahead link, resets status', () => {
    const copy = copyableActivity({ ...blank, id: 'a1', status: 'done', carried_from_id: 'x' })
    expect(copy).not.toHaveProperty('id')
    expect(copy).not.toHaveProperty('lookahead_id')
    expect(copy).not.toHaveProperty('carried_from_id')
    expect(copy).toMatchObject({ status: 'not_started', description: 'Grade pad', planned_date: '2026-11-02' })
  })
})

describe('writeWithFallback (migrations not applied yet)', () => {
  const missing = col => ({ message: `Could not find the '${col}' column of 'lookahead_activities' in the schema cache` })

  it('reads the missing column out of the error', () => {
    expect(missingColumn(missing('end_date').message)).toBe('end_date')
    expect(missingColumn('some other error')).toBeNull()
  })

  it('drops missing columns one at a time and retries', async () => {
    const seen = []
    const write = async row => {
      seen.push(Object.keys(row))
      if ('end_date' in row) return { error: missing('end_date') }
      if ('status' in row) return { error: missing('status') }
      return { data: row, error: null }
    }
    const { data, error, dropped } = await writeWithFallback(write, { description: 'x', end_date: '2026-11-04', status: 'done' })
    expect(error).toBeNull()
    expect(dropped).toEqual(['end_date', 'status'])
    expect(data).toEqual({ description: 'x' })
    expect(seen).toHaveLength(3)
  })

  it('works on an array of rows', async () => {
    const write = async rows => rows.some(r => 'carried_from_id' in r) ? { error: missing('carried_from_id') } : { data: rows, error: null }
    const { data } = await writeWithFallback(write, [{ a: 1, carried_from_id: 'x' }, { a: 2, carried_from_id: 'y' }])
    expect(data).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('does not retry for columns that are not pending migrations', async () => {
    let calls = 0
    const { error } = await writeWithFallback(async () => { calls++; return { error: missing('bogus') } }, { bogus: 1 })
    expect(error).toBeTruthy()
    expect(calls).toBe(1)
  })

  it('warns only about values that were actually lost', () => {
    expect(droppedWarning(['end_date', 'status'], { end_date: null, status: 'not_started' })).toBeUndefined()
    expect(droppedWarning(['end_date'], { end_date: '2026-11-04' })).toMatch(/End date was not saved \(migration 035/)
    expect(droppedWarning(['constraints', 'status'], { constraints: 'x', status: 'done' })).toMatch(/033, 035/)
  })
})

describe('lookahead workflow stage', () => {
  it('Draft > Submitted > Approved > Sent', () => {
    expect(lookaheadStage({ status: 'draft' })).toBe('draft')
    expect(lookaheadStage({ status: 'submitted' })).toBe('submitted')
    expect(lookaheadStage({ status: 'approved', approved_at: '2026-11-02T10:00:00+00:00' })).toBe('approved')
    expect(lookaheadStage({ status: 'approved', approved_at: '2026-11-02T10:00:00+00:00', sent_to_subs_at: '2026-11-02T11:00:00+00:00' })).toBe('sent')
  })

  it('re-approved after a send shows Approved again', () => {
    expect(lookaheadStage({ status: 'approved', sent_to_subs_at: '2026-11-02T11:00:00+00:00', approved_at: '2026-11-03T09:00:00+00:00' })).toBe('approved')
  })

  it('history lists who and when', () => {
    const h = stageHistory({ status: 'approved', submitted_at: 't1', submitted_by_name: 'Landon', approved_at: 't2', approved_by_name: 'Peyton' })
    expect(h.map(x => [x.label, x.who])).toEqual([['Submitted', 'Landon'], ['Approved', 'Peyton']])
  })
})
