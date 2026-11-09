// Retainage percent from a form/DB value: blank or invalid → the default (10),
// a real 0 stays 0, clamped to 0..100.
export function retainagePctOrDefault(v, def = 10) {
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return def
  return Math.max(0, Math.min(100, n))
}
