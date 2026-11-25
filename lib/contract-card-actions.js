// Prompt 109: subcontract card on the job page Contracts tab. Pure helpers (no React, no imports)
// that decide the ONE status pill and which actions show as the visible primary button vs inside
// the "Actions" menu. The visibility conditions are the same as the old one-row card (prompt 98/97/107);
// only where an action is rendered changed. Tested in tests/prompt109-contracts-actions-dropdown.test.js.

const defaultFmtDate = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// SignWell statuses that mean "finished", not a problem.
const SIGNWELL_DONE = new Set(['completed', 'manually_completed'])

// The old separate "SignWell: <status>" pill condition (B2).
export const showsSignwellStatus = c => !!(c && c.signwell_document_id && c.signwell_status && c.signed_method !== 'signwell')

// A4 label, unchanged: follows the newest signing request.
export function genContractLabel(req) {
  return !req ? 'Gen Contract' : req.status === 'signed' ? 'View contract' : 'View / Resend contract'
}

/**
 * One display status per card.
 * opts: { req, isSigned, signwellOpen, signwellLabel, signedLabel, subName, fmtDate }
 *   signwellOpen  = isSignwellOpen(c.signwell_status)
 *   signwellLabel = signwellStatusLabel(c.signwell_status)
 *   signedLabel   = c.signed_contract_url ? signedMethodLabel(c.signed_method) : null   (old B4 condition)
 * → { key: 'draft'|'active'|'out'|'signwell'|'signed', label, detail, tone: 'amber'|'blue'|'red'|'green'|'neutral', title }
 */
export function contractDisplayStatus(c, opts = {}) {
  const { req = null, isSigned = false, signwellOpen = false, signwellLabel = '', signedLabel = null, subName = 'the sub' } = opts
  const fmtDate = opts.fmtDate || defaultFmtDate
  const sw = showsSignwellStatus(c)
  const swText = sw ? `SignWell: ${signwellLabel}` : ''
  const join = parts => parts.filter(Boolean).join(' · ') || null

  if (c.status === 'draft') {
    return { key: 'draft', label: 'Draft', tone: 'amber', detail: join([`Not visible to ${subName} yet`, swText]),
      title: "Only NV staff can see this. Activate to show it in the sub's portal." }
  }
  if (isSigned) {
    const signedAt = c.signed_at || (req && req.status === 'signed' ? req.signed_at : null)
    const date = signedAt ? fmtDate(signedAt) : ''
    const main = signedLabel ? join([signedLabel, date]) : date ? `Signed ${date}` : null
    return { key: 'signed', label: 'Signed', tone: 'green', detail: join([main, swText]),
      title: c.signed_method === 'manual_upload' ? 'Signed copy uploaded by the office'
        : c.signed_method === 'signwell' ? 'Signed through SignWell (the PDF includes its audit page)'
        : c.signed_method === 'esign' ? 'Signed on the e-signature page' : 'Signed' }
  }
  const swSent = c.signwell_sent_at ? `Sent ${fmtDate(c.signwell_sent_at)}` : null
  if (sw && !signwellOpen && !SIGNWELL_DONE.has(c.signwell_status)) {
    return { key: 'signwell', label: swText, tone: 'red', detail: swSent,
      title: `SignWell${c.signwell_sent_at ? ' · sent ' + new Date(c.signwell_sent_at).toLocaleDateString('en-US') : ''}` }
  }
  const reqOpen = req && req.status !== 'signed'
  const swOpen = !!(c.signwell_document_id && signwellOpen)
  if (reqOpen || swOpen) {
    const sent = reqOpen ? `Sent ${fmtDate(req.created_at)}${req.signer_email ? ` to ${req.signer_email}` : ''}` : swSent
    return { key: 'out', label: 'Out for signature', tone: 'blue', detail: join([sent, swOpen || sw ? swText : '']),
      title: reqOpen ? req.signer_email : undefined }
  }
  const label = !c.status || c.status === 'active' ? 'Active' : String(c.status).replace(/^./, ch => ch.toUpperCase())
  return { key: 'active', label, tone: c.status && c.status !== 'active' ? 'neutral' : 'blue',
    detail: join([c.generated_at ? `Contract generated ${fmtDate(c.generated_at)}` : '', swText]) }
}

