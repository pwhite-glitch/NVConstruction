// What we upload to SignWell for a subcontract (prompt 98). Pure; no secrets.
//
// The contract is HTML (no HTML→PDF engine in the app) and SignWell accepts .html files, so
// the document gets two files: the contract HTML (exactly what the built-in flow would send,
// incl. the Exhibit A/B cover pages) and the merged exhibits PDF from prompt 97 when present.
//
// Fields are placed with SignWell text tags written into the contract's existing e-sign
// slots (data-esign="cover-signature" / "sub-signature" / "sub-title" / "sub-date"), in white
// 6pt text so they don't show. Signer 1 is the subcontractor (the built-in flow has no NV
// countersignature, so there is no signer 2). If the HTML has no sub-signature slot, text
// tags are off and SignWell appends its own signature page instead.

export const SIGNWELL_TAGS = {
  // {{type:signer:required:label:prefill:api_id:width:height}}
  'cover-signature': '{{s:1:y:::cover_signature:260:24}}',
  'sub-signature': '{{s:1:y:::sub_signature:185:28}}',
  'sub-title': '{{t:1:y:Title::sub_title:105:16}}',
  'sub-date': '{{af_d_s:1:y:::sub_date:78:16}}',
}

const tagSpan = tag => `<span data-signwell-tag="1" style="color:#ffffff;font-size:6pt;line-height:1">${tag}</span>`

// Fill each EMPTY data-esign slot with its text tag. Returns { html, tagged, slots }.
export function withSignwellTextTags(html) {
  let out = String(html ?? '')
  const slots = []
  for (const [marker, tag] of Object.entries(SIGNWELL_TAGS)) {
    const re = new RegExp(`(<(span|div)\\b[^>]*\\bdata-esign="${marker}"[^>]*>)(</\\2>)`)
    if (re.test(out)) {
      out = out.replace(re, (_, open, _t, close) => `${open}${tagSpan(tag)}${close}`)
      slots.push(marker)
    }
  }
  return { html: out, tagged: slots.includes('sub-signature'), slots }
}

const safeName = s => String(s || '').replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * Files + settings for createDocument.
 *   html: the contract HTML (with the exhibits appendix already in it)
 *   exhibitsBytes: merged exhibits PDF bytes, or null
 *   exhibitLetters: letters of the included exhibits (prompt 103), e.g. ['A','B','C','D'] →
 *                   "Exhibits A-D"; without it the name stays "Exhibits A-B".
 */
export function exhibitsFileLabel(exhibitLetters) {
  const l = (Array.isArray(exhibitLetters) ? exhibitLetters : []).map(x => String(x || '').trim()).filter(x => /^[A-Z]$/.test(x))
  if (!l.length) return 'Exhibits A-B'
  return l.length === 1 ? `Exhibit ${l[0]}` : `Exhibits ${l[0]}-${l[l.length - 1]}`
}

export function buildSignwellPacket({ html, exhibitsBytes = null, vendorName = '', exhibitLetters = null } = {}) {
  const t = withSignwellTextTags(html)
  const base = safeName(vendorName) || 'Subcontract'
  const files = [{ name: `Subcontract - ${base}.html`, bytes: Buffer.from(t.html, 'utf8') }]
  if (exhibitsBytes && exhibitsBytes.length) files.push({ name: `${exhibitsFileLabel(exhibitLetters)} - ${base}.pdf`, bytes: exhibitsBytes })
  return { files, textTags: t.tagged, html: t.html, slots: t.slots }
}
