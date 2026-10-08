export async function generateEstimatePDF(estimate) {
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

  const w = window.open('', '_blank')
  const lines = estimate.estimate_line_items || []
  const globalPdfPct = Number(estimate.markup_pct || 0)
  const globalPdfFlat = Number(estimate.markup_flat || 0)
  const rawTotal = lines.reduce((a, l) => a + Number(l.amount || 0), 0)
  const taxAmt = estimate.taxable ? rawTotal * 0.0825 : 0
  const markupFlatAmt = globalPdfFlat
  const fmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const estDate = new Date(estimate.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const genDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  w.document.write(`<!DOCTYPE html><html><head>
<title>Proposal — ${estimate.project_name}</title>
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
    <div class="doc-project">${estimate.project_name}</div>
    <div class="doc-meta">
      No. ${estimate.estimate_number}<br>
      Date: ${estDate}${estimate.project_type ? `<br>${estimate.project_type}` : ''}
    </div>
  </div>
</div>
<div class="rule"></div>

<div class="body">

<div class="parties">
  <div class="party">
    <div class="party-eyebrow">Prepared For</div>
    ${estimate.owner_name ? `<div class="party-name">${estimate.owner_name}</div>` : ''}
    <div class="party-detail">
      ${estimate.owner_company || ''}
      ${estimate.owner_email ? `<br>${estimate.owner_email}` : ''}
      ${estimate.owner_phone ? `<br>${estimate.owner_phone}` : ''}
    </div>
    ${estimate.address ? `<div class="party-detail" style="margin-top:8px;color:#555">${estimate.address.replace(/\n/g,'<br>')}</div>` : ''}
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
<div class="scope-box">${estimate.notes.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
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
      const amt = Number(l.amount)
      const linePct = l.markup_pct !== null && l.markup_pct !== undefined ? Number(l.markup_pct) : globalPdfPct
      const lineFlat = l.markup_flat !== null && l.markup_flat !== undefined ? Number(l.markup_flat) : 0
      const globalFlatShare = rawTotal > 0 ? markupFlatAmt * (amt / rawTotal) : 0
      const displayAmt = amt * (1 + linePct / 100) + lineFlat + globalFlatShare
      return `<tr>
      <td style="color:#ccc;font-size:10px;padding-top:13px">${i + 1}</td>
      <td>
        <div class="item-desc">${l.description}</div>
        ${l.scope ? `<div class="item-note">${l.scope.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : ''}
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
    <div class="totals-amount">${fmt(lines.reduce((a, l) => { const amt = Number(l.amount); const pct = l.markup_pct !== null && l.markup_pct !== undefined ? Number(l.markup_pct) : globalPdfPct; const flat = l.markup_flat !== null && l.markup_flat !== undefined ? Number(l.markup_flat) : 0; return a + amt * (1 + pct / 100) + flat; }, 0) + markupFlatAmt)}</div>
  </div>
  <div class="totals-row">
    <div class="totals-label">Sales Tax (8.25%)</div>
    <div class="totals-amount">${fmt(taxAmt)}</div>
  </div>` : ''}
  <div class="totals-row grand">
    <div class="totals-label">Total</div>
    <div class="totals-amount">${fmt(lines.reduce((a, l) => { const amt = Number(l.amount); const pct = l.markup_pct !== null && l.markup_pct !== undefined ? Number(l.markup_pct) : globalPdfPct; const flat = l.markup_flat !== null && l.markup_flat !== undefined ? Number(l.markup_flat) : 0; return a + amt * (1 + pct / 100) + flat; }, 0) + markupFlatAmt + taxAmt)}</div>
  </div>
</div>
<div class="table-note">All amounts in USD &nbsp;·&nbsp; Prices subject to revision upon scope changes &nbsp;·&nbsp; Valid 30 days from date of issue</div>

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
    Proposal No. ${estimate.estimate_number}<br>
    Generated ${genDate}
  </div>
</div>

</div>
</div>
</body></html>`)
  w.document.close()
}
