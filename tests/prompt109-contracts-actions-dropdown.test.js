/**
 * Prompt 109 — Contracts tab: calmer subcontract cards + one "Actions" dropdown.
 * Layout/styling only: every action keeps its old condition and handler; only WHERE it renders changed
 * (one primary button, SOV, or inside the Actions menu). No DB, no API.
 */
const fs = require('fs')
const path = require('path')
const A = require('../lib/contract-card-actions')
const { isSignwellOpen, signwellStatusLabel } = require('../lib/signwell-status')
const { canUploadSignedContract, signedMethodLabel } = require('../lib/signed-upload')
const { isSubcontractSigned } = require('../lib/signing')

const root = path.join(__dirname, '..')
const page = fs.readFileSync(path.join(root, 'app/jobdetail/page.js'), 'utf8')
const menuSrc = fs.readFileSync(path.join(root, 'app/components/ActionsMenu.js'), 'utf8')

// ── The old one-row card's visibility rules (inventory A1–A13), mirrored independently ──
function oldVisibleActions(c, ctx) {
  const out = new Set(['sov', 'genContract', 'edit', 'delete'])
  if (c.status === 'draft') out.add('activate')
  if (ctx.canMoveToDraft) out.add('moveToDraft')
  if (c.generated_contract_path) out.add('lastGenerated')
  if (c.bid_proposal_url) out.add('bid')
  if (c.signed_contract_url) out.add('signedContract')
  if (ctx.canUpload && ctx.signwellEnabled && c.signwell_document_id && isSignwellOpen(c.signwell_status)) { out.add('remind'); out.add('void') }
  if (c.signed_contract_url && c.signed_method === 'esign') out.add('signedExhibits')
  if (ctx.canUpload) out.add('uploadSigned')
  return out
}
const oldTestMode = (c, ctx) => !!(ctx.canUpload && ctx.signwellEnabled && ctx.signwellTestMode && (c.signwell_document_id || !c.signed_contract_url))

const D = '2026-11-03T15:00:00Z'
const STATUSES = {
  draft: { c: { id: 'k1', status: 'draft', vendor_name: 'Acme' }, req: null, expect: { key: 'draft', label: 'Draft', primary: 'activate' } },
  activeNeverSent: { c: { id: 'k2', status: 'active', vendor_name: 'Acme' }, req: null, expect: { key: 'active', label: 'Active', primary: 'genContract' } },
  activePendingReq: { c: { id: 'k3', status: 'active' }, req: { subcontract_id: 'k3', status: 'pending', created_at: D, signer_email: 'sub@x.com' }, expect: { key: 'out', label: 'Out for signature', primary: 'genContract' } },
  signwellOpen: { c: { id: 'k4', status: 'active', signwell_document_id: 'doc', signwell_status: 'sent', signwell_sent_at: D }, req: null, expect: { key: 'out', label: 'Out for signature', primary: 'genContract' } },
  signwellDeclined: { c: { id: 'k5', status: 'active', signwell_document_id: 'doc', signwell_status: 'declined', signwell_sent_at: D }, req: null, expect: { key: 'signwell', label: 'SignWell: Declined', primary: 'genContract' } },
  signedEsign: { c: { id: 'k6', status: 'signed', signed_at: D, signed_contract_url: 'p/s.pdf', signed_method: 'esign' }, req: { subcontract_id: 'k6', status: 'signed', signed_at: D, created_at: D }, expect: { key: 'signed', label: 'Signed', primary: 'signedContract' } },
  signedSignwell: { c: { id: 'k7', status: 'signed', signed_at: D, signed_contract_url: 'p/s.pdf', signed_method: 'signwell', signwell_document_id: 'doc', signwell_status: 'completed' }, req: null, expect: { key: 'signed', label: 'Signed', primary: 'signedContract' } },
  signedManual: { c: { id: 'k8', status: 'signed', signed_contract_url: 'p/s.pdf', signed_method: 'manual_upload' }, req: null, expect: { key: 'signed', label: 'Signed', primary: 'signedContract' } },
  signedReqNoFile: { c: { id: 'k9', status: 'active' }, req: { subcontract_id: 'k9', status: 'signed', signed_at: D, created_at: D }, expect: { key: 'signed', label: 'Signed', primary: 'genContract' } },
}
const ROLES = ['principal', 'admin', 'pm', 'apm', 'super']
const EXTRAS = [{}, { generated_contract_path: 'g/x.html', generated_at: D }, { bid_proposal_url: 'b/x.pdf' }, { generated_contract_path: 'g/x.html', bid_proposal_url: 'b/x.pdf' }]
const SW = [{ enabled: false, test_mode: false }, { enabled: true, test_mode: false }, { enabled: true, test_mode: true }]

