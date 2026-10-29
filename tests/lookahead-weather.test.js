import { describe, it, expect } from '@jest/globals'
import {
  jobCoords, jobPlace, pickGeocodeResult, parseForecast, isRainRisk, looksOutdoor, rainFlagged, weatherLabel, forecastText,
} from '../lib/lookahead-weather'

describe('job location', () => {
  it('uses lat/lng already on the job', () => {
    expect(jobCoords({ latitude: '46.87', longitude: '-96.79' })).toEqual({ lat: 46.87, lng: -96.79 })
    expect(jobCoords({ lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2 })
    expect(jobCoords({ location: 'Fargo, ND' })).toBeNull()
  })

  it('reads city and state from the location text', () => {
    expect(jobPlace({ location: 'Fargo, ND' })).toEqual({ name: 'Fargo', region: 'North Dakota' })
    expect(jobPlace({ location: '123 Main St, West Fargo, ND 58078' })).toEqual({ name: 'West Fargo', region: 'North Dakota' })
    expect(jobPlace({ location: 'Moorhead MN' })).toEqual({ name: 'Moorhead', region: 'Minnesota' })
    expect(jobPlace({ location: 'Bismarck' })).toEqual({ name: 'Bismarck', region: null })
    expect(jobPlace({ city: 'Fargo', state: 'North Dakota' })).toEqual({ name: 'Fargo', region: 'North Dakota' })
    expect(jobPlace({ location: '' })).toBeNull()
  })

  it('picks the geocoding hit in the job state', () => {
    const results = [
      { name: 'Fargo', admin1: 'Georgia', country_code: 'US', latitude: 30.6, longitude: -82.5 },
      { name: 'Fargo', admin1: 'North Dakota', country_code: 'US', latitude: 46.87, longitude: -96.79 },
    ]
    expect(pickGeocodeResult(results, 'North Dakota')).toMatchObject({ lat: 46.87, lng: -96.79, label: 'Fargo, North Dakota' })
    expect(pickGeocodeResult(results, null)).toMatchObject({ lat: 30.6 })
    expect(pickGeocodeResult([], 'North Dakota')).toBeNull()
  })
})

describe('forecast', () => {
  const json = {
    daily: {
      time: ['2026-11-02', '2026-11-03'],
      weather_code: [0, 63],
      temperature_2m_max: [55.4, 48.6],
      temperature_2m_min: [33.2, 38.9],
      precipitation_probability_max: [10, 70],
    },
  }

  it('parses Open-Meteo daily data', () => {
    const days = parseForecast(json)
    expect(days['2026-11-02']).toMatchObject({ high: 55, low: 33, precip: 10, label: 'Clear' })
    expect(days['2026-11-03']).toMatchObject({ high: 49, low: 39, precip: 70, label: 'Rain' })
    expect(forecastText(days['2026-11-03'])).toBe('49°/39° · 70%')
  })

  it('handles a bad response', () => {
    expect(parseForecast(null)).toEqual({})
    expect(parseForecast({ error: true })).toEqual({})
  })

  it('weather codes', () => {
    expect(weatherLabel(95).label).toBe('Thunderstorms')
    expect(weatherLabel(73).label).toBe('Snow')
  })
})

describe('rain risk', () => {
  it('flags a day at 50% or more', () => {
    expect(isRainRisk({ precip: 50 })).toBe(true)
    expect(isRainRisk({ precip: 49 })).toBe(false)
    expect(isRainRisk({ precip: null })).toBe(false)
    expect(isRainRisk(undefined)).toBe(false)
  })

  it('outdoor-looking activities', () => {
    expect(looksOutdoor({ description: 'Pour slab' })).toBe(true)
    expect(looksOutdoor({ description: 'Excavation for footings' })).toBe(true)
    expect(looksOutdoor({ description: 'Install shingles', location: 'Roof' })).toBe(true)
    expect(looksOutdoor({ description: 'Hang drywall', location: 'Level 2' })).toBe(false)
    expect(looksOutdoor({ description: 'Interior demo' })).toBe(false)
    expect(looksOutdoor({ description: 'Paint', location: 'Exterior north wall' })).toBe(true)
  })

  it('highlights outdoor work only on rain-risk days', () => {
    expect(rainFlagged({ description: 'Pour slab' }, { precip: 70 })).toBe(true)
    expect(rainFlagged({ description: 'Pour slab' }, { precip: 20 })).toBe(false)
    expect(rainFlagged({ description: 'Hang drywall' }, { precip: 90 })).toBe(false)
    expect(rainFlagged({ description: 'Pour slab' }, undefined)).toBe(false)
  })
})
