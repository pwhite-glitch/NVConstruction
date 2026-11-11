/**
 * Prompt 78: browser ZIP builder (lib/zip-client.js). Archives are checked by an independent
 * decoder: Python's standard zipfile module run locally (python3 -I, no added dependency) and a
 * small JS central-directory reader. CRC32 known vector, STORE headers, UTF-8 flag, empty archive,
 * binary / Unicode / duplicate names, incremental CRC over Blob slices, no Buffer in the builder,
 * ZIP64 decisions from synthetic sizes / offsets / counts (no gigabyte allocations), and the
 * complete owner-reimbursement / ITB archives (README, Invoice.html / ITB html, INDEX, order).
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const zc = require('../lib/zip-client')
const { exportOwnerReimbZip, exportItbZip } = require('../lib/export-client')
const { buildZip } = require('../lib/zip-builder')

const noYield = null
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p78-zip-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const PY = `
import sys, zipfile, json, base64
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
out = []
for i in z.infolist():
    data = z.read(i)
    out.append({"name": i.filename, "flag": i.flag_bits, "method": i.compress_type, "size": i.file_size, "crc": i.CRC, "data": base64.b64encode(data).decode() if len(data) <= 1000000 else ""})
print(json.dumps({"bad": bad, "entries": out}))
`
async function pyRead(blob) {
  const file = path.join(tmp, `z${Math.random().toString(36).slice(2)}.zip`)
  fs.writeFileSync(file, new Uint8Array(await blob.arrayBuffer()))
  const res = JSON.parse(execFileSync('python3', ['-I', '-c', PY, file], { encoding: 'utf8' }))
  return { ...res, entries: res.entries.map(e => ({ ...e, text: Buffer.from(e.data, 'base64').toString('utf8'), bytes: Buffer.from(e.data, 'base64') })) }
}

// Independent JS reader: EOCD → central directory → local headers.
async function jsRead(blob) {
  const b = new Uint8Array(await blob.arrayBuffer())
  const v = new DataView(b.buffer)
  let eocd = b.length - 22
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const entries = []
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true)
    const local = v.getUint32(p + 42, true)
    expect(v.getUint32(local, true)).toBe(0x04034b50)
    entries.push({ name: new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen)), flag: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true), crc: v.getUint32(p + 16, true), size: v.getUint32(p + 24, true), local })
    p += 46 + nameLen + extraLen
  }
  return { count, entries }
}

describe('CRC32', () => {
  test('known vector "123456789" = 0xCBF43926; empty = 0', () => {
    expect(zc.crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926)
    expect(zc.crc32(new Uint8Array(0))).toBe(0)
  })
  test('incremental over small Blob slices equals one-shot; yields between slices', async () => {
    const bytes = new Uint8Array(100_003).map((_, i) => (i * 31 + 7) & 0xff)
    let yields = 0
    const crc = await zc.crc32OfBlob(new Blob([bytes]), { sliceBytes: 4096, yieldFn: async () => { yields++ } })
    expect(crc).toBe(zc.crc32(bytes))
    expect(yields).toBe(Math.ceil(bytes.length / 4096))
  })
  test('server buildZip shares the same CRC (and still produces a readable archive)', async () => {
    const z = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }])
    const r = await pyRead(new Blob([z]))
    expect(r.bad).toBeNull()
    expect(r.entries[0]).toMatchObject({ name: 'a.txt', text: 'hello', crc: zc.crc32(new TextEncoder().encode('hello')) })
  })
})

describe('archives', () => {
  test('STORE entries, UTF-8 flag, binary + Unicode + duplicate names, read back by Python and JS', async () => {
    const bin = new Uint8Array(256).map((_, i) => i)
    const zip = await zc.buildZipBlob([
      { name: 'README.txt', text: 'Read me ✓' },
      { name: 'Documents/Résumé ✓.pdf', blob: new Blob([bin]) },
      { name: 'Documents/plan.pdf', blob: new Blob(['A']) },
      { name: 'Documents/PLAN.pdf', blob: new Blob(['B']) },
      { name: '../../etc/passwd', blob: new Blob(['x']) },
      { name: 'C:\\evil\\x.txt', blob: new Blob(['y']) },
    ], { yieldFn: noYield, now: new Date(2026, 10, 11, 9, 30, 0) })
    expect(zip.type).toBe('application/zip')
    const py = await pyRead(zip)
    expect(py.bad).toBeNull()
    expect(py.entries.map(e => e.name)).toEqual(['README.txt', 'Documents/Résumé ✓.pdf', 'Documents/plan.pdf', 'Documents/PLAN_2.pdf', 'etc/passwd', 'C_/evil/x.txt'])
    expect(py.entries.every(e => e.method === 0 && (e.flag & 0x800))).toBe(true)
    expect(py.entries[0].text).toBe('Read me ✓')
    expect([...py.entries[1].bytes]).toEqual([...bin])
    expect(py.entries[3].text).toBe('B')
    const js = await jsRead(zip)
    expect(js.count).toBe(6)
    expect(js.entries.map(e => e.name)).toEqual(py.entries.map(e => e.name))
    expect(js.entries[1].crc).toBe(zc.crc32(bin))
  })

  test('empty archive is valid', async () => {
    const zip = await zc.buildZipBlob([], { yieldFn: noYield })
    expect(zip.size).toBe(22)
    expect((await pyRead(zip)).entries).toEqual([])
  })

  test('entry Blobs are kept as parts (no giant concatenated copy) and >5 MB builds fine', async () => {
    const big = new Blob([new Uint8Array(5 * 1024 * 1024 + 17).fill(7)])
    const seenParts = []
    class SpyBlob extends Blob { constructor(parts, opts) { super(parts, opts); seenParts.push(parts) } }
    const zip = await zc.buildZipBlob([{ name: 'big.bin', blob: big }], { yieldFn: noYield, BlobCtor: SpyBlob })
    expect(seenParts[seenParts.length - 1]).toContain(big) // the original Blob object itself is a part
    const py = await pyRead(zip)
    expect(py.bad).toBeNull()
    expect(py.entries[0].size).toBe(5 * 1024 * 1024 + 17)
  })

  test('the builder never needs Node Buffer', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../lib/zip-client.js'), 'utf8')
    const code = src.replace(/\/\/.*$/gm, '') // comments may mention Buffer; code may not
    expect(code).not.toMatch(/\bBuffer\b|require\(|from 'fs'|from 'crypto'/)
    const saved = global.Buffer
    try {
      global.Buffer = undefined
      const zip = await zc.buildZipBlob([{ name: 'a.txt', text: 'hi' }], { yieldFn: noYield })
      expect(zip.size).toBeGreaterThan(22)
    } finally { global.Buffer = saved }
  })

  test('name sanitizing / uniqueness helpers', () => {
    expect(zc.sanitizeArchivePath('/abs/../x/./y.txt')).toBe('abs/x/y.txt')
    expect(zc.sanitizeArchivePath('a\u0000b<>:"|?*.txt')).toBe('ab_______.txt')
    expect(zc.sanitizeArchivePath('.hidden')).toBe('_hidden')
    expect(zc.sanitizeArchivePath('')).toBe('file')
    expect(zc.uniqueArchiveNames(['a.pdf', 'A.pdf', 'a.pdf', 'b'])).toEqual(['a.pdf', 'A_2.pdf', 'a_3.pdf', 'b'])
  })
})

describe('ZIP64 decisions (synthetic, no big allocations)', () => {
  const name = new TextEncoder().encode('big.bin')
  const U32 = 0xFFFFFFFF
  test('classic fields below the limits', () => {
    expect(zc.zip64Needs({ size: U32 - 1, offset: U32 - 1 })).toEqual({ size: false, offset: false })
    const lh = zc.localHeader({ nameBytes: name, crc: 1, size: 100, time: 0, date: 0 })
    expect(lh.length).toBe(30 + name.length)
    expect(new DataView(lh.buffer).getUint16(4, true)).toBe(20)
  })
  test('size ≥ 4 GiB: local + central sizes are 0xFFFFFFFF with ZIP64 extra holding the real size', () => {
    const size = 2 ** 32 + 123
    const lh = new DataView(zc.localHeader({ nameBytes: name, crc: 9, size, time: 0, date: 0 }).buffer)
    expect(lh.getUint16(4, true)).toBe(45)
    expect(lh.getUint32(18, true)).toBe(U32)
    expect(lh.getUint32(22, true)).toBe(U32)
    const x = 30 + name.length
    expect(lh.getUint16(x, true)).toBe(1)
    expect(lh.getBigUint64(x + 4, true)).toBe(BigInt(size))
    expect(lh.getBigUint64(x + 12, true)).toBe(BigInt(size))
    const ch = new DataView(zc.centralHeader({ nameBytes: name, crc: 9, size, offset: 10, time: 0, date: 0 }).buffer)
    expect(ch.getUint32(20, true)).toBe(U32)
    expect(ch.getUint32(42, true)).toBe(10) // offset fits: not moved to the extra
    expect(ch.getUint16(30, true)).toBe(4 + 16)
    expect(ch.getBigUint64(46 + name.length + 4, true)).toBe(BigInt(size))
  })
  test('offset ≥ 4 GiB: only the offset goes to the ZIP64 extra', () => {
    const offset = 2 ** 32 + 5
    const ch = new DataView(zc.centralHeader({ nameBytes: name, crc: 1, size: 10, offset, time: 0, date: 0 }).buffer)
    expect(ch.getUint32(20, true)).toBe(10)
    expect(ch.getUint32(42, true)).toBe(U32)
    expect(ch.getUint16(30, true)).toBe(12)
    expect(ch.getBigUint64(46 + name.length + 4, true)).toBe(BigInt(offset))
  })
  test('> 65,535 entries or a CD offset ≥ 4 GiB adds ZIP64 EOCD + locator; classic EOCD saturates instead of wrapping', () => {
    const small = zc.endRecords({ count: 3, cdSize: 100, cdOffset: 1000 })
    expect(small.zip64).toBe(false)
    expect(small.parts).toHaveLength(1)
    const many = zc.endRecords({ count: 70_000, cdSize: 5_000_000, cdOffset: 2 ** 33 })
    expect(many.zip64).toBe(true)
    const [z64, loc, eocd] = many.parts.map(p => new DataView(p.buffer))
    expect(z64.getUint32(0, true)).toBe(0x06064b50)
    expect(z64.getBigUint64(24, true)).toBe(70_000n)
    expect(z64.getBigUint64(40, true)).toBe(5_000_000n)
    expect(z64.getBigUint64(48, true)).toBe(BigInt(2 ** 33))
    expect(loc.getUint32(0, true)).toBe(0x07064b50)
    expect(loc.getBigUint64(8, true)).toBe(BigInt(2 ** 33 + 5_000_000))
    expect(eocd.getUint16(8, true)).toBe(0xFFFF)
    expect(eocd.getUint32(16, true)).toBe(U32)
    expect(eocd.getUint32(12, true)).toBe(5_000_000)
  })
})

// ── Complete export archives (manifest → browser ZIP) ───────────────────────
const jsonRes = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('complete owner reimbursement archive', () => {
  test('README + Invoice.html (local) + INDEX (all rows) + receipts in line order; one receipt per line', async () => {
    const rows = [
      { num: '01', date: '2026-03-15', vendor: 'Home Depot', amount: '1.00', description: 'Lumber', receipt: 'Receipts/01_2026-03-15_Home_Depot_1.00.pdf', url: 'https://signed/r1' },
      { num: '02', date: '—', vendor: '—', amount: '10.00', description: 'Misc', receipt: 'NO RECEIPT' },
      { num: '03', date: '2026-03-15', vendor: 'Home Depot', amount: '2.00', description: 'Lumber 2', receipt: 'Receipts/03_2026-03-15_Home_Depot_2.00.pdf', url: 'https://signed/r1' },
    ]
    const fetchFn = jest.fn(async () => jsonRes({ invoice_number: 'RI-1', zip_name: 'Reimb_RI_1.zip', total: 3, receipt_count: 2, offset: 0, next_offset: null, rows }))
    const storageFetch = jest.fn(async url => new Response(`bytes-of-${url}`, { status: 200 }))
    let saved
    const r = await exportOwnerReimbZip({ fetchFn, storageFetch, invoiceId: 'inv', invoiceHtml: '<html>Invoice RI-1</html>', save: (blob, name) => { saved = { blob, name } } })
    expect(r).toMatchObject({ filename: 'Reimb_RI_1.zip', count: 2, noReceipt: 1 })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ invoiceId: 'inv', offset: 0 }) // no invoiceHtml sent
    expect(saved.name).toBe('Reimb_RI_1.zip')
    const py = await pyRead(saved.blob)
    expect(py.bad).toBeNull()
    expect(py.entries.map(e => e.name)).toEqual(['README.txt', 'Invoice.html', 'INDEX.txt', 'Receipts/01_2026-03-15_Home_Depot_1.00.pdf', 'Receipts/03_2026-03-15_Home_Depot_2.00.pdf'])
    expect(py.entries[1].text).toBe('<html>Invoice RI-1</html>')
    const index = py.entries[2].text
    expect(index).toMatch(/^01 .*Receipts\/01_/m)
    expect(index).toMatch(/^02 .*NO RECEIPT/m)
    expect(index).toMatch(/3 line\(s\): 2 with receipt, 1 NO RECEIPT/)
    expect(py.entries[0].text).toMatch(/Receipts\/\s+—\s+2 receipt file/)
    expect(py.entries[3].text).toBe('bytes-of-https://signed/r1')
  })
})

describe('complete ITB archive', () => {
  test('README (server text) + ITB html (local, never sent) + Documents in manifest order, across pages', async () => {
    const pages = [
      { project_name: 'Main', zip_name: 'ITB_Main.zip', total: 3, offset: 0, next_offset: 2, readme_text: 'INVITATION TO BID\nProject: Main', entries: [{ name: 'Documents/A.pdf', url: 'https://s/a' }, { name: 'Documents/A_2.pdf', url: 'https://s/a2' }] },
      { project_name: 'Main', zip_name: 'ITB_Main.zip', total: 3, offset: 2, next_offset: null, readme_text: 'x', entries: [{ name: 'Documents/B.pdf', url: 'https://s/b' }] },
    ]
    const fetchFn = jest.fn(async (url, init) => jsonRes(pages.find(p => p.offset === JSON.parse(init.body).offset)))
    let saved
    await exportItbZip({ fetchFn, storageFetch: async u => new Response(u, { status: 200 }), bidPackageId: 'bp', selectedPlanIds: ['p1', 'p2', 'p3'], itbHtml: '<html>ITB</html>', save: (blob, name) => { saved = { blob, name } } })
    for (const [, init] of fetchFn.mock.calls) expect(JSON.parse(init.body)).not.toHaveProperty('itbHtml')
    const py = await pyRead(saved.blob)
    expect(py.entries.map(e => e.name)).toEqual(['README.txt', 'ITB_Invitation_to_Bid.html', 'Documents/A.pdf', 'Documents/A_2.pdf', 'Documents/B.pdf'])
    expect(py.entries[1].text).toBe('<html>ITB</html>')
    expect(saved.name).toBe('ITB_Main.zip')
  })
})