function buildCtx(c, req, role, sw, isEditing = false) {
  const isSigned = isSubcontractSigned(c, { hasSignedRequest: !!(req && req.status === 'signed') })
  const isDraft = c.status === 'draft'
  return {
    req, isSigned, isEditing, canUpload: canUploadSignedContract(role),
    signwellEnabled: sw.enabled, signwellTestMode: sw.test_mode, signwellOpen: isSignwellOpen(c.signwell_status),
    signwellBusy: false, uploading: false, canMoveToDraft: !isDraft && (c.status === 'active' || !c.status) && !isSigned,
  }
}
const allIds = r => [r.primary, 'sov', ...r.groups.flatMap(g => g.items)]

const CASES = []
for (const [name, st] of Object.entries(STATUSES)) for (const role of ROLES) for (const extra of EXTRAS) for (const sw of SW) for (const isEditing of [false, true]) {
  CASES.push({ name, role, extra, sw, isEditing, c: { ...st.c, ...extra }, req: st.req, expect: st.expect })
}

describe('contractCardActions — same actions as the old card, rendered once', () => {
  test('matrix size', () => expect(CASES.length).toBe(9 * 5 * 4 * 3 * 2))

  test.each(CASES.map(k => [`${k.name} / ${k.role} / ${JSON.stringify(k.extra)} / sw=${JSON.stringify(k.sw)} / edit=${k.isEditing}`, k]))('%s', (_, k) => {
    const ctx = buildCtx(k.c, k.req, k.role, k.sw, k.isEditing)
    const r = A.contractCardActions(k.c, ctx)
    const ids = allIds(r)
    // nothing lost, nothing new
    expect(new Set(ids)).toEqual(oldVisibleActions(k.c, ctx))
    // nothing twice
    expect(ids.length).toBe(new Set(ids).size)
    // one primary, per status (Cancel edit while editing)
    expect(typeof r.primary).toBe('string')
    expect(r.primary).toBe(k.isEditing ? 'edit' : k.expect.primary)
    expect(r.primaryTone).toBe(k.isEditing ? 'neutral' : 'brand')
    // danger last, void before delete
    const last = r.groups[r.groups.length - 1]
    expect(last.key).toBe('danger')
    expect(last.items[last.items.length - 1]).toBe('delete')
    if (last.items.includes('void')) expect(last.items).toEqual(['void', 'delete'])
    for (const g of r.groups.slice(0, -1)) expect(g.items).not.toEqual(expect.arrayContaining(['void']))
    // no empty groups, known order
    const order = ['document', 'signing', 'exhibits', 'danger']
    r.groups.forEach(g => expect(g.items.length).toBeGreaterThan(0))
    expect(r.groups.map(g => g.key)).toEqual(order.filter(o => r.groups.some(g => g.key === o)))
    // office-only items
    if (!ctx.canUpload) {
      for (const id of ['remind', 'void', 'uploadSigned']) expect(ids).not.toContain(id)
      expect(r.testMode).toBe(false)
    }
    expect(r.testMode).toBe(oldTestMode(k.c, ctx))
    // A4 label follows the request status
    expect(A.contractActionLabel('genContract', k.c, { req: k.req })).toBe(!k.req ? 'Gen Contract' : k.req.status === 'signed' ? 'View contract' : 'View / Resend contract')
  })

  test('busy / uploading keep their disabled states', () => {
    const c = STATUSES.signwellOpen.c
    const ctx = { ...buildCtx(c, null, 'pm', { enabled: true, test_mode: false }), signwellBusy: true, uploading: true }
    const r = A.contractCardActions(c, ctx)
    expect(r.disabled).toEqual({ remind: true, void: true, uploadSigned: true })
    expect(A.contractActionLabel('uploadSigned', c, { uploading: true })).toBe('Uploading…')
    expect(A.contractActionLabel('uploadSigned', { signed_contract_url: 'x' }, {})).toBe('Replace signed contract')
    expect(A.contractActionLabel('uploadSigned', {}, {})).toBe('Upload signed contract')
    expect(A.contractActionLabel('edit', c, { isEditing: true })).toBe('Cancel edit')
  })

  test('SignWell open for office: remind in signing, void in danger', () => {
    const c = STATUSES.signwellOpen.c
    const r = A.contractCardActions(c, buildCtx(c, null, 'admin', { enabled: true, test_mode: true }))
    expect(r.groups.find(g => g.key === 'signing').items).toEqual(['moveToDraft', 'remind', 'uploadSigned'])
    expect(r.groups.find(g => g.key === 'danger').items).toEqual(['void', 'delete'])
    expect(r.testMode).toBe(true)
  })

  test('draft: Activate is the primary and not repeated in the menu', () => {
    const c = STATUSES.draft.c
    const r = A.contractCardActions(c, buildCtx(c, null, 'principal', SW[0]))
    expect(r.primary).toBe('activate')
    expect(r.groups.find(g => g.key === 'document').items).toEqual(['genContract', 'edit'])
    expect(r.groups.find(g => g.key === 'signing').items).toEqual(['uploadSigned'])
  })

  test('labels carry no emoji / glyphs', () => {
    const ids = ['activate', 'moveToDraft', 'genContract', 'lastGenerated', 'bid', 'signedContract', 'remind', 'void', 'signedExhibits', 'uploadSigned', 'edit', 'delete']
    for (const id of ids) expect(A.contractActionLabel(id, {}, {})).not.toMatch(/[✓⏳↗📎✉]/u)
  })
})

