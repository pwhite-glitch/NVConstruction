// Text helpers for pdf-lib's standard fonts (Helvetica etc.), which only encode
// WinAnsi (Windows-1252). Anything else (emoji, ≥, tabs, CJK...) makes
// drawText / widthOfTextAtSize throw, so text is cleaned first. No font files
// ship with the app, so we sanitize instead of embedding a Unicode font.

// Non-ASCII characters WinAnsi has in 0x80–0x9F.
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

// Common characters people type that WinAnsi lacks, with a readable stand-in.
const REPLACE = {
  '≥': '>=', '≤': '<=', '≠': '!=', '→': '->', '←': '<-', '⇒': '=>', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x',
  '′': "'", '″': '"', '‐': '-', '‑': '-', '‒': '-', '−': '-', '⁄': '/', '∕': '/', '≈': '~', '∼': '~',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '﻿': '',
}

const isWinAnsi = ch => {
  const c = ch.codePointAt(0)
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch)
}

// One line (or several, '\n' kept) of text Helvetica can draw. Tabs become
// spaces, \r is dropped, known symbols get ASCII stand-ins, the rest is removed.
export function winAnsiSafe(text) {
  let out = ''
  for (const ch of String(text ?? '').normalize('NFC')) {
    if (ch === '\n') { out += '\n'; continue }
    if (ch === '\t') { out += '    '; continue }
    if (ch === '\r') continue
    if (isWinAnsi(ch)) { out += ch; continue }
    if (ch in REPLACE) { out += REPLACE[ch]; continue }
    // Accented letters outside Latin-1: try the base letter.
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    if (base && base !== ch && [...base].every(isWinAnsi)) out += base
  }
  return out
}

// Wrap text to fit maxW, honoring newlines. Words wider than a whole line
// (long URLs) are broken by character so nothing runs off the page.
export function wrapLines(text, font, size, maxW) {
  const width = s => font.widthOfTextAtSize(s, size)
  const out = []
  for (const para of winAnsiSafe(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue }
    let line = ''
    for (let word of para.split(' ')) {
      while (width(word) > maxW && word.length > 1) {
        if (line) { out.push(line); line = '' }
        let n = word.length - 1
        while (n > 1 && width(word.slice(0, n)) > maxW) n--
        out.push(word.slice(0, n))
        word = word.slice(n)
      }
      const test = line ? `${line} ${word}` : word
      if (width(test) > maxW && line) {
        out.push(line); line = word
      } else { line = test }
    }
    if (line) out.push(line)
  }
  return out
}
