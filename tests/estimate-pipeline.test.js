import { isConverted, isWonStatus, wonEstimates, wonColumnEstimates } from '../lib/estimate-pipeline'

describe('isConverted', () => {
  test('converted via estimate.job_id', () => {
    expect(isConverted({ id: 'e1', job_id: 'j1' }, [])).toBe(true)
  })

  test('converted via job.source_estimate_id', () => {
    const jobs = [{ id: 'j9', source_estimate_id: 'other' }, { id: 'j2', source_estimate_id: 'e1' }]
    expect(isConverted({ id: 'e1', job_id: null }, jobs)).toBe(true)
  })

  test('not converted', () => {
    const jobs = [{ id: 'j1', source_estimate_id: 'e2' }, { id: 'j3', source_estimate_id: null }]
    expect(isConverted({ id: 'e1', job_id: null }, jobs)).toBe(false)
    expect(isConverted({ id: 'e1' }, undefined)).toBe(false)
  })
})

describe('won column vs. won history', () => {
  const estimates = [
    { id: 'a', status: 'won', job_id: 'j1' },          // converted via job_id
    { id: 'b', status: 'accepted', job_id: null },     // converted via source_estimate_id
    { id: 'c', status: 'won', job_id: null },          // won, not yet a job
    { id: 'd', status: 'lost' },
    { id: 'e', status: 'negotiating' },
  ]
  const jobs = [{ id: 'j1', source_estimate_id: 'a' }, { id: 'j2', source_estimate_id: 'b' }]

  test('WON column excludes converted estimates', () => {
    expect(wonColumnEstimates(estimates, jobs).map(e => e.id)).toEqual(['c'])
  })

  test('Won YTD / win-rate count includes converted estimates', () => {
    const won = wonEstimates(estimates)
    expect(won.map(e => e.id)).toEqual(['a', 'b', 'c'])
    const lost = estimates.filter(e => e.status === 'lost')
    expect(Math.round(won.length / (won.length + lost.length) * 100)).toBe(75)
  })

  test('isWonStatus matches won/accepted only', () => {
    expect(isWonStatus({ status: 'Won' })).toBe(true)
    expect(isWonStatus({ status: 'accepted' })).toBe(true)
    expect(isWonStatus({ status: 'bid_out' })).toBe(false)
  })
})
