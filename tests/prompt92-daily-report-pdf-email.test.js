/**
 * Prompt 92 — daily report "Export PDF" + "Email to owner" (commercial + residential).
 * Peyton 11/18: owners should see everything; good-looking PDF, no branding.
 * All DB / storage access is the in-memory mock; Resend is mocked; nothing live; no migration.
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { PDFDocument } = require('pdf-lib')
const { mockState, resetMockState } = require('./helpers/mock-db')

const mockSend = jest.fn()
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: (...a) => mockSend(...a) } })) }))
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const forbid = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (mockState.auth.error ? mockState.auth : PM.has(mockState.auth.role) ? mockState.auth : forbid()),
    isPM: r => PM.has(r),
    isSub: () => false,
    PM_ROLES: PM,
  }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const noToken = () => { mockState.auth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) } }
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const X = require('../lib/daily-report-export')
const XS = require('../lib/daily-report-export-server')
const { buildDailyReportPdf } = require('../lib/daily-report-pdf')
const route = require('../app/api/daily-reports/export/route')
const supa = require('@supabase/supabase-js').createClient()

// ── Test images ──────────────────────────────────────────────────────────────
// Header-only JPEG: pdf-lib reads the SOF marker for size and embeds the bytes as DCT.
const jpeg = (w = 32, h = 24) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9])
function png(w = 2, h = 2) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc(h * (1 + w * 3), 0x80)
  for (let y = 0; y < h; y++) raw[y * (1 + w * 3)] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ── PDF text extraction (content streams are Flate; Helvetica text is hex <..> Tj) ──
function pdfText(bytes) {
  const buf = Buffer.from(bytes)
  const s = buf.toString('latin1')
  const streams = []
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length
    const end = s.indexOf('endstream', start)
    if (end < 0) break
    const raw = buf.subarray(start, end)
    let t
    try { t = zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1') } catch { t = raw.toString('latin1') }
    streams.push(t)
    re.lastIndex = end + 'endstream'.length
  }
  const all = streams.join('\n')
  // Consecutive draws on one baseline (small-caps headings are drawn per letter) are joined.
  const pieces = []
  for (const h of all.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) pieces.push(Buffer.from(h[1], 'hex').toString('latin1'))
  return { text: pieces.join('\n'), joined: pieces.join(''), raw: s + all }
}

const BUCKET = 'daily-report-photos'
const rpt = (extra = {}) => ({
  id: 'r1', job_id: 'J1', super_id: 'super1', report_date: '2026-11-10', status: 'final',
  finalized_at: '2026-11-10T22:00:00Z', finalized_by: 'super1', revision_count: 0, created_at: '2026-11-10T21:00:00Z',
  weather: 'Partly Cloudy', weather_temp: '68', weather_delay: false, crew_count: 7,
  work_performed: 'Set steel columns on grid lines A–C.\nPoured footings at grid 4.',
  issues: 'Rebar delivery late by two hours.', safety_observations: 'All crew in PPE.', toolbox_talk: 'Ladder safety',
  crew_log: [{ name: 'Ana Ruiz', company: 'Ruiz Steel', trade: 'Ironworker', hours: '8' }],
  subcontractor_activity: [{ company: 'Lone Star Concrete', trade: 'Concrete', crew_count: '4', work_performed: 'Footings at grid 4' }],
  equipment_log: [{ name: 'Telehandler', quantity: '1', hours: '6' }],
  materials_delivered: [{ description: 'Anchor bolts', quantity: '40', supplier: 'Fastenal' }],
  visitors: [{ name: 'City Inspector', company: 'City of Tyler', purpose: 'Footing inspection' }],
  photos: [
    { path: 'J1/a.jpg', caption: 'East wall' },
    { path: 'J1/secret.jpg', caption: 'SECRET-INTERNAL', internal_only: true },
    { path: 'J1/c.heic', caption: 'iPhone photo' },
    { path: 'J1/p.png', caption: 'Slab pour' },
    { path: 'J1/cc/x.jpg', caption: 'HIDDEN-CC', job_photo_id: '11111111-1111-4111-8111-111111111111', source: 'job_photos' },
  ],
  ...extra,
})

const seed = (extra = {}) => {
  resetMockState({
    jobs: [
      { id: 'J1', project_name: 'Maple Street Clinic', job_number: '2026-042', location: '100 Maple St, Tyler, TX', owner_email: null },
      { id: 'J2', project_name: 'Oak Retail', job_number: '2026-050', location: '1 Oak', owner_email: 'existing@owner.com' },
    ],
    pm_job_assignments: [
      { id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'apm1' },
      { id: 'a3', job_id: 'J1', user_id: 'super1' }, { id: 'a4', job_id: 'J2', user_id: 'pm2' },
    ],
    profiles: [
      { id: 'super1', role: 'super', full_name: 'Sam Super' }, { id: 'pm1', role: 'pm', full_name: 'Pat <PM>' },
      { id: 'principal1', role: 'principal', full_name: 'Peyton' }, { id: 'apm1', role: 'apm' }, { id: 'pm9', role: 'pm' },
    ],
    daily_reports: [
      rpt(),
      rpt({ id: 'r2', report_date: '2026-11-12', created_at: '2026-11-12T21:00:00Z', photos: null, weather_delay: true }),
      rpt({ id: 'r3', report_date: '2026-11-13', status: 'draft', finalized_at: null, finalized_by: null, photos: null }),
      rpt({ id: 'r4', job_id: 'J2', report_date: '2026-11-11', photos: null }),
    ],
    job_photos: [{ id: '11111111-1111-4111-8111-111111111111', job_id: 'J1', storage_path: 'J1/cc/x.jpg', internal_only: true }],
    change_log: [],
    ...extra,
  })
  mockState.files = {
    [`${BUCKET}/J1/a.jpg`]: jpeg(),
    [`${BUCKET}/J1/secret.jpg`]: jpeg(),
    [`${BUCKET}/J1/c.heic`]: Buffer.from('not-a-jpeg-heic-bytes'),
    [`${BUCKET}/J1/p.png`]: png(),
    [`${BUCKET}/J1/cc/x.jpg`]: jpeg(),
  }
  mockSend.mockReset()
  mockSend.mockResolvedValue({ data: { id: 'em_1' }, error: null })
}

const exportPdf = async body => {
  const res = await route.POST(req('/api/daily-reports/export', 'POST', body))
  if (res.headers.get('content-type') === 'application/pdf') return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) }
  return { status: res.status, headers: res.headers, body: await res.json() }
}
const sendEmail = body => exportPdf({ mode: 'email', ...body })
const getSends = async jobId => {
  const res = await route.GET(req(`/api/daily-reports/export?job_id=${encodeURIComponent(jobId)}`, 'GET'))
  return { status: res.status, body: await res.json() }
}
const downloads = () => mockState.storageCalls.filter(c => c.op === 'download').map(c => c.path)
const sentLog = () => mockState.db.change_log.filter(e => e.field_name === 'emailed_to_owner')

// ─────────────────────────────────────────────────────────────────────────────
describe('prompt 92 — who may export / email (permission matrix)', () => {
  beforeEach(seed)

  test.each([
    ['principal', 'principal1'], ['admin', 'admin1'], ['pm', 'pm1'], ['apm', 'apm1'],
  ])('%s (%s) exports a final report on J1 → 200 PDF', async (role, id) => {
    as(role, id)
    const r = await exportPdf({ report_ids: ['r1'] })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(r.headers.get('content-disposition')).toContain('attachment; filename="2026-042 Daily Report 2026-11-10.pdf"')
    expect(Buffer.from(r.bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
  })

  test('office (principal / admin) can export any job, including one nobody assigned them to', async () => {
    as('admin', 'admin1')
    expect((await exportPdf({ report_ids: ['r4'] })).status).toBe(200)
    as('principal', 'principal1')
    expect((await exportPdf({ job_id: 'J2', range: { from: '2026-11-01', to: '2026-11-30' } })).status).toBe(200)
  })

  test.each([['pm', 'pm9'], ['apm', 'apm9'], ['pm', 'pm2']])('unassigned %s (%s) → 403, nothing downloaded or sent', async (role, id) => {
    as(role, id)
    expect((await exportPdf({ report_ids: ['r1'] })).status).toBe(403)
    expect((await exportPdf({ job_id: 'J1', range: { from: '2026-11-09', to: '2026-11-15' } })).status).toBe(403)
    expect((await sendEmail({ report_ids: ['r1'], to: ['o@x.com'] })).status).toBe(403)
    expect((await getSends('J1')).status).toBe(403)
    expect(downloads()).toEqual([])
    expect(mockSend).not.toHaveBeenCalled()
    expect(sentLog()).toHaveLength(0)
  })

  test('PM assigned to J2 cannot pull a J1 report into a PDF with a J2 one', async () => {
    as('pm', 'pm2')
    expect((await exportPdf({ report_ids: ['r4', 'r1'] })).status).toBe(403)
  })

  test('super — even assigned, even the author — 403 with the role message; GET 403', async () => {
    as('super', 'super1')
    const r = await exportPdf({ report_ids: ['r1'] })
    expect(r.status).toBe(403)
    expect(r.body.error).toBe(X.EXPORT_ROLE_MESSAGE)
    expect((await sendEmail({ report_ids: ['r1'], to: ['o@x.com'] })).status).toBe(403)
    expect((await getSends('J1')).status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test.each([['subcontractor'], ['owner'], ['sales']])('%s → 403', async role => {
    as(role)
    expect((await exportPdf({ report_ids: ['r1'] })).status).toBe(403)
  })

  test('no token → 401', async () => {
    noToken()
    expect((await exportPdf({ report_ids: ['r1'] })).status).toBe(401)
    noToken() // the mocked 401 Response body can be read once
    expect((await getSends('J1')).status).toBe(401)
  })

  test('unknown id → 404; reports from two jobs → 400 (office)', async () => {
    as('principal', 'principal1')
    expect((await exportPdf({ report_ids: ['nope'] })).status).toBe(404)
    expect((await exportPdf({ report_ids: ['r1', 'r4'] })).status).toBe(400)
  })

  test('canExportReports: principal / admin / pm / apm only', () => {
    for (const r of ['principal', 'admin', 'pm', 'apm']) expect(X.canExportReports(r)).toBe(true)
    for (const r of ['super', 'subcontractor', 'owner', 'sales', '', null, undefined]) expect(X.canExportReports(r)).toBe(false)
  })
})

describe('prompt 92 — drafts are refused', () => {
  beforeEach(seed)

  test('a draft by id → 400 "Draft reports can\'t be exported." (also mixed with a final, and for email)', async () => {
    as('pm', 'pm1')
    for (const ids of [['r3'], ['r1', 'r3']]) {
      const r = await exportPdf({ report_ids: ids })
      expect(r.status).toBe(400)
      expect(r.body.error).toBe("Draft reports can't be exported.")
    }
    const e = await sendEmail({ report_ids: ['r3'], to: ['o@x.com'] })
    expect(e.status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
    expect(downloads()).toEqual([])
  })

  test('a date range leaves drafts out (only finals in the PDF)', async () => {
    as('pm', 'pm1')
    const r = await exportPdf({ job_id: 'J1', range: { from: '2026-11-09', to: '2026-11-15' } })
    expect(r.status).toBe(200)
    expect(r.headers.get('x-report-count')).toBe('2')
    const { text } = pdfText(r.bytes)
    expect(text).toContain('Tuesday, November 10, 2026')
    expect(text).toContain('Thursday, November 12, 2026')
    expect(text).not.toContain('Friday, November 13, 2026')
  })

  test('a range with only a draft → 404', async () => {
    as('pm', 'pm1')
    expect((await exportPdf({ job_id: 'J1', range: { from: '2026-11-13', to: '2026-11-13' } })).status).toBe(404)
  })
})

describe('prompt 92 — photos', () => {
  beforeEach(seed)

  test('internal_only photos (own flag, or the picked job photo\'s CURRENT flag) are never downloaded or printed', async () => {
    as('pm', 'pm1')
    const r = await exportPdf({ report_ids: ['r1'] })
    expect(r.status).toBe(200)
    expect(downloads()).not.toContain('J1/secret.jpg')
    expect(downloads()).not.toContain('J1/cc/x.jpg')
    expect(downloads()).not.toContain('J1/c.heic') // unsupported extension: not downloaded
    expect(downloads().sort()).toEqual(['J1/a.jpg', 'J1/p.png'])
    const { text } = pdfText(r.bytes)
    expect(text).not.toContain('SECRET-INTERNAL')
    expect(text).not.toContain('HIDDEN-CC')
    expect(text).toContain('East wall')
    expect(text).toContain('Slab pour')
    expect(text).toContain('1 photo not embedded (unsupported format)')
  })

  test('a picked job photo made visible again in Site Photos is included', async () => {
    mockState.db.job_photos[0].internal_only = false
    as('pm', 'pm1')
    await exportPdf({ report_ids: ['r1'] })
    expect(downloads()).toContain('J1/cc/x.jpg')
  })

  test('if the job_photos rows cannot be read, picked photos are left out (fail safe)', async () => {
    mockState.failSelect = { job_photos: 'boom' }
    as('pm', 'pm1')
    expect((await exportPdf({ report_ids: ['r1'] })).status).toBe(200)
    expect(downloads()).not.toContain('J1/cc/x.jpg')
  })

  test('bytes that are not JPEG/PNG (renamed HEIC) count as unsupported', async () => {
    mockState.files[`${BUCKET}/J1/a.jpg`] = Buffer.from('ftypheic-but-named-jpg-123')
    const job = mockState.db.jobs[0]
    const { photoData } = await XS.collectReportPhotos(supa, job, [rpt()])
    expect(photoData.r1.images).toHaveLength(1) // the PNG
    expect(photoData.r1.notes.unsupported).toBe(2) // .heic name + sniffed bytes
  })

  test('a photo over 8 MB is skipped without downloading it', async () => {
    mockState.fileMeta = { [`${BUCKET}/J1/a.jpg`]: { size: 9 * 1024 * 1024, contentType: 'image/jpeg' } }
    const { photoData } = await XS.collectReportPhotos(supa, mockState.db.jobs[0], [rpt()])
    expect(photoData.r1.notes.tooLarge).toBe(1)
    expect(downloads()).not.toContain('J1/a.jpg')
  })

  test('caps: 60 per report, 150 per PDF; the rest counted as left out', async () => {
    const many = (id, n) => rpt({ id, photos: Array.from({ length: n }, (_, i) => ({ path: `J1/${id}-${i}.jpg`, caption: `p${i}` })) })
    const reports = [many('m1', 65), many('m2', 60), many('m3', 60)]
    for (const r of reports) for (const p of r.photos) mockState.files[`${BUCKET}/${p.path}`] = jpeg()
    const { photoData } = await XS.collectReportPhotos(supa, mockState.db.jobs[0], reports)
    expect(photoData.m1.images).toHaveLength(60)
    expect(photoData.m1.notes.overLimit).toBe(5)
    expect(photoData.m2.images).toHaveLength(60)
    expect(photoData.m3.images).toHaveLength(30)
    expect(photoData.m3.notes.overLimit).toBe(30)
    expect(downloads()).toHaveLength(150)
    expect(photoData.m1.images.map(i => i.caption).slice(0, 3)).toEqual(['p0', 'p1', 'p2'])
  })

  test('downloads run with at most 6 in flight', async () => {
    let inFlight = 0, peak = 0
    await XS.mapLimit(Array.from({ length: 20 }, (_, i) => i), 6, async () => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 2))
      inFlight--
    })
    expect(peak).toBe(6)
    expect(X.PHOTO_DOWNLOAD_CONCURRENCY).toBe(6)
  })
})

describe('prompt 92 — email to owner', () => {
  beforeEach(seed)

  test.each([
    [[], 'Add at least one recipient.'],
    [Array.from({ length: 21 }, (_, i) => `o${i}@x.com`), 'Send to 20 recipients or fewer.'],
    [['good@x.com', 'not-an-email'], '"not-an-email" is not a valid email address.'],
    [['a@b.com, <evil>@x.com'], null],
  ])('recipients %j → 400, nothing sent or logged', async (to, msg) => {
    as('pm', 'pm1')
    const r = await sendEmail({ report_ids: ['r1'], to })
    expect(r.status).toBe(400)
    if (msg) expect(r.body.error).toBe(msg)
    expect(mockSend).not.toHaveBeenCalled()
    expect(sentLog()).toHaveLength(0)
    expect(mockState.db.jobs[0].owner_email).toBeNull()
  })

  test('validateRecipients splits commas / new lines, de-duplicates, allows 20', () => {
    expect(X.validateRecipients('a@x.com, b@x.com\nA@x.com;c@x.com').recipients).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
    expect(X.validateRecipients(Array.from({ length: 20 }, (_, i) => `o${i}@x.com`)).ok).toBe(true)
    expect(X.validateRecipients('').ok).toBe(false)
  })

  test('subject > 200 or note > 2000 → 400', async () => {
    as('pm', 'pm1')
    expect((await sendEmail({ report_ids: ['r1'], to: ['o@x.com'], subject: 'x'.repeat(201) })).status).toBe(400)
    expect((await sendEmail({ report_ids: ['r1'], to: ['o@x.com'], note: 'x'.repeat(2001) })).status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('sends the PDF to exactly the recipients (no cc / bcc); escapeHtml on subject, note and names', async () => {
    as('pm', 'pm1')
    const r = await sendEmail({
      report_ids: ['r1'], to: ['owner@client.com', 'second@client.com'],
      subject: 'Report <b>bold</b> & "quoted"', note: '<script>alert(1)</script>\nThanks & regards',
    })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const msg = mockSend.mock.calls[0][0]
    expect(msg.to).toEqual(['owner@client.com', 'second@client.com'])
    expect(msg.cc).toBeUndefined()
    expect(msg.bcc).toBeUndefined()
    expect(JSON.stringify(msg)).not.toMatch(/pwhite@nvim\.co/)
    expect(msg.subject).toBe('Report <b>bold</b> & "quoted"')
    expect(msg.html).toContain('Report &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;')
    expect(msg.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(msg.html).not.toContain('<script>')
    expect(msg.html).not.toContain('<b>bold</b>')
    expect(msg.html).toContain('Pat &lt;PM&gt;')
    expect(msg.attachments).toHaveLength(1)
    expect(msg.attachments[0].filename).toBe('2026-042 Daily Report 2026-11-10.pdf')
    expect(Buffer.from(msg.attachments[0].content).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  test('default subject when none is given; CR/LF stripped from a subject', async () => {
    as('pm', 'pm1')
    await sendEmail({ report_ids: ['r1'], to: ['o@x.com'] })
    expect(mockSend.mock.calls[0][0].subject).toBe('Daily Report — Maple Street Clinic — Nov 10, 2026')
    await sendEmail({ report_ids: ['r1'], to: ['o@x.com'], subject: 'Hi\r\nBcc: evil@x.com' })
    expect(mockSend.mock.calls[1][0].subject).toBe('Hi Bcc: evil@x.com')
  })

  test('owner_email: saved from the FIRST recipient only when empty, and logged', async () => {
    as('pm', 'pm1')
    const r = await sendEmail({ report_ids: ['r1'], to: ['first@client.com', 'second@client.com'] })
    expect(r.body.owner_email_saved).toBe('first@client.com')
    expect(mockState.db.jobs[0].owner_email).toBe('first@client.com')
    const log = mockState.db.change_log.find(e => e.entity_type === 'job' && e.field_name === 'owner_email')
    expect(log).toMatchObject({ job_id: 'J1', entity_id: 'J1', new_value: 'first@client.com', changed_by: 'pm1' })
    // A second send never overwrites it.
    await sendEmail({ report_ids: ['r1'], to: ['other@client.com'] })
    expect(mockState.db.jobs[0].owner_email).toBe('first@client.com')
    expect(mockState.db.change_log.filter(e => e.field_name === 'owner_email')).toHaveLength(1)
  })

  test('owner_email: an existing address is never overwritten', async () => {
    as('principal', 'principal1')
    const r = await sendEmail({ report_ids: ['r4'], to: ['new@client.com'] })
    expect(r.status).toBe(200)
    expect(r.body.owner_email_saved).toBeNull()
    expect(mockState.db.jobs[1].owner_email).toBe('existing@owner.com')
  })

  test('owner_email: an empty-string owner_email counts as empty', async () => {
    mockState.db.jobs[0].owner_email = ''
    as('pm', 'pm1')
    await sendEmail({ report_ids: ['r1'], to: ['first@client.com'] })
    expect(mockState.db.jobs[0].owner_email).toBe('first@client.com')
  })

  test('a change_log entry per report emailed (range of 2 finals), with recipients + result', async () => {
    as('pm', 'pm1')
    const r = await sendEmail({ job_id: 'J1', range: { from: '2026-11-09', to: '2026-11-15' }, to: ['a@b.com', 'c@d.com'] })
    expect(r.status).toBe(200)
    expect(r.body.reports).toBe(2)
    const log = sentLog()
    expect(log.map(e => e.entity_id).sort()).toEqual(['r1', 'r2'])
    for (const e of log) {
      expect(e).toMatchObject({ job_id: 'J1', entity_type: 'daily_report', changed_by: 'pm1', changed_by_name: 'Pat <PM>', note: 'Emailed PDF to a@b.com, c@d.com' })
      const v = JSON.parse(e.new_value)
      expect(v).toMatchObject({ to: ['a@b.com', 'c@d.com'], result: 'sent', reports: 2, range: { from: '2026-11-09', to: '2026-11-15' } })
    }
    expect(mockSend.mock.calls[0][0].attachments[0].filename).toBe('2026-042 Daily Report 2026-11-09 to 2026-11-15.pdf')
  })

  test('a failed send → 502, logged as failed per report, owner_email untouched', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })
    as('pm', 'pm1')
    const r = await sendEmail({ report_ids: ['r1', 'r2'], to: ['o@x.com'] })
    expect(r.status).toBe(502)
    expect(r.body.error).toBe('Email not sent: domain not verified')
    const log = sentLog()
    expect(log).toHaveLength(2)
    for (const e of log) {
      expect(JSON.parse(e.new_value)).toMatchObject({ result: 'failed', error: 'domain not verified' })
      expect(e.note).toBe('Email of PDF to o@x.com failed: domain not verified')
    }
    expect(mockState.db.jobs[0].owner_email).toBeNull()
  })

  test('a thrown provider error is caught and logged too', async () => {
    mockSend.mockRejectedValue(new Error('network down'))
    as('pm', 'pm1')
    expect((await sendEmail({ report_ids: ['r1'], to: ['o@x.com'] })).status).toBe(502)
    expect(JSON.parse(sentLog()[0].new_value).result).toBe('failed')
  })

  test('GET: latest successful send per report → "Sent to … (+1) on …" (Central)', async () => {
    mockState.db.change_log.push(
      { job_id: 'J1', entity_type: 'daily_report', entity_id: 'r1', field_name: 'emailed_to_owner', created_at: '2026-11-17T15:00:00Z', new_value: JSON.stringify({ to: ['old@x.com'], result: 'sent' }) },
      { job_id: 'J1', entity_type: 'daily_report', entity_id: 'r1', field_name: 'emailed_to_owner', created_at: '2026-11-18T21:40:00Z', new_value: JSON.stringify({ to: ['a@b.com', 'c@d.com'], result: 'sent' }) },
      { job_id: 'J1', entity_type: 'daily_report', entity_id: 'r1', field_name: 'emailed_to_owner', created_at: '2026-11-18T22:00:00Z', new_value: JSON.stringify({ to: ['z@x.com'], result: 'failed' }) },
      { job_id: 'J1', entity_type: 'daily_report', entity_id: 'r2', field_name: 'emailed_to_owner', created_at: '2026-11-18T22:00:00Z', new_value: 'not json' },
    )
    as('apm', 'apm1')
    const r = await getSends('J1')
    expect(r.status).toBe(200)
    expect(Object.keys(r.body.sends)).toEqual(['r1'])
    expect(X.sentLabel(r.body.sends.r1)).toBe('Sent to a@b.com (+1) on Nov 18, 3:40 PM')
  })

  test('GET degrades safely: a change_log read error → { sends: {} }', async () => {
    mockState.failSelect = { change_log: 'boom' }
    as('pm', 'pm1')
    const r = await getSends('J1')
    expect(r.status).toBe(200)
    expect(r.body.sends).toEqual({})
  })
})

describe('prompt 92 — range limits', () => {
  beforeEach(seed)

  test.each([
    [{ from: '2026-11-01', to: '2026-12-02' }, 'Pick a range of 31 days or fewer.'],
    [{ from: '2026-11-15', to: '2026-11-09' }, 'From must be on or before To.'],
    [{ from: '2026-02-30', to: '2026-03-02' }, 'From and To must be valid dates (YYYY-MM-DD).'],
    [{ from: '', to: '2026-03-02' }, 'From and To must be valid dates (YYYY-MM-DD).'],
  ])('%j → 400', async (range, msg) => {
    as('pm', 'pm1')
    const r = await exportPdf({ job_id: 'J1', range })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe(msg)
  })

  test('31 days inclusive is allowed; top-level from / to works for downloads', async () => {
    as('pm', 'pm1')
    expect(X.rangeDays('2026-11-01', '2026-12-01')).toBe(31)
    expect((await exportPdf({ job_id: 'J1', from: '2026-11-01', to: '2026-12-01' })).status).toBe(200)
  })

  test('more than 31 final reports in the range (same-day duplicates) → 400', async () => {
    for (let i = 0; i < 32; i++) mockState.db.daily_reports.push(rpt({ id: `d${i}`, report_date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, photos: null }))
    as('pm', 'pm1')
    const r = await exportPdf({ job_id: 'J1', range: { from: '2026-10-01', to: '2026-10-31' } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/32 reports; export 31 or fewer/)
  })

  test('more than 31 report ids → 400', async () => {
    as('principal', 'principal1')
    const r = await exportPdf({ report_ids: Array.from({ length: 32 }, (_, i) => `x${i}`) })
    expect(r.status).toBe(400)
  })

  test('"This week" is Monday–Sunday in Central time', () => {
    expect(X.thisWeekCentral(new Date('2026-11-18T18:00:00Z'))).toEqual({ from: '2026-11-16', to: '2026-11-22' })
    expect(X.thisWeekCentral(new Date('2026-11-22T23:00:00Z'))).toEqual({ from: '2026-11-16', to: '2026-11-22' }) // Sunday
    expect(X.thisWeekCentral(new Date('2026-11-23T03:00:00Z'))).toEqual({ from: '2026-11-16', to: '2026-11-22' }) // still Sun 9 PM Central
    expect(X.thisWeekCentral(new Date('2026-11-23T07:00:00Z'))).toEqual({ from: '2026-11-23', to: '2026-11-29' }) // Monday
  })
})

describe('prompt 92 — PDF builder', () => {
  const job = { project_name: 'Maple Street Clinic', job_number: '2026-042', location: '100 Maple St, Tyler, TX' }
  const one = (extra = {}) => ({ ...rpt({ photos: null, ...extra }), job, author_name: 'Sam Super' })

  test('one report: valid PDF, "Page 1 of N" on every page, everything on the report, no branding', async () => {
    const bytes = await buildDailyReportPdf([one()], {})
    const doc = await PDFDocument.load(bytes)
    const n = doc.getPageCount()
    expect(n).toBeGreaterThanOrEqual(1)
    const { text, joined, raw } = pdfText(bytes)
    for (let i = 1; i <= n; i++) expect(text).toContain(`Page ${i} of ${n}`)
    expect(text).toContain('Daily Report')
    expect(text).toContain('Maple Street Clinic')
    expect(text).toContain('2026-042')
    expect(text).toContain('100 Maple St, Tyler, TX')
    expect(text).toContain('Tuesday, November 10, 2026')
    expect(text).toContain('Sam Super')
    expect(text).toContain('Partly Cloudy')
    expect(text).toContain('68°F'.replace('°', '\xb0'))
    expect(text).toContain('Set steel columns on grid lines A–C.'.replace('–', '\x96'))
    expect(text).toContain('Poured footings at grid 4.')
    for (const v of ['Ana Ruiz', 'Ruiz Steel', 'Ironworker', 'Lone Star Concrete', 'Footings at grid 4', 'Telehandler', 'Anchor bolts', 'Fastenal', 'City Inspector', 'Footing inspection', 'Rebar delivery late by two hours.', 'All crew in PPE.', 'Ladder safety']) {
      expect(text).toContain(v)
    }
    // Small-caps headings are drawn letter by letter.
    for (const h of ['WORK PERFORMED', 'CREW LOG', 'SUBCONTRACTOR ACTIVITY', 'EQUIPMENT', 'MATERIALS DELIVERED', 'VISITORS', 'ISSUES / DELAYS', 'SAFETY OBSERVATIONS', 'TOOLBOX TALK']) {
      expect(joined.replace(/\s/g, '')).toContain(h.replace(/\s/g, ''))
    }
    expect(text).toContain('Maple Street Clinic · Nov 10, 2026'.replace('·', '\xb7'))
    expect(raw).not.toMatch(/NV Construction/i)
    expect(raw).not.toMatch(/JaxEm/i)
    expect(raw).not.toMatch(/logo/i)
    expect(raw).not.toMatch(/pdf-lib/i)
  })

  test('weather delay flag and revision label are printed', async () => {
    const { text } = pdfText(await buildDailyReportPdf([one({ weather_delay: true, revision_count: 2, revised_by_name: 'Pat PM' })], {}))
    expect(text).toContain('Yes — weather delay day'.replace('—', '\x97'))
    expect(text).toContain('Revised (rev 2) by Pat PM')
  })

  test('empty sections are omitted (no "None" and no heading)', async () => {
    const { joined } = pdfText(await buildDailyReportPdf([one({ crew_log: null, visitors: [], issues: '', toolbox_talk: null })], {}))
    expect(joined).not.toContain('CREWLOG')
    expect(joined).not.toContain('VISITORS')
    expect(joined).not.toContain('TOOLBOXTALK')
    expect(joined).not.toContain('None')
  })

  test('long reports flow onto more pages, footer on each', async () => {
    const long = Array.from({ length: 160 }, (_, i) => `Line ${i} of the work performed today.`).join('\n')
    const bytes = await buildDailyReportPdf([one({ work_performed: long, crew_log: Array.from({ length: 80 }, (_, i) => ({ name: `Worker ${i}`, company: 'Co', trade: 'T', hours: '8' })) })], {})
    const n = (await PDFDocument.load(bytes)).getPageCount()
    expect(n).toBeGreaterThan(3)
    const { text } = pdfText(bytes)
    expect(text).toContain(`Page ${n} of ${n}`)
    expect(text).toContain('Line 159 of the work performed today.')
    expect(text).toContain('Worker 79')
  })

  test('photos: embedded in a grid with captions; unsupported bytes noted', async () => {
    const bytes = await buildDailyReportPdf([one()], {
      r1: { images: [{ bytes: jpeg(), caption: 'East wall', time: 'Nov 10, 2026, 9:15 AM' }, { bytes: png(), caption: 'Slab' }, { bytes: Buffer.from('webp?') }], notes: { tooLarge: 1, overLimit: 2 } },
    })
    const { text, joined } = pdfText(bytes)
    expect(joined).toContain('PHOTOS(2)')
    expect(text).toContain('East wall')
    expect(text).toContain('Nov 10, 2026, 9:15 AM')
    expect(text).toContain('1 photo not embedded (unsupported format)')
    expect(text).toContain('1 photo not embedded (over 8 MB)')
    expect(text).toContain('2 photos left out (photo limit for one PDF reached)')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  test('combined range: cover page + each report on its own page, in date order', async () => {
    const reports = [one({ id: 'b', report_date: '2026-11-12' }), one({ id: 'a', report_date: '2026-11-10' })]
    const bytes = await buildDailyReportPdf(reports, {}, { range: { from: '2026-11-09', to: '2026-11-15' } })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3)
    const { text } = pdfText(bytes)
    expect(text).toContain('Daily Reports')
    expect(text.replace(/\n/g, ' ')).toContain('Monday, November 9, 2026 \x96 Sunday, November 15, 2026')
    expect(text.indexOf('Tuesday, November 10, 2026')).toBeLessThan(text.indexOf('Thursday, November 12, 2026'))
    expect(text).toContain(`Page 1 of ${doc.getPageCount()}`)
  })

  test('no reports → throws', async () => {
    await expect(buildDailyReportPdf([], {})).rejects.toThrow()
  })
})

describe('prompt 92 — helpers and UI wiring', () => {
  test('exportFilename is sanitized', () => {
    expect(X.exportFilename({ job_number: '2026-042' }, ['2026-11-18'])).toBe('2026-042 Daily Report 2026-11-18.pdf')
    expect(X.exportFilename({ project_name: 'A/B "Main" <St>' }, ['2026-11-16', '2026-11-10'])).toBe('A B Main St Daily Report 2026-11-10 to 2026-11-16.pdf')
  })

  test('send-email route shares EMAIL_RE / MAX_RECIPIENTS', () => {
    const src = read('app/api/send-email/route.js')
    expect(src).toMatch(/import \{ MAX_RECIPIENTS, EMAIL_RE \} from '..\/..\/..\/lib\/daily-report-export'/)
    expect(X.MAX_RECIPIENTS).toBe(20)
  })

  test.each([['app/jobdetail/page.js'], ['app/residentialjobdetail/page.js']])('%s: buttons only on final reports and only for export roles', file => {
    const src = read(file)
    expect(src).toMatch(/!isDraftReport\(r\) && canExportDailyReports && \(\s*<ReportExportButtons/)
    expect(src).toContain('const canExportDailyReports = canExportReports(userRole) && !inPreview')
    expect(src).toContain('<ReportRangeExport')
    expect(src).toContain('<EmailReportsModal')
    expect(src).toContain('<ReportSentLine send={reportSends[r.id]} />')
  })

  test('modal: owner-email note, Preview PDF, stacked full-width at phone width', () => {
    const src = read('app/jobdetail/DailyReportExport.js')
    expect(src).toContain('OWNER_EMAIL_NOTE')
    expect(X.OWNER_EMAIL_NOTE).toBe("This address will be saved as the job's owner email.")
    expect(src).toContain('Preview PDF')
    expect(src).toMatch(/@media \(max-width:600px\)/)
    expect(src).toContain('flex-direction:column-reverse')
  })

  test('no new migration in prompt 92', () => {
    const files = fs.readdirSync(path.join(root, 'migrations'))
    expect(files.filter(f => /^(079|08\d|09\d)_/.test(f))).toEqual([])
  })
})
