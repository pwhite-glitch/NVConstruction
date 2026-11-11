// Browser ZIP builder (prompt 78): STORE (no compression), same CRC32 / header layout as the
// server's lib/zip-builder.js, but built from Blobs with Uint8Array / DataView only (no Node
// Buffer, no packages). Entry bytes stay as the original Blob parts: the archive is a Blob of
// [header, blob, header, blob, …, central directory, end records], never one giant copy.
// CRC32 is computed incrementally over bounded Blob slices, yielding between slices.
// ZIP64 records are written when a size, offset or entry count does not fit classic ZIP
// fields, so nothing silently wraps at 4 GiB or 65,535 entries.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c >>> 0
  }
  return t
})()

// Running CRC: start with crc32Init(), feed chunks, finish with crc32Final().
export const crc32Init = () => 0xFFFFFFFF
export function crc32Update(crc, bytes) {
  let c = crc >>> 0
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return c >>> 0
}
export const crc32Final = crc => (crc ^ 0xFFFFFFFF) >>> 0
export const crc32 = bytes => crc32Final(crc32Update(crc32Init(), bytes))

export const CRC_SLICE_BYTES = 4 * 1024 * 1024
const defaultYield = () => new Promise(r => setTimeout(r, 0))

export async function crc32OfBlob(blob, { sliceBytes = CRC_SLICE_BYTES, yieldFn = defaultYield, onBytes } = {}) {
  let crc = crc32Init()
  for (let off = 0; off < blob.size; off += sliceBytes) {
    const part = new Uint8Array(await blob.slice(off, Math.min(off + sliceBytes, blob.size)).arrayBuffer())
    crc = crc32Update(crc, part)
    onBytes?.(part.length)
    if (yieldFn) await yieldFn()
  }
  return crc32Final(crc)
}

// ── Names ─────────────────────────────────────────────────────────────────────
// Safe archive path: forward slashes only, no absolute / drive / dot segments, no control or
// reserved characters. Trusted fixed folders come from the caller.
export function sanitizeArchivePath(name) {
  const segs = String(name || '').replace(/\\/g, '/').split('/')
    .map(s => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[<>:"|?*]/g, '_').trim())
    .filter(s => s && s !== '.' && s !== '..')
    .map(s => s.replace(/^\.+/, '_').slice(0, 180))
  return segs.join('/') || 'file'
}

// Make names unique (case-insensitive), adding _2, _3 … before the extension.
export function uniqueArchiveNames(names) {
  const used = new Set()
  return names.map(raw => {
    const safe = sanitizeArchivePath(raw)
    if (!used.has(safe.toLowerCase())) { used.add(safe.toLowerCase()); return safe }
    const slash = safe.lastIndexOf('/')
    const dir = slash >= 0 ? safe.slice(0, slash + 1) : ''
    const file = safe.slice(slash + 1)
    const m = file.match(/^(.*?)(\.[^.]+)?$/)
    let n = 2
    let candidate
    do { candidate = `${dir}${m[1]}_${n}${m[2] || ''}`; n++ } while (used.has(candidate.toLowerCase()))
    used.add(candidate.toLowerCase())
    return candidate
  })
}

// ── Headers ───────────────────────────────────────────────────────────────────
const U16 = 0xFFFF
const U32 = 0xFFFFFFFF
const FLAG_UTF8 = 0x0800

export function dosDateTime(d = new Date()) {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107)
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & U16,
    date: (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & U16,
  }
}

// Which ZIP64 fields an entry needs (size: data length; offset: its local header offset).
export function zip64Needs({ size, offset }) {
  return { size: size >= U32, offset: offset >= U32 }
}

function bytesOf(len, fill) {
  const buf = new Uint8Array(len)
  fill(new DataView(buf.buffer))
  return buf
}

// Local file header (+ ZIP64 extra with both sizes when the size does not fit).
export function localHeader({ nameBytes, crc, size, time, date }) {
  const z = size >= U32
  const extraLen = z ? 20 : 0
  return bytesOf(30 + nameBytes.length + extraLen, v => {
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, z ? 45 : 20, true)
    v.setUint16(6, FLAG_UTF8, true)
    v.setUint16(8, 0, true) // STORE
    v.setUint16(10, time, true)
    v.setUint16(12, date, true)
    v.setUint32(14, crc >>> 0, true)
    v.setUint32(18, z ? U32 : size, true)
    v.setUint32(22, z ? U32 : size, true)
    v.setUint16(26, nameBytes.length, true)
    v.setUint16(28, extraLen, true)
    new Uint8Array(v.buffer).set(nameBytes, 30)
    if (z) {
      const o = 30 + nameBytes.length
      v.setUint16(o, 0x0001, true)
      v.setUint16(o + 2, 16, true)
      v.setBigUint64(o + 4, BigInt(size), true)
      v.setBigUint64(o + 12, BigInt(size), true)
    }
  })
}

