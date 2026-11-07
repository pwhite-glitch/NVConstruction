// Tap-safe openers for the sub portal (/submit) and the customer portal (/portal/[token]).
// iOS Safari / the Capacitor WebView block window.open() once an await has passed, so
// each helper calls openFile/openHtml SYNCHRONOUSLY (the blank window is reserved in the
// caller's click turn) and does every auth/HTTP request inside the getter. Call these
// from a click handler BEFORE any await.
//
// Each returns a promise of { ok: true, ... } or { ok: false, error } — the reserved
// window has already been closed on failure; the caller shows `error`. A blocked popup
// falls back to current-tab navigation (handled by open-file.js).
import { openFile, openHtml } from './open-file'

const readJson = res => res.json().catch(() => ({}))

function run(opener, getter, fallbackError) {
  let failure = null
  let extra = {}
  // opener() runs window.open before its first await — keep this call first.
  const pending = opener(async () => {
    try {
      const out = await getter(info => { extra = { ...extra, ...info } })
      return out
    } catch (e) {
      failure = e
      return null
    }
  })
  return pending.then(result => (result
    ? { ok: true, ...extra }
    : { ok: false, error: failure?.message || fallbackError, ...extra }))
}

// Sub portal: a signed/uploaded subcontract file (signed URL via /api/sub-docs).
export function openSignedContract(fetchFn, filePath) {
  return run(openFile, async () => {
    if (!filePath) throw new Error('No signed contract on file.')
    const res = await fetchFn('/api/sub-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signed-url', file_path: filePath, download: true }),
    })
    const { url, error } = await readJson(res)
    if (!res.ok || error || !url) throw new Error('Could not retrieve document.' + (error ? ' ' + error : ''))
    return url
  }, 'Could not retrieve document.')
}

// Sub portal: a bid plan sheet (signed URL via /api/bid-plan).
export function openBidPlan(fetchFn, storagePath) {
  return run(openFile, async () => {
    const res = await fetchFn('/api/bid-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signed-url', path: storagePath }),
    })
    if (!res.ok) throw new Error('Could not load the plan. Please try again.')
    const { url } = await readJson(res)
    if (!url) throw new Error('Plan not available.')
    return url
  }, 'Could not load the plan. Please try again.')
}

async function initiateSigning(fetchFn, subcontractId, subUserId) {
  const res = await fetchFn('/api/sub-initiate-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subcontract_id: subcontractId, sub_user_id: subUserId }),
  })
  const { token, error } = await readJson(res)
  if (error) throw new Error('Error: ' + error)
  if (!res.ok) throw new Error('Could not start signing. Please try again.')
  if (!token || typeof token !== 'string') throw new Error('Signing session not found. Please try again.')
  return token
}

// Absolute in-app URL (the reserved blank window has no base of its own).
const appUrl = path => (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '') + path

// Sub portal: start (or resume) e-signing and open /sign?token=… in the reserved window.
export function startSigning(fetchFn, subcontractId, subUserId) {
  return run(openFile, async report => {
    const token = await initiateSigning(fetchFn, subcontractId, subUserId)
    report({ token })
    return appUrl(`/sign?token=${encodeURIComponent(token)}`)
  }, 'Could not start signing. Please try again.')
}

// Make fetched contract HTML print itself once it has loaded in the new window.
export function withPrintTrigger(html) {
  const trigger = '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},600)})</script>'
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, trigger + '</body>') : html + trigger
}

// Sub portal: printable contract. Initiates/reuses the signing request, fetches its
// stored HTML and writes it (with a print trigger) into the reserved window.
// onSigningRequest() runs after the signing request exists, so the caller can refresh its list.
export function printSubcontract(fetchFn, plainFetch, subcontractId, subUserId, onSigningRequest) {
  return run(openHtml, async report => {
    const token = await initiateSigning(fetchFn, subcontractId, subUserId)
    report({ token })
    if (onSigningRequest) { try { await onSigningRequest() } catch { /* list refresh is secondary */ } }
    const htmlRes = await plainFetch(`/api/signing-requests/${encodeURIComponent(token)}?html=1`)
    if (!htmlRes.ok) throw new Error('Could not load the contract. Please try again.')
    const { data } = await readJson(htmlRes)
    const html = data?.document_html
    if (!html || typeof html !== 'string') throw new Error('Contract document not available.')
    return withPrintTrigger(html)
  }, 'Could not load the contract. Please try again.')
}

// Customer portal: a shared document (signed URL via /api/customer-portal GET).
export function openCustomerDoc(fetchFn, token, docId) {
  return run(openFile, async () => {
    const res = await fetchFn(`/api/customer-portal?token=${encodeURIComponent(token)}&doc_id=${encodeURIComponent(docId)}`)
    if (!res.ok) throw new Error('Unable to download this file. Please contact your project team.')
    const { url } = await readJson(res)
    if (!url) throw new Error('This file is not available. Please contact your project team.')
    return url
  }, 'Download failed. Please try again.')
}
