// Sub company address (prompt 102). sub_directory keeps ONE free-text `address`
// column; subs enter it as street / city / state / ZIP and it is stored composed as
// "street, City, ST 12345". Pure: no Supabase here.

export const ADDRESS_LIMITS = { street: 200, city: 100 }

const str = v => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' ? String(v) : '')
const clean = v => str(v).trim().replace(/\s+/g, ' ')

export function isBlankAddress(v) {
  return str(v).trim() === ''
}

function normZip(v) {
  const z = clean(v)
  if (/^\d{5}$/.test(z)) return z
  const m = z.match(/^(\d{5})-?(\d{4})$/)
  return m ? `${m[1]}-${m[2]}` : null
}

// null when the parts are OK, else a message for the person filling the form.
export function addressPartsError(parts) {
  const p = parts && typeof parts === 'object' && !Array.isArray(parts) ? parts : {}
  const street = clean(p.street)
  const city = clean(p.city)
  const state = clean(p.state)
  const zip = clean(p.zip)
  if (!street) return 'Street address is required.'
  if (street.length > ADDRESS_LIMITS.street) return `Street address must be ${ADDRESS_LIMITS.street} characters or fewer.`
  if (!city) return 'City is required.'
  if (city.length > ADDRESS_LIMITS.city) return `City must be ${ADDRESS_LIMITS.city} characters or fewer.`
  if (!state) return 'State is required.'
  if (!/^[A-Za-z]{2}$/.test(state)) return 'State must be the 2-letter abbreviation (e.g. TX).'
  if (!zip) return 'ZIP code is required.'
  if (!normZip(zip)) return 'ZIP code must be 5 digits (or ZIP+4).'
  return null
}

// "street, City, ST 12345". Trims each part; state upper-cased; ZIP+4 as 12345-6789.
export function composeAddress({ street, city, state, zip } = {}) {
  const st = clean(state).toUpperCase()
  const z = normZip(zip) || clean(zip)
  const tail = [st, z].filter(Boolean).join(' ')
  return [clean(street), clean(city), tail].filter(Boolean).join(', ')
}

// Best-effort split of a stored "street, city, ST zip" for prefilling the inputs.
// Anything that doesn't fit that shape → all empty.
export function parseAddress(v) {
  const empty = { street: '', city: '', state: '', zip: '' }
  const s = clean(v)
  const m = s.match(/^(.+),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-?\d{4})?)$/)
  if (!m) return empty
  return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] }
}
