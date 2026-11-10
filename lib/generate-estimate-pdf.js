import { openHtml } from './open-file'
import { estimateBreakdown, linePrice, lineCost, taxLabel } from './calc-total'
import { todayCentral } from './central-date'
import { addDaysIso, validDaysOf, sectionItems, sortAlternates, exportErrorMessage } from './estimate-proposal'

// Not async: openHtml must open the window synchronously inside the tap (iOS).
// `estimate` may also be an async loader (() => Promise<estimate | null>): the window still
// opens inside the tap and is filled once the loader resolves (null closes it).
export function generateEstimatePDF(estimate) {
  if (typeof estimate === 'function') {
    return openHtml(async () => {
      const est = await estimate()
      return est ? buildEstimateHtml(est) : null
    })
  }
  return openHtml(() => buildEstimateHtml(estimate))
}

// Export the SAVED estimate through /api/estimates/export (revision + proposal date), then
// print the estimate it returns. Call directly from the tap (no await before it).
// Plain fetch('/api/...') carries the session token (lib/supabase.js).
export function exportEstimateProposal(id, { onError } = {}) {
  return generateEstimatePDF(async () => {
    try {
      const res = await fetch('/api/estimates/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.estimate) {
        const msg = exportErrorMessage(res.status, body?.error)
        if (onError) onError(msg); else if (typeof window !== 'undefined') window.alert(msg)
        return null
      }
      return body.estimate
    } catch (e) {
      const msg = e?.message || 'Export failed — check connection'
      if (onError) onError(msg); else if (typeof window !== 'undefined') window.alert(msg)
      return null
    }
  })
}

