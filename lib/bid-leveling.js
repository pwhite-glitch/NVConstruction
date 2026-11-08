// Bid leveling rules shared by the dashboard Compare step, the full bid page
// (/bid/[id]) and /api/bid-leveling. No imports.
//
//  • Blank means "not quoted" (amount null) everywhere; 0 is a real $0 quote.
//  • included defaults to true. An empty cell's first toggle click marks it
//    INCLUDED; after that the toggle flips included ⇄ excluded.
//  • Leveled total per bidder = sum of amounts on included lines (excluded lines
//    and blanks add nothing). "vs bid" compares that to the bidder's quote.
//  • Gap = a scope item every active bidder has marked excluded.
//  • Scope items with no trade are grouped as "General".

export const GENERAL_TRADE = 'General'

export const levelingKey = (subId, itemId) => `${subId}_${itemId}`

// '' / null / undefined / whitespace → null (not quoted). Otherwise a finite number
// rounded to cents, or { error } for junk.
export function parseLevelingAmount(v) {
  if (v === null || v === undefined) return { amount: null }
  const s = String(v).replace(/[$,\s]/g, '')
  if (s === '') return { amount: null }
  const n = Number(s)
  if (!Number.isFinite(n)) return { error: 'Enter a dollar amount.' }
  return { amount: Math.round(n * 100) / 100 }
}

export const isIncluded = entry => !!entry && entry.included !== false
export const isExcluded = entry => !!entry && entry.included === false

// What `included` becomes when the toggle is clicked. No entry yet → included.
export const nextIncluded = entry => (entry ? entry.included === false : true)

export function entryMap(entries = []) {
  const m = {}
  for (const e of entries) m[levelingKey(e.bid_submission_id, e.bid_scope_item_id)] = e
  return m
}

// Included, quoted amount for one cell (0 when excluded or not quoted).
export function cellValue(entry) {
  if (!entry || entry.included === false) return 0
  const n = entry.amount === null || entry.amount === undefined || entry.amount === '' ? 0 : Number(entry.amount)
  return Number.isFinite(n) ? n : 0
}

export function leveledTotal(sub, items, map) {
  return Math.round(items.reduce((a, it) => a + cellValue(map[levelingKey(sub.id, it.id)]), 0) * 100) / 100
}

// Has any included cell got an amount (so "vs bid" means something)?
export function hasLeveledAmounts(sub, items, map) {
  return items.some(it => { const e = map[levelingKey(sub.id, it.id)]; return isIncluded(e) && e.amount !== null && e.amount !== undefined && e.amount !== '' })
}

export function gapItems(items, subs, map) {
  if (!subs.length) return []
  return items.filter(it => subs.every(sub => isExcluded(map[levelingKey(sub.id, it.id)])))
}

// [[trade, items]] in first-seen order, untraded items last as "General".
export function groupByTrade(items = []) {
  const groups = new Map()
  for (const it of items) {
    const t = (it.trade && String(it.trade).trim()) || GENERAL_TRADE
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(it)
  }
  const out = [...groups.entries()].filter(([t]) => t !== GENERAL_TRADE)
  if (groups.has(GENERAL_TRADE)) out.push([GENERAL_TRADE, groups.get(GENERAL_TRADE)])
  return out
}

// Bidders shown on a trade's rows: those who bid that trade, plus all-trade bidders
// (no trade on the submission). "General" rows show everyone.
export function subsForTrade(subs = [], trade) {
  if (trade === GENERAL_TRADE) return subs
  return subs.filter(s => !s.trade || s.trade === trade)
}

// Active bidders for the matrix: not rejected, with a quote.
export const levelingSubs = (submissions = []) => submissions.filter(s => s.status !== 'rejected')
