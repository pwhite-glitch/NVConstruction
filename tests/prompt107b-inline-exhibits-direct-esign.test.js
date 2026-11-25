/**
 * Prompt 107b: Edit & Print shows the real exhibit pages inline (no cover pages) + one-click Send
 * for e-Signature from the edit window.
 * Peyton 11/25: "when i print the subcontract it says exhibit a and b but the exhibits are not
 * actually there … i need to send for esignautre from there. not from the main screen."
 *  - merge: no cover pages, "EXHIBIT A – …" stamped on each exhibit's first page, page ranges,
 *    one notice page only for a file that could not be added.
 *  - exhibitAppendixHtml: one note, no page break, marker kept.
 *  - exhibitPagesHtml (lib/exhibit-pages.js): page images, data:image only, escaped.
 *  - stripEditorChrome removes .nv-exhibit-pages.
 *  - job page source checks (toolbar, window script, send branch).
 *  - postContractForSignature (lib/contract-send.js) with injected fetch / upload.
 * Nothing live; pdf.js (browser only) is not loaded here.
 */
const fs = require('fs')
const path = require('path')
const { PDFDocument, PDFPage } = require('pdf-lib')

const X = require('../lib/subcontract-exhibits')
const P = require('../lib/exhibit-pages')
const E = require('../lib/edited-contract')
const C = require('../lib/contract-send')
const { buildSubcontractHtml } = require('../lib/buildSubcontractHtml')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const SC1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

async function pdfOfPages(n, size = [300, 400], rotate = 0) {
  const d = await PDFDocument.create()
  for (let i = 0; i < n; i++) {
    const p = d.addPage(size)
    if (rotate) p.setRotation({ type: 'degrees', angle: rotate })
  }
  return Buffer.from(await d.save())
}

// Every drawText call during a merge: [{ text, opts, width, height }].
function spyDrawText() {
  const calls = []
  const orig = PDFPage.prototype.drawText
  const spy = jest.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (text, opts) {
    calls.push({ text, opts, width: this.getWidth(), height: this.getHeight() })
    return orig.call(this, text, opts)
  })
  return { calls, restore: () => spy.mockRestore() }
}

