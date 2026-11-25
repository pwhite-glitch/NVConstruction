// Prompt 107b: the exhibit pages shown inline in the Edit & Print window, after the contract.
// Pure string helper (no DOM), shared by the job page and the tests. The pages are images the
// job page rendered from the merged exhibits PDF (lib/exhibit-pages-client.js); each one starts
// a new printed page.

const PAGE_DIV_STYLE = 'page-break-before:always;break-before:page;page-break-inside:avoid;text-align:center'
const IMG_STYLE = 'display:block;margin:0 auto;max-width:100%;max-height:9.2in;width:auto;height:auto'

// Only inline JPEG / PNG images (what renderPdfPages produces); never a URL or another data: type.
const IMAGE_SRC_RE = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/

const escAttr = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const isExhibitPageSrc = src => typeof src === 'string' && IMAGE_SRC_RE.test(src)

/**
 * Inner HTML of <div class="nv-exhibit-pages">: one .nv-exhibit-page per page (in order), each
 * with a page break before it. pages: [{ src, width, height }]. A page whose src is not a
 * data:image/(jpeg|png);base64 URL is skipped. Page numbers in the alt text count the pages kept.
 */
export function exhibitPagesHtml(pages) {
  const ok = (Array.isArray(pages) ? pages : []).filter(p => p && isExhibitPageSrc(p.src))
  return ok.map((p, i) =>
    `<div class="nv-exhibit-page" style="${PAGE_DIV_STYLE}"><img src="${escAttr(p.src)}" alt="${escAttr(`Exhibit page ${i + 1}`)}" style="${IMG_STYLE}"></div>`,
  ).join('\n')
}

/**
 * Prompt 107b leftover: settle within ms. Resolves / rejects like `promise` when it settles in
 * time; otherwise rejects with new Error(message). The timer is cleared either way, so nothing
 * stays pending (pdf.js or a fetch that never answers can no longer block Print forever).
 */
export function withTimeout(promise, ms, message) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer))
}

// "A–C" for consecutive letters, else "A, B and D" (the window status line).
export function exhibitLetterRange(letters) {
  const l = (letters || []).filter(Boolean)
  if (l.length <= 1) return l[0] || ''
  const codes = l.map(x => x.charCodeAt(0))
  const consecutive = l.every(x => x.length === 1) && codes.every((c, i) => i === 0 || c === codes[i - 1] + 1)
  if (consecutive && l.length > 2) return `${l[0]}–${l[l.length - 1]}`
  return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`
}