// Central directory header (+ ZIP64 extra with only the fields that overflow, in spec order).
export function centralHeader({ nameBytes, crc, size, offset, time, date }) {
  const need = zip64Needs({ size, offset })
  const fields = []
  if (need.size) fields.push(BigInt(size), BigInt(size))
  if (need.offset) fields.push(BigInt(offset))
  const extraLen = fields.length ? 4 + 8 * fields.length : 0
  const z = fields.length > 0
  return bytesOf(46 + nameBytes.length + extraLen, v => {
    v.setUint32(0, 0x02014b50, true)
    v.setUint16(4, z ? 45 : 20, true) // version made by
    v.setUint16(6, z ? 45 : 20, true) // version needed
    v.setUint16(8, FLAG_UTF8, true)
    v.setUint16(10, 0, true)
    v.setUint16(12, time, true)
    v.setUint16(14, date, true)
    v.setUint32(16, crc >>> 0, true)
    v.setUint32(20, need.size ? U32 : size, true)
    v.setUint32(24, need.size ? U32 : size, true)
    v.setUint16(28, nameBytes.length, true)
    v.setUint16(30, extraLen, true)
    v.setUint16(32, 0, true) // comment
    v.setUint16(34, 0, true) // disk start
    v.setUint16(36, 0, true) // internal attrs
    v.setUint32(38, 0, true) // external attrs
    v.setUint32(42, need.offset ? U32 : offset, true)
    new Uint8Array(v.buffer).set(nameBytes, 46)
    if (z) {
      const o = 46 + nameBytes.length
      v.setUint16(o, 0x0001, true)
      v.setUint16(o + 2, 8 * fields.length, true)
      fields.forEach((f, i) => v.setBigUint64(o + 4 + 8 * i, f, true))
    }
  })
}

// End records. Adds ZIP64 end-of-central-directory + locator when count / size / offset overflow.
export function endRecords({ count, cdSize, cdOffset }) {
  const z = count >= U16 || cdSize >= U32 || cdOffset >= U32
  const parts = []
  if (z) {
    const z64Offset = cdOffset + cdSize
    parts.push(bytesOf(56, v => {
      v.setUint32(0, 0x06064b50, true)
      v.setBigUint64(4, 44n, true)
      v.setUint16(12, 45, true)
      v.setUint16(14, 45, true)
      v.setUint32(16, 0, true)
      v.setUint32(20, 0, true)
      v.setBigUint64(24, BigInt(count), true)
      v.setBigUint64(32, BigInt(count), true)
      v.setBigUint64(40, BigInt(cdSize), true)
      v.setBigUint64(48, BigInt(cdOffset), true)
    }))
    parts.push(bytesOf(20, v => {
      v.setUint32(0, 0x07064b50, true)
      v.setUint32(4, 0, true)
      v.setBigUint64(8, BigInt(z64Offset), true)
      v.setUint32(16, 1, true)
    }))
  }
  parts.push(bytesOf(22, v => {
    v.setUint32(0, 0x06054b50, true)
    v.setUint16(4, 0, true)
    v.setUint16(6, 0, true)
    v.setUint16(8, count >= U16 ? U16 : count, true)
    v.setUint16(10, count >= U16 ? U16 : count, true)
    v.setUint32(12, cdSize >= U32 ? U32 : cdSize, true)
    v.setUint32(16, cdOffset >= U32 ? U32 : cdOffset, true)
    v.setUint16(20, 0, true)
  }))
  return { parts, zip64: z }
}

// ── Archive ───────────────────────────────────────────────────────────────────
// entries: [{ name, blob } | { name, text }] in archive order. Names are sanitized and made
// unique. Returns a Blob (application/zip).
export async function buildZipBlob(entries, { now = new Date(), yieldFn = defaultYield, onProgress, BlobCtor = Blob } = {}) {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(now)
  const names = uniqueArchiveNames(entries.map(e => e.name))
  const total = entries.reduce((a, e) => a + (e.blob ? e.blob.size : 0), 0)
  let done = 0
  const parts = []
  const central = []
  let offset = 0
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const blob = e.blob || new BlobCtor([enc.encode(String(e.text ?? ''))])
    const size = blob.size
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Cannot add ${names[i]} to the archive (bad size).`)
    const crc = await crc32OfBlob(blob, { yieldFn, onBytes: n => { done += e.blob ? n : 0; onProgress?.({ done, total }) } })
    const nameBytes = enc.encode(names[i])
    const lh = localHeader({ nameBytes, crc, size, time, date })
    parts.push(lh, blob)
    central.push(centralHeader({ nameBytes, crc, size, offset, time, date }))
    offset += lh.length + size
    if (!Number.isSafeInteger(offset)) throw new Error('The archive is too large to build in the browser.')
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0)
  const end = endRecords({ count: entries.length, cdSize, cdOffset: offset })
  return new BlobCtor([...parts, ...central, ...end.parts], { type: 'application/zip' })
}
