// Prompt 107: contract edits made in the Edit & Print window (designMode) are sent back to the
// job page, cleaned here, saved as the generated copy and can be sent for e-signature.
// Pure string / regex helpers; no DOM needed.
//
//   stripEditorChrome      toolbar, edit style, scripts, contenteditable, body margin-top, and the
//                          exhibit appendix (the page or the server adds a fresh one) and the
//                          inline exhibit page images (.nv-exhibit-pages, prompt 107b)
//   sanitizeContractHtml   scripts / frames / forms / on* handlers / javascript: URLs removed
//   markEdited / editedAt  data-nv-edited="<iso>" on the <html> tag
//   hasEmptySignatureSlot  the empty data-esign="sub-signature" slot is still there
//   prepareEditedContract  all of the above for a message from the print window
//   chooseContractForSend  edited version or a fresh contract (asks the user)

export const MAX_EDITED_CONTRACT_LENGTH = 3 * 1024 * 1024

// A start tag; quoted attribute values may contain '>'.
const TAG_RE = /<[a-zA-Z](?:"[^"]*"|'[^']*'|[^'">])*>/g
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

// Calls fn(name (lowercase), value) for each attribute of one start tag. fn returns undefined
// (keep), null (remove the attribute) or a string (new value, written in double quotes).
// The tag is returned unchanged when nothing changed.
function editAttrs(tag, fn) {
  const head = /^<[a-zA-Z][^\s\/>]*/.exec(tag)
  if (!head) return tag
  const end = tag.length - 1 // the closing '>'
  let out = head[0]
  let last = head[0].length
  let changed = false
  ATTR_RE.lastIndex = last
  let a
  while ((a = ATTR_RE.exec(tag)) && a.index < end) {
    const gap = tag.slice(last, a.index)
    const value = a[2] ?? a[3] ?? a[4] ?? null
    const r = fn(a[1].toLowerCase(), value)
    if (r === null) changed = true
    else if (typeof r === 'string' && r !== value) {
      out += `${gap}${a[1]}="${r.replace(/"/g, '&quot;')}"`
      changed = true
    } else out += gap + a[0]
    last = a.index + a[0].length
  }
  if (!changed) return tag
  return out + tag.slice(last)
}

