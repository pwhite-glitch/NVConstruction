// Printable HTML for the residential job page: internal Draw Request package,
// owner/lender draw sheet, homeowner change order, and the e-signed billing
// waiver. Every dynamic value goes through escapeHtml (text and attributes);
// URLs are checked separately (safeImageSrc). The pages are written into a
// same-origin window, so nothing typed by a sub/user may become markup.
import { escapeHtml } from './email'

const esc = escapeHtml
const num = v => Number(v || 0)
export const money = n => '$' + num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dateLong = d => d ? new Date(String(d).length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: String(d).length === 10 ? 'UTC' : undefined }) : '—'

// Image src allowed in a print: same-origin/https URL or an inline PNG/JPEG data
// URL (e-signatures). Anything else (javascript:, other data:, junk) → ''.
export function safeImageSrc(src, origin = '') {
  const s = String(src || '').trim()
  if (!s) return ''
  if (/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return s
  try {
    const u = new URL(s, origin || 'https://invalid.local')
    if (u.protocol !== 'https:' && !(origin && u.origin === origin)) return ''
    return u.href
  } catch { return '' }
}

const BASE_CSS = `*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;margin:0;padding:0;font-size:13px;background:#fff}
.brand-bar{display:flex;align-items:center;justify-content:space-between;padding:20px 32px 16px;border-bottom:3px solid #e8590c}
.brand-left{display:flex;align-items:center;gap:12px}
.brand-name{font-size:15px;font-weight:700;color:#111;line-height:1.1}
.brand-tagline{font-size:11px;color:#888;letter-spacing:.5px;margin-top:1px}
.draw-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;text-align:right}
.draw-num{font-size:22px;font-weight:800;color:#e8590c;line-height:1;text-align:right}
.content{padding:24px 32px 40px}
.doc-title{font-size:20px;font-weight:700;margin:0 0 4px}
.doc-meta{color:#666;font-size:12px;margin:0 0 24px}
.section{margin-bottom:24px}
.section-title{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:10px}
table{width:100%;border-collapse:collapse}
td,th{padding:7px 8px;text-align:left;border-bottom:1px solid #eee;font-size:12.5px;vertical-align:top}
th{font-weight:600;color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.5px;background:#f9f9f9}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.total-row td{font-weight:700;border-top:2px solid #111;border-bottom:none;padding-top:10px;background:#f5f5f5}
.grand-total{margin-top:24px;border-top:3px solid #e8590c;padding-top:14px;display:flex;justify-content:space-between;align-items:baseline}
.grand-total .label{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.grand-total .amount{font-size:22px;font-weight:800;color:#e8590c;font-variant-numeric:tabular-nums}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:20px}
.field label{display:block;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#888;margin-bottom:3px}
.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}
.sig-line{border-bottom:1px solid #111;height:42px}
.sig-label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:4px}
.note{font-size:11px;color:#666;margin-top:6px}
.print-btn{position:fixed;top:12px;right:12px;background:#e8590c;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;z-index:999}
@media print{.print-btn{display:none}}`

function page({ title, label, number, tagline, body, logoUrl, autoPrint = true }) {
  const logo = safeImageSrc(logoUrl)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="brand-bar"><div class="brand-left">${logo ? `<img src="${esc(logo)}" alt="NV Construction" width="40" height="40" style="object-fit:contain;border-radius:4px">` : ''}<div><div class="brand-name">NV Construction</div><div class="brand-tagline">${esc(tagline)}</div></div></div>
<div><div class="draw-label">${esc(label)}</div><div class="draw-num">${esc(number)}</div></div></div>
<div class="content">${body}</div>
${autoPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}</body></html>`
}

const jobLine = job => {
  const name = job?.project_name || job?.location || 'Project'
  const addr = job?.location && job?.project_name ? job.location : ''
  return `${esc(job?.job_number ? '#' + job.job_number + ' — ' : '')}${esc(name)}${addr ? ' · ' + esc(addr) : ''}`
}

// Internal Draw Request package (Billing → Draw Requests → Download).
// Only APPROVED sub billings are in the Sub Billings total and Grand Total. Pending billings
// tagged to the draw (filed into it by the sub) are listed separately as "awaiting approval",
// outside every total. Rejected billings are left out of the package entirely.
export function buildDrawPackageHtml({ job, draw, costs = [], billings = [], logoUrl = '', today = new Date() }) {
  const approved = billings.filter(b => b.status === 'approved')
  const awaiting = billings.filter(b => b.status === 'pending')
  const costTotal = costs.reduce((a, c) => a + (c.is_credit ? -1 : 1) * num(c.amount), 0)
  const billingTotal = approved.reduce((a, b) => a + num(b.amount_billed), 0)
  const awaitingTotal = awaiting.reduce((a, b) => a + num(b.amount_billed), 0)
  const drawNum = `Draw #${String(draw?.draw_number ?? '').padStart(3, '0')}`
  const costRows = costs.map(c => `<tr><td>${esc(c.description || '—')}${c.is_credit ? ' (credit)' : ''}</td><td>${esc(c.cost_date ? dateLong(c.cost_date) : '—')}</td><td class="num">${esc((c.is_credit ? '−' : '') + money(c.amount))}</td></tr>`).join('')
  const billRow = b => {
    const period = b.billing_period ? new Date(b.billing_period + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—'
    return `<tr><td>${esc(b.company_name || '—')}</td><td>${esc(period)}</td><td>${esc(b.work_description || '—')}</td><td class="num">${esc(money(b.amount_billed))}</td><td>${esc(b.status || '')}</td></tr>`
  }
  const head = '<thead><tr><th>Subcontractor</th><th>Period</th><th>Description</th><th class="num">Amount Billed</th><th>Status</th></tr></thead>'
  const body = `<p class="doc-title">${esc(draw?.title || drawNum)}</p>
<p class="doc-meta">${jobLine(job)} · ${esc(today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</p>
${costs.length ? `<div class="section"><div class="section-title">Direct Costs</div><table><thead><tr><th>Description</th><th>Date</th><th class="num">Amount</th></tr></thead><tbody>${costRows}<tr class="total-row"><td colspan="2">Direct Costs Total</td><td class="num">${esc(money(costTotal))}</td></tr></tbody></table></div>` : ''}
${approved.length ? `<div class="section"><div class="section-title">Sub Billing Submissions</div><table>${head}<tbody>${approved.map(billRow).join('')}<tr class="total-row"><td colspan="3">Sub Billings Total</td><td class="num">${esc(money(billingTotal))}</td><td></td></tr></tbody></table></div>` : ''}
${costs.length || approved.length ? `<div class="grand-total"><span class="label">Grand Total</span><span class="amount">${esc(money(costTotal + billingTotal))}</span></div>` : '<p class="note">Nothing approved is on this draw yet.</p>'}
${awaiting.length ? `<div class="section awaiting"><div class="section-title">Awaiting Approval — not included in the total</div><table>${head}<tbody>${awaiting.map(billRow).join('')}<tr class="total-row"><td colspan="3">Awaiting approval (not in Grand Total)</td><td class="num">${esc(money(awaitingTotal))}</td><td></td></tr></tbody></table></div>` : ''}`
  return page({ title: draw?.title || drawNum, label: 'Draw Request No.', number: drawNum, tagline: 'Draw Request', body, logoUrl })
}

// Owner / lender draw sheet with the Bank-line schedule (G703 style).
// schedule: buildDrawSchedule() result; lines with nothing scheduled or drawn are skipped.
export function buildOwnerDrawHtml({ job, draw, schedule, revised = null, logoUrl = '' }) {
  const drawNum = `Draw #${String(draw?.draw_number ?? '').padStart(3, '0')}`
  const rows = (schedule?.rows || []).filter(r => r.scheduled || r.total)
  const pct = p => p === null || p === undefined ? '—' : `${p.toFixed(1)}%`
  const funded = draw?.status === 'funded'
    ? (draw.amount_funded === null || draw.amount_funded === undefined ? 'Funded — amount received not recorded' : `Funded ${money(draw.amount_funded)}${draw.funded_date ? ' on ' + dateLong(draw.funded_date) : ''}`)
    : (draw?.status || '')
  const body = `<p class="doc-title">${esc(draw?.title || drawNum)}</p>
<p class="doc-meta">${jobLine(job)}</p>
<div class="grid">
<div class="field"><label>Owner / Borrower</label>${esc(job?.owner_company || job?.owner_name || '—')}</div>
<div class="field"><label>Period</label>${esc(draw?.period_start ? dateLong(draw.period_start) : '—')} – ${esc(draw?.period_end ? dateLong(draw.period_end) : '—')}</div>
<div class="field"><label>Contract (revised)</label>${esc(revised === null ? '—' : money(revised))}</div>
<div class="field"><label>Status</label>${esc(funded)}</div>
</div>
${rows.length ? `<div class="section"><div class="section-title">Schedule of Values (Bank)</div><table><thead><tr><th>Line</th><th class="num">Scheduled</th><th class="num">Previous</th><th class="num">This Draw</th><th class="num">Total to Date</th><th class="num">%</th><th class="num">Balance</th></tr></thead><tbody>
${rows.map(r => `<tr><td>${esc((r.cost_code ? r.cost_code + ' · ' : '') + r.description)}</td><td class="num">${esc(money(r.scheduled))}</td><td class="num">${esc(money(r.previous))}</td><td class="num">${esc(money(r.this_period))}</td><td class="num">${esc(money(r.total))}</td><td class="num">${esc(pct(r.pct))}</td><td class="num">${esc(money(r.balance))}</td></tr>`).join('')}
<tr class="total-row"><td>Total</td><td class="num">${esc(money(schedule.totals.scheduled))}</td><td class="num">${esc(money(schedule.totals.previous))}</td><td class="num">${esc(money(schedule.totals.this_period))}</td><td class="num">${esc(money(schedule.totals.total))}</td><td class="num">${esc(pct(schedule.totals.pct))}</td><td class="num">${esc(money(schedule.totals.balance))}</td></tr>
</tbody></table></div>` : '<p class="note">This draw has no line-by-line schedule (created before schedules were recorded).</p>'}
<div class="grand-total"><span class="label">Amount Requested</span><span class="amount">${esc(money(draw?.amount_requested))}</span></div>
${draw?.notes ? `<p class="note">${esc(draw.notes)}</p>` : ''}
<div class="sig-grid"><div><div class="sig-line"></div><div class="sig-label">Contractor — NV Construction · Date</div></div><div><div class="sig-line"></div><div class="sig-label">Owner / Lender · Date</div></div></div>`
  return page({ title: draw?.title || drawNum, label: 'Owner / Lender Draw', number: drawNum, tagline: 'Draw Request', body, logoUrl })
}

// Homeowner change order with signature lines. baseContract = jobs.contract_value;
// approvedBefore = approved prime COs other than this one. Printing changes nothing.
export function buildChangeOrderHtml({ job, co, coLabel, baseContract, approvedBefore, logoUrl = '', today = new Date() }) {
  const amount = num(co?.amount)
  const prior = num(baseContract) + num(approvedBefore)
  const after = prior + amount
  const body = `<p class="doc-title">Change Order ${esc(coLabel)}</p>
<p class="doc-meta">${jobLine(job)} · ${esc(today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</p>
<div class="grid">
<div class="field"><label>Homeowner</label>${esc(job?.owner_name || job?.owner_company || '—')}</div>
<div class="field"><label>Property</label>${esc(job?.location || '—')}</div>
<div class="field"><label>Status</label>${esc(co?.status || '')}</div>
<div class="field"><label>Date written</label>${esc(co?.created_at ? dateLong(co.created_at) : '—')}</div>
</div>
<div class="section"><div class="section-title">Description of change</div><p style="white-space:pre-wrap;margin:0">${esc(co?.description || '')}</p>${co?.notes ? `<p class="note" style="white-space:pre-wrap">${esc(co.notes)}</p>` : ''}</div>
<div class="section"><div class="section-title">Contract sum</div><table><tbody>
<tr><td>Original contract sum</td><td class="num">${esc(money(baseContract))}</td></tr>
<tr><td>Net change by previously approved change orders</td><td class="num">${esc(money(approvedBefore))}</td></tr>
<tr><td>Contract sum prior to this change order</td><td class="num">${esc(money(prior))}</td></tr>
<tr><td>This change order</td><td class="num">${esc((amount < 0 ? '−' : '+') + money(Math.abs(amount)))}</td></tr>
<tr class="total-row"><td>Contract sum including this change order</td><td class="num">${esc(money(after))}</td></tr>
</tbody></table></div>
<div class="sig-grid"><div><div class="sig-line"></div><div class="sig-label">Homeowner signature · Date</div></div><div><div class="sig-line"></div><div class="sig-label">Contractor — NV Construction · Date</div></div></div>`
  return page({ title: `Change Order ${coLabel}`, label: 'Change Order', number: coLabel, tagline: 'Change Order', body, logoUrl, autoPrint: false })
}

// The e-signed lien waiver stored on a billing submission (billing_submissions
// lien_waiver_* fields). Only shown when lien_waiver_signed_at is set.
export function buildBillingWaiverHtml({ billing: b, job, origin = '' }) {
  const period = b?.billing_period ? new Date(b.billing_period + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—'
  const sig = safeImageSrc(b?.lien_waiver_signature, origin)
  const body = `<p class="doc-title">Signed Lien Waiver</p>
<p class="doc-meta">${jobLine(job)}</p>
<div class="grid">
<div class="field"><label>Claimant</label>${esc(b?.company_name || '—')}</div>
<div class="field"><label>Hiring party</label>NV Construction</div>
<div class="field"><label>Owner</label>${esc(job?.owner_company || job?.owner_name || 'Project Owner')}</div>
<div class="field"><label>Payment amount</label>${esc(money(b?.amount_billed))}</div>
<div class="field"><label>Through</label>${esc(period)}</div>
<div class="field"><label>Signed</label>${esc(b?.lien_waiver_signed_at ? dateLong(b.lien_waiver_signed_at) : '—')}</div>
</div>
<div class="sig-grid"><div>${sig ? `<img src="${esc(sig)}" alt="Signature" style="max-width:220px;max-height:64px">` : ''}<div class="sig-label">Electronic signature</div></div><div><div style="font-size:14px;font-weight:600">${esc(b?.lien_waiver_signer_name || '')}</div><div class="sig-label">Printed name</div></div></div>`
  return page({ title: 'Signed Lien Waiver', label: 'Lien Waiver', number: b?.company_name || '', tagline: 'Lien Waiver', body, autoPrint: false })
}

// Residential completion report (Complete Job & Report / Generate Report).
// s: summary figures computed on the page from the same data as its tabs.
// fundedKnown is null when a funded draw has no recorded amount (shown as unknown).
export function buildCompletionReportHtml({ job, s, logoUrl = '', today = new Date() }) {
  const row = (label, value, note = '') => `<tr><td>${esc(label)}${note ? `<div class="note">${esc(note)}</div>` : ''}</td><td class="num">${esc(value)}</td></tr>`
  const m = v => (v === null || v === undefined ? 'Unknown' : money(v))
  const body = `<p class="doc-title">Project Completion Report</p>
<p class="doc-meta">${jobLine(job)} · ${esc(today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</p>
<div class="section"><div class="section-title">Contract</div><table><tbody>
${row('Base contract', m(s.baseContract))}
${row('Approved change orders', m(s.approvedCOs))}
${row('Revised contract', m(s.revised))}
${s.bankTotal === null ? '' : row('Bank schedule total', m(s.bankTotal))}
</tbody></table></div>
<div class="section"><div class="section-title">Owner / lender draws</div><table><tbody>
${row('Requested (submitted, approved, funded)', m(s.requested))}
${row('Funded — cash recorded', m(s.fundedKnown), s.unknownFunded ? `${s.unknownFunded} funded draw(s) have no recorded amount; their cash is not included.` : '')}
</tbody></table></div>
<div class="section"><div class="section-title">Cost</div><table><tbody>
${s.costBudget === null ? '' : row('Cost budget', m(s.costBudget))}
${row('Sub commitments (incl. approved sub COs)', m(s.committed))}
${row('Approved direct costs (net of credits)', m(s.approvedDc))}
${row('Approved sub billing', m(s.approvedBilling))}
</tbody></table></div>`
  return page({ title: `Completion Report ${job?.job_number || ''}`, label: 'Completion Report', number: job?.job_number ? '#' + job.job_number : '', tagline: 'Residential', body, logoUrl, autoPrint: false })
}
