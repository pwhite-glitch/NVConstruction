/**
 * Prompt 68: field photo dates.
 * - Capture time comes from the ORIGINAL file's EXIF (DateTimeOriginal …) before
 *   compressImage strips it; then lastModified; then now.
 * - Exif wall clock (no zone) is read as America/Chicago unless an Exif offset is present.
 * - Gallery photos are labeled / grouped by the Central calendar date, not the UTC date.
 * - Optional GPS goes to job_photos.latitude/longitude (migration 066); before 066 the
 *   insert retries without those keys.
 * Pure helpers + page source checks; nothing live.
 */
const fs = require('fs')
const path = require('path')
const {
  parseJpegExif, isHeicLike, exifNaiveToIso, resolveTakenAt, photoDateCentral,
  gpsFields, insertWithGpsFallback, isMissingColumnError,
} = require('../lib/photo-taken-at')
const { todayCentral } = require('../lib/central-date')
const { ownerPhotoList } = require('../lib/owner-photos')

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

// ── Minimal JPEG / TIFF fixture builder ─────────────────────────────────────
const ascii = (tag, s) => ({ tag, type: 2, count: s.length + 1, size: s.length + 1, write: (dv, o) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); dv.setUint8(o + s.length, 0) } })
const rational = (tag, pairs) => ({ tag, type: 5, count: pairs.length, size: pairs.length * 8, write: (dv, o, le) => pairs.forEach(([n, d], i) => { dv.setUint32(o + i * 8, n, le); dv.setUint32(o + i * 8 + 4, d, le) }) })
const long = (tag, v) => ({ tag, type: 4, count: 1, size: 4, write: (dv, o, le) => dv.setUint32(o, v, le) })

function tiff({ le = false, ifd0 = [], exif = null, gps = null }) {
  const ifdSize = n => 2 + n * 12 + 4
  const n0 = ifd0.length + (exif ? 1 : 0) + (gps ? 1 : 0)
  const off0 = 8
  const offExif = off0 + ifdSize(n0)
  const offGps = offExif + (exif ? ifdSize(exif.length) : 0)
  let dataOff = offGps + (gps ? ifdSize(gps.length) : 0)
  const all0 = [...ifd0, ...(exif ? [long(0x8769, offExif)] : []), ...(gps ? [long(0x8825, offGps)] : [])].sort((a, b) => a.tag - b.tag)
  const ifds = [[off0, all0], ...(exif ? [[offExif, exif]] : []), ...(gps ? [[offGps, gps]] : [])]
  const total = dataOff + ifds.flatMap(([, es]) => es).reduce((s, e) => s + (e.size > 4 ? e.size : 0), 0)
  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  dv.setUint8(0, le ? 0x49 : 0x4d); dv.setUint8(1, le ? 0x49 : 0x4d)
  dv.setUint16(2, 42, le); dv.setUint32(4, off0, le)
  for (const [off, entries] of ifds) {
    dv.setUint16(off, entries.length, le)
    entries.forEach((e, i) => {
      const p = off + 2 + i * 12
      dv.setUint16(p, e.tag, le); dv.setUint16(p + 2, e.type, le); dv.setUint32(p + 4, e.count, le)
      if (e.size <= 4) e.write(dv, p + 8, le)
      else { dv.setUint32(p + 8, dataOff, le); e.write(dv, dataOff, le); dataOff += e.size }
    })
    dv.setUint32(off + 2 + entries.length * 12, 0, le)
  }
  return new Uint8Array(buf)
}

function jpeg(tiffBytes) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
  const len = 2 + 6 + tiffBytes.length
  return Uint8Array.from([0xff, 0xd8, ...app0, 0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiffBytes, 0xff, 0xd9])
}

const fakeFile = (bytes, extra = {}) => ({ name: 'IMG.jpg', type: 'image/jpeg', ...extra, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })

const EVENING = jpeg(tiff({ ifd0: [ascii(0x0132, '2026:11:09 08:00:00')], exif: [ascii(0x9003, '2026:11:05 23:15:00'), ascii(0x9004, '2026:11:05 23:15:01')] }))
// 36°9'14.4" N, 95°59'34.8" W (Tulsa) — little-endian this time
const WITH_GPS = jpeg(tiff({
  le: true,
  exif: [ascii(0x9003, '2026:07:14 23:30:00')],
  gps: [ascii(0x0001, 'N'), rational(0x0002, [[36, 1], [9, 1], [144, 10]]), ascii(0x0003, 'W'), rational(0x0004, [[95, 1], [59, 1], [348, 10]])],
}))

// ── 1) EXIF parser ─────────────────────────────────────────────────────────
describe('parseJpegExif', () => {
  test('reads DateTimeOriginal (ExifIFD) and IFD0 DateTime', () => {
    const ex = parseJpegExif(EVENING)
    expect(ex.dateTimeOriginal).toBe('2026:11:05 23:15:00')
    expect(ex.dateTimeDigitized).toBe('2026:11:05 23:15:01')
    expect(ex.dateTime).toBe('2026:11:09 08:00:00')
    expect(ex.gps).toBeNull()
    expect(parseJpegExif(EVENING.buffer).dateTimeOriginal).toBe('2026:11:05 23:15:00')
  })

  test('reads GPS as signed decimal degrees (little-endian TIFF)', () => {
    const ex = parseJpegExif(WITH_GPS)
    expect(ex.dateTimeOriginal).toBe('2026:07:14 23:30:00')
    expect(ex.gps.lat).toBeCloseTo(36.154, 3)
    expect(ex.gps.lng).toBeCloseTo(-95.993, 3)
  })

  test('falls back to IFD0 DateTime when there is no Exif IFD', async () => {
    const only = jpeg(tiff({ ifd0: [ascii(0x0132, '2026:11:05 19:30:00')] }))
    expect(parseJpegExif(only)).toMatchObject({ dateTimeOriginal: null, dateTime: '2026:11:05 19:30:00' })
    const r = await resolveTakenAt(fakeFile(only))
    expect(r).toMatchObject({ source: 'exif', takenAt: '2026-11-06T01:30:00.000Z' })
  })

  test('truncated / empty / random / non-JPEG input → nulls, never throws', () => {
    const nulls = { dateTimeOriginal: null, dateTime: null, gps: null }
    for (const n of [4, 12, 30, 40]) expect(parseJpegExif(EVENING.slice(0, n))).toMatchObject(nulls)
    // Cut through the Exif strings at the end: only what is fully inside the buffer is read.
    expect(parseJpegExif(EVENING.slice(0, EVENING.length - 40))).toMatchObject({ dateTimeOriginal: null, dateTimeDigitized: null, dateTime: '2026:11:09 08:00:00', gps: null })
    for (let n = 0; n <= EVENING.length; n++) expect(() => parseJpegExif(EVENING.slice(0, n))).not.toThrow()
    expect(parseJpegExif(new Uint8Array(0))).toMatchObject(nulls)
    expect(parseJpegExif(null)).toMatchObject(nulls)
    expect(parseJpegExif(undefined)).toMatchObject(nulls)
    let seed = 7
    const rnd = Uint8Array.from({ length: 500 }, () => (seed = (seed * 1103515245 + 12345) & 0xff))
    expect(parseJpegExif(rnd)).toMatchObject(nulls)
    rnd[0] = 0xff; rnd[1] = 0xd8
    expect(() => parseJpegExif(rnd)).not.toThrow()
    expect(parseJpegExif(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toMatchObject(nulls)
  })
})

describe('isHeicLike', () => {
  const heic = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1heic'), 0, 0, 0, 0])
  test('detects ftyp heic/heif/mif1 brands; JPEG and junk are not HEIC', () => {
    expect(isHeicLike(heic)).toBe(true)
    expect(isHeicLike(Uint8Array.from([0, 0, 0, 20, ...Buffer.from('ftypmif1'), 0, 0, 0, 0, ...Buffer.from('heif')]))).toBe(true)
    expect(isHeicLike(EVENING)).toBe(false)
    expect(isHeicLike(new Uint8Array(3))).toBe(false)
    expect(isHeicLike(null)).toBe(false)
  })

  test('resolveTakenAt skips EXIF for HEIC and falls through', async () => {
    const lm = Date.parse('2026-11-01T18:00:00Z')
    const r = await resolveTakenAt(fakeFile(heic, { type: 'image/heic', lastModified: lm }))
    expect(r.source).toBe('lastModified')
    expect(r.takenAt).toBe(new Date(lm).toISOString())
    expect(r.gps).toBeNull()
  })
})

describe('exifNaiveToIso', () => {
  test('wall clock is America/Chicago (CST and CDT)', () => {
    expect(exifNaiveToIso('2026:11:05 23:15:00')).toBe('2026-11-06T05:15:00.000Z')
    expect(exifNaiveToIso('2026:07:14 23:30:00')).toBe('2026-07-15T04:30:00.000Z')
    expect(exifNaiveToIso('2026:03:08 23:30:00')).toBe('2026-03-09T04:30:00.000Z')
  })

  test('uses an Exif offset when given', () => {
    expect(exifNaiveToIso('2026:07:15 10:00:00', { offset: '-05:00' })).toBe('2026-07-15T15:00:00.000Z')
    expect(exifNaiveToIso('2026:07:15 10:00:00', { offset: '+02:00' })).toBe('2026-07-15T08:00:00.000Z')
  })

  test('invalid → null', () => {
    for (const bad of [null, '', 'garbage', '0000:00:00 00:00:00', '2026:02:30 10:00:00', '2026:13:01 10:00:00', '2026:11:05 25:00:00']) {
      expect(exifNaiveToIso(bad)).toBeNull()
    }
  })

  test('resolveTakenAt uses OffsetTimeOriginal when present', async () => {
    const f = jpeg(tiff({ exif: [ascii(0x9003, '2026:07:15 10:00:00'), ascii(0x9011, '-05:00')] }))
    expect((await resolveTakenAt(fakeFile(f))).takenAt).toBe('2026-07-15T15:00:00.000Z')
  })
})

// ── resolveTakenAt order ───────────────────────────────────────────────────
describe('resolveTakenAt', () => {
  test('EXIF DateTimeOriginal 11:15 PM CT stays Nov 5 in Central; source exif', async () => {
    const r = await resolveTakenAt(fakeFile(EVENING, { lastModified: Date.parse('2026-11-09T18:00:00Z') }))
    expect(r.source).toBe('exif')
    expect(r.takenAt).toBe('2026-11-06T05:15:00.000Z')
    expect(todayCentral(new Date(r.takenAt))).toBe('2026-11-05')
    expect(photoDateCentral(r.takenAt)).toBe('2026-11-05')
    expect(r.gps).toBeNull()
  })

  test('returns GPS from EXIF', async () => {
    const r = await resolveTakenAt(fakeFile(WITH_GPS))
    expect(r.source).toBe('exif')
    expect(r.takenAt).toBe('2026-07-15T04:30:00.000Z')
    expect(r.gps.lat).toBeCloseTo(36.154, 3)
    expect(r.gps.lng).toBeCloseTo(-95.993, 3)
  })

  test('no EXIF → lastModified', async () => {
    const lm = Date.parse('2026-11-01T18:00:00Z')
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const r = await resolveTakenAt(fakeFile(png, { type: 'image/png', lastModified: lm }))
    expect(r).toEqual({ takenAt: '2026-11-01T18:00:00.000Z', source: 'lastModified', gps: null })
  })

  test('JPEG without EXIF dates → lastModified', async () => {
    const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
    const r = await resolveTakenAt(fakeFile(bare, { lastModified: Date.parse('2026-11-01T18:00:00Z') }))
    expect(r.source).toBe('lastModified')
  })

  test('lastModified 0 / missing / NaN and no EXIF → now (injected)', async () => {
    const now = new Date('2026-11-09T18:47:00Z')
    const junk = Uint8Array.from([1, 2, 3, 4])
    for (const extra of [{ lastModified: 0 }, {}, { lastModified: NaN }, { lastModified: -5 }]) {
      expect(await resolveTakenAt(fakeFile(junk, extra), now)).toEqual({ takenAt: now.toISOString(), source: 'now', gps: null })
    }
  })

  test('unreadable file → falls through, no throw', async () => {
    const now = new Date('2026-11-09T18:47:00Z')
    const broken = { arrayBuffer: async () => { throw new Error('nope') }, lastModified: 0 }
    expect(await resolveTakenAt(broken, now)).toMatchObject({ source: 'now' })
    expect(await resolveTakenAt({}, now)).toMatchObject({ source: 'now' })
  })
})

// ── 3) photoDateCentral ────────────────────────────────────────────────────
describe('photoDateCentral', () => {
  test('evening Central stays on the Central date', () => {
    expect(photoDateCentral('2026-11-06T01:30:00.000Z')).toBe('2026-11-05') // 7:30 PM CST Nov 5
    expect(photoDateCentral('2026-11-05T05:00:00.000Z')).toBe('2026-11-04') // 11:00 PM CST Nov 4
  })

  test('same evening / DST cases as central-date.test.js', () => {
    expect(photoDateCentral('2026-11-04T23:30:00Z')).toBe('2026-11-04')
    expect(photoDateCentral('2026-11-05T05:30:00Z')).toBe('2026-11-04')
    expect(photoDateCentral('2026-11-05T06:30:00Z')).toBe('2026-11-05')
    expect(photoDateCentral('2026-07-15T04:30:00Z')).toBe('2026-07-14') // 11:30 PM CDT
    expect(photoDateCentral('2026-07-15T05:30:00Z')).toBe('2026-07-15')
    expect(photoDateCentral('2026-11-02T05:30:00Z')).toBe('2026-11-01')
    expect(photoDateCentral('2026-03-09T04:30:00Z')).toBe('2026-03-08')
    expect(photoDateCentral('2027-01-01T05:59:00Z')).toBe('2026-12-31')
    expect(photoDateCentral('2026-11-06T01:30:00+00:00')).toBe('2026-11-05') // Postgres-style offset
  })

  test('date-only passes through; falsy / invalid → null', () => {
    expect(photoDateCentral('2026-11-05')).toBe('2026-11-05')
    expect(photoDateCentral(null)).toBeNull()
    expect(photoDateCentral('')).toBeNull()
    expect(photoDateCentral(undefined)).toBeNull()
    expect(photoDateCentral('not a date')).toBeNull()
  })
})

// ── 4) owner portal list ───────────────────────────────────────────────────
describe('ownerPhotoList uses the Central date', () => {
  test('gallery row at 7:30 PM CT Nov 5 is dated Nov 5; report rows keep report_date', () => {
    const list = ownerPhotoList({
      jobId: 'J1',
      jobPhotos: [
        { storage_path: 'J1/gallery/eve.jpg', caption: 'Pour', taken_at: '2026-11-06T01:30:00Z' },
        { storage_path: 'J1/gallery/eve_thumb.jpg', taken_at: '2026-11-06T01:30:00Z' },
        { storage_path: 'J1/gallery/old.jpg', taken_at: null, created_at: '2026-11-05T05:00:00Z' },
        { storage_path: 'J2/gallery/other.jpg', taken_at: '2026-11-06T01:30:00Z' },
      ],
      reports: [{ report_date: '2026-11-06', photos: [{ path: 'J1/rep.jpg', caption: 'Slab' }] }],
    })
    expect(list.map(p => [p.path, p.date, p.source])).toEqual([
      ['J1/rep.jpg', '2026-11-06', 'daily_report'],
      ['J1/gallery/eve.jpg', '2026-11-05', 'gallery'],
      ['J1/gallery/old.jpg', '2026-11-04', 'gallery'],
    ])
  })
})

// ── 6) pre-066 retry ───────────────────────────────────────────────────────
describe('insertWithGpsFallback (pre-066)', () => {
  // Mirrors the pages: gps => supabase.from('job_photos').insert({ ...row, taken_at, ...gps })
  const base = { job_id: 'J1', super_id: 'u1', storage_path: 'J1/gallery/1.jpg', file_name: 'a.jpg', caption: null, taken_at: '2026-11-06T05:15:00.000Z' }
  const fakeDb = results => {
    const calls = []
    return { calls, from: table => ({ insert: async row => { calls.push({ table, row }); return results.shift() } }) }
  }
  const run = (db, gps) => insertWithGpsFallback(extra => db.from('job_photos').insert({ ...base, ...extra }), gps)
  const GPS = { lat: 36.1, lng: -95.9 }

  test('gpsFields: lat/lng only with GPS', () => {
    expect(gpsFields(null)).toEqual({})
    expect(gpsFields({ lat: NaN, lng: 1 })).toEqual({})
    expect(gpsFields({ lat: 1.5, lng: -2.5 })).toEqual({ latitude: 1.5, longitude: -2.5 })
  })

  test('missing GPS columns (PGRST204) → retried once without latitude/longitude, taken_at kept', async () => {
    const db = fakeDb([{ error: { code: 'PGRST204', message: "Could not find the 'latitude' column of 'job_photos' in the schema cache" } }, { error: null }])
    expect(await run(db, GPS)).toEqual({ error: null, retriedWithoutGps: true })
    expect(db.calls).toHaveLength(2)
    expect(db.calls[0].row).toEqual({ ...base, latitude: 36.1, longitude: -95.9 })
    expect(db.calls[1]).toEqual({ table: 'job_photos', row: base })
  })

  test('42703 also retries; other errors and GPS-less rows do not', async () => {
    let db = fakeDb([{ error: { code: '42703', message: 'column "longitude" does not exist' } }, { error: null }])
    expect((await run(db, GPS)).retriedWithoutGps).toBe(true)

    db = fakeDb([{ error: { code: '23503', message: 'violates foreign key' } }])
    expect(await run(db, GPS)).toEqual({ error: { code: '23503', message: 'violates foreign key' }, retriedWithoutGps: false })
    expect(db.calls).toHaveLength(1)

    db = fakeDb([{ error: { code: 'PGRST204', message: "Could not find the 'tag' column" } }])
    const r = await run(db, null)
    expect(r.retriedWithoutGps).toBe(false)
    expect(r.error.code).toBe('PGRST204')
    expect(db.calls).toEqual([{ table: 'job_photos', row: base }])

    db = fakeDb([{ error: null }])
    expect(await run(db, GPS)).toEqual({ error: null, retriedWithoutGps: false })
    expect(db.calls[0].row).toMatchObject({ latitude: 36.1, longitude: -95.9 })
  })

  test('a failing retry returns the retry error', async () => {
    const db = fakeDb([{ error: { code: 'PGRST204', message: 'schema cache' } }, { error: { code: '42501', message: 'denied' } }])
    expect(await run(db, GPS)).toEqual({ error: { code: '42501', message: 'denied' }, retriedWithoutGps: true })
  })

  test('isMissingColumnError', () => {
    expect(isMissingColumnError(null)).toBe(false)
    expect(isMissingColumnError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingColumnError({ message: 'relation is fine' })).toBe(false)
  })
})

// ── 5) page source checks ──────────────────────────────────────────────────
describe('pages read capture time before compress and show Central dates', () => {
  const field = read('app/field/page.js')
  const jobdetail = read('app/jobdetail/page.js')
  const resi = read('app/residentialjobdetail/page.js')
  const between = (src, start, end) => {
    const a = src.indexOf(start)
    expect(a).toBeGreaterThan(-1)
    const b = src.indexOf(end, a + start.length)
    expect(b).toBeGreaterThan(a)
    return src.slice(a, b)
  }

  test('field uploadGalleryPhoto: resolveTakenAt before compressImage; insert uses resolved takenAt', () => {
    expect(field).toMatch(/from '..\/..\/lib\/photo-taken-at'/)
    const fn = between(field, 'async function uploadGalleryPhoto', 'async function migratePhotos')
    const resolveAt = fn.indexOf('resolveTakenAt(file)')
    expect(resolveAt).toBeGreaterThan(-1)
    expect(resolveAt).toBeLessThan(fn.indexOf('compressImage('))
    expect(fn).toMatch(/insertWithGpsFallback\(gps => supabase\.from\('job_photos'\)\.insert\(\{[^}]*taken_at: taken\.takenAt, \.\.\.gps \}\), taken\.gps\)/)
    expect(fn).not.toMatch(/taken_at:\s*new Date\(\)/)
    expect(fn).not.toMatch(/created_at/)
    // still uploads only the compressed JPEG + thumb
    expect(fn).toMatch(/\.upload\(path, compressed\)/)
  })

  test('residential uploadPhoto: resolveTakenAt before upload; insert uses resolved takenAt; cleanup kept', () => {
    expect(resi).toMatch(/from '..\/..\/lib\/photo-taken-at'/)
    const fn = between(resi, 'async function uploadPhoto(e)', 'await loadPhotos()')
    const resolveAt = fn.indexOf('resolveTakenAt(file)')
    expect(resolveAt).toBeGreaterThan(-1)
    expect(resolveAt).toBeLessThan(fn.indexOf(".upload(path, file"))
    expect(fn).toMatch(/insertWithGpsFallback\(gps => supabase\.from\('job_photos'\)\.insert\(\{[^}]*taken_at: taken\.takenAt, \.\.\.gps \}\), taken\.gps\)/)
    expect(fn).not.toMatch(/taken_at:\s*new Date\(\)/)
    expect(fn).toMatch(/\.remove\(\[path\]\)/)
    expect(fn).not.toMatch(/compressImage/)
  })

  test('photo maps use photoDateCentral, not the UTC date part', () => {
    expect(field).toMatch(/standalonePhotos\.map\(p => \(\{[^\n]*date: photoDateCentral\(p\.taken_at\)/)
    expect(jobdetail).toMatch(/import \{ photoDateCentral \} from '..\/..\/lib\/photo-taken-at'/)
    expect(jobdetail).toMatch(/date: photoDateCentral\(p\.taken_at\)/)
    expect(resi).toMatch(/date: photoDateCentral\(p\.taken_at \|\| p\.created_at\)/)
    for (const src of [field, jobdetail, resi, read('lib/owner-photos.js')]) {
      expect(src).not.toMatch(/taken_at\?\.split\('T'\)\[0\]/)
      expect(src).not.toMatch(/\(p\.taken_at \|\| p\.created_at \|\| ''\)\.(split\('T'\)\[0\]|slice\(0, 10\))/)
    }
  })

  test('daily-report uploads are untouched (still grouped by report_date, no resolveTakenAt)', () => {
    const fn = between(field, 'async function uploadReportPhotos', '\n  }\n')
    expect(fn).not.toMatch(/resolveTakenAt/)
  })
})

describe('migration 066', () => {
  const sql = read('migrations/066_job_photos_gps.sql')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  test('adds latitude/longitude idempotently, nothing else, with a commented ROLLBACK', () => {
    expect(code).toMatch(/ALTER TABLE public\.job_photos ADD COLUMN IF NOT EXISTS latitude double precision/)
    expect(code).toMatch(/ALTER TABLE public\.job_photos ADD COLUMN IF NOT EXISTS longitude double precision/)
    expect(code).not.toMatch(/uploaded_at|\btag\b|UPDATE|DROP|INDEX/i)
    expect(sql).toMatch(/-- ROLLBACK/)
    expect(sql).toMatch(/-- ALTER TABLE public\.job_photos DROP COLUMN IF EXISTS latitude/)
    expect(sql).toMatch(/-- ALTER TABLE public\.job_photos DROP COLUMN IF EXISTS longitude/)
    expect((code.match(/ADD COLUMN(?! IF NOT EXISTS)/g) || [])).toHaveLength(0)
  })
})
