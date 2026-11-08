// Vehicle log types. Stored values never change (history keeps working); only the
// labels people see do. "Mileage Update" is shown as an extra / mid-week reading so
// it is not mistaken for the weekly submission the Friday reminder looks for.

export const WEEKLY_MILES = 'Weekly Miles'
export const MID_WEEK_MILES = 'Mileage Update'

const LABELS = { [MID_WEEK_MILES]: 'Extra / mid-week reading' }
export const vehicleLogLabel = t => LABELS[t] || t

// Does this week's logs satisfy the Friday mileage reminder? Any log dated on/after
// Monday with an odometer reading counts (Weekly Miles, a mid-week reading, an oil
// change with mileage…), and a Weekly Miles row counts even without one.
export function weeklyMileageLogged(logs, weekStart) {
  return (logs || []).some(l => {
    if (!l || !l.log_date || String(l.log_date).slice(0, 10) < weekStart) return false
    const hasMiles = l.mileage !== null && l.mileage !== undefined && l.mileage !== '' && Number.isFinite(Number(l.mileage))
    return hasMiles || l.log_type === WEEKLY_MILES
  })
}