describe('contractDisplayStatus — one pill per card', () => {
  const opts = (k, extra = {}) => {
    const { c, req } = STATUSES[k]
    return [c, {
      req, isSigned: isSubcontractSigned(c, { hasSignedRequest: !!(req && req.status === 'signed') }), subName: 'Acme',
      signwellOpen: isSignwellOpen(c.signwell_status), signwellLabel: signwellStatusLabel(c.signwell_status),
      signedLabel: c.signed_contract_url ? signedMethodLabel(c.signed_method) : null, ...extra,
    }]
  }
  test.each(Object.keys(STATUSES))('%s', k => {
    const st = A.contractDisplayStatus(...opts(k))
    expect(st.key).toBe(STATUSES[k].expect.key)
    expect(st.label).toBe(STATUSES[k].expect.label)
    expect(typeof st.label).toBe('string')
    expect(['amber', 'blue', 'red', 'green', 'neutral']).toContain(st.tone)
    expect(`${st.label} ${st.detail || ''}`).not.toMatch(/[✓⏳↗📎✉]/u)
  })
  test('details', () => {
    expect(A.contractDisplayStatus(...opts('draft')).detail).toBe('Not visible to Acme yet')
    expect(A.contractDisplayStatus(...opts('draft')).tone).toBe('amber')
    expect(A.contractDisplayStatus(...opts('activeNeverSent')).detail).toBeNull()
    expect(A.contractDisplayStatus({ id: 'x', status: 'active', generated_at: D }, { subName: 'Acme' }).detail).toBe('Contract generated Nov 3, 2026')
    expect(A.contractDisplayStatus(...opts('activePendingReq')).detail).toBe('Sent Nov 3, 2026 to sub@x.com')
    expect(A.contractDisplayStatus(...opts('signwellOpen')).detail).toBe('Sent Nov 3, 2026 · SignWell: Sent')
    const dec = A.contractDisplayStatus(...opts('signwellDeclined'))
    expect(dec.tone).toBe('red')
    expect(dec.detail).toBe('Sent Nov 3, 2026')
    expect(A.contractDisplayStatus(...opts('signedEsign')).detail).toBe('Signed (e-sign) · Nov 3, 2026')
    expect(A.contractDisplayStatus(...opts('signedSignwell')).detail).toBe('Signed (SignWell) · Nov 3, 2026')
    expect(A.contractDisplayStatus(...opts('signedManual')).detail).toBe('Signed (uploaded)')
    expect(A.contractDisplayStatus(...opts('signedEsign')).tone).toBe('green')
  })
})

// ── Source checks on the job page ──
const cardStart = page.indexOf('// Prompt 109: one status pill, one primary button, SOV, and an "Actions" menu')
const cardEnd = page.indexOf('{isDraft && !isEditing && (', cardStart)
const card = page.slice(cardStart, cardEnd)
function fnBody(src, decl) {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error('not found: ' + decl)
  let i = src.indexOf(') {', start) + 2, depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}

