/**
 * Prompt 107: Edit & Print contract edits can be saved and sent for e-signature; the exhibits PDF
 * is prominent in the print window.
 * Peyton 11/24: "once i make the changes, why cant i send for esignature and also when edit and
 * print why does the exhibits not automatically populate there?"
 *  - lib/edited-contract.js: strip the editor chrome, sanitize, data-nv-edited marker, signature
 *    slot check, edited-vs-fresh choice.
 *  - The e-sign slots still work after the round trip (fillSubcontractSignatureLines, SignWell tags).
 *  - /api/signing-requests sanitizes the staged document.
 *  - Job page source checks (listener origin / source, toolbar buttons, send, exhibits banner).
 * DB/auth/storage are mocked; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({ Resend: class { constructor() { this.emails = { send: async () => (global.__resendSent = (global.__resendSent || 0) + 1, { error: null }) } } } }))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => ['subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator'].includes(r),
  }
})

const E = require('../lib/edited-contract')
const { buildSubcontractHtml } = require('../lib/buildSubcontractHtml')
const { exhibitAppendixHtml, withExhibitAppendix } = require('../lib/subcontract-exhibits')
const { fillSubcontractSignatureLines } = require('../lib/generated-contract')
const { withSignwellTextTags } = require('../lib/signwell-packet')
const signingRoute = require('../app/api/signing-requests/route')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')

const J1 = '11111111-1111-4111-8111-111111111111'
const SC1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const F = { sub_name: 'Acme', contract_amount: '100', job_number: '7555', subcontract_number: '2026-7555-001', pay_pct: '100' }
const SLOTS = ['cover-signature', 'sub-signature', 'sub-title', 'sub-date']
const emptySlot = m => new RegExp(`<(span|div)\\b[^>]*\\bdata-esign="${m}"[^>]*></\\1>`)

const GEN = buildSubcontractHtml(F, 'https://portal.example')
const APPENDIX = exhibitAppendixHtml({ proposal: { name: 'bid.pdf' }, billing: { name: 'billing.pdf' }, exhibitsPath: `subcontracts/${SC1}/exhibits-1.pdf` })

// What the print window's clone looks like when the opener-side cleanup was skipped: toolbar
// (with the exhibits banner nested inside), edit style, script, body margin-top, designMode
// leftovers, contenteditable, and the exhibit cover appendix.
function browserCopy(html = GEN) {
  const toolbar = [
    '<style id="nv-edit-style">#nv-bar{position:fixed}@media print{#nv-bar{display:none!important}}</style>',
    '<div id="nv-bar" contenteditable="false">',
    '<span style="font-weight:700">✎ Editing Mode</span>',
    '<div style="flex:1"></div>',
    '<span id="nv-exhibits-slot"></span><span id="nv-status">Saving…</span>',
    '<button id="nv-print-btn">Print / Save PDF</button><button id="nv-save-btn">Save edits</button><button id="nv-send-btn">Send for e-Signature</button>',
    '<div id="nv-exhibits-banner" style="flex-basis:100%"><span>Exhibits A and B are in a separate PDF — </span><button>Open exhibits PDF</button><div>Print or save this contract…</div></div>',
    '</div>',
    '<script>document.designMode="on";document.body.style.marginTop="50px";</script>',
  ].join('\n')
  return withExhibitAppendix(html, APPENDIX)
    .replace('<body>', '<body style="margin-top: 50px;">')
    .replace('<p>', '<p contenteditable="true">')
    .replace('</body>', toolbar + '\n</body>')
}

describe('stripEditorChrome', () => {
  test('removes toolbar, edit style, scripts, contenteditable, body margin-top and the exhibit appendix', () => {
    const raw = browserCopy()
    expect(raw).toContain('nv-bar')
    expect(raw).toContain('class="nv-exhibits"')
    const out = E.stripEditorChrome(raw)
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true)
    for (const s of ['nv-bar', 'nv-edit-style', 'nv-exhibits-banner', 'nv-save-btn', 'Open exhibits PDF', '<script', 'designMode', 'contenteditable', 'margin-top: 50px', 'class="nv-exhibits"', 'class="nv-exhibit"', 'Attached: bid.pdf']) expect(out).not.toContain(s)
    expect(out).toMatch(/<body>/)
    // the contract itself stays
    expect(out).toContain('<strong>SUBCONTRACTOR:</strong>')
    expect(out).toContain('2026-7555-001')
    expect(out).toContain('</body>')
    for (const m of SLOTS) expect(out).toMatch(emptySlot(m))
    // the generator output (minus the appendix) comes back unchanged, apart from blank lines left
    // where the toolbar / appendix were
    const norm = h => h.replace(/\s+<\/body>/, '\n</body>')
    expect(norm(out)).toBe(norm(GEN))
  })
  test('a doctype is added when missing; other body styles are kept', () => {
    const out = E.stripEditorChrome('<html><body style="color: red; margin-top: 50px;"><p>x</p></body></html>')
    expect(out).toBe('<!DOCTYPE html><html><body style="color: red;"><p>x</p></body></html>')
  })
  test('SignWell tags left in the slots by an earlier SignWell copy are removed (slots empty again)', () => {
    const tagged = withSignwellTextTags(GEN).html
    expect(tagged).toContain('data-signwell-tag')
    const out = E.stripEditorChrome(tagged)
    expect(out).not.toContain('data-signwell-tag')
    for (const m of SLOTS) expect(out).toMatch(emptySlot(m))
  })
})

describe('sanitizeContractHtml', () => {
  const S = E.sanitizeContractHtml
  test('removes scripts, frames, objects, embeds, base, forms, meta refresh, link import', () => {
    const bad = [
      '<script>alert(1)</script>', '<SCRIPT src="https://evil/x.js"></SCRIPT>', '<iframe src="https://evil"></iframe>',
      '<object data="x.swf"><param name="a"></object>', '<embed src="x.swf">', '<base href="https://evil/">',
      '<form action="https://evil"><input name="q"></form>', '<meta http-equiv="refresh" content="0;url=https://evil">',
      '<meta http-equiv=Refresh content="0">', '<link rel="import" href="x.html">',
    ]
    const out = S(`<html><head><meta charset="UTF-8"></head><body><p>keep</p>${bad.join('')}</body></html>`)
    for (const s of ['<script', '<SCRIPT', 'alert(1)', 'evil/x.js', '<iframe', '<object', '<embed', '<base', '<form', '</form>', 'http-equiv', 'rel="import"']) expect(out).not.toContain(s)
    expect(out).toContain('<meta charset="UTF-8">')
    expect(out).toContain('<p>keep</p>')
  })
  test('removes on* handlers (quoted, unquoted, mixed case)', () => {
    const out = S('<p onclick="x()" class="a">t</p><img src="https://p/logo.png" onError=alert(1)><body ONLOAD=\'go()\'><div/onmouseover=x>d</div>')
    expect(out).not.toMatch(/on(click|error|load|mouseover)/i)
    expect(out).toContain('<p class="a">t</p>')
    expect(out).toContain('<img src="https://p/logo.png">')
  })
  test('neutralises javascript: / vbscript: / data:text/html URLs', () => {
    const out = S('<a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(1)">b</a><a href="&#106;avascript:alert(1)">c</a><a href="java\tscript:x">d</a><a href="vbscript:x">e</a><img src="data:text/html;base64,PHNjcmlwdD4=">' +
      '<svg><a xlink:href="javascript:x">f</a></svg><button formaction="javascript:x">g</button><a href="https://ok.example/x">ok</a><img src="data:image/png;base64,iVBORw0=">')
    expect(out.toLowerCase()).not.toMatch(/javascript|vbscript|data:text\/html|&#106;/)
    expect(out).toContain('<a href="#">a</a>')
    expect(out).toContain('<a href="https://ok.example/x">ok</a>')
    expect(out).toContain('src="data:image/png;base64,iVBORw0="')
  })
  test('keeps the generator output byte for byte (style, logo, data-esign, data-nv-exhibits) and is idempotent', () => {
    const withAppendix = withExhibitAppendix(GEN, APPENDIX)
    expect(S(GEN)).toBe(GEN)
    expect(S(withAppendix)).toBe(withAppendix)
    expect(S(withAppendix)).toContain('data-nv-exhibits=')
    expect(GEN).toContain('<style>')
    expect(GEN).toContain('https://portal.example/logo.png')
    const nasty = '<scr<script>x</script>ipt>alert(1)</script><p onclick=a onclick=b>x</p><a href="javascript:1">y</a>'
    const once = S(nasty)
    expect(S(once)).toBe(once)
    expect(once).not.toMatch(/<script|onclick|javascript/i)
  })
})

describe('edited marker', () => {
  test('markEdited / editedAt round trip; a second mark replaces the first', () => {
    const a = E.markEdited(GEN, '2026-11-24T20:46:00.000Z')
    expect(a).toContain('<html lang="en" data-nv-edited="2026-11-24T20:46:00.000Z">')
    expect(E.editedAt(a)).toBe('2026-11-24T20:46:00.000Z')
    const b = E.markEdited(a, '2026-11-24T21:00:00.000Z')
    expect(b.match(/data-nv-edited/g)).toHaveLength(1)
    expect(E.editedAt(b)).toBe('2026-11-24T21:00:00.000Z')
    expect(E.editedAt(GEN)).toBeNull()
    expect(E.editedAt('<html data-nv-edited="junk"><body></body></html>')).toBeNull()
  })
  test('the marker survives sanitize and strip', () => {
    const a = E.markEdited(GEN, '2026-11-24T20:46:00.000Z')
    expect(E.editedAt(E.sanitizeContractHtml(E.stripEditorChrome(a)))).toBe('2026-11-24T20:46:00.000Z')
  })
})

describe('hasEmptySignatureSlot', () => {
  test('true on generator output; false when the slot has text or is gone', () => {
    expect(E.hasEmptySignatureSlot(GEN)).toBe(true)
    expect(E.hasEmptySignatureSlot(GEN.replace(/(data-esign="sub-signature"[^>]*>)(<\/span>)/, '$1Jane$2'))).toBe(false)
    expect(E.hasEmptySignatureSlot(GEN.replace(/<span[^>]*data-esign="sub-signature"[^>]*><\/span>/, ''))).toBe(false)
  })
})

describe('chooseContractForSend', () => {
  const fmt = iso => `T(${iso})`
  test('no edited version → regenerate, confirm not called', () => {
    const confirmFn = jest.fn(() => true)
    expect(E.chooseContractForSend({ editedHtml: null, editedAtIso: null, confirmFn, formatTime: fmt })).toEqual({ useEdited: false, html: null })
    expect(confirmFn).not.toHaveBeenCalled()
  })
  test('edited + OK → edited html; edited + Cancel → regenerate', () => {
    const ok = jest.fn(() => true)
    expect(E.chooseContractForSend({ editedHtml: '<p>e</p>', editedAtIso: '2026-11-24T20:46:00.000Z', confirmFn: ok, formatTime: fmt })).toEqual({ useEdited: true, html: '<p>e</p>' })
    expect(ok.mock.calls[0][0]).toBe('Send your edited version from T(2026-11-24T20:46:00.000Z)?\n\nOK = send the edited version\nCancel = send a fresh contract from the form fields')
    expect(E.chooseContractForSend({ editedHtml: '<p>e</p>', editedAtIso: '2026-11-24T20:46:00.000Z', confirmFn: () => false, formatTime: fmt })).toEqual({ useEdited: false, html: null })
  })
  test('"changed after these edits" note only when the details were saved later', () => {
    const msgs = []
    const confirmFn = m => { msgs.push(m); return true }
    const base = { editedHtml: 'x', editedAtIso: '2026-11-24T20:46:00.000Z', confirmFn, formatTime: fmt }
    E.chooseContractForSend({ ...base, generatorSavedAtIso: '2026-11-24T20:50:00.000Z' })
    E.chooseContractForSend({ ...base, generatorSavedAtIso: '2026-11-24T20:40:00.000Z' })
    E.chooseContractForSend({ ...base, generatorSavedAtIso: null })
    expect(msgs[0]).toContain('Note: the contract details were changed after these edits.')
    expect(msgs[1]).not.toContain('Note:')
    expect(msgs[2]).not.toContain('Note:')
  })
  test('Central time format', () => {
    expect(E.formatCentralDateTime('2026-11-24T20:46:00.000Z')).toBe('Nov 24, 2:46 PM CT')
    expect(E.formatCentralTime('2026-11-24T20:46:00.000Z')).toBe('2:46 PM')
  })
})

describe('e-sign slots still work after the round trip', () => {
  const prepared = E.prepareEditedContract(browserCopy(GEN.replace('2026-7555-001', '2026-7555-001 (rev)')), '2026-11-24T20:46:00.000Z')
  test('prepareEditedContract keeps the edit and the empty slots', () => {
    expect(prepared).toContain('2026-7555-001 (rev)')
    expect(E.editedAt(prepared)).toBe('2026-11-24T20:46:00.000Z')
    expect(E.hasEmptySignatureSlot(prepared)).toBe(true)
    expect(prepared).not.toContain('nv-bar')
  })
  test('fillSubcontractSignatureLines signs it', () => {
    const signed = fillSubcontractSignatureLines(prepared, { signature_text: 'Jane Doe', signer_title: 'Owner', signed_at: '2026-11-24T21:00:00Z', company_name: 'Acme' })
    expect(signed).toMatch(/data-esign="sub-signature"[^>]*><span style="font-family:'Brush Script MT'[^"]*">Jane Doe<\/span>/)
    expect(signed).toMatch(/data-esign="sub-title"[^>]*>Owner</)
    expect(signed).toContain('on behalf of Acme')
  })
  test('SignWell text tags go into the slots', () => {
    const t = withSignwellTextTags(prepared)
    expect(t.tagged).toBe(true)
    expect(t.slots).toEqual(SLOTS)
  })
})

describe('/api/signing-requests sanitizes the staged document', () => {
  beforeEach(() => {
    delete process.env.SIGNWELL_API_KEY
    global.__resendSent = 0
    resetMockState({
      jobs: [{ id: J1, pm_email: 'pm@nv.com', job_number: '7555' }],
      pm_job_assignments: [],
      subcontracts: [{ id: SC1, job_id: J1, vendor_name: 'JCT Electrical', status: 'active', contract_value: 12500, signed_at: null, signed_contract_url: null, signwell_document_id: null, signwell_status: null }],
      signing_requests: [], job_documents: [], change_log: [],
    })
    mockState.auth = { userId: 'u-principal', email: 'principal@nv.com', role: 'principal', error: null }
  })
  test('script and onclick are not stored; the contract and slots are', async () => {
    const edited = E.markEdited(GEN, '2026-11-24T20:46:00.000Z').replace('</body>', '<script>steal()</script><p onclick="steal()">extra</p></body>')
    const r = await signingRoute.POST(new Request('http://x/api/signing-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: J1, subcontract_id: SC1, signer_email: 'jane@jct.com', signer_name: 'Jane Doe', document_html: edited, document_title: 'Subcontract' }),
    }))
    expect(r.status).toBe(200)
    const stored = mockState.db.signing_requests[0].document_html
    expect(stored).not.toMatch(/<script|steal\(\)|onclick/)
    expect(stored).toContain('<p>extra</p>')
    expect(stored).toContain('data-nv-edited="2026-11-24T20:46:00.000Z"')
    for (const m of SLOTS) expect(stored).toMatch(emptySlot(m))
  })
  test('route source: sanitize right after the staged document is read', () => {
    const src = read('app/api/signing-requests/route.js')
    expect(src).toMatch(/document_html = sanitizeContractHtml\(document_html\)/)
    expect(src.indexOf('sanitizeContractHtml(document_html)')).toBeGreaterThan(src.indexOf('document_html = new TextDecoder()'))
    expect(src.indexOf('sanitizeContractHtml(document_html)')).toBeLessThan(src.indexOf('buildAndStoreExhibits(adminSupabase'))
  })
})

describe('job page (source checks)', () => {
  const page = read('app/jobdetail/page.js')
  test('message listener checks origin and source, type, contract id, size', () => {
    expect(page).toContain("window.addEventListener('message', onMessage)")
    expect(page).toContain("window.removeEventListener('message', onMessage)")
    expect(page).toContain('event.origin === window.location.origin')
    expect(page).toContain('event.source === printWinRef.current.win')
    expect(page).toContain("data.type === 'nv-contract-edits'")
    expect(page).toContain('data.contract_id === printWinRef.current.contract_id')
    expect(page).toMatch(/typeof data\.html !== 'string' \|\| data\.html\.length >= MAX_EDITED_CONTRACT_LENGTH/)
    expect(E.MAX_EDITED_CONTRACT_LENGTH).toBe(3 * 1024 * 1024)
  })
  test('print window has Save edits / Send for e-Signature posting to the opener origin', () => {
    expect(page).toContain('id="nv-save-btn"')
    expect(page).toContain('id="nv-send-btn"')
    expect(page).toContain('var NV_ORIGIN=${jsStr(window.location.origin)};')
    expect(page).toContain('window.opener.postMessage({type:"nv-contract-edits",action:action,contract_id:NV_CONTRACT_ID,html:html},NV_ORIGIN)')
    expect(page).toContain('The portal tab was closed; reopen Edit & Print.')
    expect(page).toMatch(/prepareEditedContract\(data\.html, iso\)/)
    expect(page).toMatch(/saveContractCopy\(contractId, appendix \? withExhibitAppendix\(edited, appendix\) : edited\)/)
    expect(page).toContain('The signature line was edited or removed; SignWell will add its own signature page.')
  })
  test('sendForESign uses chooseContractForSend and still sends the exhibits', () => {
    const fn = page.slice(page.indexOf('async function sendForESign()'), page.indexOf('// ── Change Orders'))
    expect(fn).toContain('chooseContractForSend(')
    expect(fn).toContain('sanitizeContractHtml(stripEditorChrome(chosen.html))')
    expect(fn).toContain('exhibits: check.include')
    expect(fn).toContain("' (edited version)'")
    expect(fn.indexOf('exhibitCheck(')).toBeLessThan(fn.indexOf('chooseContractForSend('))
    expect(page).toMatch(/fetchStoredContractHtml\(contractId, 'generated', \{ quiet: true \}\)/)
  })
  test('exhibits banner in the print window', () => {
    expect(page).toContain('in a separate PDF — ')
    expect(page).toContain("'Open exhibits PDF'")
    expect(page).toContain('(pop-up blocked — click Open exhibits PDF)')
    expect(page).toContain('Print or save this contract, then print the exhibits PDF. Send for e-Signature attaches the exhibits automatically.')
    expect(page).toContain('lastExhibitsAppendixRef.current[contractId] = ex.data.appendix')
    expect(page).toContain('@media print{#nv-bar,#nv-exhibits-banner{display:none!important}')
  })
})
