// When a field photo was taken, and the Central calendar day it belongs to.
//
// compressImage re-encodes through a canvas, which strips EXIF (DateTimeOriginal,
// GPS). So the capture time is read from the ORIGINAL File before compressing:
//   EXIF DateTimeOriginal → DateTimeDigitized → DateTime  (JPEG only)
//   → file.lastModified → now.
// HEIC/HEIF is detected and skipped (no EXIF parse), never a crash.
//
// Browser-safe and dependency-free: a small hand-written JPEG APP1/TIFF reader.
// job_photos.created_at stays the upload time (DB default now()); taken_at is the
// capture time. Display/grouping uses photoDateCentral (America/Chicago), so a photo
// taken after 6 PM Central is not labeled as the next (UTC) day.

import { todayCentral } from './central-date'

const TIME_ZONE = 'America/Chicago'
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const EMPTY = () => ({ dateTimeOriginal: null, dateTimeDigitized: null, dateTime: null, offsetTimeOriginal: null, offsetTime: null, gps: null })

function toBytes(buffer) {
  if (!buffer) return null
  if (buffer instanceof Uint8Array) return buffer
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer)
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  return null
}

// Read the TIFF block (starting at the byte-order mark) for the tags we need.
function readTiff(b, start, end) {
  const out = EMPTY()
  const len = end - start
  if (len < 8) return out
  const bo = String.fromCharCode(b[start], b[start + 1])
  const le = bo === 'II'
  if (!le && bo !== 'MM') return out
  const u16 = o => (o < 0 || o + 2 > len ? null : le ? b[start + o] | (b[start + o + 1] << 8) : (b[start + o] << 8) | b[start + o + 1])
  const u32 = o => {
    if (o < 0 || o + 4 > len) return null
    const [x0, x1, x2, x3] = [b[start + o], b[start + o + 1], b[start + o + 2], b[start + o + 3]]
    return (le ? (x3 << 24) | (x2 << 16) | (x1 << 8) | x0 : (x0 << 24) | (x1 << 16) | (x2 << 8) | x3) >>> 0
  }
  if (u16(2) !== 42) return out

  // { tag: { type, count, valueOffset } } for one IFD; valueOffset is where the value
  // bytes live (inline in the entry when they fit in 4 bytes).
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
  function readIfd(off) {
    const entries = {}
    const n = u16(off)
    if (n == null || n > 1000) return entries
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4)
      if (tag == null || type == null || count == null) break
      const size = (TYPE_SIZE[type] || 0) * count
      const valueOffset = size <= 4 ? e + 8 : u32(e + 8)
      if (valueOffset == null || valueOffset + size > len) continue
      entries[tag] = { type, count, valueOffset }
    }
    return entries
  }
  const ascii = ent => {
    if (!ent || ent.type !== 2) return null
    let s = ''
    for (let i = 0; i < ent.count; i++) {
      const c = b[start + ent.valueOffset + i]
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    s = s.trim()
    return s || null
  }
  const longVal = ent => (!ent ? null : ent.type === 4 ? u32(ent.valueOffset) : ent.type === 3 ? u16(ent.valueOffset) : null)
  const rationals = ent => {
    if (!ent || ent.type !== 5) return null
    const vals = []
    for (let i = 0; i < ent.count; i++) {
      const num = u32(ent.valueOffset + i * 8), den = u32(ent.valueOffset + i * 8 + 4)
      if (num == null || !den) return null
      vals.push(num / den)
    }
    return vals
  }

  const ifd0Off = u32(4)
  if (ifd0Off == null) return out
  const ifd0 = readIfd(ifd0Off)
  out.dateTime = ascii(ifd0[0x0132])

  const exifOff = longVal(ifd0[0x8769])
  if (exifOff != null) {
    const exif = readIfd(exifOff)
    out.dateTimeOriginal = ascii(exif[0x9003])
    out.dateTimeDigitized = ascii(exif[0x9004])
    out.offsetTime = ascii(exif[0x9010])
    out.offsetTimeOriginal = ascii(exif[0x9011])
  }

  const gpsOff = longVal(ifd0[0x8825])
  if (gpsOff != null) {
    const g = readIfd(gpsOff)
    const latRef = ascii(g[0x0001]), lat = rationals(g[0x0002])
    const lngRef = ascii(g[0x0003]), lng = rationals(g[0x0004])
    const deg = v => (v && v.length >= 1 ? v[0] + (v[1] || 0) / 60 + (v[2] || 0) / 3600 : null)
    let la = deg(lat), lo = deg(lng)
    if (la != null && lo != null) {
      if (/^S/i.test(latRef || '')) la = -la
      if (/^W/i.test(lngRef || '')) lo = -lo
      if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) out.gps = { lat: la, lng: lo }
    }
  }
  return out
}

// Hand-written JPEG APP1 Exif reader. Never throws; unknown / truncated input → nulls.
// Returns { dateTimeOriginal, dateTimeDigitized, dateTime, offsetTimeOriginal, offsetTime, gps }.
export function parseJpegExif(buffer) {
  try {
    const b = toBytes(buffer)
    if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return EMPTY()
    let i = 2
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return EMPTY()
      const marker = b[i + 1]
      if (marker === 0xff) { i++; continue } // fill byte
      if (marker === 0xd9 || marker === 0xda) break // EOI / start of scan: no more metadata
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue } // no length
      const segLen = (b[i + 2] << 8) | b[i + 3]
      if (segLen < 2) return EMPTY()
      const segStart = i + 4, segEnd = Math.min(i + 2 + segLen, b.length)
      if (marker === 0xe1 && segEnd - segStart >= 6 &&
          b[segStart] === 0x45 && b[segStart + 1] === 0x78 && b[segStart + 2] === 0x69 && b[segStart + 3] === 0x66 &&
          b[segStart + 4] === 0 && b[segStart + 5] === 0) {
        return readTiff(b, segStart + 6, segEnd)
      }
      i += 2 + segLen
    }
  } catch {
    // fall through
  }
  return EMPTY()
}

