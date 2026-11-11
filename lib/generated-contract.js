// Stored copies of subcontract documents, kept in the 'documents' storage bucket.
//   subcontracts/<id>/generated-<time>.html  every contract generated for print or e-signature
//   contracts/<id>/esigned-<time>.html       the e-signed contract with its signature record
// The e-signed copy lives under contracts/<id>/ because that is where signed_contract_url
// files go (the sub portal upload checks that prefix).

export const CONTRACT_BUCKET = 'documents'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

const stamp = (at) => new Date(at).toISOString().replace(/[:.]/g, '-')

export function generatedContractPath(subcontractId, at = new Date()) {
  if (!isUuid(subcontractId)) throw new Error('invalid subcontract id')
  return `subcontracts/${subcontractId}/generated-${stamp(at)}.html`
}

export function esignedContractPath(subcontractId, at = new Date()) {
  if (!isUuid(subcontractId)) throw new Error('invalid subcontract id')
  return `contracts/${subcontractId}/esigned-${stamp(at)}.html`
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Signature record appended to the e-signed copy
export function signatureCertificateHtml({ signature_text, signer_name, signer_title, company_name, signer_email, signed_at, signer_ip, request_id }) {
  const clean = v => (typeof v === 'string' ? v.trim() : v)
  const row = (label, value) => clean(value) ? `<tr><td style="padding:4px 12px 4px 0;color:#555;white-space:nowrap">${label}</td><td style="padding:4px 0">${escapeHtml(clean(value))}</td></tr>` : ''
  const when = signed_at ? new Date(signed_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Chicago' }) + ' CT' : ''
  return `<div style="page-break-before:always;font-family:Arial,sans-serif;font-size:12pt;padding:40px;max-width:700px">
<h2 style="margin:0 0 16px">Electronic Signature Record</h2>
<p style="font-family:'Brush Script MT',cursive;font-size:28pt;margin:0 0 16px">${escapeHtml(signature_text)}</p>
<table style="border-collapse:collapse;font-size:11pt">
${row('Signed by', signer_name)}${row('Title', signer_title)}${row('On behalf of', company_name)}${row('Email', signer_email)}${row('Signed at', when)}${row('IP address', signer_ip)}${row('Request ID', request_id)}
</table>
</div>`
}

// Short signing date for the contract's Date line (fits the 80px line), Chicago time.
export function shortSignedDate(at) {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', year: 'numeric' })
}

// Fill one empty element: `<tag ...></tag>` -> `<tag ...>content</tag>`.
// Prefers the data-esign marker anywhere; otherwise the first empty match of
// `fallback` inside html[from, to). Returns html unchanged when nothing matches.
function fillSlot(html, marker, fallback, from, to, content) {
  const marked = new RegExp(`(<(span|div)\\b[^>]*\\bdata-esign="${marker}"[^>]*>)(</\\2>)`)
  if (marked.test(html)) return { html: html.replace(marked, (_, open, _t, close) => `${open}${content}${close}`), at: html.search(marked) }
  if (from < 0) return { html, at: -1 }
  const end = to > from ? to : html.length
  const re = new RegExp(fallback.source, 'g')
  re.lastIndex = from
  const m = re.exec(html)
  if (!m || m.index >= end) return { html, at: -1 }
  const openEnd = m.index + m[0].lastIndexOf('</')
  return { html: html.slice(0, openEnd) + content + html.slice(openEnd), at: m.index }
}

const SIG_FONT = "font-family:'Brush Script MT',cursive;font-size:14pt"

/**
 * Write the subcontractor's e-signature onto the contract: the cover-letter
 * "Subcontractor Signature" box and the SUBCONTRACTOR column's Signature /
 * Title / Date lines (plus "on behalf of <company>"). The NV Construction LLC
 * column, Federal I.D. / phone / e-mail lines, initials and the competent-person
 * form are never filled. Works on HTML with data-esign markers (lib builder) and
 * on unmarked HTML of the same structure (job page builder, already-sent copies):
 * sub Title / Date are the width:110px / width:80px lines, and the sub Signature
 * is the first width:190px line after <strong>SUBCONTRACTOR:</strong>.
 */
export function fillSubcontractSignatureLines(html, { signature_text, signer_title, signed_at, company_name } = {}) {
  let out = String(html ?? '')
  const name = String(signature_text ?? '').trim()
  if (!name) return out
  const title = String(signer_title ?? '').trim()
  const company = String(company_name ?? '').trim()
  const date = signed_at ? shortSignedDate(signed_at) : ''
  const eName = escapeHtml(name)
  const eTitle = escapeHtml(title)
  const eCompany = escapeHtml(company)

  // Cover letter: the empty height:24px box right above "Subcontractor Signature".
  const cover = /(<div\b[^>]*height:24px[^>]*>)(<\/div>)(\s*<div style="font-size:9pt">Subcontractor Signature<\/div>)/
  const coverDetail = [eName + (eTitle ? `, ${eTitle}` : ''), eCompany ? `on behalf of ${eCompany}` : ''].filter(Boolean).join(' &mdash; ')
  out = out.replace(cover, (_, open, close, label) =>
    `${open}<span style="${SIG_FONT}">${eName}</span>${close}${label}<div data-esign-filled="cover-detail" style="font-size:9pt">${coverDetail}</div>`)

  // SUBCONTRACTOR column, bounded so nothing past its Title / Date row is touched.
  const head = out.indexOf('<strong>SUBCONTRACTOR:</strong>')
  const bound = () => {
    if (head < 0) return -1
    const fed = out.indexOf('Federal I.D.', head)
    return fed > head ? fed : out.indexOf('</div>', head)
  }
  const sig = fillSlot(out, 'sub-signature', /<span\b[^>]*width:190px[^>]*><\/span>/, head, bound(), `<span style="${SIG_FONT}">${eName}</span>`)
  out = sig.html
  if (eCompany && sig.at >= 0) {
    // "on behalf of" under the signature line, after the officer's-signature note when present.
    const behalf = `<p data-esign-filled="sub-on-behalf" style="font-size:9pt;text-align:center">on behalf of ${eCompany}</p>`
    const note = "(Company officer's signature)</p>"
    const noteAt = out.indexOf(note, sig.at)
    const lim = bound()
    if (noteAt >= 0 && (lim < 0 || noteAt < lim)) {
      const at = noteAt + note.length
      out = out.slice(0, at) + behalf + out.slice(at)
    } else {
      const pEnd = out.indexOf('</p>', sig.at)
      if (pEnd >= 0) out = out.slice(0, pEnd + 4) + behalf + out.slice(pEnd + 4)
    }
  }
  if (eTitle) out = fillSlot(out, 'sub-title', /<span\b[^>]*width:110px[^>]*><\/span>/, head, bound(), eTitle).html
  if (date) out = fillSlot(out, 'sub-date', /<span\b[^>]*width:80px[^>]*><\/span>/, head, bound(), escapeHtml(date)).html
  return out
}

export function withSignatureCertificate(html, cert) {
  const block = signatureCertificateHtml(cert)
  const i = String(html).lastIndexOf('</body>')
  return i === -1 ? `${html}\n${block}` : `${html.slice(0, i)}${block}\n${html.slice(i)}`
}

async function upload(admin, path, html) {
  const { error } = await admin.storage.from(CONTRACT_BUCKET)
    .upload(path, Buffer.from(String(html), 'utf8'), { contentType: 'text/html; charset=utf-8', upsert: false })
  if (error) throw new Error(`upload failed: ${error.message}`)
}

/**
 * Store a generated contract and record it on the subcontract.
 * The file is kept even if recording fails (e.g. migration 031 not applied yet);
 * `recorded` says whether the subcontract row was updated.
 */
export async function saveGeneratedContract(admin, { subcontractId, html, userId, at = new Date() }) {
  if (!html) throw new Error('html required')
  const path = generatedContractPath(subcontractId, at)
  await upload(admin, path, html)
  return recordGeneratedContract(admin, { subcontractId, path, userId, at })
}

/**
 * Record an already-stored generated contract (server upload above, or a browser direct upload
 * verified by /api/subcontract-contract) on the subcontract. Same recorded:false fallback.
 */
export async function recordGeneratedContract(admin, { subcontractId, path, userId, at = new Date() }) {
  const generated_at = new Date(at).toISOString()
  const { error } = await admin.from('subcontracts')
    .update({ generated_contract_path: path, generated_at, generated_by: userId || null })
    .eq('id', subcontractId)
  if (error) console.error('saveGeneratedContract: could not record on subcontract:', error.message)
  return { path, generated_at, recorded: !error }
}

/**
 * Store the e-signed contract (document + signature record) and set it as the
 * subcontract's signed_contract_url, unless a signed contract is already on file.
 * Either way the subcontract is then stamped signed (stampSubcontractSigned); an
 * existing PDF is never replaced.
 */
export async function saveSignedContract(admin, { subcontractId, html, certificate, at = new Date() }) {
  const path = esignedContractPath(subcontractId, at)
  await upload(admin, path, withSignatureCertificate(html || '', certificate))
  const { data, error } = await admin.from('subcontracts')
    .update({ signed_contract_url: path })
    .eq('id', subcontractId)
    .is('signed_contract_url', null)
    .select('id')
  if (error) throw new Error(`could not set signed_contract_url: ${error.message}`)
  const stamped = await stampSubcontractSigned(admin, subcontractId, at)
  if (stamped.error) console.error('saveSignedContract: could not record signed_at / status:', stamped.error)
  return { path, linked: (data || []).length > 0 }
}

/**
 * Record that a subcontract was signed: sets signed_at (only if not already set,
 * so the first signature time is kept) and status 'signed' (only from active or
 * blank, so a draft or complete contract keeps its status).
 */
export async function stampSubcontractSigned(admin, subcontractId, at = new Date()) {
  const signed_at = new Date(at).toISOString()
  const a = await admin.from('subcontracts').update({ signed_at }).eq('id', subcontractId).is('signed_at', null)
  const b = await admin.from('subcontracts').update({ status: 'signed' }).eq('id', subcontractId).or('status.is.null,status.eq.active')
  const err = a.error || b.error
  return { error: err ? err.message : null }
}

// Path of the newest generated copy in storage, for when the subcontract row has none recorded
export async function latestGeneratedContractPath(admin, subcontractId) {
  if (!isUuid(subcontractId)) return null
  const folder = `subcontracts/${subcontractId}`
  const { data } = await admin.storage.from(CONTRACT_BUCKET)
    .list(folder, { limit: 1, sortBy: { column: 'name', order: 'desc' }, search: 'generated-' })
  return data?.[0]?.name ? `${folder}/${data[0].name}` : null
}
