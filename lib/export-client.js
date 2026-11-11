// Browser side of manifest exports (prompt 78): small JSON manifest pages from our API, file
// bytes fetched straight from Storage with the signed links, ZIP built in the browser
// (lib/zip-client.js). Any failed page or file aborts the whole export: no partial "success".
// Signed links are never logged or stored.
import { readJsonResponse, jsonInit, rawResponseError, NETWORK_MESSAGE } from './fetch-json'
import { buildZipBlob } from './zip-client'
import { ITB_HTML_NAME, INVOICE_HTML_NAME, ownerReadme, ownerIndexText } from './export-manifest'

export class ExportError extends Error {}

const MAX_PAGES = 200

// Request every page of a manifest: body + { offset } until next_offset is null.
// fetchFn = authFetch (our API). Returns the array of page payloads.
export async function fetchManifestPages(fetchFn, url, body) {
  const pages = []
  let offset = 0
  for (let i = 0; i < MAX_PAGES; i++) {
    let res
    try { res = await fetchFn(url, jsonInit('POST', { ...body, offset })) } catch { throw new ExportError(NETWORK_MESSAGE) }
    const r = await readJsonResponse(res)
    if (!r.ok) throw new ExportError(r.error)
    const page = r.data || {}
    if (page.offset !== offset) throw new ExportError('The export list came back out of order. Try again.')
    pages.push(page)
    if (page.next_offset === null || page.next_offset === undefined) return pages
    if (!Number.isSafeInteger(page.next_offset) || page.next_offset <= offset) throw new ExportError('The export list could not be read. Try again.')
    offset = page.next_offset
  }
  throw new ExportError('The export is too large to list. Narrow the selection and try again.')
}

// Fetch every { name, url } with plain fetch (no portal Authorization on Storage links),
// at most `concurrency` at a time. Every HTTP status is checked; one failure aborts all.
// Returns [{ name, blob }] in the input order.
export async function fetchEntries(entries, { fetchFn = (...a) => fetch(...a), concurrency = 3, onProgress, signal } = {}) {
  const out = new Array(entries.length)
  let next = 0
  let done = 0
  let failed = null
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const onAbort = () => controller?.abort()
  signal?.addEventListener?.('abort', onAbort)
  async function worker() {
    while (!failed && next < entries.length) {
      const i = next++
      const e = entries[i]
      try {
        const res = await fetchFn(e.url, { signal: controller?.signal, cache: 'no-store' })
        const err = await rawResponseError(res, `Downloading ${e.name}`)
        if (err) {
          throw new ExportError(res.status === 400 || res.status === 403 ? `Downloading ${e.name} failed: the link expired or was refused. Start the export again.` : err)
        }
        out[i] = { name: e.name, blob: await res.blob() }
        done++
        onProgress?.({ done, total: entries.length })
      } catch (err) {
        if (!failed) failed = err instanceof ExportError ? err : new ExportError(`Downloading ${e.name} failed: ${err?.name === 'AbortError' ? 'cancelled' : NETWORK_MESSAGE}`)
        controller?.abort()
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, entries.length)) }, worker))
  } finally {
    signal?.removeEventListener?.('abort', onAbort)
  }
  if (failed) throw failed
  return out
}

// Start a browser download of a Blob; the object URL is revoked after the browser has it.
export function saveBlob(blob, filename, { doc = globalThis.document, urlApi = globalThis.URL, revokeAfterMs = 60_000 } = {}) {
  const href = urlApi.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  doc.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => urlApi.revokeObjectURL(href), revokeAfterMs)
}

// Text entries first (README / INDEX / local HTML), then the fetched files; build and save.
export async function buildAndSaveZip({ textEntries, fileEntries, filename, onProgress, save = saveBlob }) {
  const zip = await buildZipBlob([
    ...textEntries.map(t => ({ name: t.name, text: t.text })),
    ...fileEntries,
  ], { onProgress })
  save(zip, filename)
  return zip
}

// ITB package: README (server text) + ITB_Invitation_to_Bid.html (generated HERE, never sent to
// the API) + Documents/… fetched from signed links.
export async function exportItbZip({ fetchFn, storageFetch, bidPackageId, selectedPlanIds, projectName, itbHtml, onProgress, save, filename }) {
  const pages = await fetchManifestPages(fetchFn, '/api/itb-export', { bidPackageId, selectedPlanIds, ...(projectName ? { projectName } : {}) })
  const first = pages[0]
  const entries = pages.flatMap(p => p.entries || [])
  if (entries.length !== first.total) throw new ExportError('The export list was incomplete. Try again.')
  const files = await fetchEntries(entries, { fetchFn: storageFetch, onProgress })
  const textEntries = [{ name: 'README.txt', text: first.readme_text || '' }]
  if (itbHtml) textEntries.push({ name: ITB_HTML_NAME, text: itbHtml })
  const name = filename || first.zip_name
  const zip = await buildAndSaveZip({ textEntries, fileEntries: files, filename: name, save })
  return { zip, filename: name, count: files.length }
}

// Owner reimbursement: README + Invoice.html (generated HERE) + INDEX.txt from the authorized
// rows + Receipts/… fetched from signed links. NO RECEIPT only for lines with no receipt.
export async function exportOwnerReimbZip({ fetchFn, storageFetch, invoiceId, invoiceHtml, onProgress, save }) {
  const pages = await fetchManifestPages(fetchFn, '/api/owner-reimb-export', { invoiceId })
  const first = pages[0]
  const rows = pages.flatMap(p => p.rows || [])
  if (rows.length !== first.total) throw new ExportError('The export list was incomplete. Try again.')
  const withFile = rows.filter(r => r.receipt !== 'NO RECEIPT')
  if (withFile.some(r => typeof r.url !== 'string' || !r.url) || withFile.length !== first.receipt_count) {
    throw new ExportError('A receipt link was missing from the export list. Export aborted.')
  }
  const files = await fetchEntries(withFile.map(r => ({ name: r.receipt, url: r.url })), { fetchFn: storageFetch, onProgress })
  const textEntries = [
    { name: 'README.txt', text: ownerReadme({ invoiceNumber: first.invoice_number, receiptCount: withFile.length }) },
    { name: INVOICE_HTML_NAME, text: invoiceHtml || '' },
    { name: 'INDEX.txt', text: ownerIndexText(first.invoice_number, rows) },
  ]
  const zip = await buildAndSaveZip({ textEntries, fileEntries: files, filename: first.zip_name, save })
  return { zip, filename: first.zip_name, count: files.length, noReceipt: rows.length - withFile.length }
}