// ── 1. merge: no cover pages, label on the first page, page ranges ───────────
describe('buildExhibitsPdf (prompt 107b)', () => {
  test('3-page proposal PDF + PNG billing schedule → 4 pages, ranges A 1/3 and B 4/1, label stamped', async () => {
    const spy = spyDrawText()
    let out
    try {
      out = await X.buildExhibitsPdf([
        { exhibit: X.EXHIBIT_A, file: { name: 'proposal.pdf', bytes: await pdfOfPages(3) } },
        { exhibit: X.EXHIBIT_B, file: { name: 'schedule.png', bytes: PNG_1PX } },
      ], { subtitle: 'Acme' })
    } finally { spy.restore() }
    const doc = await PDFDocument.load(out.bytes)
    expect(doc.getPageCount()).toBe(4)
    expect(doc.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([[300, 400], [300, 400], [300, 400], [612, 792]])
    expect(out.notes).toEqual([])
    expect(out.included_exhibits.map(e => [e.letter, e.first_page, e.page_count])).toEqual([['A', 1, 3], ['B', 4, 1]])
    // one label per exhibit, on its first page only; nothing else drawn (no cover page text)
    expect(spy.calls.map(c => c.text)).toEqual(['EXHIBIT A – Subcontractor Proposal', 'EXHIBIT B – Billing Schedule'])
    const a = spy.calls[0]
    expect(a.opts.size).toBe(9)
    expect(a.opts.x).toBeCloseTo(25.2, 1) // 0.35 in from the left
    expect(a.opts.y).toBeCloseTo(400 - 25.2 - 9, 1) // near the top of the 400 pt page
    expect(a.opts.rotate).toBeUndefined()
    expect(spy.calls[1].opts.y).toBeCloseTo(792 - 25.2 - 9, 1)
    expect(X.exhibitLabelText({ letter: 'C', title: 'Plans ≥ v2\nrev' })).toBe('EXHIBIT C – Plans >= v2 rev')
  })

  test('a rotated page gets the label turned with it, at the visible top-left corner', async () => {
    const spy = spyDrawText()
    try {
      await X.buildExhibitsPdf([{ exhibit: X.EXHIBIT_A, file: { name: 'p.pdf', bytes: await pdfOfPages(1, [300, 400], 90) } }])
    } finally { spy.restore() }
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0].opts.rotate).toEqual({ type: 'degrees', angle: 90 })
    expect(spy.calls[0].opts.x).toBeCloseTo(25.2 + 9, 1)
    expect(spy.calls[0].opts.y).toBeCloseTo(25.2, 1)
  })

  test('extras keep running page ranges', async () => {
    const out = await X.buildExhibitsPdf([
      { exhibit: X.EXHIBIT_A, file: { name: 'a.pdf', bytes: await pdfOfPages(2) } },
      { exhibit: { key: 'extra:x', letter: 'C', title: 'Plans' }, file: { name: 'c.pdf', bytes: await pdfOfPages(5) } },
    ])
    expect(out.included_exhibits).toEqual([
      { key: 'proposal', letter: 'A', title: 'Subcontractor Proposal', first_page: 1, page_count: 2 },
      { key: 'extra:x', letter: 'C', title: 'Plans', first_page: 3, page_count: 5 },
    ])
  })

  // ── 2. unreadable → exactly one notice page ──
  test('an unreadable PDF → exactly one notice page, still saying "attached separately"', async () => {
    const spy = spyDrawText()
    let out
    try {
      out = await X.buildExhibitsPdf([
        { exhibit: X.EXHIBIT_A, file: { name: 'broken.pdf', bytes: Buffer.from('%PDF-1.4 not really') } },
        { exhibit: X.EXHIBIT_B, file: { name: 's.pdf', bytes: await pdfOfPages(2) } },
      ])
    } finally { spy.restore() }
    const doc = await PDFDocument.load(out.bytes)
    expect(doc.getPageCount()).toBe(1 + 2)
    expect(out.notes).toEqual([{ key: 'proposal', name: 'broken.pdf', reason: 'the PDF could not be read' }])
    expect(out.included_exhibits.map(e => [e.letter, e.first_page, e.page_count])).toEqual([['A', 1, 1], ['B', 2, 2]])
    const notice = spy.calls.filter(c => c.width === 612).map(c => c.text).join(' ')
    expect(notice).toContain('Exhibit A – Subcontractor Proposal')
    expect(notice).toMatch(/attached separately/)
    expect(notice).toContain('broken.pdf')
    // the readable one still has only its label drawn
    expect(spy.calls.filter(c => c.width === 300).map(c => c.text)).toEqual(['EXHIBIT B – Billing Schedule'])
  })

  test('source: no coverPage() before a readable exhibit', () => {
    const src = read('lib/subcontract-exhibits.js')
    expect(src).not.toMatch(/coverPage\(/)
    expect(src).toMatch(/drawText\(text, \{ \.\.\.pos, size, font, color: LABEL_INK/)
  })
})

// ── 3. appendix: one note, no page break ─────────────────────────────────────
describe('exhibitAppendixHtml (prompt 107b)', () => {
  const p1 = X.exhibitsPdfPath(SC1, new Date('2026-11-25T16:52:00.000Z'))
  const appendix = X.exhibitAppendixHtml({ proposal: { name: 'p.pdf' }, billing: { name: 's.pdf' }, extras: [{ letter: 'C', title: 'Plans', name: 'c.pdf' }], exhibitsPath: p1 })
  test('exact shape, no cover pages', () => {
    expect(appendix).toBe(`<div class="nv-exhibits" data-nv-exhibits="${p1}">\n<div class="nv-exhibit-note" style="margin-top:14px;font-size:10pt">Exhibits A, B and C (attached) are part of this Subcontract.</div>\n</div>`)
    expect(appendix).not.toMatch(/page-break/)
    expect(appendix).not.toContain('The full exhibit follows')
    expect(appendix).not.toContain('p.pdf')
    expect(X.exhibitAppendixHtml({ billing: { name: 's.pdf' } })).toContain('>Exhibit B (attached) is part of this Subcontract.<')
    expect(X.exhibitAppendixHtml({})).toBe('')
  })
  test('withExhibitAppendix is idempotent and the marker is still read', () => {
    const gen = buildSubcontractHtml({ sub_name: 'Acme', contract_amount: '100', job_number: '7555', subcontract_number: '2026-7555-001', pay_pct: '100' }, 'https://portal.example')
    const once = X.withExhibitAppendix(gen, appendix)
    const twice = X.withExhibitAppendix(once, appendix)
    expect(twice).toBe(once)
    expect(twice.match(/class="nv-exhibits"/g)).toHaveLength(1)
    expect(X.exhibitsPathFromHtml(twice, SC1)).toBe(p1)
    const other = X.withExhibitAppendix(once, X.exhibitAppendixHtml({ proposal: { name: 'x' } }))
    expect(other).toContain('Exhibit A (attached)')
    expect(other).not.toContain('Exhibits A, B and C')
    // the edited-contract strip still removes it
    expect(E.stripEditorChrome(once)).not.toContain('nv-exhibit')
  })
})

// ── 4. exhibitPagesHtml ──────────────────────────────────────────────────────
describe('exhibitPagesHtml', () => {
  const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
  const png = 'data:image/png;base64,iVBORw0KGgo='
  test('one .nv-exhibit-page per page, each with a page break before it', () => {
    const html = P.exhibitPagesHtml([{ src: jpg, width: 1224, height: 1584 }, { src: png, width: 10, height: 10 }])
    expect(html.match(/class="nv-exhibit-page"/g)).toHaveLength(2)
    expect(html.match(/page-break-before:always;break-before:page;page-break-inside:avoid;text-align:center/g)).toHaveLength(2)
    expect(html).toContain(`<img src="${jpg}" alt="Exhibit page 1" style="display:block;margin:0 auto;max-width:100%;max-height:9.2in;width:auto;height:auto">`)
    expect(html).toContain('alt="Exhibit page 2"')
  })
  test('rejects anything but data:image/(jpeg|png);base64 and escapes attributes', () => {
    const bad = ['javascript:alert(1)', 'http://evil.example/x.jpg', 'https://x/y.png', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/png;base64,AAAA" onerror="alert(1)', 'data:image/jpeg;base64,AA AA', '', null, 42]
    expect(P.exhibitPagesHtml(bad.map(src => ({ src })))).toBe('')
    expect(P.exhibitPagesHtml(null)).toBe('')
    for (const b of bad) expect(P.isExhibitPageSrc(b)).toBe(false)
    const html = P.exhibitPagesHtml([{ src: 'javascript:x' }, { src: jpg }])
    expect(html).not.toContain('javascript')
    expect(html).toContain('alt="Exhibit page 1"')
    expect(html).not.toMatch(/onerror|<script/)
  })
  test('letter range for the status line', () => {
    expect(P.exhibitLetterRange(['A', 'B', 'C'])).toBe('A–C')
    expect(P.exhibitLetterRange(['A', 'B'])).toBe('A and B')
    expect(P.exhibitLetterRange(['A', 'C', 'D'])).toBe('A, C and D')
    expect(P.exhibitLetterRange(['B'])).toBe('B')
    expect(P.exhibitLetterRange([])).toBe('')
  })
  test('the pdf.js loader is browser-only, pinned, legacy build, cached import', () => {
    const src = read('lib/exhibit-pages-client.js')
    expect(src).toContain("'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs'")
    expect(src).toContain("'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs'")
    expect(src).toContain('import(/* webpackIgnore: true */ PDFJS_URL)')
    expect(src).toContain('GlobalWorkerOptions.workerPort')
    expect(src).toContain('GlobalWorkerOptions.workerSrc = WORKER_URL')
    expect(src).toMatch(/if \(!pdfjsPromise\)/)
    expect(src).toContain("canvas.toDataURL('image/jpeg', quality)")
    expect(src).toMatch(/export async function renderPdfPages\(arrayBuffer, \{ scale = 2, quality = 0\.85, timeoutMs = 45000 \} = \{\}\)/)
    // never imported by server code
    for (const f of ['lib/subcontract-exhibits.js', 'lib/subcontract-exhibits-server.js', 'app/api/subcontract-exhibits/route.js', 'app/api/signing-requests/route.js']) expect(read(f)).not.toMatch(/(import|require)[^\n]*exhibit-pages-client/)
  })
})

// ── 5. stripEditorChrome ─────────────────────────────────────────────────────
describe('stripEditorChrome removes the inline exhibit pages', () => {
  test('nested divs / imgs go, the EXHIBITS: list stays', () => {
    const body = '<p><strong>EXHIBITS:</strong><br>Exhibit A – Subcontractor Proposal<br>Exhibit B – Billing Schedule</p>'
    const pages = '<div class="nv-exhibit-pages" contenteditable="false"><div class="nv-exhibit-page" style="page-break-before:always"><div><img src="data:image/jpeg;base64,AAAA" alt="Exhibit page 1"></div></div>' +
      '<div class="nv-exhibit-page"><img src="data:image/jpeg;base64,BBBB"></div><p class="nv-exhibit-fallback"><a href="https://x/y.pdf">Open the exhibits PDF</a></p></div>'
    const out = E.stripEditorChrome(`<!DOCTYPE html><html><body>${body}${pages}<p>after</p></body></html>`)
    expect(out).toBe(`<!DOCTYPE html><html><body>${body}<p>after</p></body></html>`)
    expect(E.prepareEditedContract(`<html><body>${body}${pages}</body></html>`, '2026-11-25T16:52:00.000Z')).not.toContain('data:image')
  })
})

// ── 6. job page source checks ────────────────────────────────────────────────
describe('job page (source checks, prompt 107b)', () => {
  const page = read('app/jobdetail/page.js')
  const handler = page.slice(page.indexOf('async function handleContractEditsMessage('), page.indexOf('contractEditsHandlerRef.current = handleContractEditsMessage'))
  const gen = page.slice(page.indexOf('function generateSubcontract()'), page.indexOf('// Prompt 97: office "Upload signed contract"'))
  test('banner / pop-up / cover appendix are gone', () => {
    for (const s of ['showExhibitsBanner', 'EXHIBITS_BANNER_TIP', "'Open exhibits PDF'", 'nv-exhibits-banner', 'nv-exhibits-slot', 'pop-up blocked', 'Attaching exhibits…', 'exhibitCoversHtml', 'use Open exhibits', 'Go back to the portal tab', 'enter the signer and click Send Link']) {
      expect(page).not.toContain(s)
    }
    expect(gen).not.toMatch(/win\.open\(/)
    expect(gen).toContain('<div class="nv-exhibit-pages" contenteditable="false"></div>')
    expect(gen).toContain('loadExhibitPagesIntoWindow(win, ex.data, notes)')
    expect(page).toContain("const { renderPdfPages } = await import('../../lib/exhibit-pages-client')")
    expect(page).toContain('el.innerHTML = exhibitPagesHtml(pages)')
    expect(page).toContain("a.textContent = 'Open the exhibits PDF'")
    expect(page).toContain('Loading exhibit pages (${letters.join(\', \')})…')
    expect(page).toContain('added below the contract (${pages.length} page')
  })
  test('toolbar: Print, Save (gray), Send (primary) in that order; signer line + inline form', () => {
    const iPrint = gen.indexOf('id="nv-print-btn"'), iSave = gen.indexOf('id="nv-save-btn"'), iSend = gen.indexOf('id="nv-send-btn"')
    expect(iPrint).toBeGreaterThan(-1)
    expect(iSave).toBeGreaterThan(iPrint)
    expect(iSend).toBeGreaterThan(iSave)
    expect(gen).toContain('>Save</button>')
    expect(gen).not.toContain('>Save edits</button>')
    expect(gen).toContain('#nv-bar #nv-save-btn{background:#e5e7eb')
    expect(gen).toContain('id="nv-signer-change">(change)</a>')
    expect(gen).toContain('Signer full legal name</label> <input id="nv-signer-name"')
    expect(gen).toContain('<span id="nv-signer-form" contenteditable="false">')
    expect(gen).toContain('Exhibit pages are still loading — one moment')
    expect(gen).toContain('window.NV_EXHIBITS_LOADING=')
  })
  test('window script: removes .nv-exhibit-pages before postMessage and posts the signer', () => {
    const iRemove = gen.indexOf('c.querySelectorAll(".nv-exhibit-pages")')
    const iPost = gen.indexOf('window.opener.postMessage(')
    expect(iRemove).toBeGreaterThan(-1)
    expect(iRemove).toBeLessThan(iPost)
    expect(gen).toContain('signer_name:s.name,signer_email:s.email')
    expect(gen).toContain('nvEdits("send",{name:v.name,email:v.email})')
    expect(gen).toContain('nvSendState("sending")')
    expect(gen).toContain('"Sent ✓"')
    expect(gen).toContain('nvStatus(NV_SIGNER_MSG)')
    expect(gen).toContain('printWinRef.current = { win, contract_id: contractId || null, include: contractId ? include : null, document_title: documentTitle }')
    expect(gen).toContain('win.nvSetSigner?.(name, email)')
    expect(page).toMatch(/async function getSignerDefaults\(contract\)[\s\S]{0,400}pickSignerContact\(\{ contract, assignments: subs, company, directory: subDirectory \}\)/)
    expect(page).toMatch(/async function openSignPanel[\s\S]{0,300}await getSignerDefaults\(contract\)/)
  })
  test("handleContractEditsMessage 'send': shared send, no portal focus / sign panel / confirm", () => {
    expect(handler).toContain('sendContractForSignature({')
    expect(handler).toContain('html: sanitizeContractHtml(stripEditorChrome(edited))')
    expect(handler).toContain('include: pw.include, edited: true')
    expect(handler).not.toContain('openSignPanel')
    expect(handler).not.toContain('window.focus')
    expect(handler).not.toContain('window.confirm')
    expect(handler).not.toContain('alert(')
    expect(handler).toContain('windowSendInFlightRef.current[contractId]')
    expect(handler).toContain('This subcontract is a draft. Activate it before sending it for signature.')
    expect(handler).toMatch(/const saved = await saveCopy\(\)/)
    expect(handler).toContain('Not sent: ${r.error}.')
    expect(handler).toContain('at ${formatCentralTime(new Date().toISOString())} CT.')
    expect(handler).toContain('signerLabel(signerName, signerEmail)')
    // origin / source checks unchanged
    expect(handler).toContain('event.origin === window.location.origin')
    expect(handler).toContain('event.source === printWinRef.current.win')
  })
  test('sendForESign keeps its checks and prompt and calls sendContractForSignature', () => {
    const fn = page.slice(page.indexOf('async function sendForESign()'), page.indexOf('// ── Change Orders'))
    expect(fn).toContain('sendContractForSignature({')
    expect(fn).toContain('chooseContractForSend(')
    expect(fn).toContain("This subcontract is a draft. Activate it before sending it for signature.")
    expect(fn).toContain('confirmContractAddresses()')
    expect(fn).not.toContain("target: 'signing-html'")
    const shared = page.slice(page.indexOf('async function sendContractForSignature('), page.indexOf('async function handleContractEditsMessage('))
    expect(shared).toContain('postContractForSignature(')
    expect(shared).toContain('markContractGenerated(contractId, r.json?.saved_contract)')
    expect(shared).toContain('await loadSigningRequests()')
  })
})

// ── 7. postContractForSignature ──────────────────────────────────────────────
describe('postContractForSignature (lib/contract-send.js)', () => {
  const okJson = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  function deps({ response, uploadFails = false } = {}) {
    const calls = { fetch: [], upload: [] }
    const fetchFn = jest.fn(async (url, init) => { calls.fetch.push({ url, body: JSON.parse(init.body) }); return response })
    const uploadThenSend = jest.fn(async opts => {
      calls.upload.push(opts)
      if (uploadFails) return { ok: false, stage: 'upload', error: 'storage down' }
      return { ...(await opts.send({ path: 'staged/x.html', receipt: 'r' })), stage: 'save' }
    })
    return { calls, deps: { fetchFn, putFn: jest.fn(), uploadThenSend, makeFile: (text, name) => ({ text, name }) } }
  }
  const args = { jobId: 'job-1', contractId: SC1, html: '<p>edited</p>', signerName: ' Jane Doe ', signerEmail: ' Jane@X.com ', include: { proposal: true, billing: false, extras: true }, edited: true, documentTitle: 'Subcontract — Acme — Job #7555' }

  test('stages the HTML and posts signer + exhibits include; success message', async () => {
    const { calls, deps: d } = deps({ response: okJson({ provider: 'signwell', data: { test_mode: false }, exhibits_included_letters: ['A', 'C'], voided: 1, saved_contract: { id: 'g' } }) })
    const r = await C.postContractForSignature(args, d)
    expect(r.ok).toBe(true)
    expect(calls.upload[0]).toMatchObject({ target: 'signing-html', file: { text: '<p>edited</p>', name: 'signing.html' }, context: { job_id: 'job-1', record_id: SC1 } })
    expect(calls.fetch).toHaveLength(1)
    expect(calls.fetch[0].url).toBe('/api/signing-requests')
    expect(calls.fetch[0].body).toEqual({
      job_id: 'job-1', subcontract_id: SC1, signer_email: 'jane@x.com', signer_name: 'Jane Doe',
      document_attachment: { path: 'staged/x.html', receipt: 'r' }, document_title: 'Subcontract — Acme — Job #7555',
      exhibits: { proposal: true, billing: false, extras: true },
    })
    expect(r.message).toBe('Sent through SignWell (edited version). The subcontractor will receive a SignWell email to sign. Exhibits A and C attached. The older link was cancelled.')
    expect(r.json.saved_contract).toEqual({ id: 'g' })
  })
  test('no contract id → no exhibits key; built-in link message', async () => {
    const { calls, deps: d } = deps({ response: okJson({ exhibits_included: ['proposal', 'billing'] }) })
    const r = await C.postContractForSignature({ ...args, contractId: null, edited: false }, d)
    expect(calls.fetch[0].body.exhibits).toBeUndefined()
    expect(calls.fetch[0].body.subcontract_id).toBeNull()
    expect(r.message).toBe('Sent! The subcontractor will receive an email link to sign. Exhibits A and B attached.')
  })
  test('server error → ok false with the error (the caller then saves the copy)', async () => {
    const { deps: d } = deps({ response: new Response(JSON.stringify({ error: 'Nothing was sent: could not read Exhibit A (p.pdf). Try again.' }), { status: 502, headers: { 'Content-Type': 'application/json' } }) })
    const r = await C.postContractForSignature(args, d)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('Nothing was sent: could not read Exhibit A (p.pdf). Try again.')
    expect(r.message).toBe('Error: Nothing was sent: could not read Exhibit A (p.pdf). Try again.')
  })
  test('upload failure and a throwing dependency never throw', async () => {
    const { calls, deps: d } = deps({ uploadFails: true })
    const r = await C.postContractForSignature(args, d)
    expect(r).toMatchObject({ ok: false, error: 'could not stage the document: storage down' })
    expect(calls.fetch).toHaveLength(0)
    const boom = await C.postContractForSignature(args, { ...d, uploadThenSend: async () => { throw new Error('boom') } })
    expect(boom).toMatchObject({ ok: false, error: 'boom' })
  })
  test('signer checks', () => {
    expect(C.signerError({ signerName: 'Jane Doe', signerEmail: 'jane@x.com' })).toBeNull()
    expect(C.signerError({ signerName: '', signerEmail: 'jane@x.com' })).toBe("Enter the signer's full legal name and email")
    expect(C.signerError({ signerName: 'Jane', signerEmail: 'jane@x' })).toBe(C.SIGNER_MISSING_MESSAGE)
    expect(C.signerError({ signerName: 'Jane', signerEmail: '' })).toBe(C.SIGNER_MISSING_MESSAGE)
    expect(C.signerLabel(' Jane Doe ', ' JANE@X.com ')).toBe('Jane Doe <jane@x.com>')
  })
  test('the page saves the copy when the window send fails', () => {
    const page = read('app/jobdetail/page.js')
    const handler = page.slice(page.indexOf('async function handleContractEditsMessage('), page.indexOf('contractEditsHandlerRef.current = handleContractEditsMessage'))
    const iFail = handler.indexOf('} else {', handler.indexOf('if (r.ok) {'))
    expect(handler.indexOf('await saveCopy()', iFail)).toBeGreaterThan(iFail)
    expect(handler).toContain("' Your edits were saved.'")
  })
})

// ── 8. Leftover: Print can never get stuck waiting for exhibit pages ─────────
describe('withTimeout (lib/exhibit-pages.js)', () => {
  afterEach(() => { jest.useRealTimers() })
  test('resolves with the value when on time and clears its timer', async () => {
    jest.useFakeTimers()
    const p = P.withTimeout(Promise.resolve(42), 1000, 'too slow')
    await expect(p).resolves.toBe(42)
    expect(jest.getTimerCount()).toBe(0)
  })
  test('passes through a rejection on time and clears its timer', async () => {
    jest.useFakeTimers()
    await expect(P.withTimeout(Promise.reject(new Error('boom')), 1000, 'too slow')).rejects.toThrow('boom')
    expect(jest.getTimerCount()).toBe(0)
  })
  test('rejects with the message after ms', async () => {
    jest.useFakeTimers()
    const p = P.withTimeout(new Promise(() => {}), 1000, 'the PDF viewer did not respond')
    let settled = false
    p.catch(() => { settled = true })
    jest.advanceTimersByTime(999)
    await Promise.resolve()
    expect(settled).toBe(false)
    jest.advanceTimersByTime(1)
    await expect(p).rejects.toThrow(new Error('the PDF viewer did not respond'))
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('exhibit pages never block Print (source checks)', () => {
  const client = read('lib/exhibit-pages-client.js')
  const page = read('app/jobdetail/page.js')
  test('pdf.js loader: worker error listeners, workerSrc fallback, timeouts, destroy + reset', () => {
    expect(client).toContain("import { withTimeout } from './exhibit-pages'")
    expect(client).toContain("worker.addEventListener('error', onWorkerError)")
    expect(client).toContain("worker.addEventListener('messageerror', onWorkerError)")
    expect(client).toMatch(/const onWorkerError = \(\) => \{\s*workerFailed = true\s*try \{ worker\.terminate\(\) \} catch \{\}/)
    expect(client).toMatch(/function useWorkerSrc\(pdfjs\) \{\s*pdfjs\.GlobalWorkerOptions\.workerPort = null\s*pdfjs\.GlobalWorkerOptions\.workerSrc = WORKER_URL/)
    expect(client).toContain('if (workerFailed && pdfjs.GlobalWorkerOptions.workerPort) useWorkerSrc(pdfjs)')
    expect(client).toContain("withTimeout(import(/* webpackIgnore: true */ PDFJS_URL), 20000, 'the PDF viewer did not load')")
    expect(client).toContain("await withTimeout(task.promise, timeoutMs, 'the PDF viewer did not respond')")
    const iCatch = client.indexOf("'the PDF viewer did not respond')")
    const after = client.slice(iCatch, iCatch + 400)
    expect(after).toContain('task.destroy()')
    expect(after).toContain('pdfjsPromise = null')
    expect(after).toContain('throw e')
  })
  test('loadExhibitPagesIntoWindow: AbortController on the download, withTimeout around it all, finally clears the flag', () => {
    const fn = page.slice(page.indexOf('async function loadExhibitPagesIntoWindow('), page.indexOf('async function sendContractForSignature('))
    expect(page).toMatch(/import \{ exhibitPagesHtml, exhibitLetterRange, withTimeout \} from '\.\.\/\.\.\/lib\/exhibit-pages'/)
    expect(fn).toContain('const ctrl = new AbortController()')
    expect(fn).toContain('setTimeout(() => ctrl.abort(), 30000)')
    expect(fn).toContain('fetch(data.url, { signal: ctrl.signal })')
    expect(fn).toContain("'the exhibits PDF did not download in time'")
    expect(fn).toContain("60000, 'the exhibit pages took too long')")
    expect(fn.indexOf('await withTimeout(')).toBeLessThan(fn.indexOf('fetch(data.url'))
    expect(fn.indexOf("60000, 'the exhibit pages took too long')")).toBeGreaterThan(fn.indexOf('renderPdfPages(bytes'))
    expect(fn).toMatch(/finally \{\s*try \{ if \(win && !win\.closed\) win\.NV_EXHIBITS_LOADING = false \} catch \{\}/)
  })
  test('Print: first click while loading shows the status, later clicks confirm in the window', () => {
    const gen = page.slice(page.indexOf('function generateSubcontract()'), page.indexOf('// Prompt 97: office "Upload signed contract"'))
    expect(gen).toContain("'var NV_PRINT_WAIT_CLICKS=0;'")
    const iClick = gen.indexOf('document.getElementById("nv-print-btn").addEventListener("click"')
    const handler = gen.slice(iClick, gen.indexOf('window.print();', iClick))
    expect(handler).toContain('NV_PRINT_WAIT_CLICKS++;')
    expect(handler).toContain('if(NV_PRINT_WAIT_CLICKS===1){nvStatus("Exhibit pages are still loading — one moment");return;}')
    expect(handler).toContain('if(!window.confirm("The exhibit pages are still loading. Print the contract without them?"))return;')
  })
  test("a 'send' while one is in flight tells the window instead of returning silently", () => {
    const handler = page.slice(page.indexOf('async function handleContractEditsMessage('), page.indexOf('contractEditsHandlerRef.current = handleContractEditsMessage'))
    expect(handler).toMatch(/if \(sending && windowSendInFlightRef\.current\[contractId\]\) \{\s*winSendResult\(false, 'A send for this contract is still in progress — check Signing requests in the portal before sending again\.'\)\s*return\s*\}/)
    expect(handler).not.toMatch(/if \(sending && windowSendInFlightRef\.current\[contractId\]\) return/)
  })
})