// ISO-BMFF ftyp box with a HEIC/HEIF brand (iPhone photos). Detected so we skip EXIF
// rather than misparse; a full HEIC parse is out of scope.
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'heif', 'mif1', 'msf1', 'avif'])
export function isHeicLike(buffer) {
  try {
    const b = toBytes(buffer)
    if (!b || b.length < 12) return false
    const str = (o, n) => String.fromCharCode(...b.subarray(o, o + n))
    if (str(4, 4) !== 'ftyp') return false
    const boxLen = Math.min(((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0 || b.length, b.length, 64)
    if (HEIC_BRANDS.has(str(8, 4).toLowerCase())) return true
    for (let o = 16; o + 4 <= boxLen; o += 4) if (HEIC_BRANDS.has(str(o, 4).toLowerCase())) return true
  } catch {
    // fall through
  }
  return false
}

let wallFmt = null
function chicagoWall(ms) {
  wallFmt = wallFmt || new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p = {}
  for (const x of wallFmt.formatToParts(new Date(ms))) p[x.type] = x.value
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
}

// Exif 'YYYY:MM:DD HH:MM:SS' has no zone. With an Exif offset ('+05:30' / '-06:00')
// use it; otherwise treat the wall clock as America/Chicago. → ISO UTC, or null.
export function exifNaiveToIso(exifStr, { offset } = {}) {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(exifStr || '').trim())
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  const back = new Date(wall)
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null // e.g. Feb 30

  const om = /^([+-])(\d{2}):?(\d{2})$/.exec(String(offset || '').trim())
  if (om) {
    const mins = (om[1] === '-' ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3]))
    if (Math.abs(mins) <= 14 * 60) return new Date(wall - mins * 60000).toISOString()
  }
  // Central is UTC-5 (CDT) or UTC-6 (CST). Pick the one that maps back to this wall
  // clock; in the fall-back hour both do (take CDT); in the spring-forward gap neither
  // does (use CST, i.e. the clock jumped).
  for (const hrs of [5, 6]) {
    const t = wall + hrs * 3600000
    if (chicagoWall(t) === wall) return new Date(t).toISOString()
  }
  return new Date(wall + 6 * 3600000).toISOString()
}

// { takenAt: ISO, source: 'exif' | 'lastModified' | 'now', gps: { lat, lng } | null }
export async function resolveTakenAt(file, now = new Date()) {
  let gps = null
  try {
    const buf = file && typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : null
    const bytes = toBytes(buf)
    if (bytes && bytes[0] === 0xff && bytes[1] === 0xd8) {
      const ex = parseJpegExif(bytes)
      gps = ex.gps
      const candidates = [
        [ex.dateTimeOriginal, ex.offsetTimeOriginal || ex.offsetTime],
        [ex.dateTimeDigitized, ex.offsetTime],
        [ex.dateTime, ex.offsetTime],
      ]
      for (const [str, offset] of candidates) {
        const iso = str ? exifNaiveToIso(str, { offset }) : null
        if (iso) return { takenAt: iso, source: 'exif', gps }
      }
    } else if (bytes && isHeicLike(bytes)) {
      // HEIC: skip EXIF (no parser here); fall through to lastModified / now.
    }
  } catch {
    // unreadable file — fall through
  }
  const lm = file?.lastModified
  if (typeof lm === 'number' && Number.isFinite(lm) && lm > 0) {
    return { takenAt: new Date(lm).toISOString(), source: 'lastModified', gps }
  }
  return { takenAt: now.toISOString(), source: 'now', gps }
}

// Central calendar date ('YYYY-MM-DD') for a photo timestamp. Date-only values
// (daily report_date) pass through unchanged. Falsy / invalid → null.
export function photoDateCentral(value) {
  if (!value) return null
  const s = String(value)
  if (DATE_ONLY.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return todayCentral(d)
}

// Migration 066 adds job_photos.latitude / longitude. Until it is applied, an insert
// carrying them fails with an undefined-column / schema-cache error.
const GPS_KEYS = ['latitude', 'longitude']
export function isMissingColumnError(error) {
  if (!error) return false
  if (['42703', 'PGRST204', 'PGRST202'].includes(error.code)) return true
  return /schema cache|does not exist|could not find the .*column/i.test(error.message || '')
}

// job_photos latitude/longitude fields for EXIF GPS ({} when there is none).
export function gpsFields(gps) {
  return gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng) ? { latitude: gps.lat, longitude: gps.lng } : {}
}

// insertWith(extra) runs the page's own job_photos insert with `extra` spread in
// (taken_at stays in the page's row). First try with GPS; if that fails because the
// 066 columns aren't there yet, retry once with no GPS. → { error, retriedWithoutGps }
export async function insertWithGpsFallback(insertWith, gps) {
  const extra = gpsFields(gps)
  const first = await insertWith(extra)
  const hasGps = GPS_KEYS.some(k => k in extra)
  if (!first?.error || !hasGps || !isMissingColumnError(first.error)) return { error: first?.error || null, retriedWithoutGps: false }
  const second = await insertWith({})
  return { error: second?.error || null, retriedWithoutGps: true }
}
