// Loose company-name key so "J2 Construction Services LLC." and
// "J2 Construction Services, LLC" match: lowercase, drop punctuation and
// common legal suffixes. Safe to import on client and server.
const SUFFIXES = new Set(['llc', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'ltd', 'company', 'pllc', 'lp', 'llp'])

export function companyKey(name) {
  const words = String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

export const sameCompany = (a, b) => !!companyKey(a) && companyKey(a) === companyKey(b)
