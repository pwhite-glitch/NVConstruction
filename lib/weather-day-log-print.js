// Printable weather-day log for a commercial job (prompt 71): the daily reports
// flagged as a weather delay, for a time-extension request. Pure HTML builder; the
// job page opens it with lib/open-file.js openHtml. Weather days are listed and
// counted only — they do not change the contract completion date.
import { weatherDelayRows } from './contract-time'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmtDate = s => {
  const d = String(s || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const printedAtCentral = now => now.toLocaleString('en-US', {
  timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
})

export function buildWeatherDayLogHtml({ job, reports = [], contractCompletionDate = null, currentCompletion = null, approvedDays = 0, from = '', to = '', now = new Date() } = {}) {
  const jobName = job?.project_name || job?.name || 'Project'
  const jobNum = job?.job_number ? `#${job.job_number}` : ''
  const rows = weatherDelayRows(reports, { from, to })
  const range = from || to ? `${from ? fmtDate(from) : 'Start'} – ${to ? fmtDate(to) : 'Today'}` : 'All reports'

  const body = rows.length
    ? rows.map((r, i) => {
      const notes = [r.work_performed, r.issues].map(v => (v == null ? '' : String(v).trim())).filter(Boolean)
      return `<tr>
        <td class="n">${i + 1}</td>
        <td class="d">${esc(fmtDate(r.report_date))}</td>
        <td>${esc(r.weather || '')}</td>
        <td>${esc(r.weather_temp || '')}</td>
        <td class="notes">${notes.map(esc).join('<br>')}</td>
      </tr>`
    }).join('')
    : '<tr><td colspan="5" class="empty">No weather-delay days in this range.</td></tr>'

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weather-Day Log — ${esc(jobName)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111;background:#fff;font-size:12px;padding:24px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:12px;border-bottom:2px solid #111;margin-bottom:14px;flex-wrap:wrap}
  h1{font-size:18px;font-weight:800;margin-bottom:4px}
  .meta{font-size:11px;color:#555;line-height:1.7}
  .meta strong{color:#111}
  .right{text-align:right;font-size:10px;color:#6b7280;line-height:1.7}
  .summary{display:flex;gap:18px;flex-wrap:wrap;font-size:11px;margin-bottom:12px}
  .summary div{border:1px solid #e5e7eb;border-radius:6px;padding:6px 10px;background:#f9fafb}
  .summary b{display:block;font-size:14px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f3f4f6;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
  td.n{width:32px;color:#6b7280}
  td.d{white-space:nowrap}
  td.notes{white-space:pre-wrap}
  td.empty{text-align:center;color:#9ca3af;padding:16px}
  tr{page-break-inside:avoid}
  .note{margin-top:12px;font-size:10px;color:#6b7280}
  .print-btn{position:fixed;top:12px;right:12px;padding:8px 14px;border:none;border-radius:6px;background:#111;color:#fff;font-weight:700;cursor:pointer}
  @media print{ .print-btn{display:none} body{padding:0} }
</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="header">
  <div>
    <h1>Weather-Day Log</h1>
    <div class="meta">
      <div><strong>${esc(jobName)}</strong> ${esc(jobNum)}</div>
      <div>Original contract completion: <strong>${esc(contractCompletionDate ? fmtDate(contractCompletionDate) : 'Not set')}</strong></div>
      <div>Approved CO days: <strong>${esc(String(approvedDays || 0))}</strong> · Current completion: <strong>${esc(currentCompletion ? fmtDate(currentCompletion) : '—')}</strong></div>
      <div>Range: ${esc(range)}</div>
    </div>
  </div>
  <div class="right">Printed ${esc(printedAtCentral(now))}</div>
</div>
<div class="summary"><div>Weather-delay days<b>${rows.length}</b></div></div>
<table>
  <thead><tr><th>#</th><th>Date</th><th>Weather</th><th>Temp</th><th>Super notes</th></tr></thead>
  <tbody>${body}</tbody>
</table>
<div class="note">Days marked “weather delay” on the superintendent’s daily report. Listed for a time-extension request; not added to the completion date.</div>
</body></html>`
}
