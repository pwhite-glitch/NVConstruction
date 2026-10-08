// Minimal STORE (uncompressed) ZIP builder for Node.js. No npm dependencies.

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xFFFF, 0); return b }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b }

function dosDateTime() {
  const d = new Date()
  const t = (((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF)
  const dt = ((((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF)
  return { t, dt }
}

/**
 * Build a ZIP archive.
 * @param {Array<{name: string, data: Buffer}>} files
 * @returns {Buffer}
 */
export function buildZip(files) {
  const { t: modTime, dt: modDate } = dosDateTime()
  const SIG_LF   = Buffer.from([0x50, 0x4B, 0x03, 0x04])
  const SIG_CD   = Buffer.from([0x50, 0x4B, 0x01, 0x02])
  const SIG_EOCD = Buffer.from([0x50, 0x4B, 0x05, 0x06])

  const entries = []
  let offset = 0

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8')
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data)
    const crc  = crc32(data)
    const size = data.length

    const localHeader = Buffer.concat([
      SIG_LF,
      u16(20), u16(0), u16(0),        // version needed, flags, STORE compression
      u16(modTime), u16(modDate),
      u32(crc), u32(size), u32(size), // crc, compressed size, uncompressed size
      u16(nameBytes.length), u16(0),  // name length, extra length
      nameBytes,
    ])

    entries.push({ localHeader, data, nameBytes, crc, size, offset })
    offset += localHeader.length + size
  }

  const cdParts = entries.map(e => Buffer.concat([
    SIG_CD,
    u16(20), u16(20), u16(0), u16(0), // version made by / needed, flags, STORE
    u16(modTime), u16(modDate),
    u32(e.crc), u32(e.size), u32(e.size),
    u16(e.nameBytes.length), u16(0), u16(0), // name, extra, comment
    u16(0), u16(0), u32(0),                  // disk start, internal attrs, external attrs
    u32(e.offset),
    e.nameBytes,
  ]))
  const cdBuf = Buffer.concat(cdParts)

  const eocd = Buffer.concat([
    SIG_EOCD,
    u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(cdBuf.length), u32(offset),
    u16(0),
  ])

  return Buffer.concat([
    ...entries.flatMap(e => [e.localHeader, e.data]),
    cdBuf,
    eocd,
  ])
}