describe('job page — contracts card source', () => {
  test('card found', () => {
    expect(cardStart).toBeGreaterThan(0)
    expect(cardEnd).toBeGreaterThan(cardStart)
  })

  test('every action calls exactly the old function', () => {
    for (const call of [
      'activateContract(c)', 'moveContractToDraft(c)', 'openContractGenerator(c)', 'openLastGeneratedContract(c)',
      'openBidProposalUrl(c.bid_proposal_url)', 'openSignedContractUrl(c)', "signwellAction(c, 'remind')", "signwellAction(c, 'void')",
      "openSubcontractExhibits(c.id, 'signed')", 'uploadOfficeSignedContract(c, f)', 'deleteContract(c.id)',
    ]) expect(card).toContain(call)
    expect(card).toContain("setEditingContract(isEditing ? null : c.id); setEditContractForm({ contract_value: c.contract_value, description: c.description || '', onedrive_url: c.onedrive_url || '', budget_item_id: c.budget_item_id || '', budget_allocations: c.budget_allocations || [], retainage_pct: String(c.retainage_pct ?? 10), bid_proposal_url: c.bid_proposal_url || '' }); setEditContractBidFile(null)")
    expect(card).toContain('<ActionsMenu')
    expect(card).toContain('onSelect: runContractAction[aid]')
  })

  test('canUploadSignedContract(userRole) still gates remind / void / upload / TEST MODE', () => {
    expect(card).toContain('canUpload: canUploadSignedContract(userRole)')
    expect(card).toContain('signwellEnabled: signwellConfig.enabled, signwellTestMode: signwellConfig.test_mode')
    expect(card).toContain('{cardActions.testMode && (')
    expect(card).toMatch(/\{canUploadSignedContract\(userRole\) && \(\s*<input type="file" accept=\{SIGNED_UPLOAD_ACCEPT\}/)
  })

  test('hidden signed-upload input is outside the menu component, held by a ref and clicked from the menu', () => {
    const menuOpen = card.indexOf('<ActionsMenu')
    const menuClose = card.indexOf('/>', menuOpen)
    const input = card.indexOf('<input type="file" accept={SIGNED_UPLOAD_ACCEPT}')
    expect(input).toBeGreaterThan(menuClose)
    expect(card).toContain('signedUploadInputs.current[c.id] = el')
    expect(card).toContain('const el = signedUploadInputs.current[c.id]; if (el && !el.disabled) el.click()')
    expect(menuSrc).not.toContain('type="file"')
    expect(page).toContain('const signedUploadInputs = useRef({})')
  })

  test('no glyphs / dark button / colored secondaries on the card; one brand primary', () => {
    for (const bad of ['✓ Signed', '⏳', 'Signed Contract ↗', '📎', "background: '#1a2a1a'", "background: '#dcfce7', color: '#16a34a', border: '1px solid #dcfce7'", "background: '#bfdbfe'", 's.btnSmallOrange', 's.btnSmallRed']) {
      expect(card).not.toContain(bad)
    }
    expect(card).toContain("cardActions.primaryTone === 'brand' ? s.btnSmallPrimary : s.btnSmall")
    expect(page).toMatch(/btnSmallPrimary: \{ padding: '5px 12px', background: '#e8590c', color: '#fff'/)
    expect(card).toContain('style={s.contractPill(cardStatus.tone)}')
    expect((card.match(/s\.contractPill\(/g) || []).length).toBe(1)
    expect(card).not.toContain('s.contractBadge(c.status)')
  })

  test('Generate panel button reads "Send for e-Signature" without the envelope', () => {
    expect(page).toContain("{showSignPanel ? 'Cancel' : 'Send for e-Signature'}")
    expect(page).not.toContain("'✉ Send for e-Signature'")
  })

  test('confirm texts unchanged from 4b3daca', () => {
    expect(fnBody(page, 'async function activateContract(')).toContain("window.confirm(`Activate this subcontract?\\n\\n${name} will see it in their portal and be assigned to this job with billing off unless they already billed on this job.\\nNo email is sent. Turn on billing from the Companies tab when ready.`)")
    const mtd = fnBody(page, 'async function moveContractToDraft(')
    expect(mtd).toContain("`Move ${name}'s subcontract back to draft?`")
    expect(mtd).toContain("if (!window.confirm(lines.join('\\n'))) return")
    expect(mtd).toContain("`• A signature request sent to ${pendingSign.signer_email} is still open. That signing link is NOT cancelled.`")
    expect(fnBody(page, 'async function deleteContract(')).toContain("window.confirm('Delete this subcontract? (Not allowed once it is signed or has billings, POs or change orders.)')")
    expect(fnBody(page, 'async function signwellAction(')).toContain("action === 'void' && !window.confirm(`Void the SignWell request for ${c.vendor_name || 'this subcontract'}? The signer's SignWell link will stop working.`)")
    expect(fnBody(page, 'async function uploadOfficeSignedContract(')).toContain('c.signed_contract_url && !window.confirm(`A signed contract is already on file for ${c.vendor_name || \'this subcontract\'}. Replace it with "${file.name}"?`)')
  })

  test('prompt94 overflow rows still present on the card', () => {
    expect(card).toMatch(/flex: '1 1 260px', flexWrap: 'wrap', minWidth: 0, maxWidth: '100%'/)
    expect(card).toMatch(/gap: '6px', flexWrap: 'wrap', alignItems: 'center', minWidth: 0, maxWidth: '100%'/)
  })

  test('phone: actions row is its own row and the primary grows', () => {
    const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8')
    expect(css).toContain('.rx-card-actions { width: 100%; }')
    expect(css).toContain('.rx-card-actions > .rx-card-primary { flex: 1 1 auto; }')
  })

  test('109b phone: name block and figures row get classes that undo the column-flex gaps', () => {
    expect(card).toContain(`<div className="rx-card-main" style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 260px', flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>`)
    expect(card).toMatch(/gap: '10px 20px', flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0, maxWidth: '100%' \}\} className="rx-wrap-sm rx-card-figures"/)
    const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8')
    // find the (max-width: 640px) block that holds the rule and make sure it is inside it
    const blocks = []
    const re = /@media \(max-width: 640px\) \{/g
    let m
    while ((m = re.exec(css))) {
      let depth = 0, i = m.index + m[0].length - 1
      for (; i < css.length; i++) {
        if (css[i] === '{') depth++
        else if (css[i] === '}' && --depth === 0) break
      }
      blocks.push(css.slice(m.index, i + 1))
    }
    const phone = blocks.find(b => b.includes('.rx-card-actions { width: 100%; }'))
    expect(phone).toBeDefined()
    expect(phone).toContain('.rx-card-main { flex: 0 1 auto !important; }')
    expect(phone).toContain('.rx-card-figures { justify-content: flex-start !important; }')
  })
})

describe('ActionsMenu component source', () => {
  test('ARIA roles and attributes', () => {
    expect(menuSrc).toContain('role="menu"')
    expect(menuSrc).toContain('role="menuitem"')
    expect(menuSrc).toContain('aria-haspopup="menu"')
    expect(menuSrc).toMatch(/aria-expanded=\{open \? 'true' : 'false'\}/)
    expect(menuSrc).toMatch(/aria-disabled=\{item\.disabled/)
    expect(menuSrc).toMatch(/role="presentation" aria-hidden="true"/)
  })
  test('Escape, arrows, Home/End, Tab', () => {
    expect(menuSrc).toMatch(/e\.key === 'Escape'/)
    expect(menuSrc).toMatch(/e\.key === 'ArrowDown'/)
    expect(menuSrc).toMatch(/e\.key === 'ArrowUp'/)
    expect(menuSrc).toMatch(/e\.key === 'Home'/)
    expect(menuSrc).toMatch(/e\.key === 'End'/)
    expect(menuSrc).toMatch(/e\.key === 'Tab'/)
  })
  test('outside click listener added and removed', () => {
    expect(menuSrc).toContain("document.addEventListener('pointerdown', onPointerDown, true)")
    expect(menuSrc).toContain("document.removeEventListener('pointerdown', onPointerDown, true)")
    expect(menuSrc).toContain("document.addEventListener('mousedown', onPointerDown, true)")
    expect(menuSrc).toContain("document.removeEventListener('mousedown', onPointerDown, true)")
  })
  test('opens upward when there is no room below (window.innerHeight), portal + fixed, clamped', () => {
    expect(menuSrc).toContain('window.innerHeight')
    expect(menuSrc).toMatch(/const upward = r\.bottom \+ GAP \+ menuH > vh - EDGE/)
    expect(menuSrc).toContain('bottom: vh - r.top + GAP')
    expect(menuSrc).toContain('createPortal(')
    expect(menuSrc).toContain("position: 'fixed', zIndex: 50")
    expect(menuSrc).toContain("minWidth: '220px', maxWidth: 'calc(100vw - 24px)'")
    expect(menuSrc).toContain('if (left < EDGE) left = EDGE')
  })
  test('closes before running the action (same gesture)', () => {
    const choose = menuSrc.slice(menuSrc.indexOf('const choose = item'), menuSrc.indexOf('let n = -1'))
    expect(choose.indexOf('flushSync(() => onOpenChange(false))')).toBeGreaterThan(0)
    expect(choose.indexOf('item.onSelect()')).toBeGreaterThan(choose.indexOf('flushSync('))
  })
  test('no new packages', () => {
    const imports = menuSrc.match(/^import .* from '([^']+)'/gm) || []
    imports.forEach(l => expect(l).toMatch(/from 'react(-dom)?'/))
  })
})