// Remove every element whose start tag matches openRe, with its content (nested same-name tags
// are counted, so an outer <div> with child <div>s goes whole). An unclosed one runs to the end.
function removeElements(html, openRe, tagName) {
  let out = String(html ?? '')
  const re = new RegExp(openRe.source, openRe.flags.replace('g', ''))
  for (let guard = 0; guard < 500; guard++) {
    const m = re.exec(out)
    if (!m) break
    const tokens = new RegExp(`<(/?)${tagName}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'gi')
    tokens.lastIndex = m.index + m[0].length
    let depth = 1
    let stop = out.length
    let t
    while ((t = tokens.exec(out))) {
      depth += t[1] ? -1 : 1
      if (depth === 0) { stop = t.index + t[0].length; break }
    }
    out = out.slice(0, m.index) + out.slice(stop)
  }
  return out
}

// Only the start of the opening tag is matched; removeElements counts <div>s from there.
const NV_BAR_OPEN = /<div\b[^>]*?\bid\s*=\s*["']?nv-bar(?=["'\s>])/i
const NV_BANNER_OPEN = /<div\b[^>]*?\bid\s*=\s*["']?nv-exhibits-banner(?=["'\s>])/i
const NV_EXHIBITS_OPEN = /<div\b[^>]*\bclass\s*=\s*(["'])(?:[^"']*\s)?nv-exhibits(?:\s[^"']*)?\1[^>]*>/i
// Prompt 107b: the exhibit page images shown in the Edit & Print window (never saved or sent).
const NV_EXHIBIT_PAGES_OPEN = /<div\b[^>]*\bclass\s*=\s*(["'])(?:[^"']*\s)?nv-exhibit-pages(?:\s[^"']*)?\1[^>]*>/i

export function stripEditorChrome(html) {
  let out = String(html ?? '')
  out = removeElements(out, NV_BAR_OPEN, 'div')
  out = removeElements(out, NV_BANNER_OPEN, 'div')
  out = out.replace(/<style\b[^>]*\bid\s*=\s*["']?nv-edit-style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<\/?script\b[^>]*>/gi, '')
  out = out.replace(/document\.designMode\s*=\s*["'](?:on|off)["'];?/g, '')
  out = out.replace(TAG_RE, tag => {
    const isBody = /^<body\b/i.test(tag)
    return editAttrs(tag, (name, value) => {
      if (name === 'contenteditable' || name === 'designmode') return null
      if (isBody && name === 'style') {
        const rest = String(value ?? '').replace(/(^|;)\s*margin-top\s*:[^;]*;?/gi, '$1').trim()
        return rest ? rest : null
      }
      return undefined
    })
  })
  out = removeElements(out, NV_EXHIBITS_OPEN, 'div')
  out = removeElements(out, NV_EXHIBIT_PAGES_OPEN, 'div')
  // SignWell text tags left in the e-sign slots by an earlier SignWell send (its stored copy):
  // the slots must be empty again for the next send.
  out = out.replace(/<span\b[^>]*\bdata-signwell-tag="1"[^>]*>[^<]*<\/span>/g, '')
  out = out.replace(/^﻿?\s*/, '')
  if (!/^<!doctype html/i.test(out)) out = '<!DOCTYPE html>' + out
  return out
}

// ── sanitize ────────────────────────────────────────────────────────────────
const DROP_WITH_CONTENT = ['script', 'iframe', 'object', 'applet', 'frameset', 'noembed']
const DROP_TAGS = new Set([...DROP_WITH_CONTENT, 'embed', 'base', 'form', 'frame'])
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'background', 'poster', 'srcset', 'ping', 'data', 'cite', 'longdesc', 'lowsrc', 'dynsrc', 'codebase', 'manifest', 'values', 'to', 'from', 'by'])

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&colon;/gi, ':').replace(/&tab;/gi, '\t').replace(/&newline;/gi, '\n')
}
function safeChar(n) {
  try { return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '' } catch { return '' }
}

export function isDangerousUrl(value) {
  const v = decodeEntities(value).replace(/[\u0000- \u007f-\u009f​-‍﻿]+/g, '').toLowerCase()
  return v.startsWith('javascript:') || v.startsWith('vbscript:') || v.startsWith('data:text/html')
}

function sanitizeOnce(html) {
  let out = String(html ?? '')
  for (const t of DROP_WITH_CONTENT) out = out.replace(new RegExp(`<${t}\\b(?:"[^"]*"|'[^']*'|[^'">])*>[\\s\\S]*?<\\/${t}\\s*>`, 'gi'), '')
  out = out.replace(/<\/\s*([a-zA-Z]+)\s*>/g, (m, n) => (DROP_TAGS.has(n.toLowerCase()) ? '' : m))
  out = out.replace(TAG_RE, tag => {
    const name = /^<([a-zA-Z][^\s\/>]*)/.exec(tag)[1].toLowerCase()
    if (DROP_TAGS.has(name)) return ''
    const attrs = {}
    editAttrs(tag, (n, v) => { attrs[n] = String(v ?? ''); return undefined })
    if (name === 'meta' && attrs['http-equiv'] && attrs['http-equiv'].trim().toLowerCase() === 'refresh') return ''
    if (name === 'link' && /(^|\s)import(\s|$)/i.test(attrs.rel || '')) return ''
    return editAttrs(tag, (n, v) => {
      if (/^on/.test(n)) return null
      if (URL_ATTRS.has(n) && v != null && isDangerousUrl(v)) return n === 'href' || n === 'xlink:href' ? '#' : 'about:blank'
      return undefined
    })
  })
  return out
}

// Idempotent: repeats until nothing changes (a removed tag can't leave a new one behind).
export function sanitizeContractHtml(html) {
  let out = String(html ?? '')
  for (let i = 0; i < 10; i++) {
    const next = sanitizeOnce(out)
    if (next === out) break
    out = next
  }
  return out
}

// ── edited marker ───────────────────────────────────────────────────────────
const HTML_OPEN = /<html\b(?:"[^"]*"|'[^']*'|[^'">])*>/i

export function markEdited(html, iso) {
  const at = String(iso ?? '').replace(/[^0-9A-Za-z:.+-]/g, '')
  const out = String(html ?? '')
  const m = HTML_OPEN.exec(out)
  if (!m) {
    const dt = /^\s*<!doctype[^>]*>/i.exec(out)
    const pre = dt ? dt[0] : '<!DOCTYPE html>'
    return `${pre}<html data-nv-edited="${at}">${out.slice(dt ? dt[0].length : 0)}</html>`
  }
  const cleared = editAttrs(m[0], n => (n === 'data-nv-edited' ? null : undefined))
  const tag = cleared.replace(/\s*\/?>$/, '') + ` data-nv-edited="${at}">`
  return out.slice(0, m.index) + tag + out.slice(m.index + m[0].length)
}

export function editedAt(html) {
  const m = HTML_OPEN.exec(String(html ?? ''))
  if (!m) return null
  let v = null
  editAttrs(m[0], (n, val) => { if (n === 'data-nv-edited') v = val; return undefined })
  if (!v || Number.isNaN(Date.parse(v))) return null
  return new Date(v).toISOString()
}

// Same shape as fillSlot's marker regex in lib/generated-contract.js.
export function hasEmptySignatureSlot(html) {
  return /<(span|div)\b[^>]*\bdata-esign="sub-signature"[^>]*><\/\1>/.test(String(html ?? ''))
}

export function prepareEditedContract(rawHtml, iso) {
  return markEdited(sanitizeContractHtml(stripEditorChrome(rawHtml)), iso)
}

// "Nov 24, 2:46 PM CT"
export function formatCentralDateTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT'
}
// "2:46 PM"
export function formatCentralTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
}

export function chooseContractForSend({ editedHtml, editedAtIso, generatorSavedAtIso = null, confirmFn, formatTime = formatCentralDateTime } = {}) {
  if (!editedHtml) return { useEdited: false, html: null }
  let msg = `Send your edited version from ${formatTime(editedAtIso)}?\n\nOK = send the edited version\nCancel = send a fresh contract from the form fields`
  const gen = Date.parse(generatorSavedAtIso || '')
  const ed = Date.parse(editedAtIso || '')
  if (!Number.isNaN(gen) && !Number.isNaN(ed) && gen > ed) msg += '\n\nNote: the contract details were changed after these edits.'
  return confirmFn(msg) ? { useEdited: true, html: editedHtml } : { useEdited: false, html: null }
}
