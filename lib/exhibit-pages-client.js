// Prompt 107b: render the merged exhibits PDF's pages to images in the browser, so the Edit &
// Print window can show (and print) the real exhibit pages after the contract.
// BROWSER ONLY: never import this server-side (the job page loads it with a dynamic import).
// pdf.js is loaded at runtime from a pinned CDN build (no npm package); the legacy build so
// older iPhone Safari works.

import { withTimeout } from './exhibit-pages'

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs'
const WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs'

// Canvas limits (iOS Safari refuses canvases over ~16.7 M pixels; large plan sheets at scale 2
// would go blank), so the scale is lowered for a page that would be bigger than this.
const MAX_CANVAS_PIXELS = 10 * 1000 * 1000
const MAX_CANVAS_SIDE = 4096

let pdfjsPromise = null
// Prompt 107b leftover: set when the blob module worker reported an 'error' / 'messageerror'
// (e.g. it could not import the CDN worker). pdf.js 4.10.38 treats a workerPort as ready at once
// and never reports its load errors, so from then on the worker is loaded with workerSrc instead.
let workerFailed = false

function useWorkerSrc(pdfjs) {
  pdfjs.GlobalWorkerOptions.workerPort = null
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL
}

// Before each document: after a worker failure, drop the port and use workerSrc.
function pickWorker(pdfjs) {
  if (workerFailed && pdfjs.GlobalWorkerOptions.workerPort) useWorkerSrc(pdfjs)
}

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = withTimeout(import(/* webpackIgnore: true */ PDFJS_URL), 20000, 'the PDF viewer did not load').then(pdfjs => {
      if (workerFailed) { useWorkerSrc(pdfjs); return pdfjs }
      // A module worker started from a same-origin blob (not a cross-origin worker URL).
      try {
        const blob = new Blob([`import ${JSON.stringify(WORKER_URL)};`], { type: 'text/javascript' })
        const worker = new Worker(URL.createObjectURL(blob), { type: 'module' })
        const onWorkerError = () => {
          workerFailed = true
          try { worker.terminate() } catch {}
        }
        worker.addEventListener('error', onWorkerError)
        worker.addEventListener('messageerror', onWorkerError)
        pdfjs.GlobalWorkerOptions.workerPort = worker
      } catch {
        useWorkerSrc(pdfjs)
      }
      return pdfjs
    }).catch(e => {
      pdfjsPromise = null // a later try can load it again
      throw e
    })
  }
  return pdfjsPromise
}

/**
 * Every page of a PDF as a JPEG data URL, in order:
 *   [{ src: 'data:image/jpeg;base64,…', width, height }]  (width / height in canvas pixels)
 * Throws when pdf.js cannot load or a page cannot be rendered (the caller falls back to a link).
 */
export async function renderPdfPages(arrayBuffer, { scale = 2, quality = 0.85, timeoutMs = 45000 } = {}) {
  const pdfjs = await loadPdfjs()
  pickWorker(pdfjs)
  const data = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer)
  const task = pdfjs.getDocument({ data })
  let pdf
  try {
    pdf = await withTimeout(task.promise, timeoutMs, 'the PDF viewer did not respond')
  } catch (e) {
    // A stuck worker: drop this load and the cached pdf.js, so a later window starts over.
    try { task.destroy()?.catch?.(() => {}) } catch {}
    try { pdfjs.GlobalWorkerOptions.workerPort?.terminate?.() } catch {}
    pdfjsPromise = null
    throw e
  }
  const out = []
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const base = page.getViewport({ scale: 1 })
      let s = scale
      const area = base.width * base.height * s * s
      if (area > MAX_CANVAS_PIXELS) s = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height))
      s = Math.min(s, MAX_CANVAS_SIDE / base.width, MAX_CANVAS_SIDE / base.height)
      const viewport = page.getViewport({ scale: s })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas is not available')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      try {
        // Prompt 107c: the 'print' intent. This runs in the job page (the opener tab), which is
        // hidden behind the Edit & Print window; the default 'display' intent draws via
        // requestAnimationFrame, which browsers do not run in hidden tabs, so the render never
        // finished. 'print' draws without rAF, and its print-appearance annotations / form fields
        // are the right look for paper. Each page also gets its own limit, so one stuck page fails
        // fast (to the caller's fallback link) instead of waiting out the 60 s overall limit.
        await withTimeout(page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise, 20000, `page ${n} did not render`)
        out.push({ src: canvas.toDataURL('image/jpeg', quality), width: canvas.width, height: canvas.height })
      } finally {
        // Release the canvas memory right away (Safari keeps it otherwise).
        canvas.width = 0
        canvas.height = 0
        try { page.cleanup() } catch {}
      }
    }
  } finally {
    try { await pdf.destroy() } catch {}
  }
  return out
}