// Every interpolated text value goes through esc().
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// Exported for tests; generateEstimatePDF is the UI entry point.
export async function buildEstimateHtml(estimate) {
  let logoSrc = ''
  try {
    const res = await fetch('/logo.png')
    const blob = await res.blob()
    logoSrc = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  } catch { /* logo optional */ }

  const lines = estimate.estimate_line_items || []
  // Shared estimate math (lib/calc-total.js): same totals as the UI and
  // estimate -> job conversion. Tax at the estimate's actual rate on raw cost.
  const bd = estimateBreakdown(estimate, lines)
  const globalPdfPct = Number(estimate.markup_pct || 0)
  const rawTotal = bd.raw
  const taxAmt = bd.tax
  const markupFlatAmt = bd.globalFlat
  const fmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // Proposal date (set by the export) or today; valid through = date + valid_days (default 30).
  const proposalDate = /^\d{4}-\d{2}-\d{2}$/.test(String(estimate.proposal_date || '')) ? estimate.proposal_date : todayCentral()
  const validDays = validDaysOf(estimate)
  const estDate = longDate(proposalDate)
  const validThrough = longDate(addDaysIso(proposalDate, validDays))
  const revision = Number(estimate.revision || 0)
  const genDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  // Alternates never change bd.total (the base Total).
  const alternates = sortAlternates(estimate.alternates)
  const exclusions = sectionItems(estimate.exclusions)
  const clarifications = sectionItems(estimate.clarifications)

  return `<!DOCTYPE html><html><head>
<title>Proposal — ${esc(estimate.project_name)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { .no-print { display: none !important; } }

.no-print { padding: 12px 40px; background: #1a1a1a; display: flex; gap: 10px; align-items: center; }
.btn { padding: 8px 22px; background: #e8590c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; }
.btn-outline { padding: 8px 18px; background: transparent; color: #888; border: 1px solid #333; border-radius: 4px; cursor: pointer; font-size: 12px; }

.page { max-width: 860px; margin: 0 auto; }

.header-band { background: #111; padding: 36px 52px 32px; display: flex; justify-content: space-between; align-items: flex-start; }
.brand { display: flex; align-items: center; gap: 18px; }
.brand-logo { width: 60px; height: 60px; object-fit: contain; filter: brightness(0) invert(1); }
.brand-divider { width: 1px; height: 52px; background: #333; }
.co-name { font-size: 18px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; color: #fff; }
.co-tagline { font-size: 9px; color: #555; letter-spacing: 3px; text-transform: uppercase; margin-top: 4px; }
.co-contact { font-size: 10px; color: #666; margin-top: 10px; line-height: 1.9; }
.doc-block { text-align: right; }
.doc-type { font-size: 9px; font-weight: 800; letter-spacing: 4px; text-transform: uppercase; color: #e8590c; }
.doc-project { font-size: 17px; font-weight: 800; color: #fff; margin-top: 6px; max-width: 280px; line-height: 1.25; text-align: right; }
.doc-meta { font-size: 10px; color: #555; margin-top: 8px; line-height: 1.8; }

.rule { height: 3px; background: #e8590c; }
.body { padding: 44px 52px; }

.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 36px; border: 1px solid #e8e8e8; }
.party { padding: 20px 24px; }
.party + .party { border-left: 1px solid #e8e8e8; }
.party-eyebrow { font-size: 8px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #e8590c; margin-bottom: 10px; }
.party-name { font-size: 15px; font-weight: 700; color: #111; line-height: 1.3; }
.party-detail { font-size: 11px; color: #777; margin-top: 4px; line-height: 1.7; }

.section-eyebrow { font-size: 8px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #e8590c; margin-bottom: 10px; }
.scope-box { border: 1px solid #e8e8e8; border-left: 3px solid #e8590c; padding: 16px 20px; font-size: 12px; color: #444; line-height: 1.9; white-space: pre-wrap; margin-bottom: 36px; }

.table-wrap { margin-bottom: 0; }
table { width: 100%; border-collapse: collapse; }
thead tr { border-bottom: 2px solid #111; }
thead th { padding: 8px 14px; font-size: 8px; text-transform: uppercase; letter-spacing: 2px; color: #111; font-weight: 800; text-align: left; }
thead th.right { text-align: right; }
tbody tr { border-bottom: 1px solid #efefef; }
tbody tr:last-child { border-bottom: none; }
tbody td { padding: 12px 14px; font-size: 12px; color: #333; vertical-align: top; }
tbody td.right { text-align: right; color: #111; font-variant-numeric: tabular-nums; white-space: nowrap; }
.item-desc { font-weight: 600; color: #111; }
.item-note { font-size: 10px; color: #888; margin-top: 3px; white-space: pre-wrap; line-height: 1.6; }

.totals-block { border-top: 2px solid #111; margin-top: 0; }
.totals-row { display: flex; justify-content: flex-end; padding: 10px 14px; gap: 48px; align-items: center; border-bottom: 1px solid #efefef; }
.totals-row:last-child { border-bottom: none; }
.totals-label { font-size: 11px; color: #777; }
.totals-amount { font-size: 12px; color: #333; font-variant-numeric: tabular-nums; min-width: 120px; text-align: right; }
.totals-row.grand { background: #111; }
.totals-row.grand .totals-label { font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #e8590c; }
.totals-row.grand .totals-amount { font-size: 20px; font-weight: 900; color: #fff; }

.table-note { font-size: 9px; color: #bbb; margin-top: 10px; letter-spacing: 0.3px; }

.acceptance { margin-top: 44px; border-top: 1px solid #e8e8e8; padding-top: 32px; }
.acceptance-title { font-size: 8px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #111; margin-bottom: 24px; }
.sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
.sig-party { font-size: 10px; font-weight: 700; color: #333; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
.sig-field { border-bottom: 1px solid #bbb; margin-bottom: 14px; height: 36px; }
.sig-field-label { font-size: 8px; color: #bbb; letter-spacing: 1px; text-transform: uppercase; margin-top: 3px; }

.section-list { margin: 0 0 28px 18px; font-size: 12px; color: #444; line-height: 1.8; }
.alt-table { margin-bottom: 6px; }
.alt-accepted { font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #15803d; margin-left: 8px; }

.doc-footer { margin-top: 44px; padding-top: 16px; border-top: 1px solid #efefef; display: flex; justify-content: space-between; align-items: center; }
.doc-footer-left { font-size: 9px; color: #bbb; line-height: 1.7; }
.doc-footer-right { font-size: 9px; color: #bbb; text-align: right; }
</style></head><body>

<div class="no-print">
  <button class="btn" onclick="window.print()">Print / Save PDF</button>
  <button class="btn-outline" onclick="window.close()">Close</button>
</div>

<div class="page">

<div class="header-band">
  <div class="brand">
    ${logoSrc ? `<img src="${logoSrc}" class="brand-logo" alt="NV" />` : ''}
    <div class="brand-divider"></div>
    <div class="brand-text">
      <div class="co-name">NV Construction</div>
      <div class="co-tagline">General Contractor</div>
      <div class="co-contact">
        management@nvim.co<br>
        nvim.co<br>
        LA License #&nbsp;CL 10283
      </div>
    </div>
  </div>
  <div class="doc-block">
    <div class="doc-type">Cost Proposal</div>
    <div class="doc-project">${esc(estimate.project_name)}</div>
    <div class="doc-meta">
      No. ${esc(estimate.estimate_number)}${revision > 0 ? ` &nbsp;·&nbsp; Revision ${revision}` : ''}<br>
      Date: ${estDate}<br>
      Valid through: ${validThrough}${estimate.project_type ? `<br>${esc(estimate.project_type)}` : ''}
    </div>
  </div>
</div>
<div class="rule"></div>

<div class="body">

<div class="parties">
  <div class="party">
    <div class="party-eyebrow">Prepared For</div>
    ${estimate.owner_name ? `<div class="party-name">${esc(estimate.owner_name)}</div>` : ''}
    <div class="party-detail">
      ${esc(estimate.owner_company || '')}
      ${estimate.owner_email ? `<br>${esc(estimate.owner_email)}` : ''}
      ${estimate.owner_phone ? `<br>${esc(estimate.owner_phone)}` : ''}
    </div>
    ${estimate.address ? `<div class="party-detail" style="margin-top:8px;color:#555">${esc(estimate.address).replace(/\r?\n/g,'<br>')}</div>` : ''}
  </div>
  <div class="party">
    <div class="party-eyebrow">Prepared By</div>
    <div class="party-name">NV Construction, LLC</div>
    <div class="party-detail">
      General Contractor<br>
      management@nvim.co<br>
      nvim.co<br>
      LA License # CL 10283
    </div>
  </div>
</div>

${estimate.notes ? `
<div class="section-eyebrow">Scope of Work</div>
<div class="scope-box">${esc(estimate.notes)}</div>
` : ''}

<div class="section-eyebrow" style="margin-bottom:12px">Schedule of Values</div>
<div class="table-wrap">
<table>
  <thead>
    <tr>
      <th style="width:32px;color:#bbb">#</th>
      <th>Description</th>
      <th class="right" style="width:150px">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${lines.map((l, i) => {
      const amt = lineCost(l)
      const globalFlatShare = rawTotal > 0 ? markupFlatAmt * (amt / rawTotal) : 0
      const displayAmt = linePrice(l, globalPdfPct) + globalFlatShare
      return `<tr>
      <td style="color:#ccc;font-size:10px;padding-top:13px">${i + 1}</td>
      <td>
        <div class="item-desc">${esc(l.description)}</div>
        ${l.scope ? `<div class="item-note">${esc(l.scope)}</div>` : ''}
      </td>
      <td class="right">${fmt(displayAmt)}</td>
    </tr>`}).join('')}
  </tbody>
</table>
</div>

<div class="totals-block">
  ${estimate.taxable ? `
  <div class="totals-row">
    <div class="totals-label">Subtotal</div>
    <div class="totals-amount">${fmt(bd.subtotal)}</div>
  </div>
  <div class="totals-row">
    <div class="totals-label">${taxLabel(bd)}</div>
    <div class="totals-amount">${fmt(taxAmt)}</div>
  </div>` : ''}
  <div class="totals-row grand">
    <div class="totals-label">Total</div>
    <div class="totals-amount">${fmt(bd.total)}</div>
  </div>
</div>
<div class="table-note">All amounts in USD &nbsp;·&nbsp; Prices subject to revision upon scope changes &nbsp;·&nbsp; Valid ${validDays} day${validDays === 1 ? '' : 's'} from date of issue (through ${validThrough})</div>

${alternates.length ? `
<div class="section-eyebrow" style="margin-top:36px;margin-bottom:12px">Alternates</div>
<div class="table-wrap alt-table">
<table>
  <thead>
    <tr>
      <th style="width:32px;color:#bbb">#</th>
      <th>Description</th>
      <th style="width:90px">Add / Deduct</th>
      <th class="right" style="width:150px">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${alternates.map((a, i) => `<tr>
      <td style="color:#ccc;font-size:10px;padding-top:13px">${i + 1}</td>
      <td><span class="item-desc">${esc(a.description)}</span>${a.accepted ? '<span class="alt-accepted">Accepted</span>' : ''}</td>
      <td>${a.kind === 'deduct' ? 'Deduct' : 'Add'}</td>
      <td class="right">${a.kind === 'deduct' ? '−' : '+'}${fmt(Number(a.amount || 0))}</td>
    </tr>`).join('')}
  </tbody>
</table>
</div>
<div class="table-note">Alternates are not included in the Total above.</div>
` : ''}

${exclusions.length ? `
<div class="section-eyebrow" style="margin-top:36px">Exclusions</div>
<ul class="section-list">${exclusions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
` : ''}

${clarifications.length ? `
<div class="section-eyebrow" style="margin-top:${exclusions.length ? '0' : '36px'}">Clarifications</div>
<ul class="section-list">${clarifications.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
` : ''}

<div class="acceptance">
  <div class="acceptance-title">Authorization &amp; Acceptance</div>
  <div class="sig-grid">
    <div class="sig-block">
      <div class="sig-party">Client</div>
      <div class="sig-field"></div>
      <div class="sig-field-label">Signature</div>
      <div class="sig-field" style="margin-top:18px"></div>
      <div class="sig-field-label">Print Name &amp; Title</div>
      <div class="sig-field" style="margin-top:18px;width:50%"></div>
      <div class="sig-field-label">Date</div>
    </div>
    <div class="sig-block">
      <div class="sig-party">NV Construction, LLC</div>
      <div class="sig-field"></div>
      <div class="sig-field-label">Authorized Signature</div>
      <div class="sig-field" style="margin-top:18px"></div>
      <div class="sig-field-label">Print Name &amp; Title</div>
      <div class="sig-field" style="margin-top:18px;width:50%"></div>
      <div class="sig-field-label">Date</div>
    </div>
  </div>
</div>

<div class="doc-footer">
  <div class="doc-footer-left">
    NV Construction, LLC &nbsp;·&nbsp; General Contractor &nbsp;·&nbsp; LA License # CL 10283<br>
    management@nvim.co &nbsp;·&nbsp; nvim.co
  </div>
  <div class="doc-footer-right">
    Proposal No. ${esc(estimate.estimate_number)}${revision > 0 ? ` · Rev. ${revision}` : ''}<br>
    Generated ${genDate}
  </div>
</div>

</div>
</div>
</body></html>`
}