/**
 * Which actions show where.
 * ctx = { req, isSigned, isEditing, canUpload, signwellEnabled, signwellTestMode, signwellOpen, signwellBusy,
 *         uploading, canMoveToDraft }
 *   canUpload = canUploadSignedContract(userRole); signwellBusy = (signwellBusy === c.id); uploading = (uploadingSignedFor === c.id)
 * → { primary, primaryTone: 'brand'|'neutral', groups: [{ key, items: [ids] }], disabled: { id: true }, testMode }
 * 'sov' is always a separate visible button and is never in the menu.
 */
export function contractCardActions(c, ctx = {}) {
  const { req = null, isSigned = false, isEditing = false, canUpload = false, signwellEnabled = false, signwellTestMode = false,
    signwellOpen = false, signwellBusy = false, uploading = false, canMoveToDraft = false } = ctx
  const isDraft = c.status === 'draft'
  const signwellActions = !!(canUpload && signwellEnabled && c.signwell_document_id && signwellOpen)
  const visible = {
    activate: isDraft,
    moveToDraft: !!canMoveToDraft,
    genContract: true,
    lastGenerated: !!c.generated_contract_path,
    bid: !!c.bid_proposal_url,
    signedContract: !!c.signed_contract_url,
    remind: signwellActions,
    void: signwellActions,
    signedExhibits: !!(c.signed_contract_url && c.signed_method === 'esign'),
    uploadSigned: !!canUpload,
    edit: true,
    delete: true,
  }

  let primary
  if (isEditing) primary = 'edit'
  else if (isDraft) primary = 'activate'
  else if (isSigned && c.signed_contract_url) primary = 'signedContract'
  else primary = 'genContract'

  const pick = ids => ids.filter(id => visible[id] && id !== primary)
  const groups = [
    { key: 'document', items: pick(['genContract', 'lastGenerated', 'bid', 'signedContract', 'edit']) },
    { key: 'signing', items: pick(['activate', 'moveToDraft', 'remind', 'uploadSigned']) },
    { key: 'exhibits', items: pick(['signedExhibits']) },
    { key: 'danger', items: pick(['void', 'delete']) },
  ].filter(g => g.items.length > 0)

  const disabled = {}
  if (signwellBusy) { disabled.remind = true; disabled.void = true }
  if (uploading) disabled.uploadSigned = true

  return {
    primary,
    primaryTone: primary === 'edit' ? 'neutral' : 'brand',
    groups,
    disabled,
    // Old B3 condition, unchanged.
    testMode: !!(canUpload && signwellEnabled && signwellTestMode && (c.signwell_document_id || !c.signed_contract_url)),
  }
}

export const ACTION_GROUP_LABELS = { document: 'Document', signing: 'Signing', exhibits: 'Exhibits', danger: '' }
export const DANGER_ACTIONS = new Set(['void', 'delete'])

// Labels (no emoji / glyphs). ctx: { req, isEditing, uploading }
export function contractActionLabel(id, c, ctx = {}) {
  switch (id) {
    case 'activate': return 'Activate'
    case 'moveToDraft': return 'Move to draft'
    case 'genContract': return genContractLabel(ctx.req)
    case 'lastGenerated': return 'Last generated contract'
    case 'bid': return 'Bid proposal'
    case 'signedContract': return 'Signed contract'
    case 'remind': return 'Resend reminder'
    case 'void': return 'Void SignWell request'
    case 'signedExhibits': return 'Signed exhibits'
    case 'uploadSigned': return ctx.uploading ? 'Uploading…' : c.signed_contract_url ? 'Replace signed contract' : 'Upload signed contract'
    case 'edit': return ctx.isEditing ? 'Cancel edit' : 'Edit details'
    case 'delete': return 'Delete subcontract'
    default: return id
  }
}
