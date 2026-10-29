// Printable 2-week lookahead (Download PDF), shared by the job page and the field app.
import { lookaheadDays, activitiesForDay, activitiesInDays, rangeLabel, dayOfRange } from './lookahead-dates'
import { responsibleLabel, hasOpenConstraint, statusInfo, stageLabel } from './lookahead-fields'
import { forecastText, isRainRisk, rainFlagged } from './lookahead-weather'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = (s, opts) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
const workers = acts => acts.reduce((s, a) => s + (parseInt(a.manpower) || 0) + (a.additional_companies || []).reduce((s2, co) => s2 + (parseInt(co.manpower) || 0), 0), 0)

export function buildLookaheadPrintHtml({ job, lookahead, weekStart, activities, contracts, forecast = {} }) {
  const jobName = job?.project_name || job?.name || job?.address || 'Project'
  const jobNum  = job?.job_number ? `#${job.job_number}` : ''
  const days    = lookaheadDays(weekStart)
  const dateRange = fmt(days[0], { month: 'short', day: 'numeric' }) + ' – ' + fmt(days[9], { month: 'short', day: 'numeric', year: 'numeric' })
  const todayStr  = new Date().toISOString().split('T')[0]
  const printedAt = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const renderActivity = (act, day) => {
    const type = act.responsible_type === 'sub' ? 'sub' : act.responsible_type === 'other' ? 'other' : 'own'
    const mp   = parseInt(act.manpower) || 0
    const st   = statusInfo(act.status)
    const range = dayOfRange(act, day)
    const matStatus = act.materials_status === 'on_site' ? '' : act.materials_status === 'ordered' ? '<span class="tag tag-warn">Mat: Ordered</span>' : act.materials_status ? '<span class="tag tag-alert">Mat: Need Order</span>' : ''
    return `<div class="act act-${type}${act.status === 'done' ? ' done' : ''}">
      <div class="act-title">${esc(act.description)}${act.location ? `<span class="act-loc"> · ${esc(act.location)}</span>` : ''}</div>
      <div class="act-tags">
        <span class="tag tag-${type}">${esc(responsibleLabel(act, contracts))}</span>
        <span class="tag" style="color:${st.fg};background:${st.bg};border-color:${st.bd}">${st.label}</span>
        ${range ? `<span class="tag">${range}</span>` : ''}
        ${rainFlagged(act, forecast[day]) ? '<span class="tag tag-alert">☔ Rain risk</span>' : ''}
        ${mp > 0 ? `<span class="tag">${mp} workers</span>` : ''}
        ${act.equipment ? `<span class="tag">⚙ ${esc(act.equipment)}</span>` : ''}
        ${act.inspection_required ? `<span class="tag tag-warn">🔍 Insp${act.inspection_scheduled ? ' ✓' : ''}</span>` : ''}
        ${act.committed ? '<span class="tag tag-green">Committed ✓</span>' : ''}
        ${(act.additional_companies || []).map(co => `<span class="tag tag-other">+${esc(co.name)}${co.manpower ? ` (${co.manpower})` : ''}</span>`).join('')}
        ${matStatus}
      </div>
      ${act.constraints ? `<div class="act-constraint">⛔ ${esc(act.constraints)}</div>` : ''}
      ${act.constraints_notes ? `<div class="act-notes">${esc(act.constraints_notes)}</div>` : ''}
    </div>`
  }

  const renderWeek = (wkDays, wkNum) => {
    const wkActs       = activitiesInDays(activities, wkDays)
    const totalManpower = workers(wkActs)
    const inspections   = wkActs.filter(a => a.inspection_required).length
    const open          = wkActs.filter(hasOpenConstraint).length
    const wkLabel = `Week ${wkNum} — ${fmt(wkDays[0], { month: 'short', day: 'numeric' })} – ${fmt(wkDays[4], { month: 'short', day: 'numeric' })}`

    const cols = wkDays.map(day => {
      const dayActs = activitiesForDay(activities, day)
      const w       = forecast[day]
      const isToday = day === todayStr
      const wxLine  = w ? esc((w.icon ? w.icon + ' ' : '') + w.label + (w.high != null ? ` · ${w.high}°` : '') + (isRainRisk(w) ? ' ☔' : '')) : ''
      return `<div class="col${isToday ? ' today' : ''}">
        <div class="col-head">
          <div><span class="dname">${fmt(day, { weekday: 'short' })}</span><span class="ddate">${fmt(day, { month: 'short', day: 'numeric' })}${isToday ? ' <strong style="color:#e8590c">· Today</strong>' : ''}</span></div>
          ${wxLine ? `<div class="wx">${wxLine}</div>` : ''}
        </div>
        <div class="col-body">
          ${dayActs.length === 0 ? '<div class="empty-day">—</div>' : dayActs.map(a => renderActivity(a, day)).join('')}
        </div>
      </div>`
    }).join('')

    return `<div class="week">
      <div class="week-bar">
        <span class="week-label">${esc(wkLabel)}</span>
        <span class="week-stats">
          ${wkActs.length > 0 ? `<span>${wkActs.length} activit${wkActs.length !== 1 ? 'ies' : 'y'}</span>` : ''}
          ${totalManpower > 0 ? `<span>${totalManpower} workers</span>` : ''}
          ${inspections > 0 ? `<span class="warn">⚠ ${inspections} inspection${inspections > 1 ? 's' : ''}</span>` : ''}
          ${open > 0 ? `<span class="alert">⛔ ${open} open constraint${open > 1 ? 's' : ''}</span>` : ''}
        </span>
      </div>
      <div class="grid">${cols}</div>
    </div>`
  }

  const multiDay = activities.filter(a => rangeLabel(a))

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>2-Week Lookahead — ${esc(jobName)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111;background:#fff;font-size:11px;padding:20px 24px}
  /* ── Header ── */
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #111;margin-bottom:16px}
  .header-left h1{font-size:18px;font-weight:800;margin-bottom:3px;line-height:1}
  .header-left .meta{font-size:11px;color:#555;display:flex;gap:12px;flex-wrap:wrap;margin-top:4px}
  .header-left .meta span{display:flex;align-items:center;gap:4px}
  .header-right{text-align:right;font-size:10px;color:#9ca3af;line-height:1.7}
  .header-right strong{color:#374151;display:block;font-size:11px}
  .status-pill{display:inline-flex;align-items:center;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:700;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;margin-left:8px}
  /* ── Multi-day banner ── */
  .multiday{font-size:10px;color:#555;background:#f9fafb;border:1px solid #e5e7eb;border-radius:5px;padding:6px 10px;margin-bottom:14px;line-height:1.6}
  .multiday strong{color:#111;font-size:10px}
  /* ── Week section ── */
  .week{margin-bottom:18px}
  .week-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1.5px solid #111}
  .week-label{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#111}
  .week-stats{display:flex;gap:14px;font-size:10px;color:#6b7280}
  .warn{color:#b45309;font-weight:700}.alert{color:#dc2626;font-weight:700}
  /* ── Calendar grid ── */
  .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
  .col{border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;display:flex;flex-direction:column}
  .col-head{padding:6px 8px;background:#f9fafb;border-bottom:1px solid #e5e7eb}
  .dname{font-size:11px;font-weight:700;color:#374151}
  .ddate{font-size:10px;color:#9ca3af;margin-left:5px}
  .wx{font-size:9px;color:#6b7280;margin-top:2px}
  .col.today .col-head{background:#fff7ed;border-bottom-color:#fdba74}
  .col.today .dname{color:#e8590c}
  .col-body{padding:6px;flex:1}
  .empty-day{font-size:10px;color:#d1d5db;padding:10px 0;text-align:center}
  /* ── Activity cards ── */
  .act{border:1px solid #e5e7eb;border-left:3px solid #22c55e;border-radius:4px;padding:6px 7px;margin-bottom:4px;background:#fff;page-break-inside:avoid}
  .act-own{border-left-color:#16a34a}.act-sub{border-left-color:#2563eb}.act-other{border-left-color:#ea580c}
  .act.done .act-title{text-decoration:line-through;color:#9ca3af}
  .act-title{font-size:10.5px;font-weight:600;color:#111;line-height:1.3;margin-bottom:4px}
  .act-loc{font-weight:400;color:#9ca3af;font-size:10px}
  .act-tags{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:2px}
  .tag{padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;white-space:nowrap}
  .tag-own{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}
  .tag-sub{background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe}
  .tag-other{background:#fff7ed;color:#c2410c;border-color:#fed7aa}
  .tag-warn{background:#fffbeb;color:#b45309;border-color:#fde68a}
  .tag-alert{background:#fef2f2;color:#dc2626;border-color:#fecaca}
  .tag-green{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}
  .act-constraint{font-size:9px;color:#dc2626;margin-top:4px;padding-top:3px;border-top:1px dashed #fecaca;font-style:italic}
  .act-notes{font-size:9px;color:#6b7280;margin-top:2px;font-style:italic}
  /* ── Footer ── */
  .footer{display:flex;justify-content:space-between;font-size:9px;color:#d1d5db;margin-top:14px;padding-top:10px;border-top:1px solid #f3f4f6}
  /* ── Print ── */
  @media print{
    body{padding:0;font-size:10px}
    @page{margin:.6cm;size:letter landscape}
    .week{page-break-inside:avoid}
  }
</style></head><body>

<div class="header">
  <div class="header-left">
    <h1>2-Week Lookahead${jobNum ? ` &nbsp;<span style="font-weight:400;color:#9ca3af;font-size:14px">${esc(jobNum)}</span>` : ''}</h1>
    <div class="meta">
      <span><strong style="color:#111">${esc(jobName)}</strong></span>
      <span style="color:#9ca3af">|</span>
      <span>${dateRange}</span>
      <span style="color:#9ca3af">|</span>
      <span>${esc(stageLabel(lookahead))}</span>
    </div>
  </div>
  <div class="header-right">
    <strong>NV Construction</strong>
    Printed ${printedAt}
  </div>
</div>

${multiDay.length ? `<div class="multiday"><strong>Multi-day activities:</strong> ${multiDay.map(a => esc(a.description) + ' (' + rangeLabel(a) + ')').join(' &nbsp;·&nbsp; ')}</div>` : ''}

${renderWeek(days.slice(0, 5), 1)}
${renderWeek(days.slice(5, 10), 2)}

<div class="footer">
  <span>NV Construction · 2-Week Lookahead · ${esc(jobName)}${jobNum ? ' · ' + esc(jobNum) : ''}</span>
  <span>Generated ${printedAt}</span>
</div>

<script>window.onload = () => window.print()</script>
</body></html>`
}

export function openLookaheadPrint(args) {
  const w = window.open('', '_blank')
  if (w) { w.document.write(buildLookaheadPrintHtml(args)); w.document.close() }
}
